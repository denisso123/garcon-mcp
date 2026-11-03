// Runs the exported Worker in-process with fake bindings (rate limiters,
// Cache API, ExecutionContext) and a fake recipe API behind a fetch stub.

import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { vi } from 'vitest'
import type { RawIngredientOption, RawMatchGroups, RawPreview, RawRecipe } from '../src/api-types'
import type { Env } from '../src/index'
import type { CacheLike } from '../src/upstream'

export type Route = '/mcp' | '/chatgpt/mcp'

export interface FakeLimiter extends RateLimit {
  readonly keys: string[]
  allow: number
}

export function fakeLimiter(allow = Number.POSITIVE_INFINITY): FakeLimiter {
  const counts = new Map<string, number>()
  const limiter = {
    keys: [] as string[],
    allow,
    async limit({ key }: { key: string }) {
      limiter.keys.push(key)
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return { success: count <= limiter.allow }
    },
  }
  return limiter
}

export class FakeCache implements CacheLike {
  readonly entries = new Map<string, string>()
  async match(request: Request) {
    const body = this.entries.get(request.url)
    return body === undefined ? undefined : new Response(body)
  }
  async put(request: Request, response: Response) {
    this.entries.set(request.url, await response.text())
  }
}

type Handler = (request: Request) => Response | Promise<Response>

export interface FakeApiData {
  catalogue?: RawPreview[]
  recipes?: RawRecipe[]
  matches?: RawMatchGroups
  similar?: Record<string, RawPreview[]>
  search?: Record<string, RawIngredientOption[]>
}

export function envelope(responseObject: unknown) {
  return Response.json({ success: true, message: 'ok', responseObject, statusCode: 200 })
}

let apiCount = 0

/** A fake recipe API on its own base URL, so no two tests share cached answers. */
export class FakeApi {
  readonly baseUrl = `https://api-${++apiCount}.test/api/v1`
  readonly calls: string[] = []
  readonly overrides = new Map<string, Handler>()
  matchBodies: unknown[] = []

  constructor(readonly data: FakeApiData = {}) {}

  /** Answer every request whose path and query start with `prefix` with `handler`. */
  override(prefix: string, handler: Handler) {
    this.overrides.set(prefix, handler)
  }

  callsTo(prefix: string) {
    return this.calls.filter((call) => call.split(' ')[1].startsWith(prefix))
  }

  owns(url: string) {
    return url.startsWith(this.baseUrl)
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.slice(new URL(this.baseUrl).pathname.length)
    this.calls.push(`${request.method} ${path}${url.search}`)
    for (const [prefix, handler] of this.overrides) {
      if (`${path}${url.search}`.startsWith(prefix)) return handler(request)
    }
    return this.handleDefault(request)
  }

  /** The answer from `data`, for overrides that fall back to it. */
  async handleDefault(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.slice(new URL(this.baseUrl).pathname.length)
    const { catalogue = [], recipes = [], matches = {}, similar = {}, search = {} } = this.data
    if (path === '/cocktails') return envelope({ cocktails: catalogue, totalPages: 1, total: catalogue.length })
    if (path === '/cocktails/matches') {
      this.matchBodies.push(await request.json())
      return envelope(matches)
    }
    if (path.startsWith('/cocktails/slug/')) {
      const found = recipes.find((recipe) => recipe.slug === decodeURIComponent(path.slice(16)))
      return found ? envelope(found) : new Response('not found', { status: 404 })
    }
    if (path.startsWith('/cocktails/similar/')) return envelope(similar[path.slice(19)] ?? [])
    if (path === '/cocktails/search') return envelope([])
    if (path === '/ingredients/search') return envelope(search[url.searchParams.get('query') ?? ''] ?? [])
    return new Response('not found', { status: 404 })
  }
}

export interface Harness {
  readonly env: Env & { IP_LIMITER: FakeLimiter; CALLER_LIMITER: FakeLimiter; UPSTREAM_LIMITER: FakeLimiter }
  readonly ctx: ExecutionContext
  readonly pending: Promise<unknown>[]
  readonly api: FakeApi
  readonly worker: ExportedHandler<Env>
}

/** Installs the fetch stub and returns bindings for one test. */
export function setup(api: FakeApi, worker: ExportedHandler<Env>): Harness {
  const pending: Promise<unknown>[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    if (!api.owns(request.url)) throw new Error(`unexpected fetch ${request.url}`)
    return api.handle(request)
  })
  return {
    env: {
      IP_LIMITER: fakeLimiter(),
      CALLER_LIMITER: fakeLimiter(),
      UPSTREAM_LIMITER: fakeLimiter(),
      API_BASE_URL: api.baseUrl,
    },
    ctx: {
      waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext,
    pending,
    api,
    worker,
  }
}

export function call(h: Harness, request: Request) {
  return h.worker.fetch!(request as Request<unknown, IncomingRequestCfProperties>, h.env, h.ctx)
}

export function post(h: Harness, body: unknown, options: { route?: string; headers?: Record<string, string> } = {}) {
  return call(
    h,
    new Request(`https://mcp.test${options.route ?? '/mcp'}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        'cf-connecting-ip': '203.0.113.7',
        ...options.headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}

/** The JSON-RPC message in a JSON or single-event SSE response. */
export async function rpcBody(response: Response) {
  const text = await response.text()
  const json = text.startsWith('{') ? text : text.split('\n').find((line) => line.startsWith('data: '))!.slice(6)
  return JSON.parse(json) as { id: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } }
}

export type Era = 'legacy' | 'modern'

export interface Connected {
  readonly era: Era
  readonly protocolHeaders: string[]
  listTools(): Promise<{ tools: { name: string; title?: string; annotations?: unknown; _meta?: Record<string, unknown>; inputSchema: unknown; outputSchema?: unknown }[] }>
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>
  readResource(uri: string): Promise<{ contents: { uri: string; mimeType?: string; text?: string; _meta?: Record<string, unknown> }[] }>
  close(): Promise<void>
}

export interface ToolResult {
  isError?: boolean
  content: { type: string; text?: string }[]
  structuredContent?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

/** A real MCP client of either protocol era, talking to the Worker. */
export async function connect(h: Harness, era: Era, route: Route = '/mcp'): Promise<Connected> {
  const protocolHeaders: string[] = []
  const fetchWorker = async (input: string | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const version = request.headers.get('mcp-protocol-version')
    if (version) protocolHeaders.push(version)
    return call(h, request)
  }
  const url = new URL(`https://mcp.test${route}`)
  if (era === 'legacy') {
    const client = new LegacyClient({ name: 'legacy-test', version: '1.0.0' })
    await client.connect(new LegacyTransport(url, { fetch: fetchWorker }))
    return {
      era,
      protocolHeaders,
      listTools: () => client.listTools() as ReturnType<Connected['listTools']>,
      callTool: (name, args) => client.callTool({ name, arguments: args }) as Promise<ToolResult>,
      readResource: (uri) => client.readResource({ uri }) as ReturnType<Connected['readResource']>,
      close: () => client.close(),
    }
  }
  const client = new Client(
    { name: 'modern-test', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  )
  await client.connect(new StreamableHTTPClientTransport(url, { fetch: fetchWorker }))
  return {
    era,
    protocolHeaders,
    listTools: () => client.listTools() as ReturnType<Connected['listTools']>,
    callTool: (name, args) => client.callTool({ name, arguments: args }) as Promise<ToolResult>,
    readResource: (uri) => client.readResource({ uri }) as ReturnType<Connected['readResource']>,
    close: () => client.close(),
  }
}

export function preview(recipe: RawRecipe, extra: Partial<RawPreview> = {}): RawPreview {
  return {
    id: recipe.id,
    name: recipe.name,
    slug: recipe.slug,
    isFree: !recipe.isLocked,
    strengthLevel: recipe.strengthLevel,
    flavorNotes: recipe.flavorNotes,
    baseSpirit: recipe.baseSpirit,
    imageUrl: recipe.imageUrl,
    ingredientCount: recipe.ingredients?.length,
    ...extra,
  }
}

/** A free recipe from ingredient names; "name|garnish" marks a garnish, "name?" an optional one. */
export function recipe(slug: string, ingredients: string[], extra: Partial<RawRecipe> = {}): RawRecipe {
  return {
    isLocked: false,
    id: `id-${slug}`,
    slug,
    name: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    strengthLevel: 'Medium',
    flavorNotes: ['Citrusy'],
    ingredients: ingredients.map((spec) => {
      const optional = spec.endsWith('?')
      const [name, group] = spec.replace(/\?$/, '').split('|')
      return {
        amount: 1,
        unit: 'shot',
        optional,
        ingredient: { name, groupCategory: group === 'garnish' ? 'Garnishes & Decorative Elements' : 'Base Spirits' },
      }
    }),
    instructions: [{ step: 1, text: 'Shake with ice and strain.' }],
    ...extra,
  }
}

/** A response body that errors once read, as when a connection resets after the headers. Cancelling it rejects too. */
export function erroredBody() {
  return new ReadableStream({
    start(controller) {
      controller.error(new TypeError('connection reset after headers'))
    },
  })
}

export function text(result: ToolResult) {
  return result.content.map((block) => block.text ?? '').join('\n')
}

let nextId = 1

/** One tools/call through the Worker as a 2025-era client sends it. */
export async function tool(h: Harness, name: string, args: Record<string, unknown>, route: Route = '/mcp') {
  const body = await rpcBody(
    await post(h, { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }, { route })
  )
  if (body.error) throw new Error(JSON.stringify(body.error))
  return body.result as unknown as ToolResult
}
