import { describe, expect, it } from 'vitest'
import type { RawPreview } from '../src/api-types'
import {
  type GroupCandidate,
  type Match,
  bestMatches,
  candidatesFromGroups,
  compareWithBar,
  isLowProof,
  matchesFlavors,
  rankMatches,
} from '../src/ranking'
import type { ResolvedTerm } from '../src/schemas'
import { recipe } from './harness'

function preview(id: string, extra: Partial<RawPreview> = {}): RawPreview {
  return { id, name: `Drink ${id}`, slug: `drink-${id}`, isFree: true, strengthLevel: 'Medium', flavorNotes: ['Citrusy'], ...extra }
}

const ids = (items: { preview: RawPreview }[]) => items.map((item) => item.preview.id)

function term(names: string[], oneOf = false): ResolvedTerm {
  return oneOf ? { you_said: names[0], matched_as: names, one_of: true } : { you_said: names[0], matched_as: names }
}

describe('filters', () => {
  it('recognises low and zero-proof levels', () => {
    expect(isLowProof('Low')).toBe(true)
    expect(isLowProof('Non Alcoholic')).toBe(true)
    expect(isLowProof('Medium')).toBe(false)
    expect(isLowProof(undefined)).toBe(false)
  })

  it('matches any requested flavour, case-insensitively', () => {
    expect(matchesFlavors(['Citrusy', 'Herbal'], ['herbal'])).toBe(true)
    expect(matchesFlavors(['Citrusy'], ['smoky', 'nutty'])).toBe(false)
    expect(matchesFlavors(['Citrusy'], [])).toBe(true)
  })
})

describe('candidatesFromGroups', () => {
  it('keeps free recipes, dedupes, and orders by the API missing count then recipe size', () => {
    const groups = {
      readyToMake: [preview('a', { ingredientCount: 2 }), preview('p', { isFree: false }), preview('big', { ingredientCount: 5 })],
      closeMatch: [preview('b'), preview('a')],
      almostThere: [preview('c')],
    }
    const result = candidatesFromGroups(groups, {})
    expect(ids(result)).toEqual(['big', 'a', 'b', 'c'])
    expect(result.map((c) => c.apiMissing)).toEqual([0, 0, 1, 2])
  })

  it('applies strength and flavour filters', () => {
    const groups = {
      closeMatch: [
        preview('low', { strengthLevel: 'Low', flavorNotes: ['Fruity'] }),
        preview('zero', { strengthLevel: 'Non Alcoholic', flavorNotes: ['Fruity'] }),
        preview('strong', { strengthLevel: 'Very Strong', flavorNotes: ['Fruity'] }),
        preview('low-herbal', { strengthLevel: 'Low', flavorNotes: ['Herbal'] }),
      ],
    }
    expect(ids(candidatesFromGroups(groups, { strength: 'zero_or_low', flavors: ['fruity'] }))).toEqual(['low', 'zero'])
    expect(ids(candidatesFromGroups(groups, { strength: 'strong' }))).toEqual(['strong'])
    expect(candidatesFromGroups({}, {})).toEqual([])
  })
})

describe('compareWithBar', () => {
  it('splits have and missing, ignoring optional items and staples', () => {
    const result = compareWithBar(
      recipe('r', ['London dry gin', 'Lime Juice', 'Rich Simple (2:1) syrup', 'Saline solution 4:1', 'Chilled water', 'Orange bitters?']),
      [term(['London dry gin', 'Dry gin'], true), term(['Lime Juice'])]
    )
    expect(result).toEqual({ have: ['London dry gin', 'Lime Juice'], missing: ['Rich Simple (2:1) syrup'], missingGarnish: [] })
  })

  it('reports garnishes apart, so they never block a match', () => {
    const result = compareWithBar(recipe('r', ['Vodka', 'Lime wedge|garnish']), [term(['Vodka'])])
    expect(result.missing).toEqual([])
    expect(result.missingGarnish).toEqual(['Lime wedge'])
  })

  it('compares names without case or accent differences', () => {
    expect(compareWithBar(recipe('r', ['Bénédictine']), [term(['benedictine'])]).have).toEqual(['Bénédictine'])
  })

  it('uses each one-bottle term once, finding the assignment that covers the most', () => {
    const twoRums = recipe('r', ['Gold rum', 'Light rum'])
    const rum = term(['Light rum', 'Rum', 'Gold rum'], true)
    const darkRum = term(['Gold rum', 'Rum'], true)
    expect(compareWithBar(twoRums, [rum]).missing).toHaveLength(1)
    expect(compareWithBar(twoRums, [rum, darkRum]).missing).toEqual([])
  })
})

function match(id: string, have: number, missing: number, order = 0): Match {
  return {
    candidate: { preview: preview(id), order },
    comparison: {
      have: Array.from({ length: have }, (_, i) => `h${i}`),
      missing: Array.from({ length: missing }, (_, i) => `m${i}`),
      missingGarnish: [],
    },
  }
}

describe('rankMatches', () => {
  it('puts the fewest missing first, then more of the bar used, then API order', () => {
    const ranked = rankMatches([match('two', 1, 2), match('late', 2, 1, 9), match('none', 1, 0), match('early', 2, 1, 3), match('more', 3, 1, 30)])
    expect(ids(ranked.map((m) => m.candidate))).toEqual(['none', 'more', 'early', 'late', 'two'])
  })
})

describe('bestMatches', () => {
  function candidates(apiMissing: number[]): GroupCandidate[] {
    return apiMissing.map((missing, order) => ({ preview: preview(`c${order}`), order, apiMissing: missing }))
  }

  function compareBy(missingFor: (candidate: GroupCandidate) => number, checked: string[]) {
    return async (batch: readonly GroupCandidate[]) => {
      checked.push(...ids([...batch]))
      return batch.map((candidate) => ({ ...match(candidate.preview.id, 1, missingFor(candidate), candidate.order), candidate }))
    }
  }

  it('stops once no unchecked group can miss fewer ingredients', async () => {
    const checked: string[] = []
    const list = candidates([0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2])
    const top = await bestMatches(list, 3, 16, compareBy((c) => c.apiMissing, checked))
    expect(ids(top.map((m) => m.candidate))).toEqual(['c0', 'c1', 'c2'])
    expect(checked).toHaveLength(8)
  })

  it('checks a whole close group, because a garnish can hide a complete match', async () => {
    const checked: string[] = []
    const list = candidates(Array.from({ length: 13 }, () => 1))
    const top = await bestMatches(list, 5, 16, compareBy((c) => (c.preview.id === 'c12' ? 0 : 1), checked))
    expect(top[0].candidate.preview.id).toBe('c12')
    expect(checked).toHaveLength(13)
  })

  it('never checks more than the cap and drops matches that use nothing from the bar', async () => {
    const checked: string[] = []
    const list = candidates(Array.from({ length: 30 }, () => 1))
    const compare = async (batch: readonly GroupCandidate[]) => {
      checked.push(...ids([...batch]))
      return batch.map((candidate) => ({ ...match(candidate.preview.id, candidate.order % 2, 1, candidate.order), candidate }))
    }
    const top = await bestMatches(list, 5, 16, compare)
    expect(checked).toHaveLength(16)
    expect(top.every((m) => m.comparison.have.length > 0)).toBe(true)
  })
})
