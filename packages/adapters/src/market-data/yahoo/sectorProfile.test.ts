import { expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchYahooSectorProfile } from "./sectorProfile.js";

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "asset-profile.json"),
    "utf8",
  ),
);

test("maps assetProfile sector and industry via the crumb client", async () => {
  const fetchJsonWithCrumb = vi.fn().mockResolvedValue(fixture);
  const result = await fetchYahooSectorProfile("acme", { fetchJsonWithCrumb } as never);
  expect(result).toEqual({
    kind: "stock",
    sector: "Technology",
    industry: "Consumer Electronics",
    source: "provider",
  });
  expect(fetchJsonWithCrumb).toHaveBeenCalledWith(
    "https://query2.finance.yahoo.com/v10/finance/quoteSummary/ACME?modules=quoteType,assetProfile,topHoldings",
  );
});

test("degrades to null on request failure or empty profile", async () => {
  expect(
    await fetchYahooSectorProfile("ACME", {
      fetchJsonWithCrumb: vi.fn().mockRejectedValue(new Error("[429] blocked")),
    } as never),
  ).toBeNull();
  expect(
    await fetchYahooSectorProfile("ACME", {
      fetchJsonWithCrumb: vi.fn().mockResolvedValue({ quoteSummary: { result: [{}] } }),
    } as never),
  ).toBeNull();
  expect(
    await fetchYahooSectorProfile("ACME", {
      fetchJsonWithCrumb: vi.fn().mockResolvedValue({}),
    } as never),
  ).toBeNull();
});

test("tries Yahoo listing candidates for Trading 212-style symbols before giving up", async () => {
  const fetchJsonWithCrumb = vi
    .fn()
    .mockResolvedValueOnce({ quoteSummary: { result: [{}] } })
    .mockResolvedValueOnce(fixture);

  const result = await fetchYahooSectorProfile("HLMAl_EQ", { fetchJsonWithCrumb } as never);

  expect(result).toEqual({
    kind: "stock",
    sector: "Technology",
    industry: "Consumer Electronics",
    source: "provider",
  });
  expect(fetchJsonWithCrumb).toHaveBeenNthCalledWith(
    1,
    "https://query2.finance.yahoo.com/v10/finance/quoteSummary/HLMA.L?modules=quoteType,assetProfile,topHoldings",
  );
});

const vfem = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "top-holdings-vfem.json"), "utf8"),
);
const aggg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "top-holdings-aggg.json"), "utf8"),
);

test("an equity ETF returns a fund profile with Title-Cased weights", async () => {
  const fetchJsonWithCrumb = vi.fn().mockResolvedValue(vfem);
  const result = await fetchYahooSectorProfile("VFEM.L", { fetchJsonWithCrumb } as never);
  expect(result?.kind).toBe("fund");
  if (result?.kind !== "fund") throw new Error("expected a fund profile");
  expect(result.source).toBe("provider");
  expect(result.weights.length).toBeGreaterThan(0);
  expect(result.weights.every((w) => w.sector !== w.sector.toLowerCase())).toBe(true);
  const total = result.weights.reduce((sum, w) => sum + w.weight, 0);
  expect(total).toBeGreaterThan(0.99);
  expect(total).toBeLessThanOrEqual(1);
  expect(fetchJsonWithCrumb).toHaveBeenCalledWith(
    "https://query2.finance.yahoo.com/v10/finance/quoteSummary/VFEM.L?modules=quoteType,assetProfile,topHoldings",
  );
});

test("a bond fund returns an explicit empty-weights fund profile, not null", async () => {
  const result = await fetchYahooSectorProfile("AGGG.L", {
    fetchJsonWithCrumb: vi.fn().mockResolvedValue(aggg),
  } as never);
  expect(result).toEqual({ kind: "fund", weights: [], source: "provider" });
});

test("a stock still returns a single-sector profile (existing behavior preserved)", async () => {
  const result = await fetchYahooSectorProfile("acme", {
    fetchJsonWithCrumb: vi.fn().mockResolvedValue(fixture),
  } as never);
  expect(result).toEqual({
    kind: "stock",
    sector: "Technology",
    industry: "Consumer Electronics",
    source: "provider",
  });
});
