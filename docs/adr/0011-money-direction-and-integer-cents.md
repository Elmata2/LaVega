# ADR 0011 — Direction, money and unknown-value convention for ported logic

## Status

Accepted 2026-11-10 (owner approved the Sure adoption plan; Phase 0 deliverable).

## Context

Sure and LaVega store cash direction with opposite signs. Sure's `Entry` treats a **negative
amount as an inflow** (cash in) and a positive amount as an outflow; LaVega's `Tx.amount` is
**negative for outflow**. Both are internally consistent, and both are load-bearing: LaVega's
`tx.id` hash includes the signed amount, so changing the stored convention would break every
existing transaction id and every export.

Sure also stores money as `BigDecimal(19,4)`. LaVega's vault stores `Tx.amount` as a
JavaScript number. Ported budget, bill and matching math must not inherit float comparison
behaviour or Sure's decimal scale by accident.

The adoption plan ports Sure algorithms into new TypeScript/Effect modules. A port that copies
a formula such as `amount.negative? ? income : expense` without flipping it will silently
invert cashflow, budgets and reports. This ADR fixes the one boundary where direction is
defined.

## Decision

### Direction

1. **Stored `Tx` keeps LaVega's convention:** `amount < 0` means money left the account,
   `amount > 0` means money entered it. Do not change it. Do not change the `tx.id` hash.
2. **Ported cash-flow logic exposes an explicit direction** (`"in" | "out"`) in its own
   input/output types where a sign is ambiguous. The conversion helper is the only place that
   reads the stored sign:
   ```ts
   // packages/core/src/money.ts (new)
   export type Direction = "in" | "out";
   export const directionOfTx = (tx: Tx): Direction => (tx.amount < 0 ? "out" : "in");
   ```
3. Every ported module carries a header line naming the Sure source AND its convention, e.g.
   `Sure stores outflow positive; this module uses LaVega's negative-outflow Tx at the boundary`.
4. Sure's `Entry`-style paraphrase is not copied into LaVega types. If a port needs an
   `entry`-shaped record (transfer pair, bill allocation), it uses `direction` plus a positive
   magnitude, never a bare Sure-signed amount.

### Money representation

5. **New pure modules use integer cents** (`amountCents: number`, safe integer) for money
   arithmetic. `Tx.amount` stays a float in EUR units for compatibility.
6. One conversion pair owns the edge:
   ```ts
   export const toCents = (amount: number): number => Math.round(amount * 100);
   export const fromCents = (cents: number): number => cents / 100;
   ```
   Rounding is half away from zero via `Math.round` for positive values; for negative values,
   use `-Math.round(-amount * 100)` so a -0.005 becomes -1 cent, not 0. Tests pin both signs.
7. No float equality, no `BigDecimal`, no 4-decimal scale in core. If a future source needs
   sub-cent precision (crypto), it gets its own explicit minor-unit field, not a float.
8. A magnitude that is not known is `null`, never `0`. A conversion rate that is not known is
   `null`, never `1`. A missing valuation leaves a gap, it is not interpolated.

### FX

9. FX conversion takes an explicit rate and date. There is no implicit 1:1 fallback in ported
   logic; callers decide whether to exclude the row or mark the figure unknown. This matches
   `fx.ts`'s existing convert-or-exclude mode.
10. A ported formula that must aggregate across currencies either converts with a supplied
    rate or returns a typed "missing FX" result. It never sums face values.

## Consequences

- Ports can be reviewed mechanically: grep for explicit direction/`Cents` names and for the
  absence of raw `amount <` comparisons in new modules.
- Existing vault data and `tx.id` stay untouched; new collections are additive.
- Property tests must cover both signs for every conversion and matching rule.
- Sure's own decimal scale and `Money` class are not ported; behaviour that depends on
  4-decimal rounding must be stated explicitly where it matters (e.g. split ratios use
  rationals, not cents).
- If a future feature needs sub-cent money, this ADR is amended; it is not worked around with
  floats.
