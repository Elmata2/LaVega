import type { Tx } from "./model.js";

/** The ONE boundary where a stored transaction sign becomes a direction.
 *
 *  ADR 0011: `Tx.amount < 0` means money left the account; new ported modules
 *  expose an explicit `Direction` instead of reading the sign again, so a Sure
 *  formula that assumes the opposite convention cannot be copied in silently.
 *
 *  Sure stores outflow positive (`app/models/entry.rb:325-327`); this module
 *  keeps LaVega's negative-outflow convention at the `Tx` boundary. */
export type Direction = "in" | "out";

export const directionOfTx = (tx: Pick<Tx, "amount">): Direction =>
  tx.amount < 0 ? "out" : "in";

/** EUR units to integer cents, half away from zero on both signs (ADR 0011).
 *  `-0.005` is `-1`, not `0`: `Math.round` alone truncates negative halves
 *  toward positive infinity, which would quietly turn a one-cent outflow into
 *  nothing. */
export const toCents = (amount: number): number =>
  amount < 0 ? -Math.round(-amount * 100) : Math.round(amount * 100);

export const fromCents = (cents: number): number => cents / 100;

/** Positive magnitude in cents — the shape a ported matching rule compares.
 *  A signed amount stays available through `toCents` for callers that need the
 *  direction of the ORIGINAL row; matching two legs compares magnitudes. */
export const magnitudeCents = (amount: number): number => Math.abs(toCents(amount));
