import { isPriceFresh } from "./calendar.js";
import type { PriceBar } from "./model.js";
import { convertCurrency, type FxRates } from "./portfolio.js";

export type QuoteQuality = "priced" | "forward-filled" | "unpriced" | "missing-fx";

/** One valuation of one holding, in the presentation currency. Every monetary
 *  fact is nullable: a quote that fails the freshness policy, or an FX rate
 *  that is missing, yields no number rather than a wrong one. */
export type PositionValuation = {
  quality: QuoteQuality;
  /** Close backing the value, or the newest supported close when it is too old
   *  to back one. Null when no close falls at or before the valuation date. */
  quoteDate: string | null;
  quoteCurrency: string | null;
  price: number | null;
  value: number | null;
  dailyChange: number | null;
  dailyChangePercentage: number | null;
};

const EPSILON = 1e-9;

function unusable(quality: QuoteQuality, bar: PriceBar | undefined): PositionValuation {
  return {
    quality,
    quoteDate: bar?.date ?? null,
    quoteCurrency: bar?.currency ?? null,
    price: null,
    value: null,
    dailyChange: null,
    dailyChangePercentage: null,
  };
}

/** Value `quantity` units from `bars` under the single freshness policy: only
 *  closes at or before `valuationDate` count, and the newest of those backs a
 *  value while it is at most `MAX_MISSED_BUSINESS_DAYS` business days old.
 *
 *  Both closes are converted at the valuation date's FX rate, so a daily change
 *  reports price movement rather than same-day FX revaluation. */
export function valuePosition(input: {
  bars: readonly PriceBar[];
  quantity: number;
  valuationDate: string;
  presentationCurrency: string;
  fxRates: FxRates;
}): PositionValuation {
  const supported = input.bars
    .filter((bar) => bar.date <= input.valuationDate)
    .sort((left, right) => left.date.localeCompare(right.date));
  const latest = supported.at(-1);
  if (!latest) return unusable("unpriced", undefined);
  if (!isPriceFresh(latest.date, input.valuationDate)) return unusable("unpriced", latest);

  const convert = (value: number, currency: string) =>
    convertCurrency(
      value,
      currency,
      input.presentationCurrency,
      input.valuationDate,
      input.fxRates,
    );
  let price: number;
  try {
    price = convert(latest.close, latest.currency);
  } catch {
    return unusable("missing-fx", latest);
  }

  // A prior close only measures a daily change when it is itself a supported
  // observation of the recent past. A multiweek gap is not one day of movement.
  const previous = supported.at(-2);
  let dailyChange: number | null = null;
  let dailyChangePercentage: number | null = null;
  if (previous && isPriceFresh(previous.date, latest.date)) {
    try {
      const priorPrice = convert(previous.close, previous.currency);
      dailyChange = (price - priorPrice) * input.quantity;
      dailyChangePercentage =
        Math.abs(priorPrice) <= EPSILON ? null : (price - priorPrice) / priorPrice;
    } catch {
      return unusable("missing-fx", latest);
    }
  }

  return {
    quality: latest.date === input.valuationDate ? "priced" : "forward-filled",
    quoteDate: latest.date,
    quoteCurrency: latest.currency,
    price,
    value: price * input.quantity,
    dailyChange,
    dailyChangePercentage,
  };
}
