// Small public pages the Worker serves next to /mcp: the documentation page
// and the connector privacy notice that both directory listings link to.
// They follow the fixmeadrinkapp.com reading pages: site header with the
// logo, PageHeader (components/garcon/page-header.tsx), sections in the
// 768 px reading column separated by the centred Ruled divider, Prose
// paragraphs in text/med_em, and the site footer's bottom bar. Light only,
// like the site. One request for the HTML; fonts and images are static
// assets on the same origin.

import { BRAND_FONTS, FONT_FILES, IMAGE_FILES, TOKENS_CSS, fontFaceCss, mascotSvg } from './brand'
import {
  AGE_NOTE,
  MCP_ORIGIN,
  PRIVACY_URL,
  SITE_PRIVACY_URL,
  SITE_URL,
  SUPPORT_EMAIL,
  SUPPORT_URL,
  TERMS_URL,
} from './site'

const PAGE_CSS = /* css */ `
  :root {
    color-scheme: light; /* the site is light only */
    --font-heading: ${BRAND_FONTS.display}; /* --font-display: DM Sans */
    --font-body: ${BRAND_FONTS.text}; /* --font-sans: Inter */
    --font-code: ui-monospace, "SF Mono", Menlo, Consolas, monospace; /* no site token: system monospace */
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--surface-0); color: var(--fg-high-em);
    font-family: var(--font-body);
    font-size: var(--text-para); line-height: var(--leading-para); letter-spacing: var(--tracking-para);
    font-synthesis-weight: none; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  a:focus-visible { outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: 2px; border-radius: var(--radius-6); }
  p, h1, h2, h3, ul, ol { margin: 0; }

  /* site_header: logo md, then the page links */
  .site-header { border-bottom: 1px solid var(--outline-base-em); background: var(--surface-0); }
  .bar {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-lg);
    max-width: var(--layout-site); height: var(--size-header); margin: 0 auto; padding: 0 var(--space-xxl);
  }
  .logo { display: inline-flex; align-items: center; gap: var(--space-sm); color: var(--fg-med-em); text-decoration: none; }
  .logo svg { width: 34px; height: 32px; } /* logo.tsx size md: mark 34 x 32 */
  .wordmark {
    font-family: var(--font-heading); font-weight: 600;
    font-size: var(--text-wordmark-md); line-height: var(--leading-wordmark-md); letter-spacing: var(--tracking-wordmark-md);
  }
  .site-nav { display: flex; gap: var(--space-xs); }
  .site-nav a, .foot-links a {
    display: inline-flex; align-items: center; min-height: var(--size-control-md); padding: 0 var(--space-md);
    border-radius: var(--radius-8); color: var(--fg-med-em); text-decoration: none;
    font-size: var(--text-body-1); line-height: var(--leading-body-1); letter-spacing: var(--tracking-body-1);
    transition: color 150ms ease-out, background-color 150ms ease-out;
  }
  .site-nav a[aria-current="page"] { color: var(--fg-high-em); font-weight: 500; }
  @media (hover: hover) { .site-nav a:hover, .foot-links a:hover { color: var(--fg-high-em); background: var(--surface-2); } }

  /* reading column */
  main { max-width: calc(var(--layout-reading) + 2 * var(--space-xxl)); margin: 0 auto; padding: 0 var(--space-xxl); }
  .page-header { display: grid; gap: var(--space-xxl); padding: var(--space-4xl) 0 var(--space-6xl); }
  h1 {
    font-family: var(--font-heading); font-weight: 600; color: var(--fg-high-em);
    font-size: var(--text-heading-3); line-height: var(--leading-heading-3); letter-spacing: var(--tracking-heading-3);
    text-wrap: balance; hyphens: auto;
  }
  @media (min-width: 768px) {
    h1 { font-size: var(--text-heading-5); line-height: var(--leading-heading-5); letter-spacing: var(--tracking-heading-5); }
  }
  .meta { color: var(--fg-low-em); font-size: var(--text-body-1); line-height: var(--leading-body-1); letter-spacing: var(--tracking-body-1); }
  .lead { color: var(--fg-med-em); font-size: var(--text-title-1); line-height: var(--leading-title-1); letter-spacing: var(--tracking-title-1); }

  /* DetailSection: a centred rule half the column wide, then the section */
  section { display: grid; gap: var(--space-xxl); padding: var(--space-4xl) 0; }
  section::before { content: ""; display: block; justify-self: center; width: 50%; height: 1px; margin-bottom: var(--space-4xl); background: var(--outline-low-em); }
  h2 {
    font-family: var(--font-heading); font-weight: 600; color: var(--fg-high-em);
    font-size: var(--text-heading-3); line-height: var(--leading-heading-3); letter-spacing: var(--tracking-heading-3);
    text-wrap: balance;
  }
  h3 {
    font-weight: 500; color: var(--fg-high-em);
    font-size: var(--text-title-2); line-height: var(--leading-title-2); letter-spacing: var(--tracking-title-2);
  }
  .prose { display: grid; gap: var(--space-xxl); color: var(--fg-med-em); }
  .prose ul { display: grid; gap: var(--space-md); padding-left: var(--space-4xl); }
  .prose li::marker { color: var(--fg-base-em); }
  .prose strong { color: var(--fg-high-em); font-weight: 500; }
  .prose a { color: var(--fg-primary-high-em); text-decoration: underline; text-decoration-color: var(--outline-primary-med-em); text-decoration-thickness: 1px; text-underline-offset: 4px; overflow-wrap: anywhere; }
  @media (hover: hover) { .prose a:hover { text-decoration-color: currentColor; } }
  .tools { display: grid; gap: var(--space-4xl); }
  .tool { display: grid; gap: var(--space-xs); }
  .tool .tool-name { font-size: var(--text-caption-2); line-height: var(--leading-caption-2); color: var(--fg-low-em); }
  code {
    font-family: var(--font-code); font-size: 0.875em; color: var(--fg-high-em);
    background: var(--surface-2); border-radius: var(--radius-4); padding: 1px var(--space-xs); overflow-wrap: anywhere;
  }
  .tool .tool-name code { font-size: 1em; background: none; padding: 0; color: inherit; }

  /* Garçon looking up over the footer's top edge (GarconPeek) */
  .peek { display: flex; justify-content: flex-end; margin-top: var(--space-6xl); }
  .peek span { display: block; width: min(var(--size-peek), 60%); aspect-ratio: 350 / 161; overflow: hidden; } /* aspect-peek */
  .peek img { display: block; width: 100%; height: auto; }

  /* site_footer bottom bar */
  .site-footer { border-top: 1px solid var(--outline-med-em); background: var(--surface-1); padding: var(--space-6xl) 0 var(--space-7xl); }
  .foot { display: grid; gap: var(--space-lg); max-width: var(--layout-site); margin: 0 auto; padding: 0 var(--space-xxl); }
  .foot-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-lg); }
  .foot-brand { display: flex; align-items: center; gap: var(--space-sm); }
  .foot-brand .logo { gap: var(--space-xs); }
  .foot-brand .logo svg { width: 26px; height: 24px; } /* logo.tsx size sm */
  .foot-brand .wordmark { font-size: var(--text-wordmark-sm); line-height: var(--leading-wordmark-sm); letter-spacing: var(--tracking-wordmark-sm); }
  .small { font-size: var(--text-caption-2); line-height: var(--leading-caption-2); letter-spacing: var(--tracking-caption-2); color: var(--fg-low-em); }
  .foot-links { display: flex; flex-wrap: wrap; margin: 0 calc(-1 * var(--space-md)); padding: 0; list-style: none; }
  .foot-links a { font-size: var(--text-caption-2); line-height: var(--leading-caption-2); letter-spacing: var(--tracking-caption-2); }
`

const HEAD = `<link rel="preload" href="${FONT_FILES.text}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${FONT_FILES.display}" as="font" type="font/woff2" crossorigin>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${fontFaceCss('')}${TOKENS_CSS}${PAGE_CSS}</style>`

type PageKey = 'docs' | 'privacy'

function header(current: PageKey) {
  const link = (key: PageKey, href: string, label: string) =>
    `<a href="${href}"${key === current ? ' aria-current="page"' : ''}>${label}</a>`
  return `<header class="site-header"><div class="bar">
<a class="logo" href="/" aria-label="Ask Garçon documentation">${mascotSvg('mark')}<span class="wordmark">Garçon</span></a>
<nav class="site-nav" aria-label="Ask Garçon">${link('docs', '/', 'Docs')}${link('privacy', '/privacy', 'Privacy')}</nav>
</div></header>`
}

function footer() {
  const year = 2026
  return `<footer class="site-footer"><div class="foot">
<div class="foot-row">
<div class="foot-brand"><a class="logo" href="${SITE_URL}" aria-label="Garçon on fixmeadrinkapp.com">${mascotSvg('mark')}<span class="wordmark">Garçon</span></a><span class="small">© ${year} Garçon</span></div>
<ul class="foot-links">
<li><a href="${PRIVACY_URL}">Privacy</a></li>
<li><a href="${TERMS_URL}">Terms</a></li>
<li><a href="${SUPPORT_URL}">Support</a></li>
<li><a href="${SITE_URL}">fixmeadrinkapp.com</a></li>
</ul>
</div>
<p class="small">${AGE_NOTE}</p>
</div></footer>`
}

function page(key: PageKey, title: string, description: string, body: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
${HEAD}
</head>
<body>
${header(key)}
<main>${body}
<div class="peek" aria-hidden="true"><span><img src="${IMAGE_FILES.peek}" alt="" width="700" height="700" decoding="async"></span></div>
</main>
${footer()}
</body></html>`
}

function section(title: string, content: string) {
  return `<section><h2>${title}</h2><div class="prose">${content}</div></section>`
}

export const LANDING_HTML = page(
  'docs',
  'Ask Garçon: cocktails from your bar in ChatGPT and Claude',
  'Ask Garçon finds cocktails you can make from the bottles you own, inside ChatGPT and Claude. Setup, tools and troubleshooting.',
  `<header class="page-header">
<h1>Ask Garçon</h1>
<p class="lead">Drinks from the bottles you already own, inside ChatGPT and Claude.</p>
</header>
<div class="prose">
<p>Ask Garçon is the Garçon cocktail catalogue in your chat. Tell it what is on your shelf and it finds drinks you can make, gives full recipes, explains spirits and bar terms, and suggests drinks like one you enjoy, with low and zero-proof options every time. Every result links to its page on <a href="${SITE_URL}">fixmeadrinkapp.com</a>.</p>
<p>${AGE_NOTE}</p>
</div>

${section(
  'Set it up',
  `<ul>
<li><strong>ChatGPT:</strong> find Ask Garçon in the app directory and connect it. No account is needed.</li>
<li><strong>Claude:</strong> find Ask Garçon in the connectors directory and connect it, or add a custom connector with the URL <code>${MCP_ORIGIN}/mcp</code>. No account is needed.</li>
<li><strong>Other MCP clients:</strong> connect to <code>${MCP_ORIGIN}/mcp</code> over Streamable HTTP with no authentication.</li>
</ul>`
)}

${section(
  'What you can ask',
  `<div class="tools">
<div class="tool"><h3>Find cocktails from your ingredients</h3><p class="tool-name"><code>find_cocktails_by_ingredients</code></p>
<p>"I have gin, limes, sugar and soda water. What can I make?" Results are ranked by fewest missing ingredients and show what you have and what you would need. Add "low-alcohol only" or a flavour such as "something herbal" to filter.</p></div>
<div class="tool"><h3>Get a cocktail recipe</h3><p class="tool-name"><code>get_cocktail_recipe</code></p>
<p>"How do I make an Old Fashioned?" Amounts are in oz with ml, plus glass, ice, garnish and steps.</p></div>
<div class="tool"><h3>Explain a spirit, ingredient or bar term</h3><p class="tool-name"><code>explain_bar_term</code></p>
<p>"What is mezcal?", "How do I dry shake?", "What is a coupe glass?"</p></div>
<div class="tool"><h3>Suggest similar cocktails</h3><p class="tool-name"><code>suggest_similar_cocktail</code></p>
<p>"Something like a Negroni but lighter."</p></div>
</div>
<p>All four tools only read the public recipe catalogue. They never change anything and need no sign-in.</p>`
)}

${section(
  'Good to know',
  `<ul>
<li>Ask Garçon matches ingredients by their common names. If something is not recognised, the answer says so; try a plainer name, such as "orange liqueur" for a brand.</li>
<li>A word that could mean several bottles, such as "vermouth" or "whiskey", is never assumed to be a particular one. The answer says "only if your vermouth is dry vermouth" instead, and that drink is not marked ready to make.</li>
<li>Water and saline are assumed to be in every kitchen. Garnishes are listed but never block a match.</li>
<li>Some recipes in the catalogue are premium. For those you get the description and free recipes like it.</li>
<li>Some classics are listed under a variant name, such as "Manhattan (Sweet)". The answer says when a match is not exact.</li>
</ul>`
)}

${section(
  'Troubleshooting',
  `<ul>
<li><strong>"Garçon is handling a lot of requests right now":</strong> wait a minute and ask again.</li>
<li><strong>No drinks found:</strong> add a base spirit, a citrus and a sweetener; those three open up the most recipes.</li>
<li><strong>Still stuck:</strong> email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</li>
</ul>`
)}`
)

export const PRIVACY_HTML = page(
  'privacy',
  'Ask Garçon privacy notice',
  'What the Ask Garçon app in ChatGPT and connector in Claude receive, how it is used, how long it is kept and who processes it.',
  `<header class="page-header">
<h1>Ask Garçon privacy notice</h1>
<p class="meta">Last updated: 22 October 2026</p>
</header>
<div class="prose">
<p>This notice covers the Ask Garçon app in ChatGPT and the Ask Garçon connector in Claude (together, "Ask Garçon"), served from <code>${MCP_ORIGIN}</code>. BLANKPAGE ENTERPRISE S.R.L. (registration number RO50172118, Drumul Taberei 35, Bucharest, Romania) operates it and is the controller of the personal data described here. Our main <a href="${SITE_PRIVACY_URL}">privacy policy</a> covers the Garçon iOS app and fixmeadrinkapp.com.</p>
</div>

${section(
  'What Ask Garçon receives',
  `<ul>
<li><strong>Tool inputs.</strong> The ingredients, drink names and bar terms that ChatGPT or Claude sends when you ask for a drink, a recipe, an explanation or a similar drink. Ask Garçon does not ask for your name, email, location, age or any account details, and it does not read your chat history.</li>
<li><strong>Request metadata.</strong> The IP address the request comes from (usually an OpenAI or Anthropic server, not your device) and, in ChatGPT, an anonymized user identifier that OpenAI attaches to tool calls.</li>
<li><strong>Widget assets.</strong> When ChatGPT or Claude shows the card list, your device loads recipe photos from <code>images.fixmeadrinkapp.com</code>, and the Garçon image (plus fonts, in Claude) from <code>${MCP_ORIGIN}</code>. Those requests carry your device's IP address and are handled like any website request (see storage and retention).</li>
</ul>`
)}

${section(
  'How it is used',
  `<ul>
<li>Tool inputs are used only to look up recipes, ingredients and glossary pages in the Garçon catalogue and to return the answer.</li>
<li>The IP address and the anonymized identifier are used only to apply rate limits that keep the service available. Rate-limit counters expire within one minute.</li>
<li>We do not use Ask Garçon data for advertising, profiling or training models, and we do not sell it.</li>
</ul>`
)}

${section(
  'Storage and retention',
  `<ul>
<li>Ask Garçon has no user accounts and no database of its own. It does not store your tool inputs.</li>
<li>Answers from the recipe catalogue are cached by search term for up to 7 days so repeated questions load fast. Cached entries contain catalogue data, not who asked.</li>
<li>Our hosting provider, Cloudflare, keeps standard request and error logs (time, path, status and IP address) for up to 7 days for security and debugging. Error logs do not include tool inputs.</li>
</ul>`
)}

${section(
  'Who processes it',
  `<ul>
<li><strong>Cloudflare, Inc.</strong> hosts Ask Garçon (Cloudflare Workers).</li>
<li>Our recipe API on <strong>Fly.io</strong> receives the catalogue queries Ask Garçon makes on your behalf, without your IP address or identifier.</li>
<li>OpenAI and Anthropic process your conversation under their own privacy policies.</li>
</ul>`
)}

${section(
  'Age',
  `<p>Garçon is for adults of legal drinking age. Ask Garçon also offers low and zero-proof drinks, and it makes no health claims.</p>`
)}

${section(
  'Your rights',
  `<p>Under the GDPR you can ask for access, correction, deletion, restriction or portability of your personal data, and object to its processing. Because Ask Garçon does not keep tool inputs or accounts, there is usually nothing to retrieve or delete beyond short-lived logs. Write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. You can also complain to the Romanian data protection authority (ANSPDCP).</p>`
)}

${section(
  'Contact',
  `<p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>, the <a href="${SUPPORT_URL}">support page</a>, or the <a href="${TERMS_URL}">terms of service</a>.</p>`
)}`
)
