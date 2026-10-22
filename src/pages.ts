// Small public pages the Worker serves next to /mcp: a landing page and the
// connector privacy notice that both directory listings link to.

import {
  AGE_NOTE,
  MCP_ORIGIN,
  SITE_PRIVACY_URL,
  SITE_URL,
  SUPPORT_EMAIL,
  SUPPORT_URL,
  TERMS_URL,
} from './site'

function page(title: string, body: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: #fff; color: #17151c; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 28px; line-height: 1.2; } h2 { font-size: 19px; margin-top: 32px; }
  a { color: #5b3fd1; } code { background: #f2f0f6; padding: 1px 5px; border-radius: 4px; }
  @media (prefers-color-scheme: dark) { body { background: #17151c; color: #f3f1f7; } a { color: #a993ff; } code { background: #26232d; } }
</style></head>
<body><main>${body}</main></body></html>`
}

export const LANDING_HTML = page(
  'Ask Garçon',
  `<h1>Ask Garçon</h1>
<p>Drinks from the bottles you already own. Ask Garçon is the Garçon cocktail catalogue inside ChatGPT and Claude. Tell it what is on your shelf and it finds drinks you can make, gives full recipes, explains spirits and bar terms, and suggests drinks like one you enjoy, with low and zero-proof options every time. Every result links to its page on <a href="${SITE_URL}">fixmeadrinkapp.com</a>.</p>
<p>${AGE_NOTE}</p>

<h2>Set it up</h2>
<ul>
<li><strong>ChatGPT:</strong> find Ask Garçon in the app directory and connect it. No account is needed.</li>
<li><strong>Claude:</strong> find Ask Garçon in the connectors directory and connect it, or add a custom connector with the URL <code>${MCP_ORIGIN}/mcp</code>. No account is needed.</li>
<li><strong>Other MCP clients:</strong> connect to <code>${MCP_ORIGIN}/mcp</code> over Streamable HTTP with no authentication.</li>
</ul>

<h2>What you can ask</h2>
<ul>
<li><strong>Find cocktails from your ingredients</strong> (<code>find_cocktails_by_ingredients</code>): "I have gin, limes, sugar and soda water. What can I make?" Results are ranked by fewest missing ingredients and show what you have and what you would need. Add "low-alcohol only" or a flavour such as "something herbal" to filter.</li>
<li><strong>Get a cocktail recipe</strong> (<code>get_cocktail_recipe</code>): "How do I make an Old Fashioned?" Amounts are in oz with ml, plus glass, ice, garnish and steps.</li>
<li><strong>Explain a spirit, ingredient or bar term</strong> (<code>explain_bar_term</code>): "What is mezcal?", "How do I dry shake?", "What is a coupe glass?"</li>
<li><strong>Suggest similar cocktails</strong> (<code>suggest_similar_cocktail</code>): "Something like a Negroni but lighter."</li>
</ul>
<p>All four tools only read the public recipe catalogue. They never change anything and need no sign-in.</p>

<h2>Good to know</h2>
<ul>
<li>Ask Garçon matches ingredients by their common names. If something is not recognised, the answer says so; try a plainer name, such as "orange liqueur" for a brand.</li>
<li>Water and saline are assumed to be in every kitchen. Garnishes are listed but never block a match.</li>
<li>Some recipes in the catalogue are premium. For those you get the description and free recipes like it.</li>
<li>Some classics are listed under a variant name, such as "Manhattan (Sweet)". The answer says when a match is not exact.</li>
</ul>

<h2>Troubleshooting</h2>
<ul>
<li><strong>"Garçon is handling a lot of requests right now"</strong>: wait a minute and ask again.</li>
<li><strong>No drinks found</strong>: add a base spirit, a citrus and a sweetener; those three open up the most recipes.</li>
<li><strong>Still stuck</strong>: email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</li>
</ul>

<p><a href="${MCP_ORIGIN}/privacy">Privacy notice</a> · <a href="${TERMS_URL}">Terms</a> · <a href="${SUPPORT_URL}">Support</a></p>`
)

export const PRIVACY_HTML = page(
  'Ask Garçon privacy notice',
  `<h1>Ask Garçon privacy notice</h1>
<p><strong>Last updated: 22 October 2026</strong></p>
<p>This notice covers the Ask Garçon app in ChatGPT and the Ask Garçon connector in Claude (together, "Ask Garçon"), served from <code>${MCP_ORIGIN}</code>. BLANKPAGE ENTERPRISE S.R.L. (registration number RO50172118, Drumul Taberei 35, Bucharest, Romania) operates it and is the controller of the personal data described here. Our main <a href="${SITE_PRIVACY_URL}">privacy policy</a> covers the Garçon iOS app and fixmeadrinkapp.com.</p>

<h2>What Ask Garçon receives</h2>
<ul>
<li><strong>Tool inputs.</strong> The ingredients, drink names and bar terms that ChatGPT or Claude sends when you ask for a drink, a recipe, an explanation or a similar drink. Ask Garçon does not ask for your name, email, location, age or any account details, and it does not read your chat history.</li>
<li><strong>Request metadata.</strong> The IP address the request comes from (usually an OpenAI or Anthropic server, not your device) and, in ChatGPT, an anonymized user identifier that OpenAI attaches to tool calls.</li>
</ul>

<h2>How it is used</h2>
<ul>
<li>Tool inputs are used only to look up recipes, ingredients and glossary pages in the Garçon catalogue and to return the answer.</li>
<li>The IP address and the anonymized identifier are used only to apply rate limits that keep the service available. Rate-limit counters expire within one minute.</li>
<li>We do not use Ask Garçon data for advertising, profiling or training models, and we do not sell it.</li>
</ul>

<h2>Storage and retention</h2>
<ul>
<li>Ask Garçon has no user accounts and no database of its own. It does not store your tool inputs.</li>
<li>Answers from the recipe catalogue are cached by search term for up to 7 days so repeated questions load fast. Cached entries contain catalogue data, not who asked.</li>
<li>Our hosting provider, Cloudflare, keeps standard request and error logs (time, path, status and IP address) for up to 7 days for security and debugging. Error logs do not include tool inputs.</li>
</ul>

<h2>Who processes it</h2>
<ul>
<li><strong>Cloudflare, Inc.</strong> hosts Ask Garçon (Cloudflare Workers).</li>
<li>Our recipe API on <strong>Fly.io</strong> receives the catalogue queries Ask Garçon makes on your behalf, without your IP address or identifier.</li>
<li>OpenAI and Anthropic process your conversation under their own privacy policies.</li>
</ul>

<h2>Age</h2>
<p>Garçon is for adults of legal drinking age. Ask Garçon also offers low and zero-proof drinks, and it makes no health claims.</p>

<h2>Your rights</h2>
<p>Under the GDPR you can ask for access, correction, deletion, restriction or portability of your personal data, and object to its processing. Because Ask Garçon does not keep tool inputs or accounts, there is usually nothing to retrieve or delete beyond short-lived logs. Write to <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>. You can also complain to the Romanian data protection authority (ANSPDCP).</p>

<h2>Contact</h2>
<p><a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> · <a href="${SUPPORT_URL}">Support</a> · <a href="${TERMS_URL}">Terms of service</a></p>`
)
