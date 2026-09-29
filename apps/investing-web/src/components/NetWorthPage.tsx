import { useMemo } from "react";
import { PORTFOLIO_RANGES, mergeInPersonalNetWorth, type PortfolioRange } from "@lavega/core";
import { useDashboard } from "../lib/dashboardResource.js";
import { usePersonalNetWorthTotals } from "../lib/personalNetWorthResource.js";
import { NetWorthChart } from "./NetWorthChart.js";
import { EmptyState } from "./EmptyState.js";

function Loading() {
  return (
    <div
      role="status"
      className="rounded-card border border-border bg-secondary/30 p-6 text-sm text-muted-foreground"
    >
      Loading dashboard…
    </div>
  );
}

export function NetWorthPage() {
  const state = useDashboard();
  /* The owner's opted-in Personal totals — a separate, uncached read
   * (personalNetWorthResource.ts), not part of InvestingDashboardData. An
   * owner who has never shared anything gets [] here, which is exactly what
   * makes every range's merge a no-op and the chart render unchanged. */
  const personalTotals = usePersonalNetWorthTotals();
  const portfolio = state.status === "ready" ? state.data.portfolio : undefined;
  const netWorthData = useMemo(() => {
    if (!portfolio) return undefined;
    const merged: Partial<Record<PortfolioRange, ReturnType<typeof mergeInPersonalNetWorth>["points"]>> =
      {};
    for (const range of PORTFOLIO_RANGES)
      merged[range] = mergeInPersonalNetWorth(portfolio[range], personalTotals).points;
    return merged;
  }, [portfolio, personalTotals]);
  const latestPersonalDate = useMemo(
    () => mergeInPersonalNetWorth([], personalTotals).latestPersonalDate,
    [personalTotals],
  );

  if (state.status === "loading") return <Loading />;
  if (state.status === "error")
    return <EmptyState title="Dashboard unavailable" description={state.message} />;
  return (
    <NetWorthChart
      data={netWorthData!}
      currency={state.data.presentationCurrency}
      personalAsOfDate={latestPersonalDate}
    />
  );
}
