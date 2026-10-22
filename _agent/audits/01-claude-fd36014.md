# Independent Claude audit: garcon-mcp at fd36014

Verdict: approve with changes. Code is tidy and the tool design meets both directories' annotation and description rules. Two problems block submission: a single POST gets past the rate limits, and a single cold `find` call can use up the shared upstream budget. The repo's suite passes 39/39 and typecheck is clean.

## High

H1. A batch request gets past the rate limits (src/index.ts:66-81, 113-120).
- `peek` parses the body once and the limiter counts one hit per POST, but a JSON-RPC array of tool calls is still served in full.
- Tried: with an IP cap of 1, one POST holding 5 `tools/call` messages returned 200 with 5 results.
- MCP 2025-06-18 removed batching (https://modelcontextprotocol.io/specification/2025-06-18/changelog).
- CALLER_LIMITER is keyed on the client-supplied `openai/subject`. Leaving it out, or sending more than 200 characters, skips that limiter.
- Fix: return 400 for array bodies, and treat the subject limit as a courtesy only.

H2. One `find` call can drain the upstream budget.
- `find` with 25 new ingredient names made 47 upstream fetches plus 94 Cache API operations: 141 subrequests in total.
- Workers Free allows 50 subrequests (Cache API calls count) and 10 ms of CPU per request (https://developers.cloudflare.com/workers/platform/limits/).
- UPSTREAM_LIMITER allows 60 per minute (wrangler.jsonc:379), so two such calls lock out every user in that Cloudflare location.
- README:56's claim of 900 requests per 15 minutes overall is wrong. Rate-limit counters are separate in each location, and Cloudflare's docs advise against keying on IP (https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). Claude sends no per-user id, so all Claude users share Anthropic's egress IPs at 300 per minute.
- Fix: cap ingredient-search lookups at about 8 per call; document that the Workers Paid plan is required; set `workers_dev: false` (wrangler.jsonc:371 leaves a second origin open where the Cache API doesn't work); get the API-key exemption from the recipe API.

H3. ChatGPT audience policy (SUBMISSION.md:153). OpenAI says plugins "must be suitable for general audiences, including users aged 13–17" (https://developers.openai.com/plugins/plugin-guidelines). No code change fixes this, so plan for a rejection.

## Medium

M1. The same drink can appear twice (src/service.ts:249-258).
- `pool` isn't filtered by strength, so it holds the same Low drinks as `lowPool`.
- Tried: a bar of Aperol and orange juice. Both drinks appeared in `cocktails` and in `low_proof_options`, and each recipe was fetched twice.
- Fix: leave the ids already in `pool` out of `lowPool`.

M2. Failure behaviour (src/upstream.ts).
- A 429 is retried after 400 ms and `Retry-After` is ignored (upstream.ts:205).
- Timeout is 10 s with 2 attempts, across 3 or 4 stages run one after another: worst case about 60 to 80 s.
- A 200 response with an HTML body throws SyntaxError and ends as the generic "Something went wrong" (tried). Anthropic's review wants actionable errors (https://claude.com/docs/connectors/building/review-criteria).
- Fix: map JSON parse failures to `unavailable`, respect `Retry-After`, and add an overall deadline per call.

M3. The production path isn't tested.
- Tests use the SDK's `createMcpHandler` (test/server.test.ts:6); production uses the `agents` wrapper (src/index.ts:8).
- Untested: src/index.ts (routes, limiters, CORS, the domain-challenge route), the `chatgpt` profile with `ui.domain`, retry, timeout, 5xx and the Cache API path.
- smoke.mjs calls only `/mcp` (line 13). The tests aren't typechecked: tsconfig includes only `src`.

M4. Bodies are read before any limit or size cap (src/index.ts:69).
- `request.clone().json()` buffers the whole body before the limiter runs, with no size cap, in a 128 MB isolate.
- Fix: reject requests whose content-length is over about 64 KB.

## Low

- A trailing slash gets a 404 after the limiter has counted it: `/mcp/` matches ROUTES but not the wrapper's `route` (tried).
- The CORS settings do nothing useful. `origin: '*'` is sent, yet the wrapper rejects every non-localhost browser Origin (tried: `https://claude.ai` got 403 with ACAO `*`). The 429 from index.ts carries no CORS headers.
- `suggest_similar` silently uses the closest match with no "not exact" note, and its suggestion list has no length cap (service.ts:393, 430).
- `suggest_similar` and `explain_bar_term` leave out the age line that README:22 says every text result ends with.
- Only the first 12 candidates, in API order, are re-ranked (service.ts:249). The API counts garnishes as missing, so drinks lacking only a garnish can be dropped before re-ranking.
- `asked === best.slug` is case-sensitive (service.ts:347).

## Checked and sound

- Upstream URLs use encodeURIComponent and URLSearchParams throughout.
- Each cache key maps only to the upstream answer for that key; no way found to poison another key.
- Widget escapes output, allowlists URLs and checks event.source.
- `ui.domain` as an origin and the legacy `redirect_domains` both match https://developers.openai.com/plugins/reference.
- `openWorldHint: false` is allowed for a bounded catalogue.

## AI-slop signals

- Dead code:
  - `RankedMatch.extra` (ranking.ts:138) is set at service.ts:177 and never read.
  - `requiredCount` (ranking.ts:101) is read only by tests.
  - `meta.image` (service.ts:368) has no widget to use it.
  - `ServiceResponse.statusCode` is never used.
- Probably invented API: `meta.mcp_tool_result || meta.call_tool_result` (widget.ts:114) appears in neither OpenAI's reference nor the MCP Apps spec.
- Duplication:
  - `byFewestMissing` (service.ts:193) re-implements `rankMatches`.
  - The "No cocktail called…" message appears twice (service.ts:338, 396).
  - The "busy" message appears twice (upstream.ts:174, 212).
- Defending impossible cases: the `limit` clamp at service.ts:227 repeats what zod already enforces.
- Magic number: `groupRank: 3` (service.ts:209).
- Narrating banner comments: server.ts:32, 119, 169; service.ts:43, 74, 116.
- Style:
  - `zod/v4` import on zod 4 (server.ts:6).
  - Literal combining characters in a regex (text.ts:10); `̀-ͯ` reads better.
- Weak tests:
  - `any` throughout.
  - The comment "every result passes its declared output schema" relies on SDK checks it never asserts.
  - The cache test checks only the in-isolate memory.
- Dependencies: `agents` is pulled in only for its handler wrapper, while the SDK ships its own (the tests use it). Agent run transcripts are committed under `_agent/runs`.
