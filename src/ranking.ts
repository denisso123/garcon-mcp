// Ranking for "what can I make with what I have". The API's /cocktails/matches
// groups recipes into readyToMake, closeMatch and almostThere, but it does not
// say which ingredients are missing, and it counts garnishes. This module
// recomputes have and missing from each full recipe and ranks on that.

import type { RawMatchGroups, RawPreview, RawRecipe } from './api-types'
import { isStaple } from './ingredients'
import type { ResolvedTerm } from './schemas'
import { normalize } from './text'

export type StrengthFilter = 'zero_or_low' | 'medium' | 'strong'

export const FLAVORS = [
  'citrusy',
  'fruity',
  'herbal',
  'tropical',
  'spicy',
  'floral',
  'woody',
  'creamy',
  'nutty',
  'smoky',
  'chocolate',
  'coffee',
  'berry',
  'mint',
  'vanilla',
  'savory',
  'vegetal',
] as const

const LOW_LEVELS = new Set(['low', 'non alcoholic'])

export function isLowProof(strengthLevel: string | undefined) {
  return LOW_LEVELS.has(normalize(strengthLevel ?? ''))
}

function matchesStrength(strengthLevel: string | undefined, filter: StrengthFilter | undefined) {
  if (!filter) return true
  const level = normalize(strengthLevel ?? '')
  if (filter === 'zero_or_low') return LOW_LEVELS.has(level)
  if (filter === 'medium') return level === 'medium'
  return level === 'strong' || level === 'very strong'
}

export function matchesFlavors(
  flavorNotes: readonly string[] | undefined,
  flavors: readonly string[] | undefined
) {
  if (!flavors || flavors.length === 0) return true
  const notes = new Set((flavorNotes ?? []).map(normalize))
  return flavors.some((flavor) => notes.has(normalize(flavor)))
}

export interface Candidate {
  readonly preview: RawPreview
  /** Position in the API's answer: group first, then popularity. */
  readonly order: number
}

export interface GroupCandidate extends Candidate {
  /** Ingredients the API counts as missing: 0, 1, or 2 and more. */
  readonly apiMissing: number
}

const GROUPS = ['readyToMake', 'closeMatch', 'almostThere'] as const

/**
 * Free recipes from the match groups, deduped and filtered, best estimate
 * first: fewest missing by the API's count, then the most ingredients (the
 * most of the bar used), then API order. Premium recipes are left out: their
 * ingredient lists are not public, so we cannot say what is missing.
 */
export function candidatesFromGroups(
  groups: RawMatchGroups,
  filters: { strength?: StrengthFilter; flavors?: readonly string[] }
): GroupCandidate[] {
  const seen = new Set<string>()
  const result: GroupCandidate[] = []
  let order = 0
  GROUPS.forEach((key, apiMissing) => {
    for (const preview of groups[key] ?? []) {
      order++
      if (!preview?.id || seen.has(preview.id)) continue
      seen.add(preview.id)
      if (preview.isFree !== true) continue
      if (!matchesStrength(preview.strengthLevel, filters.strength)) continue
      if (!matchesFlavors(preview.flavorNotes, filters.flavors)) continue
      result.push({ preview, order, apiMissing })
    }
  })
  return result.sort(
    (a, b) =>
      a.apiMissing - b.apiMissing ||
      (b.preview.ingredientCount ?? 0) - (a.preview.ingredientCount ?? 0) ||
      a.order - b.order
  )
}

interface BarComparison {
  readonly have: string[]
  readonly missing: string[]
  readonly missingGarnish: string[]
}

const GARNISH_GROUP = normalize('Garnishes & Decorative Elements')

/**
 * Which required ingredients the bar covers, matching each ingredient to a
 * bar term. A one-bottle term (`one_of`) covers at most one ingredient, so
 * "vermouth" never covers both sweet and dry vermouth; other terms cover any
 * number. Optional ingredients and staples never count; garnishes are
 * reported apart and do not block "can make now".
 */
export function compareWithBar(recipe: RawRecipe, bar: readonly ResolvedTerm[]): BarComparison {
  const keys = (term: ResolvedTerm) => new Set(term.matched_as.map(normalize))
  const shared = new Set(bar.filter((term) => !term.one_of).flatMap((term) => [...keys(term)]))
  const bottles = bar.filter((term) => term.one_of).map(keys)
  const anyTerm = new Set([...shared, ...bottles.flatMap((names) => [...names])])

  const required: string[] = []
  const missingGarnish: string[] = []
  for (const entry of recipe.ingredients ?? []) {
    const name = entry.ingredient?.name
    if (!name || entry.optional || isStaple(name)) continue
    if (normalize(entry.ingredient.groupCategory ?? '') === GARNISH_GROUP) {
      if (!anyTerm.has(normalize(name))) missingGarnish.push(name)
    } else {
      required.push(name)
    }
  }

  const covered = required.map((name) => shared.has(normalize(name)))
  const open = required.flatMap((_, index) => (covered[index] ? [] : [index]))
  for (const slot of assignBottles(open.map((index) => normalize(required[index])), bottles)) {
    covered[open[slot]] = true
  }
  return {
    have: required.filter((_, index) => covered[index]),
    missing: required.filter((_, index) => !covered[index]),
    missingGarnish,
  }
}

/**
 * The most ingredients one-bottle terms can cover, each bottle used once
 * (augmenting paths). Returns the indexes of the covered ingredients.
 */
function assignBottles(ingredients: readonly string[], bottles: readonly ReadonlySet<string>[]) {
  const holder = new Array<number>(bottles.length).fill(-1)
  const place = (ingredient: number, tried: Set<number>): boolean =>
    bottles.some((names, bottle) => {
      if (tried.has(bottle) || !names.has(ingredients[ingredient])) return false
      tried.add(bottle)
      if (holder[bottle] !== -1 && !place(holder[bottle], tried)) return false
      holder[bottle] = ingredient
      return true
    })
  ingredients.forEach((_, ingredient) => place(ingredient, new Set()))
  return new Set(holder.filter((ingredient) => ingredient !== -1))
}

export interface Match {
  readonly candidate: Candidate
  readonly comparison: BarComparison
}

/** Best first: fewest missing, then more of the bar used, then API order. */
export function rankMatches(matches: readonly Match[]): Match[] {
  return [...matches].sort(
    (a, b) =>
      a.comparison.missing.length - b.comparison.missing.length ||
      b.comparison.have.length - a.comparison.have.length ||
      a.candidate.order - b.candidate.order
  )
}

const BATCH_SIZE = 8

/**
 * The top `limit` matches, comparing candidates in batches, best estimate
 * first, and stopping early once no unchecked candidate can miss fewer
 * ingredients than the ones already chosen.
 *
 * The API counts a missing garnish as missing and this server does not, so a
 * candidate can miss one fewer ingredient than its group says. That assumes
 * at most one garnish per recipe, true of the 200 most popular free recipes
 * on 22 Oct 2026. Recipes that use nothing from the bar are dropped.
 */
export async function bestMatches(
  candidates: readonly GroupCandidate[],
  limit: number,
  maxChecked: number,
  compare: (batch: readonly GroupCandidate[]) => Promise<Match[]>
): Promise<Match[]> {
  const end = Math.min(candidates.length, maxChecked)
  const found: Match[] = []
  let top: Match[] = []
  for (let checked = 0; checked < end; checked += BATCH_SIZE) {
    const next = candidates[checked]
    const floor = Math.max(0, next.apiMissing - 1)
    if (top.length === limit && top.every((match) => match.comparison.missing.length <= floor)) break
    const batch = await compare(candidates.slice(checked, Math.min(checked + BATCH_SIZE, end)))
    found.push(...batch.filter((match) => match.comparison.have.length > 0))
    top = rankMatches(found).slice(0, limit)
  }
  return top
}
