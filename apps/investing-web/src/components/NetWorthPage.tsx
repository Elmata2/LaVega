import { useDashboard } from "../lib/dashboardResource.js";
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
  if (state.status === "loading") return <Loading />;
  if (state.status === "error")
    return <EmptyState title="Dashboard unavailable" description={state.message} />;
  return <NetWorthChart data={state.data.portfolio} currency={state.data.presentationCurrency} />;
}
