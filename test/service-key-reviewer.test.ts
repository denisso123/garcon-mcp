import { afterEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import worker from '../src/index'
import { Upstream } from '../src/upstream'
import { bourbonBar } from './data'
import { FakeApi, envelope, setup, text, tool } from './harness'

afterEach(() => vi.unstubAllGlobals())
const makeUp = (baseUrl: string, apiKey?: string, permit = async () => true) =>
  new Upstream({ baseUrl, apiKey, cache: null, permit, waitUntil: () => {} })

it.each([401, 403])('fails once with a generic error on %s, with no unauthenticated retry or log', async status => {
  const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(new Response('secret echoed by backend: dummy-review-key', { status }))
  vi.stubGlobal('fetch', fetchSpy)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(makeUp(`https://reject-${status}.test`, 'dummy-review-key').get('/test', 1))
    .rejects.toThrow('The Garçon recipe service is not answering right now. Try again shortly.')
  expect(fetchSpy).toHaveBeenCalledTimes(1)
  expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).get('X-Service-Key')).toBe('dummy-review-key')
  expect(log).not.toHaveBeenCalled()
  log.mockRestore()
})

it.each([401, 403])('all four tools fail on cold requests if upstream rejects every key with %s', async status => {
  for (const [name, args] of [
    ['find_cocktails_by_ingredients', { ingredients: ['Bourbon'] }],
    ['get_cocktail_recipe', { name: 'Old Fashioned' }],
    ['explain_bar_term', { term: 'mezcal' }],
    ['suggest_similar_cocktail', { name: 'Old Fashioned' }],
  ] as const) {
    const original = setup(new FakeApi(bourbonBar()), worker)
    const h = { ...original, env: { ...original.env, MCP_API_KEY: 'dummy-review-key' } }
    h.api.override('/', () => new Response('dummy-review-key', { status }))
    const result = await tool(h, name, args)
    expect(result.isError, name).toBe(true)
    expect(text(result)).toBe('The Garçon recipe service is not answering right now. Try again shortly.')
    expect(JSON.stringify(result)).not.toContain('dummy-review-key')
  }
})

it('keeps upstream limiter active even with the service key', async () => {
  const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(envelope({ ok: true }))
  vi.stubGlobal('fetch', fetchSpy)
  await expect(makeUp('https://limit-review.test', 'dummy-review-key', async () => false).get('/test', 1))
    .rejects.toThrow('handling a lot of requests')
  expect(fetchSpy).not.toHaveBeenCalled()
})

it('SECURITY: must not forward the key to a cross-origin redirect target', async () => {
  vi.unstubAllGlobals()
  let received: string | undefined
  const target = createServer((req: any, res: any) => {
    received = req.headers['x-service-key']
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ success: true, responseObject: { ok: true } }))
  })
  await new Promise<void>(resolve => target.listen(0, resolve))
  const source = createServer((_req: any, res: any) => {
    res.writeHead(302, { Location: `http://localhost:${(target.address() as {port: number}).port}/received` })
    res.end()
  })
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve))
  try {
    // The cross-origin redirect is now refused as an upstream error; what matters is that the key never arrives.
    await expect(makeUp(`http://127.0.0.1:${(source.address() as {port: number}).port}`, 'dummy-review-key').get('/redirect', 1))
      .rejects.toThrow('not answering right now')
    expect(received, 'X-Service-Key reached a hostname outside the configured origin').toBeUndefined()
  } finally {
    await Promise.all([source, target].map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))))
  }
})
