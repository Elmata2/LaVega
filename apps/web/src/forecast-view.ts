import type { Driver, EntityForecast, ForecastConfidence } from "@lavega/core";
import { formatWholeEuroIn } from "./format.js";
import type { Locale } from "./locale.js";
import { moneyCopy } from "./copy/money.js";

/* Tiny pure presentational mappings for views/Forecast.tsx, split out so they
 * can be unit-tested without rendering JSX (mirrors the split already used by
 * Overzicht's derivations in overzicht.test.ts). No formatting/JSX here —
 * just data-shape decisions the component then renders.
 *
 * The forecast is the one screen LaVega is judged against a spreadsheet on, and
 * a spreadsheet never pretends. So the copy this module produces is written to
 * one rule: say what the projection is built on, and refuse the sentence the
 * data cannot carry. */

export type BannerState = "shortfall" | "unknown" | "insufficient" | "none";

/** Maps an `EntityForecast` to the shortfall banner's color/copy state.
 *
 *  A real shortfall always wins (red) even though, per the engine, it can only
 *  ever be set once `openingCents` is known. An unknown opening balance is next
 *  (neutral — no saldo line to reason about). Then "insufficient": the engine
 *  found nothing to project from, so the line is just today's balance drawn
 *  flat — and calling that "geen tekort verwacht in de komende 13 weken" is a
 *  promise made out of no evidence, which is exactly the failure this codebase
 *  keeps hunting. Only a projection with something behind it gets the green. */
export function bannerState(
  f: Pick<EntityForecast, "openingCents" | "shortfall" | "basis">,
): BannerState {
  if (f.shortfall !== null) return "shortfall";
  if (f.openingCents === null) return "unknown";
  if (f.basis && f.basis.confidence === "none") return "insufficient";
  return "none";
}

/** True when no recurring stream is currently RUNNING — too little history for
 *  a trustworthy forecast. Streams that were detected but have stopped do not
 *  count: they are evidence about the past, not about the next 13 weeks.
 *  Falls back to the raw stream list for forecasts written by hand. */
export function isThinData(f: Pick<EntityForecast, "streams" | "basis">): boolean {
  return (f.basis ? f.basis.liveStreamCount : f.streams.length) === 0;
}

/** Whether any weekly point carries a band with actual width. A band of zero
 *  width is a measurement ("these amounts never varied"), not a drawing. */
export function hasBand(f: Pick<EntityForecast, "points">): boolean {
  return f.points.some(
    (p) => p.lowerCents !== null && p.upperCents !== null && p.upperCents !== p.lowerCents,
  );
}

/** Label for the engine's confidence grade. Deliberately plain words: a
 *  percentage here would claim a precision the grade does not have. */
export function confidenceLabel(locale: Locale, c: ForecastConfidence): string {
  return moneyCopy[locale].forecast.coverage.confidence[c];
}

/** Whole days from ISO `a` to ISO `b`. Same Date.UTC arithmetic the engine uses
 *  — `new Date(str)` is locale/TZ-dependent and must not decide copy. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const euro = (locale: Locale, cents: number): string =>
  formatWholeEuroIn(locale, cents / 100);

/** How many days behind `asOf` the newest transaction may be before the data
 *  itself is worth mentioning. Two weeks: shorter than a payment cycle, long
 *  enough that a weekly import does not nag. */
const STALE_IMPORT_DAYS = 14;

export type CoverageNote = { id: string; text: string };

/** The sentences that make this projection checkable: what it was built on, and
 *  every place the data runs out. Returned as a list rather than one paragraph
 *  so the view can render them plainly and so each one can be tested on its own.
 *
 *  Empty for a forecast with no `basis` (hand-written fixtures) — silence is
 *  correct there; inventing a coverage claim would be the very thing this is
 *  meant to prevent. */
export function coverageNotes(locale: Locale, f: EntityForecast): CoverageNote[] {
  const b = f.basis;
  if (!b) return [];
  const t = moneyCopy[locale].forecast.coverage;
  const notes: CoverageNote[] = [];

  if (b.confidence === "none") {
    notes.push({ id: "no-evidence", text: t.noEvidence });
  } else if (b.historyDays === 0) {
    notes.push({ id: "flows-only", text: t.flowsOnly(b.projectedFlowCount) });
  } else {
    const parts = [t.historyWindow(b.historyDays, b.firstTxDate, b.lastTxDate)];
    parts.push(t.liveStreams(b.liveStreamCount));
    if (b.projectedFlowCount > 0) parts.push(t.scheduledItems(b.projectedFlowCount));
    notes.push({ id: "basis", text: t.basedOn(parts.join(", ")) });
  }

  if (b.accountsTotal > 0 && b.accountsWithHistory < b.accountsTotal) {
    const missing = b.accountsTotal - b.accountsWithHistory;
    notes.push({
      id: "accounts-without-history",
      text: t.accountsWithoutHistory(missing, b.accountsTotal),
    });
  }

  // Relative, not against a fixed threshold: the point is that ONE account is
  // far shorter than the picture the totals suggest, and repeating the engine's
  // own constant here would be a second place to keep it in step.
  if (
    b.accountsWithHistory > 1 &&
    b.shortestAccountDays !== null &&
    b.shortestAccountDays * 2 < b.historyDays
  ) {
    notes.push({ id: "short-account", text: t.shortAccount(b.shortestAccountDays) });
  }

  if (!b.incidentalIncluded && b.historyDays > 0) {
    notes.push({ id: "no-incidental", text: t.noIncidental });
  }

  if (b.bandBasis === "none") {
    notes.push({ id: "no-band", text: t.noBand });
  } else if (!hasBand(f)) {
    notes.push({ id: "flat-band", text: t.flatBand });
  }

  if (b.endedStreams.length > 0) {
    const names = b.endedStreams.map((s) => s.counterparty).join(", ");
    notes.push({ id: "ended-streams", text: t.endedStreams(names) });
  }

  if (b.overdueFlowCount > 0) {
    notes.push({
      id: "overdue-flows",
      text: t.overdueFlows(b.overdueFlowCount, euro(locale, Math.abs(b.overdueFlowsCents))),
    });
  }

  if (b.lastTxDate) {
    const stale = daysBetween(b.lastTxDate, f.asOf);
    if (stale > STALE_IMPORT_DAYS) {
      notes.push({ id: "stale-import", text: t.staleImport(b.lastTxDate, stale) });
    }
  }

  return notes;
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
