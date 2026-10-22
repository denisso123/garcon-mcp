// Client for the public Garçon REST API. One instance serves one tool call:
// it carries that call's request budget, deadline and in-flight lookups.
// Answers are cached in this isolate's memory and in the Workers Cache API.

import { API_BASE_URL } from './site'

export class UpstreamError extends Error {
  override name = 'UpstreamError'
}

/** The subset of the Workers Cache API this client uses. */
export interface CacheLike {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

interface UpstreamOptions {
  readonly cache: CacheLike | null
  /** The shared limiter for requests that reach the API. Resolves false when spent. */
  readonly permit: () => Promise<boolean>
  readonly waitUntil: (promise: Promise<unknown>) => void
  readonly baseUrl?: string
  /** The whole call's deadline. Tests shorten it; production uses 20 s. */
  readonly deadlineMs?: number
  /** One request, body included. Tests shorten it; production uses 8 s. */
  readonly attemptTimeoutMs?: number
}

// Bump when the shape of cached values changes.
const CACHE_SCHEMA = 2
// Cache keys live on a host we own so they never collide with real URLs.
const CACHE_KEY_ORIGIN = 'https://cache.mcp.fixmeadrinkapp.com'
const MEMORY_LIMIT = 200
const MEMORY_TTL_SECONDS = 600
const NOT_FOUND_TTL_SECONDS = 600

const MAX_REQUESTS_PER_CALL = 40
const MAX_ATTEMPTS = 2
const ATTEMPT_TIMEOUT_MS = 8_000
const CALL_DEADLINE_MS = 20_000
const MAX_RETRY_WAIT_MS = 2_000
const USER_AGENT = 'garcon-mcp/1.0 (+https://fixmeadrinkapp.com)'

const BUSY = 'Garçon is handling a lot of requests right now. Try again in a minute.'
const UNAVAILABLE = 'The Garçon recipe service is not answering right now. Try again shortly.'
const TOO_SLOW = 'The Garçon recipe service is too slow right now. Try again shortly.'
const OVER_BUDGET = 'That question needs more catalogue lookups than one answer allows. Try a shorter list.'

interface MemoryEntry {
  readonly expires: number
  readonly value: unknown
}

// Module scope: shared by every request this isolate serves.
const memory = new Map<string, MemoryEntry>()

function memoryGet(key: string): unknown {
  const entry = memory.get(key)
  if (!entry) return undefined
  memory.delete(key)
  if (entry.expires < Date.now()) return undefined
  memory.set(key, entry)
  return entry.value
}

function memorySet(key: string, value: unknown) {
  memory.set(key, { value, expires: Date.now() + MEMORY_TTL_SECONDS * 1000 })
  for (const oldest of memory.keys()) {
    if (memory.size <= MEMORY_LIMIT) break
    memory.delete(oldest)
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isTimeout(error: unknown) {
  return error instanceof Error && error.name === 'TimeoutError'
}

/** `promise`, or the signal's reason as soon as it aborts. The promise keeps running but nobody waits for it. */
function untilAborted<T>(promise: T | Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

/** Best effort and never awaited: a body that is already errored rejects its cancel. */
function discardBody(response: Response) {
  try {
    response.body?.cancel().catch(() => undefined)
  } catch {
    // A locked or disturbed body cannot be cancelled; it is released with the response.
  }
}

/** Milliseconds a 429 or 503 asks us to wait, or null when it does not say. */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}

function backoffMs() {
  return 250 + Math.random() * 250
}

/** The API wraps every answer as { success, responseObject }. */
function unwrap<T>(text: string): T | null {
  let body: { success?: unknown; responseObject?: T }
  try {
    body = JSON.parse(text)
  } catch {
    // An HTML error page from a proxy in front of the API, for example.
    throw new UpstreamError(UNAVAILABLE)
  }
  return body?.success === true ? (body.responseObject ?? null) : null
}

type Attempt<T> =
  | { readonly ok: true; readonly value: T | null }
  | { readonly ok: false; readonly error: UpstreamError; readonly waitMs: number | null }

export class Upstream {
  private readonly cache: CacheLike | null
  private readonly permit: () => Promise<boolean>
  private readonly waitUntil: (promise: Promise<unknown>) => void
  private readonly baseUrl: string
  private readonly deadline: number
  private readonly attemptTimeoutMs: number
  private readonly inflight = new Map<string, Promise<unknown>>()
  private requests = 0

  constructor(options: UpstreamOptions) {
    this.cache = options.cache
    this.permit = options.permit
    this.waitUntil = options.waitUntil
    this.baseUrl = options.baseUrl ?? API_BASE_URL
    this.deadline = Date.now() + (options.deadlineMs ?? CALL_DEADLINE_MS)
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS
  }

  /** GET an API path. Null when the API answers 404 or 400. */
  get<T>(path: string, ttlSeconds: number): Promise<T | null> {
    return this.load<T>(`GET ${path}`, ttlSeconds, () => this.request<T>(path))
  }

  /** POST a JSON body to a read-only endpoint, cached by path and body. */
  post<T>(path: string, body: unknown, ttlSeconds: number): Promise<T | null> {
    const payload = JSON.stringify(body)
    return this.load<T>(`POST ${path} ${payload}`, ttlSeconds, () => this.request<T>(path, payload))
  }

  /**
   * Identical lookups within one call share a single promise. Whatever goes
   * wrong below this point reaches the tools as an UpstreamError, so an
   * optional lookup can fail without taking the main answer with it.
   */
  private load<T>(what: string, ttlSeconds: number, fetchValue: () => Promise<T | null>) {
    const key = `${CACHE_SCHEMA} ${this.baseUrl} ${what}`
    let pending = this.inflight.get(key)
    if (!pending) {
      pending = this.cached(key, ttlSeconds, fetchValue).catch((error: unknown) => {
        throw error instanceof UpstreamError ? error : new UpstreamError(UNAVAILABLE)
      })
      this.inflight.set(key, pending)
    }
    return pending as Promise<T | null>
  }

  /**
   * One stage of the call (cache lookup, limiter, wait), bounded by the call
   * deadline. A stage that is still pending at the deadline fails the call
   * with "too slow"; when it settles later, nothing is waiting for it.
   */
  private stage<T>(work: () => Promise<T>): Promise<T> {
    const remaining = this.deadline - Date.now()
    if (remaining <= 0) return Promise.reject(new UpstreamError(TOO_SLOW))
    let promise: Promise<T>
    try {
      promise = work()
    } catch (error) {
      return Promise.reject(error)
    }
    return untilAborted(promise, AbortSignal.timeout(remaining)).catch((error: unknown) => {
      throw isTimeout(error) ? new UpstreamError(TOO_SLOW) : error
    })
  }

  private async cached<T>(
    key: string,
    ttlSeconds: number,
    fetchValue: () => Promise<T | null>
  ): Promise<T | null> {
    const hot = memoryGet(key)
    if (hot !== undefined) return hot as T | null

    const cacheRequest = new Request(`${CACHE_KEY_ORIGIN}/?k=${encodeURIComponent(key)}`)
    const cache = this.cache
    if (cache) {
      // A broken cache only costs an API request; the deadline still applies.
      const stored = await this.stage(() =>
        Promise.resolve()
          .then(() => cache.match(cacheRequest))
          .catch(() => undefined)
      )
      if (stored) {
        try {
          const { v } = await this.stage(() => stored.json() as Promise<{ v: T | null }>)
          memorySet(key, v)
          return v
        } catch (error) {
          if (error instanceof UpstreamError) throw error
          // An unreadable entry only costs an API request.
        }
      }
    }

    const value = await fetchValue()
    memorySet(key, value)
    if (cache) {
      const ttl = value === null ? Math.min(ttlSeconds, NOT_FOUND_TTL_SECONDS) : ttlSeconds
      const response = new Response(JSON.stringify({ v: value }), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` },
      })
      this.waitUntil(
        Promise.resolve()
          .then(() => cache.put(cacheRequest, response))
          .catch(() => undefined)
      )
    }
    return value
  }

  private async request<T>(path: string, jsonBody?: string): Promise<T | null> {
    for (let attempt = 1; ; attempt++) {
      // Counted before the first await, so parallel lookups cannot overshoot.
      if (this.requests++ >= MAX_REQUESTS_PER_CALL) throw new UpstreamError(OVER_BUDGET)
      if (!(await this.stage(() => this.permit()))) throw new UpstreamError(BUSY)

      const result = await this.attempt<T>(path, jsonBody)
      if (result.ok) return result.value
      const remaining = this.deadline - Date.now()
      const wait = result.waitMs
      if (attempt >= MAX_ATTEMPTS || wait === null || wait > MAX_RETRY_WAIT_MS) throw result.error
      if (wait >= remaining) throw new UpstreamError(TOO_SLOW)
      await this.stage(() => sleep(wait))
    }
  }

  /**
   * One request inside the attempt timeout and the call deadline. The same
   * signal bounds the body read, which a stalled stream would otherwise hold
   * open. The status decides the outcome; cleaning up the body never does.
   */
  private async attempt<T>(path: string, jsonBody?: string): Promise<Attempt<T>> {
    const remaining = this.deadline - Date.now()
    if (remaining <= 0) throw new UpstreamError(TOO_SLOW)
    const signal = AbortSignal.timeout(Math.min(this.attemptTimeoutMs, remaining))
    let response: Response | undefined
    try {
      response = await untilAborted(
        fetch(`${this.baseUrl}${path}`, {
          method: jsonBody === undefined ? 'GET' : 'POST',
          headers: {
            accept: 'application/json',
            'user-agent': USER_AGENT,
            ...(jsonBody === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: jsonBody,
          signal,
        }),
        signal
      )
      if (response.ok) return { ok: true, value: unwrap<T>(await untilAborted(response.text(), signal)) }
    } catch (error) {
      if (error instanceof UpstreamError) throw error
      if (response) discardBody(response)
      return {
        ok: false,
        error: new UpstreamError(isTimeout(error) ? TOO_SLOW : UNAVAILABLE),
        waitMs: backoffMs(),
      }
    }

    discardBody(response)
    if (response.status === 404 || response.status === 400) return { ok: true, value: null }
    if (response.status === 429) {
      return { ok: false, error: new UpstreamError(BUSY), waitMs: retryAfterMs(response) ?? backoffMs() }
    }
    if (response.status >= 500) {
      return {
        ok: false,
        error: new UpstreamError(UNAVAILABLE),
        waitMs: retryAfterMs(response) ?? backoffMs(),
      }
    }
    return { ok: false, error: new UpstreamError(UNAVAILABLE), waitMs: null }
  }
}
