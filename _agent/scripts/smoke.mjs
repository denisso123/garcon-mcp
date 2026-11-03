// Scripted MCP clients against a running server (wrangler dev by default) and
// the live recipe API. Every case states the outcome it expects; any mismatch
// is reported and the script exits 1.
// Usage: node _agent/scripts/smoke.mjs [baseUrl]
// Runs both routes with a 2025-era client (SDK 1.x) and a 2026-07-28 client
// (SDK 2.x, pinned), and writes a Markdown transcript to _agent/runs/.

import { mkdirSync, writeFileSync } from 'node:fs'
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const base = process.argv[2] ?? 'http://127.0.0.1:8787'
const AGE_NOTE = 'For adults of legal drinking age. Please drink responsibly.'
const SITE = 'https://fixmeadrinkapp.com/'
const LOW = new Set(['Low', 'Non Alcoholic'])

const cards = (out, key) => out?.[key] ?? []
const allOnSite = (list) => list.every((card) => card.url.startsWith(`${SITE}recipes/`))

const cases = [
  ['find_cocktails_by_ingredients', { ingredients: ['gin', 'limes', 'simple syrup', 'soda water'] }, (out) => {
    const main = new Set(cards(out, 'cocktails').map((c) => c.url))
    return out.cocktails.length > 0 && allOnSite(out.cocktails) && !cards(out, 'low_proof_options').some((c) => main.has(c.url))
  }],
  ['find_cocktails_by_ingredients', { ingredients: ['bourbon', 'sweet vermouth', 'angostura bitters'], limit: 3 },
    (out) => out.cocktails.length > 0 && out.cocktails.length <= 3],
  ['find_cocktails_by_ingredients', { ingredients: ['aperol', 'prosecco', 'soda water', 'orange juice'], strength: 'zero_or_low' },
    (out) => out.cocktails.length > 0 && out.cocktails.every((c) => LOW.has(c.strength))],
  ['find_cocktails_by_ingredients', { ingredients: ['vermouth', 'gin'] },
    (out) => {
      const vermouth = out.bar.recognised.find((t) => t.you_said === 'vermouth')
      const cards = [...out.cocktails, ...out.low_proof_options]
      return vermouth?.matched_as.length === 0 && vermouth.could_be?.length === 2 &&
        cards.every((c) => !c.have.some((name) => /vermouth/i.test(name)) && (!c.depends_on?.length || !c.can_make_now))
    }],
  ['find_cocktails_by_ingredients', { ingredients: ['rum', 'pineapple juice', 'lime'], flavors: ['tropical'] },
    (out) => Array.isArray(out.cocktails)],
  ['find_cocktails_by_ingredients', { ingredients: ['xyzzy'] }, (out) => out.bar.not_recognised.includes('xyzzy')],
  ['find_cocktails_by_ingredients', { ingredients: ['gin'], strengthh: 'zero_or_low' }, 'error'],
  ['get_cocktail_recipe', { name: 'Espresso Martini' }, (out) => out.ingredients.some((i) => i.name === 'Vodka') && !out.note],
  ['get_cocktail_recipe', { name: 'old fashioned' }, (out) => /old fashioned/i.test(out.name)],
  ['get_cocktail_recipe', { name: 'https://fixmeadrinkapp.com/recipes/moscow-mule' }, (out) => out.url.endsWith('/recipes/moscow-mule') && !out.note],
  ['get_cocktail_recipe', { name: 'Margarita' }, (out) => Boolean(out.note)],
  ['get_cocktail_recipe', { name: 'not a real drink qq' }, 'error'],
  ['explain_bar_term', { term: 'mezcal' }, (out) => out.url === `${SITE}ingredients/mezcal`],
  ['explain_bar_term', { term: 'what is a dry shake?' }, (out) => out.url === `${SITE}glossary/dry-shake` && out.how_to?.steps.length > 0],
  ['explain_bar_term', { term: 'coupe glass' }, (out) => out.url.startsWith(SITE)],
  ['explain_bar_term', { term: 'Aperol' }, (out) => out.url.startsWith(SITE)],
  ['suggest_similar_cocktail', { name: 'Moscow Mule' }, (out) => out.suggestions.length > 0 && out.suggestions.length <= 5],
  ['suggest_similar_cocktail', { name: 'Espresso Martini', low_proof: true },
    (out) => out.suggestions.length > 0 && out.suggestions.every((c) => LOW.has(c.strength))],
]

async function connect(era, endpoint) {
  if (era === 'legacy') {
    const client = new LegacyClient({ name: 'garcon-smoke-legacy', version: '1.0.0' })
    await client.connect(new LegacyTransport(endpoint))
    return client
  }
  const client = new Client(
    { name: 'garcon-smoke-modern', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  )
  await client.connect(new StreamableHTTPClientTransport(endpoint))
  return client
}

const out = []
const log = (line = '') => {
  out.push(line)
  console.log(line)
}
const failures = []
const fail = (where, why) => {
  failures.push(`${where}: ${why}`)
  log(`FAIL ${why}`)
}

log('# Ask Garçon smoke run')
log()
log(`- Server: ${base}`)
log(`- Run at: ${new Date().toISOString()}`)

for (const route of ['/mcp', '/chatgpt/mcp']) {
  const endpoint = new URL(route, base)

  const batch = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]),
  })
  log()
  log(`## ${route} ingress`)
  log(`- batch POST: ${batch.status}`)
  if (batch.status !== 400) fail(`${route} batch`, `expected 400, got ${batch.status}`)
  const get = await fetch(endpoint)
  log(`- GET: ${get.status}`)
  if (get.status !== 405) fail(`${route} GET`, `expected 405, got ${get.status}`)

  for (const era of ['legacy', 'modern']) {
    const where = `${route} ${era}`
    log()
    log(`## ${where}`)
    const started = Date.now()
    const client = await connect(era, endpoint)
    const { tools } = await client.listTools()
    log(`- tools/list: ${tools.map((t) => t.name).join(', ')}`)
    if (tools.length !== 4) fail(where, `expected 4 tools, got ${tools.length}`)
    const { contents } = await client.readResource({ uri: 'ui://ask-garcon/cocktail-list-v2.html' })
    const domain = contents[0]._meta?.ui?.domain
    log(`- widget: ${contents[0].mimeType}, ui.domain ${domain ?? 'none'}`)
    if ((route === '/chatgpt/mcp') !== Boolean(domain)) fail(where, `unexpected ui.domain ${domain}`)

    for (const [name, args, expected] of cases) {
      const t0 = Date.now()
      const label = `${name} ${JSON.stringify(args)}`
      let result
      try {
        result = await client.callTool({ name, arguments: args })
      } catch (error) {
        log(`- ${label}`)
        fail(`${where} ${label}`, `threw ${error.message}`)
        continue
      }
      const text = result.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n') ?? ''
      const outcome = result.isError ? 'error' : 'ok'
      log(`- ${label}: ${outcome} in ${Date.now() - t0} ms`)
      if (expected === 'error') {
        if (!result.isError) fail(`${where} ${label}`, 'expected a tool error')
        continue
      }
      if (result.isError) {
        fail(`${where} ${label}`, `expected success, got error: ${text}`)
        continue
      }
      if (!text.endsWith(AGE_NOTE)) fail(`${where} ${label}`, 'text does not end with the age line')
      let passed = false
      try {
        passed = expected(result.structuredContent)
      } catch {
        // A missing field counts as a mismatch.
      }
      if (!passed) fail(`${where} ${label}`, `unexpected result ${JSON.stringify(result.structuredContent).slice(0, 300)}`)
    }
    await client.close()
    log(`- ${where} finished in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  }
}

log()
log(failures.length ? `${failures.length} mismatches:` : 'All cases matched.')
for (const failure of failures) log(`- ${failure}`)

const runs = new URL('../runs/', import.meta.url)
mkdirSync(runs, { recursive: true })
const file = new URL(`smoke-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`, runs)
writeFileSync(file, `${out.join('\n')}\n`)
console.error(`transcript: ${file.pathname}`)
process.exit(failures.length ? 1 : 0)
