Audited only `87b9652..1a2ae02`. **128/128 tests passed; typecheck passed for all 25 configured files.** Dependencies were mapped in memory, with test caches disabled. No files modified. Smoke testing was skipped because it writes transcripts; browser-level focus and CSP behavior were not exercised.

The original five reproductions are fixed, but the diff introduces regressions below. No critical or high defect confirmed.

| Prior finding | Status | Evidence |
|---|---|---|
| Ambiguous bottles counted twice | **Fixed** | `src/ingredients.ts:145` moves Scotch and orange liqueur into `could_be`. The two-Scotch Worker test leaves one conditional and one missing. |
| Navigation retried after refusal | **Fixed** | `src/widget.ts:277` returns `refused`; rejected requests return `failed`, without another opener. Installed ext-apps 2.0.3 confirms that `isError` includes cancellation. |
| Ranking counts disagree with termination bound | **Fixed** | `src/ranking.ts:158` deduplicates normalized requirements; `haveCeiling()` counts definite names plus one per substitute. The original repeated-Vodka reproduction passes. |
| Expired cache hits succeed | **Fixed** | `src/upstream.ts:178` checks expiry before either cache path. Both new real-timer tests pass. |
| Unchanged widget cache key | **Fixed** | `WIDGET_URI` is now `cocktail-list-v2.html`; registration, tool metadata, smoke script and fixtures agree. |

Cleanup is **partly fixed**: `WIDGET_HTML` is removed, the refusal expectation and batch-boundary test are corrected, and the Origin comments acknowledge uncertainty. Complete-script tests now exist, but DOM/CSP coverage remains incomplete; the stalled-body test still does not assert signal abortion.

1. **medium — Substitute assignment can report an ingredient missing when a valid conditional assignment exists.**  
   [src/ranking.ts:170](/private/tmp/claude-501/-Users-denisso-Documents-work-blankpage-fixmeadrink-marketing-seo/d887e153-c878-4b3e-8f7d-31ccbd68ad24/scratchpad/review/mcp4/src/ranking.ts:170)

   Substitutes are assigned first and cannot be reassigned when conditional bottles are processed:

   ```ts
   assignBottles(..., substitutes)
   // Then assign conditional bottles only to remaining slots.
   ```

   Reproduced through `findCocktails()` with a synthetic upstream fixture:

   - Input: `["simple syrup", "syrup"]`.
   - Search resolves `"syrup"` conditionally to rich simple syrup or honey syrup.
   - Recipe order `[rich simple syrup, plain simple]` reports plain simple **missing**.
   - Reversing those same recipe rows reports **nothing missing**, with rich simple syrup conditional.

   Recipe row order changes both the answer and its ranking. **Fix:** assign substitutes and conditional bottles together, maximizing coverage first and definite ownership second. Test permutation invariance.

2. **low — Initialization timeout permanently disables otherwise available navigation.**  
   [src/widget.ts:465](/private/tmp/claude-501/-Users-denisso-Documents-work-blankpage-fixmeadrink-marketing-seo/d887e153-c878-4b3e-8f7d-31ccbd68ad24/scratchpad/review/mcp4/src/widget.ts:465)

   ```js
   linkMode = hasOpenExternal() ? 'openai' : 'none';
   ```

   The four-second initialization timeout deletes the pending request. In a complete-script probe, a subsequent valid response advertising `{openLinks:{}}` was ignored. Clicking the card and then “Try again” produced **zero `ui/open-link` requests** and no new initialization attempt.

   The same branch changes standalone mode from `window` to `none` after four seconds, although no parent host exists.

   **Fix:** preserve standalone mode and allow explicit retry of failed initialization. Continue treating actual navigation refusal as final.

3. **low — Opener selection reads the current global, but invocation uses a stale snapshot.**  
   [src/widget.ts:321](/private/tmp/claude-501/-Users-denisso-Documents-work-blankpage-fixmeadrink-marketing-seo/d887e153-c878-4b3e-8f7d-31ccbd68ad24/scratchpad/review/mcp4/src/widget.ts:321)

   ```js
   openai: window.openai
   ```

   `hasOpenExternal()` subsequently reads the live global. If `window.openai` appears between boot and initialization completion, negotiation selects `openai`, but `deps.openai` remains undefined.

   Reproduction: boot without the global, install `openExternal`, then answer initialization without `openLinks`. Clicking produces **zero calls to `openExternal`** and displays failure help.

   **Fix:** resolve the API at invocation through a getter, and refresh capability selection when globals arrive.

4. **low — The generated ranking test provides much less coverage than claimed.**  
   [test/ranking.test.ts:192](/private/tmp/claude-501/-Users-denisso-Documents-work-blankpage-fixmeadrink-marketing-seo/d887e153-c878-4b3e-8f7d-31ccbd68ad24/scratchpad/review/mcp4/test/ranking.test.ts:192)

   ```ts
   seed = (seed * 1103515245 + 12345) % 2147483648
   ```

   Multiplication exceeds safe integer precision. Executing this exact generator produced `ceiling === 1` in **all 200 cases**, **189 empty expected results**, and only **two cases that pruned any candidates**.

   **Fix:** use a reliable seeded generator or explicit fixtures. Assert coverage of multiple ceilings, nonempty results, conditional ownership and actual pruning.

No additional carousel keyboard/focus defect or escaping/CSP regression was confirmed. Text and URL escaping remain intact, and the placeholder uses an already allowed asset origin. Installed ext-apps definitions confirm `openLinks`, `connectDomains` and `resourceDomains`. Deadline checks show no new regression.

## AI-slop signals

- **Tests mock away carousel integration.** [test/widget-boot.test.ts:31](/private/tmp/claude-501/-Users-denisso-Documents-work-blankpage-fixmeadrink-marketing-seo/d887e153-c878-4b3e-8f7d-31ccbd68ad24/scratchpad/review/mcp4/test/widget-boot.test.ts:31) always returns `[]` from `querySelectorAll()`, so shelf setup never runs. Separate carousel tests use mocked scrolling and focus. Add browser coverage for wiring, focus, scroll boundaries and CSP.
- **Unused additions.** `src/widget.ts:74` adds an `icon` argument that no caller supplies. `src/brand.ts:104` and `:112` add unused `--size-control-sm` and `--radius-10` tokens. Remove them.
- **Narration remains.** Comments around card markup and skeleton construction mostly repeat structure or styling. Keep provenance and behavioral rationale; trim narration.
- No material naming inconsistency, duplicated business logic, needless dependency, impossible-case defense or nonexistent installed API was confirmed.

## Verdict

**Approve with changes.** The original defects are repaired, but the mixed-bottle assignment regression warrants correction before approval.

The five changes that matter most:

1. Assign substitute and conditional bottles jointly.
2. Make failed initialization recoverable and preserve standalone opening.
3. Read the current host opener at invocation.
4. Replace the degenerate ranking fixtures.
5. Add browser tests for carousel wiring, focus and CSP.