// Synthetic 90-day net-worth series: positionsValue + cashValue, shaped like
// the real domain per issue #73 — a 3-day forward-filled stretch (stale
// price, still within the 5-day cap) and a later day where one symbol falls
// PAST the cap and is excluded outright (positionsValue just drops, no fill).
// Not an artifact of the fake data — both are real traits the chart has to
// survive without misleading the reader.

export type NetWorthPoint = {
  date: string;
  positionsValue: number;
  cashValue: number;
  forwardFilled: boolean; // true if a held symbol used a stale (capped) price this day
  excludedSymbols: string[]; // symbols past the 5-day cap, dropped from positionsValue entirely
};

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function generateNetWorthPoints(days = 90): NetWorthPoint[] {
  const rand = seededRandom(7);
  const points: NetWorthPoint[] = [];
  const start = new Date("2026-05-24T00:00:00Z");

  let positionsValue = 38_240;
  let cashValue = 4_180;

  // Stale-fill stretch: ASML goes unpriced for 3 days but is still within
  // the cap, so it forward-fills — day 38 through 40.
  const forwardFillStart = 38;
  const forwardFillEnd = 40;
  // PYPL falls past the 5-day cap on day 61 and is excluded from then on.
  const exclusionStart = 61;

  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + i);

    positionsValue *= 1 + (rand() - 0.47) * 0.012;
    cashValue += (rand() - 0.5) * 60; // cash drifts slowly: dividends, small spends

    const forwardFilled = i >= forwardFillStart && i <= forwardFillEnd;
    const excludedSymbols = i >= exclusionStart ? ["PYPL"] : [];
    // Excluded symbol stops contributing — a real, permanent step down, not a dip that recovers.
    const displayedPositionsValue = i >= exclusionStart ? positionsValue * 0.94 : positionsValue;

    points.push({
      date: date.toISOString().slice(0, 10),
      positionsValue: Math.round(displayedPositionsValue * 100) / 100,
      cashValue: Math.round(cashValue * 100) / 100,
      forwardFilled,
      excludedSymbols,
    });
  }

  return points;
}
