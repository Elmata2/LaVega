import type { ReactNode } from "react";
import type { InvestingDashboardData } from "@lavega/core";
import { shortDate } from "../lib/dates.js";
import {
  formatMoney,
  formatSignedPercent,
  historyReason,
  portfolioFigures,
  valueQualifier,
  type PortfolioFigures,
} from "../lib/portfolioFigures.js";

function tone(value: number | null): string {
  if (value === null) return "text-muted-foreground";
  return value >= 0 ? "text-positive" : "text-negative";
}

/** Estimated prices, partly-unknown value and estimated cash: the detail behind
 *  the one-line qualifiers. Shared by the header row and the Key figures
 *  widget. Renders nothing when the figures carry no caveat. */
export function PortfolioFigureNotes({
  figures,
  currency,
}: {
  figures: PortfolioFigures;
  currency: string;
}) {
  const { latest } = figures;
  if (!latest) return null;
  return (
    <>
      {latest.forwardFilled.length > 0 && (
        <details className="mt-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Estimated prices ({latest.forwardFilled.length})
          </summary>
          <p className="mt-1 break-words">
            <span className="sr-only">Estimated price: </span>
            {latest.forwardFilled.join(", ")}
          </p>
        </details>
      )}
      {(latest.unpriced.length > 0 || latest.cashUnknown.length > 0) && (
        <div
          role="status"
          className="mt-4 rounded-tile border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5"
        >
          <p className="font-semibold">Value partly unknown</p>
          {latest.unpriced.length > 0 && <p>No usable price: {latest.unpriced.join(", ")}</p>}
          {latest.cashUnknown.length > 0 && (
            <p>Cash history unknown: {latest.cashUnknown.join(", ")}</p>
          )}
          {Object.entries(latest.cashShortfall ?? {}).map(([wallet, amount]) => (
            <p key={wallet}>
              {wallet} is missing about {formatMoney(Math.abs(amount), currency)} of{" "}
              {amount < 0 ? "funding" : "spending"} before its balances add up.
            </p>
          ))}
        </div>
      )}
      {(latest.cashEstimated?.length ?? 0) > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Estimated cash: {latest.cashEstimated?.join(", ")}. Walked from movements your broker
          reported without proving the history complete.
        </p>
      )}
    </>
  );
}

function hasNotes(figures: PortfolioFigures): boolean {
  const { latest } = figures;
  return (
    !!latest &&
    (latest.forwardFilled.length > 0 ||
      latest.unpriced.length > 0 ||
      latest.cashUnknown.length > 0 ||
      (latest.cashEstimated?.length ?? 0) > 0)
  );
}

function Cell({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      {children}
    </div>
  );
}

/** The Overview's answer-first header: what the portfolio is worth, what changed
 *  since the previous valuation, and how it has done. Fixed above the widget
 *  grid, not a widget, so a saved layout can never hide the answer. An unknown
 *  figure says "Unknown" and why; it is never rendered as zero. */
export function PortfolioKpiRow({ data }: { data: InvestingDashboardData }) {
  const figures = portfolioFigures(data);
  const currency = data.presentationCurrency;
  const { portfolioValue, dailyChange, dailyChangePercentage, totalReturn, previous, since } =
    figures;
  const valueNote = valueQualifier(figures);
  const reason = historyReason(figures, data.portfolio.All.length);
  return (
    <section aria-label="Portfolio headline figures" data-dashboard-header="kpis">
      <dl className="grid grid-cols-2 border-y border-border md:grid-cols-3">
        <Cell
          label="Portfolio value"
          className="col-span-2 border-b border-border py-5 md:col-span-1 md:border-b-0 md:border-r md:pr-6"
        >
          <dd
            className={`mt-1 font-semibold tabular-nums ${portfolioValue === null ? "text-2xl text-muted-foreground md:text-3xl" : "text-4xl md:text-5xl"}`}
          >
            {portfolioValue === null ? "Unknown" : formatMoney(portfolioValue, currency)}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            {portfolioValue === null
              ? "No usable price for any holding yet"
              : (valueNote ?? (figures.latest ? `As of ${shortDate(figures.latest.date)}` : ""))}
          </dd>
        </Cell>
        <Cell label="Today" className="border-r border-border py-5 pr-4 md:px-6">
          <dd
            className={`mt-1 text-2xl font-semibold tabular-nums md:text-3xl ${tone(dailyChange)}`}
          >
            {dailyChange === null ? "Unknown" : formatMoney(dailyChange, currency, "always")}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            {dailyChange === null ? (
              reason
            ) : (
              <>
                <span className={`font-semibold tabular-nums ${tone(dailyChange)}`}>
                  {dailyChangePercentage === null
                    ? "Percentage unknown"
                    : formatSignedPercent(dailyChangePercentage)}
                </span>
                {previous ? ` vs ${shortDate(previous.date)}` : ""}
              </>
            )}
          </dd>
        </Cell>
        <Cell label="Total return" className="py-5 pl-4 md:pl-6">
          <dd
            className={`mt-1 text-2xl font-semibold tabular-nums md:text-3xl ${tone(totalReturn)}`}
          >
            {totalReturn === null ? "Unknown" : formatSignedPercent(totalReturn)}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            {totalReturn === null
              ? reason
              : since
                ? `TWR since ${shortDate(since)}, after deposits and withdrawals`
                : "TWR, after deposits and withdrawals"}
          </dd>
        </Cell>
      </dl>
      {hasNotes(figures) && (
        <details className="pt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer text-foreground">About these figures</summary>
          <PortfolioFigureNotes figures={figures} currency={currency} />
        </details>
      )}
    </section>
  );
}
