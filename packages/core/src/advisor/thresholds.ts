/* The ONE table for every capacity and review cut-off. A starting point chosen
 * by the owner for the first launch; it is NOT research-backed. Change a
 * number here and nowhere else. */
export const CAPACITY_THRESHOLDS = {
  /** [low, high]: below low = 0 points, low..high inclusive = 1, above high = 2. */
  bufferMonths: [1, 3],
  /** Share of income left over in the median month. Below the first = 0 points. */
  roomShare: [0, 0.1],
  /** Share of income going to debt payments. Above the second = 0 points, below the first = 2. */
  debtShare: [0.1, 0.3],
  /** Years to the nearest goal. */
  horizonYears: [3, 10],
  /** Sum of the four part points (0..8) to a 1..5 score; first row whose max covers the sum. */
  sumToScore: [
    { max: 1, score: 1 },
    { max: 3, score: 2 },
    { max: 5, score: 3 },
    { max: 7, score: 4 },
    { max: 8, score: 5 },
  ],
} as const;

export const RISK_REVIEW_THRESHOLDS = {
  /** The risk answers are due again after this many whole months. */
  monthsUntilDue: 12,
  /** An income change above this share (0.2 = 20%) makes them due sooner. */
  incomeChangeShare: 0.2,
} as const;

/** Fewest answered risk questions that still give a tolerance score. */
export const MIN_RISK_ANSWERS = 4;
/** Fewest present capacity inputs (of four) that still give a capacity score. */
export const MIN_CAPACITY_INPUTS = 3;
