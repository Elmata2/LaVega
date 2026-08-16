import { useMemo } from "react";
import type { ScheduledFlow } from "@lavega/core";
import { formatEuro, monthShortNL } from "../../format.js";
import Module from "../Module.js";

/* Betaalschema — the reference's "Payment schedule": what is due next, with a
 * date tile per row.
 *
 * Rows come from the ScheduledFlows the app already keeps (BTW reservations,
 * expected invoices, manual items). Paid and cancelled flows are gone from the
 * schedule by definition; overdue ones sort first, because a missed date is
 * the reason to look at this block at all. LaVega never pays anything, so
 * there is no action here — only the date, the amount and its status. */

const ROWS = 6;

/** Dutch label for a flow's status. `paid`/`cancelled` never reach the list. */
const STATUS_LABEL: Record<ScheduledFlow["status"], string> = {
  expected: "verwacht",
  confirmed: "bevestigd",
  paid: "betaald",
  cancelled: "vervallen",
};

type BetaalschemaBlockProps = {
  scheduledFlows: ScheduledFlow[];
  /** Today, ISO — a date before it makes a row overdue. */
  asOf: string;
};

export default function BetaalschemaBlock({ scheduledFlows, asOf }: BetaalschemaBlockProps) {
  const upcoming = useMemo(
    () =>
      scheduledFlows
        .filter((f) => f.status !== "paid" && f.status !== "cancelled")
        .slice()
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, ROWS),
    [scheduledFlows],
  );
  const overdueCount = upcoming.filter((f) => f.dueDate < asOf).length;

  return (
    <Module
      title="Betaalschema"
      height="tall"
      footer={
        overdueCount > 0
          ? `${overdueCount} datum${overdueCount === 1 ? "" : "s"} al verstreken.`
          : undefined
      }
    >
      {upcoming.length === 0 ? (
        <p className="block-empty">
          Niets ingepland — hier komen je BTW-reserveringen en openstaande facturen te staan.
        </p>
      ) : (
        <div className="pay-list">
          {upcoming.map((f) => {
            const overdue = f.dueDate < asOf;
            return (
              <div className="pay-row" key={f.id}>
                <div className={`pay-date ${overdue ? "pay-date-overdue" : ""}`} aria-hidden="true">
                  <span className="pay-date-day">{f.dueDate.slice(8, 10)}</span>
                  <span className="pay-date-month">{monthShortNL(f.dueDate)}</span>
                </div>
                <div className="pay-info">
                  <div className="pay-label">{f.label}</div>
                  <div className="eyebrow">
                    {f.dueDate}
                    {f.entity ? ` · ${f.entity}` : ""} · {STATUS_LABEL[f.status]}
                    {overdue ? " · te laat" : ""}
                  </div>
                </div>
                <span className={`pay-amount ${f.sign === 1 ? "text-pos" : "text-neg"}`}>
                  {formatEuro((f.sign * f.amountCents) / 100)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Module>
  );
}
