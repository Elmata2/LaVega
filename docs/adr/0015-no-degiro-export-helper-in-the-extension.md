# ADR 0015 — No DeGiro export helper in the browser extension

## Status

Accepted 2026-11-16 (issue [#328](https://github.com/Elmata2/lavega/issues/328), DeGiro D16). Answers
the D16 question; it does not open new scope. Manual CSV import stays the only DeGiro path.

## Context

DeGiro has no official API. [#25](https://github.com/Elmata2/lavega/issues/25) chose manual CSV
import behind the `FileImport` seam: the user exports from DeGiro's web app, LaVega parses the
files, and no DeGiro credential ever touches LaVega. [#328](https://github.com/Elmata2/lavega/issues/328)
asked whether `apps/extension` — the Manifest V3 checkout extension — should instead call the same
export URLs inside the user's logged-in DeGiro tab and post the files to the upload route
([#323](https://github.com/Elmata2/lavega/issues/323)). It promised to remove "three manual
downloads". Three facts decide it.

1. **The minimum is two files, at most monthly.** After D5/D7 the account statement alone proves
   cash history, trades, dividends, cash balances and coverage; the portfolio export supplies
   positions. The transactions export only adds execution venue and FX rate
   (`docs/investing/CONNECTORS.md` → DeGiro). Import age warns after 30 days (D13), so the natural
   cadence is monthly: two downloads, on a settings page the user already visits.
2. **There is no measured friction.** #328 said to decide after #327 and real usage. D15 imported
   the real files once on preview and once in the production test tenant on 2026-11-16. The owner
   is the only importer and no repeat-import history exists, so the export cost has not been shown
   to be the friction point.
3. **The extension is deliberately not a network client.** Its manifest sets `connect-src 'none'`
   and keeps `host_permissions` empty (three optional, read-only content-script patterns).
   `scripts/copy-static.mjs` fails the build on any network reference in the bundle and on manifest
   drift from `sites.ts`/`bronnen.ts`, and it self-tests that gate on every build. A fetch helper
   needs a DeGiro host permission, a `connect-src` to the LaVega origin, an authenticated tenant in
   an extension that has no account, and a CORS path to the tenant-bound route. That breaks both
   gates and the promise on the extension's README: "Er gaat geen enkel verzoek naar buiten."

DeGiro's helpdesk states that third-party scripts and API wrappers violate its terms
([#7](https://github.com/Elmata2/lavega/issues/7)). The helper would call undocumented app
endpoints from an authenticated session, so a broken or rate-limited endpoint puts the user's
account at risk. The manual export takes the same bytes with no endpoint to break.

## Decision

No. `apps/extension` does not fetch DeGiro exports in v1. Manual upload stays the default and only
path: no session, no stored token, no schedule.

1. No follow-up build issues are filed; the second acceptance criterion was conditional on a yes.
2. A plain link to DeGiro's export pages is allowed inside the import tab's existing steps —
   navigation only, no script, no permission. It needs no ADR and no extension change.
3. Revisit only on evidence, not on taste:
   - five hosted users import at least weekly for a month, measured from the stored import status
     (`GET /api/investing/brokers/degiro/import`), or
   - DeGiro publishes an official API or token flow (the open part of #7), or
   - a fetch-free hand-off is proven: the extension downloads the files and the page picks them up,
     with no network and no token. Even then the terms reason above still stands, because the
     endpoints remain undocumented.
4. If reconsidered, the helper needs its own ADR with failure behaviour written down first: a
   failing endpoint shows the manual steps, never retries, never stores the session, and never
   blocks the account.

## Consequences

- No code change, no new dependency, permission or CSP entry. The extension's no-network gate keeps
  its meaning.
- The user cost stays two manual downloads per month.
- The two reasons — no usage evidence and DeGiro's terms — are now written down, so a later "just
  add the helper" proposal must argue against them.
