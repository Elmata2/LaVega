import type { CashHistoryCoverage, Position } from "@lavega/core";
import {
  deGiroStaleProblems,
  type DeGiroDataState,
  type InvestingDashboardData,
} from "@lavega/core";

/** The facts the dashboard read already holds for DeGiro, without cloning the
 *  whole broker snapshot. */
export type DeGiroStoredFacts = {
  positions: readonly Position[];
  cashHistory?: CashHistoryCoverage | undefined;
  lastImport?: { importedAt: string; files: { filename: string; sha256: string }[] } | undefined;
};

/** The latest dated holding of the stored import. null when the snapshot has
 *  no dated position, which is a real answer: an account-statement-only import
 *  has no holdings. */
function latestPositionDay(positions: readonly Position[]): string | null {
  return positions.reduce<string | null>((latest, position) => {
    const day = position.asOf.slice(0, 10);
    if (day === "") return latest;
    return latest === null || day > latest ? day : latest;
  }, null);
}

/** The dates the dashboard publishes for one tenant's stored DeGiro import.
 *  null means no import was ever committed; every field in the value is then
 *  null-or-dated, never invented. */
export function deGiroDataState(facts: DeGiroStoredFacts): DeGiroDataState {
  const coverage = facts.cashHistory;
  return {
    importedAt: facts.lastImport?.importedAt ?? null,
    coversFrom: coverage?.status === "complete" ? coverage.from : null,
    coversTo: coverage?.status === "complete" ? coverage.to : null,
    positionsAsOf: latestPositionDay(facts.positions),
  };
}

/** Serves a dashboard with the DeGiro dates, and with the stale-data problem
 *  recomputed for this read. The problem is deliberately not stored: a
 *  dashboard built on day 10 must warn on day 31 even when its snapshot is
 *  served from the cache. `fallback` covers a dashboard stored before the
 *  dates existed; the stored copy wins when it already carries them. */
export function withDeGiroFreshness(
  dashboard: InvestingDashboardData,
  fallback: DeGiroDataState | null,
  today: string,
): InvestingDashboardData {
  const degiro = dashboard.degiro ?? fallback;
  if (degiro === null) return dashboard;
  const problems = deGiroStaleProblems(degiro, today);
  return {
    ...dashboard,
    degiro,
    problems: [...new Set([...dashboard.problems, ...problems])],
  };
}
