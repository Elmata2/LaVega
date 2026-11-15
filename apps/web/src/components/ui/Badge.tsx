import { forwardRef, type HTMLAttributes } from "react";
import { StatusIcon, STATUS_TONE_CLASS, type StatusTone } from "./StatusLine.js";
import { cn } from "./utils.js";

/* Extracted from `.badge` (docs/adr/0005) — a small mono-uppercase chip. Plain
 * by default; `tone` marks it as a status (dashed border + triangle for
 * warning, solid border + cross for problem, solid + check for success), so
 * the meaning never rests on tint alone. Other colour overrides still come in
 * through `className`; `cn()`'s `twMerge` keeps them over the base
 * `border-line`/`text-muted` because they land later in the class list. */
const BADGE_BASE =
  "inline-flex items-center rounded-sm py-0.5 px-2 text-[0.7rem] font-mono uppercase " +
  "tracking-[0.03em] bg-surface-2 text-muted border border-line";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  "data-testid"?: string;
  /* Used as a status: border style (dashed warning, solid problem/success) plus
   * an icon, so the meaning survives the black-and-white theme. */
  tone?: StatusTone;
};

/* data-testid="badge", not the removed `.badge` class: TravelBlock.test.tsx
 * found chips via `.badge` as a CSS selector. */
const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, "data-testid": dataTestId, tone, children, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      data-testid={dataTestId ?? "badge"}
      className={cn(BADGE_BASE, tone && STATUS_TONE_CLASS[tone], className)}
      {...props}
    >
      {tone && <StatusIcon tone={tone} className="mr-1" />}
      {children}
    </span>
  );
});

export default Badge;
