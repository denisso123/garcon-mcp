// Cloudflare Worker entry: the two MCP routes and the small public pages.
// MCP requests pass the cheap checks (route, method, content type, declared
// size, IP limit) before the body is read, and the body is read once.

import { createMcpHandler, isJsonContentType, readRequestBody } from '@modelcontextprotocol/server'
import { LANDING_HTML, PRIVACY_HTML } from './pages'
import { type HostProfile, createServer } from './server'
import { Upstream } from './upstream'

export interface Env {
  /** Per client IP. Generous: ChatGPT and Claude call from shared egress IPs. */
  readonly IP_LIMITER: RateLimit
  /** Per ChatGPT user (`openai/subject`), on top of the IP limit, when the host sends one. */
  readonly CALLER_LIMITER: RateLimit
  /** Requests that reach the recipe API, per Cloudflare location. */
  readonly UPSTREAM_LIMITER: RateLimit
  /** Token shown by the OpenAI plugin portal for domain verification. */
  readonly OPENAI_APPS_CHALLENGE?: string
  /** Override for tests and staging; defaults to the production API. */
  readonly API_BASE_URL?: string
}

const ROUTES = new Map<string, HostProfile>([
  ['/mcp', 'default'],
  ['/chatgpt/mcp', 'chatgpt'],
])

const MAX_BODY_BYTES = 64 * 1024

// The server is public, read-only and uses no cookies, so any origin may call it.
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers':
    'content-type, accept, authorization, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name, last-event-id',
  'access-control-expose-headers': 'retry-after, mcp-protocol-version',
  'access-control-max-age': '86400',
}

function html(body: string) {
  return new Response(body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  })
}

type JsonRpcId = string | number | null

function requestId(body: unknown): JsonRpcId {
  const id = (body as { id?: unknown } | null)?.id
  return typeof id === 'string' || typeof id === 'number' ? id : null
}

function jsonRpcError(
  status: number,
  id: JsonRpcId,
  code: number,
  message: string,
  headers: Record<string, string> = {}
) {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { status, headers })
}

function tooManyRequests(id: JsonRpcId) {
  return jsonRpcError(429, id, -32000, 'Too many requests to Ask Garçon. Wait a minute and try again.', {
    'retry-after': '60',
  })
}

async function allowed(limiter: RateLimit, key: string) {
  try {
    return (await limiter.limit({ key })).success
  } catch {
    // Fail open: a limiter outage must not take the server down.
    return true
  }
}

function subjectOf(body: unknown) {
  const subject = (body as { params?: { _meta?: Record<string, unknown> } } | null)?.params?._meta?.[
    'openai/subject'
  ]
  return typeof subject === 'string' && subject.length > 0 && subject.length <= 200 ? subject : null
}

async function serveMcp(request: Request, env: Env, ctx: ExecutionContext, profile: HostProfile) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (request.method !== 'POST') {
    return jsonRpcError(405, null, -32000, 'Method not allowed.', { allow: 'POST, OPTIONS' })
  }
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return jsonRpcError(415, null, -32000, 'Content-Type must be application/json.')
  }
  const tooLarge = () => jsonRpcError(413, null, -32000, 'Request body is too large.')
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return tooLarge()

  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  if (!(await allowed(env.IP_LIMITER, `ip:${ip}`))) return tooManyRequests(null)

  const read = await readRequestBody(request, MAX_BODY_BYTES)
  if (read.tooLarge) return tooLarge()
  let body: unknown
  try {
    body = JSON.parse(read.text)
  } catch {
    return jsonRpcError(400, null, -32700, 'Parse error: the body is not valid JSON.')
  }
  if (Array.isArray(body)) {
    return jsonRpcError(400, null, -32600, 'Batch requests are not supported. Send one JSON-RPC message per request.')
  }

  // ChatGPT's anonymized user id is caller-supplied, so it only ever adds a limit.
  const subject = subjectOf(body)
  if (subject && !(await allowed(env.CALLER_LIMITER, `sub:${subject}`))) {
    return tooManyRequests(requestId(body))
  }

  const up = new Upstream({
    cache: typeof caches === 'undefined' ? null : caches.default,
    permit: () => allowed(env.UPSTREAM_LIMITER, 'upstream'),
    waitUntil: (promise) => ctx.waitUntil(promise),
    baseUrl: env.API_BASE_URL || undefined,
  })
  const handler = createMcpHandler(() => createServer(up, profile), {
    maxRequestBodySize: MAX_BODY_BYTES,
    onerror: (error) => console.error('mcp handler', error.message),
  })
  return handler.fetch(request, { parsedBody: body })
}

function withCors(response: Response) {
  const result = new Response(response.body, response)
  for (const [name, value] of Object.entries(CORS_HEADERS)) result.headers.set(name, value)
  return result
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/'
    const profile = ROUTES.get(path)
    if (profile) return withCors(await serveMcp(request, env, ctx, profile))

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (path === '/') return html(LANDING_HTML)
      if (path === '/privacy') return html(PRIVACY_HTML)
      if (path === '/.well-known/openai-apps-challenge') {
        return env.OPENAI_APPS_CHALLENGE
          ? new Response(env.OPENAI_APPS_CHALLENGE, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
          : new Response('Not configured', { status: 404 })
      }
    }
    return new Response('Not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
