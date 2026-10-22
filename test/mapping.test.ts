import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RawGlossaryPreview, RawIngredientOption, RawIngredientPagePreview, RawPreview, RawRecipe } from '../src/api-types'
import { formatAmount, formatQuantity, recipeText, toCard, toRecipe } from '../src/format'
import { aliasFor, cleanTerms, isStaple, pickFromSearch } from '../src/ingredients'
import { rankRecipes } from '../src/service'
import { findTerms, plainText } from '../src/terms'
import { nameRank, normalize, slugify } from '../src/text'

const fixture = <T>(name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T

describe('text helpers', () => {
  it('normalizes accents, ampersands and punctuation', () => {
    expect(normalize('  Bénédictine & Soda! ')).toBe('benedictine and soda')
    expect(slugify('Gin & French')).toBe('gin-and-french')
  })

  it('ranks exact names above prefixes and partial matches', () => {
    expect(nameRank('daiquiri', 'Daiquiri')).toBe(0)
    expect(nameRank('daiq', 'Daiquiri No. 2')).toBeLessThan(nameRank('daiq', 'Dry Daiquiri'))
    expect(nameRank('gin', 'Ginger')).toBeGreaterThan(nameRank('gin', 'Dry gin'))
    expect(nameRank('tequila', 'Vodka')).toBe(9)
  })
})

describe('amounts', () => {
  it('prints kitchen fractions', () => {
    expect(formatQuantity(1.5)).toBe('1½')
    expect(formatQuantity(0.67)).toBe('⅔')
    expect(formatQuantity(2)).toBe('2')
  })

  it('prints shots as oz with ml, and keeps other units', () => {
    expect(formatAmount({ amount: 1.5, unit: 'shot' })).toBe('1½ oz (44 ml)')
    expect(formatAmount({ amount: 30, unit: 'ml' })).toBe('1 oz (30 ml)')
    expect(formatAmount({ amount: 0.1, unit: 'shot' })).toBe('½ barspoon')
    expect(formatAmount({ amount: 3, unit: 'dash' })).toBe('3 dashes')
    expect(formatAmount({ amount: null, unit: 'Top up with' })).toBe('Top up')
    expect(formatAmount({ amount: 8, unit: 'fresh' })).toBe('8')
  })
})

describe('recipe mapping', () => {
  it('maps a free recipe with canonical URL, serving details and steps', () => {
    const output = toRecipe(fixture<RawRecipe>('old-fashioned.json'))
    expect(output.url).toBe('https://fixmeadrinkapp.com/recipes/old-fashioned')
    expect(output.full_recipe_public).toBe(true)
    expect(output.glass).toBe('Rocks')
    expect(output.ingredients[0]).toEqual({ amount: '2 oz (59 ml)', name: 'Bourbon whiskey' })
    expect(output.steps.length).toBeGreaterThan(2)
    expect(output.abv_percent).toBeGreaterThan(0)
  })

  it('maps "Top up with" amounts and hides "No Ice"', () => {
    const output = toRecipe(fixture<RawRecipe>('grapefruit-mule.json'))
    expect(output.ingredients.find((i) => i.name === 'Ginger Beer')?.amount).toBe('Top up')
    expect(output.ice).toBe('Regular Cubes')
  })

  it('keeps a premium recipe to its public fields', () => {
    const output = toRecipe(fixture<RawRecipe>('rose-sour-locked.json'))
    expect(output.full_recipe_public).toBe(false)
    expect(output.ingredients).toEqual([])
    expect(output.steps).toEqual([])
    expect(recipeText(output)).toContain('premium recipe')
  })

  it('builds cards with canonical URLs, slug or not', () => {
    const card = toCard({ id: '1', name: 'Gin & French', strengthLevel: 'Strong', flavorNotes: ['Herbal'] } as RawPreview)
    expect(card.url).toBe('https://fixmeadrinkapp.com/recipes/gin-and-french')
    expect(card.strength).toBe('Strong')
  })
})

describe('ingredient resolution', () => {
  it('expands common words to catalogue names', () => {
    expect(aliasFor('Gin')).toEqual(['London dry gin', 'Dry gin'])
    expect(aliasFor('limes')).toEqual(['Lime Juice', 'Lime'])
    expect(aliasFor("Peychaud's")).toEqual(["Peychaud's bitters"])
    expect(aliasFor('dragonfruit')).toBeNull()
  })

  it('picks near matches from search results and skips look-alikes', () => {
    const options = fixture<RawIngredientOption[]>('search-gin.json')
    const picked = pickFromSearch('gin', options)
    expect(picked).not.toContain('Ginger')
    expect(picked.length).toBeGreaterThan(0)
    const sloe = pickFromSearch('sloe gin', options)
    expect(sloe[0]).toBe('Sloe gin')
  })

  it('splits pasted lists and dedupes, but keeps "half and half"', () => {
    expect(cleanTerms(['gin, lime and sugar', 'Gin', ' '])).toEqual(['gin', 'lime', 'sugar'])
    expect(cleanTerms(['half and half'])).toEqual(['half and half'])
  })

  it('treats water and saline as staples', () => {
    expect(isStaple('Chilled water')).toBe(true)
    expect(isStaple('Saline solution 4:1')).toBe(true)
    expect(isStaple('Vodka')).toBe(false)
  })
})

describe('recipe lookup', () => {
  const catalogue: RawPreview[] = [
    { id: '1', name: 'Dry Daiquiri', slug: 'dry-daiquiri', isFree: true },
    { id: '2', name: 'Daiquiri No. 2', slug: 'daiquiri-no-2', isFree: false },
    { id: '3', name: 'Daiquiri', slug: 'daiquiri', isFree: false },
    { id: '4', name: 'Pink Daiquiri', slug: 'pink-daiquiri', isFree: true },
  ]

  it('prefers the exact name, even when premium', () => {
    expect(rankRecipes('daiquiri', catalogue)[0].id).toBe('3')
  })

  it('accepts a slug or a fixmeadrinkapp.com URL', () => {
    expect(rankRecipes('pink-daiquiri', catalogue)[0].id).toBe('4')
    expect(rankRecipes('https://fixmeadrinkapp.com/recipes/dry-daiquiri', catalogue)[0].id).toBe('1')
  })

  it('treats a qualified classic as the plain name', () => {
    const list: RawPreview[] = [
      { id: 'a', name: 'Tsipouro Negroni', isFree: true },
      { id: 'b', name: 'Manhattan (Sweet)', isFree: true },
      { id: 'c', name: 'Black Manhattan', isFree: true },
      { id: 'd', name: 'The Original Margarita', isFree: false },
      { id: 'e', name: 'Rusty Margarita', isFree: true },
    ]
    expect(rankRecipes('manhattan', list)[0].id).toBe('b')
    expect(rankRecipes('Margarita', list)[0].id).toBe('d')
  })

  it('puts free recipes first among equally good matches', () => {
    const ranked = rankRecipes('daiquiri', catalogue.filter((c) => c.id !== '3'))
    expect(ranked.map((c) => c.id)).toEqual(['1', '4', '2'])
  })
})

describe('term lookup', () => {
  const glossary: RawGlossaryPreview[] = [
    { slug: 'dry-shake', name: 'Dry shake', type: 'technique', aliases: [] },
    { slug: 'coupe', name: 'Coupe', type: 'glassware', aliases: ['champagne coupe'] },
  ]
  const pages: RawIngredientPagePreview[] = [
    { slug: 'mezcal', name: 'Mezcal', aliases: [] },
    { slug: 'gin', name: 'Gin', aliases: ['genever-style gin'] },
  ]

  it('strips question words and finds the right page', () => {
    expect(findTerms('what is a dry shake?', glossary, pages)[0]).toMatchObject({ kind: 'glossary', term: { slug: 'dry-shake' } })
    expect(findTerms('Mezcal', glossary, pages)[0]).toMatchObject({ kind: 'ingredient', page: { slug: 'mezcal' } })
    expect(findTerms('coupe glass', glossary, pages)[0]).toMatchObject({ term: { slug: 'coupe' } })
  })

  it('returns nothing for unknown terms', () => {
    expect(findTerms('quantum foam', glossary, pages)).toEqual([])
  })

  it('removes glossary link markup', () => {
    expect(plainText('[[term:double-strain|Double strain]] into a [[ingredient:egg-white]] glass')).toBe(
      'Double strain into a egg white glass'
    )
  })
})
