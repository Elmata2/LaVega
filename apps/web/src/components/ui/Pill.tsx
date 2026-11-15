import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils.js";

/* Extracted from `.pill`/`.pill-active` (docs/adr/0005) — the toggle-chip
 * button (bank-mode switch, category filter, "widget toevoegen"), not the
 * `rounded-pill` radius utility other components already use directly.
 *
 * `enabled:cursor-pointer` and `hover:enabled:`, same reasoning as Button
 * (trap 7, ADR): the bare `button:disabled { cursor: not-allowed }` rule
 * sits in `@layer components` and would lose to an unconditional
 * `cursor-pointer` in `@layer utilities` regardless of the `:disabled`
 * pseudo. Scoping to `enabled:` leaves the disabled state to that rule. */
export const pillVariants = cva(
  "inline-flex items-center gap-[6px] rounded-pill py-[6px] px-[14px] text-[0.85rem] " +
    "bg-transparent border border-line text-muted enabled:cursor-pointer hover:enabled:text-ink",
  {
    variants: {
      active: {
        true: "bg-accent-soft text-ink border-accent",
        false: "",
      },
    },
    defaultVariants: { active: false },
  },
);

export type PillProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof pillVariants> & { "data-testid"?: string };

/* data-testid="pill", not the removed `.pill` class: rekeningen-ui.test.tsx
 * and Punten.test.tsx scoped a `byText` lookup to `[data-testid=bank-modes]
 * .pill` to find one of the two mode toggles by its text. */
const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  { className, active, type = "button", "data-testid": dataTestId, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-testid={dataTestId ?? "pill"}
      className={cn(pillVariants({ active }), className)}
      {...props}
    />
  );
});

export default Pill;
