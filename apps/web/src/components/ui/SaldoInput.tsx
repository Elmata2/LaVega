import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./utils.js";

/* Extracted from `.saldo-input` (docs/adr/0005) — the fixed-width right-
 * aligned numeric input for entering a balance. A few call sites (Punten,
 * Facturen) widen it with their own `w-full`; `cn()`'s `twMerge` keeps that
 * later width utility over this component's own `w-[120px]`, same as the
 * plain-string concatenation did before. */
const SALDO_INPUT_BASE = "w-[120px] text-right tabular-nums";

export type SaldoInputProps = InputHTMLAttributes<HTMLInputElement> & { "data-testid"?: string };

/* data-testid="saldo-input", not the removed class: Punten.test.tsx used
 * `.saldo-input` as an existence check to pick the balance field out of a
 * bank panel's other labelled fields. */
const SaldoInput = forwardRef<HTMLInputElement, SaldoInputProps>(function SaldoInput(
  { className, "data-testid": dataTestId, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      data-testid={dataTestId ?? "saldo-input"}
      className={cn(SALDO_INPUT_BASE, className)}
      {...props}
    />
  );
});

export default SaldoInput;
