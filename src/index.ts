// Cloudflare Worker entry. Routes:
//   POST /mcp          MCP endpoint (Streamable HTTP, stateless). Claude and other hosts.
//   POST /chatgpt/mcp  Same tools; the widget declares ChatGPT's ui.domain.
//   GET  /             Landing page.
//   GET  /privacy      Privacy notice for both directory listings.
//   GET  /.well-known/openai-apps-challenge   OpenAI domain verification token.

import { createMcpHandler } from 'agents/mcp/server'
import { LANDING_HTML, PRIVACY_HTML } from './pages'
import { type HostProfile, createServer } from './server'
import { Upstream } from './upstream'

export interface Env {
  /** Per client IP. Generous: ChatGPT and Claude call from shared egress IPs. */
  readonly IP_LIMITER: RateLimit
  /** Per ChatGPT user (anonymized `openai/subject`), when the host sends one. */
  readonly CALLER_LIMITER: RateLimit
  /** Cache misses that reach the recipe API, per Cloudflare location. */
  readonly UPSTREAM_LIMITER: RateLimit
  /** Token shown by the OpenAI plugin portal for domain verification. */
  readonly OPENAI_APPS_CHALLENGE?: string
  /** Override for tests and staging; defaults to the production API. */
  readonly API_BASE_URL?: string
}

const ROUTES: Record<string, HostProfile> = {
  '/mcp': 'default',
  '/chatgpt/mcp': 'chatgpt',
}

function html(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  })
}

function rateLimited(id: unknown) {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code: -32000,
        message: 'Too many requests to Ask Garçon. Wait a minute and try again.',
      },
    }),
    {
      status: 429,
      headers: { 'content-type': 'application/json', 'retry-after': '60' },
    }
  )
}

interface JsonRpcPeek {
  readonly id?: unknown
  readonly subject?: string
}

// Reads the JSON-RPC id and ChatGPT's anonymized user id without consuming
// the request body the MCP handler needs.
async function peek(request: Request): Promise<JsonRpcPeek> {
  if (request.method !== 'POST') return {}
  try {
    const body = (await request.clone().json()) as {
      id?: unknown
      params?: { _meta?: Record<string, unknown> }
    }
    const subject = body?.params?._meta?.['openai/subject']
    return {
      id: body?.id,
      subject: typeof subject === 'string' && subject.length <= 200 ? subject : undefined,
    }
  } catch {
    return {}
  }
}

async function allowed(limiter: RateLimit | undefined, key: string) {
  if (!limiter) return true
  try {
    return (await limiter.limit({ key })).success
  } catch {
    // Fail open: a limiter outage must not take the server down.
    return true
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (path === '/') return html(LANDING_HTML)
      if (path === '/privacy') return html(PRIVACY_HTML)
      if (path === '/.well-known/openai-apps-challenge') {
        return env.OPENAI_APPS_CHALLENGE
          ? new Response(env.OPENAI_APPS_CHALLENGE, {
              headers: { 'content-type': 'text/plain; charset=utf-8' },
            })
          : new Response('Not configured', { status: 404 })
      }
    }

    const profile = ROUTES[path]
    if (!profile) return new Response('Not found', { status: 404 })

    if (request.method === 'POST') {
      const { id, subject } = await peek(request)
      const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
      if (!(await allowed(env.IP_LIMITER, `ip:${ip}`))) return rateLimited(id)
      if (subject && !(await allowed(env.CALLER_LIMITER, `sub:${subject}`))) {
        return rateLimited(id)
      }
    }

    const up = new Upstream({
      cache: typeof caches !== 'undefined' ? caches.default : null,
      budget: () => allowed(env.UPSTREAM_LIMITER, 'upstream'),
      waitUntil: (promise) => ctx.waitUntil(promise),
      baseUrl: env.API_BASE_URL || undefined,
    })
    const handler = createMcpHandler(() => createServer(up, profile), {
      route: path,
      corsOptions: { origin: '*', methods: 'GET, POST, DELETE, OPTIONS' },
    })
    return handler(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
