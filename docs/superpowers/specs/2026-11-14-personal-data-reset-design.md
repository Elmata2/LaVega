# Reset personal data, keep the login and Investing

Date: 14 Nov 2026. Branch: `feat/wizard-banks-personal-reset`.
Status: owner request of 14 Nov 2026 ("keep investing, clear only personal, I'm redoing personal").
The design choices in section 3 are the controller's; the owner ordered build and merge.

## 1. Intent

The owner wants to start the personal side again from zero (accounts, transactions, intake
answers, bank links) without losing the login or anything on the Investing side. The only erase
that exists today (`DELETE /api/account/data`, GDPR art. 17) removes everything, Investing and the
login included, and does not touch the browser copy.

## 2. Goals, non-goals, anti-goals

- Goal: one action in the app that leaves the user signed in, with an empty personal vault, no
  bank links, and Investing exactly as it was.
- Non-goal: a GDPR erasure. The full erase stays as it is.
- Non-goal: revoking consent at the bank. No revoke call exists in the Enable Banking client;
  consent ends at its own expiry (at most 90 days). The copy says so.
- Anti-goal: any row of another user, any `investing.*` row, or any auth row is deleted.
- Anti-goal: a half-done reset that leaves the app unable to open.

## 3. Design

### 3.1 Server

New function `erasePersonalData(db, tenantId)` in `packages/database/src/index.ts`, next to
`eraseUserData`, same shape: one transaction through `withTenant`, a literal table list, every
statement `DELETE FROM <table> WHERE user_id = $1`, returns an `ErasureReport` (one entry per
table, zero rows included).

Tables deleted, in this order (`PERSONAL_RESET_TABLES`):

1. `personal.eb_sessions` (bank links)
2. `personal.eb_pending_auth` (bank redirect state; no RLS, so the `WHERE user_id` is the guard)
3. `personal.n8n_forwarding` (invoice forwarding address)
4. `personal.vaults` (the server copy of the sealed vault)
5. `personal.net_worth_totals` (Personal's daily total that Investing may read)
6. to 12. The Instinct agent (added 18 Nov 2026): `personal.agent_whatsapp`, `agent_link_codes`, `agent_events`, `agent_push_subscriptions`, `agent_mirror`, `agent_state`, `agent_settings`, in the child-first order of `USER_DATA_TABLES`. After a reset the agent is off (no settings row). The browser's own push subscription is not removed by the reset (it cannot reach the settings card's code); with no server row it receives nothing.

Tables kept, with the reason:

- `personal.vault_keys`: kept. The browser vault is sealed with this key. If the key went, the
  next key request would mint a new one and any vault copy still in a browser would fail to open
  with a misleading "unreachable" screen. Keeping it means a failed or partial reset never locks
  the user out.
- `personal.ai_usage`: kept. It is the AI spend ledger; deleting it would reset the spend cap.
- Every `investing.*` table and every Better Auth table (`public.user`, `session`, `account`,
  `verification`): kept.

New route `DELETE /api/account/personal-data` in `apps/server/src/account-routes.ts`, registered
with the existing account routes. Tenant comes from the session only. The body must be exactly
`{ "confirm": "RESET-PERSONAL" }`; anything else is 400. No session is 401. Response:
`{ erased: report }`.

### 3.2 Browser

`resetPersonalData()` (in `apps/web/src/vaultSync.ts` or a small new module beside it):

1. If an account session exists: call the route. If it fails, stop and show the error; nothing
   local has changed.
2. Delete the local vault for the current owner: the sealed vault record and the documents store
   (close the storage connection first; use the storage layer's own way to drop a vault if it has
   one, otherwise delete the owner's IndexedDB database).
3. Remove these browser keys, which hold personal state: `lavega.bufferCents`,
   `lavega.ebLastRefreshAt`, `lavega.ebEverConnected`, `lavega.shareNetWorthPendingDelete`, `lavega.n8nHandledMessageIds`,
   `lavega.n8n.autoBooked.v1`, `lavega.forwardingGuide.v1`, `lavega.invoiceForwardAddress`,
   `lavega.n8nInvoiceUrl`, `lavega.n8nInvoiceToken`, `lavega.n8nBaseUrl`, `lavega.n8nApiKey` (secrets),
   `lavega.onboardingSeen`, `lavega.popups`, `lavega.overviewWidgets`, `lavega.navModules`, and
   `lavega.popupShown` in sessionStorage. `lavega.shareNetWorth` is deliberately NOT removed (16 Nov 2026):
   sharing is on by default, so wiping an explicit off would switch it back on.
4. Kept: theme, sidebar and assistant widths, language, chart choice, owner name, country and
   region, tax country, and the behaviour preferences. Also kept, as preferences: `lavega.defaultEntity` and `lavega.defaultScope`.
5. Reload the app at `/app`. The app then creates an empty vault with the same key and the user
   lands in the intake wizard, as a new user does.

With no account session (local-only install) step 1 is skipped.

### 3.3 Interface

In the Back-up card under "Meer opties", above the existing full erase:

- Button "Persoonlijke gegevens wissen" / "Clear personal data".
- Inline confirm (same pattern as the full erase, not a dialog) with this content, nl and en:
  - what goes: accounts, transactions, intake answers and documents in this browser; the server
    copy of the vault; the bank links; the daily message and its messages;
  - what stays: the login and everything in LaVega Investing;
  - cannot be undone; make a back-up file first if a way back is wanted;
  - another browser or device keeps its own copy until it is cleared there too;
  - the bank's own consent ends by itself (at most 90 days); LaVega stops using it now.
- Buttons "Ja, wis mijn persoonlijke gegevens" and "Annuleer". Busy state while it runs.
- The full-erase copy is not changed.

## 4. Approaches considered

- **A. Separate personal-only delete, vault key kept, browser cleared (chosen).**
- **B. Add a flag to the existing erase route.** One route with two meanings on an irreversible
  action; a wrong flag deletes the login. Rejected.
- **C. Also delete the vault key.** Stronger against stray copies, but a failed local clear then
  locks the user out behind a wrong error screen. Rejected for a reset; the full erase does it.
- **D. Browser-only clear.** The server backup and the bank links would come back. Rejected.

## 5. Verification

- Database test on real migrations (PGlite, as `erasure.test.ts`): after `erasePersonalData` for
  user A: the five tables hold no row of A; `personal.vault_keys`, `personal.ai_usage`, every
  `investing.*` table that had a row, `public.user`, `session` and `account` still hold A's rows;
  user B's rows in all tables are untouched; the report lists five tables.
- Route tests: 401 without session; 400 without the exact confirm value (including the full-erase
  value `"ERASE"`); tenant from the session, never from the body.
- Browser tests: server error leaves local state alone; success clears the listed keys, keeps the
  kept ones, drops the vault and reloads; signed-out install clears local only.
- Review: two independent reviewers on this diff, one of them on the strongest model (data
  deletion path).

## 6. Found on the way, not changed here

- `investing.api_tokens` (migration 0027) has a `user_id` and is not in the full erase list. A
  full GDPR erase may leave an MCP token row. To verify and fix in its own change.
- After a full erase the browser copy stays and opens as "unreachable". Own change.
- No test checks that the full erase list is complete.

## 7. Changes during the build (fix round 1, 14 Nov 2026)

After two independent reviews. These supersede sections 3.1 to 3.3 where they differ.

1. **Route takes `expectedOwner`.** Body is `{ "confirm": "RESET-PERSONAL", "expectedOwner": "<owner id>" }`.
   The browser sends the owner of the vault this tab has open. Missing or non-string is 400.
   If it differs from the session's tenant id the answer is 409 (`code: "owner-changed"`) and
   nothing is deleted. The tenant that is deleted is still the session's only. The browser stops
   on 409 and tells the user to reload. `/api/account/data` is unchanged (same stale-tab weakness
   there, known, own change).
2. **Server outcome rules.** Decided before the click from the owner: a device owner (no account
   backend) clears local only, with the local-only copy. An account owner must get 2xx from the
   server before anything local is touched. 401, 404, 409, any other non-2xx and a network error
   all stop with nothing local changed and a message in the UI language; retry is safe. "404
   means no server copy" is gone. While the account state is still being checked the confirm
   button stays disabled.
3. **Cross-tab signal.** Before deleting the vault database, `destroyVault` posts the database
   name on a `BroadcastChannel`. Every other tab or instance holding that database drops its
   in-memory vault at once and refuses writes (so its next save cannot re-create the database);
   the app then reloads at `/app`. The confirm text starts with "close other LaVega tabs first".
4. **Vault backup write.** `PUT /api/vault/backup` with a non-null `baseUpdatedAt` when no server
   row exists answers 409 with `updatedAt: null`, unless `?overwrite=true`. A first backup
   (`baseUpdatedAt` null) still works. The Back-up card shows a message and the overwrite button
   for that case.
5. **Copy.** "What goes" also names the invoice forwarding address and the daily total shared with
   Investing's net-worth page. "What stays": the login and the investing data (accounts at
   brokers, goals, theses, agent history). Error reasons are chosen by code in the UI language.
6. **Keys.** Added `lavega.n8nInvoiceUrl`, `lavega.n8nInvoiceToken`, `lavega.n8nBaseUrl`,
   `lavega.n8nApiKey` to the cleared list.
7. **Known, not changed.** An old legacy password vault (`lavega-vault`, kept on purpose) can be
   offered again after a reset. The stale-tab weakness of the full erase.

### Fix round 2 (14 Nov 2026)

- **Owner is required.** `Backup` and `Profiel` take a required `owner`; no default. Profiel (the
  normal entry) passes the real owner from `App`. Tests mount Profiel and the deep-link Back-up
  view through `App` as an account owner (server called with `expectedOwner` first, then the local
  vault) and as a device owner (no server call).
- **Cross-tab, two phases (replaces 7.3).** `destroying`: every other tab holding that vault locks
  at once (drops the in-memory vault, refuses persists), shows a neutral wait page and does NOT
  reload. After the delete succeeds the sender posts `destroyed` and those tabs reload. On `failed`,
  or no `destroyed` within 12 s, they show a plain message with a reload button. A short-lived
  `localStorage` marker (`lavega.vaultDestroying`, owner database + time) is written before the
  delete and removed after; `open` for that owner waits for a live marker (at most 10 s; a marker
  older than 20 s is ignored). Without `BroadcastChannel` the same messages travel as `storage`
  events on the marker keys.
- `persist` captures the database name before sealing and re-checks after, so it never writes to a
  database named from an absent owner. After a blocked or failed delete the sending tab is locked
  too.
- The plain vault `UPDATE` has an explicit `user_id` predicate next to RLS.
- A device owner's local-only copy no longer claims there is no server copy: "this device is
  without an account; a copy on a server, if there is one, is not touched". (Truthful wording was
  chosen over calling the server for the local tenant.)
- nl `conflict.missing` names the button "Toch overschrijven".
- **Known:** a tab still running the bundle from before this deploy has no listener and can write
  the old vault back; the "close other LaVega tabs first" line covers it in words only.

### Fix round 3 (14 Nov 2026)

- `BroadcastChannel` construction and `postMessage` are guarded; a throwing constructor falls back
  to the `storage`-event path and never stops the vault from opening.
- A destroying marker stamped in the future (clock set backwards) counts as stale. `open` removes
  a stale marker, and removes a live one it had to wait out. The 20 s stale rule and the 10 s wait
  cap stay: the sender's own worst case is about 250 ms settle plus the 5 s delete timeout, so a
  live marker normally clears before the cap.
- The "stalled" page no longer says the data was erased: what was already cleared stays cleared, the
  copy in this browser may still be present, close other tabs and reload.
- A device owner's confirm names only what applies ("Blijft: je instellingen in deze browser");
  no "your login".
- Measured in a real browser (round 3 recheck): normal start is unaffected (44 to 164 ms); a live
  marker makes `open` wait at most 10 s. Two-tab, three-tab and tab-opened-during-reset passed.
