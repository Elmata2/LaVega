import { useMemo } from "react";
import type { Account, ScheduledFlow, Tx } from "@lavega/core";
import { availableBalanceCents, reservedCents } from "@lavega/core";
import type { View } from "../../App";
import { formatEuro } from "../../format.js";
import Module from "../Module.js";
import TrendChart from "../TrendChart.js";
import DeltaPill from "./DeltaPill.js";
import { dayLabelNL, daysBetween, shiftDate } from "./dates.js";

/* Totale positie — the most important number on the homescreen, and now the
 * line behind it.
 *
 * The number is the sum of the balances LaVega actually knows. The graph is
 * that number walked BACKWARDS through the transactions of those same
 * accounts: the closing position on day d is today's position minus everything
 * that landed after d. That makes the line exact for every day the transaction
 * history covers — and undefined before it.
 *
 * The undefined part is the whole reason this block is careful. Walking back
 * past the oldest transaction we hold would draw a perfectly flat line, and a
 * flat line reads as "your position did not move", which is a claim about
 * money we cannot make. So the series STOPS at the oldest transaction, the
 * week/month comparisons are null rather than 0% when the history is shorter
 * than the period they name, and the card says so in words.
 *
 * Accounts without a saldo are excluded from BOTH the number and the walk, so
 * the two can never disagree; the card names how many were left out. */

/** How far back the graph draws, at most. A month is the longest comparison
 *  the card makes, so there is nothing to gain from a longer line. */
export const POSITION_WINDOW_DAYS = 30;

/** Below this much transaction history there is no line worth drawing — two or
 *  three days of movement is a squiggle, not a trend. */
export const MIN_HISTORY_DAYS = 7;

export type PositionPoint = { date: string; value: number };

export type PositionSeries = {
  /** Daily closing positions, oldest first. Empty when there is no history. */
  points: PositionPoint[];
  /** The position now, in euros: the sum of the KNOWN balances. */
  current: number;
  /** The position exactly 7 / 30 days ago, or null when the transaction
   *  history does not reach that far back. Never 0 as a stand-in. */
  weekAgo: number | null;
  monthAgo: number | null;
  /** Days between the oldest transaction we hold and `asOf`. */
  coverageDays: number;
  /** Accounts left out because their saldo is unknown. */
  excluded: number;
};

/** The total position over time, derived from the transactions alone. Pure, so
 *  the numbers under the graph are testable without a DOM. */
export function positionSeries(
  accounts: Account[],
  txs: Tx[],
  asOf: string,
  windowDays: number = POSITION_WINDOW_DAYS,
): PositionSeries {
  const known = accounts.filter((a) => a.balance !== null);
  const keys = new Set(known.map((a) => a.key));
  // Integer cents throughout the walk: a 30-step float subtraction over a
  // six-figure position drifts into visible cents.
  const currentCents = known.reduce((s, a) => s + Math.round((a.balance as number) * 100), 0);
  const excluded = accounts.length - known.length;
  const base = { current: currentCents / 100, excluded };

  const relevant = txs.filter((t) => keys.has(t.accountKey) && t.date <= asOf);
  if (relevant.length === 0) {
    return { ...base, points: [], weekAgo: null, monthAgo: null, coverageDays: 0 };
  }

  const earliest = relevant.reduce((a, t) => (t.date < a ? t.date : a), relevant[0].date);
  const coverageDays = Math.max(0, daysBetween(earliest, asOf));

  const net = new Map<string, number>();
  for (const t of relevant) net.set(t.date, (net.get(t.date) ?? 0) + Math.round(t.amount * 100));

  // Never earlier than the oldest transaction: before it the position is not
  // known, it is merely unrecorded.
  const start = coverageDays >= windowDays ? shiftDate(asOf, -windowDays) : earliest;
  const back: PositionPoint[] = [{ date: asOf, value: currentCents / 100 }];
  let cents = currentCents;
  for (let d = shiftDate(asOf, -1); d >= start; d = shiftDate(d, -1)) {
    // Closing on d = closing on d+1 minus what moved on d+1.
    cents -= net.get(shiftDate(d, 1)) ?? 0;
    back.push({ date: d, value: cents / 100 });
  }
  const points = back.reverse();

  const at = (date: string): number | null => points.find((p) => p.date === date)?.value ?? null;
  return {
    ...base,
    points,
    coverageDays,
    weekAgo: coverageDays >= 7 ? at(shiftDate(asOf, -7)) : null,
    monthAgo: coverageDays >= 30 ? at(shiftDate(asOf, -30)) : null,
  };
}

/** Change from `then` to `now` in percent. Null when there is no earlier
 *  figure, or when it was exactly zero — a percentage off zero is not a
 *  number, and "∞%" is not an insight. */
export function changePct(now: number, then: number | null): number | null {
  if (then === null || then === 0) return null;
  return ((now - then) / Math.abs(then)) * 100;
}

/** One "vs. vorige week" cell: the earlier figure and the move since, or the
 *  reason there is nothing to compare with. */
function Comparison({
  label,
  now,
  then,
  missing,
}: {
  label: string;
  now: number;
  then: number | null;
  missing: string;
}) {
  return (
    <div className="position-compare-item">
      <div className="eyebrow">{label}</div>
      {then === null ? (
        <div className="position-compare-missing">{missing}</div>
      ) : (
        <div className="position-compare-figure">
          <span className="position-compare-value">{formatEuro(then)}</span>
          <DeltaPill pct={changePct(now, then)} upIsGood={true} />
        </div>
      )}
    </div>
  );
}

type SaldoBlockProps = {
  accounts: Account[];
  txs: Tx[];
  scheduledFlows: ScheduledFlow[];
  asOf: string;
  onNavigate: (view: View) => void;
};

export default function SaldoBlock({ accounts, txs, scheduledFlows, asOf, onNavigate }: SaldoBlockProps) {
  const series = useMemo(() => positionSeries(accounts, txs, asOf), [accounts, txs, asOf]);

  const entities = Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0)));
  const unknownCount = series.excluded;
  const knownSum = series.current;
  // Money already earmarked for unpaid BTW. Only worth a line when there is
  // some — otherwise "beschikbaar" would just repeat the number above it.
  const reserved = reservedCents(scheduledFlows, asOf);

  const hasGraph = series.coverageDays >= MIN_HISTORY_DAYS && series.points.length >= 2;

  return (
    <Module
      title={`Totale positie${unknownCount > 0 ? " (deels)" : ""}`}
      span={2}
      height="tall"
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("accounts")}>
          Rekeningen →
        </button>
      }
      footer={
        <>
          {accounts.length} rekening{accounts.length === 1 ? "" : "en"} · {entities.length} entiteit
          {entities.length === 1 ? "" : "en"}
          {accounts.length > 0 && reserved > 0 && (
            <>
              {" · beschikbaar na BTW-reservering: "}
              {formatEuro(availableBalanceCents(knownSum, scheduledFlows, asOf) / 100)}
            </>
          )}
        </>
      }
    >
      <div className="module-figure">
        <span
          className={`module-figure-value ${accounts.length === 0 ? "" : knownSum >= 0 ? "text-pos" : "text-neg"}`}
        >
          {accounts.length === 0 ? "—" : formatEuro(knownSum)}
        </span>
        <DeltaPill pct={changePct(knownSum, series.weekAgo)} upIsGood={true} />
      </div>
      <p className="module-figure-label">
        {accounts.length === 0
          ? "Importeer een bestand of vul saldo's in."
          : unknownCount > 0
            ? `${unknownCount} rekening${unknownCount > 1 ? "en" : ""} nog zonder saldo — niet meegeteld, vul in bij Rekeningen.`
            : "Compleet: elke rekening heeft een saldo."}
      </p>

      {hasGraph ? (
        <div className="position-graph">
          <TrendChart
            points={series.points.map((p) => ({ label: dayLabelNL(p.date), value: p.value }))}
            color="var(--accent)"
            format={(v) => formatEuro(v)}
            ariaLabel="Totale positie per dag"
            readoutLabel="Positie op"
            height={132}
          />
        </div>
      ) : (
        <p className="block-empty position-graph-empty">
          {series.coverageDays === 0
            ? "Nog geen transacties op de rekeningen met een saldo — daaruit wordt de grafiek opgebouwd."
            : `Pas ${series.coverageDays} dag${series.coverageDays === 1 ? "" : "en"} transactiegeschiedenis — te weinig voor een lijn. Vanaf ${MIN_HISTORY_DAYS} dagen tekent LaVega hem.`}
        </p>
      )}

      <div className="position-compare">
        <Comparison
          label="Vorige week"
          now={knownSum}
          then={series.weekAgo}
          missing="Nog geen week geschiedenis"
        />
        <Comparison
          label="Vorige maand"
          now={knownSum}
          then={series.monthAgo}
          missing="Nog geen maand geschiedenis"
        />
      </div>
    </Module>
  );
}
