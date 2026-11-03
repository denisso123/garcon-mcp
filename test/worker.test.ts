import { afterEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { findOutput } from '../src/schemas'
import { bourbonBar } from './data'
import { type Era, FakeApi, type Route, call, connect, fakeLimiter, post, rpcBody, setup } from './harness'
import { vi } from 'vitest'

const WIDGET_URI = 'ui://ask-garcon/cocktail-list-v2.html' // audit 3, finding 5

afterEach(() => {
  vi.unstubAllGlobals()
})

function toolsCall(id: unknown = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'get_cocktail_recipe', arguments: { name: 'Old Fashioned' } },
  }
}

describe('API service identity', () => {
  it.each(['/mcp', '/chatgpt/mcp'])('uses the configured secret on %s rather than an incoming header', async (route) => {
    const original = setup(new FakeApi(bourbonBar()), worker)
    const h = { ...original, env: { ...original.env, MCP_API_KEY: 'mcp-server-secret' } }
    const headers: (string | null)[] = []
    h.api.override('/cocktails', (request) => {
      headers.push(request.headers.get('X-Service-Key'))
      return h.api.handleDefault(request)
    })
    const response = await post(h, toolsCall(), { route, headers: { 'X-Service-Key': 'caller-supplied' } })
    expect(response.status).toBe(200)
    expect(headers.length).toBeGreaterThan(0)
    expect(headers.every((key) => key === 'mcp-server-secret')).toBe(true)
    expect(await response.text()).not.toContain('mcp-server-secret')
  })
})

describe('protocol eras and routes', () => {
  const cases: [Era, Route][] = [
    ['legacy', '/mcp'],
    ['legacy', '/chatgpt/mcp'],
    ['modern', '/mcp'],
    ['modern', '/chatgpt/mcp'],
  ]

  it.each(cases)('serves a %s client on %s', async (era, route) => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    const client = await connect(h, era, route)

    expect(client.serverInfo()?.icons).toEqual([
      { src: 'https://mcp.fixmeadrinkapp.com/images/ask-garcon-icon.png', mimeType: 'image/png', sizes: ['128x128'] },
    ])
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'explain_bar_term',
      'find_cocktails_by_ingredients',
      'get_cocktail_recipe',
      'suggest_similar_cocktail',
    ])
    for (const t of tools) {
      expect(t.title).toBeTruthy()
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false })
      expect(t.inputSchema).toMatchObject({ additionalProperties: false })
      expect(t.outputSchema).toBeTruthy()
    }
    const find = tools.find((t) => t.name === 'find_cocktails_by_ingredients')!
    expect(find._meta).toMatchObject({ ui: { resourceUri: WIDGET_URI }, 'openai/outputTemplate': WIDGET_URI })

    const { contents } = await client.readResource(WIDGET_URI)
    expect(contents[0].mimeType).toBe('text/html;profile=mcp-app')
    const ui = contents[0]._meta?.ui as { domain?: string; csp: { resourceDomains: string[] } }
    expect(ui.csp.resourceDomains).toEqual(['https://images.fixmeadrinkapp.com', 'https://mcp.fixmeadrinkapp.com'])
    // Brand fonts everywhere except ChatGPT, whose UI guidelines ask for system fonts.
    const html = (contents[0] as { text: string }).text
    expect(html.includes('@font-face')).toBe(route !== '/chatgpt/mcp')
    expect(ui.domain).toBe(route === '/chatgpt/mcp' ? 'https://mcp.fixmeadrinkapp.com' : undefined)

    const result = await client.callTool('find_cocktails_by_ingredients', { ingredients: ['bourbon', 'sugar', 'bitters'] })
    expect(result.isError).toBeFalsy()
    expect(findOutput.parse(result.structuredContent).cocktails[0].name).toBe('Old Fashioned')

    if (era === 'legacy') expect(client.protocolHeaders.every((v) => v.startsWith('2025-'))).toBe(true)
    else expect(client.protocolHeaders).toContain('2026-07-28')
    await client.close()
  })

  it('treats a trailing slash like the bare route', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    for (const route of ['/mcp/', '/chatgpt/mcp/']) {
      const body = await rpcBody(await post(h, toolsCall(), { route }))
      expect(body.result?.isError).toBeFalsy()
    }
  })
})

describe('ingress', () => {
  it('answers a CORS preflight', async () => {
    const h = setup(new FakeApi(), worker)
    const response = await call(h, new Request('https://mcp.test/mcp', { method: 'OPTIONS' }))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('access-control-allow-headers')).toContain('mcp-protocol-version')
  })

  it('rejects the wrong method, content type or declared size before counting the IP', async () => {
    const h = setup(new FakeApi(), worker)
    const get = await call(h, new Request('https://mcp.test/mcp'))
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST, OPTIONS')

    const form = await post(h, 'a=1', { headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    expect(form.status).toBe(415)

    const big = await post(h, JSON.stringify(toolsCall()), { headers: { 'content-length': String(65 * 1024) } })
    expect(big.status).toBe(413)

    for (const response of [get, form, big]) {
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect((await rpcBody(response)).id).toBeNull()
    }
    expect(h.env.IP_LIMITER.keys).toEqual([])
  })

  it('caps a streamed body that declares no length', async () => {
    const h = setup(new FakeApi(), worker)
    const chunk = new TextEncoder().encode(' '.repeat(16 * 1024))
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 8) controller.enqueue(chunk)
        else controller.close()
      },
    })
    const response = await call(
      h,
      new Request('https://mcp.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        duplex: 'half',
      } as RequestInit)
    )
    expect(response.status).toBe(413)
    expect(sent).toBeLessThanOrEqual(6)
  })

  it('rejects invalid JSON with a parse error', async () => {
    const h = setup(new FakeApi(), worker)
    const response = await post(h, '{"jsonrpc":')
    expect(response.status).toBe(400)
    expect((await rpcBody(response)).error?.code).toBe(-32700)
  })

  it('rejects JSON-RPC batches without running any of them', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    const response = await post(h, [1, 2, 3, 4, 5].map(toolsCall))
    expect(response.status).toBe(400)
    expect(await rpcBody(response)).toMatchObject({ id: null, error: { code: -32600 } })
    expect(h.api.calls).toEqual([])
  })

  it('limits every request by IP, whether or not it sends openai/subject', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    h.env.IP_LIMITER.allow = 1
    expect((await post(h, toolsCall())).status).toBe(200)
    const limited = await post(h, toolsCall(5))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect(limited.headers.get('access-control-allow-origin')).toBe('*')
    expect(limited.headers.get('access-control-expose-headers')).toContain('retry-after')
    expect(await rpcBody(limited)).toMatchObject({ id: null, error: { code: -32000 } })
  })

  it('adds a per-user limit for openai/subject and echoes only valid ids', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    h.env.CALLER_LIMITER.allow = 0
    const withSubject = (id: unknown) => ({
      ...toolsCall(id),
      params: { ...toolsCall().params, _meta: { 'openai/subject': 'user-1' } },
    })
    const limited = await post(h, withSubject(7))
    expect(limited.status).toBe(429)
    expect((await rpcBody(limited)).id).toBe(7)
    expect((await rpcBody(await post(h, withSubject({ invalid: true })))).id).toBeNull()
    expect(h.env.CALLER_LIMITER.keys).toEqual(['sub:user-1', 'sub:user-1'])
    expect(h.env.IP_LIMITER.keys).toHaveLength(2)

    const anonymous = await post(h, toolsCall())
    expect(anonymous.status).toBe(200)
    expect(h.env.IP_LIMITER.keys).toHaveLength(3)
  })

  it('keeps serving when a limiter binding fails', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    const broken = fakeLimiter()
    broken.limit = async () => {
      throw new Error('binding down')
    }
    Object.assign(h.env, { IP_LIMITER: broken })
    expect((await post(h, toolsCall())).status).toBe(200)
  })
})

describe('origin and request body (audit 2, findings 5 and 6)', () => {
  it('rejects a browser Origin that is not allowed, before reading the body', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    for (const origin of ['https://attacker.invalid', 'null', 'not an origin', 'https://claude.ai']) {
      let read = false
      const body = new ReadableStream({
        pull(controller) {
          read = true
          controller.enqueue(new TextEncoder().encode(JSON.stringify(toolsCall())))
          controller.close()
        },
      })
      const response = await call(
        h,
        new Request('https://mcp.test/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin },
          body,
          duplex: 'half',
        } as RequestInit)
      )
      expect(response.status, origin).toBe(403)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect((await rpcBody(response)).error?.code).toBe(-32000)
      expect(read, origin).toBe(false)
    }
    expect(h.api.calls).toEqual([])
    expect(h.env.IP_LIMITER.keys).toEqual([])
  })

  it('serves requests without an Origin (ChatGPT and Claude call server to server) and from localhost tools', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    expect((await post(h, toolsCall())).status).toBe(200)
    expect((await post(h, toolsCall(), { headers: { origin: 'http://localhost:6274' } })).status).toBe(200)
  })

  it('answers a request body that fails mid-upload with a JSON-RPC error and the common headers', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"jsonrpc":'))
        controller.error(new Error('upload failed'))
      },
    })
    const response = await call(
      h,
      new Request('https://mcp.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body,
        duplex: 'half',
      } as RequestInit)
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await rpcBody(response)).toMatchObject({ id: null, error: { code: -32000 } })
  })

  it('cancels an oversized streamed body, and a failing cancel does not escape', async () => {
    const h = setup(new FakeApi(bourbonBar()), worker)
    let cancelled = 0
    const chunk = new Uint8Array(16 * 1024).fill(32)
    const body = new ReadableStream({
      pull(controller) {
        controller.enqueue(chunk)
      },
      cancel() {
        cancelled++
        throw new Error('cancel failed')
      },
    })
    const response = await call(
      h,
      new Request('https://mcp.test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body,
        duplex: 'half',
      } as RequestInit)
    )
    expect(response.status).toBe(413)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(cancelled).toBe(1)
  })
})

describe('pages', () => {
  it('serves the landing page, privacy notice and domain challenge, and 404s the rest', async () => {
    const h = setup(new FakeApi(), worker)
    const get = (path: string) => call(h, new Request(`https://mcp.test${path}`))
    expect(await (await get('/')).text()).toContain('Ask Garçon')
    expect(await (await get('/privacy')).text()).toContain('privacy notice')
    expect((await get('/.well-known/openai-apps-challenge')).status).toBe(404)
    Object.assign(h.env, { OPENAI_APPS_CHALLENGE: 'token-123' })
    expect(await (await get('/.well-known/openai-apps-challenge')).text()).toBe('token-123')
    expect((await get('/nope')).status).toBe(404)
  })
})
