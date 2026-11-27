import type { AgentApi, AgentFeedLoad } from "../api.js";

/* The first page of the feed channel, read once and shared. The Assistent panel
 * and the `meldingen` view both want it; this makes them one request, not two.
 * One in-flight request is shared, an "ok" answer stays fresh for a minute, and
 * anything else (failure, 503, signed out) is never kept, so a retry asks again.
 * No polling: nothing here runs on a timer. */

export const FEED_PAGE = 20;
const FRESH_MS = 60_000;

export type FeedStore = {
  firstPage(opts?: { force?: boolean }): Promise<AgentFeedLoad>;
  /** Forget the kept answer (after a delete, say). */
  invalidate(): void;
  /** Called after every invalidate; returns the stop function. */
  subscribe(listener: () => void): () => void;
};

export function createFeedStore(api: AgentApi, freshMs = FRESH_MS): FeedStore {
  let inflight: Promise<AgentFeedLoad> | null = null;
  const listeners = new Set<() => void>();
  let kept: { at: number; result: AgentFeedLoad } | null = null;
  return {
    firstPage({ force = false } = {}) {
      if (!force && kept && Date.now() - kept.at < freshMs) return Promise.resolve(kept.result);
      if (!force && inflight) return inflight;
      kept = null;
      const request = api.listFeed({ channel: "feed", limit: FEED_PAGE }).then(
        (result) => {
          if (inflight === request) {
            inflight = null;
            if (result.kind === "ok") kept = { at: Date.now(), result };
          }
          return result;
        },
        (error) => {
          if (inflight === request) inflight = null;
          throw error;
        },
      );
      inflight = request;
      return request;
    },
    invalidate() {
      kept = null;
      inflight = null;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
