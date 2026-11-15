import { useId, useState } from "react";
import { Link } from "react-router-dom";

export type StatusAction = { to: string; label: string };
export type StatusItem = {
  message: string;
  /** "problem" is a figure that may be wrong or missing; "warning" is stale or
   *  degraded but still shown. */
  severity: "problem" | "warning";
  action?: StatusAction;
};

/** One sentence for the collapsed line: the count first, then what the first
 *  two problems are, so the reader knows whether to open the details. */
export function summarizeStatus(items: readonly StatusItem[]): string {
  const trim = (message: string) => message.trim().replace(/[.\s]+$/, "");
  const [first, second] = items;
  if (!first) return "";
  const noun = items.length === 1 ? "data problem" : "data problems";
  const lead = `${items.length} ${noun}: ${trim(first.message)}`;
  if (items.length === 1) return lead;
  if (items.length === 2 && second) return `${lead}, ${trim(second.message)}`;
  return `${lead}, ${trim(second?.message ?? "")} and ${items.length - 2} more`;
}

/** Collapses every message that used to get its own banner (sync, reading,
 *  refresh, connection) into one list. The same sentence from two sources is
 *  said once. */
export function mergeStatusItems(items: readonly StatusItem[]): StatusItem[] {
  const seen = new Map<string, StatusItem>();
  for (const item of items) {
    const existing = seen.get(item.message);
    if (!existing) seen.set(item.message, item);
    else if (!existing.action && item.action) seen.set(item.message, { ...existing, ...item });
  }
  return [...seen.values()];
}

function AlertIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0"
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

/** The single status line under the headline figures. Closed it is one
 *  sentence plus the first available action; "Details" opens every message
 *  and action. It is a live region, so a problem that arrives after the page
 *  loads is announced. */
export function OverviewStatus({ items }: { items: readonly StatusItem[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (items.length === 0) return null;
  const hasProblem = items.some((item) => item.severity === "problem");
  const primary = items.find((item) => item.action)?.action;
  return (
    <div
      role="alert"
      data-dashboard-status="problems"
      className={`rounded-tile border px-4 py-3 text-sm ${hasProblem ? "border-negative/30 bg-negative/5" : "border-warning/30 bg-warning/10"}`}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className={hasProblem ? "text-negative" : "text-warning"}>
          <AlertIcon />
        </span>
        <p className="min-w-0 flex-1 break-words">{summarizeStatus(items)}</p>
        <div className="flex shrink-0 items-center gap-3">
          {primary && (
            <Link
              to={primary.to}
              className="font-semibold text-accent underline-offset-2 hover:underline"
            >
              {primary.label}
            </Link>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            className="rounded-chip px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            {open ? "Hide details" : "Details"}
          </button>
        </div>
      </div>
      <ul
        id={panelId}
        hidden={!open}
        className="mt-3 space-y-2 border-t border-border pt-3 pl-7 text-sm"
      >
        {items.map((item) => (
          <li key={item.message}>
            {item.message}{" "}
            {item.action && (
              <Link
                to={item.action.to}
                className="font-semibold text-accent underline-offset-2 hover:underline"
              >
                {item.action.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
