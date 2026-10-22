import { describe, expect, it, vi } from 'vitest'
import { TOKENS_CSS } from '../src/brand'
import { VIEW_JS, type ViewConfig, widgetHtml } from '../src/widget'

interface View {
  esc(value: unknown): string
  isRecipeUrl(url: unknown): boolean
  loading(): string
  results(data: unknown, meta?: unknown, args?: unknown): string
  error(text: string): string
  cancelled(): string
  summary(result: unknown): string
  linkHelp(url: string): string
  fromToolResult(result: unknown, args?: unknown): string
}
type LinkDeps = {
  mode: () => string
  request: (method: string, params: unknown, timeoutMs?: number) => Promise<unknown>
  openai?: unknown
  open: (url: string) => unknown
}

// The view runs in the host's iframe as plain script; run the same source here.
const factory = new Function(
  `${VIEW_JS}; return { garconView: garconView, garconLinks: garconLinks, garconCarousel: garconCarousel }`
)() as {
  garconView(config: ViewConfig): View
  garconLinks(deps: LinkDeps): (url: string) => Promise<'opened' | 'refused' | 'failed'>
  garconCarousel(scroller: FakeScroller, smooth: boolean): Carousel
}

interface Carousel {
  step(direction: number): number
  onKey(event: { key: string; target: unknown; preventDefault(): void }): boolean
  state(): { scrollable: boolean; atStart: boolean; atEnd: boolean }
}

interface FakeCard {
  parentNode: { offsetLeft: number }
  focus: ReturnType<typeof vi.fn>
}

interface FakeScroller {
  scrollLeft: number
  clientWidth: number
  scrollWidth: number
  querySelectorAll(selector: string): FakeCard[]
  scrollTo: ReturnType<typeof vi.fn>
}

/** A carousel list with `count` cards 300 px apart (284 px cards, 16 px gap) in a 400 px viewport. */
function fakeShelf(count: number, clientWidth = 400): { scroller: FakeScroller; cards: FakeCard[] } {
  const cards = Array.from({ length: count }, (_, i) => ({ parentNode: { offsetLeft: 16 + i * 300 }, focus: vi.fn() }))
  const scroller: FakeScroller = {
    scrollLeft: 0,
    clientWidth,
    scrollWidth: 32 + count * 300 - 16,
    querySelectorAll: () => cards,
    scrollTo: vi.fn(({ left }: { left: number }) => {
      scroller.scrollLeft = left
    }),
  }
  return { scroller, cards }
}

function key(name: string, target: unknown = null) {
  return { key: name, target, preventDefault: vi.fn() }
}

const CONFIG: ViewConfig = {
  ageNote: 'For adults of legal drinking age. Please drink responsibly.',
  moreUrl: 'https://fixmeadrinkapp.com/free-tools/cocktail-by-ingredients',
  peaceUrl: 'https://mcp.fixmeadrinkapp.com/images/garcon-peace.webp',
  placeholderUrl: 'https://mcp.fixmeadrinkapp.com/images/recipe-placeholder.webp',
  mascot: '<svg class="mark"></svg>',
  star: '<svg class="star"></svg>',
  chevronLeft: '<svg class="chevron-l"></svg>',
  chevronRight: '<svg class="chevron-r"></svg>',
}
const tagHtml = (text: string, tone = '') => `<span class="tag${tone ? ` ${tone}` : ''}"><span class="tag-label">${text}</span></span>`
const view = () => factory.garconView(CONFIG)

const RICKEY = {
  name: 'Gin Rickey',
  url: 'https://fixmeadrinkapp.com/recipes/gin-rickey',
  strength: 'Medium',
  flavors: ['Citrusy', 'Refreshing', 'Dry', 'Fizzy'],
  have: ['Gin', 'Lime juice', 'Soda water'],
  missing: [],
  can_make_now: true,
}
const COLLINS = {
  name: 'Tom Collins',
  url: 'https://fixmeadrinkapp.com/recipes/tom-collins',
  strength: 'Medium',
  flavors: ['Citrusy'],
  have: ['Gin'],
  missing: ['Lemon juice', 'Simple syrup'],
  can_make_now: false,
}
const SHRUB = {
  name: 'Lime Shrub Soda',
  url: 'https://fixmeadrinkapp.com/recipes/lime-shrub-soda',
  strength: 'Non Alcoholic',
  flavors: ['Tart', 'Fizzy', 'Herbal'],
  have: ['Soda water'],
  missing: ['Shrub'],
  can_make_now: false,
}
function data(overrides: Record<string, unknown> = {}) {
  return {
    bar: { recognised: [{ you_said: 'gin' }], not_recognised: [], assumed_staples: ['Water'] },
    cocktails: [RICKEY, COLLINS],
    low_proof_options: [SHRUB],
    more_ideas_url: CONFIG.moreUrl,
    ...overrides,
  }
}
const IMAGES = { images: { [RICKEY.url]: 'https://images.fixmeadrinkapp.com/rickey.webp' } }

describe('widget view', () => {
  it('renders ready and missing cards, the low-proof section and the footer', () => {
    const html = view().results(data(), IMAGES)
    expect(html).toContain('<h2 id="s-bar">Drinks from your bar</h2>')
    expect(html).toContain('<section class="shelf quiet" aria-labelledby="s-low"><div class="shelf-head"><h2 id="s-low">Low or zero-proof</h2>')
    // Ready: the success tag leads the tags row, then every flavour, and no note line.
    expect(html).toContain(
      `<h3 class="name" id="g1-n">Gin Rickey</h3><span class="details" id="g1-d"><span class="tags">${tagHtml('Ready to make', 'ok')}${tagHtml('Citrusy')}${tagHtml('Refreshing')}${tagHtml('Dry')}${tagHtml('Fizzy')}</span></span>`
    )
    // Missing: flavour tags, then one quiet line.
    expect(html).toContain(`${tagHtml('Citrusy')}</span><span class="note-line">Missing Lemon juice and Simple syrup</span>`)
    expect(html).not.toContain('Zero-proof')
    expect(html).toContain('More on fixmeadrinkapp.com')
    expect(html).toContain(CONFIG.ageNote)
  })

  it('puts the photo first, at 3:2 in the media box, and the site placeholder when there is none', () => {
    const html = view().results(data(), IMAGES)
    expect(html).toContain(
      '<span class="media"><img class="photo" src="https://images.fixmeadrinkapp.com/rickey.webp" alt="Gin Rickey" loading="lazy" decoding="async"></span><span class="body"><h3'
    )
    expect(
      html.match(/<span class="media"><span class="placeholder"><img src="https:\/\/mcp\.fixmeadrinkapp\.com\/images\/recipe-placeholder\.webp" alt="" width="32" height="32"><\/span><\/span>/g)
    ).toHaveLength(2)
  })

  it('overlays the Plus badge top left on a premium recipe and names it with the link', () => {
    const html = view().results(data({ cocktails: [{ ...RICKEY, premium: true }, COLLINS], low_proof_options: [] }), IMAGES)
    expect(html).toContain(
      '<span class="media"><img class="photo" src="https://images.fixmeadrinkapp.com/rickey.webp" alt="Gin Rickey" loading="lazy" decoding="async"><span class="tag plus" id="g1-p"><svg class="star"></svg><span class="tag-label">Plus</span></span></span>'
    )
    expect(html).toContain('aria-labelledby="g1-n g1-p"')
    expect(html.match(/class="tag plus"/g)).toHaveLength(1)
    expect(html).toContain('aria-labelledby="g2-n" aria-describedby="g2-d"')
  })

  it('gives each shelf a focusable list and an arrow pair that controls it', () => {
    const html = view().results(data())
    expect(html).toContain('<ul class="cards" id="s-bar-list" tabindex="0" aria-labelledby="s-bar">')
    expect(html).toContain('data-step="-1" aria-controls="s-bar-list" aria-label="Previous drink"><svg class="chevron-l"></svg></button>')
    expect(html).toContain('data-step="1" aria-controls="s-low-list" aria-label="Next drink"><svg class="chevron-r"></svg></button>')
  })

  it('shows the empty state with the server note, and says when nothing was recognised', () => {
    const empty = view().results(
      data({ cocktails: [], low_proof_options: [], note: 'No free recipe uses those ingredients yet.' })
    )
    expect(empty).toContain('No drinks from this bar yet')
    expect(empty).toContain('No free recipe uses those ingredients yet.')
    expect(empty).toContain(`src="${CONFIG.peaceUrl}"`)
    expect(empty).not.toContain('<h2')

    const unknown = view().results(
      data({ cocktails: [], low_proof_options: [], bar: { recognised: [], not_recognised: ['xyzzy'] } })
    )
    expect(unknown).toContain('Garçon didn’t recognise those')
  })

  it('lists unrecognised words and an unavailable low-proof lookup under the results', () => {
    const html = view().results(
      data({ bar: { recognised: [{}], not_recognised: ['blue stuff', 'xyzzy'] }, unavailable: ['low_proof_options'] })
    )
    expect(html).toContain('Not recognised: blue stuff and xyzzy')
    expect(html).toContain('Low or zero-proof options could not load this time.')
  })

  it('renders tool errors as a warning note with the server message, and bad payloads as a generic one', () => {
    const html = view().fromToolResult({ isError: true, content: [{ type: 'text', text: 'List at least one bottle.' }] })
    expect(html).toContain('role="alert"')
    expect(html).toContain('List at least one bottle.')
    expect(view().fromToolResult({ structuredContent: null })).toContain('Something went wrong. Try again in a moment.')
  })

  it('renders loading as a skeleton, and cancellation as one line', () => {
    const loading = view().loading()
    expect(loading).toContain('class="skeleton" aria-hidden="true"')
    expect(view().cancelled()).toBe('<p class="lead">Search cancelled.</p>')
  })

  it('summarises the outcome in one line for the status region', () => {
    expect(view().summary({ structuredContent: data() })).toBe('3 drinks found.')
    expect(view().summary({ structuredContent: data({ cocktails: [RICKEY], low_proof_options: [] }) })).toBe('1 drink found.')
    expect(view().summary({ structuredContent: data({ cocktails: [], low_proof_options: [] }) })).toBe('No drinks found.')
    expect(view().summary({ isError: true, content: [] })).toBe('Garçon couldn’t check your bar.')
  })

  it('escapes every value the server or catalogue supplies', () => {
    const evil = {
      ...COLLINS,
      name: '<img src=x onerror=alert(1)>"Collins"',
      flavors: ['<b>bold</b>'],
      missing: ['"><script>alert(1)</script>'],
    }
    const html = view().results(
      data({ cocktails: [evil], note: '<i>note</i>', bar: { recognised: [{}], not_recognised: ['<u>x</u>'] } })
    )
    expect(html).not.toMatch(/<img src=x|<b>|<script>|<i>|<u>/)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;Collins&quot;')
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(view().fromToolResult({ isError: true, content: [{ type: 'text', text: '<script>x</script>' }] })).toContain(
      '&lt;script&gt;x&lt;/script&gt;'
    )
  })

  it('links only to fixmeadrinkapp.com and loads images only from its image host', () => {
    const cards = [
      { ...RICKEY, url: 'javascript:alert(1)' },
      { ...COLLINS, url: 'https://evil.example/recipes/x' },
      { ...SHRUB, url: 'https://fixmeadrinkapp.com.evil.example/x' },
      { ...COLLINS, name: 'Quoted', url: 'https://fixmeadrinkapp.com/recipes/a"onmouseover="x' },
    ]
    const images = {
      images: {
        'javascript:alert(1)': 'https://images.fixmeadrinkapp.com/ok.webp',
        'https://evil.example/recipes/x': 'https://evil.example/tracker.gif',
      },
    }
    const html = view().results(data({ cocktails: cards, low_proof_options: [] }), images)
    expect(html).not.toContain('<a class="card"')
    expect(html.match(/<div class="card">/g)).toHaveLength(4)
    expect(html).not.toContain('evil.example')
    expect(html).not.toContain('javascript:')

    const good = view().results(data(), IMAGES)
    expect(good).toContain(
      `<a class="card" href="${RICKEY.url}" data-href="${RICKEY.url}" target="_blank" rel="noopener noreferrer"`
    )
    const v = view()
    expect(v.isRecipeUrl(RICKEY.url)).toBe(true)
    expect(v.isRecipeUrl('http://fixmeadrinkapp.com/recipes/x')).toBe(false)
    expect(v.isRecipeUrl(undefined)).toBe(false)
  })

  it('gives every card its own name and description ids', () => {
    const html = view().results(data())
    const ids = [...html.matchAll(/ id="(g\d+-[nd])"/g)].map((m) => m[1])
    expect(ids).toHaveLength(6)
    expect(new Set(ids).size).toBe(6)
  })
})

describe('widget links (audit 3, finding 2)', () => {
  const URL = RICKEY.url

  it('opens through ui/open-link when the host negotiated it', async () => {
    const request = vi.fn().mockResolvedValue({})
    const open = vi.fn()
    expect(await factory.garconLinks({ mode: () => 'bridge', request, open })(URL)).toBe('opened')
    expect(request).toHaveBeenCalledWith('ui/open-link', { url: URL }, 15000)
    expect(open).not.toHaveBeenCalled()
  })

  it('treats a refusal or cancellation as final: nothing else opens the link', async () => {
    const openExternal = vi.fn()
    const open = vi.fn()
    const outcome = await factory.garconLinks({
      mode: () => 'bridge',
      request: () => Promise.resolve({ isError: true }),
      openai: { openExternal },
      open,
    })(URL)
    expect(outcome).toBe('refused')
    expect(openExternal).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('never opens on its own after a timeout; it reports a failure for the retry and copy offer', async () => {
    const openExternal = vi.fn()
    const open = vi.fn()
    const outcome = await factory.garconLinks({
      mode: () => 'bridge',
      request: () => Promise.reject(new Error('timeout')),
      openai: { openExternal },
      open,
    })(URL)
    expect(outcome).toBe('failed')
    expect(openExternal).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('uses ChatGPT openExternal or window.open only when that is the negotiated opener', async () => {
    const request = vi.fn()
    const openExternal = vi.fn()
    expect(await factory.garconLinks({ mode: () => 'openai', request, openai: { openExternal }, open: vi.fn() })(URL)).toBe('opened')
    expect(openExternal).toHaveBeenCalledWith({ href: URL })
    expect(request).not.toHaveBeenCalled()

    const open = vi.fn().mockReturnValue(null)
    expect(await factory.garconLinks({ mode: () => 'window', request, open })(URL)).toBe('failed')
    expect(await factory.garconLinks({ mode: () => 'none', request, open })(URL)).toBe('failed')
    expect(request).not.toHaveBeenCalled()
  })

  it('offers a retry button and the URL to copy', () => {
    const help = view().linkHelp(URL)
    expect(help).toContain(`<button type="button" class="retry" data-retry="${URL}">Try again</button>`)
    expect(help).toContain(`<span class="copy-url">${URL}</span>`)
  })
})

describe('widget document', () => {
  it('uses only ported tokens: every hex colour lives in the token block', () => {
    for (const brandFonts of [true, false]) {
      const html = widgetHtml({ brandFonts })
      const outsideTokens = html.replace(TOKENS_CSS, '')
      expect(outsideTokens.match(/#[0-9a-f]{3,8}\b/gi)).toBeNull()
    }
    for (const line of TOKENS_CSS.split('\n').filter((l) => /#[0-9a-f]{6}/i.test(l))) {
      expect(line).toMatch(/\/\* .+ \*\//)
    }
  })

  it('loads brand fonts from the asset origin only when asked, and never Fix me a drink branding', () => {
    const brand = widgetHtml({ brandFonts: true, assetOrigin: 'https://assets.test' })
    expect(brand).toContain('url("https://assets.test/fonts/dm-sans-5.3.0-latin-wght.woff2")')
    expect(brand).toContain('"Inter Garcon"')
    const system = widgetHtml({ brandFonts: false })
    expect(system).not.toContain('@font-face')
    expect(system).not.toContain('rel="preload"')
    expect(system).toContain('var(--font-sans,')
    for (const html of [brand, system]) {
      expect(html).not.toMatch(/fix me a drink/i)
      expect(html).toContain('<meta name="color-scheme" content="light dark">')
    }
  })

  it('embeds a config that cannot close the script tag', () => {
    const html = widgetHtml({ brandFonts: true })
    const script = html.slice(html.indexOf('<script>'), html.lastIndexOf('</script>'))
    expect(script.toLowerCase()).not.toContain('</script')
    expect(script).toContain('\\u003csvg')
  })
})

describe('widget view for vague bottles and partial answers', () => {
  it('shows a conditional ingredient as a condition, never as ready', () => {
    const martini = {
      ...COLLINS,
      name: 'Perfect Martini',
      missing: ['Sweet vermouth'],
      depends_on: [{ ingredient: 'Dry vermouth', you_said: 'vermouth' }],
    }
    const html = view().results(data({ cocktails: [martini], low_proof_options: [], partial: true }))
    expect(html).toContain('<span class="note-line">Missing Sweet vermouth. Only if your vermouth is Dry vermouth</span>')
    expect(html).not.toContain('Ready to make')
    expect(html).toContain('more may match on fixmeadrinkapp.com')
  })
})

describe('widget view with the tool input', () => {
  it('names the main section for a zero_or_low search', () => {
    const html = view().fromToolResult(
      { structuredContent: data({ cocktails: [SHRUB], low_proof_options: [] }) },
      { ingredients: ['soda water'], strength: 'zero_or_low' }
    )
    expect(html).toContain('Low or zero-proof from your bar</h2>')
    expect(html).not.toContain('Drinks from your bar')
  })
})

describe('widget carousel', () => {
  it('moves one card per arrow key from the list, and Home and End go to the ends', () => {
    const { scroller } = fakeShelf(5)
    const carousel = factory.garconCarousel(scroller, false)
    const right = key('ArrowRight', scroller)
    expect(carousel.onKey(right)).toBe(true)
    expect(right.preventDefault).toHaveBeenCalled()
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ left: 300, behavior: 'auto' })
    carousel.onKey(key('ArrowRight', scroller))
    expect(scroller.scrollLeft).toBe(600)
    carousel.onKey(key('ArrowLeft', scroller))
    expect(scroller.scrollLeft).toBe(300)
    carousel.onKey(key('End', scroller))
    expect(scroller.scrollLeft).toBe(1200)
    carousel.onKey(key('ArrowRight', scroller))
    expect(scroller.scrollLeft).toBe(1200)
    carousel.onKey(key('Home', scroller))
    expect(scroller.scrollLeft).toBe(0)
    carousel.onKey(key('ArrowLeft', scroller))
    expect(scroller.scrollLeft).toBe(0)
  })

  it('moves focus with the scroll when a card has focus', () => {
    const { scroller, cards } = fakeShelf(4)
    const carousel = factory.garconCarousel(scroller, true)
    carousel.onKey(key('ArrowRight', cards[1]))
    expect(cards[2].focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ left: 600, behavior: 'smooth' })
    carousel.onKey(key('ArrowLeft', cards[0]))
    expect(cards[0].focus).toHaveBeenCalled()
  })

  it('leaves other keys alone, and does nothing while the shelf is a grid', () => {
    const { scroller } = fakeShelf(3)
    const tab = key('Tab', scroller)
    expect(factory.garconCarousel(scroller, false).onKey(tab)).toBe(false)
    expect(tab.preventDefault).not.toHaveBeenCalled()

    const grid = fakeShelf(3, 2000).scroller
    grid.scrollWidth = 2000
    const right = key('ArrowRight', grid)
    expect(factory.garconCarousel(grid, false).onKey(right)).toBe(false)
    expect(right.preventDefault).not.toHaveBeenCalled()
    expect(grid.scrollTo).not.toHaveBeenCalled()
  })

  it('steps for the arrow buttons and reports both ends', () => {
    const { scroller } = fakeShelf(3)
    const carousel = factory.garconCarousel(scroller, false)
    expect(carousel.state()).toEqual({ scrollable: true, atStart: true, atEnd: false })
    carousel.step(1)
    carousel.step(1)
    expect(scroller.scrollLeft).toBe(600)
    scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth
    expect(carousel.state()).toMatchObject({ atStart: false, atEnd: true })
    carousel.step(-1)
    expect(scroller.scrollLeft).toBe(300)
  })
})
