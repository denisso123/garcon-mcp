// Turns what people type ("gin", "limes", "simple syrup") into the exact
// ingredient names the recipe catalogue uses ("London dry gin", "Lime Juice",
// "Rich Simple (2:1) syrup"). The matches endpoint compares names exactly and
// case-sensitively, so this step decides the quality of every result.
//
// Order: a curated alias table for the common home-bar words (built from the
// ingredient frequencies of the 250 most popular free recipes), then the
// API's ingredient search, re-ranked with the website's ranking rules.

import type { RawIngredientOption } from './api-types'
import { normalize, rankByName } from './text'

// Each alias maps to catalogue names, most common first. A generic word
// expands to the variants a recipe is likely to call for: someone with "gin"
// can make a recipe that asks for London dry gin or dry gin.
const ALIASES: Record<string, readonly string[]> = {
  gin: ['London dry gin', 'Dry gin'],
  'london dry gin': ['London dry gin', 'Dry gin'],
  'dry gin': ['Dry gin', 'London dry gin'],
  'old tom gin': ['Old Tom gin'],
  vodka: ['Vodka'],
  rum: ['Light rum', 'Rum', 'Gold rum'],
  'white rum': ['Light rum', 'Rum'],
  'light rum': ['Light rum', 'Rum'],
  'silver rum': ['Light rum', 'Rum'],
  'dark rum': ['Gold rum', 'Rum'],
  'gold rum': ['Gold rum', 'Rum'],
  'aged rum': ['Gold rum', 'Rum'],
  'spiced rum': ['Spiced rum'],
  tequila: ['Tequila blanco', 'Tequila reposado'],
  'blanco tequila': ['Tequila blanco'],
  'silver tequila': ['Tequila blanco'],
  'tequila blanco': ['Tequila blanco'],
  'reposado tequila': ['Tequila reposado'],
  mezcal: ['Mezcal'],
  whiskey: ['Bourbon whiskey', 'Rye whiskey'],
  whisky: ['Blended scotch whisky', 'Bourbon whiskey'],
  bourbon: ['Bourbon whiskey'],
  rye: ['Rye whiskey'],
  'rye whiskey': ['Rye whiskey'],
  scotch: ['Blended scotch whisky', 'Single malt scotch whisky'],
  'scotch whisky': ['Blended scotch whisky', 'Single malt scotch whisky'],
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
  vermouth: ['Sweet vermouth', 'Dry vermouth'],
  'sweet vermouth': ['Sweet vermouth'],
  'red vermouth': ['Sweet vermouth'],
  'rosso vermouth': ['Sweet vermouth'],
  'dry vermouth': ['Dry vermouth'],
  'triple sec': ['Triple sec'],
  cointreau: ['Triple sec'],
  'orange liqueur': ['Triple sec', 'Cognac orange liqueur'],
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
}

// Things every kitchen has. They are added to every bar and never reported
// as missing; the result says they were assumed.
export const STAPLES: readonly string[] = ['Chilled water', 'Saline solution 4:1']

const STAPLE_KEYS = new Set(
  [...STAPLES, 'Water', 'Ice', 'Crushed ice', 'Ice cubes'].map(normalize)
)

export function isStaple(name: string) {
  return STAPLE_KEYS.has(normalize(name))
}

/** Catalogue names for a term from the alias table, or null. */
export function aliasFor(term: string): readonly string[] | null {
  const key = normalize(term.replace(/['’]/g, ''))
  return ALIASES[key] ?? ALIASES[key.replace(/s$/, '')] ?? null
}

/**
 * The best catalogue names for a term among search results, best first.
 * Keeps exact and near matches only, so "gin" does not pull in "Ginger".
 */
export function pickFromSearch(
  term: string,
  options: readonly RawIngredientOption[],
  max = 2
): string[] {
  const ranked = rankByName(term, options, (option) => option.name, (option) =>
    [option.category ?? ''].filter(Boolean)
  )
  if (ranked.length === 0) return []
  const best = ranked[0].rank
  // Accept up to `max` names that rank as well as the best one (plus one
  // step), and never anything weaker than "all words in the name".
  return ranked
    .filter((entry) => entry.rank <= Math.min(best + 1, 4))
    .slice(0, max)
    .map((entry) => entry.item.name)
}

export interface ResolvedTerm {
  readonly you_said: string
  readonly matched_as: string[]
}

/** Dedupe and trim the terms someone typed, keeping their order. */
export function cleanTerms(terms: readonly string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of terms) {
    // People paste "gin, lime and sugar" as one item; split it, but keep
    // names that contain "and" ("half and half") whole.
    const parts = aliasFor(raw) ? [raw] : raw.split(/,|;|\n|\band\b|\+/i)
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
