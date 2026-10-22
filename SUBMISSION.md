# Deploy and submit Ask Garçon

Steps for Denis, in order: deploy, test in both hosts, submit to ChatGPT, submit to Claude. Nothing here has been done yet. The server is built and tested locally (see README).

## Blockers and risks first

| # | Item | Severity | What to do |
|---|---|---|---|
| 1 | **OpenAI requires apps to suit users aged 13 to 17** ("Plugins must be suitable for general audiences, including users aged 13–17", "Support for mature (18+) experiences will arrive once appropriate age verification and controls are in place"). Alcohol is not on OpenAI's prohibited list, but a cocktail app may be judged an 18+ experience. | High, ChatGPT only | Submit anyway: the tools are informational, offer zero-proof options, and make no health claims. If rejected for audience, appeal by replying to the rejection email; point to the mocktail filter and the age line. No code change can fully remove this risk. |
| 2 | **OpenAI business verification** for BLANKPAGE ENTERPRISE S.R.L. "Publishing under an unverified individual or business name will result in rejection." | Blocks ChatGPT | Complete in platform.openai.com → Settings → Organization → General before uploading. Individual verification works only if the listing shows "Denis Roman". |
| 3 | **Demo video URL** is required for ChatGPT MCP review. | Blocks ChatGPT | Record the 5 test cases in ChatGPT after deploying (screen recording, 2 to 4 minutes), upload unlisted (YouTube or Loom), put the URL in `plugin/plugin.json` → `review.demo_recording_url` (currently a placeholder). |
| 4 | **Claude carousel screenshots** (3 to 5 PNG, at least 1000 px wide, cropped to the app response) are required because the server has a UI. | Blocks Claude | Capture in Claude after deploying; see section C. |
| 5 | **Upstream rate limit.** The recipe API allows 1,000 requests per 15 minutes per IP. The Worker's own cap (`UPSTREAM_LIMITER`, 60 a minute) counts per Cloudflare location, not globally, and Workers egress IPs are shared and change, so neither number protects the API on its own. One cold `find` call can cost up to 40 API requests; in the local smoke run five cold calls spent a whole minute's budget. | **High, both hosts** | Ask the owner of `fix-me-a-drink-api` for a key or IP allowlist that exempts the Worker from the per-IP limit (for example a shared secret header such as `x-garcon-mcp-key`, sent from `src/upstream.ts`), and agree a real budget. Until then, expect "Garçon is handling a lot of requests" during review traffic spikes. |
| 5a | **Workers Paid plan required.** A cold call makes up to 40 API requests plus Cache API reads and writes, and the recipe catalogue is about 2.2 MB of JSON. Workers Free allows 50 subrequests and 10 ms of CPU per request. | Blocks deploy | Put the account on Workers Paid before deploying. Do not remove the `ratelimits` block to get a deploy through. |
| 6 | **ChatGPT `ui.domain` format.** OpenAI's quickstart example uses an origin (`https://example.com`), so the `/chatgpt/mcp` route sets `https://mcp.fixmeadrinkapp.com`. If the portal scan flags it, change `ui.domain` in `src/server.ts` (`widgetResourceMeta`) to the value the finding asks for and redeploy. | Low | Check the MCP scan findings. |
| 7 | **Dofollow links are not verified.** Neither directory documents whether the website link on a listing is followed. | Info | After publishing, check the listing HTML for `rel="nofollow"` on the fixmeadrinkapp.com link. |
| 8 | **Catalogue gaps.** No plain "Negroni", "Mojito" or "Margarita" in the catalogue, and the Margarita match is premium. Reviewers often try these. | Low | The tool says when the match is not exact and offers free alternatives. Test cases use drinks with free recipes. |

## A. Deploy

Prerequisites: access to the Cloudflare account that holds the `fixmeadrinkapp.com` zone (it does: nameservers are `jade` and `odin.ns.cloudflare.com`), and no existing DNS record named `mcp`.

```bash
cd /Users/denisso/Documents/work/blankpage/fixmeadrink/garcon-mcp
pnpm install
pnpm test                 # expect 111 passed
pnpm typecheck
npx wrangler login        # browser sign-in to the Cloudflare account with the zone
npx wrangler deploy
```

`wrangler.jsonc` declares `routes: [{ pattern: "mcp.fixmeadrinkapp.com", custom_domain: true }]`, so the deploy creates the Custom Domain. Cloudflare then creates the DNS record and the certificate (docs: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/). No manual DNS step is needed. If the deploy says a record already exists, delete the `mcp` record in the DNS tab and deploy again.

The three rate-limit bindings (`IP_LIMITER`, `CALLER_LIMITER`, `UPSTREAM_LIMITER`) need no setup. Their counters are kept per Cloudflare location, so they are not global caps. `workers_dev` is off, so the Worker is only reachable on `mcp.fixmeadrinkapp.com`, where the Cache API works.

Check the deploy:

```bash
curl -s https://mcp.fixmeadrinkapp.com/ | head -5               # landing page
curl -s -o /dev/null -w "%{http_code}\n" https://mcp.fixmeadrinkapp.com/privacy   # 200
node _agent/scripts/smoke.mjs https://mcp.fixmeadrinkapp.com    # both routes, both protocol eras; exits 1 on any mismatch
npx @modelcontextprotocol/inspector     # optional: Streamable HTTP, https://mcp.fixmeadrinkapp.com/mcp
```

Logs: Cloudflare dashboard → Workers → garcon-mcp → Logs (observability is on).

## B. ChatGPT app (OpenAI plugin directory)

Docs used: https://developers.openai.com/plugins/deploy/submission, https://developers.openai.com/plugins/deploy/app-review, https://developers.openai.com/plugins/plugin-guidelines, https://developers.openai.com/plugins/build/chatgpt-ui, https://developers.openai.com/plugins/reference, https://developers.openai.com/plugins/deploy/connect-chatgpt (all read 22 Oct 2026). OpenAI now calls apps "plugins"; the submission is a ZIP plus an MCP connection.

### B1. Account

1. In https://platform.openai.com, pick the organization that will own the listing. You need to be an Owner, or have Apps Management Write (`api.apps.write`).
2. Settings → Organization → General: complete **business verification** for BLANKPAGE ENTERPRISE S.R.L. (blocker 2).
3. Use a project with **global data residency**. EU-residency projects cannot submit MCP plugins.

### B2. Test in ChatGPT first

1. https://chatgpt.com/plugins → **+** → **Add custom MCP server**.
2. Name "Ask Garçon (test)", URL `https://mcp.fixmeadrinkapp.com/chatgpt/mcp`, authentication **None**, accept the warning, **Create as a plugin**.
3. Start a new chat, type `@`, pick the plugin, and run the five positive and three negative test prompts below on desktop and mobile. Check the card widget renders and links open fixmeadrinkapp.com.
4. Record this as the demo video (blocker 3).

### B3. Domain verification token

The portal shows a token when you connect the server. Store it as a secret, then deploy:

```bash
npx wrangler secret put OPENAI_APPS_CHALLENGE    # paste the token
curl https://mcp.fixmeadrinkapp.com/.well-known/openai-apps-challenge   # must print only the token
```

### B4. Upload the package

1. Put the demo URL in `plugin/plugin.json` (`review.demo_recording_url`).
2. Zip the contents of `plugin/` (the files at the ZIP root, not the folder):
   ```bash
   cd plugin && zip -r ../ask-garcon-plugin.zip plugin.json mcp.json assets && cd ..
   ```
3. https://platform.openai.com/plugins → **Upload new or existing plugin** → choose the verified **Developer identity** → **Upload plugin** → the ZIP.
4. **Metadata & Skills**: wait for checks, fix any **Issues**, re-upload if needed.
5. **MCPs** → select `ask-garcon` → **Connect**. MCP Server URL `https://mcp.fixmeadrinkapp.com/chatgpt/mcp`, Authentication **No authentication**. Complete the domain challenge (B3). Wait for the tool scan; read **Issues**.
6. **Review information → Review details**: there are no reviewer credentials (no sign-in). Write "No account or sign-in needed. The server is public and read-only." in the sign-in instructions field if the form requires text. **Save details**.
7. Select the draft → **Submit for review** → tick the policy attestations.
8. After approval email: open the approved version → **Publish plugin**.

### B5. Listing fields (already in `plugin/plugin.json`)

| Field | Value |
|---|---|
| displayName (≤30) | Ask Garçon |
| shortDescription (≤30) | Cocktails from your own bar |
| longDescription (≤4000) | See `plugin.json`. Opens with the approved tagline "Drinks from the bottles you already own." No prices, no plan names, no recipe counts. |
| developerName | BLANKPAGE ENTERPRISE S.R.L. (the directory shows the verified identity) |
| category | Lifestyle. Change it if the dashboard list has "Food & Drink". |
| capabilities | Find cocktails from your ingredients; Get a cocktail recipe; Explain a spirit, ingredient or bar term; Suggest similar cocktails |
| websiteURL | https://fixmeadrinkapp.com |
| supportURL | https://fixmeadrinkapp.com/support |
| privacyPolicyURL | https://mcp.fixmeadrinkapp.com/privacy (connector-specific; the site policy at /privacy-policy does not cover the MCP server) |
| termsOfServiceURL | https://fixmeadrinkapp.com/terms-of-service |
| defaultPrompt | "I have gin, limes, sugar and soda water. What can I make?" · "How do I make an Espresso Martini?" · "Suggest a low-alcohol drink like a Moscow Mule." |
| brandColor / dark | #5B3FD1 / #A993FF |
| logo / composerIcon | `assets/logo.png` (512 px) / `assets/icon.png` (128 px), from `brand/app-icons/App-Icon.png` |
| screenshots | None. "Screenshots are no longer shown in the Directory." |
| commerce | false: "Ask Garçon does not sell products, show prices or process payments. It only reads public recipe data." |
| countries | US, GB, CA, AU, IE, NZ. Widen or narrow before submitting. |
| release notes | "First release: find cocktails from your ingredients, full recipes, spirit and bar-term explanations, and similar drinks, with low and zero-proof options." |

Tool metadata the scan imports from the server: names, titles, descriptions, input and output schemas, annotations (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`, `idempotentHint: true` on all four), the widget resource with `ui.csp` (`resourceDomains: https://images.fixmeadrinkapp.com, https://mcp.fixmeadrinkapp.com` for recipe photos and the Garçon image, no connect or frame domains), `ui.domain`, and the server instructions. No iframes are embedded, so no iframe justification is needed.

### B6. Review test cases (in `plugin.json`; five positive, three negative)

| # | Prompt | Tool | Expected |
|---|---|---|---|
| P1 | I have gin, limes, simple syrup and soda water. What cocktails can I make? | find_cocktails_by_ingredients | Up to 5 free recipes ranked by fewest missing (Churchill Martini ready; Southside missing mint), links, at least one low or zero-proof option, card widget. |
| P2 | I only want low-alcohol drinks. I have Aperol, prosecco, soda water and orange juice. | find_cocktails_by_ingredients (strength zero_or_low) | Only Low or Non Alcoholic recipes, Buck's Fizz ready to make. |
| P3 | How do I make an Espresso Martini? | get_cocktail_recipe | Vodka 1½ oz (44 ml), espresso 1 oz (30 ml), coffee liqueur ⅔ oz (20 ml), steps, link. |
| P4 | What is mezcal and what can I use instead? | explain_bar_term | Definition, 38 to 55% ABV, substitutes incl. a zero-proof one, link. |
| P5 | I like Moscow Mules. Suggest something similar, and a lighter option too. | suggest_similar_cocktail | Similar drinks with links, premium flagged, low-proof options. |
| N1 | Order me a bottle of tequila for delivery tonight. | none | The app does not act; no purchase tools. |
| N2 | How many cocktails can I drink and still be safe to drive? | none | No health or safety advice from the app. |
| N3 | Book me a table at a cocktail bar in London for Friday. | none | Out of scope. |

Rerun P1 to P5 against production right before submitting: the catalogue can change, and the expected drinks above are from 22 Oct 2026.

## C. Claude connector (Connectors Directory)

Docs used: https://claude.com/docs/connectors/building/submission, https://claude.com/docs/connectors/building/review-criteria, https://claude.com/docs/directory/publish, https://claude.com/docs/connectors/building/testing, https://claude.com/docs/connectors/building/mcp-apps/getting-started, https://claude.com/docs/connectors/building/mcp-apps/external-links, https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy (all read 22 Oct 2026). There is no separate "Claude Marketplace" form; claude.com/marketplace lists what the directory publishes.

### C1. Account

Submit from a claude.ai account on Pro, Max, Team or Enterprise (Free cannot submit). On Team or Enterprise you must be an Owner or hold the Directory permission. The listing belongs to the organization you submit from, so use the BlankPage one.

### C2. Test as a custom connector

1. https://claude.ai/customize/connectors → add a custom connector by URL: `https://mcp.fixmeadrinkapp.com/mcp` (note: `/mcp`, not `/chatgpt/mcp`).
2. In a chat: **+ → Connectors**, turn it on, run the prompts in C4. Allow the app UI when asked; check the card list renders.
3. Capture **3 to 5 PNG screenshots**, at least 1000 px wide, cropped to the app response only (no prompt in the image). Keep the prompt text for each. Template: https://www.figma.com/community/file/1597641111449594397/mcp-apps-for-claude. Suggested set: P1 cards, P2 low-proof cards, a large bar (gin, vodka, rum, lime, lemon, sugar, soda, bitters).

### C3. Portal steps

Open https://claude.ai/directory/manage → **Submit new** → **MCP connector**.

1. **Connection**: `https://mcp.fixmeadrinkapp.com/mcp`. Users connect to one URL.
2. **Tools**: four tools sync, all listed as read-only. No fixes expected (each has a title and `readOnlyHint`).
3. **Listing**
   - Server name (≤100): `Ask Garçon`
   - One-liner (≤200): `Drinks from the bottles you already own. Find cocktails you can make from your bar, full recipes, spirit explainers and low or zero-proof options from the Garçon catalogue.`
   - Description (≤2000):
     > Tell Claude what is on your shelf and Ask Garçon finds cocktails you can make now, plus the ones you are one bottle away from, ranked by what is missing. It gives full recipes with amounts in oz and ml, glass, ice, garnish and steps; explains spirits, liqueurs, mixers, techniques and glassware in plain words, with substitutes; and suggests drinks like one you already enjoy.
     >
     > Every answer includes low and zero-proof options, and you can ask for mocktails and low-ABV drinks only. Each result links to its recipe, ingredient or glossary page on fixmeadrinkapp.com.
     >
     > Ask Garçon reads from the free part of the Garçon recipe catalogue, built by the team behind the Garçon iOS app. It is read-only, needs no account, does not store what you ask, and makes no health or nutrition claims. For premium recipes it shows the description and free recipes like it. For adults of legal drinking age.
   - Categories (1 to 5): pick the closest of the portal's list, for example Lifestyle and Food & Drink.
   - Documentation URL: `https://mcp.fixmeadrinkapp.com/` (setup, tools, troubleshooting)
   - Privacy policy URL: `https://mcp.fixmeadrinkapp.com/privacy`
   - Support contact: `hey@blankpage-studio.com`
   - Icon: `plugin/assets/logo.png`
   - URL slug (permanent): `ask-garcon`
   - Allowed link URIs: `https://fixmeadrinkapp.com` (the widget's `ui/open-link` targets; we own the domain)
   - Carousel screenshots: from C2, with their prompts.
4. **Use cases**: primary use cases "Find cocktails from the ingredients you have", "Get a cocktail recipe", "Learn a spirit, ingredient or bar technique", "Find similar or lighter drinks". Requirements before connecting: none (no account, plan or setup). Data access: reads data only.
5. **Company**: BLANKPAGE ENTERPRISE S.R.L., https://fixmeadrinkapp.com, primary contact Denis Roman, hey@blankpage-studio.com.
6. **Authentication**: No authentication.
7. **Data handling**: the underlying API is our own (fix-me-a-drink-api, operated by BLANKPAGE ENTERPRISE). No personal health data. No sponsored content.
8. **Test & launch**: "No account or credentials needed. Connect https://mcp.fixmeadrinkapp.com/mcp with no authentication and try: (1) I have gin, limes, simple syrup and soda water. What cocktails can I make? (2) How do I make an Espresso Martini? (3) What is mezcal and what can I use instead? (4) I like Moscow Mules, suggest something similar and a lighter option. (5) I only want low-alcohol drinks; I have Aperol, prosecco, soda water and orange juice." Confirm you ran every tool (done locally with a scripted client; repeat in Claude as a custom connector).
9. **Compliance**: tick all seven acknowledgments (directory guidelines, first-party API usage, financial transactions, AI media generation, prompt injection, conversation data collection, public documentation). Each is true for this server: own API, no money movement, no generated media, descriptions describe behaviour only, no conversation data collected, docs live at the documentation URL.
10. **Review and submit**: fix any quality warnings, then submit.

After submitting: Anthropic scans automatically and by default lists it as a Community connector; it may escalate to Verified review. Track status at https://claude.ai/directory/manage. Escalations: mcp-review@anthropic.com.

### C4. Example prompts (the policy asks for at least three)

1. I have gin, limes, simple syrup and soda water. What cocktails can I make?
2. How do I make an Espresso Martini?
3. What is mezcal and what can I use instead?
4. I like Moscow Mules. Suggest something similar, and a lighter option too.
5. I only want low-alcohol drinks. I have Aperol, prosecco, soda water and orange juice.

## D. After publishing

- Tool changes: OpenAI rescans daily and reviews changed tools on its own; Claude picks up server changes live. Keep input schemas backward compatible, and bump the widget URI (`ui://ask-garcon/cocktail-list-v2.html`) on breaking UI changes.
- The MCP origin `https://mcp.fixmeadrinkapp.com` cannot change on OpenAI without a new submission. The path can.
- Before any press about the launch, OpenAI asks you to contact press@openai.com.
