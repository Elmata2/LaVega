# LaVega — Agentic Phase: Design & Phased Plan

> Source: parallel research/design fan-out (invoice / tax / FX / points / architecture) + lead-architect synthesis, 2026-08-04. Constraints: local-first + opt-in connectors; mix (LLM only where it adds value); smallest additive change to the existing monorepo.

## Answer up front

Build order: **(0) shared agentic foundation → (1) Tax/BTW → (2) Invoice → (3) FX-minimal → (4) Points-minimal.** Tax + Invoice are the reason for this phase: they let the 13-week forecast see money it structurally cannot see today (a future VAT bill; a one-off invoice due before the bank line). FX + Points are honest but low-frequency — ship thin.

## Per-agent verdict

| Agent                                 | Feasibility | Recommendation                    | Why                                                                                                                                          |
| ------------------------------------- | ----------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Tax / BTW (VAT set-aside + deadlines) | Strong      | **Build now**                     | Deterministic math on vault data; makes "beschikbaar saldo" honest; lowest-LLM; core no-CFO wedge.                                           |
| Invoice                               | Moderate    | **Build now** (local slice first) | Only input that shows a real future flow before the bank Tx; manual+UBL+CSV slice adds value with zero new privacy surface.                  |
| FX / Conversion                       | Moderate    | **Build minimal**                 | Real money on foreign wires, low frequency. One form + one table. Wise endpoint undocumented → best-effort fallback like the geld.nl scrape. |
| Points & Rewards                      | Weak        | **Build minimal / cut candidate** | No consumer API (Amex/bunq/Revolut dead ends). Manual balance + static transfer table only.                                                  |
| Agentic infra & privacy               | Strong      | **Build FIRST**                   | Foundation all four reuse; nothing safe to ship without it.                                                                                  |

## Shared foundation (Phase 0 — build first)

- **`ScheduledFlow`** `{id, entity, label, sign, amountCents, dueDate, source, confidence, status}` — unifying primitive; both a VAT reservation and an expected invoice reduce to a signed dated flow. Threaded into `forecast.ts` as optional `ForecastOptions.scheduledFlows` (default `[]`) = a **third flow source** alongside recurring streams + incidental baseline. Existing call sites/tests unaffected.
- **`Invoice`** entity (decimal amount, Tx-convention; id via `hash.ts`); projects into a `ScheduledFlow` when `expected`.
- **`Reservation`** (VAT set-aside) — netted out of `balance.ts` "beschikbaar saldo" + the forecast's projected closing on the due date. Stops overstating spendable cash.
- **`InvoiceAccessAdapter`** interface (mirrors `BankAccessAdapter`); first impl = `FileImport` (drag-drop, no network). Gmail/MS-Graph impls added later to the same interface.
- **LLM integration = server-side Hono proxy** (`/api/agent/*`), one owner-held `ANTHROPIC_API_KEY` (Railway env, same custody as `EB_PRIVATE_KEY`). Keeps `@anthropic-ai/sdk` out of the browser + `api.anthropic.com` off the CSP.
- **Redaction boundary** (Phase 0, non-negotiable): a helper + test asserting a field allowlist + size cap on every agent-proxy payload — so no future refactor can serialize the full `Tx[]` into a prompt. Plus a basic rate limiter on `/api/agent/*` (Anthropic is metered per call).
- **Consent model**: per-agent × per-connector, default OFF, revocable, in a new "Koppelingen" settings view. Non-secret flags → localStorage; secrets (OAuth refresh tokens, unconfirmed drafts) → encrypted vault via additive `DB_VERSION` bump (extends `migrate.ts`). OAuth relay clones `eb-routes.ts` (in-memory, TTL, one-shot).
- **Static reference bundles** (owner-maintained, "verified as of" dates, like `NL_SAVINGS_RATES`): `NL_VAT_RULES` (21/9/0%, KOR €20k), `NL_BTW_DEADLINES` (quarterly = last day of month after quarter-end, weekend-shifted; annual 31 Mar), `REVOLUT_FX_FEES`, `AMEX_FX_SURCHARGE`, Amex MR transfer ratios.

## Phases

- **Phase 0 — Foundation (M):** ScheduledFlow + forecast wiring; additive vault migration; `/api/agent` skeleton + `ANTHROPIC_API_KEY`; redaction helper + test; rate limiter; "Koppelingen" view (4 toggles, all OFF). No user-visible behavior; unblocks all.
- **Phase 1 — Tax/BTW (M):** `computeVatSetAside(...)` → a `confirmed` ScheduledFlow per BTW period, netted into balance + forecast; deadlines via the existing `alerts.ts` ladder (30d info / 14d warning / 3d critical); per-BV settings (freq, default rate, FY-end) shaped like `Account.interestRate`; manual override; mixed-rate "manual-only" escape hatch. No LLM.
- **Phase 2 — Invoice (L; 2a is the value):**
  - 2a local: `Invoice` + storage; manual-entry **Facturen** view; `scheduledInvoiceFlows()`; deterministic **UBL/EN-16931** + NL-bookkeeping-**CSV** parsers (per-source profile like `fileImport.ts`); `reconcileInvoices()` (same sign, tight amount tolerance, dueDate window −60/+30d, `norm()` counterparty overlap; auto-flip to `paid` only on an unambiguous single match). Zero new privacy surface.
  - 2b connectors: Gmail (`gmail.readonly`) then MS-Graph (`Mail.Read`) OAuth relays; client-side subject/sender/has-attachment filter before bulk fetch; persist only extracted fields.
  - 2c LLM: one Claude call per document (7 fields, structured/tool-use, one doc only) → `proposed` draft, confirm-first before it touches the forecast; gated behind a small real-invoice eval set.
- **Phase 3 — FX minimal (M):** `fx.ts` core (`crossRate/routeNet/rankRoutes`, fixed-rate tests first); `/api/fx/rate` (ECB/Frankfurter) + `/api/fx/routes` (Wise `/v4/comparisons`) cloning `rates.ts` resilience; provider auto-detect via `matchBankRate()`. Only `{amount, from, to, country}` leaves the device.
- **Phase 4 — Points minimal (S):** manual `RewardsBalance` + staleness indicator + static Amex MR transfer table + cents-per-point heuristic. Fully local. Cut candidate.

## Open decisions (owner)

1. **LLM custody** — server proxy (recommended) vs client-side own key.
2. **Connectors in this phase?** Local Invoice slice (2a) delivers most value with none. Gmail/Outlook now or later?
3. **Points** — minimal or skip?
4. **VAT scope** — BTW set-aside + deadlines only; VPB/IB/gebruikelijk-loon/dividend = reminder + reference card, never computed. Confirm.
5. **Anthropic data-retention** — set org to min retention + no training opt-in before first LLM call.
6. **FX Wise dependency** — accept graceful fallback, or hold FX until a contracted source exists.
7. **Reference-table upkeep** — accept a periodic re-verify chore for the static NL bundles.

## Must-not-skip

- Phase-0 redaction-boundary test.
- Fuzzy-reconciliation test suite against real multi-BV data (partial/early/late payments, FX/rounding deltas) before any auto-flip to `paid`.
