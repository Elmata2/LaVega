# Stock research

Route: `/investing/agents/research` on mounted previews, `/agents/research` standalone.
Reach it from **Agents → Research Stock**. Requires signed-in session, enabled Agents
module, accepted Yahoo market-data consent, `TYPESAFE_API_KEY` for the report, and
`LAVEGA_AGENT_API_KEY` or `OPENROUTER_API_KEY` for lens chat. Preview and production also
need `LAVEGA_ENCRYPTION_KEY` to sign the report. A missing key throws
`Research report signing requires LAVEGA_ENCRYPTION_KEY`. Standalone local uses a built-in
signing secret when `VERCEL` is unset and `NODE_ENV` is not `production`. `doctor` reports
`llm` and `marketData` only. A green doctor does not prove the TypeSafe key or the chat key.
No broker positions are required for this feature.

## Drive

Use `control-investing.mjs` from the skill directory:

1. Set `LAVEGA_PREVIEW_URL` to the change's preview URL, or pass `--base <url>` to each
   targeted command. Run `login --target preview`.
2. Run `doctor --target preview` and `assets --target preview`.
3. Read consent with `consent --target preview`. On the preview test account only, accept
   consent if needed with `consent --accept --target preview`.
4. Open `browser open --target preview`, then
   `browser goto /investing/agents/research?verify=1 --target preview`.
5. The textbox accessible name is **Stock ticker** (it starts as `AAPL`). Click **Research stock**
   (`Researching…` while pending). Wait for an actual report.
6. Confirm company symbol, fetched time, forward P/E, ROE and net margin render. Compare
   displayed values to the research response. Null values must say unavailable.
7. Confirm six **Investor views** (aside `aria-label` `Six investor views`) display typed signals and clearly labeled probabilities.
   No view must remain distinct from neutral. Record model and snapshot timestamps.
8. Select Warren Buffett, ask about valuation and wait for streamed reply. Switch to
   another lens and back. The Buffett thread must remain in Buffett's conversation.
9. Run another ticker and confirm previous conversations do not appear in its report.
10. Capture desktop and narrow viewport screenshots, page console errors and network.

All `browser` commands must run outside the sandbox. Evidence stays under
`/tmp/lavega-verify-investing/evidence`. End with `cleanup`, including failed runs.

## Proof

Capture the research request and report, rendered report, chat request and completed
stream. The chat report token must correspond to the research response. Test report
signature, tenant binding and expiry in server tests; browser checks verify real provider
data and model calls. Static page rendering alone does not prove this feature works.

Provider outage, missing consent, missing API keys or blocked preview auth are explicit
verification gaps, not passing checks. A local run that has consent and no `TYPESAFE_API_KEY`
answers 502, and the page shows `TYPESAFE_API_KEY is not set; configure TypeSafe System One`.
That is a gap, not a pass. A broker-related doctor failure can coexist with
a working stock research report; record it separately.

Reports created before the six-agent catalog change require **Refresh research** before
continuing their conversations. Their signed five-view snapshot does not match the new catalog.
