// Scripted MCP client: lists tools and resources, then calls every tool
// against a running server (wrangler dev by default) and the live API.
// Usage: node _agent/scripts/smoke.mjs [baseUrl] [--legacy]
//   --legacy uses the v1 SDK client (2025-era protocol, like ChatGPT and
//   Claude today); without it the v2 client negotiates the newest protocol.
// Writes a Markdown transcript to _agent/runs/.

import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const legacy = args.includes('--legacy')
const base = args.find((arg) => !arg.startsWith('--')) ?? 'http://127.0.0.1:8787'
const endpoint = new URL('/mcp', base)

async function connect() {
  if (legacy) {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    )
    const client = new Client({ name: 'garcon-smoke-v1', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(endpoint))
    return client
  }
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client')
  const client = new Client({ name: 'garcon-smoke-v2', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(endpoint))
  return client
}

const calls = [
  ['find_cocktails_by_ingredients', { ingredients: ['gin', 'limes', 'simple syrup', 'soda water'] }],
  ['find_cocktails_by_ingredients', { ingredients: ['bourbon', 'sweet vermouth', 'angostura bitters'], limit: 3 }],
  ['find_cocktails_by_ingredients', { ingredients: ['aperol', 'prosecco', 'soda water', 'orange juice'], strength: 'zero_or_low' }],
  ['find_cocktails_by_ingredients', { ingredients: ['rum', 'pineapple juice', 'lime'], flavors: ['tropical'] }],
  ['find_cocktails_by_ingredients', { ingredients: ['xyzzy'] }],
  ['get_cocktail_recipe', { name: 'Espresso Martini' }],
  ['get_cocktail_recipe', { name: 'old fashioned' }],
  ['get_cocktail_recipe', { name: 'https://fixmeadrinkapp.com/recipes/moscow-mule' }],
  ['get_cocktail_recipe', { name: 'Negroni' }],
  ['get_cocktail_recipe', { name: 'Margarita' }],
  ['get_cocktail_recipe', { name: 'Manhattan' }],
  ['get_cocktail_recipe', { name: 'not a real drink qq' }],
  ['explain_bar_term', { term: 'mezcal' }],
  ['explain_bar_term', { term: 'what is a dry shake?' }],
  ['explain_bar_term', { term: 'coupe glass' }],
  ['explain_bar_term', { term: 'Aperol' }],
  ['suggest_similar_cocktail', { name: 'Moscow Mule' }],
  ['suggest_similar_cocktail', { name: 'Espresso Martini', low_proof: true }],
]

const out = []
const log = (line = '') => {
  out.push(line)
  console.log(line)
}

const started = Date.now()
const client = await connect()
log(`# Ask Garçon smoke run`)
log()
log(`- Endpoint: ${endpoint}`)
log(`- Client: ${legacy ? '@modelcontextprotocol/sdk 1.32 (2025-era protocol)' : '@modelcontextprotocol/client 2.3 (newest protocol)'}`)
log(`- Run at: ${new Date().toISOString()}`)
log(`- Server: ${JSON.stringify(client.getServerVersion())}`)
log()

const tools = await client.listTools()
log(`## tools/list (${tools.tools.length} tools)`)
log()
for (const tool of tools.tools) {
  log(`- \`${tool.name}\`: title "${tool.title ?? tool.annotations?.title}", annotations ${JSON.stringify(tool.annotations)}, ui ${JSON.stringify(tool._meta?.ui ?? null)}`)
}
log()
const resources = await client.listResources()
log(`## resources/list`)
log()
for (const resource of resources.resources) {
  log(`- \`${resource.uri}\` ${resource.mimeType}`)
  const read = await client.readResource({ uri: resource.uri })
  const content = read.contents[0]
  log(`  - read: ${content.mimeType}, ${content.text.length} chars, _meta ${JSON.stringify(content._meta)}`)
}
log()

let failures = 0
for (const [name, input] of calls) {
  const t0 = Date.now()
  let result
  try {
    result = await client.callTool({ name, arguments: input })
  } catch (error) {
    failures++
    log(`## ${name} ${JSON.stringify(input)}`)
    log(`THREW: ${error.message}`)
    continue
  }
  const ms = Date.now() - t0
  const text = result.content?.find((c) => c.type === 'text')?.text ?? ''
  log(`## ${name} ${JSON.stringify(input)}`)
  log()
  log(`${result.isError ? 'isError' : 'ok'} in ${ms} ms; structuredContent ${result.structuredContent ? JSON.stringify(result.structuredContent).length + ' bytes' : 'none'}; _meta keys ${Object.keys(result._meta ?? {}).join(',') || 'none'}`)
  log()
  log('```text')
  log(text)
  log('```')
  log()
}
log(`Total ${((Date.now() - started) / 1000).toFixed(1)} s, ${failures} thrown calls.`)
await client.close()

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const file = new URL(`../runs/smoke-${legacy ? 'v1' : 'v2'}-${stamp}.md`, import.meta.url)
writeFileSync(file, out.join('\n') + '\n')
console.error(`transcript: ${file.pathname}`)
process.exit(failures ? 1 : 0)
