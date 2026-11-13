import type { HTMLAttributes } from "react";
import { cn } from "./utils.js";

/* A status is never carried by tint alone. In the black-and-white theme --warn,
 * --neg and --pos are near-identical greys, so the SHAPE says what it is:
 * warning = dashed border + triangle, problem = solid border + cross-in-circle,
 * success = solid border + check-in-circle. Same markup in both themes; the
 * tokens do the colour. */

export type StatusTone = "warning" | "problem" | "success";

export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  warning: "border border-dashed border-warn text-warn",
  problem: "border border-solid border-neg text-neg",
  success: "border border-solid border-pos text-pos",
};

/** The icon alone also knows "info" (a neutral note: no border style, no tint). */
export type StatusIconKind = StatusTone | "info";

const ICON_PATH: Record<StatusIconKind, JSX.Element> = {
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.9v.1" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4 21 20H3Z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </>
  ),
  problem: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  success: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 3 3 5-6" />
    </>
  ),
};

/** Decoration only: the line's own words are what a screen reader gets. */
export function StatusIcon({ tone, className }: { tone: StatusIconKind; className?: string }) {
  return (
    <svg
      data-status-icon={tone}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("inline-block flex-none align-[-2px] mr-[6px]", className)}
    >
      {ICON_PATH[tone]}
    </svg>
  );
}

export type StatusLineProps = HTMLAttributes<HTMLElement> & {
  tone: StatusTone;
  /** Element to render; a paragraph unless the site needs a block or inline box. */
  as?: "p" | "div" | "span";
  "data-testid"?: string;
};

/* Compact on purpose (6px 10px, 8px radius, 1px border) so an inline form
 * error does not shove the form around. `role`, `id` and `aria-*` pass through
 * untouched: forms point `aria-describedby` at these ids. */
export default function StatusLine({
  tone,
  as: Tag = "p",
  className,
  children,
  ...props
}: StatusLineProps) {
  /* A status slot that is always mounted (stable id for aria-describedby, a
   * live region that fills later) must not draw an empty bordered box. */
  if (children === null || children === undefined || children === false || children === "") {
    return <Tag className={className} {...props} />;
  }
  return (
    <Tag
      className={cn("rounded-[8px] px-[10px] py-[6px]", STATUS_TONE_CLASS[tone], className)}
      {...props}
    >
      <StatusIcon tone={tone} />
      {children}
    </Tag>
  );
}
