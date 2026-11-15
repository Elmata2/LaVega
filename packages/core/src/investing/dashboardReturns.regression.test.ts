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
 * are additive. A trade-only broker's dashboard returns must not change, so the
 * golden file was captured from `a27240c23` before the lot book existed.
 *
 * The comparison parses both sides. Strings and integers must match exactly;
 * float leaves allow a relative 1e-9 difference, because `Math.pow` (XIRR's
 * `sinceFirstBuyPercentage`) rounds its last bit differently across V8 versions:
 * Node 22 prints 2.254066065376386 where Node 26 prints 2.2540660653763864 for
 * the same computation. A string golden would make the gate depend on the Node
 * that runs it. A real return change is orders of magnitude larger than 1e-9
 * relative and still fails, as does any added, removed or renamed field.
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

/** Relative tolerance for float leaves: wide enough to absorb a last-ULP
 *  difference between V8 versions (about 1e-16 relative), far narrower than any
 *  real return change (a one-cent move on a EUR 100 return is 1e-4 relative). */
const FLOAT_TOLERANCE = 1e-9;

/** First difference between two parsed payloads, or null when they match.
 *  Numbers compare exactly when they are equal or integers; other numeric
 *  leaves compare within `FLOAT_TOLERANCE`. Keys compare exactly, so a field
 *  added, removed or renamed fails the gate. */
function firstDifference(actual: unknown, expected: unknown, path = "$"): string | null {
  if (typeof expected === "number" && typeof actual === "number") {
    if (Object.is(actual, expected)) return null;
    const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
    return Math.abs(actual - expected) <= FLOAT_TOLERANCE * scale
      ? null
      : `${path}: ${actual} !== ${expected}`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path}: expected an array, got ${typeof actual}`;
    if (actual.length !== expected.length)
      return `${path}: expected ${expected.length} entries, got ${actual.length}`;
    for (const [index, value] of expected.entries()) {
      const difference = firstDifference(actual[index], value, `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual))
      return `${path}: expected an object, got ${actual === null ? "null" : typeof actual}`;
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (
      expectedKeys.length !== actualKeys.length ||
      expectedKeys.some((key, index) => key !== actualKeys[index])
    )
      return `${path}: keys [${actualKeys.join(", ")}] !== [${expectedKeys.join(", ")}]`;
    for (const key of expectedKeys) {
      const difference = firstDifference(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
      if (difference) return difference;
    }
    return null;
  }
  return actual === expected ? null : `${path}: ${String(actual)} !== ${String(expected)}`;
}

test("trade-only broker dashboard returns match the pre-WS4.1 golden", () => {
  const actualText = `${JSON.stringify(returnsGate(build()), null, 2)}\n`;
  if (process.env.GENERATE_GOLDEN === "1") writeFileSync(GOLDEN_URL, actualText, "utf8");
  // Parse both sides: only the numbers are compared with a tolerance, and only
  // by value. The golden file stays human-readable JSON.
  const actual = JSON.parse(actualText) as unknown;
  const expected = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as unknown;
  expect(firstDifference(actual, expected)).toBeNull();
});
