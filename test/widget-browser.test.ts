// The widget resource as served, in Chrome for Testing (Playwright), inside a
// sandboxed srcdoc iframe with the resource's own CSP, the way MCP Apps hosts
// render it. Covers what a fake DOM cannot: carousel wiring, focus, scroll
// boundaries, the grid switch, fonts and CSP.

import { existsSync, readFileSync } from 'node:fs'
import { type Browser, type Frame, chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { FakeApi, post, rpcBody, setup } from './harness'

const URI = 'ui://ask-garcon/cocktail-list-v2.html'
const MCP = 'https://mcp.fixmeadrinkapp.com'
const IMAGES = 'https://images.fixmeadrinkapp.com'
const PUBLIC = new URL('../public/', import.meta.url)
const available = existsSync(chromium.executablePath())

interface Resource {
  text: string
  csp: { resourceDomains: string[] }
}

async function servedResource(route: '/mcp' | '/chatgpt/mcp'): Promise<Resource> {
  const h = setup(new FakeApi(), worker)
  const body = await rpcBody(await post(h, { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: URI } }, { route }))
  const content = (body.result as { contents: { text: string; _meta: { ui: { csp: Resource['csp'] } } }[] }).contents[0]
  return { text: content.text, csp: content._meta.ui.csp }
}

const card = (i: number) => ({
  name: `Drink ${i}`,
  url: `https://fixmeadrinkapp.com/recipes/drink-${i}`,
  strength: 'Medium',
  flavors: ['Citrusy'],
  have: ['Gin'],
  missing: i === 0 ? [] : ['Mint leaves'],
  can_make_now: i === 0,
})
const RESULT = {
  structuredContent: {
    bar: { recognised: [{ you_said: 'gin', matched_as: ['Gin'] }], not_recognised: [] },
    cocktails: [0, 1, 2, 3, 4].map(card),
    low_proof_options: [card(5)],
    more_ideas_url: 'https://fixmeadrinkapp.com/free-tools/cocktail-by-ingredients',
  },
  _meta: { images: Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [card(i).url, `${IMAGES}/drink-${i}.webp`])) },
}

/** The host page: applies the CSP the way a host does, answers ui/initialize and sends the result. */
function hostPage(resource: Resource, width: number) {
  const res = resource.csp.resourceDomains.join(' ')
  const policy = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${res}`,
    `style-src 'unsafe-inline' ${res}`,
    `img-src data: ${res}`,
    `font-src ${res}`,
    "connect-src 'none'",
  ].join('; ')
  const srcdoc = resource.text.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`)
  return `<!doctype html><html><body style="margin:0">
<iframe id="f" sandbox="allow-scripts allow-popups" style="border:0;width:${width}px;height:900px"></iframe>
<script>
const frame = document.getElementById('f')
window.opened = []
window.addEventListener('message', (e) => {
  const m = e.data
  const post = (msg) => frame.contentWindow.postMessage({ jsonrpc: '2.0', ...msg }, '*')
  if (m.method === 'ui/initialize') post({ id: m.id, result: { hostCapabilities: { openLinks: {} }, hostContext: { theme: 'light' } } })
  if (m.method === 'ui/notifications/initialized') {
    post({ method: 'ui/notifications/tool-input', params: { arguments: { ingredients: ['gin'] } } })
    post({ method: 'ui/notifications/tool-result', params: ${JSON.stringify(RESULT)} })
  }
  if (m.method === 'ui/open-link') { window.opened.push(m.params.url); post({ id: m.id, result: {} }) }
})
frame.srcdoc = ${JSON.stringify(srcdoc).replace(/</g, '\\u003c')}
</script></body></html>`
}

describe.skipIf(!available)('widget in Chrome for Testing', { timeout: 30_000 }, () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch()
  })
  afterAll(async () => {
    await browser?.close()
  })

  async function open(width: number, resource?: Resource) {
    const served = resource ?? (await servedResource('/mcp'))
    const page = await browser.newPage({ viewport: { width: width + 40, height: 1000 } })
    const violations: string[] = []
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text())
    })
    await page.route(`${MCP}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname.slice(1)
      const file = new URL(path, PUBLIC)
      if (!existsSync(file)) return route.fulfill({ status: 404 })
      const type = path.endsWith('.woff2') ? 'font/woff2' : 'image/webp'
      await route.fulfill({ body: readFileSync(file), contentType: type, headers: { 'access-control-allow-origin': '*' } })
    })
    await page.route(`${IMAGES}/**`, (route) =>
      route.fulfill({ body: readFileSync(new URL('images/recipe-placeholder.webp', PUBLIC)), contentType: 'image/webp' })
    )
    await page.route('https://host.test/', (route) => route.fulfill({ body: hostPage(served, width), contentType: 'text/html' }))
    await page.goto('https://host.test/')
    let frame: Frame | undefined
    await expect.poll(() => (frame = page.frames().find((f) => f.url() === 'about:srcdoc'))).toBeTruthy()
    await frame!.waitForSelector('#s-bar-list a.card')
    await frame!.evaluate('document.fonts.ready.then(() => true)')
    return { page, frame: frame!, violations }
  }

  // Expressions run in the widget frame. Strings, because this project's
  // types are the Workers runtime's, not the DOM's.
  const js = <T>(frame: Frame, expression: string) => frame.evaluate(expression) as Promise<T>
  const scrollLeft = (frame: Frame) => js<number>(frame, "document.getElementById('s-bar-list').scrollLeft")
  const disabled = (frame: Frame, step: number) =>
    js<boolean>(frame, `document.querySelector('section[aria-labelledby="s-bar"] [data-step="${step}"]').disabled`)
  const stepperHidden = (frame: Frame) =>
    js<boolean>(frame, `getComputedStyle(document.querySelector('section[aria-labelledby="s-bar"] .stepper')).display === 'none'`)
  const focusedName = (frame: Frame) => js<string>(frame, "document.activeElement.querySelector('h3').textContent")

  it('wires the arrow buttons to the carousel and disables them at each end', async () => {
    const { page, frame } = await open(420)
    expect(await stepperHidden(frame)).toBe(false)
    expect(await disabled(frame, -1)).toBe(true)
    expect(await disabled(frame, 1)).toBe(false)

    const second = await js<number>(frame, "(() => { const li = document.querySelectorAll('#s-bar-list > li'); return li[1].offsetLeft - li[0].offsetLeft })()")
    await frame.click('section[aria-labelledby="s-bar"] [data-step="1"]')
    await expect.poll(() => scrollLeft(frame)).toBe(second)
    expect(await disabled(frame, -1)).toBe(false)

    await frame.focus('#s-bar-list')
    await page.keyboard.press('End')
    await expect.poll(() => disabled(frame, 1)).toBe(true)
    await page.keyboard.press('Home')
    await expect.poll(() => scrollLeft(frame)).toBe(0)
    await page.close()
  })

  it('moves focus card by card with the arrow keys and keeps the focused card in view', async () => {
    const { page, frame } = await open(420)
    await frame.focus('#s-bar-list a.card')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    expect(await focusedName(frame)).toBe('Drink 2')
    await expect
      .poll(() =>
        js<boolean>(
          frame,
          "(() => { const list = document.getElementById('s-bar-list').getBoundingClientRect(); const card = document.activeElement.getBoundingClientRect(); return card.left >= list.left - 1 && card.right <= list.right + 1 })()"
        )
      )
      .toBe(true)
    await page.keyboard.press('ArrowLeft')
    expect(await focusedName(frame)).toBe('Drink 1')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.evaluate('window.opened')).toEqual([
      'https://fixmeadrinkapp.com/recipes/drink-1',
    ])
    await page.close()
  })

  it('becomes the site grid at 760 px: two columns, no arrows, arrow keys leave the page alone', async () => {
    const { page, frame } = await open(760)
    expect(await js<number>(frame, "getComputedStyle(document.getElementById('s-bar-list')).gridTemplateColumns.split(' ').length")).toBe(2)
    expect(await stepperHidden(frame)).toBe(true)
    await frame.focus('#s-bar-list')
    await page.keyboard.press('ArrowRight')
    expect(await scrollLeft(frame)).toBe(0)
    await page.close()
  })

  it('loads its fonts and images under the served CSP without a violation', async () => {
    const { page, frame, violations } = await open(420)
    expect(await js<boolean>(frame, `document.fonts.check('600 19px "DM Sans Garcon"') && document.fonts.check('15px "Inter Garcon"')`)).toBe(true)
    expect(await js<boolean>(frame, "document.querySelector('#s-bar-list img.photo').naturalWidth > 0")).toBe(true)
    expect(violations).toEqual([])
    await page.close()
  })

  it('reports a CSP violation when the asset origin is left out (control)', async () => {
    const served = await servedResource('/mcp')
    const { page, violations } = await open(420, { ...served, csp: { resourceDomains: [IMAGES] } })
    await expect.poll(() => violations.length).toBeGreaterThan(0)
    await page.close()
  })

  it('loads no custom font on the ChatGPT route', async () => {
    const { page, frame, violations } = await open(420, await servedResource('/chatgpt/mcp'))
    expect(await js<number>(frame, '[...document.fonts].length')).toBe(0)
    expect(violations).toEqual([])
    await page.close()
  })
})
