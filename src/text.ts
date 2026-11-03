// Text normalization and fuzzy name ranking, shared by the ingredient, recipe
// and glossary lookups. Ported from the website's cocktail-by-ingredients
// ranking (fix-me-a-drink-web/lib/free-tools/cocktail-by-ingredients-api.ts).

export function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function tokens(value: string) {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length > 0)
}

/** A best-guess URL slug from a name ("Gin & French" -> "gin-and-french"). */
export function slugify(value: string) {
  return normalize(value).replace(/ /g, '-')
}

export const NO_MATCH = 9

/** A name without qualifiers: "The Original Margarita" -> "margarita". */
function coreName(name: string) {
  return normalize(name.replace(/\([^)]*\)/g, ' '))
    .replace(/^(the original|the classic|classic|original|the) /, '')
    .replace(/ cocktail$/, '')
}

/**
 * How well `name` (plus optional extra searchable text, such as a category or
 * aliases) answers `query`. 0 is an exact match, 9 is no match.
 */
export function nameRank(query: string, name: string, extra: readonly string[] = []) {
  const q = normalize(query)
  const n = normalize(name)
  if (!q || !n) return NO_MATCH
  if (n === q) return 0
  const normalizedExtra = extra.map(normalize).filter(Boolean)
  if (normalizedExtra.includes(q)) return 1
  // 1 too: the name is the query plus a qualifier, the way the catalogue
  // names classics ("Manhattan (Sweet)", "The Original Margarita").
  if (coreName(name) === q) return 1

  // 2: every query word is a whole word of the name ("dry gin" for "gin",
  // "Daiquiri No. 2" for "daiquiri"). Ties here are broken by the caller.
  const queryTokens = tokens(query)
  const nameWords = n.split(' ')
  if (queryTokens.every((token) => nameWords.includes(token))) return 2
  // 3: the name starts with the query as a partial word ("daiq").
  if (n.startsWith(q)) return 3
  // 4: every query word appears inside the name ("gin" in "Ginger").
  if (queryTokens.every((token) => n.includes(token))) return 4

  const searchable = [n, ...normalizedExtra].join(' ')
  if (queryTokens.every((token) => searchable.includes(token))) return 5
  if (
    queryTokens.length > 1 &&
    queryTokens.filter((token) => nameWords.some((word) => word.startsWith(token)))
      .length >= Math.ceil(queryTokens.length / 2)
  ) {
    return 6
  }
  return NO_MATCH
}

/** Items ranked by `nameRank`, best first, ties kept in input order. */
export function rankByName<T>(
  query: string,
  items: readonly T[],
  getName: (item: T) => string,
  getExtra: (item: T) => readonly string[] = () => []
) {
  return items
    .map((item, index) => ({
      item,
      index,
      rank: nameRank(query, getName(item), getExtra(item)),
    }))
    .filter((entry) => entry.rank < NO_MATCH)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
}
