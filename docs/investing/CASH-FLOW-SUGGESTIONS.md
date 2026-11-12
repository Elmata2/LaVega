# Cash-flow suggestions (Jev-04, issue #137)

Every broker describes cash movements in its own vocabulary. The adapters map the words they
know with a hand-written switch; anything else becomes `other` with a problem attached. The
suggestion layer asks Jev for a kind for each unknown word, stores the answer as a proposal,
and turns the owner's confirmation into a rule. Nothing the model proposes changes a figure
until the owner confirms it.

## The contract

- **Adapters stay pure.** They keep mapping known types and emitting the unknown-type problem;
  no model call and no non-broker network call enters an adapter.
- **One suggestion per distinct unknown type**, asked in one batched Jev `Choice` over the
  suggestible kinds (`deposit`, `withdrawal`, `interest`, `fee`) plus a no-match option. The
  prompt state is broker, raw type string, description, currency and sign: no magnitude and
  no account identity.
- **Suggestions are proposals, not data.** Stored per tenant with confidence, the first
  observed amount+sign, currency, description and state (`pending`, `confirmed`, `rejected`,
  `no-match`). Cash-flow kind, signs, returns, cost basis and the dashboard are computed as if
  suggestions did not exist.
- **A confirmation creates a rule** keyed on broker + normalised type string (never on a
  transaction reference). Rules are durable, scoped per broker, exported with the owner's data
  and removable. Lookup order: the adapter switch, then the rule, then `other` + problem.
- **Sign is never suggested.** A kind that would normalise the observed amount to the other
  sign is a sign change. The API refuses that confirmation with `409` and a before/after unless
  `acknowledgeSignChange: true`; the UI shows the before/after in red and requires an explicit
  checkbox before the button is enabled.
- **Disabled means off.** Suggestions are off by default per tenant. When off, no suggestion is
  generated or shown and the app behaves exactly as it did before this feature.

## Routes

| Route                                               | Purpose                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/investing/cash-flow-suggestions/settings` | `{ enabled }` (per-tenant, default false)                                                                                                                          |
| `PUT /api/investing/cash-flow-suggestions/settings` | set `{ enabled }`                                                                                                                                                  |
| `GET /api/investing/cash-flow-suggestions`          | `{ enabled, count, pending[] }`; each pending row has broker, raw type, type key, suggested kind, confidence, amount, sign, currency, description and `signChange` |
| `POST /api/investing/cash-flow-suggestions/confirm` | `{ broker, typeKey, kind, acknowledgeSignChange? }`; `409` with `{ before, after }` unacknowledged sign change                                                     |
| `POST /api/investing/cash-flow-suggestions/reject`  | reject one vocabulary word; it is not offered again                                                                                                                |
| `GET /api/investing/cash-flow-rules`                | the exportable rules list                                                                                                                                          |
| `POST /api/investing/cash-flow-rules/remove`        | remove a rule; the word is open for a future suggestion                                                                                                            |

## The panel

Profile screen → **Cash-flow suggestions** (`/profile#cash-flow-suggestions`; mounted at
`/investing/profile#cash-flow-suggestions`).

- Enable switch (default off) and an explanation that a model is involved only after this is on.
- The number waiting and one row per pending vocabulary word: the broker's original type
  string, the suggested kind, the model's confidence, the description, the observed amount and
  sign (`+€250.00 (cash in)`), and a "pick the correct kind" select.
- **Sign change:** the row turns red, shows the before/after
  (`Confirming turns +€250.00 into -€250.00`), the button reads **Confirm sign change** and stays
  disabled until the owner ticks _I understand this changes the sign and confirm it deliberately_.
  A server-side `409` shows the server's own before/after and applies the same gate.
- Actions: **Confirm kind** / **Confirm sign change**, **Reject**, and on each confirmed rule
  **Remove**.
- Copy is English by default and Dutch when the shared `lavega_locale` cookie says `nl`. The
  rest of the investing SPA stays English; this panel is the owner's own confirmation surface.

## Verification

- UI tests: `apps/investing-web/src/components/CashFlowSuggestionsSection.test.tsx` (jsdom):
  pending count and row fields, confirm creates the rule, rejection is not re-offered, the
  sign-change guard (disabled button, explicit acknowledgement, `acknowledgeSignChange: true`),
  a server `409` path, rule removal, the disabled state showing nothing pending, and Dutch copy.
- Server tests: `apps/investing-server/src/app.test.ts` (routes, 409, settings) and
  `apps/investing-server/src/index.test.ts` (injected store reaches the no-Sentry local
  runtime — without that wiring the local mounted panel was always empty).
- Live evidence: `.claude/skills/verify-investing` browser run against a local mounted server
  with a seeded store showing pending suggestions, the sign-change warning and the confirmed
  rule; screenshots under `/tmp/lavega-verify-137/evidence/`.
