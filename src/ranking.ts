// Ranking for "what can I make with what I have". Pure functions, no I/O, so
// the rules are unit-tested in test/ranking.test.ts.
//
// The API's /cocktails/matches endpoint groups recipes into readyToMake,
// closeMatch and almostThere. Those groups are a good first cut, but they do
// not say which ingredients are missing, and they count garnishes and
// kitchen staples. This module recomputes have / missing from the full
// recipe and ranks on that.

import type { RawMatchGroups, RawPreview, RawRecipe } from './api-types'
import { isStaple } from './ingredients'
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
export type Flavor = (typeof FLAVORS)[number]

const GROUP_RANK = { readyToMake: 0, closeMatch: 1, almostThere: 2 } as const

const LOW_LEVELS = new Set(['low', 'non alcoholic'])

export function isLowProof(strengthLevel: string | undefined) {
  return LOW_LEVELS.has(normalize(strengthLevel ?? ''))
}

export function matchesStrength(
  strengthLevel: string | undefined,
  filter: StrengthFilter | undefined
) {
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
  readonly groupRank: number
  readonly order: number
}

/**
 * Free recipes from the match groups, deduped, in group then API order, with
 * the strength and flavour filters applied. Premium recipes are left out:
 * their ingredient lists are not public, so we cannot say what is missing.
 */
export function candidatesFromGroups(
  groups: RawMatchGroups,
  filters: { strength?: StrengthFilter; flavors?: readonly string[] } = {}
): Candidate[] {
  const seen = new Set<string>()
  const result: Candidate[] = []
  let order = 0
  for (const key of ['readyToMake', 'closeMatch', 'almostThere'] as const) {
    for (const preview of groups[key] ?? []) {
      order++
      if (!preview?.id || seen.has(preview.id)) continue
      seen.add(preview.id)
      if (preview.isFree !== true) continue
      if (!matchesStrength(preview.strengthLevel, filters.strength)) continue
      if (!matchesFlavors(preview.flavorNotes, filters.flavors)) continue
      result.push({ preview, groupRank: GROUP_RANK[key], order })
    }
  }
  return result
}

export interface BarComparison {
  readonly have: string[]
  readonly missing: string[]
  readonly missingGarnish: string[]
  readonly requiredCount: number
}

const GARNISH_GROUP = normalize('Garnishes & Decorative Elements')

/**
 * What the bar covers in one recipe. `bar` holds the catalogue names the
 * user's terms resolved to. Optional ingredients and staples never count as
 * missing; garnishes are reported apart and do not block "can make now".
 */
export function compareWithBar(recipe: RawRecipe, bar: ReadonlySet<string>): BarComparison {
  const barKeys = new Set([...bar].map(normalize))
  const have: string[] = []
  const missing: string[] = []
  const missingGarnish: string[] = []
  let requiredCount = 0

  for (const entry of recipe.ingredients ?? []) {
    const name = entry.ingredient?.name
    if (!name || entry.optional) continue
    if (isStaple(name)) continue
    const owned = barKeys.has(normalize(name))
    if (normalize(entry.ingredient.groupCategory ?? '') === GARNISH_GROUP) {
      if (!owned) missingGarnish.push(name)
      continue
    }
    requiredCount++
    if (owned) have.push(name)
    else missing.push(name)
  }

  return { have, missing, missingGarnish, requiredCount }
}

export interface RankedMatch<T> {
  readonly candidate: Candidate
  readonly comparison: BarComparison
  readonly extra: T
}

/**
 * Best first: fewest missing ingredients, then more of the bar used, then the
 * API's own grouping, then its order (popularity within a group). Recipes
 * that use none of the bar are dropped.
 */
export function rankMatches<T>(matches: readonly RankedMatch<T>[]): RankedMatch<T>[] {
  return matches
    .filter((match) => match.comparison.have.length > 0)
    .slice()
    .sort(
      (a, b) =>
        a.comparison.missing.length - b.comparison.missing.length ||
        b.comparison.have.length - a.comparison.have.length ||
        a.candidate.groupRank - b.candidate.groupRank ||
        a.candidate.order - b.candidate.order
    )
}
