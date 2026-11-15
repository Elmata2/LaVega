# Sure adoption program — metric review (2026-11-11)

The program ends measured. This is the WS6.4 review (#302): before/after aggregates for
what the repo can measure on committed **synthetic** fixtures, and an explicit
owner-pending list for what needs the owner's live vault. No real amount, counterparty,
account, IBAN or name appears in this record; the machine-readable copy is
[`sure-program-metrics-2026-11-11.json`](./sure-program-metrics-2026-11-11.json), pinned by
`packages/core/src/metrics.test.ts`.

**Why the live numbers are pending, not estimated.** The personal vault is encrypted and
local-first (ADR 0009): a browser the owner controls holds the only plaintext, and a server
or agent never reads it. The Phase 0 baseline runbook (plan §8) therefore stays
owner-executed, and issue #303 is owner-blocked. Reporting a made-up live number would be
worse than reporting none; the definitions below are ready for the owner to fill in.

## Measured on synthetic fixtures

Basis: the real-shaped labelled fixtures committed for WS2.4/WS2.10 (`bills/__fixtures__/
real-shaped-vault.json`, `plan/__fixtures__/forecast-commitments-vault.json`). They copy the
shape of the owner's Dutch ING data, not the data itself.

| Metric                                     | Before | After                                                                          | Method                                                                                                                  |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Forecast absolute error, 30-day checkpoint | 0.62%  | **0.01%**                                                                      | projected weekly close vs actual ledger, as % of the opening position (#290 fixture)                                    |
| Forecast absolute error, 60-day checkpoint | 1.42%  | **0.01%**                                                                      | same                                                                                                                    |
| Forecast absolute error, 90-day checkpoint | 2.18%  | **0.04%**                                                                      | same                                                                                                                    |
| Internal-transfer match rate               | —      | **100%** (12/12 labelled same-day pairs auto-confirmed, 0 left as suggestions) | transfer matcher over the real-shaped vault; the plan's confirmed/(confirmed+rejected+suggested-after-30-days) analogue |
| Uncategorized share                        | —      | **0%** (0 of 160 fixture rows)                                                 | built-in categorizer tiers over the real-shaped vault                                                                   |

The uncategorized 0% is a property of the synthetic fixture: its counterparties are common
Dutch merchants the built-in tiers know. The owner's share is the number that matters and
is pending below; the fixture number only proves the measurement runs.

## Owner-pending (never estimated)

| Metric                                    | Why pending                                                 | Definition                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Forecast error on the owner's history     | vault is local-first (ADR 0009); #303 owner-blocked         | median absolute % error at 30/60/90 days over the last 3 complete months                                    |
| Internal-transfer match rate, owner vault | needs the owner's ledger + 30 days of decisions             | confirmed / (confirmed + rejected + still-suggested after 30 days)                                          |
| Uncategorized share, owner ledger         | needs the last 3 complete months                            | no category / all transactions                                                                              |
| Statement coverage                        | needs the first-account date and imported-document months   | months with ≥1 statement / months since the first account opened                                            |
| Realised-gain reconciliation              | needs the broker's own realised/cash statement              | report realised + income minus the broker's reported movement; `unknown` when the broker does not report it |
| MCP usage                                 | needs production audit rows; a local check makes no traffic | tool calls per week and ok/refused/error counts                                                             |
| AI spend                                  | needs live agent usage                                      | cost per operation and per account per month                                                                |
| Time to close a month                     | wall-clock measurement only the owner can take              | minutes from starting the close routine to trusting the numbers                                             |

## What changed in this review

- Forecast error: measured before/after by #290, recorded here as percentages.
- Transfer coverage and uncategorized share: measured on the same synthetic vault, so the
  program has a reproducible number and a definition for the owner.
- Realised-gain reconciliation, statement coverage, MCP usage, AI spend and time-to-close:
  named as owner-pending with their plan definitions; no fixture claim is dressed up as a
  live measurement.
- Dead experiment cleanup: the unreferenced root-level terminal transcript
  `2026-09-18-142020-use-typesafe-ai-…txt` was removed. `.scratch/` stays: it is the
  documented batch-run log location, not a dead experiment.
