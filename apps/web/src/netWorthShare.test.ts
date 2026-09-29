import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  computeShareableTotalCents,
  deleteNetWorthTotal,
  putNetWorthTotal,
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

test("computeShareableTotalCents rounds the consolidated EUR total to integer cents", () => {
  const cents = computeShareableTotalCents([account({ balance: 1234.56 })], [], "2026-09-29", {
    fxHistory: {},
    mode: "separate",
  });
  expect(cents).toBe(123_456);
});

test("computeShareableTotalCents is null whenever any balance is unknown — no partial sum ever leaves the browser", () => {
  const cents = computeShareableTotalCents(
    [account({ key: "A", balance: 100 }), account({ key: "B", balance: null })],
    [],
    "2026-09-29",
    { fxHistory: {}, mode: "separate" },
  );
  expect(cents).toBeNull();
});

test("computeShareableTotalCents is null with no accounts at all", () => {
  expect(computeShareableTotalCents([], [], "2026-09-29", { fxHistory: {}, mode: "separate" })).toBeNull();
});

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
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

test("deleteNetWorthTotal sends a DELETE with no body", async () => {
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

  const outcome = await deleteNetWorthTotal();

  expect(outcome).toBe("deleted");
  expect(fetchMock).toHaveBeenCalledWith("/api/personal/net-worth-total", { method: "DELETE" });
});
