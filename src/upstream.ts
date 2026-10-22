// Client for the public Garçon REST API. Three cache layers keep traffic far
// below the API's limit of 1,000 requests per 15 minutes per IP:
//   1. a small in-isolate map (hot keys, no I/O),
//   2. the Workers Cache API (per data center, survives isolate restarts),
//   3. the API itself, behind an upstream budget (a rate-limit binding).
// A 404 or 400 means "no such entity" and resolves to null; 429, 5xx and
// network errors retry once, then throw an UpstreamError the tools turn into
// a readable message.

import { API_BASE_URL } from './site'

export type UpstreamErrorKind = 'busy' | 'unavailable'

export class UpstreamError extends Error {
  readonly kind: UpstreamErrorKind

  constructor(kind: UpstreamErrorKind, message: string) {
    super(message)
    this.name = 'UpstreamError'
    this.kind = kind
  }
}

export interface ServiceResponse<T> {
  readonly success: boolean
  readonly message: string
  readonly responseObject: T
  readonly statusCode: number
}

/** The subset of the Workers Cache API this client uses. */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

/** Returns false when the upstream budget for this window is spent. */
export type BudgetCheck = () => Promise<boolean>

export interface UpstreamOptions {
  readonly fetch?: typeof fetch
  readonly cache?: CacheLike | null
  readonly budget?: BudgetCheck
  readonly waitUntil?: (promise: Promise<unknown>) => void
  readonly baseUrl?: string
}

// Cache keys live on a host we own so they never collide with real URLs.
const CACHE_KEY_ORIGIN = 'https://cache.mcp.fixmeadrinkapp.com'
const MEMORY_LIMIT = 200
const RETRY_DELAY_MS = 400
const TIMEOUT_MS = 10_000
const USER_AGENT = 'garcon-mcp/1.0 (+https://fixmeadrinkapp.com)'

interface MemoryEntry {
  readonly expires: number
  readonly value: unknown
}

// Module scope: shared by every request this isolate serves.
const memory = new Map<string, MemoryEntry>()

function memoryGet(key: string): unknown {
  const entry = memory.get(key)
  if (!entry) return undefined
  if (entry.expires < Date.now()) {
    memory.delete(key)
    return undefined
  }
  // Refresh recency for the simple LRU below.
  memory.delete(key)
  memory.set(key, entry)
  return entry.value
}

function memorySet(key: string, value: unknown, ttlSeconds: number) {
  memory.set(key, { value, expires: Date.now() + ttlSeconds * 1000 })
  while (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value
    if (oldest === undefined) break
    memory.delete(oldest)
  }
}

export function clearMemoryCache() {
  memory.clear()
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class Upstream {
  private readonly fetchImpl: typeof fetch
  private readonly cache: CacheLike | null
  private readonly budget: BudgetCheck
  private readonly waitUntil: (promise: Promise<unknown>) => void
  private readonly baseUrl: string

  constructor(options: UpstreamOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
    this.cache = options.cache ?? null
    this.budget = options.budget ?? (async () => true)
    this.waitUntil = options.waitUntil ?? (() => {})
    this.baseUrl = options.baseUrl ?? API_BASE_URL
  }

  /** GET an API path. Null when the API answers 404 or 400. */
  get<T>(path: string, ttlSeconds: number): Promise<T | null> {
    return this.cached<T>(`GET ${path}`, ttlSeconds, () =>
      this.request<T>(path, { method: 'GET' })
    )
  }

  /** POST a JSON body, cached by path and body (only for read-only endpoints). */
  post<T>(path: string, body: unknown, ttlSeconds: number): Promise<T | null> {
    const payload = JSON.stringify(body)
    return this.cached<T>(`POST ${path} ${payload}`, ttlSeconds, () =>
      this.request<T>(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      })
    )
  }

  private async cached<T>(
    key: string,
    ttlSeconds: number,
    load: () => Promise<T | null>
  ): Promise<T | null> {
    const hot = memoryGet(key)
    if (hot !== undefined) return hot as T | null

    const cacheRequest = new Request(
      `${CACHE_KEY_ORIGIN}/v1?k=${encodeURIComponent(key)}`
    )
    if (this.cache) {
      try {
        const hit = await this.cache.match(cacheRequest)
        if (hit) {
          const value = (await hit.json()) as { v: T | null }
          memorySet(key, value.v, Math.min(ttlSeconds, 600))
          return value.v
        }
      } catch {
        // A cache failure only costs an upstream call.
      }
    }

    const value = await load()
    memorySet(key, value, Math.min(ttlSeconds, 600))
    if (this.cache) {
      // Cache misses ("not found") briefly too, so a typo is not refetched.
      const ttl = value === null ? Math.min(ttlSeconds, 600) : ttlSeconds
      const response = new Response(JSON.stringify({ v: value }), {
        headers: {
          'content-type': 'application/json',
          'cache-control': `public, max-age=${ttl}`,
        },
      })
      this.waitUntil(
        this.cache.put(cacheRequest, response).catch(() => undefined)
      )
    }
    return value
  }

  private async request<T>(path: string, init: RequestInit): Promise<T | null> {
    for (let attempt = 0; ; attempt++) {
      if (!(await this.budget())) {
        throw new UpstreamError(
          'busy',
          'Garçon is handling a lot of requests right now. Try again in a minute.'
        )
      }

      let response: Response
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          headers: {
            accept: 'application/json',
            'user-agent': USER_AGENT,
            ...(init.headers as Record<string, string> | undefined),
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch {
        if (attempt === 0) {
          await sleep(RETRY_DELAY_MS)
          continue
        }
        throw new UpstreamError(
          'unavailable',
          'The Garçon recipe service did not respond. Try again shortly.'
        )
      }

      if (response.status === 404 || response.status === 400) return null
      if (response.ok) {
        const body = (await response.json()) as ServiceResponse<T>
        return body?.success ? body.responseObject : null
      }
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        await sleep(RETRY_DELAY_MS)
        continue
      }
      throw new UpstreamError(
        response.status === 429 ? 'busy' : 'unavailable',
        response.status === 429
          ? 'Garçon is handling a lot of requests right now. Try again in a minute.'
          : `The Garçon recipe service answered ${response.status}. Try again shortly.`
      )
    }
  }
}
