/**
 * Phase durations for one request, sent back as a `Server-Timing` header so
 * the browser's network panel and `/verify-investing` can see where the time
 * went. A phase that did not run is absent, which is how the header tells a
 * stored dashboard from a built one.
 */
export type ServerTiming = {
  measure<T>(name: string, run: () => T | Promise<T>): Promise<T>;
  header(): string;
};

export function createServerTiming(now: () => number = () => performance.now()): ServerTiming {
  const entries: string[] = [];
  return {
    async measure(name, run) {
      const start = now();
      try {
        return await run();
      } finally {
        entries.push(`${name};dur=${(now() - start).toFixed(1)}`);
      }
    },
    header: () => entries.join(", "),
  };
}

/** For callers that read the dashboard without answering a request. */
export const untimed: ServerTiming = {
  measure: async (_name, run) => run(),
  header: () => "",
};
