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
   ├─ ingress, cheapest first: route, Origin (absent or localhost only, else 403), method (POST/OPTIONS),
   │  JSON content type, declared size ≤ 64 KB, IP_LIMITER, then one capped read and one parse;
   │  rejected bodies are cancelled best effort; a body that fails mid-upload gets a 400 JSON-RPC error;
   │  JSON-RPC batch arrays get a -32600 error; every MCP response carries the same CORS headers
   ├─ CALLER_LIMITER on openai/subject, only in addition to the IP limit
   ├─ tools (src/server.ts → src/service.ts, output schemas in src/schemas.ts)
   └─ Upstream, one per call (src/upstream.ts)
        ├─ in-isolate memory (≤10 min) and the Workers Cache API, keyed by API base URL and cache schema version
        ├─ identical lookups within a call share one request
        └─ ≤40 API requests per call, retries included; 8 s per attempt (body read included);
           one 20 s deadline per call over every awaited stage (cache, limiter, fetch, body, retry wait);
           one retry, honouring Retry-After up to 2 s → UPSTREAM_LIMITER → API
```

- **SDK:** the official TypeScript SDK v2 (`@modelcontextprotocol/server` 2.3) and its own `createMcpHandler`, which serves 2025-era clients (what ChatGPT and Claude use today) through its stateless fallback and 2026-07-28 clients natively. The Worker passes it the body it already parsed. MCP Apps helpers come from `@modelcontextprotocol/ext-apps` 2.0.
- **Ingredient matching:** the API's `/cocktails/matches` compares exact, case-sensitive catalogue names, so `src/ingredients.ts` first maps common words to catalogue names (a curated table built from the 250 most popular free recipes, every target verified against the live API), then falls back to `/ingredients/search` re-ranked with the website's rules, for at most 8 unfamiliar words per call (the rest are listed as `not_checked`). Every multi-name word is in one of three groups. Synonyms and forms ("gin" for London dry or dry gin, "white rum", "bitters", "limes" for juice and a wedge, "sugar") are definite: `matched_as`, owned, any number of times. One-bottle substitutes ("simple syrup", "sugar syrup", "cream", "heavy cream") are owned but cover one of their names per recipe (`single_bottle: true`). A word for one bottle of unknown kind ("vermouth", "whiskey", "whisky", "tequila", "scotch", "orange liqueur", the light or gold part of "rum", or two search results tied for first) goes in `could_be`: it stands in for at most one ingredient of a recipe, and only conditionally, as `depends_on` ("only if your vermouth is Dry vermouth"). It is never in `have` and never makes `can_make_now` true. Water and saline count as staples.
- **Ranking (`src/ranking.ts`):** free recipes only (premium ones hide their ingredients), filtered by strength and flavour, ordered by the API's own missing count and then recipe size, then compared with the bar from their full recipes in batches of 8: fewest missing first, then fewest conditional, then more of the bar used, then API order. Comparison stops only when no unchecked recipe can rank higher under that full order. The bound is the best a recipe could score: nothing missing (the API's group count includes garnishes and optional items, so it proves nothing), at most as many owned ingredients as the bar can cover (its definite names plus one per substitute) or the recipe has ingredients, and its known API order. Ownership counts distinct ingredient names, so a recipe listing one ingredient twice scores it once; quantities stay in the recipe tool. A test checks the result against exhaustive ranking on 200 generated cases that cross the batch boundary. When the 16-recipe cap (6 for low-proof) stops the search first, the answer sets `partial: true` and the text says others might match. Garnishes and optional ingredients never block a match. Low-proof options never repeat a drink from the main list; if they cannot be loaded, the main answer is kept and `unavailable` says so.
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

The tests import the Worker's default export and drive it with fake rate limiters, a fake Cache API and a fetch stub for the recipe API, so they run the production path: routing, ingress checks, CORS, limiters, both MCP routes and both protocol eras (real SDK clients), every tool, and upstream 429 (with a real one-second Retry-After), 5xx, errored and stalled bodies, HTML, pending cache and limiter stages and memory or settled hits against the call deadline, and budget failures. `test/widget-boot.test.ts` runs the widget's whole embedded script against a fake DOM and host: initialisation, theme, tool messages, size reports and link opening.

`pnpm smoke` (or `node _agent/scripts/smoke.mjs <baseUrl>`) states the expected outcome of every case, checks the result fields and the age line, and exits 1 on any mismatch. It writes a transcript to `_agent/runs/`, which git ignores. On a cold cache the first run can hit the 60-a-minute upstream budget (see above); run it again after a minute.

### Widget and pages

The widget (`src/widget.ts`) and the public pages (`src/pages.ts`) use the fixmeadrinkapp.com tokens, copied into `src/brand.ts` under the site's own names (colours, type scale, spacing, radii, shadows), with the Garçon mascot mark and "Garçon" wordmark in DM Sans semibold. Fonts (DM Sans and Inter, OFL, self-hosted) and the Garçon images are Workers static assets in `public/`; `public/_headers` adds CORS for the fonts, because the widget loads them from the host's sandboxed iframe. The widget resource's CSP declares `https://images.fixmeadrinkapp.com` (recipe photos) and `https://mcp.fixmeadrinkapp.com` (fonts and the Garçon image). Cards copy `components/garcon/recipe-card.tsx` value for value: a 3:2 photo (radius 24, elevation e2, lift and e3 on hover, 0.98 on press), the site placeholder when there is no photo, the Plus badge (`plus-badge.tsx`, on-image variant) top left for a card marked `premium`, then the name in title 2 medium, the xs tags row ("Ready to make" as the success tag, then every flavour) and one caption 2 line for what is missing or conditional. Below 640 px the cards form a scroll-snap carousel (cards 72% wide, so the next one shows; arrow buttons in the site's stepper style; Left, Right, Home and End on the list or a focused card); from 640 px they follow `CardGrid` columns 3 (two columns, three from 1024 px). OpenAI's inline carousel guidance (https://developers.openai.com/apps-sdk/concepts/ui-guidelines): 3 to 8 items, an image and title on every item, metadata kept short, one action per item, alt text on images. Links open with the opener the host negotiated in `ui/initialize` (`ui/open-link` when it lists `openLinks`, otherwise ChatGPT's `openExternal`); a refusal or cancelled confirmation is final, and a request that gets no answer in 15 s shows "Try again" and the URL to copy instead of opening anything itself. The widget resource is `ui://ask-garcon/cocktail-list-v2.html`. The footer link uses the site's inline link token, `text/primary_high_em` (#6635f2) with an `outline/primary_med_em` underline; the magenta it had before is `text/secondary_med_em`, which the site uses only for the footer's "All ..." links and the current breadcrumb. The `/chatgpt/mcp` route serves the widget without the brand fonts: OpenAI's UI guidelines say "Don't use custom fonts, even in full screen modes" (https://developers.openai.com/apps-sdk/concepts/ui-guidelines), so it uses the host's `--font-sans` or the system stack. Claude's guidelines prefer host tokens for structural colour and bundled fonts over allowlisted CDNs (https://claude.com/docs/connectors/building/mcp-apps/design-guidelines, https://claude.com/docs/connectors/building/mcp-apps/transparent-theming). The widget keeps its background transparent and follows the host's light or dark theme with `light-dark()`, but it colours text, tags and links with the site's tokens (dark values derived from them) so it reads as fixmeadrinkapp.com; if a reviewer objects, map `--c-text`, `--c-muted` and `--c-rule` in `src/widget.ts` to the host's `--color-*` variables.

`_agent/scripts/widget-harness.html` plays an MCP Apps host while `pnpm dev` runs: it reads the widget resource, points the production asset origin at the local server, applies the resource's own CSP to the frame (so a missing CSP entry breaks a font or image here too), answers `ui/initialize`, sends `tool-input`, then the tool result or `tool-cancelled`, resizes on `size-changed` and logs `ui/open-link`. Serve it from localhost (`python3 -m http.server 8790` in `_agent/scripts`, then http://localhost:8790/widget-harness.html): the server refuses the `null` Origin a `file://` page sends. Query: `?case=result|lowproof|empty|error|cancel|loading|long|noimage|plus` (`plus` marks the first card premium to show the badge; find never returns premium recipes), `?theme=dark`, `?width=760`, `?route=/chatgpt/mcp`, `?bar=gin,lime`, `?server=http://127.0.0.1:8788`.

## Test and run evidence (22 Oct 2026)

- `pnpm test`: 7 files, **128 tests passed**. `pnpm typecheck`: clean, tests included.
- `wrangler deploy --dry-run`: 786 KiB, 169 KiB gzipped, plus 10 static assets (fonts and images).
- `wrangler dev` + `pnpm smoke` against the live API: 18 tool cases and 2 ingress checks on each route, each with a 2025-era and a 2026-07-28 client: **all cases matched** (second run; the first, cold run hit the upstream budget after five `find` calls).
- Widget harness: results, low-proof, empty, error, cancelled, loading, long-name and missing-image states in light and dark at 420 and 760 px; screenshots in `marketing/seo/outreach/2026-10-q4/previews/mcp/`.

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
- The matches endpoint returns at most 50 "close" and 50 "almost there" recipes, and at most 16 are compared per call. Answers that stop at the cap before the ranking is proven say so with `partial: true`; on the live API most bars without a full match end up partial.

## Folder layout

- `README.md`, `SUBMISSION.md`: read these.
- `src/`: Worker and MCP server. `public/`: fonts and images served as static assets. `test/`: vitest suites and API fixtures.
- `plugin/`: the OpenAI plugin package to zip and upload (`plugin.json`, `mcp.json`, `assets/`).
- `_agent/`: smoke script and widget harness (`scripts/`); run transcripts and build output stay local and are not committed.
