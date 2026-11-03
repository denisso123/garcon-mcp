// The four tools' behaviour, independent of MCP. Each function takes the
// call's Upstream and returns structured output plus a short text rendering.

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
import { recipeText, slugOf, toCard, toRecipe } from './format'
import { STAPLES, cleanTerms, resolveAlias, resolveFromSearch } from './ingredients'
import {
  type Candidate,
  type GroupCandidate,
  type Match,
  type StrengthFilter,
  bestMatches,
  candidatesFromGroups,
  compareWithBar,
  haveCeiling,
  isLowProof,
  matchesFlavors,
  rankMatches,
} from './ranking'
import type {
  ExplainOutput,
  FindOutput,
  MatchCard,
  RecipeOutput,
  ResolvedTerm,
  SimilarCard,
  SimilarOutput,
} from './schemas'
import { BY_INGREDIENTS_TOOL_URL, IMAGE_ORIGIN, recipeUrl } from './site'
import { closeNames, findTerms, glossaryTerm, hitName, hitUrl, ingredientTerm } from './terms'
import { NO_MATCH, nameRank, normalize } from './text'
import { type Upstream, UpstreamError } from './upstream'

const DAY = 86_400
const HOUR = 3_600
const CATALOGUE_TTL = 12 * HOUR
const CATALOGUE_PAGE_SIZE = 2000
// The live catalogue has 3 pages (Nov 2026); 10 leaves room to grow.
const MAX_CATALOGUE_PAGES = 10
let warnedTruncated = false

const MAX_TERMS = 25
const MAX_SEARCHES = 8
const MAX_CHECKED = 16
const MAX_CHECKED_LOW_PROOF = 6
const LOW_PROOF_SHOWN = 2
const POPULAR_LOW_PROOF_POOL = 4
const MAX_SUGGESTIONS = 5

export class ToolInputError extends Error {}

export interface ToolOutput<T> {
  readonly structured: T
  readonly text: string
  /** Widget-only data, hidden from the model. */
  readonly meta?: Record<string, unknown>
}

/**
 * Pages to load, from the API's own count. A missing or malformed count means
 * one page; a count above the ceiling loads only the most popular pages.
 */
export function cataloguePages(totalPages: unknown): number {
  if (typeof totalPages !== 'number' || !Number.isInteger(totalPages) || totalPages < 1) return 1
  return Math.min(totalPages, MAX_CATALOGUE_PAGES)
}

async function loadCatalogue(up: Upstream): Promise<RawPreview[]> {
  const path = (page: number) =>
    `/cocktails?page=${page}&pageSize=${CATALOGUE_PAGE_SIZE}&sortBy=popularityScore&sortOrder=desc`
  const first = await up.get<RawRecipeList>(path(1), CATALOGUE_TTL)
  if (!first) return []
  const pages = cataloguePages(first.totalPages)
  if (first.totalPages > MAX_CATALOGUE_PAGES && !warnedTruncated) {
    // Once per isolate, so a large catalogue shows in Worker logs without flooding them.
    warnedTruncated = true
    console.warn('garcon-mcp: catalogue truncated', { totalPages: first.totalPages, cap: MAX_CATALOGUE_PAGES })
  }
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
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

const RECIPE_URL_PATTERN = /fixmeadrinkapp\.com\/recipes\/([a-z0-9-]+)/i

/** The slug a query names: from a recipe URL, or the query itself. */
function requestedSlug(query: string) {
  return (query.match(RECIPE_URL_PATTERN)?.[1] ?? query).trim().toLowerCase()
}

/**
 * The catalogue entries that best answer a name, best first. An exact slug
 * or name wins; among equally good matches free recipes come first, then
 * popularity.
 */
function rankRecipes(query: string, catalogue: readonly RawPreview[]) {
  const slug = requestedSlug(query)
  const bySlug = catalogue.find((item) => item.slug?.toLowerCase() === slug)
  if (bySlug) return [bySlug]
  return catalogue
    .map((item, index) => ({ item, index, rank: nameRank(slug.replace(/-/g, ' '), item.name) }))
    .filter((entry) => entry.rank < NO_MATCH)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(b.item.isFree === true) - Number(a.item.isFree === true) ||
        a.index - b.index
    )
    .map((entry) => entry.item)
}

interface RecipeMatch {
  readonly best: RawPreview
  readonly others: readonly RawPreview[]
  readonly exact: boolean
}

async function findRecipe(up: Upstream, query: string): Promise<RecipeMatch> {
  let ranked = rankRecipes(query, await loadCatalogue(up))
  if (ranked.length === 0) {
    const params = new URLSearchParams({ query, pageSize: '10' })
    const found = await up.get<RawPreview[]>(`/cocktails/search?${params}`, HOUR)
    ranked = Array.isArray(found) ? found : []
  }
  const [best, ...others] = ranked
  if (!best) {
    throw new ToolInputError(
      `No cocktail called "${query}" in the Garçon catalogue. Check the spelling or try a shorter name.`
    )
  }
  const exact =
    best.slug?.toLowerCase() === requestedSlug(query) || normalize(best.name) === normalize(query)
  return { best, others, exact }
}

function closestMatchNote(query: string) {
  return `No recipe is named exactly "${query}". This is the closest match in the Garçon catalogue.`
}

interface FindArgs {
  readonly ingredients: readonly string[]
  readonly strength?: StrengthFilter
  readonly flavors?: readonly string[]
  readonly limit?: number
}

async function resolveTerms(up: Upstream, terms: readonly string[]) {
  const searched = new Set(terms.filter((term) => !resolveAlias(term)).slice(0, MAX_SEARCHES))
  const resolved = await Promise.all(
    terms.map(async (term) => {
      if (!searched.has(term)) return resolveAlias(term)
      return resolveFromSearch(term, await searchIngredients(up, term))
    })
  )
  const recognised: ResolvedTerm[] = []
  const notRecognised: string[] = []
  const notChecked: string[] = []
  resolved.forEach((item, index) => {
    if (!item) notChecked.push(terms[index])
    else if (item.matched_as.length === 0 && !item.could_be?.length) notRecognised.push(item.you_said)
    else recognised.push(item)
  })
  return { recognised, notRecognised, notChecked }
}

async function compareCandidates(
  up: Upstream,
  candidates: readonly Candidate[],
  bar: readonly ResolvedTerm[]
): Promise<Match[]> {
  const details = await Promise.all(
    candidates.map((candidate) => recipeBySlug(up, slugOf(candidate.preview)))
  )
  return details.flatMap((recipe, index) =>
    recipe && !recipe.isLocked
      ? [{ candidate: candidates[index], comparison: compareWithBar(recipe, bar) }]
      : []
  )
}

/** The most popular free low-proof recipes, ranked by what the bar is missing. */
async function popularLowProof(
  up: Upstream,
  bar: readonly ResolvedTerm[],
  flavors: readonly string[] | undefined,
  exclude: ReadonlySet<string>
): Promise<Match[]> {
  const candidates = (await loadCatalogue(up))
    .filter(
      (item) =>
        item.isFree === true &&
        isLowProof(item.strengthLevel) &&
        matchesFlavors(item.flavorNotes, flavors) &&
        !exclude.has(item.id)
    )
    .slice(0, POPULAR_LOW_PROOF_POOL)
    .map((preview, order) => ({ preview, order }))
  return rankMatches(await compareCandidates(up, candidates, bar))
}

function toMatchCard({ candidate, comparison }: Match): MatchCard {
  const card: MatchCard = {
    ...toCard(candidate.preview),
    have: comparison.have,
    missing: comparison.missing,
    can_make_now: comparison.missing.length === 0 && comparison.dependsOn.length === 0,
  }
  if (comparison.dependsOn.length) card.depends_on = comparison.dependsOn
  if (comparison.missingGarnish.length) card.missing_garnish = comparison.missingGarnish
  return card
}

/**
 * A photo URL the widget accepts. Catalogue file names can contain an
 * apostrophe ("2819-Buck's_Fizz.jpeg"), which the widget's URL check refuses
 * because it is unsafe inside an HTML attribute. The image host serves the
 * percent-encoded form as the same file, so encode instead of dropping it.
 */
export function widgetImageUrl(url: string): string | null {
  if (!url.startsWith(`${IMAGE_ORIGIN}/`)) return null
  try {
    const parsed = new URL(url)
    if (parsed.origin !== IMAGE_ORIGIN) return null
    return parsed.href.replace(/'/g, '%27')
  } catch {
    return null
  }
}

function imagesFor(matches: readonly Match[]) {
  const entries: [string, string][] = []
  for (const match of matches) {
    const image = match.candidate.preview.imageUrl && widgetImageUrl(match.candidate.preview.imageUrl)
    if (image) entries.push([recipeUrl(slugOf(match.candidate.preview)), image])
  }
  return Object.fromEntries(entries)
}

export async function findCocktails(up: Upstream, args: FindArgs): Promise<ToolOutput<FindOutput>> {
  const terms = cleanTerms(args.ingredients).slice(0, MAX_TERMS)
  if (terms.length === 0) {
    throw new ToolInputError('List at least one bottle or ingredient, for example ["gin", "lime", "sugar"].')
  }
  const limit = args.limit ?? 5
  const { recognised, notRecognised, notChecked } = await resolveTerms(up, terms)

  const output: FindOutput = {
    bar: { recognised, not_recognised: notRecognised, assumed_staples: [...STAPLES] },
    cocktails: [],
    low_proof_options: [],
    more_ideas_url: BY_INGREDIENTS_TOOL_URL,
  }
  if (notChecked.length) output.bar.not_checked = notChecked

  if (recognised.length === 0) {
    output.note =
      'None of those matched an ingredient in the Garçon catalogue. Try common names such as "gin", "lime juice" or "sweet vermouth".'
    return { structured: output, text: findText(output) }
  }

  const apiBar = [
    ...new Set([...recognised.flatMap((item) => [...item.matched_as, ...(item.could_be ?? [])]), ...STAPLES]),
  ].sort()
  const groups =
    (await up.post<RawMatchGroups>('/cocktails/matches', { ingredients: apiBar }, HOUR)) ?? {}
  const compare = (batch: readonly GroupCandidate[]) => compareCandidates(up, batch, recognised)
  // No recipe can own more distinct ingredients than the bar can cover.
  const ceiling = haveCeiling(recognised)

  const main = await bestMatches(
    candidatesFromGroups(groups, { strength: args.strength, flavors: args.flavors }),
    limit,
    MAX_CHECKED,
    compare,
    ceiling
  )
  let cocktails = main.matches
  if (!main.complete) output.partial = true
  let lowProof: Match[] = []

  if (args.strength === 'zero_or_low') {
    if (cocktails.length === 0) {
      cocktails = (await popularLowProof(up, recognised, args.flavors, new Set())).slice(0, limit)
      output.note =
        'No low or zero-proof recipe uses your bar, so these are popular low-proof drinks with what you would need to buy.'
    }
  } else {
    const shown = new Set(cocktails.map((match) => match.candidate.preview.id))
    try {
      const low = await bestMatches(
        candidatesFromGroups(groups, { strength: 'zero_or_low', flavors: args.flavors }).filter(
          (candidate) => !shown.has(candidate.preview.id)
        ),
        LOW_PROOF_SHOWN,
        MAX_CHECKED_LOW_PROOF,
        compare,
        ceiling
      )
      lowProof = low.matches
      if (!low.complete) output.partial = true
      if (lowProof.length === 0) {
        lowProof = (await popularLowProof(up, recognised, args.flavors, shown)).slice(0, LOW_PROOF_SHOWN)
      }
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error
      output.unavailable = ['low_proof_options']
    }
  }

  output.cocktails = cocktails.map(toMatchCard)
  output.low_proof_options = lowProof.map(toMatchCard)
  if (output.cocktails.length === 0 && !output.note) {
    output.note =
      args.strength || args.flavors?.length
        ? 'No free recipe matched both your bar and those filters. Try without the filters.'
        : 'No free recipe uses those ingredients yet. Adding a base spirit, a citrus and a sweetener opens up the most drinks.'
  }
  return {
    structured: output,
    text: findText(output),
    meta: { images: imagesFor([...cocktails, ...lowProof]) },
  }
}

function cardLine(card: MatchCard) {
  const parts: string[] = []
  if (card.can_make_now) parts.push('can make now')
  if (card.missing.length) parts.push(`missing ${card.missing.join(', ')}`)
  for (const dependency of card.depends_on ?? []) {
    parts.push(`only if your ${dependency.you_said} is ${dependency.ingredient}`)
  }
  return `- ${card.name} (${card.strength}): ${parts.join('; ')}. ${card.url}`
}

function termLine(item: ResolvedTerm) {
  const definite = item.matched_as.join(item.single_bottle ? ' or ' : ' / ')
  const vague = item.could_be?.length ? `one bottle of ${item.could_be.join(' or ')} (not assumed)` : ''
  return `${item.you_said} -> ${[definite, vague].filter(Boolean).join(', or ')}`
}

function findText(output: FindOutput) {
  const { bar } = output
  const lines: string[] = []
  const recognised = bar.recognised.map(termLine)
  if (recognised.length) lines.push(`Your bar: ${recognised.join('; ')}.`)
  if (bar.not_recognised.length) lines.push(`Not recognised: ${bar.not_recognised.join(', ')}.`)
  if (bar.not_checked?.length) {
    lines.push(`Not looked up (${MAX_SEARCHES} unfamiliar names per request): ${bar.not_checked.join(', ')}.`)
  }
  if (output.note) lines.push(output.note)
  if (output.cocktails.length) lines.push('Drinks, closest first:', ...output.cocktails.map(cardLine))
  if (output.low_proof_options.length) {
    lines.push('Low or zero-proof options:', ...output.low_proof_options.map(cardLine))
  }
  if (output.unavailable) lines.push('Low or zero-proof options could not be loaded this time.')
  if (output.partial) {
    lines.push(
      `Garçon compared up to ${MAX_CHECKED} recipes (${MAX_CHECKED_LOW_PROOF} low or zero-proof) for this answer, so others might match as well.`
    )
  }
  lines.push(`More ideas: ${output.more_ideas_url}`)
  return lines.join('\n')
}

export async function getRecipe(up: Upstream, args: { name: string }): Promise<ToolOutput<RecipeOutput>> {
  const { best, others, exact } = await findRecipe(up, args.name)
  const raw = await recipeBySlug(up, slugOf(best))
  if (!raw) throw new ToolInputError(`The recipe page for "${best.name}" is not available right now.`)

  const output = toRecipe(raw)
  if (!exact) {
    output.note = closestMatchNote(args.name)
    if (others.length) {
      output.other_matches = others.slice(0, 3).map((item) => ({ name: item.name, url: recipeUrl(slugOf(item)) }))
    }
  }
  if (raw.isLocked) {
    try {
      const free = (await similarTo(up, raw.id)).filter((item) => item.isFree === true)
      if (free.length) output.free_alternatives = free.slice(0, 3).map(toCard)
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error
      output.unavailable = ['free_alternatives']
    }
  }

  const lines = output.note ? [output.note, recipeText(output)] : [recipeText(output)]
  if (output.free_alternatives) {
    lines.push('Free recipes like it:', ...output.free_alternatives.map((card) => `- ${card.name}: ${card.url}`))
  }
  if (output.unavailable) lines.push('Free recipes like it could not be loaded this time.')
  if (output.other_matches) {
    lines.push(`Other matches: ${output.other_matches.map((match) => match.name).join(', ')}`)
  }
  return { structured: output, text: lines.join('\n') }
}

function similarCard(preview: RawPreview): SimilarCard {
  return { ...toCard(preview), full_recipe_public: preview.isFree === true }
}

/** Free low-proof recipes that share a flavour or the base spirit, closest first. */
function lowProofLike(catalogue: readonly RawPreview[], source: RawPreview) {
  const flavors = new Set((source.flavorNotes ?? []).map(normalize))
  return catalogue
    .filter((item) => item.isFree === true && isLowProof(item.strengthLevel) && item.id !== source.id)
    .map((item, index) => ({
      item,
      index,
      score:
        (item.flavorNotes ?? []).filter((note) => flavors.has(normalize(note))).length +
        (item.baseSpirit && item.baseSpirit === source.baseSpirit ? 1 : 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item)
}

function uniqueById(items: readonly RawPreview[]) {
  return items.filter((item, index) => items.findIndex((other) => other.id === item.id) === index)
}

export async function suggestSimilar(
  up: Upstream,
  args: { name: string; low_proof?: boolean }
): Promise<ToolOutput<SimilarOutput>> {
  const { best: source, exact } = await findRecipe(up, args.name)
  const [similar, catalogue] = await Promise.all([similarTo(up, source.id), loadCatalogue(up)])
  const lowProof = lowProofLike(catalogue, source)

  const output: SimilarOutput = {
    source: { name: source.name, url: recipeUrl(slugOf(source)) },
    suggestions: [],
    low_proof_options: [],
  }
  if (!exact) output.note = closestMatchNote(args.name)
  if (args.low_proof) {
    const suggestions = uniqueById([...similar.filter((item) => isLowProof(item.strengthLevel)), ...lowProof])
    output.suggestions = suggestions.slice(0, MAX_SUGGESTIONS).map(similarCard)
  } else {
    // Free recipes first: their full recipe is public.
    const suggestions = [...similar]
      .sort((a, b) => Number(b.isFree === true) - Number(a.isFree === true))
      .slice(0, MAX_SUGGESTIONS)
    const shown = new Set(suggestions.map((item) => item.id))
    output.suggestions = suggestions.map(similarCard)
    output.low_proof_options = lowProof.filter((item) => !shown.has(item.id)).slice(0, LOW_PROOF_SHOWN).map(similarCard)
  }

  const kind = args.low_proof ? 'Low or zero-proof drinks' : 'Drinks'
  const lines = output.note ? [output.note] : []
  lines.push(`${kind} like ${output.source.name} (${output.source.url}):`)
  for (const card of output.suggestions) {
    const flavors = card.flavors.join(', ') || 'no notes'
    lines.push(`- ${card.name} (${card.strength}, ${flavors}): ${card.url}${card.full_recipe_public ? '' : ' [premium recipe]'}`)
  }
  if (output.suggestions.length === 0) lines.push('None found in the Garçon catalogue.')
  if (output.low_proof_options.length) {
    lines.push(
      'Low or zero-proof options with shared flavours:',
      ...output.low_proof_options.map((card) => `- ${card.name}: ${card.url}`)
    )
  }
  return { structured: output, text: lines.join('\n') }
}

export async function explainTerm(up: Upstream, args: { term: string }): Promise<ToolOutput<ExplainOutput>> {
  const [glossary, pages] = await Promise.all([
    up.get<RawGlossaryPreview[]>('/glossary', DAY),
    up.get<RawIngredientPagePreview[]>('/ingredient-pages', DAY),
  ])
  const glossaryList = Array.isArray(glossary) ? glossary : []
  const pageList = Array.isArray(pages) ? pages : []
  const hits = findTerms(args.term, glossaryList, pageList)
  const best = hits[0]
  if (!best) {
    const close = closeNames(args.term, glossaryList, pageList)
    throw new ToolInputError(
      `Garçon has no page for "${args.term}" yet.${close.length ? ` Close matches: ${close.join(', ')}.` : ''}`
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
