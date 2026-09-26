import { expect, test } from "vitest";
import { convertCurrency } from "@lavega/core";
import { createDevFixtureBrokerData, createDevFixtureFxProvider } from "./devFixture.js";

test("historical FX rates cover every trade and dividend date the fixture itself generates", async () => {
  const now = new Date("2026-09-24T00:00:00Z");
  const snapshot = createDevFixtureBrokerData(now);
  const { trades, dividends } = snapshot.trading212!;
  const { rates } = await createDevFixtureFxProvider(now).getHistoricalRates("USD", "EUR");

  for (const trade of trades) {
    expect(() => convertCurrency(100, trade.currency, "EUR", trade.date, rates)).not.toThrow();
  }
  for (const dividend of dividends) {
    expect(() => convertCurrency(1, dividend.currency, "EUR", dividend.date, rates)).not.toThrow();
  }
});
