// The four tools' behaviour, independent of MCP. Each function takes an
// Upstream (cached API client) and returns structured output plus a short
// text rendering. server.ts wires them to MCP; tests drive them with a fake
// fetch.

import type {
  RawGlossaryPreview,
  RawGlossaryTerm,
  RawIngredientOption,
  RawIngredientPage,
  RawIngredientPagePreview,
  RawMatchGroups,
  RawPreview,
  RawRecipe,
  RawRecipeList,
} from './api-types'
import { type CocktailCard, recipeText, slugOf, toCard, toRecipe, type RecipeOutput } from './format'
import { STAPLES, aliasFor, cleanTerms, pickFromSearch, type ResolvedTerm } from './ingredients'
import {
  type Candidate,
  type RankedMatch,
  type StrengthFilter,
  candidatesFromGroups,
  compareWithBar,
  isLowProof,
  matchesFlavors,
  rankMatches,
} from './ranking'
import { AGE_NOTE, BY_INGREDIENTS_TOOL_URL, IMAGE_ORIGIN, recipeUrl } from './site'
import { type TermOutput, closeNames, findTerms, glossaryTerm, hitName, hitUrl, ingredientTerm } from './terms'
import { NO_MATCH, nameRank, normalize } from './text'
import type { Upstream } from './upstream'

const DAY = 86_400
const HOUR = 3_600
const CATALOGUE_TTL = 12 * HOUR
const CATALOGUE_PAGE_SIZE = 2000
const DETAIL_POOL = 12
const LOW_PROOF_POOL = 4

export class ToolInputError extends Error {}

// ---------------------------------------------------------------- data access

export async function loadCatalogue(up: Upstream): Promise<RawPreview[]> {
  const path = (page: number) =>
    `/cocktails?page=${page}&pageSize=${CATALOGUE_PAGE_SIZE}&sortBy=popularityScore&sortOrder=desc`
  const first = await up.get<RawRecipeList>(path(1), CATALOGUE_TTL)
  if (!first) return []
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, (first.totalPages ?? 1) - 1) }, (_, i) =>
      up.get<RawRecipeList>(path(i + 2), CATALOGUE_TTL)
    )
  )
  return [first, ...rest].flatMap((page) => page?.cocktails ?? [])
}

function recipeBySlug(up: Upstream, slug: string) {
  return up.get<RawRecipe>(`/cocktails/slug/${encodeURIComponent(slug)}`, DAY)
}

async function similarTo(up: Upstream, id: string): Promise<RawPreview[]> {
  const list = await up.get<RawPreview[]>(`/cocktails/similar/${encodeURIComponent(id)}`, DAY)
  return Array.isArray(list) ? list : []
}

async function searchIngredients(up: Upstream, term: string): Promise<RawIngredientOption[]> {
  const threshold = term.length <= 5 ? 0.1 : 0.3
  const params = new URLSearchParams({ query: term, threshold: String(threshold), limit: '30' })
  const list = await up.get<RawIngredientOption[]>(`/ingredients/search?${params}`, 7 * DAY)
  return Array.isArray(list) ? list : []
}

// ------------------------------------------------------------ recipe lookup

const RECIPE_URL_PATTERN = /fixmeadrinkapp\.com\/recipes\/([a-z0-9-]+)/i

/**
 * The catalogue entries that best answer a name, best first. An exact name
 * wins; among equally good matches free recipes come first, then popularity.
 */
export function rankRecipes(query: string, catalogue: readonly RawPreview[]) {
  const fromUrl = query.match(RECIPE_URL_PATTERN)?.[1]
  const q = fromUrl ?? query
  const bySlug = catalogue.find((item) => item.slug && item.slug === q.trim().toLowerCase())
  if (bySlug) return [bySlug]
  return catalogue
    .map((item, index) => ({
      item,
      index,
      rank: nameRank(q.replace(/-/g, ' '), item.name),
    }))
    .filter((entry) => entry.rank < NO_MATCH)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.item.isFree === true) - Number(a.item.isFree === true) ||
        a.index - b.index
    )
    .map((entry) => entry.item)
}

async function findRecipe(up: Upstream, query: string) {
  const name = query.trim()
  if (!name) throw new ToolInputError('Give the name of a cocktail, for example "Daiquiri".')
  const catalogue = await loadCatalogue(up)
  let ranked = rankRecipes(name, catalogue)
  if (ranked.length === 0) {
    const params = new URLSearchParams({ query: name, pageSize: '10' })
    const found = await up.get<RawPreview[]>(`/cocktails/search?${params}`, HOUR)
    ranked = Array.isArray(found) ? found : []
  }
  return ranked
}

// ------------------------------------------------------------ find cocktails

export interface FindArgs {
  readonly ingredients: readonly string[]
  readonly strength?: StrengthFilter
  readonly flavors?: readonly string[]
  readonly limit?: number
}

export interface MatchCard extends CocktailCard {
  have: string[]
  missing: string[]
  missing_garnish?: string[]
  can_make_now: boolean
}

export interface FindOutput {
  bar: {
    recognised: ResolvedTerm[]
    not_recognised: string[]
    assumed_staples: string[]
  }
  cocktails: MatchCard[]
  low_proof_options: MatchCard[]
  note?: string
  more_ideas_url: string
}

export interface ToolOutput<T> {
  readonly structured: T
  readonly text: string
  /** Widget-only data, hidden from the model. */
  readonly meta?: Record<string, unknown>
}

async function resolveTerms(up: Upstream, terms: readonly string[]) {
  const resolved = await Promise.all(
    terms.map(async (term): Promise<ResolvedTerm> => {
      const alias = aliasFor(term)
      if (alias) return { you_said: term, matched_as: [...alias] }
      const options = await searchIngredients(up, term)
      return { you_said: term, matched_as: pickFromSearch(term, options) }
    })
  )
  return {
    recognised: resolved.filter((item) => item.matched_as.length > 0),
    notRecognised: resolved.filter((item) => item.matched_as.length === 0).map((item) => item.you_said),
  }
}

async function compareCandidates(
  up: Upstream,
  candidates: readonly Candidate[],
  bar: ReadonlySet<string>
): Promise<RankedMatch<RawRecipe>[]> {
  const details = await Promise.all(
    candidates.map((candidate) => recipeBySlug(up, slugOf(candidate.preview)))
  )
  const result: RankedMatch<RawRecipe>[] = []
  details.forEach((recipe, index) => {
    if (!recipe || recipe.isLocked) return
    result.push({ candidate: candidates[index], comparison: compareWithBar(recipe, bar), extra: recipe })
  })
  return result
}

function toMatchCard(match: RankedMatch<RawRecipe>): MatchCard {
  const card: MatchCard = {
    ...toCard(match.candidate.preview),
    have: match.comparison.have,
    missing: match.comparison.missing,
    can_make_now: match.comparison.missing.length === 0,
  }
  if (match.comparison.missingGarnish.length) card.missing_garnish = match.comparison.missingGarnish
  return card
}

function byFewestMissing(matches: RankedMatch<RawRecipe>[]) {
  return matches
    .slice()
    .sort(
      (a, b) =>
        a.comparison.missing.length - b.comparison.missing.length ||
        b.comparison.have.length - a.comparison.have.length ||
        a.candidate.order - b.candidate.order
    )
}

/** Free low and zero-proof recipes from the catalogue, most popular first. */
function lowProofCatalogue(catalogue: readonly RawPreview[], flavors?: readonly string[]): Candidate[] {
  return catalogue
    .filter((item) => item.isFree === true && isLowProof(item.strengthLevel))
    .filter((item) => matchesFlavors(item.flavorNotes, flavors))
    .map((preview, order) => ({ preview, groupRank: 3, order }))
}

function imagesFor(cards: readonly CocktailCard[], previews: readonly RawPreview[]) {
  const byUrl: Record<string, string> = {}
  for (const preview of previews) {
    if (preview.imageUrl?.startsWith(IMAGE_ORIGIN)) byUrl[recipeUrl(slugOf(preview))] = preview.imageUrl
  }
  return Object.fromEntries(
    cards.filter((card) => byUrl[card.url]).map((card) => [card.url, byUrl[card.url]])
  )
}

export async function findCocktails(up: Upstream, args: FindArgs): Promise<ToolOutput<FindOutput>> {
  const terms = cleanTerms(args.ingredients).slice(0, 25)
  if (terms.length === 0) {
    throw new ToolInputError('List at least one bottle or ingredient, for example ["gin", "lime", "sugar"].')
  }
  const limit = Math.min(Math.max(args.limit ?? 5, 1), 8)
  const { recognised, notRecognised } = await resolveTerms(up, terms)

  const output: FindOutput = {
    bar: { recognised, not_recognised: notRecognised, assumed_staples: [...STAPLES] },
    cocktails: [],
    low_proof_options: [],
    more_ideas_url: BY_INGREDIENTS_TOOL_URL,
  }

  if (recognised.length === 0) {
    output.note =
      'None of those matched an ingredient in the Garçon catalogue. Try common names such as "gin", "lime juice" or "sweet vermouth".'
    return { structured: output, text: findText(output) }
  }

  const barNames = [...new Set([...recognised.flatMap((item) => item.matched_as), ...STAPLES])].sort()
  const bar = new Set(barNames)
  const groups =
    (await up.post<RawMatchGroups>('/cocktails/matches', { ingredients: barNames }, HOUR)) ?? {}

  const filters = { strength: args.strength, flavors: args.flavors }
  const pool = candidatesFromGroups(groups, filters).slice(0, DETAIL_POOL)
  const lowPool =
    args.strength === 'zero_or_low'
      ? []
      : candidatesFromGroups(groups, { strength: 'zero_or_low', flavors: args.flavors }).slice(0, LOW_PROOF_POOL)

  const [compared, comparedLow] = await Promise.all([
    compareCandidates(up, pool, bar),
    compareCandidates(up, lowPool, bar),
  ])
  output.cocktails = rankMatches(compared).slice(0, limit).map(toMatchCard)
  output.low_proof_options = rankMatches(comparedLow).slice(0, 2).map(toMatchCard)

  // Low and zero-proof drinks are always offered. When the bar matches none,
  // fall back to the most popular free ones and say so.
  const needFallback =
    args.strength === 'zero_or_low' ? output.cocktails.length === 0 : output.low_proof_options.length === 0
  let catalogue: RawPreview[] = []
  if (needFallback) {
    catalogue = await loadCatalogue(up)
    const fallback = byFewestMissing(
      await compareCandidates(up, lowProofCatalogue(catalogue, args.flavors).slice(0, LOW_PROOF_POOL), bar)
    )
    if (args.strength === 'zero_or_low') {
      output.cocktails = fallback.slice(0, limit).map(toMatchCard)
      output.note =
        'No low or zero-proof recipe uses your bar, so these are popular low-proof drinks with what you would need to buy.'
    } else {
      output.low_proof_options = fallback.slice(0, 2).map(toMatchCard)
    }
  }

  if (output.cocktails.length === 0 && !output.note) {
    output.note =
      args.strength || args.flavors?.length
        ? 'No free recipe matched both your bar and those filters. Try without the filters.'
        : 'No free recipe uses those ingredients yet. Adding a base spirit, a citrus and a sweetener opens up the most drinks.'
  }

  const previews = [
    ...pool.map((c) => c.preview),
    ...lowPool.map((c) => c.preview),
    ...catalogue.filter((item) => isLowProof(item.strengthLevel)),
  ]
  return {
    structured: output,
    text: findText(output),
    meta: { images: imagesFor([...output.cocktails, ...output.low_proof_options], previews) },
  }
}

function cardLine(card: MatchCard) {
  const status = card.can_make_now
    ? 'can make now'
    : `missing ${card.missing.join(', ')}`
  return `- ${card.name} (${card.strength}): ${status}. ${card.url}`
}

function findText(output: FindOutput) {
  const lines: string[] = []
  const recognised = output.bar.recognised.map((item) => `${item.you_said} -> ${item.matched_as.join(' / ')}`)
  if (recognised.length) lines.push(`Your bar: ${recognised.join('; ')}.`)
  if (output.bar.not_recognised.length) lines.push(`Not recognised: ${output.bar.not_recognised.join(', ')}.`)
  if (output.note) lines.push(output.note)
  if (output.cocktails.length) {
    lines.push('Drinks, closest first:')
    lines.push(...output.cocktails.map(cardLine))
  }
  if (output.low_proof_options.length) {
    lines.push('Low or zero-proof options:')
    lines.push(...output.low_proof_options.map(cardLine))
  }
  lines.push(`More ideas: ${output.more_ideas_url}`)
  lines.push(AGE_NOTE)
  return lines.join('\n')
}

// ---------------------------------------------------------------- get recipe

export interface RecipeToolOutput extends RecipeOutput {
  note?: string
  other_matches?: { name: string; url: string }[]
  free_alternatives?: CocktailCard[]
}

export async function getRecipe(up: Upstream, args: { name: string }): Promise<ToolOutput<RecipeToolOutput>> {
  const ranked = await findRecipe(up, args.name)
  const best = ranked[0]
  if (!best) {
    throw new ToolInputError(
      `No cocktail called "${args.name}" in the Garçon catalogue. Check the spelling or try a shorter name.`
    )
  }
  const raw = await recipeBySlug(up, slugOf(best))
  if (!raw) throw new ToolInputError(`The recipe page for "${best.name}" is not available right now.`)

  const output: RecipeToolOutput = toRecipe(raw)
  const asked = args.name.trim()
  const askedBySlug = RECIPE_URL_PATTERN.test(asked) || asked === best.slug
  if (!askedBySlug && normalize(best.name) !== normalize(asked)) {
    output.note = `No recipe is named exactly "${asked}". This is the closest match in the Garçon catalogue.`
    const others = ranked.slice(1, 4)
    if (others.length) {
      output.other_matches = others.map((item) => ({ name: item.name, url: recipeUrl(slugOf(item)) }))
    }
  }
  if (raw.isLocked) {
    const similar = (await similarTo(up, raw.id)).filter((item) => item.isFree === true)
    if (similar.length) output.free_alternatives = similar.slice(0, 3).map(toCard)
  }

  const lines = output.note ? [output.note, recipeText(output)] : [recipeText(output)]
  if (output.free_alternatives?.length) {
    lines.push('Free recipes like it:', ...output.free_alternatives.map((c) => `- ${c.name}: ${c.url}`))
  }
  if (output.other_matches?.length) {
    lines.push(`Other matches: ${output.other_matches.map((m) => m.name).join(', ')}`)
  }
  if (!isLowProof(output.strength)) lines.push(AGE_NOTE)
  const meta = best.imageUrl?.startsWith(IMAGE_ORIGIN) ? { image: best.imageUrl } : undefined
  return { structured: output, text: lines.join('\n'), meta }
}

// ------------------------------------------------------------ similar drinks

export interface SimilarCard extends CocktailCard {
  full_recipe_public: boolean
}

export interface SimilarOutput {
  source: { name: string; url: string }
  suggestions: SimilarCard[]
  low_proof_options: SimilarCard[]
  note?: string
}

function similarCard(preview: RawPreview): SimilarCard {
  return { ...toCard(preview), full_recipe_public: preview.isFree === true }
}

export async function suggestSimilar(
  up: Upstream,
  args: { name: string; low_proof?: boolean }
): Promise<ToolOutput<SimilarOutput>> {
  const ranked = await findRecipe(up, args.name)
  const source = ranked[0]
  if (!source) {
    throw new ToolInputError(
      `No cocktail called "${args.name}" in the Garçon catalogue. Check the spelling or try a shorter name.`
    )
  }
  const [similar, catalogue] = await Promise.all([similarTo(up, source.id), loadCatalogue(up)])

  // Low-proof drinks that share a flavour (or the base) with the source.
  const flavors = new Set((source.flavorNotes ?? []).map(normalize))
  const lowProof = catalogue
    .filter((item) => item.isFree === true && isLowProof(item.strengthLevel) && item.id !== source.id)
    .map((item, index) => ({
      item,
      index,
      score:
        (item.flavorNotes ?? []).filter((note) => flavors.has(normalize(note))).length +
        (item.baseSpirit && item.baseSpirit === source.baseSpirit ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item)

  const output: SimilarOutput = {
    source: { name: source.name, url: recipeUrl(slugOf(source)) },
    suggestions: [],
    low_proof_options: [],
  }
  if (args.low_proof) {
    const lowSimilar = similar.filter((item) => isLowProof(item.strengthLevel))
    output.suggestions = [...lowSimilar, ...lowProof]
      .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
      .slice(0, 4)
      .map(similarCard)
    output.note = 'Low and zero-proof drinks that share flavours with it.'
  } else {
    // Free recipes first: their full recipe is public.
    output.suggestions = similar
      .slice()
      .sort((a, b) => Number(b.isFree === true) - Number(a.isFree === true))
      .map(similarCard)
    output.low_proof_options = lowProof.slice(0, 2).map(similarCard)
  }

  const lines = [`Drinks like ${output.source.name} (${output.source.url}):`]
  for (const card of output.suggestions) {
    lines.push(`- ${card.name} (${card.strength}, ${card.flavors.join(', ') || 'no notes'}): ${card.url}${card.full_recipe_public ? '' : ' [premium recipe]'}`)
  }
  if (output.suggestions.length === 0) lines.push('No similar drinks found.')
  if (output.low_proof_options.length) {
    lines.push('Low or zero-proof options:', ...output.low_proof_options.map((c) => `- ${c.name}: ${c.url}`))
  }
  return { structured: output, text: lines.join('\n') }
}

// --------------------------------------------------------------- explain term

export interface ExplainOutput extends TermOutput {
  also_matches?: { name: string; url: string }[]
}

export async function explainTerm(up: Upstream, args: { term: string }): Promise<ToolOutput<ExplainOutput>> {
  const term = args.term.trim()
  if (!term) throw new ToolInputError('Give a spirit, ingredient or bar term, for example "mezcal" or "dry shake".')
  const [glossary, pages] = await Promise.all([
    up.get<RawGlossaryPreview[]>('/glossary', DAY),
    up.get<RawIngredientPagePreview[]>('/ingredient-pages', DAY),
  ])
  const glossaryList = Array.isArray(glossary) ? glossary : []
  const pageList = Array.isArray(pages) ? pages : []
  const hits = findTerms(term, glossaryList, pageList)
  const best = hits[0]
  if (!best) {
    const close = closeNames(term, glossaryList, pageList)
    throw new ToolInputError(
      `Garçon has no page for "${term}" yet.${close.length ? ` Close matches: ${close.join(', ')}.` : ''}`
    )
  }

  let output: ExplainOutput
  if (best.kind === 'ingredient') {
    const page = await up.get<RawIngredientPage>(
      `/ingredient-pages/slug/${encodeURIComponent(best.page.slug)}?cocktailsLimit=8`,
      DAY
    )
    if (!page) throw new ToolInputError(`The page for "${best.page.name}" is not available right now.`)
    const names = new Map(pageList.map((item) => [item.slug, item.name]))
    const examples = (page.cocktails ?? [])
      .filter((item) => item.isFree === true)
      .slice(0, 4)
      .map((item) => ({ name: item.name, url: recipeUrl(slugOf(item)) }))
    output = ingredientTerm(page, names, examples)
  } else {
    const detail = await up.get<RawGlossaryTerm>(`/glossary/slug/${encodeURIComponent(best.term.slug)}`, DAY)
    if (!detail) throw new ToolInputError(`The page for "${best.term.name}" is not available right now.`)
    output = glossaryTerm(detail)
  }
  const others = hits.slice(1, 4).filter((hit) => hitName(hit) !== output.name)
  if (others.length && best.rank > 0) {
    output.also_matches = others.map((hit) => ({ name: hitName(hit), url: hitUrl(hit) }))
  }

  const lines = [`${output.name} (${output.kind}): ${output.url}`, output.definition]
  for (const detail of output.details) lines.push(`${detail.label}: ${detail.value}`)
  if (output.how_to) {
    lines.push(output.how_to.question, ...output.how_to.steps.map((step, i) => `${i + 1}. ${step}`))
  }
  if (output.substitutes?.length) {
    lines.push(
      `Substitutes: ${output.substitutes.map((s) => `${s.name}${s.zero_proof ? ' (zero-proof)' : ''}`).join(', ')}`
    )
  }
  if (output.example_cocktails?.length) {
    lines.push(`Try it in: ${output.example_cocktails.map((c) => c.name).join(', ')}`)
  }
  return { structured: output, text: lines.join('\n') }
}
