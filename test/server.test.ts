// Drives the real MCP server over HTTP in-process, with the recipe API
// replaced by fixtures, to check tool metadata and that every result passes
// its declared output schema.

import { readFileSync } from 'node:fs'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { createServer } from '../src/server'
import { Upstream, clearMemoryCache } from '../src/upstream'

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

const oldFashioned = fixture('old-fashioned.json')
const mule = fixture('grapefruit-mule.json')
const roseSour = fixture('rose-sour-locked.json')

const preview = (r: any) => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  isFree: !r.isLocked,
  strengthLevel: r.strengthLevel,
  flavorNotes: r.flavorNotes,
  baseSpirit: r.baseSpirit,
  imageUrl: r.imageUrl,
})

const envelope = (responseObject: unknown) =>
  new Response(JSON.stringify({ success: true, message: 'ok', responseObject, statusCode: 200 }), {
    headers: { 'content-type': 'application/json' },
  })

let upstreamCalls: string[] = []

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input))
  const path = url.pathname.replace('/api/v1', '')
  upstreamCalls.push(`${init?.method ?? 'GET'} ${path}`)
  if (path === '/cocktails') {
    return envelope({
      cocktails: [preview(oldFashioned), preview(mule), preview(roseSour), { id: 'low1', name: 'Garibaldi', slug: 'garibaldi', isFree: true, strengthLevel: 'Low', flavorNotes: ['Citrusy'] }],
      totalPages: 1,
      total: 4,
    })
  }
  if (path === '/cocktails/slug/old-fashioned') return envelope(oldFashioned)
  if (path === '/cocktails/slug/grapefruit-mule') return envelope(mule)
  if (path === '/cocktails/slug/rose-sour') return envelope(roseSour)
  if (path === '/cocktails/slug/garibaldi') {
    return envelope({
      isLocked: false,
      id: 'low1',
      name: 'Garibaldi',
      slug: 'garibaldi',
      strengthLevel: 'Low',
      flavorNotes: ['Citrusy'],
      ingredients: [
        { amount: 1.5, unit: 'shot', ingredient: { name: 'Red Bitter Liqueur' } },
        { amount: 4, unit: 'shot', ingredient: { name: 'Orange Juice' } },
      ],
      instructions: [{ step: 1, text: 'Build over ice.' }],
    })
  }
  if (path.startsWith('/cocktails/similar/')) return envelope([preview(mule), preview(roseSour)])
  if (path === '/cocktails/matches') {
    return envelope({ readyToMake: [preview(oldFashioned)], closeMatch: [preview(roseSour)], almostThere: [preview(mule)] })
  }
  if (path === '/ingredients/search') return envelope([])
  return new Response('not found', { status: 404 })
}

function handler() {
  const up = new Upstream({ fetch: fakeFetch, budget: async () => true })
  return createMcpHandler(() => createServer(up))
}

let nextId = 1
async function rpc(method: string, params: Record<string, unknown> = {}) {
  const response = await handler().fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    })
  )
  const text = await response.text()
  const json = text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data: '))!.slice(6)
  const body = JSON.parse(json)
  if (body.error) throw new Error(JSON.stringify(body.error))
  return body.result
}

beforeEach(() => {
  clearMemoryCache()
  upstreamCalls = []
})

describe('MCP server', () => {
  it('advertises four read-only tools with titles and annotations', async () => {
    const { tools } = await rpc('tools/list')
    expect(tools.map((t: any) => t.name).sort()).toEqual([
      'explain_bar_term',
      'find_cocktails_by_ingredients',
      'get_cocktail_recipe',
      'suggest_similar_cocktail',
    ])
    for (const tool of tools) {
      expect(tool.title).toBeTruthy()
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false })
      expect(tool.description.length).toBeGreaterThan(100)
      expect(tool.name.length).toBeLessThanOrEqual(64)
      expect(tool.outputSchema).toBeTruthy()
    }
    const find = tools.find((t: any) => t.name === 'find_cocktails_by_ingredients')
    expect(find._meta.ui.resourceUri).toBe('ui://ask-garcon/cocktail-list-v1.html')
    expect(find._meta['openai/outputTemplate']).toBe('ui://ask-garcon/cocktail-list-v1.html')
  })

  it('serves the widget as an MCP Apps resource with a narrow CSP', async () => {
    const { contents } = await rpc('resources/read', { uri: 'ui://ask-garcon/cocktail-list-v1.html' })
    expect(contents[0].mimeType).toBe('text/html;profile=mcp-app')
    expect(contents[0].text).toContain('ui/initialize')
    expect(contents[0]._meta.ui.csp.resourceDomains).toEqual(['https://images.fixmeadrinkapp.com'])
    expect(contents[0]._meta.ui.domain).toBeUndefined()
  })

  it('finds drinks from a bar, ranked by fewest missing, with a low-proof option', async () => {
    const result = await rpc('tools/call', {
      name: 'find_cocktails_by_ingredients',
      arguments: { ingredients: ['bourbon', 'sugar', 'bitters'] },
    })
    expect(result.isError).toBeFalsy()
    const out = result.structuredContent
    expect(out.cocktails[0]).toMatchObject({
      name: 'Old Fashioned',
      can_make_now: true,
      url: 'https://fixmeadrinkapp.com/recipes/old-fashioned',
    })
    // The premium Rose Sour never appears: its ingredients are not public.
    expect(out.cocktails.map((c: any) => c.name)).not.toContain('Rose Sour')
    expect(out.low_proof_options[0].name).toBe('Garibaldi')
    expect(result._meta.images['https://fixmeadrinkapp.com/recipes/old-fashioned']).toMatch(/^https:\/\/images\./)
  })

  it('returns a recipe and caches the catalogue between calls', async () => {
    const first = await rpc('tools/call', { name: 'get_cocktail_recipe', arguments: { name: 'old fashioned' } })
    expect(first.structuredContent.ingredients[0].name).toBe('Bourbon whiskey')
    const callsAfterFirst = upstreamCalls.length
    await rpc('tools/call', { name: 'get_cocktail_recipe', arguments: { name: 'Old Fashioned' } })
    expect(upstreamCalls.length).toBe(callsAfterFirst)
  })

  it('offers free alternatives for a premium recipe', async () => {
    const result = await rpc('tools/call', { name: 'get_cocktail_recipe', arguments: { name: 'Rose Sour' } })
    expect(result.structuredContent.full_recipe_public).toBe(false)
    expect(result.structuredContent.free_alternatives[0].name).toBe('Grapefruit Mule')
  })

  it('returns readable errors instead of throwing', async () => {
    const empty = await rpc('tools/call', { name: 'find_cocktails_by_ingredients', arguments: { ingredients: [' , '] } })
    expect(empty.isError).toBe(true)
    expect(empty.content[0].text).toMatch(/at least one/)
    const unknown = await rpc('tools/call', { name: 'get_cocktail_recipe', arguments: { name: 'zzz qqq' } })
    expect(unknown.isError).toBe(true)
    expect(unknown.content[0].text).toMatch(/No cocktail called/)
  })

  it('suggests similar drinks with free recipes first and low-proof options', async () => {
    const result = await rpc('tools/call', { name: 'suggest_similar_cocktail', arguments: { name: 'Old Fashioned' } })
    const out = result.structuredContent
    expect(out.suggestions[0].full_recipe_public).toBe(true)
    expect(out.low_proof_options.map((c: any) => c.name)).toContain('Garibaldi')
  })

  it('reports a busy upstream as a tool error', async () => {
    const up = new Upstream({ fetch: fakeFetch, budget: async () => false })
    const busy = createMcpHandler(() => createServer(up))
    const response = await busy.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'get_cocktail_recipe', arguments: { name: 'Daiquiri' } } }),
      })
    )
    const text = await response.text()
    expect(text).toContain('handling a lot of requests')
  })
})
