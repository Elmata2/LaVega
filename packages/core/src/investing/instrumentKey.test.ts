import { expect, test } from "vitest";
import { instrumentKey } from "./instrumentKey.js";

/* Issue #307 criterion 3. */
test("an ISIN identifies the series, in its currency", () => {
  expect(instrumentKey({ symbol: "AAPL_US_EQ", isin: "US0378331005", currency: "usd" })).toBe(
    "isin:US0378331005:USD",
  );
});

test("without an ISIN the symbol identifies the series", () => {
  expect(instrumentKey({ symbol: "AAPL", currency: "EUR" })).toBe("sym:AAPL:EUR");
  expect(instrumentKey({ symbol: "^GSPC", currency: "EUR" })).toBe("sym:^GSPC:EUR");
});

test("a malformed ISIN is ignored and the symbol form is used", () => {
  for (const isin of ["US037833100", "US0378331005X", "1234567890", "", "US-0378331005"]) {
    expect(instrumentKey({ symbol: "AAPL", isin, currency: "EUR" })).toBe("sym:AAPL:EUR");
  }
});

test("the currency is normalised to upper case and the symbol is used as given", () => {
  expect(instrumentKey({ symbol: "aapl_US_EQ", currency: "gbp" })).toBe("sym:aapl_US_EQ:GBP");
});

test("the same ISIN and currency share one series across venues", () => {
  expect(instrumentKey({ symbol: "AAPL_US_EQ", isin: "US0378331005", currency: "USD" })).toBe(
    instrumentKey({ symbol: "AAPL", isin: "us0378331005", currency: "usd" }),
  );
});
