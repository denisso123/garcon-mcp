# Ask Garçon MCP server

Drinks from the bottles you already own, inside ChatGPT and Claude.

Ask Garçon is one remote MCP server that we submit twice: as a ChatGPT app (OpenAI plugin directory) and as a Claude connector (Claude connectors directory). Both listings link to https://fixmeadrinkapp.com, and every tool result links to the canonical recipe, ingredient or glossary page there.

- **Status (22 Oct 2026):** built and tested locally against the live recipe API. Not deployed, not submitted.
- **Next step for Denis:** follow [SUBMISSION.md](SUBMISSION.md).
- **Production URL (planned):** `https://mcp.fixmeadrinkapp.com`

## What it does

Four read-only tools. All four carry `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` and a `title`.

| Tool | Use it for | Returns |
|---|---|---|
| `find_cocktails_by_ingredients` | "I have gin, limes and sugar. What can I make?" Optional `strength` (`zero_or_low`, `medium`, `strong`), `flavors`, `limit`. | Up to 8 free recipes ranked by fewest missing ingredients, each with `have`, `missing`, `can_make_now` and its URL; up to 2 low or zero-proof options; which words were recognised. Renders a card list widget. |
| `get_cocktail_recipe` | "How do I make an Espresso Martini?" Name, slug or recipe URL. | Ingredients in oz with ml, glass, ice, garnish, steps, strength, ABV, URL. For premium recipes: the public fields plus free recipes like it. Says when the match is not exact. |
| `explain_bar_term` | "What is mezcal?", "How do I dry shake?" | Ingredient page (taste, made from, ABV range, styles, substitutes incl. zero-proof, example drinks) or glossary term (definition, facts, how-to steps, related terms), with URL. |
| `suggest_similar_cocktail` | "Something like a Moscow Mule." `low_proof: true` for lighter drinks only. | Similar drinks (free recipes first, premium flagged) plus low or zero-proof options that share its flavours. |

Responsible-drinking posture: tool descriptions and the server instructions say the drinks are for adults of legal drinking age; find and similar always include low or zero-proof options; no tool gives health or nutrition advice (calorie data from the API is deliberately not returned). Every successful text result ends with "For adults of legal drinking age. Please drink responsibly." (tool errors do not).

## Routes

| Route | Purpose |
|---|---|
| `POST /mcp` | MCP endpoint for Claude and any other client. A trailing slash is accepted on both MCP routes. |
| `POST /chatgpt/mcp` | Same tools. The widget resource also declares `ui.domain` / `openai/widgetDomain` = `https://mcp.fixmeadrinkapp.com`, which OpenAI requires for apps with UI. Claude validates `ui.domain` against its own hash format and refuses anything else, so the default route leaves it out. |
| `GET /` | Landing page and public documentation (setup, tools, troubleshooting). |
| `GET /privacy` | Privacy notice for both listings. |
| `GET /.well-known/openai-apps-challenge` | OpenAI domain verification. Returns the `OPENAI_APPS_CHALLENGE` secret, or 404 when unset. |

## How it works

```text
ChatGPT / Claude
   │  Streamable HTTP, stateless (fresh McpServer per request)
   ▼
Cloudflare Worker (src/index.ts)
   ├─ ingress, cheapest first: route, method (POST/OPTIONS), JSON content type,
   │  declared size ≤ 64 KB, IP_LIMITER, then one capped read and one parse;
   │  JSON-RPC batch arrays get a -32600 error; every MCP response carries the same CORS headers
   ├─ CALLER_LIMITER on openai/subject, only in addition to the IP limit
   ├─ tools (src/server.ts → src/service.ts, output schemas in src/schemas.ts)
   └─ Upstream, one per call (src/upstream.ts)
        ├─ in-isolate memory (≤10 min) and the Workers Cache API, keyed by API base URL and cache schema version
        ├─ identical lookups within a call share one request
        └─ ≤40 API requests per call, retries included; 8 s per attempt (body included);
           20 s per call; one retry, honouring Retry-After up to 2 s → UPSTREAM_LIMITER → API
```

- **SDK:** the official TypeScript SDK v2 (`@modelcontextprotocol/server` 2.3) and its own `createMcpHandler`, which serves 2025-era clients (what ChatGPT and Claude use today) through its stateless fallback and 2026-07-28 clients natively. The Worker passes it the body it already parsed. MCP Apps helpers come from `@modelcontextprotocol/ext-apps` 2.0.
- **Ingredient matching:** the API's `/cocktails/matches` compares exact, case-sensitive catalogue names, so `src/ingredients.ts` first maps common words to catalogue names (a curated table built from the 250 most popular free recipes, every target verified against the live API), then falls back to `/ingredients/search` re-ranked with the website's rules, for at most 8 unfamiliar words per call (the rest are listed as `not_checked`). A word that names one bottle but several catalogue entries ("vermouth", "rum", "whiskey") is marked `one_of` and covers at most one ingredient of a recipe; produce and pantry words ("limes", "sugar") cover all their forms. Water and saline count as staples.
- **Ranking (`src/ranking.ts`):** free recipes only (premium ones hide their ingredients), filtered by strength and flavour, ordered by the API's own missing count and then recipe size, then compared with the bar from their full recipes in batches of 8: fewest missing first, then more of the bar used, then API order. Comparison stops when no unchecked group can miss fewer ingredients than the drinks already chosen (the API counts a missing garnish and this server does not, so a group can improve by one), or after 16 recipes. Garnishes and optional ingredients never block a match. Low-proof options never repeat a drink from the main list; if they cannot be loaded, the main answer is kept and `unavailable` says so.
- **Recipe lookup:** the full catalogue list (three pages of 2,000, cached 12 h) is ranked locally, because the API's search ranks poorly for classics ("negroni" returns variants first). Slugs and recipe URLs match in any case. Qualified classics ("Manhattan (Sweet)") are returned with a note that the match is not exact; `suggest_similar_cocktail` adds the same note, caps suggestions at 5 and only offers low-proof drinks that share a flavour or the base spirit.

Cache TTLs: catalogue 12 h, recipe details, similar lists, glossary and ingredient pages 24 h, ingredient search 7 days, matches 1 h, "not found" answers 10 min. `workers_dev` is off: the Cache API only works on the custom domain.

### Upstream budget, honestly

- Rate-limit counters are kept **per Cloudflare location**, not globally. `UPSTREAM_LIMITER` (60 a minute) protects the API from one location only, and Workers egress IPs are shared, so it does not keep the Worker under the API's 1,000 requests per 15 minutes per IP.
- A cold `find` call can cost up to 40 API requests, the per-call cap (matches, up to 26 recipe details, up to 8 ingredient searches, and three catalogue pages for the low-proof fallback); a warm one costs none. In the local smoke run, five cold calls spent a minute's budget and the next calls answered "busy" until the cache was warm.
- `openai/subject` is supplied by the caller, so the per-user limit only ever adds to the IP limit. Claude sends no user id, so all Claude users share Anthropic's egress IPs.
- **The Workers Paid plan is required.** Workers Free allows 50 subrequests (Cache API calls count) and 10 ms of CPU per request; a cold call needs more, and parsing the 2.2 MB catalogue alone exceeds 10 ms.
- **The backend owner needs to exempt the Worker** from the per-IP limit with a key or allowlist (see SUBMISSION.md, blocker 5). Without it, busy periods will produce "Garçon is handling a lot of requests right now. Try again in a minute."

## Develop

```bash
pnpm install
pnpm test          # vitest: the exported Worker with fake bindings and a fake recipe API
pnpm typecheck     # sources and tests
pnpm dev           # wrangler dev on http://127.0.0.1:8787
pnpm smoke         # both routes, a 2025-era client (SDK 1.x) and a 2026-07-28 client (SDK 2.x), live API
```

The tests import the Worker's default export and drive it with fake rate limiters, a fake Cache API and a fetch stub for the recipe API, so they run the production path: routing, ingress checks, CORS, limiters, both MCP routes and both protocol eras (real SDK clients), every tool, and upstream 429, 5xx, timeout, HTML, deadline and budget failures.

`pnpm smoke` (or `node _agent/scripts/smoke.mjs <baseUrl>`) states the expected outcome of every case, checks the result fields and the age line, and exits 1 on any mismatch. It writes a transcript to `_agent/runs/`, which git ignores. On a cold cache the first run can hit the 60-a-minute upstream budget (see above); run it again after a minute.

The widget can be checked in a browser with `_agent/scripts/widget-harness.html` (serve `_agent/scripts` on any local port while `pnpm dev` runs; add `?theme=dark`, `?bar=gin,lime`, `?case=error` for a tool error, `?case=cancel` for a cancelled call, `?server=` for another port). It plays an MCP Apps host: answers `ui/initialize`, sends `tool-input`, then the tool result or `tool-cancelled`, resizes on `size-changed` and logs `ui/open-link`.

## Test and run evidence (22 Oct 2026)

- `pnpm test`: 5 files, **73 tests passed**. `pnpm typecheck`: clean, tests included.
- `wrangler deploy --dry-run`: 745 KiB, 157 KiB gzipped.
- `wrangler dev` + `pnpm smoke` against the live API: 18 tool cases and 2 ingress checks on each route, each with a 2025-era and a 2026-07-28 client: **all cases matched** (second run; the first, cold run hit the upstream budget after five `find` calls).
- Widget harness: rendered in light and dark, showed the tool error text for an error result, and cleared to "Search cancelled." on `tool-cancelled`.

Excerpt (2025-era client, `wrangler dev`, live API):

```text
find_cocktails_by_ingredients {"ingredients":["gin","limes","simple syrup","soda water"]}
  Your bar: gin -> London dry gin or Dry gin; limes -> Lime Juice / Lime; simple syrup -> Rich Simple (2:1) syrup or Plain Simple; soda water -> Soda Water.
  - Churchill Martini (Strong): can make now.   - Gin-Ger Tom (Strong): missing Ginger root.
  - Southside (Medium): missing Mint leaves.    - Grapefruit Rickey (Medium): missing Grapefruit Juice.
  - Pisco Collins (Medium): missing Pisco.
  Low or zero-proof options: Garibaldi (Low): missing Red Bitter Liqueur, Orange Juice.
  For adults of legal drinking age. Please drink responsibly.

get_cocktail_recipe {"name":"Margarita"}
  No recipe is named exactly "Margarita". This is the closest match in the Garçon catalogue.
  The Original Margarita … This is a premium recipe, so its ingredient list and steps are not public.
  Free recipes like it: Pink Margarita, Improved Trashy Margarita

suggest_similar_cocktail {"name":"Espresso Martini","low_proof":true}
  Low or zero-proof drinks like Espresso Martini: Coffee Collins, Cucumber & Mint Seltz, Spritzer, Garibaldi, Thuir Sour

get_cocktail_recipe {"name":"not a real drink qq"}  → isError: No cocktail called "not a real drink qq" in the Garçon catalogue. …
```

## Known limits of the data

- The catalogue has no plain "Negroni", "Mojito" or "Margarita"; it has variants ("Negroni Sbagliato", "The Original Margarita", premium). The recipe tool returns the closest match and says so.
- Only free recipes (about a third of the catalogue) can be ranked by what is missing, because premium recipes hide their ingredients.
- Few free recipes are Low or Non Alcoholic (37 at build time), so low-proof options often need a bottle the user lacks. The answer lists what is missing.
- The matches endpoint returns at most 50 "close" and 50 "almost there" recipes, and at most 16 are compared per call, so very large bars can miss some.

## Folder layout

- `README.md`, `SUBMISSION.md`: read these.
- `src/`: Worker and MCP server. `test/`: vitest suites and API fixtures.
- `plugin/`: the OpenAI plugin package to zip and upload (`plugin.json`, `mcp.json`, `assets/`).
- `_agent/`: smoke script and widget harness (`scripts/`); run transcripts and build output stay local and are not committed.
