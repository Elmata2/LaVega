import { useMemo } from "react";
import type { ScheduledFlow, Tx } from "@lavega/core";
import { detectScheduleStreams } from "@lavega/core";
import { formatEuro, monthShortNL } from "../../format.js";
import Module from "../Module.js";
import { daysBetween, shiftDate } from "./dates.js";

/* Betaalagenda — the reference's "Payment schedule": what is due next, with a
 * date tile per row.
 *
 * Two sources, and the row says which:
 *
 *  - PLANNED flows the app already keeps (BTW reservations, expected invoices,
 *    manual items). These are dates someone committed to.
 *  - RECURRING flows core detected in the transaction history
 *    (detectScheduleStreams: a party paid — or paying — at a steady cadence with
 *    a repeating amount). Their next date is the last occurrence rolled forward
 *    by the detected cadence. That is a PREDICTION, not a commitment, so it is
 *    labelled as one and carries the cadence that produced it — never mixed in
 *    silently with the confirmed rows.
 *
 * The detector is `detectScheduleStreams`, NOT the forecast's
 * `detectRecurringStreams` this block used until 20 Aug 2026. Measured, on the
 * shapes a Dutch export actually produces (app review 2, item 5): the forecast's
 * detector groups on the verbatim counterparty, so one Simyo incasso written
 * three ways became three streams of one and never appeared; and it rejects a
 * stream that skipped a cycle, so a failed incasso in June deleted the whole
 * subscription. It also never merged "DUO", "DUO Groningen" and "Dienst
 * Uitvoering Onderwijs". An INCOMING recurring stream belongs on this agenda
 * exactly as much as an outgoing one — DUO paying him is a date he can count on.
 *
 * LaVega never pays anything, so there is no action here — only the date, the
 * amount, where the row came from and whether it is late. */

const ROWS = 6;

/** How far ahead the agenda looks. A recurring stream repeats forever; past a
 *  quarter the list stops being an agenda and becomes a subscription report. */
const HORIZON_DAYS = 92;

/** Dutch label for a flow's status. `paid`/`cancelled` never reach the list. */
const STATUS_LABEL: Record<ScheduledFlow["status"], string> = {
  expected: "verwacht",
  confirmed: "bevestigd",
  paid: "betaald",
  cancelled: "vervallen",
};

/** How a detected cadence reads in Dutch. Covers every cadence
 *  `detectScheduleStreams` can return, plus the two short ones an older stream
 *  may still carry. */
export function cadenceLabel(days: number): string {
  if (days === 7) return "wekelijks";
  if (days === 14) return "elke 2 weken";
  if (days === 30) return "maandelijks";
  if (days === 61) return "tweemaandelijks";
  if (days === 91) return "elk kwartaal";
  if (days === 182) return "halfjaarlijks";
  if (days === 365) return "jaarlijks";
  return `elke ${days} dagen`;
}

export type AgendaRow = {
  id: string;
  date: string;
  label: string;
  /** Signed euros: negative is money out. */
  amount: number;
  note: string;
  /** A detected pattern rather than a committed date. */
  predicted: boolean;
};

/** The next occurrence of a stream on or after `asOf`, rolled forward from its
 *  last observed date by the detected cadence. */
export function nextOccurrence(lastDate: string, cadenceDays: number, asOf: string): string {
  const behind = daysBetween(lastDate, asOf);
  if (behind <= 0) return shiftDate(lastDate, cadenceDays);
  const steps = Math.ceil(behind / cadenceDays) || 1;
  return shiftDate(lastDate, steps * cadenceDays);
}

/** Planned flows and detected recurring payments, merged and sorted by date.
 *  Pure — `asOf` decides what is late, never the clock. */
export function agendaRows(scheduledFlows: ScheduledFlow[], txs: Tx[], asOf: string, limit = ROWS): AgendaRow[] {
  const planned: AgendaRow[] = scheduledFlows
    .filter((f) => f.status !== "paid" && f.status !== "cancelled")
    .map((f) => ({
      id: `flow:${f.id}`,
      date: f.dueDate,
      label: f.label,
      amount: (f.sign * f.amountCents) / 100,
      note: `${f.entity ? `${f.entity} · ` : ""}${STATUS_LABEL[f.status]}`,
      predicted: false,
    }));

  const horizon = shiftDate(asOf, HORIZON_DAYS);
  const recurring: AgendaRow[] = detectScheduleStreams(txs, { asOf })
    .map((s) => ({ s, date: nextOccurrence(s.lastDate, s.cadenceDays, asOf) }))
    .filter(({ date }) => date <= horizon)
    .map(({ s, date }) => ({
      id: `stream:${s.key}`,
      date,
      label: s.label,
      amount: (s.sign * s.amountCents) / 100,
      note: `${cadenceLabel(s.cadenceDays)} · ${s.occurrences}× gezien`,
      predicted: true,
    }));

  return [...planned, ...recurring]
    .sort((a, b) => (a.date === b.date ? a.label.localeCompare(b.label) : a.date.localeCompare(b.date)))
    .slice(0, limit);
}

type BetaalschemaBlockProps = {
  scheduledFlows: ScheduledFlow[];
  /** Needed for the recurring detection; the same list Overzicht already has. */
  txs: Tx[];
  /** Today, ISO — a date before it makes a row overdue. */
  asOf: string;
};

export default function BetaalschemaBlock({ scheduledFlows, txs, asOf }: BetaalschemaBlockProps) {
  const upcoming = useMemo(() => agendaRows(scheduledFlows, txs, asOf), [scheduledFlows, txs, asOf]);
  const overdueCount = upcoming.filter((r) => r.date < asOf).length;
  const predictedCount = upcoming.filter((r) => r.predicted).length;

  return (
    <Module
      title="Betaalagenda"
      height="tall"
      footer={
        upcoming.length > 0 ? (
          <>
            {overdueCount > 0 && `${overdueCount} datum${overdueCount === 1 ? "" : "s"} al verstreken. `}
            {predictedCount > 0
              ? `${predictedCount} regel${predictedCount === 1 ? "" : "s"} voorspeld uit je eigen geschiedenis, niet bevestigd.`
              : "Alle regels zijn ingeplande bedragen."}
          </>
        ) : undefined
      }
    >
      {upcoming.length === 0 ? (
        <p className="block-empty">
          Niets ingepland — hier komen je BTW-reserveringen, openstaande facturen en herkende vaste lasten te staan.
        </p>
      ) : (
        <div className="pay-list">
          {upcoming.map((r) => {
            const overdue = r.date < asOf;
            return (
              <div className="pay-row" key={r.id}>
                <div className={`pay-date ${overdue ? "pay-date-overdue" : ""}`} aria-hidden="true">
                  <span className="pay-date-day">{r.date.slice(8, 10)}</span>
                  <span className="pay-date-month">{monthShortNL(r.date)}</span>
                </div>
                <div className="pay-info">
                  <div className="pay-label">
                    {r.label}
                    {r.predicted && <span className="pay-tag">voorspeld</span>}
                  </div>
                  <div className="eyebrow">
                    {r.date} · {r.note}
                    {overdue ? " · te laat" : ""}
                  </div>
                </div>
                <span className={`pay-amount ${r.amount >= 0 ? "text-pos" : "text-neg"}`}>{formatEuro(r.amount)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Module>
  );
}
