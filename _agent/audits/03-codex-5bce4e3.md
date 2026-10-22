Audited `5bce4e3`. No files changed.

**73/73 tests passed. Typecheck passed for all 22 configured files.** I used an in-memory dependency mapping and disabled both Vitest caches. I also ran targeted reproductions through the exported Worker. I did not run the smoke script because it writes a transcript.

No critical or high code defect was confirmed. Several earlier fixes are incomplete.

## Earlier findings

“C” refers to the numbered Codex findings; Claude references retain their original labels.

| Earlier finding | Status | Evidence at `5bce4e3` |
|---|---|---|
| C1; Claude M4: body parsed before limits | **Fixed** | `src/index.ts:94–107` checks content type, declared size and IP allowance before the capped read and JSON parse. The installed SDK counts streamed bytes. An oversized chunked request returned 413. |
| C2; Claude H2: duplicated upstream work and budget exhaustion | **Partly** | `src/upstream.ts:132–139` coalesces within one call; ten identical lookups produced **one fetch**. The counter at `:177` limited 45 parallel lookups to **40 fetches**. Searches are capped at eight (`src/service.ts:158`). Independent cold calls still duplicate work: ten instances produced ten fetches. The shared allowance remains 60/minute (`wrangler.jsonc:20`); the upstream exemption remains an unresolved deployment blocker. Paid-plan requirements and per-location limits are now documented accurately; `workers_dev` is disabled. |
| C3; Claude H1 identity portion: caller-controlled subject quota | **Partly** | `src/index.ts:115–118` still trusts supplied metadata for this bucket. Omitting it still bypasses that bucket, explicitly tested at `test/worker.test.ts:167`. It is now correctly documented as advisory, with independent IP and per-call limits. |
| C4; Claude M2: retry, body failures and excessive duration | **Partly** | Successful-response body reads are inside the attempt catch; `Retry-After: 120` prevents retry, and malformed JSON becomes `UpstreamError`. Cancellation failures and the overall deadline still have holes. Findings 3–4 below. |
| C5: optional work discards primary results | **Partly** | Normal `UpstreamError` failures are isolated at `src/service.ts:285` and `:348`. A rejecting response-body cancellation still escapes those boundaries and discards the primary result. Reproduced below. |
| C6: cache keys omit upstream identity | **Fixed** | `src/upstream.ts:133` includes schema version and base URL; that same key feeds memory and Cache API storage. Separate-upstream and fresh-module Cache API tests pass. |
| C7: ambiguous aliases establish simultaneous ownership | **Partly** | `one_of` prevents one vermouth term covering both variants in one recipe. It still treats either variant individually as certainly owned. Finding 2. |
| C8; Claude low ranking finding: truncation before correct ranking | **Partly** | Progressive retrieval fixes the original 13-candidate example. The new stop condition ignores ranking tie-breakers, and candidate 17 can still be the omitted best match. Finding 1. |
| C9: zero-similarity catalogue alternatives | **Fixed** | `src/service.ts:381` filters `score > 0`. The Coffee/Fruity negative fixture passes. |
| C10: widget ignores errors/cancellation | **Fixed** | `src/widget.ts:131–135` handles `isError`; `:171–176` handles loading and cancellation. Executing the script produced the error text and then “Search cancelled.”, replacing previous content. |
| C11; Claude M3: tests bypass production and smoke accepts errors | **Fixed** | Tests import `../src/index` and invoke its exported `fetch`. The real SDK handler remains in use. Both routes and client generations pass. `_agent/scripts/smoke.mjs:128–139` rejects unexpected `isError` results and validates fields. Tests are included in `tsconfig.json`. |
| C12: unknown arguments silently stripped | **Fixed** | All four inputs use `z.strictObject()` and trim strings. The `strengthh` test returns a validation error without upstream calls. |
| C13: early 429 lacks CORS and echoes invalid IDs | **Fixed** | `src/index.ts:134–144` applies common headers; `requestId()` accepts only strings/numbers. Corresponding tests pass. |
| C14: inherited alias properties | **Fixed** | Alias storage is now a `Map` (`src/ingredients.ts:16,158`). `constructor` and `__proto__` are handled as unknown ingredients. |
| Claude H1 batching portion | **Fixed** | `src/index.ts:111–113` rejects arrays with HTTP 400 / `-32600`; the five-call batch test makes no upstream requests. |
| Claude H3: ChatGPT audience policy | **Not fixed; outside code scope** | Explicitly recorded in `SUBMISSION.md:9`. The [current guideline](https://developers.openai.com/plugins/plugin-guidelines) still contains the audience requirement. This establishes a submission risk, not a certain rejection. |
| Claude M1: duplicate main/low-proof drinks | **Fixed** | `src/service.ts:272–283` excludes displayed IDs; per-call coalescing prevents repeated detail fetches. The overlap fixture passes. |
| Claude low: trailing slash | **Fixed** | `src/index.ts:142` normalizes it; both routes pass. |
| Claude low: browser origins rejected despite permissive CORS | **Partly** | Browser requests now work and early responses have CORS. However, the wrapper’s Origin validation was removed entirely. Finding 5. |
| Claude low: similar results lack inexact note and cap | **Fixed** | `src/service.ts:403–414` adds the note and caps suggestions at five. |
| Claude low: missing age suffix | **Fixed** | `src/server.ts:37` adds it centrally to successful results from every tool. |
| Claude low: case-sensitive slug equality | **Fixed** | `src/service.ts:98,108,142` normalizes slug case. Mixed-case slug/URL tests pass. |

The Paid-plan requirement is justified: Cache API calls share the subrequest quota with fetches. The new 40-fetch limit is **not** a 40-total-subrequest limit. [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/)

## Current findings

### 1. medium — Ranking still omits demonstrably better results

[src/ranking.ts:203](/private/tmp/claude-501/-Users-denisso-Documents-work-blankpage-fixmeadrink-marketing-seo/d887e153-c878-4b3e-8f7d-31ccbd68ad24/scratchpad/review/mcp2/src/ranking.ts:203), also `src/service.ts:50`.

```ts
if (top.length === limit &&
    top.every((match) => match.comparison.missing.length <= floor)) break
```

The comparator also prefers more owned ingredients and then API order. This condition proves neither.

**Reproduction through the Worker:** bar `["vodka", "lime juice"]`, limit 1, nine `readyToMake` recipes:

- First eight contain Vodka plus the two assumed staples. Their preview count is three; comparison yields `have: ["Vodka"]`.
- Ninth contains Vodka and Lime Juice. Its preview count is two; comparison would yield two owned ingredients.

The Worker fetched only the first eight and returned `small-0`. The ninth recipe should win under `rankMatches()`. This example contains **no garnish**, so the one-garnish assumption cannot rescue the rule.

The hard cap independently preserves the original defect: sixteen close recipes missing one required ingredient followed by a seventeenth missing only one garnish returned five incomplete recipes without fetching the complete one. No partial-result indication was returned.

**Fix:** Make early termination respect the complete comparator. A strictly worse missing-count lower bound is sufficient; equality requires bounds for the tie-breakers. When the detail budget prevents proving completeness, return an explicit partial-result indication, or obtain ranking summaries upstream.

### 2. medium — `one_of` still turns uncertainty into definite ownership

[src/ranking.ts:136](/private/tmp/claude-501/-Users-denisso-Documents-work-blankpage-fixmeadrink-marketing-seo/d887e153-c878-4b3e-8f7d-31ccbd68ad24/scratchpad/review/mcp2/src/ranking.ts:136), `src/service.ts:216`.

```ts
covered[open[slot]] = true
```

An unspecified bottle is assigned whichever interpretation makes the recipe work.

**Reproduction with only `"vermouth"`:**

```text
Recipe requiring Dry vermouth   → have: ["Dry vermouth"],   missing: []
Recipe requiring Sweet vermouth → have: ["Sweet vermouth"], missing: []
```

Both become `can_make_now: true`. Restricting assignment to one ingredient fixes double-counting, but does not establish which bottle the user owns.

**Fix:** Separate interchangeable aliases from ambiguous variants. Preserve ambiguous coverage as conditional, or request clarification. Do not include it in definite `have` or unconditional `can_make_now`.

### 3. medium — Response cancellation can bypass retries and discard primary answers

[src/upstream.ts:217](/private/tmp/claude-501/-Users-denisso-Documents-work-blankpage-fixmeadrink-marketing-seo/d887e153-c878-4b3e-8f7d-31ccbd68ad24/scratchpad/review/mcp2/src/upstream.ts:217).

```ts
await response.body?.cancel()
```

This sits outside the attempt’s `try/catch`. Cancelling an already errored stream rejects.

**Reproduction:** return HTTP 503 with a response stream errored by `TypeError("connection reset after headers")`.

```text
Upstream attempts: 1
Tool result: isError: true
Message: "Something went wrong while looking that up..."
```

The status-based retry never executes. Applied to the optional low-proof catalogue request, the same failure also discarded an already obtained, makeable vodka recipe: `src/service.ts:286` only catches `UpstreamError`.

**Fix:** Make cleanup best-effort and bounded. A cancellation error must not replace the HTTP-status classification. Normalize transport failures before they reach optional-result boundaries.

### 4. medium — The advertised 20-second deadline does not bound the operation

[src/upstream.ts:151](/private/tmp/claude-501/-Users-denisso-Documents-work-blankpage-fixmeadrink-marketing-seo/d887e153-c878-4b3e-8f7d-31ccbd68ad24/scratchpad/review/mcp2/src/upstream.ts:151), also `:154`, `:178`, `:217`.

```ts
const stored = await this.cache?.match(cacheRequest).catch(() => undefined)
if (!(await this.permit())) throw new UpstreamError(BUSY)
```

The deadline is checked around fetch attempts. Cache lookup/body consumption and limiter waits can remain pending beyond it. A cache hit can subsequently return success without checking the deadline.

**Real-time reproduction:**

```text
after 21228 ms: cacheDone=false, permitDone=false
release cache: returns {late:true}
release permit: only now reports "too slow"
```

**Fix:** Apply one operation deadline across all awaited stages, with abort propagation for fetches and bounded waits for non-abortable operations. Ensure late completions cannot resume upstream work after the caller has timed out.

### 5. medium — The SDK switch removes Origin validation

[src/index.ts:127](/private/tmp/claude-501/-Users-denisso-Documents-work-blankpage-fixmeadrink-marketing-seo/d887e153-c878-4b3e-8f7d-31ccbd68ad24/scratchpad/review/mcp2/src/index.ts:127).

The Worker delegates directly to `createMcpHandler` and never validates Origin.

**Reproduction:** `tools/list` returned HTTP 200 with `Access-Control-Allow-Origin: *` for all of:

```text
https://claude.ai
https://attacker.invalid
null
not an origin
```

The installed SDK explicitly says the entry is “deliberately validation-free” and requires Origin/Host validation in front of it: [installed handler source](/Users/denisso/Documents/work/blankpage/fixmeadrink/garcon-mcp/node_modules/@modelcontextprotocol/server/dist/index.mjs:1289). The [2025 transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) requires Origin validation.

This is a protocol-validation regression; I did not establish private-data exposure.

**Fix:** Validate present Origins before reading the body, using an explicit browser-origin policy. Preserve support for server-to-server requests without Origin. The installed SDK exports `originValidationResponse`; it does not run automatically.

### 6. low — Upload-stream errors escape the Worker’s response policy

[src/index.ts:103](/private/tmp/claude-501/-Users-denisso-Documents-work-blankpage-fixmeadrink-marketing-seo/d887e153-c878-4b3e-8f7d-31ccbd68ad24/scratchpad/review/mcp2/src/index.ts:103).

```ts
const read = await readRequestBody(request, MAX_BODY_BYTES)
```

Only JSON parsing is caught. The installed helper explicitly propagates stream failures.

**Reproduction:** an incoming stream errored with `Error("upload failed")` caused exported `worker.fetch()` to reject with that error instead of returning a controlled JSON-RPC response. Consequently, `withCors()` never runs.

The oversized-stream probe correctly returned 413, but did not cancel the input stream; the helper only releases its reader lock.

**Fix:** Catch read failures and return a controlled error through the common response-header path. Cancel rejected bodies where possible without allowing cancellation failure to escape.

## AI-slop signals

Most earlier cleanup findings were addressed:

- Dead `Flavor`, `RankedMatch.extra`, `requiredCount`, recipe `meta.image`, `ServiceResponse`, and `UpstreamError.kind` are removed. `PRIVACY_URL` now has a consumer at `src/pages.ts:68`. The unused generic plumbing is gone.
- Duplicate ranking comparators and output interfaces are consolidated. Output types derive from Zod schemas. The repeated lookup error and busy message are centralized.
- Banner comments, the redundant limit clamp, `groupRank: 3`, undocumented nested widget metadata, redundant array copying, and `zod/v4` imports are removed. The normalization regex uses explicit Unicode escapes.
- `agents` is removed; run transcripts are untracked and ignored. I found no unnecessary remaining dependency or nonexistent installed API/option. No material naming inconsistency stood out.

The remaining concern is **tests that overstate their coverage**:

- `test/upstream.test.ts:20` claims to test waiting out `Retry-After`, but supplies **zero seconds**.
- `test/upstream.test.ts:45` injects a `TimeoutError`; it does not verify that the actual timeout aborts a stalled body.
- `test/upstream.test.ts:69` advances `Date` inside a completed 503 response. It misses pending cache/limiter operations.
- `test/tools.test.ts:76` says “every close candidate,” but uses thirteen candidates against a sixteen-candidate cap.

The Worker and SDK are genuinely exercised. The mocks do **not** replace them. Missing adversarial cases explain why all 73 tests pass despite the failures above.

Protocol compatibility itself checked out: installed server **2.3.1**, legacy client **1.32.1**, and modern client **2.3.1** work through both routes. Direct requests for `2025-03-26`, `2025-06-18`, and `2025-11-25` succeeded; the suite also exercises `2026-07-28`. The handler options and parsed-body escape hatch exist in the installed source.

## Verdict

**Approve with changes.** I would block approval as-is, but this needs targeted corrections rather than a rewrite.

The five changes that matter most:

1. Correct ranking termination and disclose budget-truncated results.
2. Preserve ambiguous ingredient ownership in the result.
3. Make response cleanup preserve retries and successful primary answers.
4. Enforce the deadline across the entire operation.
5. Restore Origin validation and controlled ingress errors, with regression tests for the reproduced failures.