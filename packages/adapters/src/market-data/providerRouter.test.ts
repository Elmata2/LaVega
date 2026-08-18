import { expect, test, vi } from "vitest";
import {
  MarketDataRouter,
  sortCachedRecords,
  type CachedRecord,
  type Provider,
} from "./providerRouter.js";

const provider = <Request, Result>(
  sourceKey: string,
  priority: number,
  result: Result | null | (() => Promise<Result | null>),
): Provider<Request, Result> => ({
  sourceKey,
  priority,
  get: typeof result === "function" ? result as () => Promise<Result | null> : async () => result,
});

test("router returns first non-null result in priority order with provenance", async () => {
  const called: string[] = [];
  const router = new MarketDataRouter({
    price: [
      { ...provider("yahoo", 10, null), get: async () => { called.push("yahoo"); return null; } },
      { ...provider("marketstack", 20, { close: 101 }), get: async () => { called.push("marketstack"); return { close: 101 }; } },
    ],
    fx: [],
    identifier: [],
  });

  await expect(router.getPrice({ symbol: "ASML" })).resolves.toEqual({ sourceKey: "marketstack", value: { close: 101 } });
  expect(called).toEqual(["marketstack"]);
});

test("router skips provider errors and continues", async () => {
  const log = vi.fn();
  const router = new MarketDataRouter({
    price: [provider("broken", 20, async () => { throw new Error("down"); }), provider("fallback", 10, "ok")],
    fx: [],
    identifier: [],
  }, log);

  await expect(router.getPrice({})).resolves.toEqual({ sourceKey: "fallback", value: "ok" });
  expect(log).toHaveBeenCalledWith("broken", expect.any(Error));
});

test("price lane falls through provider problems to a healthy fallback", async () => {
  type PriceResult = { bars: Array<{ close: number }>; problems: string[] };
  const first: Provider<unknown, PriceResult> = { sourceKey: "yahoo", priority: 20, get: async () => ({ bars: [], problems: ["Yahoo blocked"] }) };
  const fallback: Provider<unknown, PriceResult> = { sourceKey: "fallback", priority: 10, get: async () => ({ bars: [{ close: 100 }], problems: [] }) };
  const router = new MarketDataRouter<unknown, PriceResult, never, never, never, never>({
    price: [first, fallback], fx: [], identifier: [],
  });

  await expect(router.getPrice({})).resolves.toEqual({ sourceKey: "fallback", value: { bars: [{ close: 100 }], problems: [] } });
});

test("price lane preserves provider problems when all providers fail", async () => {
  const router = new MarketDataRouter({
    price: [
      { sourceKey: "yahoo", priority: 20, get: async () => ({ bars: [], problems: ["Yahoo blocked"] }) },
      { sourceKey: "fallback", priority: 10, get: async () => ({ bars: [], problems: ["Fallback unavailable"] }) },
    ], fx: [], identifier: [],
  });

  await expect(router.getPrice({})).resolves.toEqual({ sourceKey: "fallback", value: { bars: [], problems: ["Fallback unavailable"] } });
});

test("router supports FX and identifier lanes", async () => {
  const router = new MarketDataRouter({
    price: [],
    fx: [provider("frankfurter", 1, 1.08)],
    identifier: [provider("openfigi", 1, { ticker: "ASML" })],
  });

  await expect(router.getFx({ from: "EUR", to: "USD" })).resolves.toEqual({ sourceKey: "frankfurter", value: 1.08 });
  await expect(router.mapIdentifier({ isin: "NL0010273215" })).resolves.toEqual({ sourceKey: "openfigi", value: { ticker: "ASML" } });
});

test("cached records sort by freshness, source priority, then fetch time", () => {
  const records: CachedRecord<string>[] = [
    { key: "x", sourceKey: "low", value: "stale-new", fetchedAt: 900, staleAt: 500, expiresAt: 2_000 },
    { key: "x", sourceKey: "high", value: "fresh-old", fetchedAt: 100, staleAt: 2_000, expiresAt: 3_000 },
    { key: "x", sourceKey: "high", value: "fresh-new", fetchedAt: 800, staleAt: 2_000, expiresAt: 3_000 },
    { key: "x", sourceKey: "high", value: "expired", fetchedAt: 500, staleAt: 600, expiresAt: 700 },
  ];

  expect(sortCachedRecords(records, { high: 20, low: 10 }, 1_000).map((r) => r.value)).toEqual([
    "fresh-new", "fresh-old", "stale-new", "expired",
  ]);
});
