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
  expect(result).toEqual({ sector: "Technology", industry: "Consumer Electronics" });
  expect(fetchJsonWithCrumb).toHaveBeenCalledWith(
    "https://query2.finance.yahoo.com/v10/finance/quoteSummary/ACME?modules=assetProfile",
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

  expect(result).toEqual({ sector: "Technology", industry: "Consumer Electronics" });
  expect(fetchJsonWithCrumb).toHaveBeenNthCalledWith(
    1,
    "https://query2.finance.yahoo.com/v10/finance/quoteSummary/HLMA.L?modules=assetProfile",
  );
});
