// Maps raw API objects to the compact shapes the tools return. Pure.

import type { RawPreview, RawRecipe, RawRecipeIngredient } from './api-types'
import { recipeUrl } from './site'
import { slugify } from './text'

const ML_PER_OZ = 29.5735
const LIQUID_UNITS = new Set(['shot', 'shots', 'oz', 'ml'])
const BARSPOON_OZ = 1 / 6
const COUNT_UNITS = new Set(['fresh'])

const FRACTIONS: readonly [number, string][] = [
  [0, ''],
  [1 / 6, '⅙'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [5 / 6, '⅚'],
  [1, ''],
]

/** 1.5 as "1½", 0.67 as "⅔": the nearest kitchen fraction. */
export function formatQuantity(value: number) {
  const whole = Math.floor(value)
  const [fraction, glyph] = FRACTIONS.reduce((best, candidate) =>
    Math.abs(value - whole - candidate[0]) < Math.abs(value - whole - best[0])
      ? candidate
      : best
  )
  const units = whole + (fraction === 1 ? 1 : 0)
  if (units === 0) return glyph || '0'
  return `${units}${glyph}`
}

function pluralize(unit: string, amount: number) {
  if (amount <= 1 || unit.endsWith('s') || ['tsp', 'tbsp', 'g', 'kg'].includes(unit)) {
    return unit
  }
  if (unit === 'leaf') return 'leaves'
  if (unit.endsWith('sh') || unit.endsWith('ch')) return `${unit}es`
  return `${unit}s`
}

/**
 * One amount the way the website prints it, oz first with ml in brackets:
 * "1½ oz (44 ml)", "2 dashes", "Top up". The API sends liquids in shots,
 * and 1 shot is 1 oz in its data.
 */
export function formatAmount(entry: Pick<RawRecipeIngredient, 'amount' | 'unit'>) {
  const unit = (entry.unit ?? '').trim()
  const key = unit.toLowerCase()
  if (key === 'top up with') return 'Top up'
  if (typeof entry.amount !== 'number' || entry.amount <= 0) {
    return key === 'to taste' ? 'To taste' : ''
  }
  if (!LIQUID_UNITS.has(key)) {
    if (!unit || COUNT_UNITS.has(key)) return formatQuantity(entry.amount)
    return `${formatQuantity(entry.amount)} ${pluralize(key, entry.amount)}`
  }
  const oz = key === 'ml' ? entry.amount / ML_PER_OZ : entry.amount
  if (oz < 0.25) {
    const spoons = Math.max(0.5, Math.round((oz / BARSPOON_OZ) * 2) / 2)
    return `${formatQuantity(spoons)} ${pluralize('barspoon', spoons)}`
  }
  return `${formatQuantity(oz)} oz (${Math.round(oz * ML_PER_OZ)} ml)`
}

export function slugOf(item: { slug?: string; name: string }) {
  return item.slug || slugify(item.name)
}

export function strengthLabel(level: string | undefined) {
  return level?.trim() || 'Unknown'
}

export interface CocktailCard {
  name: string
  url: string
  strength: string
  flavors: string[]
  base_spirit?: string
  minutes?: number
}

export function toCard(preview: RawPreview): CocktailCard {
  const card: CocktailCard = {
    name: preview.name,
    url: recipeUrl(slugOf(preview)),
    strength: strengthLabel(preview.strengthLevel),
    flavors: [...(preview.flavorNotes ?? [])],
  }
  if (preview.baseSpirit) card.base_spirit = preview.baseSpirit
  if (typeof preview.totalTime === 'number') card.minutes = preview.totalTime
  return card
}

function linkedLabel(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'object' && 'label' in value) {
    const label = (value as { label?: unknown }).label
    return typeof label === 'string' && label.trim() ? label.trim() : undefined
  }
  return undefined
}

export interface RecipeOutput {
  name: string
  url: string
  full_recipe_public: boolean
  description: string
  strength: string
  flavors: string[]
  base_spirit?: string
  abv_percent?: number
  difficulty?: string
  minutes?: number
  glass?: string
  ice?: string
  garnish?: string
  ingredients: { amount: string; name: string; optional?: boolean }[]
  steps: string[]
}

export function toRecipe(recipe: RawRecipe): RecipeOutput {
  const output: RecipeOutput = {
    name: recipe.name,
    url: recipeUrl(slugOf(recipe)),
    full_recipe_public: !recipe.isLocked,
    description: (recipe.description ?? '').trim(),
    strength: strengthLabel(recipe.strengthLevel),
    flavors: [...(recipe.flavorNotes ?? [])],
    ingredients: [],
    steps: [],
  }
  if (recipe.baseSpirit) output.base_spirit = recipe.baseSpirit
  if (recipe.difficulty) output.difficulty = recipe.difficulty
  if (typeof recipe.totalTime === 'number') output.minutes = recipe.totalTime
  if (typeof recipe.alcoholVolumePercentage === 'number' && recipe.alcoholVolumePercentage > 0) {
    output.abv_percent = Math.round(recipe.alcoholVolumePercentage * 10) / 10
  }
  if (recipe.isLocked) return output

  const glass = linkedLabel(recipe.servingDetails?.glassware) ?? linkedLabel(recipe.glassware)
  const ice = linkedLabel(recipe.servingDetails?.ice) ?? linkedLabel(recipe.ice)
  const garnish = linkedLabel(recipe.servingDetails?.garnish) ?? linkedLabel(recipe.garnish)
  if (glass) output.glass = glass
  if (ice && !/^(none|no ice)$/i.test(ice)) output.ice = ice
  if (garnish && garnish.toLowerCase() !== 'none') output.garnish = garnish

  output.ingredients = (recipe.ingredients ?? [])
    .filter((entry) => entry.ingredient?.name)
    .map((entry) => {
      const line: { amount: string; name: string; optional?: boolean } = {
        amount: formatAmount(entry),
        name: entry.ingredient.name,
      }
      if (entry.optional) line.optional = true
      return line
    })
  output.steps = [...(recipe.instructions ?? [])]
    .sort((a, b) => (a.step ?? 0) - (b.step ?? 0))
    .map((step) => step.text.trim())
    .filter(Boolean)
  return output
}

/** Plain-text recipe for the model and for clients without UI. */
export function recipeText(recipe: RecipeOutput) {
  const lines = [`${recipe.name}: ${recipe.url}`]
  if (recipe.description) lines.push(recipe.description)
  const facts = [
    recipe.strength !== 'Unknown' ? `Strength: ${recipe.strength}` : '',
    recipe.abv_percent ? `about ${recipe.abv_percent}% ABV` : '',
    recipe.glass ? `Glass: ${recipe.glass}` : '',
    recipe.minutes ? `${recipe.minutes} min` : '',
  ].filter(Boolean)
  if (facts.length) lines.push(facts.join(' · '))
  if (!recipe.full_recipe_public) {
    lines.push(
      'This is a premium recipe, so its ingredient list and steps are not public. The page above has its description and similar free recipes.'
    )
    return lines.join('\n')
  }
  lines.push('Ingredients:')
  for (const item of recipe.ingredients) {
    lines.push(`- ${[item.amount, item.name].filter(Boolean).join(' ')}${item.optional ? ' (optional)' : ''}`)
  }
  if (recipe.garnish) lines.push(`Garnish: ${recipe.garnish}`)
  lines.push('Steps:')
  recipe.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`))
  return lines.join('\n')
}
