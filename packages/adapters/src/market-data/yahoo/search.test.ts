import { expect, test, vi } from "vitest";
import { searchYahooBenchmarks } from "./search.js";

test("Yahoo benchmark search reuses crumb client and confirms missing currency", async () => {
  const fetchJsonWithCrumb = vi
    .fn()
    .mockResolvedValueOnce({
      quotes: [{ symbol: "^AEX", shortname: "AEX", exchDisp: "Amsterdam", quoteType: "INDEX" }],
    })
    .mockResolvedValueOnce({ chart: { result: [{ meta: { currency: "EUR" } }] } });
  const result = await searchYahooBenchmarks("AEX", { client: { fetchJsonWithCrumb } as never });
  expect(result).toMatchObject({ fallback: false, results: [{ symbol: "^AEX", currency: "EUR" }] });
  expect(fetchJsonWithCrumb).toHaveBeenCalledTimes(2);
});

test("Yahoo benchmark search falls back to curated European list", async () => {
  const result = await searchYahooBenchmarks("AEX", {
    client: { fetchJsonWithCrumb: vi.fn().mockRejectedValue(new Error("blocked")) } as never,
  });
  expect(result).toMatchObject({ fallback: true, results: [{ symbol: "^AEX" }] });
  expect(result.problems[0]).toMatch(/search failed/);
});
