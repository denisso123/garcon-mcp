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

function term(names: string[]): ResolvedTerm {
  return { you_said: names[0], matched_as: names }
}

function vague(word: string, couldBe: string[], names: string[] = []): ResolvedTerm {
  return { you_said: word, matched_as: names, could_be: couldBe }
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
      [term(['London dry gin', 'Dry gin']), term(['Lime Juice'])]
    )
    expect(result).toEqual({
      have: ['London dry gin', 'Lime Juice'],
      missing: ['Rich Simple (2:1) syrup'],
      dependsOn: [],
      missingGarnish: [],
    })
  })

  it('reports garnishes apart, so they never block a match', () => {
    const result = compareWithBar(recipe('r', ['Vodka', 'Lime wedge|garnish']), [term(['Vodka'])])
    expect(result.missing).toEqual([])
    expect(result.missingGarnish).toEqual(['Lime wedge'])
  })

  it('lists a repeated required ingredient once (audit 3, finding 3)', () => {
    expect(compareWithBar(recipe('r', ['Vodka', 'vodka', 'Lime Juice']), [term(['Vodka'])])).toMatchObject({
      have: ['Vodka'],
      missing: ['Lime Juice'],
    })
  })

  it('lets a one-bottle substitute cover one ingredient, definitely', () => {
    const syrup: ResolvedTerm = { you_said: 'simple syrup', matched_as: ['Rich Simple (2:1) syrup', 'Plain Simple'], single_bottle: true }
    expect(compareWithBar(recipe('r', ['Rich Simple (2:1) syrup', 'Plain Simple']), [syrup])).toMatchObject({
      have: ['Plain Simple'],
      missing: ['Rich Simple (2:1) syrup'],
      dependsOn: [],
    })
  })

  it('gives the same answer for any order of the recipe rows (audit 4, finding 1)', () => {
    const syrup: ResolvedTerm = { you_said: 'simple syrup', matched_as: ['Rich Simple (2:1) syrup', 'Plain Simple'], single_bottle: true }
    const vagueSyrup = vague('syrup', ['Rich Simple (2:1) syrup', 'Honey syrup (3:1)'])
    const rows = [['Rich Simple (2:1) syrup', 'Plain Simple'], ['Plain Simple', 'Rich Simple (2:1) syrup']]
    for (const order of rows) {
      const result = compareWithBar(recipe('r', order), [syrup, vagueSyrup])
      expect(result.missing, order.join(', ')).toEqual([])
      expect(result.have).toEqual(['Plain Simple'])
      expect(result.dependsOn).toEqual([{ ingredient: 'Rich Simple (2:1) syrup', you_said: 'syrup' }])
    }
    // Every permutation of a larger recipe scores the same.
    const names = ['Rich Simple (2:1) syrup', 'Plain Simple', 'Honey syrup (3:1)', 'Lime Juice']
    const permutations = (list: string[]): string[][] =>
      list.length <= 1 ? [list] : list.flatMap((item, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [item, ...rest]))
    const scores = permutations(names).map((order) => {
      const result = compareWithBar(recipe('r', order), [syrup, vagueSyrup, term(['Lime Juice'])])
      return JSON.stringify([[...result.have].sort(), [...result.missing].sort(), result.dependsOn.map((d) => d.ingredient).sort()])
    })
    expect(new Set(scores).size).toBe(1)
  })

  it('compares names without case or accent differences', () => {
    expect(compareWithBar(recipe('r', ['Bénédictine']), [term(['benedictine'])]).have).toEqual(['Bénédictine'])
  })

  it('lets a vague bottle stand in for one ingredient, conditionally, and never as owned', () => {
    const twoRums = recipe('r', ['Gold rum', 'Light rum'])
    const rum = vague('rum', ['Light rum', 'Gold rum'], ['Rum'])
    const one = compareWithBar(twoRums, [rum])
    expect(one.have).toEqual([])
    expect(one.missing).toHaveLength(1)
    expect(one.dependsOn).toHaveLength(1)
    const both = compareWithBar(twoRums, [rum, term(['Gold rum', 'Rum'])])
    expect(both).toMatchObject({ have: ['Gold rum'], missing: [], dependsOn: [{ ingredient: 'Light rum', you_said: 'rum' }] })
  })

  it('counts a definite name before a vague one', () => {
    const result = compareWithBar(recipe('r', ['Rum', 'Sweet vermouth']), [
      vague('rum', ['Light rum', 'Gold rum'], ['Rum']),
      vague('vermouth', ['Sweet vermouth', 'Dry vermouth']),
    ])
    expect(result).toMatchObject({ have: ['Rum'], missing: [], dependsOn: [{ ingredient: 'Sweet vermouth', you_said: 'vermouth' }] })
  })
})

function match(id: string, have: number, missing: number, order = 0): Match {
  return {
    candidate: { preview: preview(id), order },
    comparison: {
      have: Array.from({ length: have }, (_, i) => `h${i}`),
      missing: Array.from({ length: missing }, (_, i) => `m${i}`),
      dependsOn: [],
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

  it('stops once no unchecked candidate can rank higher under the full comparator', async () => {
    const checked: string[] = []
    const list = candidates([0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2])
    // The bar has one name, so nothing can own more than the one ingredient each match owns,
    // and every unchecked candidate comes later in API order.
    const { matches, complete } = await bestMatches(list, 3, 16, compareBy((c) => c.apiMissing, checked), 1)
    expect(ids(matches.map((m) => m.candidate))).toEqual(['c0', 'c1', 'c2'])
    expect(checked).toHaveLength(8)
    expect(complete).toBe(true)
  })

  it('keeps comparing across the batch boundary when an unchecked candidate could own more of the bar', async () => {
    const checked: string[] = []
    // Ten complete candidates; only the tenth, in the second batch, owns both bar names.
    const list = candidates(Array.from({ length: 10 }, () => 0))
    const compare = async (batch: readonly GroupCandidate[]) => {
      checked.push(...ids([...batch]))
      return batch.map((candidate) => ({ ...match(candidate.preview.id, candidate.preview.id === 'c9' ? 2 : 1, 0, candidate.order), candidate }))
    }
    const { matches, complete } = await bestMatches(list, 1, 16, compare, 2)
    expect(checked).toHaveLength(10)
    expect(matches[0].candidate.preview.id).toBe('c9')
    expect(complete).toBe(true)
  })

  it('returns exactly what exhaustive ranking returns, across ceilings, conditional matches and pruned searches', async () => {
    // mulberry32: a small seeded generator that stays within 32-bit integers.
    let state = 0x9e3779b9
    const random = () => {
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const next = (n: number) => Math.floor(random() * n)
    const coverage = { ceilings: new Set<number>(), nonEmpty: 0, conditional: 0, pruned: 0 }

    for (let round = 0; round < 300; round++) {
      const size = 9 + next(16)
      const ceiling = 1 + next(5)
      const specs = Array.from({ length: size }, () => {
        const have = next(ceiling + 1)
        return { have, missing: next(3), depends: next(4) === 0 ? 1 + next(2) : 0, count: have + next(3) }
      })
      const list = specs.map((spec, order) => ({ preview: preview(`c${order}`, { ingredientCount: spec.count }), order, apiMissing: 0 }))
      const scored = (candidate: GroupCandidate): Match => {
        const spec = specs[candidate.order]
        const base = match(candidate.preview.id, spec.have, spec.missing, candidate.order)
        const dependsOn = Array.from({ length: spec.depends }, (_, i) => ({ ingredient: `d${i}`, you_said: 'vermouth' }))
        return { candidate, comparison: { ...base.comparison, dependsOn } }
      }
      const limit = 1 + next(5)
      let checked = 0
      const { matches, complete } = await bestMatches(
        list,
        limit,
        64,
        async (batch) => {
          checked += batch.length
          return batch.map(scored)
        },
        ceiling
      )
      const kept = list.map(scored).filter((m) => m.comparison.have.length > 0 || m.comparison.dependsOn.length > 0)
      const exhaustive = rankMatches(kept).slice(0, limit)
      expect(complete).toBe(true)
      expect(ids(matches.map((m) => m.candidate))).toEqual(ids(exhaustive.map((m) => m.candidate)))

      coverage.ceilings.add(ceiling)
      if (exhaustive.length > 0) coverage.nonEmpty++
      if (exhaustive.some((m) => m.comparison.dependsOn.length > 0)) coverage.conditional++
      if (checked < size) coverage.pruned++
    }
    expect(coverage.ceilings.size).toBe(5)
    expect(coverage.nonEmpty).toBeGreaterThan(250)
    expect(coverage.conditional).toBeGreaterThan(30)
    expect(coverage.pruned).toBeGreaterThan(30)
  })

  it('checks a whole close group, because a garnish can hide a complete match', async () => {
    const checked: string[] = []
    const list = candidates(Array.from({ length: 13 }, () => 1))
    const { matches, complete } = await bestMatches(list, 5, 16, compareBy((c) => (c.preview.id === 'c12' ? 0 : 1), checked), 1)
    expect(matches[0].candidate.preview.id).toBe('c12')
    expect(checked).toHaveLength(13)
    expect(complete).toBe(true)
  })

  it('never checks more than the cap, says the answer is partial, and drops matches that use nothing from the bar', async () => {
    const checked: string[] = []
    const list = candidates(Array.from({ length: 30 }, () => 1))
    const compare = async (batch: readonly GroupCandidate[]) => {
      checked.push(...ids([...batch]))
      return batch.map((candidate) => ({ ...match(candidate.preview.id, candidate.order % 2, 1, candidate.order), candidate }))
    }
    const { matches, complete } = await bestMatches(list, 5, 16, compare, 1)
    expect(checked).toHaveLength(16)
    expect(complete).toBe(false)
    expect(matches.every((m) => m.comparison.have.length > 0)).toBe(true)
  })
})
