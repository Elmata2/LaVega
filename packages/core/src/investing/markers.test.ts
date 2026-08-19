import { describe, expect, test } from "vitest";
import { placePositionMarkers } from "./markers.js";
import type { Dividend } from "./dividend.js";
import type { PriceBar, Trade } from "./model.js";

const bars: PriceBar[] = [
  { tenantId: "local", symbol: "AAPL", date: "2026-01-05", close: 100, currency: "USD" },
  { tenantId: "local", symbol: "AAPL", date: "2026-01-07", close: 105, currency: "USD" },
];
const trade = (date: string, side: "buy" | "sell"): Trade => ({ id: date, tenantId: "local", entity: "personal", date, symbol: "AAPL", side, quantity: 2, price: 100, amount: 200, currency: "USD", commission: 0 });
const dividend = (date: string, amount: number): Dividend => ({ id: date, tenantId: "local", entity: "personal", date, symbol: "AAPL", amount, currency: "USD" });

describe("placePositionMarkers", () => {
  test("places trades and dividends on exact or next available price day", () => {
    const result = placePositionMarkers(bars, [trade("2026-01-05", "buy"), trade("2026-01-06", "sell")], [dividend("2026-01-06", 1.25)]);
    expect(result[0]?.markers).toEqual([{ kind: "buy", eventDate: "2026-01-05", label: "Koop 2" }]);
    expect(result[1]?.markers).toEqual([
      { kind: "sell", eventDate: "2026-01-06", label: "Verkoop 2" },
      { kind: "dividend", eventDate: "2026-01-06", label: "Dividend 1.25 USD", amount: 1.25, currency: "USD" },
    ]);
  });

  test("keeps input sorted and ignores non-trade events", () => {
    const result = placePositionMarkers([bars[1]!, bars[0]!], [trade("2026-01-05", "other")], []);
    expect(result.map((point) => point.date)).toEqual(["2026-01-05", "2026-01-07"]);
    expect(result.every((point) => point.markers.length === 0)).toBe(true);
  });
});
