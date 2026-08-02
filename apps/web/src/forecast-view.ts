import type { Driver, EntityForecast } from "@lavega/core";

/* Tiny pure presentational mappings for views/Forecast.tsx, split out so they
 * can be unit-tested without rendering JSX (mirrors the split already used by
 * Overzicht's derivations in overzicht.test.ts). No formatting/JSX here —
 * just data-shape decisions the component then renders. */

export type BannerState = "shortfall" | "unknown" | "none";

/** Maps an `EntityForecast` to the shortfall banner's color/copy state.
 *  A real shortfall always wins (red) even though, per the engine, it can
 *  only ever be set once `openingCents` is known; an unknown opening
 *  balance is next (neutral — no saldo line to reason about); otherwise
 *  "none" ("geen tekort verwacht", green). */
export function bannerState(f: Pick<EntityForecast, "openingCents" | "shortfall">): BannerState {
  if (f.shortfall !== null) return "shortfall";
  if (f.openingCents === null) return "unknown";
  return "none";
}

/** True when no recurring stream was detected at all — too little history
 *  for a trustworthy forecast. Surfaced as an extra caveat line in the
 *  banner regardless of its color. */
export function isThinData(f: Pick<EntityForecast, "streams">): boolean {
  return f.streams.length === 0;
}

export type SplitDrivers = { inkomsten: Driver[]; uitgaven: Driver[] };

/** Partitions the engine's ranked driver list into the drivers card's two
 *  sections. Each partition keeps the engine's own ordering (already sorted
 *  by |perWeekCents| descending). */
export function splitDrivers(drivers: Driver[]): SplitDrivers {
  return {
    inkomsten: drivers.filter((d) => d.sign === 1),
    uitgaven: drivers.filter((d) => d.sign === -1),
  };
}
