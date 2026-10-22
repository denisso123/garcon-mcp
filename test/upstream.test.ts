import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { bourbonBar } from './data'
import { FakeApi, FakeCache, envelope, setup, text, tool } from './harness'

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
  it('waits out a short Retry-After on a 429 and retries once', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    failCatalogue(h.api, 1, () => new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }))
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

  it('counts a timeout while reading the body as a failed attempt', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    failCatalogue(h.api, 1, () => {
      const body = new ReadableStream({
        start(controller) {
          controller.error(new DOMException('The operation timed out.', 'TimeoutError'))
        },
      })
      return new Response(body, { headers: { 'content-type': 'application/json' } })
    })
    const result = await tool(h, 'get_cocktail_recipe', RECIPE)
    expect(result.isError).toBeFalsy()
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

  it('stops retrying at the call deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const h = setup(new FakeApi(bourbonBar()), worker)
    failCatalogue(h.api, 9, () => {
      vi.setSystemTime(Date.now() + 25_000)
      return new Response('down', { status: 503 })
    })
    const result = await tool(h, 'get_cocktail_recipe', RECIPE)
    expect(text(result)).toMatch(/too slow/)
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
