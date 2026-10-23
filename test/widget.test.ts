import { describe, expect, it } from 'vitest'
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
  fromToolResult(result: unknown, args?: unknown): string
}

// The view runs in the host's iframe as plain script; run the same source here.
const factory = new Function(`${VIEW_JS}; return { garconView: garconView }`)() as {
  garconView(config: ViewConfig): View
}

const CONFIG: ViewConfig = {
  ageNote: 'For adults of legal drinking age. Please drink responsibly.',
  moreUrl: 'https://fixmeadrinkapp.com/free-tools/cocktail-by-ingredients',
  peaceUrl: 'https://mcp.fixmeadrinkapp.com/images/garcon-peace.webp',
  placeholderUrl: 'https://mcp.fixmeadrinkapp.com/images/recipe-placeholder.webp',
  mascot: '<svg class="mark"></svg>',
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
    expect(html).toContain('aria-labelledby="g2-n" aria-describedby="g2-d">')
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
