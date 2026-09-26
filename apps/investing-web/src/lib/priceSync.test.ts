import { afterEach, expect, test, vi } from "vitest";
import { PRICE_SYNC_EXHAUSTED_MESSAGE, runPriceSyncUntilComplete } from "./priceSync";

const progress = (status: string, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      status,
      total: 2,
      completed: 1,
      remainingSymbols: ["TWO"],
      currentSymbol: null,
      waitUntil: null,
      updatedAt: "2026-09-03T10:00:00Z",
      message: null,
      problems: [],
      ...extra,
    }),
    { status: status === "paused" ? 202 : 200 },
  );
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("keeps asking while the server pauses on its time budget", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(progress("paused"))
    .mockResolvedValueOnce(progress("paused"))
    .mockResolvedValueOnce(progress("completed", { completed: 2, remainingSymbols: [] }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  const rounds: string[] = [];
  await expect(
    runPriceSyncUntilComplete((progress) => rounds.push(progress.status)),
  ).resolves.toEqual({ kind: "finished", problems: [] });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock).toHaveBeenCalledWith("/api/prices/sync", { method: "POST" });
  expect(rounds).toEqual(["paused", "paused", "completed"]);
});

test("joins an active server run, then starts a fresh discovery", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(progress("running"))
    .mockResolvedValueOnce(progress("completed", { completed: 2, remainingSymbols: [] }))
    .mockResolvedValueOnce(progress("completed", { completed: 1, remainingSymbols: [] }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await expect(runPriceSyncUntilComplete()).resolves.toEqual({ kind: "finished", problems: [] });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "/api/prices/sync",
    "/api/prices/sync/status",
    "/api/prices/sync",
  ]);
});

test("stops at the first terminal answer and reports its problems", async () => {
  const fetchMock = vi.fn().mockResolvedValue(progress("problem", { problems: ["ASML: failed"] }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await expect(runPriceSyncUntilComplete()).resolves.toEqual({
    kind: "finished",
    problems: ["ASML: failed"],
  });
  expect(fetchMock).toHaveBeenCalledOnce();
});

test("missing Yahoo consent is an answer, not a failure to retry", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ consentRequired: true }), { status: 428 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await expect(runPriceSyncUntilComplete()).resolves.toEqual({ kind: "finished", problems: [] });
  expect(fetchMock).toHaveBeenCalledOnce();
});

test("a cut-off round is picked up again instead of read as a failure", async () => {
  const fetchMock = vi
    .fn()
    // Cloudflare kapt af terwijl de server doorwerkt en zijn voortgang bewaart.
    .mockResolvedValueOnce(new Response("<html>timeout</html>", { status: 524 }))
    .mockResolvedValueOnce(progress("completed", { completed: 2, remainingSymbols: [] }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await expect(runPriceSyncUntilComplete()).resolves.toEqual({ kind: "finished", problems: [] });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("a server that keeps failing is reported rather than hammered", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await expect(runPriceSyncUntilComplete()).resolves.toEqual({
    kind: "failed",
    message: "Price history could not be updated.",
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test("reports when bounded continuation cannot finish", async () => {
  const fetchMock = vi.fn(() => Promise.resolve(progress("paused")));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await expect(runPriceSyncUntilComplete()).resolves.toEqual({
    kind: "incomplete",
    message: PRICE_SYNC_EXHAUSTED_MESSAGE,
  });
  expect(fetchMock).toHaveBeenCalledTimes(40);
});
