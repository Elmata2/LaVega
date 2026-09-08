export type PriceSyncProgress = {
  status: "idle" | "running" | "waiting" | "paused" | "completed" | "problem";
  total: number;
  completed: number;
  remainingSymbols: string[];
  currentSymbol: string | null;
  waitUntil: string | null;
  updatedAt: string | null;
  message: string | null;
  problems: string[];
};

export const DASHBOARD_REFRESH_EVENT = "lavega:dashboard-refresh";

/* Per call the server handles as many symbols as time allows and queues the rest; work that continues after the response does not survive a serverless function. "paused" therefore means: not done yet, ask again. The limit is an emergency brake, not an expectation — each round is shorter than the previous one because already fetched symbols are skipped. */
const MAX_ROUNDS = 40;

/* A round can be cut off before the server answers: Cloudflare closes a request after about 100 seconds (524) while the server keeps working and simply writes away its progress. Asking again picks up that progress. If it keeps failing, it is not a cutoff but an outage. */
const MAX_INTERRUPTIONS = 3;

/** Keeps requesting price sync until the server is done. */
export async function runPriceSyncUntilComplete(
  current: () => boolean = () => true,
): Promise<string[]> {
  const failed = ["Price history could not be updated."];
  let interruptions = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const response = await fetch("/api/prices/sync", { method: "POST" }).catch(() => null);
    // Without Yahoo consent, fetching nothing is the right answer, not an error.
    if (response?.status === 428) return [];
    if (response && response.status >= 400 && response.status < 500) return failed;
    const progress = response
      ? ((await response.json().catch(() => null)) as PriceSyncProgress | null)
      : null;
    if (!current()) return [];
    if (progress && typeof window !== "undefined")
      window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
    if (!response?.ok && response?.status !== 202) {
      interruptions += 1;
      if (interruptions >= MAX_INTERRUPTIONS) return failed;
      continue;
    }
    if (progress?.status === "paused") continue;
    /* Everything except "paused" is a final answer for this caller: done, or a run already going elsewhere that this page should not duplicate. Only a completed run has problems to report. */
    return progress?.status === "completed" || progress?.status === "problem"
      ? progress.problems
      : [];
  }
  return [];
}
