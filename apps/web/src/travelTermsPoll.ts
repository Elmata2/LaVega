import type { ProviderTerms } from "./api.js";

export type TravelTermsPollState =
  | { status: "idle" }
  | { status: "polling"; pending: string[]; asked: number }
  | { status: "gave-up"; pending: string[]; asked: number };

export function sleepAbortable(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runTravelTermsPoll(params: {
  signal: AbortSignal;
  isStale: () => boolean;
  pollMs: number;
  ceilingMs: number;
  now?: () => number;
  fetchTerms: (signal: AbortSignal) => Promise<{ terms: ProviderTerms[]; pending: string[] }>;
  onTerms: (terms: ProviderTerms[]) => Promise<void>;
  onPending: (pending: string[]) => void;
  onGiveUp: () => void;
}): Promise<void> {
  const now = params.now ?? Date.now;
  const until = now() + params.ceilingMs;
  while (now() < until) {
    const waited = await sleepAbortable(params.pollMs, params.signal);
    if (!waited || params.signal.aborted || params.isStale()) return;
    let reply: { terms: ProviderTerms[]; pending: string[] };
    try {
      reply = await params.fetchTerms(params.signal);
    } catch {
      return;
    }
    if (params.signal.aborted || params.isStale()) return;
    if (reply.terms.length > 0) {
      await params.onTerms(reply.terms);
    }
    if (params.signal.aborted || params.isStale()) return;
    params.onPending(reply.pending);
    if (reply.pending.length === 0) return;
  }
  if (!params.signal.aborted && !params.isStale()) {
    params.onGiveUp();
  }
}
