// Runs the widget's complete embedded script (CONFIG, VIEW_JS and BOOT_JS,
// exactly as served) against a small fake DOM and a fake host, so the
// message handling, initialisation, link opening and timeouts are tested as
// shipped rather than through the view functions alone.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { widgetHtml } from '../src/widget'

afterEach(() => {
  vi.useRealTimers()
})

type Listener = (event: Record<string, unknown>) => void

class FakeElement {
  innerHTML = ''
  textContent = ''
  hidden = true
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, Listener[]>()
  readonly style = { setProperty: (name: string, value: string) => this.attributes.set(`style:${name}`, value) }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  querySelectorAll() {
    return []
  }
  getBoundingClientRect() {
    return { height: 480 }
  }
  dispatch(type: string, event: Record<string, unknown>) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

/** A clicked element: `closest` finds the link or button the click landed in. */
function target(selectorMatch: string, attributes: Record<string, string>) {
  return {
    closest: (selector: string) =>
      selector.includes(selectorMatch) ? { getAttribute: (name: string) => attributes[name] ?? null } : null,
  }
}

function boot(options: { openai?: Record<string, unknown>; standalone?: boolean } = {}) {
  const html = widgetHtml({ brandFonts: true })
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))
  const elements = { root: new FakeElement(), live: new FakeElement(), 'link-help': new FakeElement() }
  const documentElement = new FakeElement()
  const posted: Record<string, unknown>[] = []
  const windowListeners = new Map<string, Listener[]>()
  const parent = { postMessage: (message: Record<string, unknown>) => posted.push(message) }
  const fakeWindow: Record<string, unknown> & { open: ReturnType<typeof vi.fn> } = {
    parent,
    openai: options.openai,
    open: vi.fn(() => ({})),
    matchMedia: () => ({ matches: true }),
    addEventListener: (type: string, listener: Listener) =>
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), listener]),
  }
  const fakeDocument = {
    documentElement,
    body: new FakeElement(),
    getElementById: (id: keyof typeof elements) => elements[id],
    createElement: () => new FakeElement(),
  }
  if (options.standalone) fakeWindow.parent = fakeWindow
  new Function('window', 'document', script)(fakeWindow, fakeDocument)

  const fromHost = (data: Record<string, unknown>) => {
    for (const listener of windowListeners.get('message') ?? []) listener({ source: parent, data: { jsonrpc: '2.0', ...data } })
  }
  const requests = (method: string) => posted.filter((message) => message.method === method && 'id' in message)
  const answer = (method: string, result: unknown) => {
    const request = requests(method).at(-1)!
    fromHost({ id: request.id, result })
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const globalsArrive = (openai: Record<string, unknown>) => {
    fakeWindow.openai = openai
    for (const listener of windowListeners.get('openai:set_globals') ?? []) listener({})
  }
  const clickCard = () =>
    elements.root.dispatch('click', { target: target('a[data-href]', { 'data-href': RECIPE_URL }), preventDefault: vi.fn() })
  return { elements, documentElement, posted, fromHost, requests, answer, settle, fakeWindow, globalsArrive, clickCard }
}

const RESULT = {
  structuredContent: {
    bar: { recognised: [{ you_said: 'gin', matched_as: ['London dry gin'] }], not_recognised: [] },
    cocktails: [
      {
        name: 'Churchill Martini',
        url: 'https://fixmeadrinkapp.com/recipes/churchill-martini',
        strength: 'Strong',
        flavors: ['Herbal'],
        have: ['London dry gin'],
        missing: [],
        can_make_now: true,
      },
    ],
    low_proof_options: [],
    more_ideas_url: 'https://fixmeadrinkapp.com/free-tools/cocktail-by-ingredients',
  },
}
const RECIPE_URL = 'https://fixmeadrinkapp.com/recipes/churchill-martini'

describe('widget script in a host', () => {
  it('initialises, follows the host theme, renders loading then the result, and reports its size', async () => {
    const w = boot()
    expect(w.requests('ui/initialize')).toHaveLength(1)
    w.answer('ui/initialize', { hostContext: { theme: 'dark', safeAreaInsets: { top: 4 } }, hostCapabilities: {} })
    await w.settle()
    expect(w.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(w.documentElement.getAttribute('style:--safe-top')).toBe('4px')
    expect(w.posted.some((m) => m.method === 'ui/notifications/initialized')).toBe(true)

    w.fromHost({ method: 'ui/notifications/tool-input', params: { arguments: { ingredients: ['gin'] } } })
    expect(w.elements.root.innerHTML).toContain('class="skeleton"')
    expect(w.elements.root.getAttribute('aria-busy')).toBe('true')

    w.fromHost({ method: 'ui/notifications/tool-result', params: RESULT })
    expect(w.elements.root.innerHTML).toContain('Churchill Martini</h3>')
    expect(w.elements.live.textContent).toBe('1 drink found.')
    expect(w.posted.filter((m) => m.method === 'ui/notifications/size-changed').at(-1)).toMatchObject({ params: { height: 480 } })

    w.fromHost({ method: 'ui/notifications/host-context-changed', params: { theme: 'light' } })
    expect(w.documentElement.getAttribute('data-theme')).toBe('light')
    w.fromHost({ method: 'ui/notifications/tool-cancelled', params: {} })
    expect(w.elements.root.innerHTML).toBe('<p class="lead">Search cancelled.</p>')
  })

  it('opens a card through ui/open-link when the host offers it, and stops at a refusal', async () => {
    const w = boot()
    w.answer('ui/initialize', { hostContext: {}, hostCapabilities: { openLinks: {} } })
    await w.settle()
    const click = { target: target('a[data-href]', { 'data-href': RECIPE_URL }), preventDefault: vi.fn() }
    w.elements.root.dispatch('click', click)
    expect(click.preventDefault).toHaveBeenCalled()
    await w.settle()
    expect(w.requests('ui/open-link').at(-1)).toMatchObject({ params: { url: RECIPE_URL } })
    w.answer('ui/open-link', { isError: true })
    await w.settle()
    expect(w.fakeWindow.open).not.toHaveBeenCalled()
    expect(w.elements['link-help'].hidden).toBe(true)
  })

  it('offers a retry and a copyable URL when the host never answers, without opening anything itself', async () => {
    vi.useFakeTimers()
    const w = boot()
    w.answer('ui/initialize', { hostContext: {}, hostCapabilities: { openLinks: {} } })
    await vi.advanceTimersByTimeAsync(0)
    w.elements.root.dispatch('click', { target: target('a[data-href]', { 'data-href': RECIPE_URL }), preventDefault: vi.fn() })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(w.fakeWindow.open).not.toHaveBeenCalled()
    expect(w.elements['link-help'].hidden).toBe(false)
    expect(w.elements['link-help'].innerHTML).toContain(`<span class="copy-url">${RECIPE_URL}</span>`)

    w.elements['link-help'].dispatch('click', { target: target('button[data-retry]', { 'data-retry': RECIPE_URL }) })
    await vi.advanceTimersByTimeAsync(0)
    expect(w.requests('ui/open-link')).toHaveLength(2)
    w.answer('ui/open-link', {})
    await vi.advanceTimersByTimeAsync(0)
    expect(w.elements['link-help'].hidden).toBe(true)
  })

  it('uses ChatGPT openExternal when the host has no open-link capability', async () => {
    const openExternal = vi.fn()
    const w = boot({ openai: { openExternal } })
    w.answer('ui/initialize', { hostContext: {}, hostCapabilities: {} })
    await w.settle()
    w.elements.root.dispatch('click', { target: target('a[data-href]', { 'data-href': RECIPE_URL }), preventDefault: vi.fn() })
    await w.settle()
    expect(openExternal).toHaveBeenCalledWith({ href: RECIPE_URL })
    expect(w.requests('ui/open-link')).toHaveLength(0)
  })

  it('never opens a link that is not on fixmeadrinkapp.com', async () => {
    const w = boot()
    w.answer('ui/initialize', { hostContext: {}, hostCapabilities: { openLinks: {} } })
    await w.settle()
    w.elements.root.dispatch('click', { target: target('a[data-href]', { 'data-href': 'https://evil.example/' }), preventDefault: vi.fn() })
    expect(w.requests('ui/open-link')).toHaveLength(0)
  })

  it('opens with window.open outside a host, even after the initialisation timeout (audit 4, finding 2)', async () => {
    vi.useFakeTimers()
    const w = boot({ standalone: true })
    await vi.advanceTimersByTimeAsync(5_000)
    w.clickCard()
    await vi.advanceTimersByTimeAsync(0)
    expect(w.fakeWindow.open).toHaveBeenCalledWith(RECIPE_URL, '_blank', 'noopener')
    expect(w.elements['link-help'].hidden).toBe(true)
  })

  it('accepts a late initialisation answer (audit 4, finding 2)', async () => {
    vi.useFakeTimers()
    const w = boot()
    await vi.advanceTimersByTimeAsync(5_000)
    w.answer('ui/initialize', { hostContext: { theme: 'dark' }, hostCapabilities: { openLinks: {} } })
    await vi.advanceTimersByTimeAsync(0)
    expect(w.documentElement.getAttribute('data-theme')).toBe('dark')
    w.clickCard()
    await vi.advanceTimersByTimeAsync(0)
    expect(w.requests('ui/open-link')).toHaveLength(1)
  })

  it('retries initialisation from "Try again" when it never answered, then opens (audit 4, finding 2)', async () => {
    vi.useFakeTimers()
    const w = boot()
    await vi.advanceTimersByTimeAsync(5_000)
    w.clickCard()
    expect(w.requests('ui/initialize')).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(w.elements['link-help'].hidden).toBe(false)
    expect(w.requests('ui/open-link')).toHaveLength(0)

    w.elements['link-help'].dispatch('click', { target: target('button[data-retry]', { 'data-retry': RECIPE_URL }) })
    expect(w.requests('ui/initialize')).toHaveLength(3)
    w.answer('ui/initialize', { hostContext: {}, hostCapabilities: { openLinks: {} } })
    await vi.advanceTimersByTimeAsync(0)
    expect(w.requests('ui/open-link')).toHaveLength(1)
    w.answer('ui/open-link', { isError: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(w.fakeWindow.open).not.toHaveBeenCalled()
    expect(w.elements['link-help'].hidden).toBe(true)
  })

  it('uses openExternal when the ChatGPT globals arrive after boot (audit 4, finding 3)', async () => {
    const openExternal = vi.fn()
    const w = boot()
    w.globalsArrive({ openExternal })
    w.answer('ui/initialize', { hostContext: {}, hostCapabilities: {} })
    await w.settle()
    w.clickCard()
    await w.settle()
    expect(openExternal).toHaveBeenCalledWith({ href: RECIPE_URL })
    expect(w.elements['link-help'].hidden).toBe(true)
  })

  it('re-selects the opener when the globals arrive after a failed initialisation (audit 4, finding 3)', async () => {
    vi.useFakeTimers()
    const openExternal = vi.fn()
    const w = boot()
    await vi.advanceTimersByTimeAsync(5_000)
    w.globalsArrive({ openExternal })
    w.clickCard()
    await vi.advanceTimersByTimeAsync(0)
    expect(openExternal).toHaveBeenCalledWith({ href: RECIPE_URL })
  })
})
