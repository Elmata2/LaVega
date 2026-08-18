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
