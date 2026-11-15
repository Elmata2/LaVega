import type { YahooChartResult, YahooPricePoint } from "./types.js";

export function mapYahooChart(result: YahooChartResult): YahooPricePoint[] {
  const quote = result.indicators?.quote?.[0];
  return (result.timestamp ?? [])
    .map((timestamp, index) => {
      const close = quote?.close?.[index];
      return {
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        open: quote?.open?.[index] ?? null,
        high: quote?.high?.[index] ?? null,
        low: quote?.low?.[index] ?? null,
        close: close ?? null,
        volume: quote?.volume?.[index] ?? null,
      };
    })
    .filter(
      (point): point is YahooPricePoint => point.close != null && Number.isFinite(point.close),
    );
}

export function yahooTimestampDate(value: number | undefined): string | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

export function mapYahooDividends(
  events: YahooChartResult["events"],
): Array<{ date: string; amount: number }> {
  return Object.values(events?.dividends ?? {}).flatMap((dividend) => {
    const date = yahooTimestampDate(dividend.date);
    return date && dividend.amount != null && Number.isFinite(dividend.amount)
      ? [{ date, amount: dividend.amount }]
      : [];
  });
}

export function mapYahooSplits(
  events: YahooChartResult["events"],
): Array<{ date: string; ratio?: number; description: string }> {
  return Object.values(events?.splits ?? {}).flatMap((split) => {
    const date = yahooTimestampDate(split.date);
    if (!date) return [];
    return [
      {
        date,
        ratio: split.denominator ? (split.numerator ?? 0) / split.denominator : undefined,
        description: split.splitRatio ? `${split.splitRatio} split` : "Split",
      },
    ];
  });
}
