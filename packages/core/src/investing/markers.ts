import type { Dividend } from "./dividend.js";
import type { PriceBar, Trade } from "./model.js";

export type PositionMarker = {
  kind: "buy" | "sell" | "dividend";
  eventDate: string;
  label: string;
  amount?: number;
  currency?: string;
};

export type PositionPricePoint = PriceBar & { markers: PositionMarker[] };

/** Attach events to daily bars without dropping events on non-trading days or duplicate dates. */
export function placePositionMarkers(
  bars: PriceBar[],
  trades: Trade[],
  dividends: Dividend[],
): PositionPricePoint[] {
  const points = [...bars]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((bar) => ({ ...bar, markers: [] as PositionMarker[] }));
  if (points.length === 0) return points;

  const indexForDate = (date: string): number => {
    const exact = points.findIndex((point) => point.date === date);
    if (exact >= 0) return exact;
    const next = points.findIndex((point) => point.date > date);
    return next >= 0 ? next : points.length - 1;
  };

  for (const trade of trades) {
    if (trade.side === "other") continue;
    points[indexForDate(trade.date)]!.markers.push({
      kind: trade.side,
      eventDate: trade.date,
      label: `${trade.side === "buy" ? "Koop" : "Verkoop"} ${trade.quantity}`,
    });
  }
  for (const dividend of dividends) {
    points[indexForDate(dividend.date)]!.markers.push({
      kind: "dividend",
      eventDate: dividend.date,
      label: `Dividend ${dividend.amount} ${dividend.currency}`,
      amount: dividend.amount,
      currency: dividend.currency,
    });
  }
  return points;
}

export const shapePositionPriceSeries = placePositionMarkers;
