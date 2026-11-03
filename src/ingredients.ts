// Turns what people type ("gin", "limes", "simple syrup") into the exact
// ingredient names the recipe catalogue uses ("London dry gin", "Lime Juice",
// "Rich Simple (2:1) syrup"). The matches endpoint compares names exactly and
// case-sensitively, so this step decides the quality of every result.
//
// Order: a curated alias table for the common home-bar words (built from the
// ingredient frequencies of the 250 most popular free recipes), then the
// API's ingredient search, re-ranked with the website's ranking rules.

import type { RawIngredientOption } from './api-types'
import type { ResolvedTerm } from './schemas'
import { NO_MATCH, normalize, rankByName } from './text'

// Each alias maps to catalogue names, most common first. Several names are
// the same thing under two catalogue names ("gin": London dry or dry gin;
// "white rum": light rum or rum; "bitters": Angostura or aromatic bitters)
// or forms one purchase gives ("limes": juice and a wedge; "sugar", "honey"
// and "coffee": the syrups or brews made from them), so the bar owns all of
// them. Exceptions: SUBSTITUTES below, and ONE_BOTTLE for words whose kind is
// unknown. Every multi-name word belongs to exactly one of these groups.
const ALIASES = new Map<string, readonly string[]>(
  Object.entries({
    gin: ['London dry gin', 'Dry gin'],
    'london dry gin': ['London dry gin', 'Dry gin'],
    'dry gin': ['Dry gin', 'London dry gin'],
    'old tom gin': ['Old Tom gin'],
    vodka: ['Vodka'],
    'white rum': ['Light rum', 'Rum'],
    'light rum': ['Light rum', 'Rum'],
    'silver rum': ['Light rum', 'Rum'],
    'dark rum': ['Gold rum', 'Rum'],
    'gold rum': ['Gold rum', 'Rum'],
    'aged rum': ['Gold rum', 'Rum'],
    'spiced rum': ['Spiced rum'],
    'blanco tequila': ['Tequila blanco'],
    'silver tequila': ['Tequila blanco'],
    'tequila blanco': ['Tequila blanco'],
    'reposado tequila': ['Tequila reposado'],
    mezcal: ['Mezcal'],
    bourbon: ['Bourbon whiskey'],
    rye: ['Rye whiskey'],
    'rye whiskey': ['Rye whiskey'],
    'irish whiskey': ['Irish whiskey'],
    brandy: ['Cognac'],
    cognac: ['Cognac'],
    'apple brandy': ['Apple brandy'],
    calvados: ['Apple brandy'],
    pisco: ['Pisco'],
    cachaca: ['Cachaca'],
    lime: ['Lime Juice', 'Lime'],
    limes: ['Lime Juice', 'Lime'],
    'lime juice': ['Lime Juice'],
    lemon: ['Lemon Juice', 'Lemon'],
    lemons: ['Lemon Juice', 'Lemon'],
    'lemon juice': ['Lemon Juice'],
    'orange juice': ['Orange Juice'],
    oj: ['Orange Juice'],
    'grapefruit juice': ['Grapefruit Juice'],
    'pineapple juice': ['Pineapple Juice'],
    'cranberry juice': ['Cranberry Juice'],
    'apple juice': ['Apple Juice'],
    'simple syrup': ['Rich Simple (2:1) syrup', 'Plain Simple'],
    'sugar syrup': ['Rich Simple (2:1) syrup', 'Plain Simple'],
    'rich simple syrup': ['Rich Simple (2:1) syrup'],
    sugar: ['Rich Simple (2:1) syrup', 'Plain Simple', 'Sugar'],
    honey: ['Honey syrup (3:1)', 'Honey'],
    agave: ['Agave'],
    'agave syrup': ['Agave'],
    'agave nectar': ['Agave'],
    'maple syrup': ['Maple'],
    grenadine: ['Grenadine syrup'],
    bitters: ['Angostura', 'Aromatic Bitters'],
    angostura: ['Angostura'],
    'angostura bitters': ['Angostura'],
    'aromatic bitters': ['Aromatic Bitters', 'Angostura'],
    'orange bitters': ['Orange bitters'],
    'peychauds bitters': ["Peychaud's bitters"],
    peychauds: ["Peychaud's bitters"],
    'sweet vermouth': ['Sweet vermouth'],
    'red vermouth': ['Sweet vermouth'],
    'rosso vermouth': ['Sweet vermouth'],
    'dry vermouth': ['Dry vermouth'],
    'triple sec': ['Triple sec'],
    cointreau: ['Triple sec'],
    'grand marnier': ['Cognac orange liqueur'],
    curacao: ['Orange Curacao'],
    'blue curacao': ['Blue Curacao'],
    campari: ['Red Bitter Liqueur'],
    aperol: ['Aperol'],
    'coffee liqueur': ['Coffee liqueur'],
    kahlua: ['Coffee liqueur'],
    amaretto: ['Disaronno'],
    disaronno: ['Disaronno'],
    'elderflower liqueur': ['Elderflower liqueur'],
    'st germain': ['Elderflower liqueur'],
    'maraschino liqueur': ['Maraschino liqueur'],
    maraschino: ['Maraschino liqueur'],
    chartreuse: ['Green Chartreuse'],
    'green chartreuse': ['Green Chartreuse'],
    benedictine: ['Bénédictine'],
    absinthe: ['Absinthe'],
    'soda water': ['Soda Water'],
    soda: ['Soda Water'],
    'club soda': ['Soda Water'],
    'sparkling water': ['Soda Water'],
    seltzer: ['Soda Water'],
    tonic: ['Tonic Water'],
    'tonic water': ['Tonic Water'],
    'ginger beer': ['Ginger Beer'],
    'ginger ale': ['Ginger Ale'],
    cola: ['Cola'],
    coke: ['Cola'],
    prosecco: ['Brut champagne/sparkling wine'],
    champagne: ['Brut champagne/sparkling wine'],
    cava: ['Brut champagne/sparkling wine'],
    'sparkling wine': ['Brut champagne/sparkling wine'],
    'white wine': ['White wine'],
    egg: ['Egg White'],
    eggs: ['Egg White'],
    'egg white': ['Egg White'],
    'egg whites': ['Egg White'],
    mint: ['Mint leaves'],
    'mint leaves': ['Mint leaves'],
    cream: ['Half & Half', 'Heavy Cream'],
    'heavy cream': ['Heavy Cream', 'Half & Half'],
    'half and half': ['Half & Half'],
    'coconut water': ['Coconut water'],
    espresso: ['Espresso'],
    coffee: ['Espresso', 'Filter Coffee'],
  })
)

// Words for one bottle whose kind the word does not say. "Vermouth" is sweet
// or dry, never both, so a recipe that needs one of them depends on which
// bottle it is: it is shown as conditional, never as owned. `names` are what
// the word covers whatever the bottle is ("rum" covers a recipe asking for
// plain rum).
const ONE_BOTTLE = new Map<string, { readonly names: readonly string[]; readonly oneOf: readonly string[] }>(
  Object.entries({
    rum: { names: ['Rum'], oneOf: ['Light rum', 'Gold rum'] },
    tequila: { names: [], oneOf: ['Tequila blanco', 'Tequila reposado'] },
    whiskey: { names: [], oneOf: ['Bourbon whiskey', 'Rye whiskey'] },
    whisky: { names: [], oneOf: ['Blended scotch whisky', 'Bourbon whiskey'] },
    vermouth: { names: [], oneOf: ['Sweet vermouth', 'Dry vermouth'] },
    scotch: { names: [], oneOf: ['Blended scotch whisky', 'Single malt scotch whisky'] },
    'scotch whisky': { names: [], oneOf: ['Blended scotch whisky', 'Single malt scotch whisky'] },
    'orange liqueur': { names: [], oneOf: ['Triple sec', 'Cognac orange liqueur'] },
  })
)

// Words for one bottle that does the job of any of its names, so it is owned,
// but only once per recipe: one bottle of simple syrup is rich or plain, so
// a recipe asking for both still misses one.
const SUBSTITUTES = new Set(['simple syrup', 'sugar syrup', 'cream', 'heavy cream'])

// Things every kitchen has. They are added to every bar and never reported
// as missing; the result says they were assumed.
export const STAPLES: readonly string[] = ['Chilled water', 'Saline solution 4:1']

const STAPLE_KEYS = new Set(STAPLES.map(normalize))

export function isStaple(name: string) {
  return STAPLE_KEYS.has(normalize(name))
}

function aliasKey(term: string) {
  return normalize(term.replace(/['’]/g, ''))
}

function lookup<T>(table: ReadonlyMap<string, T>, term: string) {
  const key = aliasKey(term)
  return table.get(key) ?? table.get(key.replace(/s$/, ''))
}

function isKnownWord(term: string) {
  return Boolean(lookup(ALIASES, term) ?? lookup(ONE_BOTTLE, term))
}

function resolved(
  term: string,
  names: readonly string[],
  couldBe: readonly string[] = [],
  singleBottle = false
): ResolvedTerm {
  const result: ResolvedTerm = { you_said: term, matched_as: [...names] }
  if (couldBe.length) result.could_be = [...couldBe]
  if (singleBottle && names.length > 1) result.single_bottle = true
  return result
}

/** A term resolved through the alias tables, or null when it has no alias. */
export function resolveAlias(term: string): ResolvedTerm | null {
  const bottle = lookup(ONE_BOTTLE, term)
  if (bottle) return resolved(term, bottle.names, bottle.oneOf)
  const names = lookup(ALIASES, term)
  if (!names) return null
  const key = aliasKey(term)
  return resolved(term, names, [], SUBSTITUTES.has(key) || SUBSTITUTES.has(key.replace(/s$/, '')))
}

/**
 * The best catalogue names for a term among search results, best first.
 * Keeps exact and near matches only, so "gin" does not pull in "Ginger".
 */
export function resolveFromSearch(
  term: string,
  options: readonly RawIngredientOption[]
): ResolvedTerm {
  const ranked = rankByName(term, options, (option) => option.name, (option) =>
    [option.category ?? ''].filter(Boolean)
  )
  const best = ranked[0]?.rank ?? NO_MATCH
  // Up to two names that rank as well as the best one (plus one step), and
  // never anything weaker than "all words in the name". A clear winner is
  // what the word means; a runner-up, or two names tied for first, could be
  // the bottle but are not assumed.
  const near = ranked.filter((entry) => entry.rank <= Math.min(best + 1, 4)).slice(0, 2)
  if (near.length === 2 && near[0].rank === near[1].rank) {
    return resolved(term, [], near.map((entry) => entry.item.name))
  }
  return resolved(
    term,
    near.slice(0, 1).map((entry) => entry.item.name),
    near.slice(1).map((entry) => entry.item.name)
  )
}

/** Dedupe and trim the terms someone typed, keeping their order. */
export function cleanTerms(terms: readonly string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of terms) {
    // People paste "gin, lime and sugar" as one item; split it, but keep
    // names that contain "and" ("half and half") whole.
    const parts = isKnownWord(raw) ? [raw] : raw.split(/,|;|\n|\band\b|\+/i)
    for (const part of parts) {
      const term = part.trim().replace(/\s+/g, ' ')
      const key = normalize(term)
      if (!key || seen.has(key)) continue
      seen.add(key)
      result.push(term)
    }
  }
  return result
}
