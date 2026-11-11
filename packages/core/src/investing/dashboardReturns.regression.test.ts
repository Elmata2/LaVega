import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { buildInvestingDashboard } from "./dashboard.js";
import {
  DIVIDENDS,
  FX_RATES,
  POSITIONS,
  PRICE_BARS,
  TRADES,
} from "./__fixtures__/tradeOnlyBrokers.js";

/* WS4.1 regression gate (#295): the lot book and the basis provenance fields
 * are additive. A trade-only broker's dashboard returns must stay
 * byte-identical to the base-commit payload, so the golden file was captured
 * from `a27240c23` before the lot book existed and is compared as a string.
 *
 * Regenerate only against a base commit, never against the working tree:
 *   GENERATE_GOLDEN=1 pnpm --filter @lavega/core exec vitest run \
 *     src/investing/dashboardReturns.regression.test.ts
 */
const GOLDEN_URL = new URL("./__fixtures__/dashboard-returns.golden.json", import.meta.url);

const build = () =>
  buildInvestingDashboard({
    positions: POSITIONS,
    trades: TRADES,
    dividends: DIVIDENDS,
    priceBars: PRICE_BARS,
    benchmarkBars: [],
    presentationCurrency: "EUR",
    fxRates: FX_RATES,
    selectedSymbol: "ACME",
    today: "2026-09-17",
    dataVersion: 1,
  });

/** Only fields that existed before WS4.1, so the new basis metadata cannot
 *  hide a moved return: the payload is compared as a JSON string. */
function returnsGate(data: ReturnType<typeof build>) {
  return {
    positions: [...data.positions]
      .sort((left, right) => left.symbol.localeCompare(right.symbol))
      .map((position) => ({
        symbol: position.symbol,
        entity: position.entity,
        quantity: position.quantity,
        currency: position.currency,
        marketValue: position.marketValue,
        portfolioWeight: position.portfolioWeight,
        priceStatus: position.priceStatus,
        returns: position.returns,
      })),
    position: data.position
      ? {
          symbol: data.position.symbol,
          status: data.position.status,
          quantity: data.position.quantity,
          currentValue: data.position.currentValue,
          averageCost: data.position.averageCost,
          returnStatus: data.position.returnStatus,
          returns: data.position.returns,
        }
      : null,
    portfolio: data.portfolio,
  };
}

test("trade-only broker dashboard returns are byte-identical to the pre-WS4.1 golden", () => {
  const actual = `${JSON.stringify(returnsGate(build()), null, 2)}\n`;
  if (process.env.GENERATE_GOLDEN === "1") writeFileSync(GOLDEN_URL, actual, "utf8");
  expect(actual).toBe(readFileSync(GOLDEN_URL, "utf8"));
});
