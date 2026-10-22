import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { bourbonBar } from './data'
import { type CacheLike, Upstream, UpstreamError } from '../src/upstream'
import { FakeApi, FakeCache, envelope, erroredBody, setup, text, tool } from './harness'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const RECIPE = { name: 'Old Fashioned' }

/** Fails the first `times` catalogue requests with `response`, then answers normally. */
function failCatalogue(api: FakeApi, times: number, response: () => Response) {
  let failures = 0
  api.override('/cocktails?', (request) => (failures++ < times ? response() : api.handleDefault(request)))
}

describe('upstream failures', () => {
  it('waits out a one-second Retry-After on a 429, then retries once', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    const times: number[] = []
    let failures = 0
    h.api.override('/cocktails?', (request) => {
      times.push(Date.now())
      return failures++ < 1
        ? new Response('slow down', { status: 429, headers: { 'retry-after': '1' } })
        : h.api.handleDefault(request)
    })
    const result = await tool(h, 'get_cocktail_recipe', RECIPE)
    expect(result.isError).toBeFalsy()
    expect(times).toHaveLength(2)
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(950)
  })

  it('retries a 503 whose body errors, keeping the status classification (audit 2, finding 3)', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    failCatalogue(h.api, 1, () => new Response(erroredBody(), { status: 503 }))
    const result = await tool(h, 'get_cocktail_recipe', RECIPE)
    expect(result.isError).toBeFalsy()
    expect(h.api.callsTo('/cocktails?')).toHaveLength(2)
  })

  it('does not retry when Retry-After asks for longer than the call can wait', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    failCatalogue(h.api, 1, () => new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }))
    const result = await tool(h, 'get_cocktail_recipe', RECIPE)
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/handling a lot of requests/)
    expect(h.api.callsTo('/cocktails?')).toHaveLength(1)
  })

  it('retries a 5xx once, then says the service is not answering', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    failCatalogue(h.api, 9, () => new Response('down', { status: 503 }))
    const result = await tool(h, 'get_cocktail_recipe', RECIPE)
    expect(text(result)).toMatch(/not answering right now/)
    expect(h.api.callsTo('/cocktails?')).toHaveLength(2)
  })

  it('reports an HTML page as the service not answering, without retrying', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    failCatalogue(h.api, 9, () => new Response('<html>Bad gateway</html>', { headers: { 'content-type': 'text/html' } }))
    const result = await tool(h, 'get_cocktail_recipe', RECIPE)
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/not answering right now/)
    expect(h.api.callsTo('/cocktails?')).toHaveLength(1)
  })

  it('answers busy without calling the API when the shared limiter is spent', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    h.env.UPSTREAM_LIMITER.allow = 0
    const result = await tool(h, 'get_cocktail_recipe', RECIPE)
    expect(text(result)).toMatch(/handling a lot of requests/)
    expect(h.api.calls).toEqual([])
  })

  it('caps the API requests one call can make', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    h.api.override('/cocktails?', () => envelope({ cocktails: [], totalPages: 60, total: 0 }))
    const result = await tool(h, 'get_cocktail_recipe', RECIPE)
    expect(text(result)).toMatch(/more catalogue lookups than one answer allows/)
    expect(h.api.calls.length).toBe(40)
  })
})

describe('caching', () => {
  it('keeps answers from different API base URLs apart', async () => {
    const first = setup(new FakeApi(bourbonBar()), worker)
    await tool(first, 'get_cocktail_recipe', RECIPE)
    const second = setup(new FakeApi(bourbonBar()), worker)
    await tool(second, 'get_cocktail_recipe', RECIPE)
    expect(second.api.callsTo('/cocktails?')).toHaveLength(1)
  })

  it('serves a new isolate from the Cache API', async () => {
    const cache = new FakeCache()
    vi.stubGlobal('caches', { default: cache })
    const h = setup(new FakeApi(bourbonBar()), worker)
    await tool(h, 'get_cocktail_recipe', RECIPE)
    await Promise.all(h.pending)
    const calls = h.api.calls.length
    expect(cache.entries.size).toBe(calls)

    vi.resetModules()
    const { default: freshWorker } = await import('../src/index')
    const fresh = { ...h, worker: freshWorker }
    const result = await tool(fresh, 'get_cocktail_recipe', RECIPE)
    expect(result.isError).toBeFalsy()
    expect(h.api.calls).toHaveLength(calls)
  })
})

/** A promise and the function that settles it, for stages that hang until the test releases them. */
function gate<T>() {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

function upstreamWith(options: Partial<ConstructorParameters<typeof Upstream>[0]> = {}) {
  return new Upstream({
    cache: null,
    permit: async () => true,
    waitUntil: () => {},
    baseUrl: 'https://deadline.test/api/v1',
    ...options,
  })
}

const OK = () => Response.json({ success: true, responseObject: { ok: true } })

describe('deadlines with real timers', () => {
  it('aborts a body that stalls after the headers, then retries (attempt timeout)', async () => {
    const fetches: string[] = []
    const signals: AbortSignal[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      fetches.push(String(input))
      if (init?.signal) signals.push(init.signal)
      if (fetches.length === 1) return new Response(new ReadableStream({ start() {} }), { status: 200 })
      return OK()
    })
    const started = Date.now()
    const value = await upstreamWith({ attemptTimeoutMs: 100 }).get('/stall-once', 60)
    expect(value).toEqual({ ok: true })
    expect(fetches).toHaveLength(2)
    // The stalled attempt's own signal fired; the successful one did not.
    expect(signals[0].aborted).toBe(true)
    expect((signals[0].reason as Error).name).toBe('TimeoutError')
    expect(signals[1].aborted).toBe(false)
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
  })

  it('gives up with "too slow" when every body stalls', async () => {
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ start() {} }), { status: 200 }))
    await expect(upstreamWith({ attemptTimeoutMs: 80 }).get('/stall', 60)).rejects.toThrow(/too slow/)
  })

  it('times out a cache lookup that never answers, and a late hit cannot resume the call (audit 2, finding 4)', async () => {
    const lookup = gate<Response | undefined>()
    const fetchSpy = vi.fn(OK)
    vi.stubGlobal('fetch', fetchSpy)
    const cache: CacheLike = { match: () => lookup.promise, put: async () => {} }
    const started = Date.now()
    const outcome = upstreamWith({ cache, deadlineMs: 150 }).get('/slow-cache', 60)
    await expect(outcome).rejects.toBeInstanceOf(UpstreamError)
    await expect(outcome).rejects.toThrow(/too slow/)
    expect(Date.now() - started).toBeLessThan(1_000)
    lookup.release(new Response(JSON.stringify({ v: { late: true } })))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('times out a limiter that never answers, and a late permit starts no request (audit 2, finding 4)', async () => {
    const permit = gate<boolean>()
    const fetchSpy = vi.fn(OK)
    vi.stubGlobal('fetch', fetchSpy)
    const outcome = upstreamWith({ permit: () => permit.promise, deadlineMs: 150 }).get('/slow-limiter', 60)
    await expect(outcome).rejects.toThrow(/too slow/)
    permit.release(true)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('stops between attempts once the call deadline has passed', async () => {
    const fetchSpy = vi.fn(async () => new Response('down', { status: 503, headers: { 'retry-after': '1' } }))
    vi.stubGlobal('fetch', fetchSpy)
    const started = Date.now()
    await expect(upstreamWith({ deadlineMs: 300 }).get('/down', 60)).rejects.toThrow(/too slow/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('treats a cache binding that throws synchronously as a miss', async () => {
    vi.stubGlobal('fetch', OK)
    const cache: CacheLike = {
      match: () => {
        throw new TypeError('cache binding broken')
      },
      put: async () => {},
    }
    expect(await upstreamWith({ cache }).get('/sync-throw', 60)).toEqual({ ok: true })
  })

  it('refuses a memory-cache hit once the call deadline has passed (audit 3, finding 4)', async () => {
    vi.stubGlobal('fetch', OK)
    await upstreamWith({ deadlineMs: 5_000 }).get('/warm-memory', 60)
    const late = upstreamWith({ deadlineMs: 30 })
    await new Promise((resolve) => setTimeout(resolve, 60))
    await expect(late.get('/warm-memory', 60)).rejects.toThrow(/too slow/)
  })

  it('refuses an already settled lookup once the call deadline has passed (audit 3, finding 4)', async () => {
    vi.stubGlobal('fetch', OK)
    const up = upstreamWith({ deadlineMs: 100 })
    expect(await up.get('/settled-once', 60)).toEqual({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 140))
    await expect(up.get('/settled-once', 60)).rejects.toThrow(/too slow/)
  })
})
