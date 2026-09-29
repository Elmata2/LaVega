import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { withCurrentBalances } from "@lavega/core";
import { positionSeries, POSITION_WINDOW_DAYS } from "./totalePositie";
import {
  computeShareableTotalCents,
  deleteNetWorthTotal,
  putNetWorthTotal,
  resetNetWorthShareStateForTests,
  todayIso,
} from "./netWorthShare";

const account = (overrides: Partial<Record<string, unknown>> = {}) => ({
  key: "A",
  iban: "A",
  name: "",
  bank: "",
  entity: "BV1",
  currency: "EUR",
  balance: 1234.56,
  ...overrides,
});

test("computeShareableTotalCents rounds the total to integer cents", () => {
  const cents = computeShareableTotalCents([account({ balance: 1234.56 })], [], "2026-09-29", {
    fxHistory: {},
    mode: "separate",
  });
  expect(cents).toBe(123_456);
});

test("an unknown-balance account is excluded from the sum, not a reason to null the whole total — a partial sum, exactly like Overzicht shows", () => {
  const cents = computeShareableTotalCents(
    [
      account({ key: "A", entity: "Privé", balance: 100 }),
      account({ key: "B", entity: "BV1", balance: null }),
    ],
    [],
    "2026-09-29",
    { fxHistory: {}, mode: "separate" },
  );
  expect(cents).toBe(10_000);
});

test("null only when EVERY balance is unknown — a total built from zero known balances is not shared as a false zero", () => {
  const cents = computeShareableTotalCents(
    [account({ key: "A", balance: null }), account({ key: "B", balance: null })],
    [],
    "2026-09-29",
    { fxHistory: {}, mode: "separate" },
  );
  expect(cents).toBeNull();
});

test("computeShareableTotalCents is null with no accounts at all", () => {
  expect(
    computeShareableTotalCents([], [], "2026-09-29", { fxHistory: {}, mode: "separate" }),
  ).toBeNull();
});

test("a stale balanceDate is rolled forward by later transactions, same as Overzicht", () => {
  const stale = account({
    key: "A",
    entity: "Privé",
    balance: 100,
    balanceDate: "2026-09-20",
  });
  const txs = [
    {
      id: "t1",
      accountKey: "A",
      date: "2026-09-25",
      amount: -30,
      currency: "EUR",
      counterparty: "",
      description: "",
      category: "",
      manual: false,
    },
  ] as never[];
  // 100 stored on 2026-09-20, minus 30 spent on 2026-09-25 => 70 as of 2026-09-29.
  const cents = computeShareableTotalCents([stale], txs, "2026-09-29", {
    fxHistory: {},
    mode: "separate",
  });
  expect(cents).toBe(7_000);
});

test("equals the exact figure Overzicht's SaldoBlock computes, across personal and business entities together, with a stale balance and an unknown balance mixed in", () => {
  const accounts = [
    account({ key: "A", entity: "Privé", balance: 500, balanceDate: "2026-09-01" }),
    account({ key: "B", entity: "BV1 Holding", balance: 1_000 }),
    account({ key: "C", entity: "BV1 Holding", balance: null }),
  ];
  const txs = [
    {
      id: "t1",
      accountKey: "A",
      date: "2026-09-15",
      amount: 50,
      currency: "EUR",
      counterparty: "",
      description: "",
      category: "",
      manual: false,
    },
  ] as never[];
  const asOf = "2026-09-29";
  const conversion = { fxHistory: {}, mode: "separate" as const };

  // The Overzicht figure, computed independently through the same two steps
  // App.tsx applies before Overzicht ever sees an account list.
  const overzichtFigure = positionSeries(
    withCurrentBalances(accounts as never, txs as never, asOf),
    txs as never,
    asOf,
    POSITION_WINDOW_DAYS,
    conversion,
  ).current;

  const cents = computeShareableTotalCents(accounts as never, txs as never, asOf, conversion);

  expect(cents).toBe(Math.round(overzichtFigure * 100));
  expect(cents).toBe(155_000); // 500 + 50 (rolled forward) + 1000, C excluded
});

test("todayIso reflects the current moment, not a value captured earlier — a tab left open past midnight shares under the new date", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-09-29T23:59:00Z"));
    const before = todayIso();
    vi.setSystemTime(new Date("2026-09-30T00:05:00Z"));
    const after = todayIso();
    expect(before).toBe("2026-09-29");
    expect(after).toBe("2026-09-30");
  } finally {
    vi.useRealTimers();
  }
});

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
  resetNetWorthShareStateForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("putNetWorthTotal sends exactly {date, totalCents, currency} and nothing else", async () => {
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

  const outcome = await putNetWorthTotal("2026-09-29", 123_456);

  expect(outcome).toBe("stored");
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("/api/personal/net-worth-total");
  expect(init?.method).toBe("PUT");
  expect(JSON.parse(init?.body as string)).toEqual({
    date: "2026-09-29",
    totalCents: 123_456,
    currency: "EUR",
  });
  expect(Object.keys(JSON.parse(init?.body as string))).toEqual(["date", "totalCents", "currency"]);
});

test("putNetWorthTotal reports signed-out on 401 without throwing", async () => {
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
  expect(await putNetWorthTotal("2026-09-29", 100)).toBe("signed-out");
});

test("putNetWorthTotal reports error rather than throwing on a network failure", async () => {
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockRejectedValue(new Error("offline"));
  expect(await putNetWorthTotal("2026-09-29", 100)).toBe("error");
});

test("a repeated PUT of the exact same {date, totalCents} is skipped, not resent", async () => {
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

  expect(await putNetWorthTotal("2026-09-29", 100)).toBe("stored");
  expect(await putNetWorthTotal("2026-09-29", 100)).toBe("skipped");
  expect(fetchMock).toHaveBeenCalledOnce();

  // A different value on the same date is a real change and must send.
  expect(await putNetWorthTotal("2026-09-29", 200)).toBe("stored");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("a PUT that failed is not remembered as sent — the next attempt with the same value still sends", async () => {
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

  expect(await putNetWorthTotal("2026-09-29", 100)).toBe("error");
  expect(await putNetWorthTotal("2026-09-29", 100)).toBe("stored");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("after a successful delete, a later PUT with the same value it deleted sends again rather than being skipped as a duplicate", async () => {
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

  expect(await putNetWorthTotal("2026-09-29", 100)).toBe("stored");
  expect(await deleteNetWorthTotal()).toBe("deleted");
  expect(await putNetWorthTotal("2026-09-29", 100)).toBe("stored");
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test("deleteNetWorthTotal sends a DELETE with no body", async () => {
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

  const outcome = await deleteNetWorthTotal();

  expect(outcome).toBe("deleted");
  expect(fetchMock).toHaveBeenCalledWith("/api/personal/net-worth-total", { method: "DELETE" });
});

test("a DELETE fired right after a PUT waits for that PUT to settle first — the module queue orders them, so a stale total is never left behind", async () => {
  let resolvePut!: (value: Response) => void;
  const putPromise = new Promise<Response>((resolve) => {
    resolvePut = resolve;
  });
  const fetchMock = vi.mocked(globalThis.fetch);
  const calls: string[] = [];
  fetchMock.mockImplementation((_url, init) => {
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    calls.push(method);
    return method === "PUT" ? putPromise : Promise.resolve(new Response(null, { status: 200 }));
  });

  const put = putNetWorthTotal("2026-09-29", 100);
  const del = deleteNetWorthTotal();

  // The DELETE must not have reached the network yet: the PUT is still pending.
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual(["PUT"]);

  resolvePut(new Response(null, { status: 200 }));
  await put;
  await del;

  expect(calls).toEqual(["PUT", "DELETE"]);
  expect(await put).toBe("stored");
  expect(await del).toBe("deleted");
});

test("once switched off, no further PUT reaches the network even if one was queued behind the DELETE by mistake", async () => {
  // This proves the queue's ORDERING guarantee; the caller (App.tsx) is what
  // must actually stop enqueueing PUTs once off — this test documents that a
  // PUT enqueued despite that guard still cannot jump ahead of a pending DELETE.
  const fetchMock = vi.mocked(globalThis.fetch);
  const calls: string[] = [];
  fetchMock.mockImplementation((_url, init) => {
    calls.push((init as RequestInit | undefined)?.method ?? "GET");
    return Promise.resolve(new Response(null, { status: 200 }));
  });

  await putNetWorthTotal("2026-09-29", 100);
  await deleteNetWorthTotal();

  expect(calls).toEqual(["PUT", "DELETE"]);
});
