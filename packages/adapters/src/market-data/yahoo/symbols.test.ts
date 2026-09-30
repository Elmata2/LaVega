import { expect, test } from "vitest";
import { getYahooSymbol, getYahooSymbolsToTry, getYahooSymbolForKnownExchange } from "./symbols.js";

test("maps European exchange codes to Yahoo suffixes", () => {
  expect(getYahooSymbol("ASML", "AMS")).toBe("ASML.AS");
  expect(getYahooSymbol("SAP", "XETRA")).toBe("SAP.DE");
  expect(getYahooSymbol("SHEL", "LSE")).toBe("SHEL.L");
});

test("keeps known Yahoo symbols and offers unknown-exchange fallbacks", () => {
  expect(getYahooSymbolsToTry("ASML.AS", "AMS")).toEqual(["ASML.AS"]);
  expect(getYahooSymbolsToTry("ASML", "")).toContain("ASML.AS");
});

test("strips Trading 212 ticker suffix for unknown exchanges", () => {
  const candidates = getYahooSymbolsToTry("AMD_US_EQ", "UNKNOWN");
  expect(candidates).toEqual(["AMD"]);
});

test.each([
  ["BRK/A_US_EQ", "BRK-A"],
  ["BRK_B_US_EQ", "BRK-B"],
  ["BY6_CORP_DE_EQ", "BY6.DE"],
  ["SOF_BE_EQ", "SOF.BR"],
  ["WDO_CA_EQ", "WDO.TO"],
  ["ASMLa_EQ", "ASML.AS"],
  ["GBFd_EQ", "GBF.DE"],
  ["PAYl_EQ", "PAY.L"],
  ["ATEp_EQ", "ATE.PA"],
  ["IDRe_EQ", "IDR.MC"],
  ["SRENHs_EQ", "SREN.SW"],
  ["ZURNs_EQ", "ZURN.SW"],
])("bridges Trading 212 broker ticker %s to Yahoo candidate %s", (brokerSymbol, yahooSymbol) => {
  expect(getYahooSymbolsToTry(brokerSymbol, "UNKNOWN")).toEqual([yahooSymbol]);
});

test("uses the encoded broker venue before a mapped exchange", () => {
  expect(getYahooSymbolsToTry("MASI_US_EQ", "BVME")).toEqual(["MASI"]);
  expect(getYahooSymbolsToTry("HLMAl_EQ", "NASDAQ")).toEqual(["HLMA.L"]);
});

test.each([
  ["TSM", "US", "TSM"],
  ["0700", "HK", "0700.HK"],
  ["ASML", "AMS", "ASML.AS"],
  ["ASML.AS", "AMS", "ASML.AS"],
  ["BRK/A", "US", "BRK-A"],
  ["TSM", "UNKNOWN", null],
  ["TSM", "__proto__", null],
  ["MASI*", "US", null],
  ["TSM.DE", "US", null],
  ["ASML.AS", "LSE", null],
  ["TSM.XYZ", "US", null],
  ["", "US", null],
])("maps only a valid known venue: %s / %s", (ticker, exchange, expected) => {
  expect(getYahooSymbolForKnownExchange(ticker, exchange)).toBe(expected);
});
