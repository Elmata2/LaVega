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

/** How one price-sync continuation ended. "finished" covers every answer the
 * server considers final for this caller: done, done with symbol problems,
 * or consent missing. "incomplete" means the
 * server still had work after the last allowed round. */
export type PriceSyncOutcome =
  | { kind: "finished"; problems: string[] }
  | { kind: "incomplete"; message: string }
  | { kind: "failed"; message: string };

export const DASHBOARD_REFRESH_EVENT = "lavega:dashboard-refresh";

/* Per call the server handles as many symbols as time allows and queues the rest; work that continues after the response does not survive a serverless function. "paused" therefore means: not done yet, ask again. The limit is an emergency brake, not an expectation — each round is shorter than the previous one because already fetched symbols are skipped. */
const MAX_ROUNDS = 40;
export const PRICE_SYNC_EXHAUSTED_MESSAGE =
  "Price history is still loading after 40 rounds. Start sync again to continue.";
const PRICE_SYNC_FAILED_MESSAGE = "Price history could not be updated.";

/* A round can be cut off before the server answers: Cloudflare closes a request after about 100 seconds (524) while the server keeps working and simply writes away its progress. Asking again picks up that progress. If it keeps failing, it is not a cutoff but an outage. */
const MAX_INTERRUPTIONS = 3;
const MAX_ACTIVE_POLLS = 120;

export function priceOutcomeProblems(outcome: PriceSyncOutcome): string[] {
  return outcome.kind === "finished" ? outcome.problems : [outcome.message];
}

/** Keeps requesting price sync until the server is done. `onProgress` sees
 * every round the server answered with a progress body. */
export async function runPriceSyncUntilComplete(
  onProgress: (progress: PriceSyncProgress) => void = () => {},
): Promise<PriceSyncOutcome> {
  const failed: PriceSyncOutcome = { kind: "failed", message: PRICE_SYNC_FAILED_MESSAGE };
  let interruptions = 0;
  let activePolls = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const response = await fetch("/api/prices/sync", { method: "POST" }).catch(() => null);
    // Without Yahoo consent, fetching nothing is the right answer, not an error.
    if (response?.status === 428) return { kind: "finished", problems: [] };
    if (response && response.status >= 400 && response.status < 500) return failed;
    const progress = response
      ? ((await response.json().catch(() => null)) as PriceSyncProgress | null)
      : null;
    if (progress) onProgress(progress);
    if (!response?.ok && response?.status !== 202) {
      interruptions += 1;
      if (interruptions >= MAX_INTERRUPTIONS) return failed;
      continue;
    }
    if (progress?.status === "paused") continue;
    if (progress?.status === "running" || progress?.status === "waiting") {
      let active = true;
      while (activePolls < MAX_ACTIVE_POLLS) {
        activePolls += 1;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        const statusResponse = await fetch("/api/prices/sync/status").catch(() => null);
        if (!statusResponse?.ok) {
          interruptions += 1;
          if (interruptions >= MAX_INTERRUPTIONS) return failed;
          continue;
        }
        const status = (await statusResponse.json().catch(() => null)) as PriceSyncProgress | null;
        if (status) onProgress(status);
        if (status?.status !== "running" && status?.status !== "waiting") {
          active = false;
          break;
        }
      }
      if (active)
        return { kind: "incomplete", message: PRICE_SYNC_EXHAUSTED_MESSAGE };
      continue;
    }
    /* Only a completed run has problems to report. */
    return {
      kind: "finished",
      problems:
        progress?.status === "completed" || progress?.status === "problem" ? progress.problems : [],
    };
  }
  return { kind: "incomplete", message: PRICE_SYNC_EXHAUSTED_MESSAGE };
}
