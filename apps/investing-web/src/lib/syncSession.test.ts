// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Session = typeof import("./syncSession");

const BROKER = "/api/brokers/sync/status";
const PRICE = "/api/prices/sync/status";
const VAULT = "/api/brokers/credentials/status";

const broker = (status: string) => ({
  status,
  pages: 1,
  ordersRead: 10,
  positionsRead: 2,
  waitUntil: null,
  remaining: null,
  updatedAt: `2026-09-17T10:00:0${status.length % 10}Z`,
  message: null,
  history: null,
});
const price = (status: string) => ({
  status,
  total: 2,
  completed: status === "completed" ? 2 : 1,
  remainingSymbols: [],
  currentSymbol: null,
  waitUntil: null,
  updatedAt: "2026-09-17T10:00:00Z",
  message: null,
  problems: [],
});

type Reply = unknown | { httpStatus: number } | Promise<Response>;

/** Answers each status URL from its own queue; the last entry repeats. */
function statusServer(queues: Record<string, Reply[]>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const queue = queues[url];
    if (!queue) throw new Error(`Unexpected request: ${url}`);
    const reply = queue.length > 1 ? queue.shift() : queue[0];
    if (reply instanceof Promise) return reply;
    if (reply && typeof reply === "object" && "httpStatus" in reply)
      return new Response("", { status: (reply as { httpStatus: number }).httpStatus });
    return new Response(JSON.stringify(reply));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, count: (url: string) => calls.filter((call) => call === url).length };
}

let session: Session;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  session = await import("./syncSession");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("running, HTTP 503, running, completed recovers without a reload", async () => {
  const server = statusServer({
    [BROKER]: [broker("running"), { httpStatus: 503 }, broker("running"), broker("completed")],
    [PRICE]: [price("idle")],
    [VAULT]: [{ status: "unlocked" }],
  });
  const refreshes = vi.fn();
  window.addEventListener("lavega:dashboard-refresh", refreshes);
  const unsubscribe = session.subscribeSyncSession(() => {});

  await vi.advanceTimersByTimeAsync(0);
  expect(session.readSyncSnapshot().broker?.status).toBe("running");
  await vi.advanceTimersByTimeAsync(1_000);
  expect(session.readSyncSnapshot().connection).toBe("retrying");
  expect(session.readSyncSnapshot().broker?.status).toBe("running");
  await vi.advanceTimersByTimeAsync(2_000);
  expect(session.readSyncSnapshot().connection).toBe("online");
  await vi.advanceTimersByTimeAsync(1_000);

  expect(session.readSyncSnapshot()).toMatchObject({
    broker: { status: "completed" },
    connection: "online",
    vault: "unlocked",
  });
  expect(refreshes).toHaveBeenCalledOnce();
  expect(server.count(BROKER)).toBe(4);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(server.count(BROKER)).toBe(4);
  expect(vi.getTimerCount()).toBe(0);
  window.removeEventListener("lavega:dashboard-refresh", refreshes);
  unsubscribe();
});

test("repeated wake during a pending read creates no parallel reads or timers", async () => {
  let answer: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  const server = statusServer({
    [BROKER]: [pending, broker("running")],
    [PRICE]: [price("idle")],
    [VAULT]: [{ status: "unlocked" }],
  });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);

  for (let wake = 0; wake < 5; wake += 1) session.wakeSyncSession();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(server.count(BROKER)).toBe(1);
  expect(vi.getTimerCount()).toBe(0);

  answer(new Response(JSON.stringify(broker("running"))));
  await vi.advanceTimersByTimeAsync(0);
  expect(server.count(BROKER)).toBe(2);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(server.count(BROKER)).toBe(3);
  expect(vi.getTimerCount()).toBe(1);
  unsubscribe();
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["idle", "completed", "problem"])("%s status stops polling", async (status) => {
  const server = statusServer({
    [BROKER]: [broker(status)],
    [PRICE]: [price(status)],
    [VAULT]: [{ status: "unlocked" }],
  });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_000);

  expect(server.count(BROKER)).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  unsubscribe();
});

test("a failed read with no active run stops instead of looping", async () => {
  const server = statusServer({
    [BROKER]: [{ httpStatus: 503 }],
    [PRICE]: [price("idle")],
    [VAULT]: [{ status: "locked" }],
  });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_000);

  expect(server.count(BROKER)).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(session.readSyncSnapshot()).toMatchObject({
    connection: "offline",
    price: { status: "idle" },
    vault: "locked",
  });
  unsubscribe();
});

test("failures during an active run back off and cap the delay", async () => {
  const server = statusServer({
    [BROKER]: [broker("running"), { httpStatus: 503 }],
    [PRICE]: [price("idle")],
    [VAULT]: [{ status: "unlocked" }],
  });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);

  const readTimes: number[] = [];
  for (let second = 1; second <= 200; second += 1) {
    const before = server.count(BROKER);
    await vi.advanceTimersByTimeAsync(1_000);
    if (server.count(BROKER) > before) readTimes.push(second);
  }
  const gaps = readTimes.slice(1).map((time, index) => time - readTimes[index]);
  expect(gaps.slice(0, 5)).toEqual([2, 4, 8, 16, 30]);
  expect(Math.max(...gaps)).toBe(30);
  expect(session.readSyncSnapshot().connection).toBe("retrying");
  unsubscribe();
});

test("one subscriber leaving keeps polling for the others", async () => {
  const server = statusServer({
    [BROKER]: [broker("running")],
    [PRICE]: [price("idle")],
    [VAULT]: [{ status: "unlocked" }],
  });
  const first = session.subscribeSyncSession(() => {});
  const second = vi.fn();
  const unsubscribeSecond = session.subscribeSyncSession(second);
  await vi.advanceTimersByTimeAsync(0);

  first();
  const before = server.count(BROKER);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(server.count(BROKER)).toBe(before + 3);
  expect(second).toHaveBeenCalled();

  unsubscribeSecond();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(server.count(BROKER)).toBe(before + 3);
  expect(vi.getTimerCount()).toBe(0);
});

test("a broker start resumes price sync once even when callers overlap", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/brokers/sync?force=true")
      return new Response(JSON.stringify({ problems: [] }));
    if (String(input) === "/api/prices/sync")
      return new Response(JSON.stringify(price("completed")));
    throw new Error(`Unexpected request: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await Promise.all([session.startBrokerSync(true), session.startBrokerSync(true)]);
  await vi.advanceTimersByTimeAsync(0);

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenCalledWith("/api/brokers/sync?force=true", { method: "POST" });
  expect(fetchMock).toHaveBeenCalledWith("/api/prices/sync", { method: "POST" });
  expect(session.readSyncSnapshot().price?.status).toBe("completed");
});

test("price rounds that run out leave a visible incomplete result", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(price("paused")), { status: 202 })),
  );

  const outcome = await session.continuePriceSync();

  expect(outcome.kind).toBe("incomplete");
  expect(session.readSyncSnapshot().priceProblem).toBe(
    "Price history is still loading after 40 rounds. Start sync again to continue.",
  );
});

test("a stale paused price row with a subscriber stops polling", async () => {
  const server = statusServer({
    [BROKER]: [broker("idle")],
    [PRICE]: [price("paused")],
    [VAULT]: [{ status: "unlocked" }],
  });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_000);

  expect(session.readSyncSnapshot().price?.status).toBe("paused");
  expect(server.count(PRICE)).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  unsubscribe();
});

test("an exhausted price run with a subscriber stops polling afterwards", async () => {
  const server = statusServer({
    [BROKER]: [broker("idle")],
    [PRICE]: [price("paused")],
    [VAULT]: [{ status: "unlocked" }],
    "/api/prices/sync": [price("paused")],
  });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);

  const outcome = await session.continuePriceSync();
  expect(outcome.kind).toBe("incomplete");
  await vi.advanceTimersByTimeAsync(0);
  const afterRun = server.count(PRICE);
  await vi.advanceTimersByTimeAsync(60_000);

  expect(server.count(PRICE)).toBe(afterRun);
  expect(vi.getTimerCount()).toBe(0);
  unsubscribe();
});

test("each price round invalidates the dashboard once, including the final one", async () => {
  statusServer({
    [BROKER]: [broker("idle")],
    [PRICE]: [price("idle")],
    [VAULT]: [{ status: "unlocked" }],
    "/api/prices/sync": [price("paused"), price("paused"), price("completed")],
  });
  const refreshes = vi.fn();
  window.addEventListener("lavega:dashboard-refresh", refreshes);

  const outcome = await session.continuePriceSync();

  expect(outcome.kind).toBe("finished");
  expect(refreshes).toHaveBeenCalledTimes(3);
  window.removeEventListener("lavega:dashboard-refresh", refreshes);
});
