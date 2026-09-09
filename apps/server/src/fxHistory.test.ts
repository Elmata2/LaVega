import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  __resetFxHistoryCacheForTests,
  getFxHistory,
  validateCurrency,
  validateFromDate,
} from "./fxHistory.js";

/* Sample rows shaped like the real ECB response (confirmed by curl): a header
 * row naming every column, and TITLE_COMPL quoted because it contains a comma.
 * Only TIME_PERIOD and OBS_VALUE matter here — the rest exists to prove the
 * parser reads columns by name and survives the quoting. */
const HEADER =
  "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS,OBS_CONF,OBS_PRE_BREAK,OBS_COM,TIME_FORMAT,BREAKS,COLLECTION,COMPILING_ORG,DISS_ORG,DOM_SER_IDS,PUBL_ECB,PUBL_MU,PUBL_PUBLIC,UNIT_INDEX_BASE,COMPILATION,COVERAGE,DECIMALS,NAT_TITLE,SOURCE_AGENCY,SOURCE_PUB,TITLE,TITLE_COMPL,UNIT,UNIT_MULT";
const row = (date: string, value: string) =>
  `EXR.D.HUF.EUR.SP00.A,D,HUF,EUR,SP00,A,${date},${value},A,F,,,P1D,,A,,,,,,,99Q1=100,,,2,,4F0,,Hungarian forint/Euro ECB reference exchange rate,"ECB reference exchange rate, Hungarian forint/Euro, 2.15 pm (C.E.T.)",HUF,0`;

const HUF_CSV = [
  HEADER,
  row("2026-08-03", "363.98"),
  row("2026-08-04", "362.3"),
  row("2026-08-06", "363.75"), // weekend gap (08-05 is unpublished) is expected, not an error
].join("\n");

const HUF_CSV_WITH_BLANK_VALUE = [
  HEADER,
  row("2026-08-03", "363.98"),
  row("2026-08-04", ""), // blank OBS_VALUE — Number("") is 0, which must not become rates["2026-08-04"] = 0
].join("\n");

const csvResponse = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/csv" } });

const jsonError404 = () =>
  new Response(JSON.stringify({ type: "about:blank", status: 404, title: "Not Found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });

const wafBlockHtml = () =>
  new Response("<html><body>blocked</body></html>", {
    status: 400,
    headers: { "content-type": "text/html" },
  });

beforeEach(() => __resetFxHistoryCacheForTests());
afterEach(() => vi.restoreAllMocks());

test("parses a successful CSV response into { base, currency, rates }", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => csvResponse(HUF_CSV)),
  );
  const r = await getFxHistory("HUF", "2026-08-01");
  expect(r).toEqual({
    base: "EUR",
    currency: "HUF",
    rates: { "2026-08-03": 363.98, "2026-08-04": 362.3, "2026-08-06": 363.75 },
  });
});

test("excludes a row with a blank OBS_VALUE cell instead of storing it as rate 0", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => csvResponse(HUF_CSV_WITH_BLANK_VALUE)),
  );
  const r = await getFxHistory("HUF", "2026-08-01");
  expect(r?.rates).toEqual({ "2026-08-03": 363.98 });
});

test("filters the cached history down to the requested from date", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => csvResponse(HUF_CSV)),
  );
  const r = await getFxHistory("HUF", "2026-08-05");
  expect(r?.rates).toEqual({ "2026-08-06": 363.75 });
});

test("validateCurrency uppercases a valid code and rejects the wrong shape", () => {
  expect(validateCurrency("huf")).toBe("HUF");
  expect(validateCurrency("HUF")).toBe("HUF");
  expect(validateCurrency("HU")).toBeNull();
  expect(validateCurrency("HUFX")).toBeNull();
  expect(validateCurrency("H1F")).toBeNull();
  expect(validateCurrency(undefined)).toBeNull();
  expect(validateCurrency("")).toBeNull();
});

test("validateFromDate rejects malformed input", () => {
  expect(validateFromDate(undefined)).toBeNull();
  expect(validateFromDate("")).toBeNull();
  expect(validateFromDate("not-a-date")).toBeNull();
  expect(validateFromDate("2026/08/01")).toBeNull();
  expect(validateFromDate("2026-13-40")).toBeNull(); // rolls over in native Date, must not be accepted
});

test("validateFromDate clamps a from-date older than 5 years, without rejecting it", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-08-15T00:00:00Z"));
    expect(validateFromDate("2010-01-01")).toBe("2021-08-15");
    expect(validateFromDate("2024-01-01")).toBe("2024-01-01"); // within range, unchanged
  } finally {
    vi.useRealTimers();
  }
});

test("a second request for the same currency within 24h does not refetch", async () => {
  const fetchMock = vi.fn(async () => csvResponse(HUF_CSV));
  vi.stubGlobal("fetch", fetchMock);
  await getFxHistory("HUF", "2026-08-01");
  await getFxHistory("HUF", "2026-08-01");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("a request past the 24h TTL refetches", async () => {
  const fetchMock = vi.fn(async () => csvResponse(HUF_CSV));
  vi.stubGlobal("fetch", fetchMock);
  await getFxHistory("HUF", "2026-08-01");

  vi.useFakeTimers();
  try {
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    await getFxHistory("HUF", "2026-08-01");
  } finally {
    vi.useRealTimers();
  }
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("a currency not yet cached fetches on its own, independent of another currency's cache", async () => {
  const fetchMock = vi.fn(async () => csvResponse(HUF_CSV));
  vi.stubGlobal("fetch", fetchMock);
  await getFxHistory("HUF", "2026-08-01");
  await getFxHistory("USD", "2026-08-01");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("a cache miss fetches from the 5-year-cap floor, not the caller's from date", async () => {
  const fetchMock = vi.fn(async (_input: unknown) => csvResponse(HUF_CSV));
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-08-15T00:00:00Z"));
    await getFxHistory("HUF", "2026-08-01");
  } finally {
    vi.useRealTimers();
  }
  const url = String(fetchMock.mock.calls[0][0]);
  expect(url).toContain("startPeriod=2021-08-15");
});

test("returns null (503 territory) on a non-200 ECB response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonError404()),
  );
  const r = await getFxHistory("ZZZ", "2026-08-01");
  expect(r).toBeNull();
});

test("returns null on a non-CSV content-type, even with HTTP 200", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(HUF_CSV, { status: 200, headers: { "content-type": "text/plain" } }),
    ),
  );
  expect(await getFxHistory("HUF", "2026-08-01")).toBeNull();
});

test("returns null on a WAF-blocked HTML response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => wafBlockHtml()),
  );
  expect(await getFxHistory("HUF", "2026-08-01")).toBeNull();
});

test("returns null when the fetch rejects or times out", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("timeout");
    }),
  );
  expect(await getFxHistory("HUF", "2026-08-01")).toBeNull();
});

test("a failed fetch is not cached — the next request retries", async () => {
  const fetchMock = vi.fn(async () => jsonError404());
  vi.stubGlobal("fetch", fetchMock);
  await getFxHistory("HUF", "2026-08-01");
  await getFxHistory("HUF", "2026-08-01");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
