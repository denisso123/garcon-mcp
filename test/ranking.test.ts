import { describe, expect, it } from 'vitest'
import type { RawPreview, RawRecipe } from '../src/api-types'
import {
  type Candidate,
  type RankedMatch,
  candidatesFromGroups,
  compareWithBar,
  isLowProof,
  matchesFlavors,
  matchesStrength,
  rankMatches,
} from '../src/ranking'

function preview(id: string, extra: Partial<RawPreview> = {}): RawPreview {
  return { id, name: `Drink ${id}`, slug: `drink-${id}`, isFree: true, strengthLevel: 'Medium', flavorNotes: ['Citrusy'], ...extra }
}

function recipe(ingredients: [string, { optional?: boolean; group?: string }?][]): RawRecipe {
  return {
    isLocked: false,
    id: 'r',
    name: 'R',
    ingredients: ingredients.map(([name, options]) => ({
      amount: 1,
      unit: 'shot',
      optional: options?.optional ?? false,
      ingredient: { name, groupCategory: options?.group ?? 'Base Spirits' },
    })),
  }
}

describe('filters', () => {
  it('maps strength filters to the catalogue levels', () => {
    expect(matchesStrength('Low', 'zero_or_low')).toBe(true)
    expect(matchesStrength('Non Alcoholic', 'zero_or_low')).toBe(true)
    expect(matchesStrength('Medium', 'zero_or_low')).toBe(false)
    expect(matchesStrength('Very Strong', 'strong')).toBe(true)
    expect(matchesStrength('Strong', 'medium')).toBe(false)
    expect(matchesStrength(undefined, undefined)).toBe(true)
  })

  it('matches any requested flavour, case-insensitively', () => {
    expect(matchesFlavors(['Citrusy', 'Herbal'], ['herbal'])).toBe(true)
    expect(matchesFlavors(['Citrusy'], ['smoky', 'nutty'])).toBe(false)
    expect(matchesFlavors(['Citrusy'], [])).toBe(true)
  })

  it('recognises low and zero-proof levels', () => {
    expect(isLowProof('Low')).toBe(true)
    expect(isLowProof('Non Alcoholic')).toBe(true)
    expect(isLowProof('Medium')).toBe(false)
    expect(isLowProof(undefined)).toBe(false)
  })
})

describe('candidatesFromGroups', () => {
  it('keeps free recipes in group order, dedupes, and drops premium ones', () => {
    const groups = {
      readyToMake: [preview('a'), preview('p', { isFree: false })],
      closeMatch: [preview('b'), preview('a')],
      almostThere: [preview('c')],
    }
    const result = candidatesFromGroups(groups)
    expect(result.map((c) => c.preview.id)).toEqual(['a', 'b', 'c'])
    expect(result.map((c) => c.groupRank)).toEqual([0, 1, 2])
  })

  it('applies strength and flavour filters', () => {
    const groups = {
      closeMatch: [
        preview('low', { strengthLevel: 'Low', flavorNotes: ['Fruity'] }),
        preview('strong', { strengthLevel: 'Strong', flavorNotes: ['Fruity'] }),
        preview('low-herbal', { strengthLevel: 'Low', flavorNotes: ['Herbal'] }),
      ],
    }
    expect(
      candidatesFromGroups(groups, { strength: 'zero_or_low', flavors: ['fruity'] }).map((c) => c.preview.id)
    ).toEqual(['low'])
  })

  it('survives missing groups', () => {
    expect(candidatesFromGroups({})).toEqual([])
  })
})

describe('compareWithBar', () => {
  it('splits have and missing, ignoring optional items and staples', () => {
    const result = compareWithBar(
      recipe([
        ['London dry gin'],
        ['Lime Juice'],
        ['Rich Simple (2:1) syrup'],
        ['Saline solution 4:1'],
        ['Chilled water'],
        ['Orange bitters', { optional: true }],
      ]),
      new Set(['London dry gin', 'Dry gin', 'Lime Juice'])
    )
    expect(result.have).toEqual(['London dry gin', 'Lime Juice'])
    expect(result.missing).toEqual(['Rich Simple (2:1) syrup'])
    expect(result.requiredCount).toBe(3)
  })

  it('reports garnishes apart, so they never block a match', () => {
    const result = compareWithBar(
      recipe([['Vodka'], ['Lime wedge', { group: 'Garnishes & Decorative Elements' }]]),
      new Set(['Vodka'])
    )
    expect(result.missing).toEqual([])
    expect(result.missingGarnish).toEqual(['Lime wedge'])
  })

  it('compares names without case or accent differences', () => {
    const result = compareWithBar(recipe([['Bénédictine']]), new Set(['benedictine']))
    expect(result.have).toEqual(['Bénédictine'])
  })
})

describe('rankMatches', () => {
  function match(id: string, have: number, missing: number, groupRank = 0, order = 0): RankedMatch<null> {
    const candidate: Candidate = { preview: preview(id), groupRank, order }
    return {
      candidate,
      extra: null,
      comparison: {
        have: Array.from({ length: have }, (_, i) => `h${i}`),
        missing: Array.from({ length: missing }, (_, i) => `m${i}`),
        missingGarnish: [],
        requiredCount: have + missing,
      },
    }
  }

  it('puts the fewest missing ingredients first', () => {
    const ranked = rankMatches([match('two', 1, 2), match('none', 1, 0), match('one', 3, 1)])
    expect(ranked.map((m) => m.candidate.preview.id)).toEqual(['none', 'one', 'two'])
  })

  it('breaks ties by more of the bar used, then API group, then order', () => {
    const ranked = rankMatches([
      match('late', 2, 1, 1, 9),
      match('early', 2, 1, 1, 3),
      match('ready-group', 2, 1, 0, 20),
      match('uses-more', 3, 1, 2, 30),
    ])
    expect(ranked.map((m) => m.candidate.preview.id)).toEqual(['uses-more', 'ready-group', 'early', 'late'])
  })

  it('drops recipes that use nothing from the bar', () => {
    expect(rankMatches([match('nothing', 0, 0), match('some', 1, 2)]).map((m) => m.candidate.preview.id)).toEqual([
      'some',
    ])
  })
})
