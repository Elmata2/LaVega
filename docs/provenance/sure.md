# Sure provenance ledger

Sure (`we-promise/sure`, community fork of Maybe Finance, AGPL-3.0) is a design
and algorithm source, not a runtime dependency. The decision is recorded in
[ADR 0010](../adr/0010-sure-as-port-source-not-runtime.md).

- Upstream: <https://github.com/we-promise/sure>
- Pinned commit: `562fe096d149cb4d1fb1e6d3446527572c1ec7f6` (2026-11-10)
- Method: static reading of Ruby source and tests; independently reimplemented in TypeScript.
- Raw notes: [Sure research](../research/sure/README.md)

`scripts/check-attribution.mjs` enforces this ledger. Every runtime source file
with a "Ported from Sure" header must have a row below. Every row below must
point at an existing ported file.

## Appendix A — Port provenance ledger

| LaVega module                                                                                    | Sure source (path)                                                                                                          | Commit  | Licence  | Change summary                                                                                                                 |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/transfers.ts`                                                                 | `app/models/family/auto_transfer_matchable.rb`, `transfer.rb`, `transaction/transferable.rb`, `rejected_transfer.rb`        | 562fe09 | AGPL-3.0 | independently reimplemented; pure TS, direction explicit, no SQL; changed 2026-11-10                                           |
| `packages/core/src/rules/{model,evaluate,compile,parse,dryrun,index}.ts`                         | `app/models/rule.rb`, `rule/**`                                                                                             | 562fe09 | AGPL-3.0 | independently reimplemented; evaluator first, no email/split actions; changed 2026-11-10                                       |
| `packages/core/src/labels.ts`                                                                    | `transaction/label_normalizer*`                                                                                             | 562fe09 | AGPL-3.0 | trimmed NL/DE/EN packs; changed 2026-11-10                                                                                     |
| `packages/core/src/alerts.ts`                                                                    | `app/models/insight/generators/*`                                                                                           | 562fe09 | AGPL-3.0 | insights section only: the three formulas LaVega lacked; changed 2026-11-10                                                    |
| `packages/core/src/bills/{model,schedule,occurrences,match,allocate,paycheck,forecast,index}.ts` | `recurring_transaction*`, `recurring_occurrence.rb`, `recurring_allocation.rb`, `recurring_transaction/paycheck_planner.rb` | 562fe09 | AGPL-3.0 | independently reimplemented date/occurrence engine, matcher/allocation and paycheck plan (#286/#287/#288); changed 2026-11-11  |
| `packages/core/src/budget.ts`                                                                    | `budget.rb`, `budget_category.rb`, `budget/rollover_calculator.rb`, `period.rb`                                             | 562fe09 | AGPL-3.0 | envelope math, no UI/share chain; changed 2026-11-11                                                                           |
| `packages/core/src/balanceSeries.ts`                                                             | `balance/{base,forward,reverse}_calculator.rb`, `balance/materializer.rb`                                                   | 562fe09 | AGPL-3.0 | independently reimplemented over vault arrays: forward/reverse replay, hard resets, gaps, net worth (#291); changed 2026-11-11 |
| `packages/core/src/balance.ts`                                                                   | `app/models/account.rb`, `account/**` (classification, balance types, valuation anchors)                                    | 562fe09 | AGPL-3.0 | asset/liability kinds, classification, dated absolute valuations; no amortization/sync; changed 2026-11-11                     |
| `packages/core/src/reports.ts`                                                                   | `income_statement*`, `balance_sheet*`, `period.rb`                                                                          | 562fe09 | AGPL-3.0 | subset: balance sheet, income statement, spending-vs-normal; changed 2026-11-11                                                |
| `packages/core/src/investing/allocation.ts`                                                      | `app/models/investment_statement.rb:82-124`                                                                                 | 562fe09 | AGPL-3.0 | allocation ladder over vault arrays; changed 2026-11-11                                                                        |
| `packages/core/src/investing/costBasis.ts`                                                       | `holding/lot_book.rb`, `holding/forward_calculator.rb`                                                                      | 562fe09 | AGPL-3.0 | moving-average lot book; changed 2026-11-11                                                                                    |
| `packages/core/src/investing/realized.ts`                                                        | `trade.rb:159-267`, `investment_statement/totals.rb`                                                                        | 562fe09 | AGPL-3.0 | realised + income report; changed 2026-11-11                                                                                   |
| `packages/core/src/investing/securities.ts`                                                      | `security.rb`, `security/price/importer.rb`                                                                                 | 562fe09 | AGPL-3.0 | ISIN-first canonical identity; changed 2026-11-11                                                                              |
| `packages/core/src/agentTools.ts`                                                                | `assistant/function/*`, `assistant.rb`, `function_tool_caller.rb`                                                           | 562fe09 | AGPL-3.0 | typed registry, read-first scopes; changed 2026-11-11                                                                          |
| `packages/core/src/provenance.ts`                                                                | `assistant/function/record_valuation.rb`, `Provenance::Citation.parse!`                                                     | 562fe09 | AGPL-3.0 | structured citation grammar; changed 2026-11-11                                                                                |
| `apps/investing-server/src/tools/{investingTools,chatTools,writeTools}.ts`                       | `assistant/function/*`, `function_tool_caller.rb`                                                                           | 562fe09 | AGPL-3.0 | one definition set bound to chat and `/mcp`; changed 2026-11-11                                                                |
| `apps/investing-server/src/toolLoop.ts`                                                          | `assistant/responder.rb`, `assistant/history_trimmer.rb`                                                                    | 562fe09 | AGPL-3.0 | round cap, forced text, pair-safe trim, failed-turn status; changed 2026-11-11                                                 |
| `apps/investing-server/src/evals/harness.ts`                                                     | `llm-evals.yml`, eval dataset concept (`docs/research/sure/02-platform-ai.md` §1.7)                                         | 562fe09 | AGPL-3.0 | offline fixture harness + reviewed contract snapshot; changed 2026-11-11                                                       |
| `apps/server/src/mcp/{routes,protocol,sessions,tokens}.ts`                                       | `app/controllers/mcp_controller.rb`                                                                                         | 562fe09 | AGPL-3.0 | JSON-RPC transport, sessions, bearer token → tenant, stricter auth; changed 2026-11-11                                         |
| `packages/database/src/mcpTokens.ts`                                                             | `app/controllers/mcp_controller.rb`, `app/models/llm_usage.rb`                                                              | 562fe09 | AGPL-3.0 | hashed token table + audit row; failed-call and cache columns; changed 2026-11-11                                              |
| `packages/core/src/statements/{types,detect,review}.ts`                                          | `app/models/account_statement/**`, `document.rb`                                                                            | 562fe09 | AGPL-3.0 | statement metadata detector + review queue; no PDF text extractor, filename tier first; changed 2026-11-11                     |
| `packages/core/src/csvImport.ts`                                                                 | `app/models/import.rb`, `import/*_mapping.rb`                                                                               | 562fe09 | AGPL-3.0 | generic import session over the existing hash identity; changed 2026-11-11                                                     |
| `packages/core/src/interop/export.ts`                                                            | export/interop vocabulary (`docs/research/sure/02-platform-ai.md` §4)                                                       | 562fe09 | AGPL-3.0 | versioned ZIP/NDJSON + CSV export with manifest and readback; changed 2026-11-11                                               |

Rows are added when a module lands. A ported file without a row fails the
attribution check, and a row without a ported file fails it too.

If text from Sure's MIT-licensed `docs/llm-guides/wealth-blueprint.md` is
adapted, keep its separate MIT notice: "Blueprint text © 2026 diegomarino, MIT".

## Appendix B — Related records

| Need                                            | File                                                   |
| ----------------------------------------------- | ------------------------------------------------------ |
| Raw Sure core-domain notes                      | `docs/research/sure/00-core-domain.md`                 |
| Raw Sure investing notes                        | `docs/research/sure/01-investing.md`                   |
| Raw Sure agent/API/import notes                 | `docs/research/sure/02-platform-ai.md`                 |
| LaVega state and gap analysis                   | `docs/research/sure/03-lavega-state.md`                |
| Consolidated teardown                           | `docs/research/2026-11-10-sure-teardown.md`            |
| Decision record                                 | `docs/adr/0010-sure-as-port-source-not-runtime.md`     |
| Money and direction convention                  | `docs/adr/0011-money-direction-and-integer-cents.md`   |
| MCP auth and tenant resolution                  | `docs/adr/0012-mcp-auth-and-tenant-resolution.md`      |
