import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { bourbonBar } from './data'
import { type CacheLike, Upstream, UpstreamError } from '../src/upstream'
import { cataloguePages } from '../src/service'
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

describe('upstream service key', () => {
  it('sends the secret on GET, POST and retry attempts', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(envelope({ ok: true }))
      .mockResolvedValueOnce(envelope({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)
    const up = upstreamWith({ apiKey: 'mcp-server-secret' })
    await up.get('/service-key-get', 60)
    await up.post('/service-key-post', { ingredients: ['Gin'] }, 60)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
    for (const [url, init] of fetchSpy.mock.calls) {
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Service-Key')).toBe('mcp-server-secret')
      expect(headers.get('accept')).toBe('application/json')
      expect(String(url)).not.toContain('mcp-server-secret')
    }
    expect(fetchSpy.mock.calls[2][1]?.method).toBe('POST')
    expect(new Headers(fetchSpy.mock.calls[2][1]?.headers).get('content-type')).toBe('application/json')
  })

  it.each([undefined, ''])('omits the header when the key is %s', async (apiKey) => {
    const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(envelope({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)
    await upstreamWith({ apiKey }).get(`/service-key-missing-${String(apiKey)}`, 60)
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).has('X-Service-Key')).toBe(false)
  })
})

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
    const fetchSpy = vi.fn(async () => Response.json({ success: true, responseObject: { ok: true } }))
    vi.stubGlobal('fetch', fetchSpy)
    const up = upstreamWith()
    const outcomes = await Promise.allSettled(Array.from({ length: 41 }, (_, i) => up.get(`/budget/${i}`, 60)))
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(40)
    const refused = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult
    expect(String(refused.reason)).toMatch(/more catalogue lookups than one answer allows/)
    expect(fetchSpy).toHaveBeenCalledTimes(40)
  })

  it('loads at most 10 catalogue pages, whatever totalPages says', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    h.api.override('/cocktails?', () => envelope({ cocktails: [], totalPages: 1_000_000_000, total: 0 }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await tool(h, 'get_cocktail_recipe', RECIPE)
    expect(h.api.callsTo('/cocktails?')).toHaveLength(10)
    expect(warn).toHaveBeenCalledWith('garcon-mcp: catalogue truncated', { totalPages: 1_000_000_000, cap: 10 })
    warn.mockRestore()
  })

  it('reads a missing or malformed totalPages as one page', () => {
    for (const value of [undefined, null, '3', 0, -2, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(cataloguePages(value)).toBe(1)
    }
    expect(cataloguePages(3)).toBe(3)
    expect(cataloguePages(60)).toBe(10)
  })

  it('refuses an answer body over the byte cap, without retrying', async () => {
    const big = JSON.stringify({ success: true, responseObject: { pad: 'x'.repeat(200) } })
    const fetchSpy = vi.fn(async () => new Response(big, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    await expect(upstreamWith({ maxResponseBytes: 100 }).get('/big', 60)).rejects.toThrow(/not answering right now/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('refuses a declared content-length over the byte cap, cancelling the unread body', async () => {
    const pull = vi.fn()
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 })
    const fetchSpy = vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-length': '101' } }))
    vi.stubGlobal('fetch', fetchSpy)
    await expect(upstreamWith({ maxResponseBytes: 100 }).get('/declared', 60)).rejects.toThrow(/not answering/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(pull).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('accepts a body at the byte cap, split across chunks', async () => {
    const body = JSON.stringify({ success: true, responseObject: { name: 'Négroni' } })
    const bytes = new TextEncoder().encode(body)
    vi.stubGlobal('fetch', async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 7))
          controller.enqueue(bytes.slice(7))
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    })
    expect(await upstreamWith({ maxResponseBytes: bytes.byteLength }).get('/exact', 60)).toEqual({ name: 'Négroni' })
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

describe('widget image URLs', () => {
  it('encodes apostrophes, keeps other image URLs, refuses other hosts', async () => {
    const { widgetImageUrl } = await import('../src/service')
    expect(widgetImageUrl("https://images.fixmeadrinkapp.com/cocktail-images/2819-Buck's_Fizz.jpeg")).toBe(
      'https://images.fixmeadrinkapp.com/cocktail-images/2819-Buck%27s_Fizz.jpeg'
    )
    expect(widgetImageUrl('https://images.fixmeadrinkapp.com/cocktail-images/5049-Cucumber_&_Mint_Seltz.jpeg')).toBe(
      'https://images.fixmeadrinkapp.com/cocktail-images/5049-Cucumber_&_Mint_Seltz.jpeg'
    )
    expect(widgetImageUrl('https://images.fixmeadrinkapp.com/a b.jpeg')).toBe('https://images.fixmeadrinkapp.com/a%20b.jpeg')
    expect(widgetImageUrl('https://images.fixmeadrinkapp.com.evil.test/x.jpeg')).toBeNull()
    expect(widgetImageUrl('https://example.com/x.jpeg')).toBeNull()
  })
})
