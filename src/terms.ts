// Finds and summarizes a bar term: an ingredient page (spirits, liqueurs,
// mixers...) or a glossary term (techniques, glassware, tools, styles).
// Pure: the lists and detail objects come from the API via service.ts.

import type {
  RawGlossaryPreview,
  RawGlossaryTerm,
  RawIngredientPage,
  RawIngredientPagePreview,
} from './api-types'
import { glossaryUrl, ingredientUrl } from './site'
import { NO_MATCH, nameRank, normalize } from './text'

export type TermHit =
  | { readonly kind: 'ingredient'; readonly rank: number; readonly page: RawIngredientPagePreview }
  | { readonly kind: 'glossary'; readonly rank: number; readonly term: RawGlossaryPreview }

function strip(value: string) {
  // "what is a coupe glass?" -> "coupe glass"
  return value
    .replace(/[?!.]+$/g, '')
    .replace(/^(what('s| is| are)?|explain|define|tell me about|how (do|to) (i )?)\s+/i, '')
    .replace(/^(a|an|the)\s+/i, '')
    .trim()
}

/** Every hit for a query, best first. Ingredient pages win ties. */
export function findTerms(
  query: string,
  glossary: readonly RawGlossaryPreview[],
  pages: readonly RawIngredientPagePreview[]
): TermHit[] {
  const q = strip(query)
  const hits: TermHit[] = []
  for (const page of pages) {
    const rank = nameRank(q, page.name, [...(page.aliases ?? []), page.slug.replace(/-/g, ' ')])
    if (rank < NO_MATCH) hits.push({ kind: 'ingredient', rank, page })
  }
  for (const term of glossary) {
    const rank = nameRank(q, term.name, [...(term.aliases ?? []), term.slug.replace(/-/g, ' ')])
    if (rank < NO_MATCH) hits.push({ kind: 'glossary', rank, term })
  }
  return hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.kind === b.kind ? 0 : a.kind === 'ingredient' ? -1 : 1) ||
      hitName(a).length - hitName(b).length
  )
}

export function hitName(hit: TermHit) {
  return hit.kind === 'ingredient' ? hit.page.name : hit.term.name
}

export function hitUrl(hit: TermHit) {
  return hit.kind === 'ingredient' ? ingredientUrl(hit.page.slug) : glossaryUrl(hit.term.slug)
}

export interface TermOutput {
  name: string
  kind: string
  url: string
  definition: string
  details: { label: string; value: string }[]
  how_to?: { question: string; steps: string[] }
  substitutes?: { name: string; note?: string; zero_proof: boolean; url?: string }[]
  related: { name: string; url: string }[]
  example_cocktails?: { name: string; url: string }[]
}

// Inline glossary markup: [[term:slug|Text]], [[ingredient:slug]] -> text.
export function plainText(value: string | undefined) {
  return (value ?? '')
    .replace(/\[\[[a-z]+:([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[[a-z]+:([^\]|]+)\]\]/g, (_, slug: string) => slug.replace(/-/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

const ARCHETYPE_LABEL: Record<string, string> = {
  SPIRIT: 'spirit',
  LIQUEUR: 'liqueur',
  APERITIVO_AMARO: 'aperitivo or amaro',
  FORTIFIED_WINE: 'fortified wine',
  WINE_BEER: 'wine or beer',
  BITTERS: 'bitters',
  SYRUP: 'syrup',
  JUICE: 'juice',
  MIXER: 'mixer',
  PRODUCE: 'produce',
  HERB: 'herb',
  SPICE: 'spice',
  GARNISH: 'garnish',
  DAIRY_EGG: 'dairy or egg',
  COFFEE_TEA: 'coffee or tea',
  PANTRY: 'pantry item',
}

export function ingredientTerm(
  page: RawIngredientPage,
  pageNames: ReadonlyMap<string, string>,
  exampleCocktails: { name: string; url: string }[]
): TermOutput {
  const content = page.content ?? {}
  const details: { label: string; value: string }[] = []
  if (content.taste?.summary) details.push({ label: 'Taste', value: plainText(content.taste.summary) })
  if (content.madeFrom) details.push({ label: 'Made from', value: plainText(content.madeFrom) })
  const abv = content.numbers
  if (abv?.abvMin && abv?.abvMax) {
    details.push({
      label: 'Typical ABV',
      value: abv.abvMin === abv.abvMax ? `${abv.abvMin}%` : `${abv.abvMin} to ${abv.abvMax}%`,
    })
  }
  if (content.shelfLife?.opened) {
    details.push({ label: 'Once opened', value: plainText(content.shelfLife.opened) })
  }
  if (content.types?.length) {
    details.push({
      label: 'Styles',
      value: content.types.slice(0, 6).map((type) => type.label).join(', '),
    })
  }

  const output: TermOutput = {
    name: page.name,
    kind: ARCHETYPE_LABEL[page.archetype ?? ''] ?? 'ingredient',
    url: ingredientUrl(page.slug),
    definition: plainText(page.definition),
    details,
    related: [
      ...(page.parent ? [page.parent] : []),
      ...(page.children ?? []).slice(0, 5),
    ].map((item) => ({ name: item.name, url: ingredientUrl(item.slug) })),
  }

  const substitutes = (content.substitutes ?? [])
    .slice()
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .slice(0, 4)
    .map((sub) => {
      const name = sub.label ?? (sub.pageSlug ? pageNames.get(sub.pageSlug) : undefined) ?? sub.pageSlug?.replace(/-/g, ' ')
      if (!name) return null
      const item: { name: string; note?: string; zero_proof: boolean; url?: string } = {
        name,
        zero_proof: sub.zeroProof === true,
      }
      if (sub.note) item.note = plainText(sub.note)
      if (sub.pageSlug && pageNames.has(sub.pageSlug)) item.url = ingredientUrl(sub.pageSlug)
      return item
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
  if (substitutes.length) output.substitutes = substitutes
  if (exampleCocktails.length) output.example_cocktails = exampleCocktails
  return output
}

export function glossaryTerm(term: RawGlossaryTerm): TermOutput {
  const content = term.content ?? {}
  const explanation = (content.explanation ?? []).map(plainText).filter(Boolean)
  const output: TermOutput = {
    name: term.name,
    kind: term.type,
    url: glossaryUrl(term.slug),
    definition: plainText(term.shortDefinition),
    details: [
      ...(term.pronunciation ? [{ label: 'Say it', value: term.pronunciation }] : []),
      ...(term.facts ?? []).slice(0, 5).map((fact) => ({
        label: fact.label,
        value: plainText(fact.value),
      })),
      ...(explanation[0] ? [{ label: 'More', value: explanation[0] }] : []),
    ],
    related: (term.relatedTerms ?? []).slice(0, 5).map((related) => ({
      name: related.name,
      url: glossaryUrl(related.slug),
    })),
  }
  const steps = (content.how?.steps ?? [])
    .map((step) => plainText(step.text))
    .filter(Boolean)
    .map((step) => step.charAt(0).toUpperCase() + step.slice(1))
  if (content.how?.question && steps.length) {
    output.how_to = { question: content.how.question, steps: steps.slice(0, 6) }
  }
  return output
}

/** "Did you mean" names for a query that matched nothing well. */
export function closeNames(
  query: string,
  glossary: readonly RawGlossaryPreview[],
  pages: readonly RawIngredientPagePreview[]
) {
  const first = normalize(strip(query)).split(' ')[0] ?? ''
  if (first.length < 3) return []
  const prefix = first.slice(0, 3)
  return [...pages.map((page) => page.name), ...glossary.map((term) => term.name)]
    .filter((name) => normalize(name).split(' ').some((word) => word.startsWith(prefix)))
    .slice(0, 5)
}
