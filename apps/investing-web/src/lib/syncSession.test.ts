// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { syncStateBody } from "../test/fetchFixtures";

type Session = typeof import("./syncSession");

/** The test's copy of the state body: widened so helper cases may set any
 *  lane status or timestamp without re-typing the schema's literals. */
type Lane = {
  status: string;
  syncedAt: string | null;
  waitUntil: string | null;
  message: string | null;
};
type State = {
  active: boolean;
  vault: string;
  holdings: Lane & { positionsRead: number };
  history: Lane & { pages: number; ordersRead: number; historyProgress: unknown };
  prices: Lane & {
    total: number;
    completed: number;
    currentSymbol: string | null;
    remainingSymbols: string[];
  };
  problems: string[];
  run: { id: string | null; hop: number; outcome: string | null };
};

const lane = (status: string, syncedAt: string | null = null) => ({
  status,
  syncedAt,
  waitUntil: null,
  message: null,
});

const state = (over: Partial<State> = {}): State => ({
  ...(syncStateBody() as unknown as State),
  ...over,
});

const running = (over: Partial<State> = {}) =>
  state({
    active: true,
    holdings: { ...lane("running"), positionsRead: 2 },
    history: { ...lane("running"), pages: 1, ordersRead: 10, historyProgress: null },
    run: { id: "run-1", hop: 0, outcome: null },
    ...over,
  });

const done = (over: Partial<State> = {}) =>
  state({
    active: false,
    holdings: { ...lane("completed", "2026-09-17T10:00:01Z"), positionsRead: 2 },
    history: {
      ...lane("completed", "2026-09-17T10:00:02Z"),
      pages: 3,
      ordersRead: 30,
      historyProgress: null,
    },
    prices: {
      status: "completed",
      syncedAt: "2026-09-17T10:00:03Z",
      waitUntil: null,
      message: null,
      total: 2,
      completed: 2,
      currentSymbol: null,
      remainingSymbols: [],
    },
    run: { id: "run-1", hop: 0, outcome: "done" },
    ...over,
  });

type Reply = unknown | { httpStatus: number } | Promise<Response>;

/** Answers `GET /api/sync/state` (and the refresh POST) from queues; the last
 *  entry repeats. Any other URL is recorded and fails loudly. */
function stateServer(queues: { state?: Reply[]; refresh?: Reply[] } = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const queue =
      url === "/api/sync/refresh" && init?.method === "POST" ? queues.refresh : queues.state;
    if (!queue || queue.length === 0) throw new Error(`Unexpected request: ${url}`);
    const reply = queue.length > 1 ? queue.shift()! : queue[0];
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

test("an active run reads exactly one state per two seconds and stops when it ends", async () => {
  const server = stateServer({
    state: [running(), running(), running(), done()],
  });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);
  expect(session.readSyncSnapshot().broker?.status).toBe("running");

  await vi.advanceTimersByTimeAsync(2_000);
  await vi.advanceTimersByTimeAsync(2_000);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(server.count("/api/sync/state")).toBe(4);
  expect(session.readSyncSnapshot().broker?.status).toBe("completed");

  // The run is done: no further read, and no timer left behind.
  await vi.advanceTimersByTimeAsync(60_000);
  expect(server.count("/api/sync/state")).toBe(4);
  expect(vi.getTimerCount()).toBe(0);
  // Never a per-second poll, never the old three status routes.
  expect(server.calls.every((url) => url === "/api/sync/state")).toBe(true);
  unsubscribe();
});

test("an inactive state on the first read stops immediately", async () => {
  const server = stateServer({ state: [state()] });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(server.count("/api/sync/state")).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(session.readSyncSnapshot()).toMatchObject({
    broker: { status: "idle", positionsRead: 0 },
    price: { status: "idle" },
    vault: "unlocked",
    connection: "online",
  });
  unsubscribe();
});

test("each lane completion fires the dashboard refresh once", async () => {
  const first = running();
  const holdingsDone = running({
    holdings: { ...lane("completed", "2026-09-17T10:00:01Z"), positionsRead: 2 },
  });
  const historyDone = running({
    holdings: holdingsDone.holdings,
    history: {
      ...lane("completed", "2026-09-17T10:00:02Z"),
      pages: 3,
      ordersRead: 30,
      historyProgress: null,
    },
  });
  const pricesDone = done({ holdings: holdingsDone.holdings, history: historyDone.history });
  stateServer({ state: [first, holdingsDone, historyDone, pricesDone] });
  const refreshes = vi.fn();
  window.addEventListener("lavega:dashboard-refresh", refreshes);
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(2_000);
  await vi.advanceTimersByTimeAsync(2_000);
  await vi.advanceTimersByTimeAsync(2_000);

  expect(refreshes).toHaveBeenCalledTimes(3);
  window.removeEventListener("lavega:dashboard-refresh", refreshes);
  unsubscribe();
});

test("one refresh intent: overlapping callers share one POST and start the poll", async () => {
  const server = stateServer({
    refresh: [{ ...running(), claimed: true }],
    state: [running(), running(), done()],
  });
  const unsubscribe = session.subscribeSyncSession(() => {});
  const [first, second] = await Promise.all([
    session.requestRefresh(true),
    session.requestRefresh(true),
  ]);
  expect(server.count("/api/sync/refresh")).toBe(1);
  expect(first).toEqual({ problems: [] });
  expect(second).toEqual({ problems: [] });
  const posted = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
    ([url]) => String(url) === "/api/sync/refresh",
  );
  expect(posted?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ force: true }) });
  expect(session.readSyncSnapshot().broker?.status).toBe("running");

  await vi.advanceTimersByTimeAsync(0);
  for (
    let step = 0;
    step < 10 && session.readSyncSnapshot().broker?.status !== "completed";
    step += 1
  ) {
    await vi.advanceTimersByTimeAsync(2_000);
  }
  expect(session.readSyncSnapshot().broker?.status).toBe("completed");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(vi.getTimerCount()).toBe(0);
  expect(server.count("/api/sync/refresh")).toBe(1);
  expect(server.count("/api/sync/state")).toBeGreaterThan(0);
  expect(server.calls.some((url) => url.includes("/api/brokers/sync"))).toBe(false);
  expect(server.calls.some((url) => url.includes("/api/prices/sync"))).toBe(false);
  unsubscribe();
});

test("a refresh that the server refuses returns its problems and starts nothing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ problems: ["CRON_SECRET is not set"] }), { status: 500 }),
    ),
  );
  const result = await session.requestRefresh(false);
  expect(result).toEqual({ problems: ["CRON_SECRET is not set"] });
  expect(vi.getTimerCount()).toBe(0);
});

test("a failed read while a run was active backs off and caps the delay", async () => {
  stateServer({ state: [running(), { httpStatus: 503 }] });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);

  const readTimes: number[] = [];
  for (let second = 1; second <= 200; second += 1) {
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(1_000);
    if ((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length > before) {
      readTimes.push(second);
    }
  }
  const gaps = readTimes.slice(1).map((time, index) => time - readTimes[index]);
  expect(gaps.slice(0, 5)).toEqual([4, 8, 16, 30, 30]);
  expect(Math.max(...gaps)).toBe(30);
  expect(session.readSyncSnapshot().connection).toBe("retrying");
  unsubscribe();
});

test("a failed read with no run stops and reads as offline", async () => {
  const server = stateServer({ state: [{ httpStatus: 503 }] });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(server.count("/api/sync/state")).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(session.readSyncSnapshot().connection).toBe("offline");
  unsubscribe();
});

test("a state body the schema rejects is a failed read, not a broken render", async () => {
  const server = stateServer({ state: [{ active: "yes" }] });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);
  expect(session.readSyncSnapshot().connection).toBe("offline");
  expect(server.count("/api/sync/state")).toBe(1);
  unsubscribe();
});

test("repeated wake during a pending read creates no parallel reads or timers", async () => {
  let answer: (response: Response) => void = () => {};
  const pending = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  const server = stateServer({ state: [pending, running(), done()] });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);

  for (let wake = 0; wake < 5; wake += 1) session.wakeSyncSession();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(server.count("/api/sync/state")).toBe(1);
  expect(vi.getTimerCount()).toBe(0);

  answer(new Response(JSON.stringify(running())));
  await vi.advanceTimersByTimeAsync(0);
  expect(server.count("/api/sync/state")).toBe(2);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(server.count("/api/sync/state")).toBe(3);
  unsubscribe();
  expect(vi.getTimerCount()).toBe(0);
});

test("one subscriber leaving keeps polling for the others", async () => {
  const server = stateServer({ state: [running()] });
  const first = session.subscribeSyncSession(() => {});
  const second = vi.fn();
  const unsubscribeSecond = session.subscribeSyncSession(second);
  await vi.advanceTimersByTimeAsync(0);

  first();
  const before = server.count("/api/sync/state");
  await vi.advanceTimersByTimeAsync(6_000);
  expect(server.count("/api/sync/state")).toBe(before + 3);
  expect(second).toHaveBeenCalled();

  unsubscribeSecond();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(server.count("/api/sync/state")).toBe(before + 3);
  expect(vi.getTimerCount()).toBe(0);
});

test("the snapshot keeps the old shape from the one state body", async () => {
  stateServer({
    state: [
      running({
        vault: "locked",
        problems: ["prices: Yahoo Finance is not connected"],
        prices: {
          status: "problem",
          syncedAt: null,
          waitUntil: null,
          message: "Price history could not be updated.",
          total: 5,
          completed: 2,
          currentSymbol: "ASML",
          remainingSymbols: ["AAPL", "MSFT", "IWDA.AS"],
        },
      }),
    ],
  });
  const unsubscribe = session.subscribeSyncSession(() => {});
  await vi.advanceTimersByTimeAsync(0);
  expect(session.readSyncSnapshot()).toMatchObject({
    broker: {
      status: "running",
      pages: 1,
      ordersRead: 10,
      positionsRead: 2,
      history: null,
    },
    price: {
      status: "problem",
      total: 5,
      completed: 2,
      currentSymbol: "ASML",
      remainingSymbols: ["AAPL", "MSFT", "IWDA.AS"],
    },
    priceProblem: "Price history could not be updated.",
    vault: "locked",
    connection: "online",
  });
  unsubscribe();
});

test("filterVisibleSyncProblems hides an unconfigured broker only", () => {
  expect(
    session.filterVisibleSyncProblems([
      "trading212: credentials are not configured",
      "prices: rate limited",
    ]),
  ).toEqual(["prices: rate limited"]);
});
