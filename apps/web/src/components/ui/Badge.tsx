import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "./utils.js";

/* Extracted from `.badge` (docs/adr/0005) — a small mono-uppercase chip, no
 * variants of its own. Call sites override colour with an existing utility
 * (e.g. Punten's `puntBadgeClass`, `border-warn text-warn`) passed through
 * `className`; `cn()`'s `twMerge` keeps that override over the base
 * `border-line`/`text-muted` because it lands later in the class list, the
 * same way the plain-string concatenation already worked today. */
const BADGE_BASE =
  "inline-flex items-center rounded-sm py-0.5 px-2 text-[0.7rem] font-mono uppercase " +
  "tracking-[0.03em] bg-surface-2 text-muted border border-line";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & { "data-testid"?: string };

/* data-testid="badge", not the removed `.badge` class: TravelBlock.test.tsx
 * found chips via `.badge` as a CSS selector. */
const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, "data-testid": dataTestId, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      data-testid={dataTestId ?? "badge"}
      className={cn(BADGE_BASE, className)}
      {...props}
    />
  );
});

export default Badge;
