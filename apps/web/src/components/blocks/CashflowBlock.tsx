import type { EntityForecast } from "@lavega/core";
import type { View } from "../../App";
import { formatEuro } from "../../format.js";
import Module from "../Module.js";
import TrendChart, { type TrendPoint } from "../TrendChart.js";

/* Cashflow · komende 13 weken — the forecast in one glance: the uncertainty
 * band, the buffer line, and the projected closing balance, red once it dips
 * below the buffer.
 *
 * Takes the already-computed forecast so the block does no work of its own;
 * the full picture (drivers, per-entity scopes) lives in the Forecast tab.
 * Since U3 it draws through the shared TrendChart, so the small chart here and
 * the large one on the Forecast tab are the same chart at two sizes — and both
 * gained the hover/tap readout. */

type CashflowBlockProps = {
  forecast: EntityForecast;
  /** Warn below this balance, in integer cents — drawn as the dashed line. */
  bufferCents: number;
  onNavigate: (view: View) => void;
};

/** Whole euros: cents on a forecast are false precision. */
const wholeEuro = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export default function CashflowBlock({ forecast, bufferCents, onNavigate }: CashflowBlockProps) {
  const shortfallWeek =
    forecast.shortfall !== null
      ? forecast.points.findIndex((p) => p.date === forecast.shortfall!.date) + 1
      : null;
  // The forecast engine still emits weekly points when the opening position is
  // unknown (their projections are null). Without this the footer would claim
  // "no shortfall expected" under a body that says no forecast is possible.
  const hasChart = forecast.openingCents !== null && forecast.points.length > 0;

  // "nu" plus one point per forecast week, so the line starts at today's real
  // position rather than at week 1.
  const opening = forecast.openingCents ?? 0;
  const points: TrendPoint[] = hasChart
    ? [
        { label: "nu", value: opening / 100 },
        ...forecast.points.map((p, i) => ({
          label: `week ${i + 1}`,
          value: (p.projectedClosingCents ?? opening) / 100,
        })),
      ]
    : [];
  const band = hasChart
    ? {
        lower: [
          opening / 100,
          ...forecast.points.map((p) => (p.lowerCents ?? p.projectedClosingCents ?? opening) / 100),
        ],
        upper: [
          opening / 100,
          ...forecast.points.map((p) => (p.upperCents ?? p.projectedClosingCents ?? opening) / 100),
        ],
      }
    : undefined;
  const color = forecast.shortfall ? "var(--neg)" : "var(--pos)";

  return (
    <Module
      title="Cashflow"
      span={2}
      height="tall"
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("forecast")}>
          Forecast →
        </button>
      }
      footer={
        hasChart ? (
          forecast.shortfall && shortfallWeek !== null ? (
            <>
              Krapste week:{" "}
              <strong className="text-warn">
                week {shortfallWeek} — {formatEuro(forecast.shortfall.balanceCents / 100)}
              </strong>
            </>
          ) : (
            "Geen tekort verwacht in de komende 13 weken."
          )
        ) : undefined
      }
    >
      {forecast.openingCents === null ? (
        <p className="block-empty">Positie onbekend — nog geen betrouwbare prognose mogelijk.</p>
      ) : !hasChart ? (
        <p className="block-empty">Onvoldoende historie voor een prognose.</p>
      ) : (
        <TrendChart
          points={points}
          band={band}
          reference={{ value: bufferCents / 100, label: "buffer" }}
          color={color}
          format={(v) => wholeEuro.format(v)}
          ariaLabel="Verwachte kaspositie komende 13 weken"
          readoutLabel="Verwacht"
          mark={shortfallWeek !== null ? { index: shortfallWeek, color: "var(--neg)" } : null}
          height={170}
        />
      )}
    </Module>
  );
}
