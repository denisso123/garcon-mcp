// Public URLs and fixed copy. Every link the server returns points at the
// canonical fixmeadrinkapp.com page for the recipe, ingredient or term.

export const SITE_URL = 'https://fixmeadrinkapp.com'
export const API_BASE_URL = 'https://fix-me-a-drink-api.fly.dev/api/v1'
export const MCP_ORIGIN = 'https://mcp.fixmeadrinkapp.com'
export const IMAGE_ORIGIN = 'https://images.fixmeadrinkapp.com'

export const PRIVACY_URL = `${MCP_ORIGIN}/privacy`
export const SITE_PRIVACY_URL = `${SITE_URL}/privacy-policy`
export const TERMS_URL = `${SITE_URL}/terms-of-service`
export const SUPPORT_URL = `${SITE_URL}/support`
export const SUPPORT_EMAIL = 'hey@blankpage-studio.com'
export const BY_INGREDIENTS_TOOL_URL = `${SITE_URL}/free-tools/cocktail-by-ingredients`

export const SERVER_NAME = 'ask-garcon'
export const SERVER_TITLE = 'Ask Garçon'
export const SERVER_VERSION = '1.0.0'

export const AGE_NOTE = 'For adults of legal drinking age. Please drink responsibly.'

export function recipeUrl(slug: string) {
  return `${SITE_URL}/recipes/${encodeURIComponent(slug)}`
}

export function ingredientUrl(slug: string) {
  return `${SITE_URL}/ingredients/${encodeURIComponent(slug)}`
}

export function glossaryUrl(slug: string) {
  return `${SITE_URL}/glossary/${encodeURIComponent(slug)}`
}
