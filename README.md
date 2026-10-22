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

Responsible-drinking posture: tool descriptions and the server instructions say the drinks are for adults of legal drinking age; find and similar always include low or zero-proof options; no tool gives health or nutrition advice (calorie data from the API is deliberately not returned). Text results end with "For adults of legal drinking age. Please drink responsibly." where the drink contains alcohol.

## Routes

| Route | Purpose |
|---|---|
| `POST /mcp` | MCP endpoint for Claude and any other client. |
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
   ├─ rate limits: IP_LIMITER 300/min per IP, CALLER_LIMITER 30/min per ChatGPT user (openai/subject)
   ├─ tools (src/server.ts → src/service.ts)
   └─ Upstream (src/upstream.ts)
        ├─ in-isolate memory (≤10 min)
        ├─ Workers Cache API (per data center; TTLs below)
        └─ UPSTREAM_LIMITER 60/min per location → https://fix-me-a-drink-api.fly.dev/api/v1
```

- **SDK:** Cloudflare's stateless `createMcpHandler` from `agents/mcp/server` (Agents SDK 0.30) on top of the official TypeScript SDK v2 (`@modelcontextprotocol/server` 2.3), which Cloudflare's docs recommend for new servers. It serves both 2025-era clients (what ChatGPT and Claude use today) and 2026-07-28 clients. MCP Apps helpers come from `@modelcontextprotocol/ext-apps` 2.0.
- **Ingredient matching:** the API's `/cocktails/matches` compares exact, case-sensitive catalogue names, so `src/ingredients.ts` first maps common words to catalogue names (a curated table built from the 250 most popular free recipes, every target verified against the live API), then falls back to `/ingredients/search` re-ranked with the website's rules. Water and saline count as staples.
- **Ranking (`src/ranking.ts`):** free recipes only (premium ones hide their ingredients), filtered by strength and flavour, then the top 12 are compared with the bar from their full recipes: fewest missing first, then more of the bar used, then the API's grouping and popularity. Garnishes and optional ingredients never block a match.
- **Recipe lookup:** the full catalogue list (one call of 2,000 per page, cached 12 h) is ranked locally, because the API's search ranks poorly for classics ("negroni" returns variants first). Qualified classics count as exact ("Manhattan (Sweet)", "The Original Margarita").

Cache TTLs: catalogue 12 h, recipe details, similar lists, glossary and ingredient pages 24 h, ingredient search 7 days, matches 1 h, "not found" answers 10 min. The Cache API only works on a custom domain (not on `workers.dev`), which is another reason to deploy on `mcp.fixmeadrinkapp.com`.

Upstream budget: one cold `find` call costs about 15 to 20 API requests (matches plus up to 16 recipe details); a warm one costs none. The 60-per-minute budget per Cloudflare location is 900 per 15 minutes, under the API's 1,000. If it runs out, tools answer "Garçon is handling a lot of requests right now. Try again in a minute." See SUBMISSION.md for the option to exempt the Worker from the API limit.

## Develop

```bash
pnpm install
pnpm test          # vitest: ranking, mapping, and the MCP server in-process with fixtures
pnpm typecheck
pnpm dev           # wrangler dev on http://127.0.0.1:8787
pnpm smoke         # scripted MCP client (SDK v2) against wrangler dev and the live API
node _agent/scripts/smoke.mjs --legacy   # same with the v1 SDK client (2025-era protocol)
```

The widget can be checked in a browser with `_agent/scripts/widget-harness.html` (serve `_agent/scripts` on any local port while `pnpm dev` runs; add `?theme=dark` or `?bar=gin,lime`). It plays an MCP Apps host: answers `ui/initialize`, sends a live tool result, resizes on `size-changed` and logs `ui/open-link`.

## Test and run evidence (22 Oct 2026)

- `pnpm test`: 3 files, **39 tests passed**.
- `pnpm typecheck`: clean. `wrangler deploy --dry-run`: bundle 755 KiB, 158 KiB gzipped.
- `wrangler dev` + scripted clients against the live API: every tool called with valid and invalid input, on both protocol eras, **0 failures**. Full transcripts: [`_agent/runs/smoke-v1-2026-10-22T16-36-19.md`](_agent/runs/smoke-v1-2026-10-22T16-36-19.md) (SDK 1.32, 2025-era) and [`_agent/runs/smoke-v2-2026-10-22T16-36-19.md`](_agent/runs/smoke-v2-2026-10-22T16-36-19.md) (SDK 2.3).
- Cold cache: the first `find` took 1.4 s and the first recipe lookup about 0.5 s (catalogue download); warm calls took 5 to 30 ms.
- Rate limit: 33 calls in a minute with one `openai/subject` gave 30 × 200, then 429 with `Retry-After: 60` and a JSON-RPC error body.
- Widget: rendered in the harness in light and dark themes with images; a card click sent `ui/open-link` for the recipe URL.

Condensed transcript (SDK 1.32 client, `wrangler dev`, live API):

```text
tools/list → 4 tools, all readOnlyHint true / destructiveHint false / openWorldHint false;
             find_cocktails_by_ingredients has _meta.ui.resourceUri ui://ask-garcon/cocktail-list-v1.html
resources/read ui://ask-garcon/cocktail-list-v1.html → text/html;profile=mcp-app, 8,333 chars,
             csp.resourceDomains [https://images.fixmeadrinkapp.com]

find_cocktails_by_ingredients {"ingredients":["gin","limes","simple syrup","soda water"]}
  Your bar: gin -> London dry gin / Dry gin; limes -> Lime Juice / Lime; simple syrup -> Rich Simple (2:1) syrup / Plain Simple; soda water -> Soda Water.
  - Churchill Martini (Strong): can make now. https://fixmeadrinkapp.com/recipes/churchill-martini
  - Gin-Ger Tom (Strong): missing Ginger root.
  - Southside (Medium): missing Mint leaves.
  - Grapefruit Rickey (Medium): missing Grapefruit Juice.
  - Pisco Collins (Medium): missing Pisco.
  Low or zero-proof options:
  - Garibaldi (Low): missing Red Bitter Liqueur, Orange Juice.

find_cocktails_by_ingredients {"ingredients":["aperol","prosecco","soda water","orange juice"],"strength":"zero_or_low"}
  - Buck's Fizz (Low): can make now.  - Spritzer (Low): missing White wine.  - Pink Aperitivo (Low): missing Grapefruit Soda. …

find_cocktails_by_ingredients {"ingredients":["xyzzy"]}
  Not recognised: xyzzy. None of those matched an ingredient in the Garçon catalogue. …

get_cocktail_recipe {"name":"Espresso Martini"}
  Espresso Martini: https://fixmeadrinkapp.com/recipes/espresso-martini
  Strength: Strong · about 17% ABV · Glass: Martini · 5 min
  - 1½ oz (44 ml) Vodka  - 1 oz (30 ml) Espresso  - ⅔ oz (20 ml) Coffee liqueur  - 2 drops Saline solution 4:1 (optional)
  Garnish: 3 Coffee Beans; 5 steps

get_cocktail_recipe {"name":"Margarita"}
  No recipe is named exactly "Margarita". This is the closest match in the Garçon catalogue.
  The Original Margarita … This is a premium recipe, so its ingredient list and steps are not public.
  Free recipes like it: Pink Margarita, Improved Trashy Margarita

get_cocktail_recipe {"name":"not a real drink qq"}  → isError: No cocktail called "not a real drink qq" in the Garçon catalogue. …

explain_bar_term {"term":"mezcal"}
  Mezcal (spirit): https://fixmeadrinkapp.com/ingredients/mezcal
  Typical ABV: 38 to 55%. Substitutes: Tequila, Reposado tequila, Lyre's Agave Blanco (zero-proof)

explain_bar_term {"term":"what is a dry shake?"}
  Dry shake (technique): https://fixmeadrinkapp.com/glossary/dry-shake  + 5 how-to steps

suggest_similar_cocktail {"name":"Moscow Mule"}
  - Raspberry Mule (Medium) … - Reality Check [premium recipe] …
  Low or zero-proof options: Cucumber & Mint Seltz, Spritzer

suggest_similar_cocktail {"name":"Espresso Martini","low_proof":true}
  - Coffee Collins (Low, Coffee, Citrusy) - Cucumber & Mint Seltz - Spritzer - Garibaldi
```

## Known limits of the data

- The catalogue has no plain "Negroni", "Mojito" or "Margarita"; it has variants ("Negroni Sbagliato", "The Original Margarita", premium). The recipe tool returns the closest match and says so.
- Only free recipes (about a third of the catalogue) can be ranked by what is missing, because premium recipes hide their ingredients.
- Few free recipes are Low or Non Alcoholic (37 at build time), so low-proof options often need a bottle the user lacks. The answer lists what is missing.
- The matches endpoint returns at most 50 "almost there" recipes, so very large bars can miss some.

## Folder layout

- `README.md`, `SUBMISSION.md`: read these.
- `src/`: Worker and MCP server. `test/`: vitest suites and API fixtures.
- `plugin/`: the OpenAI plugin package to zip and upload (`plugin.json`, `mcp.json`, `assets/`).
- `_agent/`: scripts, run transcripts and build output for agents.
