# Invoice queue server proxy

## Status

Accepted.

## Decision

Move the invoice queue fetch behind LaVega's own server. The browser calls `GET /api/n8n/queue`. It no longer talks to n8n directly and no longer holds the n8n webhook URL or shared token.

The original module comment on `apps/web/src/n8n.ts` explained the design it replaces:

> Pulling invoices out of the owner's OWN n8n. The path is: his mailbox -> his n8n -> this browser. The LaVega server is not in it, so nothing here talks to API_BASE; the browser calls his webhook directly with the token he stored under Koppelingen.

That design has one person in mind. n8n's queue store, in `packages/core/src/n8n/queue.js`, partitions its rows by `queueKey`, the local part of the forwarding address a mail arrived on. The old browser code read that key from the vault too, or left it unset and got `OWNER_KEY`. Either way the browser was choosing whose queue it read. A second user would need the owner's own webhook secret, and nothing stopped them from typing a key that was not theirs. Reading the wrong key does not just show the wrong rows. `drainQueue` deletes the bucket it returns, so a wrong key steals and destroys someone else's invoices in the same request.

The fix is to take the choice away from the browser. The server now holds the n8n credential, in `N8N_QUEUE_URL` and `N8N_QUEUE_TOKEN`, and looks up `queueKey` itself from the caller's own session. A new table, `personal.n8n_forwarding`, maps `user_id` to `local_part`. `apps/server/src/n8n-routes.ts` reads that row and nothing else: it never reads a `key` off the request, in the query string, a header, or the body. The route's own top comment states this as the one rule the file exists to enforce, and `apps/server/src/n8n-routes.test.ts` proves it by sending an attacker-supplied `?key=` and asserting the session's own local part is what reaches n8n regardless.

A user with no row in `personal.n8n_forwarding` gets `{ invoices: [], notices: [], noAddress: true }` and the server never calls n8n at all. It does not fall back to a keyless fetch, because a keyless fetch is exactly what used to hand a new user the owner's `OWNER_KEY` rows. `apps/server/src/n8n-routes.test.ts` covers this path separately from the unconfigured-server case, because the two look similar from the browser but mean different things: one is "nobody has set this up yet," the other is "the server is not configured at all."

Invoice rows now pass through LaVega's server on the way to the browser instead of coming straight from n8n. The server does not persist them. It relays the JSON n8n returns, unchanged, the same one-shot copy the webhook always produced.

`apps/web/src/n8n.ts`'s `fetchQueue` lost its `url`, `token`, and `key` parameters. It takes only an injectable `fetchImpl` and calls `${API_BASE}/api/n8n/queue`, which carries the session cookie same-origin.

## Not in this change

`Koppelingen.tsx` still shows the webhook URL and token fields it used before. Nothing reads them anymore; `fetchQueue` no longer takes them, and the server proxy never sees them. Removing those fields is a follow-up, not part of this change.

`apps/server/src/n8n-routes.ts` exposes no way to set a user's `local_part`. `createN8nForwardingRepository`'s `setLocalPart` exists in `packages/database`, ready for a self-serve flow, but assigning a forwarding address today stays an operator action outside the app.

## Consequences

A user configures nothing to fetch their invoice queue. The server derives their identity from their session, the same session every other authenticated route already trusts.

The n8n credential lives in one place, the server's environment, instead of in every user's browser vault. That benefit is pending, not delivered: existing vaults still hold a working URL and token, because the Koppelingen fields that store them are removed in the next change, not this one.

## What it costs

Named here because the first draft of this file listed three benefits and no costs under a heading that says Consequences.

**Invoice rows now transit LaVega's server.** Amounts, counterparties and IBANs pass through function memory, and through whatever the platform logs about a request. They are relayed unchanged and never persisted, but "the server never sees an invoice amount" was true yesterday and is false today. The Koppelingen copy that said so has been corrected rather than left to age.

**A hop was added to a read that destroys its source.** `drainQueue` empties the bucket it returns, so the batch exists in exactly one place while it is in flight. Before, that flight was browser-to-n8n. Now there are two legs, and a failure on the second one loses rows that n8n has already deleted. The outbound call carries a timeout so an indefinite hang becomes a nameable failure, but a bounded wait does not make the rows come back. Any error text on this path that claims the queue is untouched is only true for a failure *before* n8n answered, and the client cannot always tell which it had.

`personal.n8n_forwarding` follows the same row-level-security shape as every other personal table: one row per user, forced RLS, and a unique index on `local_part`.

The unique index alone was **not** enough, and the first version of this change
shipped believing it was. The queue key is normalised in two places and
differently: the email worker names a bucket
`address.slice(0, at).trim().toLowerCase()`, while n8n reads one named
`v.trim().slice(0, 120)` and does not lowercase. A byte-exact index therefore
permits `alice-7f3a` and `Alice-7f3a` as two rows pointing at one n8n
partition, and a trailing space does the same without needing case at all.
Whichever row matches drains the other user's invoices, and `drainQueue`
deletes what it returns, so the victim sees an empty queue and never finds out
why. A single tab passed every constraint and then normalised to `""` at n8n,
which returns `OWNER_KEY` — the owner's own queue.

The column now carries `CHECK (local_part ~ '^[a-z0-9._%+-]{1,120}$')`: one
canonical form, the exact character set an email local part may contain, so a
value that is stored is already in the form both ends agree on. The index
guarantees distinct partitions only because the constraint guarantees distinct
bytes mean distinct keys. `eraseUserData` now clears it along with the rest of a person's data.
