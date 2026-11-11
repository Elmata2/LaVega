# Assistant thin slice (WS5.8, issue #301): client-side tools + approval events

Date: 2026-11-11. Status: implemented in this slice. Source design:
`docs/superpowers/specs/2026-10-27-assistant-design.md` (the product source; this
note only narrows it). Plan: §3 WS5.8. Boundary: ADR 0009 (account-held vault
key) and ADR 0011 (integer cents).

## What this slice is

The first executable piece of the personal assistant. The owner asks a question
on Overzicht; the assistant calls one of three **client-side** tools over the
already-decrypted vault and shows the answer. A tool that would write proposes
an **approval event**; nothing is stored until the owner decides, and the
decision is persisted in the vault so it survives a reload.

It is deliberately smaller than design Step 1 (server-proxied Mistral chat,
memory-propose call, advice guard, explainer links). Those stay carried.

## Decisions

1. **No model call in this slice.** The router is a literal NL/EN intent match in
   `packages/core/src/assistant.ts`. Consequence, stated plainly: **zero bytes
   leave the browser for an assistant turn.** There is no server route for the
   assistant, no fetch in its module, and no ledger row in any request. The
   design's server-proxied chat and its `memory-propose` call are the next slice;
   they can only send the design's redacted context, never rows.
2. **Three registered tools**, all in `apps/web/src/assistant/tools.ts`:
   - `spending_summary({month})` — read-only. Filters the decrypted transactions
     to the month, drops pending/excluded rows, and sums the negative amounts by
     the app's own category keys.
   - `account_balances()` — read-only. The owner's accounts with balance and
     currency, straight from the vault.
   - `remember_preference({subject, valueId})` — the one write. It is a closed
     vocabulary (`lengte`, `toon`, `detail`, `taal`, `voorbeelden`) from the
     design's memory table, so no free text, name, amount or account number can
     be stored by construction. It never writes on its own: it creates an
     approval event and waits.
3. **An approval is an event**: `{id, tool, payload, decision, decidedAt,
   createdAt}`. Decisions are `approved | rejected | dismissed`; the latest
   event per id wins, so undo is another decision. Ids are client-generated and
   double as the idempotency key.
4. **One additive vault section, one save per decision.** `assistant?: {
   approvals, memories }` in `VaultData`, read/written through
   `getAssistant`/`putAssistant` (replace-all, like `facts`). A legacy vault
   decrypts without it and reads the empty state. Approving a valid
   `remember_preference` writes its memory in the SAME save as the decision, so a
   decision and the write it authorises cannot land apart.
5. **No ledger row to the server.** The panel loads `accounts`/`txs` from the
   vault through the existing storage seam; the tool handlers are pure functions
   over that snapshot. There is no network call in the assistant path, so the
   browser pass's network log shows no request while a turn runs.
6. **NL and EN copy** live in one typed-complete module (`copy/assistant.ts`),
   like every other copy table; category keys are data, not copy.
7. **Mounting.** The panel is one card at the top of Overzicht. `Overzicht` is
   not owned by the concurrent document-vault issue; App passes the existing
   storage instance through one additive prop line.

## Approval lifecycle

1. The owner types a remember request ("onthoud dat ik korte antwoorden wil").
2. The router returns a write intent; the panel renders an approval card with the
   payload rendered from copy (never free text) and two buttons.
3. Approve/reject appends the decision event and (on approve) the memory record in
   one `putAssistant` save. The card then reads as decided, in place.
4. Reload: the panel loads `getAssistant()` and renders the same card as decided;
   the decision event is still there. A second decision changes the latest one.

## Verification

- `packages/core/src/assistant.test.ts`: routing (read/write/unknown, NL and EN),
  closed-vocabulary validation, one-record-per-subject, idempotent append,
  latest-decision-wins, approved-write-only-on-approve.
- `apps/web/src/assistant/*.test.tsx`: a read turn renders the computed answer
  from a fake vault; a write turn renders an open card; approve persists the
  event and the memory in one save; a remount with the same fake storage shows the
  decision and the memory (the reload proof).
- Browser pass against the local server: panel visible, ask a spending question,
  make an approval decision, reload, see the decided card and the memory; network
  log shows no request from the assistant path.
