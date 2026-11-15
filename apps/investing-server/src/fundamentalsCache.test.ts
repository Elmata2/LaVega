import { expect, test, vi } from "vitest";
import type { CompanyFundamentals } from "@lavega/core";
import {
  createCachedFundamentalsProvider,
  FUNDAMENTALS_CACHE_TTL_MS,
} from "./fundamentalsCache.js";

const asml = { symbol: "ASML" } as CompanyFundamentals;

test("serves a symbol from cache for 24 hours, then fetches it again", async () => {
  let now = 0;
  const fetch = vi.fn(async () => asml);
  const cached = createCachedFundamentalsProvider({ fetch }, { now: () => now });

  await cached.fetch("asml");
  now = FUNDAMENTALS_CACHE_TTL_MS - 1;
  expect(await cached.fetch("ASML")).toBe(asml);
  expect(fetch).toHaveBeenCalledOnce();

  now = FUNDAMENTALS_CACHE_TTL_MS;
  await cached.fetch("ASML");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("caches 'no company' but never a failure", async () => {
  const fetch = vi
    .fn<(symbol: string) => Promise<CompanyFundamentals | null>>()
    .mockRejectedValueOnce(new Error("[503] down"))
    .mockResolvedValue(null);
  const cached = createCachedFundamentalsProvider({ fetch });

  await expect(cached.fetch("VWRL")).rejects.toThrow("[503] down");
  expect(await cached.fetch("VWRL")).toBeNull();
  expect(await cached.fetch("VWRL")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("shares one request between concurrent callers", async () => {
  const fetch = vi.fn(async () => asml);
  const cached = createCachedFundamentalsProvider({ fetch });

  await Promise.all([cached.fetch("ASML"), cached.fetch("asml")]);
  expect(fetch).toHaveBeenCalledOnce();
});
