# Plan: freelancer cash-flow
1. Core: PlanProfile gets `workKinds`, `chargesVat`; AdvisorProfile gets `chargesVat` (test: profileView).
2. Core: `plan/cashflow.ts` + tests (series, irregular rule, forward paths, buffer rule, set-asides, applies gate). RED first.
3. Core: wire `computePlan().cashflow`; preference `incomeTaxSetAsidePct`; pending fact id.
4. Wizard: `vat` screen, state, copy NL/EN, tests.
5. Web: CashflowCard + copy NL/EN; mount in Plan.tsx; tests.
6. Gate: test, typecheck --force, lint.
7. Browser walk on port 8801, evidence, report.
