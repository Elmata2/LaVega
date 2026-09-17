import type { EntityForecast } from "@lavega/core";
import type { View } from "../../App";
import { formatEuroIn, formatEuroAxisIn } from "../../format.js";
import Module from "../Module.js";
import TrendChart, { type TrendPoint } from "../TrendChart.js";
import CardLink from "../ui/CardLink.js";
import { useAppLocale } from "../../appLocale.js";
import { moneyCopy } from "../../copy/money.js";

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

export default function CashflowBlock({ forecast, bufferCents, onNavigate }: CashflowBlockProps) {
  const [locale] = useAppLocale();
  const c = moneyCopy[locale].forecast;
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
        { label: c.positieAsOfLabel, value: opening / 100 },
        ...forecast.points.map((p, i) => ({
          label: c.weekNLabel(i + 1),
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
        <CardLink onClick={() => onNavigate("forecast")}>Forecast →</CardLink>
      }
      footer={
        hasChart ? (
          forecast.shortfall && shortfallWeek !== null ? (
            <>
              {c.krapsteWeekLabel}{" "}
              <strong className="text-warn">
                {c.krapsteWeekDetail(
                  shortfallWeek,
                  formatEuroIn(locale, forecast.shortfall.balanceCents / 100),
                )}
              </strong>
            </>
          ) : (
            c.noneSentence
          )
        ) : undefined
      }
    >
      {forecast.openingCents === null ? (
        <p className="block-empty">{c.positieOnbekendKort}</p>
      ) : !hasChart ? (
        <p className="block-empty">{c.onvoldoendeHistorieVoorPrognose}</p>
      ) : (
        <TrendChart
          points={points}
          band={band}
          reference={{ value: bufferCents / 100, label: c.bufferReferenceLabel }}
          color={color}
          format={(v) => formatEuroAxisIn(locale, v)}
          ariaLabel={c.verwachteKaspositieAria}
          readoutLabel={c.verwacht}
          mark={shortfallWeek !== null ? { index: shortfallWeek, color: "var(--neg)" } : null}
          height={170}
        />
      )}
    </Module>
  );
}
