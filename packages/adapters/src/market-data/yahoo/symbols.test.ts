import { expect, test } from "vitest";
import { getYahooSymbol, getYahooSymbolsToTry } from "./symbols.js";

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
  expect(candidates[0]).toBe("AMD");
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
  expect(getYahooSymbolsToTry(brokerSymbol, "UNKNOWN")[0]).toBe(yahooSymbol);
});
