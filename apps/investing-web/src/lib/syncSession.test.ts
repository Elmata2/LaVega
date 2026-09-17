import { afterEach, expect, test, vi } from "vitest";
import { startBrokerSync } from "./syncSession";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("a broker start resumes price sync once even when callers overlap", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/brokers/sync?force=true")
      return new Response(JSON.stringify({ problems: [] }));
    if (String(input) === "/api/prices/sync")
      return new Response(
        JSON.stringify({
          status: "completed",
          total: 2,
          completed: 2,
          remainingSymbols: [],
          currentSymbol: null,
          waitUntil: null,
          updatedAt: "2026-09-17T10:00:00Z",
          message: null,
          problems: [],
        }),
      );
    throw new Error(`Unexpected request: ${String(input)}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await Promise.all([startBrokerSync(true), startBrokerSync(true)]);
  await Promise.resolve();
  await Promise.resolve();

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenCalledWith("/api/brokers/sync?force=true", { method: "POST" });
  expect(fetchMock).toHaveBeenCalledWith("/api/prices/sync", { method: "POST" });
});
