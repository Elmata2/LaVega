import { expect, test, vi } from "vitest";
import { resolveYahooSymbolByIsin, searchYahooBenchmarks } from "./search.js";

test("an ISIN lookup prefers the candidate quoting the broker's currency", async () => {
  const fetchJsonWithCrumb = vi
    .fn()
    .mockResolvedValueOnce({
      quotes: [
        { symbol: "SBSWN.MX", exchange: "MEX" },
        { symbol: "SBSW", exchange: "NYQ" },
      ],
    })
    .mockResolvedValueOnce({ chart: { result: [{ meta: { currency: "MXN" } }] } })
    .mockResolvedValueOnce({ chart: { result: [{ meta: { currency: "USD" } }] } });

  const symbol = await resolveYahooSymbolByIsin(
    "US82575P1075",
    { fetchJsonWithCrumb } as never,
    "USD",
  );

  expect(symbol).toBe("SBSW");
  expect(fetchJsonWithCrumb).toHaveBeenCalledTimes(3);
});

test("an ISIN lookup falls back to the first quote when no candidate confirms the broker's currency", async () => {
  const fetchJsonWithCrumb = vi
    .fn()
    .mockResolvedValueOnce({ quotes: [{ symbol: "SBSWN.MX", exchange: "MEX" }] })
    .mockResolvedValueOnce({ chart: { result: [{ meta: { currency: "MXN" } }] } });

  const symbol = await resolveYahooSymbolByIsin(
    "US82575P1075",
    { fetchJsonWithCrumb } as never,
    "USD",
  );

  expect(symbol).toBe("SBSWN.MX");
});

test("an ISIN lookup with no preferred currency keeps taking the first quote", async () => {
  const fetchJsonWithCrumb = vi
    .fn()
    .mockResolvedValueOnce({ quotes: [{ symbol: "SBSWN.MX" }, { symbol: "SBSW" }] });

  const symbol = await resolveYahooSymbolByIsin("US82575P1075", { fetchJsonWithCrumb } as never);

  expect(symbol).toBe("SBSWN.MX");
  expect(fetchJsonWithCrumb).toHaveBeenCalledTimes(1);
});

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

test("a known benchmark's curated name wins over Yahoo's own truncated name", async () => {
  const fetchJsonWithCrumb = vi
    .fn()
    .mockResolvedValueOnce({
      quotes: [{ symbol: "^GDAXI", shortname: "DAX P", exchDisp: "Frankfurt", quoteType: "INDEX" }],
    })
    .mockResolvedValueOnce({ chart: { result: [{ meta: { currency: "EUR" } }] } });
  const result = await searchYahooBenchmarks("DAX", { client: { fetchJsonWithCrumb } as never });
  expect(result).toMatchObject({ fallback: false, results: [{ symbol: "^GDAXI", name: "DAX" }] });
});

test("Yahoo benchmark search falls back to curated European list", async () => {
  const result = await searchYahooBenchmarks("AEX", {
    client: { fetchJsonWithCrumb: vi.fn().mockRejectedValue(new Error("blocked")) } as never,
  });
  expect(result).toMatchObject({ fallback: true, results: [{ symbol: "^AEX" }] });
  expect(result.problems[0]).toMatch(/search failed/);
});
