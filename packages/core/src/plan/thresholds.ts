import {
  PRICE_INCREASE_MIN_CENTS,
  PRICE_INCREASE_MIN_PCT,
} from "../subscriptions.js";

/* The ONE table for every plan cut-off. Placeholders chosen by the builder for
 * the first launch; they are NOT research-backed. Change a number here and
 * nowhere else. */
export const PLAN_THRESHOLDS = {
  version: "plan-thresholds-1",
  month: { roomShareOnTrack: 0.1, history: { minDays: 60 } },
  /** Longer than this to close a buffer gap reads as not reachable. */
  buffer: { maxCloseMonths: 120 },
  spending: { minMonths: 6, overLimitMonths: 2 },
  subscriptions: {
    minDays: 90,
    /** Shared with `subscriptionPriceIncreases`, not mirrored. */
    increasePctMin: PRICE_INCREASE_MIN_PCT,
    increaseCentsMin: PRICE_INCREASE_MIN_CENTS,
  },
  cards: { betterCardMargin: 0.1, horizonMonths: 12 },
  goals: { within12Months: 12 },
  /** Absolute noise bounds for the change log (spec 17), tunable. `pct` is in
   *  percentage points (0.1 = 0.1 points), matching the `pct` figure unit. */
  noise: { cents: 1000, months: 0.1, ratio: 0.01, pct: 0.1 },
  scenarioRates: [0, 0.02, 0.04, 0.06],
} as const;
