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

export interface Dependency {
  readonly ingredient: string
  readonly you_said: string
}

interface BarComparison {
  readonly have: string[]
  readonly missing: string[]
  /** Covered only if a vague bottle ("vermouth") is the right kind. Never in `have`. */
  readonly dependsOn: Dependency[]
  readonly missingGarnish: string[]
}

const GARNISH_GROUP = normalize('Garnishes & Decorative Elements')

/** The catalogue names a bar definitely owns. */
export function definiteNames(bar: readonly ResolvedTerm[]) {
  return new Set(bar.filter((term) => !term.single_bottle).flatMap((term) => term.matched_as.map(normalize)))
}

/**
 * The most distinct required ingredients a bar can own in one recipe: every
 * definite name once, plus one per one-bottle substitute. Ownership counts
 * distinct names (compareWithBar dedupes), so this bounds `have`.
 */
export function haveCeiling(bar: readonly ResolvedTerm[]) {
  return definiteNames(bar).size + bar.filter((term) => term.single_bottle).length
}

/**
 * Which required ingredients the bar covers. A definite name covers every
 * ingredient with that name. A vague bottle (`could_be`) covers at most one
 * ingredient, and only conditionally: it goes to `dependsOn`, so it is never
 * owned and never makes a drink complete on its own. Optional ingredients
 * and staples never count; garnishes are reported apart and do not block a
 * match.
 */
export function compareWithBar(recipe: RawRecipe, bar: readonly ResolvedTerm[]): BarComparison {
  const definite = definiteNames(bar)
  const substitutes = bar.filter((term) => term.single_bottle).map((term) => new Set(term.matched_as.map(normalize)))
  const bottles = bar
    .filter((term) => term.could_be?.length)
    .map((term) => ({ you_said: term.you_said, names: new Set((term.could_be ?? []).map(normalize)) }))
  const anyTerm = new Set([
    ...definite,
    ...substitutes.flatMap((names) => [...names]),
    ...bottles.flatMap((bottle) => [...bottle.names]),
  ])

  // Each distinct ingredient once: ownership and ranking count names, not
  // rows (quantities stay with the recipe itself).
  const required: string[] = []
  const missingGarnish: string[] = []
  const seen = new Set<string>()
  for (const entry of recipe.ingredients ?? []) {
    const name = entry.ingredient?.name
    if (!name || entry.optional || isStaple(name)) continue
    if (seen.has(normalize(name))) continue
    seen.add(normalize(name))
    if (normalize(entry.ingredient.groupCategory ?? '') === GARNISH_GROUP) {
      if (!anyTerm.has(normalize(name))) missingGarnish.push(name)
    } else {
      required.push(name)
    }
  }

  // Substitutes and vague bottles each cover at most one ingredient, so they
  // are matched together: as many ingredients as possible first, then as
  // many of those owned (substitutes) as possible. The open ingredients go
  // in name order, so the order of the recipe's rows never changes the result.
  const covered = required.map((name) => definite.has(normalize(name)))
  const open = required
    .flatMap((_, index) => (covered[index] ? [] : [index]))
    .sort((a, b) => normalize(required[a]).localeCompare(normalize(required[b])))
  const owners = matchBottles(
    open.map((index) => normalize(required[index])),
    [...substitutes, ...bottles.map((bottle) => bottle.names)]
  )
  const dependsBy = new Map<number, string>()
  owners.forEach((bottle, slot) => {
    if (bottle === -1) return
    if (bottle < substitutes.length) covered[open[slot]] = true
    else dependsBy.set(open[slot], bottles[bottle - substitutes.length].you_said)
  })
  return {
    have: required.filter((_, index) => covered[index]),
    missing: required.filter((_, index) => !covered[index] && !dependsBy.has(index)),
    dependsOn: required.flatMap((name, index) => {
      const you_said = dependsBy.get(index)
      return you_said === undefined ? [] : [{ ingredient: name, you_said }]
    }),
    missingGarnish,
  }
}

/**
 * Matches bottles to ingredients, one each, by augmenting paths taken in
 * bottle order. A bottle matched once stays matched, so the result covers
 * the most ingredients possible and, among those matchings, uses the most
 * bottles from the front of the list. Returns, per ingredient, its bottle or -1.
 */
function matchBottles(ingredients: readonly string[], bottles: readonly ReadonlySet<string>[]) {
  const owner = new Array<number>(ingredients.length).fill(-1)
  const assign = (bottle: number, tried: Set<number>): boolean =>
    ingredients.some((name, slot) => {
      if (tried.has(slot) || !bottles[bottle].has(name)) return false
      tried.add(slot)
      if (owner[slot] !== -1 && !assign(owner[slot], tried)) return false
      owner[slot] = bottle
      return true
    })
  bottles.forEach((_, bottle) => assign(bottle, new Set()))
  return owner
}

export interface Match {
  readonly candidate: Candidate
  readonly comparison: BarComparison
}

/** Best first: fewest missing, then fewest that depend on a vague bottle, then more of the bar used, then API order. */
export function rankMatches(matches: readonly Match[]): Match[] {
  return [...matches].sort(
    (a, b) =>
      a.comparison.missing.length - b.comparison.missing.length ||
      a.comparison.dependsOn.length - b.comparison.dependsOn.length ||
      b.comparison.have.length - a.comparison.have.length ||
      a.candidate.order - b.candidate.order
  )
}

const BATCH_SIZE = 8

export interface BestMatches {
  readonly matches: Match[]
  /** False when `maxChecked` ran out while an unchecked candidate could still rank in the top. */
  readonly complete: boolean
}

/**
 * Whether an unchecked candidate could rank above `worst` under rankMatches.
 * The bound is the best it could possibly score: nothing missing and nothing
 * conditional (the API's group says little, since it counts garnishes and
 * optional items), and at most as many owned ingredients as the bar has
 * names or the recipe has ingredients. API order is known exactly.
 */
function couldBeat(candidate: GroupCandidate, worst: Match, haveCeiling: number) {
  if (worst.comparison.missing.length > 0 || worst.comparison.dependsOn.length > 0) return true
  const haveMax = Math.min(haveCeiling, candidate.preview.ingredientCount ?? Number.POSITIVE_INFINITY)
  if (haveMax !== worst.comparison.have.length) return haveMax > worst.comparison.have.length
  return candidate.order < worst.candidate.order
}

/**
 * The top `limit` matches. Candidates are compared in batches, best estimate
 * first, and only while one of them could still enter the top under the full
 * ranking; the answer is complete when none can. When `maxChecked` stops the
 * search before that is proven, the result says so.
 * Recipes that use nothing from the bar are dropped.
 */
export async function bestMatches(
  candidates: readonly GroupCandidate[],
  limit: number,
  maxChecked: number,
  compare: (batch: readonly GroupCandidate[]) => Promise<Match[]>,
  haveCeiling: number
): Promise<BestMatches> {
  const found: Match[] = []
  let top: Match[] = []
  let pending = [...candidates]
  let checked = 0
  for (;;) {
    const worst = top.length === limit ? top[top.length - 1] : null
    if (worst) pending = pending.filter((candidate) => couldBeat(candidate, worst, haveCeiling))
    if (pending.length === 0) return { matches: top, complete: true }
    if (checked >= maxChecked) return { matches: top, complete: false }
    const batch = pending.slice(0, Math.min(BATCH_SIZE, maxChecked - checked))
    pending = pending.slice(batch.length)
    checked += batch.length
    const compared = await compare(batch)
    found.push(...compared.filter((match) => match.comparison.have.length > 0 || match.comparison.dependsOn.length > 0))
    top = rankMatches(found).slice(0, limit)
  }
}
