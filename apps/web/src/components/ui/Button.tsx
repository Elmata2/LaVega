import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils.js";

/* Extracted from `.btn`/`.btn-primary` (docs/adr/0005) — 16 call sites shared
 * that one hand-written pair; a component keeps the single source of truth
 * instead of duplicating the utility string at each site.
 *
 * `enabled:cursor-pointer`, not a bare `cursor-pointer`: the bare tag rule
 * `button:disabled { cursor: not-allowed }` (kept, base.css) sits in
 * `@layer components`, which loses to ANY rule in `@layer utilities`
 * regardless of specificity — so an unconditional `cursor-pointer` here would
 * silently beat `not-allowed` on a disabled button. Scoping it to `enabled:`
 * leaves the disabled state to the untouched bare-tag rule (trap 7, ADR).
 *
 * `hover:enabled:` reproduces `:hover:not(:disabled)` — `:enabled` is the
 * native equivalent for form controls, and Tailwind wraps `hover:` in
 * `@media (hover: hover)`, which only excludes hover-incapable (touch)
 * devices; a mouse hover in a real browser matches identically. */
export const buttonVariants = cva(
  "inline-flex items-center gap-2 rounded-pill border py-2 px-[18px] font-medium " +
    "enabled:cursor-pointer hover:enabled:border-accent",
  {
    variants: {
      variant: {
        default: "border-line bg-surface-2 text-ink",
        /* `.btn-primary:hover:not(:disabled) { filter: brightness(1.08) }` —
         * an arbitrary property, not the `brightness-*` scale, because no
         * step on that scale is 1.08 and rounding it is a visible regression
         * the test suite cannot catch. */
        primary: "border-accent bg-accent text-white hover:enabled:[filter:brightness(1.08)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    "data-testid"?: string;
  };

/* data-testid="btn-primary" on the primary variant: five tests found the save
 * button via `.btn-primary` as a CSS selector (the class-coupling DeltaPill's
 * data-testid already moved away from elsewhere in this app). An explicit
 * `data-testid` from the caller still wins. */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, type = "button", "data-testid": dataTestId, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-testid={dataTestId ?? (variant === "primary" ? "btn-primary" : undefined)}
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  );
});

export default Button;
