import { describe, expect, it } from 'vitest'
import type { RawGlossaryPreview, RawIngredientOption, RawIngredientPagePreview, RawPreview } from '../src/api-types'
import { recipeText, toCard, toRecipe } from '../src/format'
import { cleanTerms, isStaple, resolveAlias, resolveFromSearch } from '../src/ingredients'
import { findTerms, glossaryTerm } from '../src/terms'
import { nameRank, normalize, slugify } from '../src/text'
import { mule, oldFashioned, roseSour } from './data'
import searchGin from './fixtures/search-gin.json'

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
  const amount = (value: number | null, unit: string) =>
    toRecipe({ isLocked: false, id: 'a', name: 'A', ingredients: [{ amount: value, unit, ingredient: { name: 'X' } }] })
      .ingredients[0].amount

  it('prints shots as oz with ml in kitchen fractions, and keeps other units', () => {
    expect(amount(0.67, 'shot')).toBe('⅔ oz (20 ml)')
    expect(amount(1.5, 'shot')).toBe('1½ oz (44 ml)')
    expect(amount(2, 'shot')).toBe('2 oz (59 ml)')
    expect(amount(30, 'ml')).toBe('1 oz (30 ml)')
    expect(amount(0.1, 'shot')).toBe('½ barspoon')
    expect(amount(3, 'dash')).toBe('3 dashes')
    expect(amount(null, 'Top up with')).toBe('Top up')
    expect(amount(8, 'fresh')).toBe('8')
  })
})

describe('recipe mapping', () => {
  it('maps a free recipe with canonical URL, serving details and steps', () => {
    const output = toRecipe(oldFashioned)
    expect(output.url).toBe('https://fixmeadrinkapp.com/recipes/old-fashioned')
    expect(output.full_recipe_public).toBe(true)
    expect(output.glass).toBe('Rocks')
    expect(output.ingredients[0]).toEqual({ amount: '2 oz (59 ml)', name: 'Bourbon whiskey' })
    expect(output.steps.length).toBeGreaterThan(2)
    expect(output.abv_percent).toBeGreaterThan(0)
  })

  it('maps "Top up with" amounts and hides "No Ice"', () => {
    const output = toRecipe(mule)
    expect(output.ingredients.find((i) => i.name === 'Ginger Beer')?.amount).toBe('Top up')
    expect(output.ice).toBe('Regular Cubes')
  })

  it('keeps a premium recipe to its public fields', () => {
    const output = toRecipe(roseSour)
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
    expect(resolveAlias('Gin')).toEqual({ you_said: 'Gin', matched_as: ['London dry gin', 'Dry gin'], one_of: true })
    expect(resolveAlias('limes')).toEqual({ you_said: 'limes', matched_as: ['Lime Juice', 'Lime'] })
    expect(resolveAlias("Peychaud's")?.matched_as).toEqual(["Peychaud's bitters"])
    expect(resolveAlias('dragonfruit')).toBeNull()
    expect(resolveAlias('constructor')).toBeNull()
  })

  it('picks near matches from search results and skips look-alikes', () => {
    const options = searchGin as RawIngredientOption[]
    const gin = resolveFromSearch('gin', options)
    expect(gin.matched_as).not.toContain('Ginger')
    expect(gin.matched_as.length).toBeGreaterThan(0)
    expect(resolveFromSearch('sloe gin', options).matched_as[0]).toBe('Sloe gin')
    expect(resolveFromSearch('quantum', options).matched_as).toEqual([])
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
    const term = glossaryTerm({
      slug: 'shake',
      name: 'Shake',
      type: 'technique',
      shortDefinition: '[[term:double-strain|Double strain]] into a [[ingredient:egg-white]] glass',
    })
    expect(term.definition).toBe('Double strain into a egg white glass')
  })
})
