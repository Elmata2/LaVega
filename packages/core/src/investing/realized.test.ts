import { describe, expect, test } from "vitest";
import { Schema } from "effect";
import { buildRealizedReport, wrapperTaxTreatment, REALIZED_REPORT_NOTICE } from "./realized.js";
import { buildInvestingDashboard, InvestingDashboardDataSchema } from "./dashboard.js";
import { calculatePositionReturn } from "./positions.js";
import { toCents } from "../money.js";
import type { Dividend } from "./dividend.js";
import type { FxRate } from "../fx.js";
import type { CashFlow, Position, PriceBar, Trade } from "./model.js";

/* WS4.3/WS4.4 acceptance (#296):
 *  - every disposal reconciles to broker-reported cash minus fees where the
 *    broker reports both;
 *  - missing FX shows unknown, never 1:1;
 *  - dividends/interest group by symbol and period and the totals tie to the
 *    cash movements;
 *  - realised/unrealised group by tax treatment, with an unknown default.
 */

const EUR = "EUR";

function rate(date: string, rates: Record<string, number> = { USD: 1.1, GBP: 0.85 }): FxRate {
  return { base: EUR, date, rates };
}

/** Every event date has its own observation, so an exact-date conversion is
 *  available and a missing one is genuinely missing. */
const FX_RATES: FxRate[] = [
  rate("2026-03-02"),
  rate("2026-04-01"),
  rate("2026-04-15"),
  rate("2026-04-20"),
  rate("2026-05-15"),
  rate("2026-06-01"),
];

const AAPL_POSITION: Position = {
  entity: "personal",
  broker: "trading212",
  account: "ISA",
  symbol: "AAPL",
  quantity: 5,
  currency: "USD",
  averagePrice: 100.1,
  marketPrice: 130,
  marketValue: 650,
  asOf: "2026-04-01",
  brokerCost: { status: "known", amount: 500.5, currency: "USD" },
};

const BUY: Trade = {
  id: "buy-1",
  entity: "personal",
  broker: "trading212",
  account: "ISA",
  date: "2026-03-02",
  symbol: "AAPL",
  side: "buy",
  quantity: 10,
  price: 100,
  amount: 1000,
  currency: "USD",
  commission: 1,
};

const SELL: Trade = {
  id: "sell-1",
  entity: "personal",
  broker: "trading212",
  account: "ISA",
  date: "2026-04-01",
  symbol: "AAPL",
  side: "sell",
  quantity: 5,
  price: 120,
  amount: 600,
  currency: "USD",
  commission: 1,
  settlement: { currency: "USD", amount: 599 },
};

const DIVIDEND: Dividend = {
  id: "div-1",
  entity: "personal",
  broker: "trading212",
  account: "ISA",
  date: "2026-04-15",
  symbol: "AAPL",
  amount: 6.25,
  currency: "USD",
};

const INTEREST: CashFlow = {
  id: "interest-1",
  entity: "personal",
  broker: "trading212",
  account: "ISA",
  date: "2026-04-20",
  currency: EUR,
  amount: 2.5,
  kind: "interest",
};

const PRICE_BARS: PriceBar[] = [
  { symbol: "AAPL", date: "2026-06-01", close: 130, currency: "USD" },
];

const WRAPPERS = [{ broker: "trading212", account: "ISA", wrapper: "isa" as const }];

function report(
  overrides: Partial<Parameters<typeof buildRealizedReport>[0]> = {},
): ReturnType<typeof buildRealizedReport> {
  return buildRealizedReport({
    positions: [AAPL_POSITION],
    trades: [BUY, SELL],
    dividends: [DIVIDEND],
    cashFlows: [INTEREST],
    priceBars: PRICE_BARS,
    presentationCurrency: EUR,
    fxRates: FX_RATES,
    accountWrappers: WRAPPERS,
    today: "2026-06-01",
    ...overrides,
  });
}

describe("realised disposals", () => {
  test("a disposal reconciles to broker-reported cash minus fees", () => {
    const result = report();
    expect(result.disposals).toHaveLength(1);
    const [disposal] = result.disposals;
    // Gross 600 USD at 1.10 = 545.4545 EUR, fee 1 USD = 0.9091 EUR.
    expect(disposal!.grossProceedsCents).toBe(54_545);
    expect(disposal!.feesCents).toBe(91);
    expect(disposal!.netProceedsCents).toBe(54_455);
    // Basis: (1000 + 1) / 10 = 100.1 USD per unit, 5 units at 1.10 = 455 EUR.
    expect(disposal!.costBasisCents).toBe(45_500);
    expect(disposal!.realizedGainCents).toBe(8_955);
    expect(disposal!.basisSource).toBe("calculated");
    expect(disposal!.reason).toBeNull();
    expect(disposal!.reconciliation).toEqual({
      status: "reconciled",
      brokerCashCents: 54_455,
      netProceedsCents: 54_455,
      differenceCents: 0,
    });
  });

  test("a broker cash figure that disagrees is a visible difference, not a silent pass", () => {
    const result = report({
      trades: [BUY, { ...SELL, settlement: { currency: "USD", amount: 580 } }],
    });
    expect(result.disposals[0]!.reconciliation.status).toBe("difference");
    expect(result.problems.join(" ")).toMatch(/does not reconcile to broker-reported cash/);
  });

  test("a broker that reports no settled cash is not claimed as reconciled", () => {
    const { settlement: _settlement, ...withoutSettlement } = SELL;
    const result = report({ trades: [BUY, withoutSettlement] });
    expect(result.disposals[0]!.reconciliation).toEqual({ status: "broker-not-reported" });
  });

  test("the realised gain agrees with the existing returns replay digit for digit", () => {
    const returns = calculatePositionReturn(5, null, [BUY, SELL], [DIVIDEND], EUR, FX_RATES);
    expect(returns.status).toBe("unpriced");
    expect(toCents(returns.realizedGain!)).toBe(report().disposals[0]!.realizedGainCents);
  });

  test("a partial trade history takes the basis from the broker snapshot", () => {
    const result = report({
      positions: [{ ...AAPL_POSITION, asOf: "2026-03-02" }],
      trades: [SELL],
    });
    const [disposal] = result.disposals;
    expect(disposal!.basisSource).toBe("provider");
    expect(disposal!.costBasisCents).toBe(45_500);
    expect(disposal!.realizedGainCents).toBe(8_955);
  });

  test("a disposal with no trade history and no snapshot basis is unknown, not zero", () => {
    const result = report({ positions: [], trades: [SELL] });
    const [disposal] = result.disposals;
    expect(disposal!.basisSource).toBeNull();
    expect(disposal!.costBasisCents).toBeNull();
    expect(disposal!.realizedGainCents).toBeNull();
    expect(disposal!.reason).toBe("no-history");
  });

  test("missing FX shows unknown and never a 1:1 conversion", () => {
    const chfSell: Trade = {
      ...SELL,
      id: "sell-chf",
      symbol: "NESN",
      currency: "CHF",
      price: 100,
      amount: 200,
      commission: 0,
      settlement: { currency: "CHF", amount: 200 },
    };
    const chfBuy: Trade = {
      ...BUY,
      id: "buy-chf",
      symbol: "NESN",
      currency: "CHF",
      price: 90,
      amount: 180,
      quantity: 2,
      commission: 0,
    };
    const result = report({
      positions: [
        {
          ...AAPL_POSITION,
          symbol: "NESN",
          currency: "CHF",
          averagePrice: 90,
          quantity: 0,
          marketValue: 0,
        },
      ],
      trades: [chfBuy, chfSell],
    });
    const disposal = result.disposals.find((row) => row.id === "sell-chf")!;
    expect(disposal.netProceedsCents).toBeNull();
    expect(disposal.realizedGainCents).toBeNull();
    expect(disposal.reason).toBe("missing-fx");
    expect(disposal.reconciliation).toEqual({ status: "missing-fx" });
    // The 1:1 figure would have been 20000 cents. It is never produced.
    expect(disposal.netProceedsCents).not.toBe(20_000);
  });
});

describe("income", () => {
  test("dividends and interest group by symbol and period and tie to the cash movements", () => {
    const mayDividend: Dividend = { ...DIVIDEND, id: "div-2", date: "2026-05-15" };
    const result = report({ dividends: [DIVIDEND, mayDividend] });
    const { income } = result;
    expect(income.rows).toHaveLength(3);
    expect(income.groups).toEqual([
      {
        kind: "dividend",
        symbol: "AAPL",
        period: "2026-04",
        amountCents: 568,
        rows: 1,
        unknownRows: 0,
      },
      {
        kind: "interest",
        symbol: null,
        period: "2026-04",
        amountCents: 250,
        rows: 1,
        unknownRows: 0,
      },
      {
        kind: "dividend",
        symbol: "AAPL",
        period: "2026-05",
        amountCents: 568,
        rows: 1,
        unknownRows: 0,
      },
    ]);
    // 6.25 USD / 1.10 = 5.6818 EUR twice, plus 2.50 EUR interest.
    expect(income.tieOut).toMatchObject({
      dividendTotalCents: 1_136,
      interestTotalCents: 250,
      totalCents: 1_386,
      sourceTotalCents: 250,
      differenceCents: 0,
      status: "tied",
    });
  });

  test("an income row with no exact-date FX keeps the total unknown", () => {
    const chfDividend: Dividend = {
      ...DIVIDEND,
      id: "div-chf",
      symbol: "NESN",
      amount: 10,
      currency: "CHF",
    };
    const result = report({ dividends: [DIVIDEND, chfDividend] });
    const row = result.income.rows.find((entry) => entry.id === "div-chf")!;
    expect(row.amountCents).toBeNull();
    expect(row.reason).toBe("missing-fx");
    expect(result.income.tieOut.status).toBe("missing-fx");
  });
});

describe("tax treatment grouping", () => {
  test("the wrapper labels map to the four treatments plus unknown", () => {
    expect(wrapperTaxTreatment("brokerage")).toBe("taxable");
    expect(wrapperTaxTreatment("isa")).toBe("tax-exempt");
    expect(wrapperTaxTreatment("sipp")).toBe("tax-deferred");
    expect(wrapperTaxTreatment("pea")).toBe("tax-exempt");
    expect(wrapperTaxTreatment("pillar-3a")).toBe("tax-deferred");
    expect(wrapperTaxTreatment("assurance-vie")).toBe("tax-advantaged");
    expect(wrapperTaxTreatment("unknown")).toBe("unknown");
  });

  test("realised and unrealised group by treatment with an unknown default", () => {
    const ibkrSell: Trade = {
      ...SELL,
      id: "sell-ibkr",
      broker: "ibkr",
      account: "Main",
      date: "2026-04-01",
      amount: 600,
      currency: "USD",
      commission: 1,
    };
    const ibkrBuy: Trade = { ...BUY, id: "buy-ibkr", broker: "ibkr", account: "Main" };
    const result = report({ trades: [BUY, SELL, ibkrBuy, ibkrSell] });

    const isa = result.byTreatment.find((group) => group.treatment === "tax-exempt")!;
    const unknown = result.byTreatment.find((group) => group.treatment === "unknown")!;
    expect(isa.realizedGainCents).toBe(8_955);
    expect(unknown.realizedGainCents).toBe(8_955);
    expect(unknown.unknownDisposals).toBe(0);

    // Unrealised is grouped too: the ISA holding is priced at today's close.
    const isaHolding = result.holdings.find((row) => row.broker === "trading212")!;
    expect(isaHolding.marketValueCents).toBe(59_091);
    expect(isaHolding.costBasisCents).toBe(45_500);
    expect(isaHolding.unrealizedGainCents).toBe(13_591);
    expect(isaHolding.treatment).toBe("tax-exempt");
    expect(
      result.byTreatment.find((group) => group.treatment === "tax-exempt")!.unrealizedGainCents,
    ).toBe(13_591);
  });

  test("an account with no wrapper entry is grouped as unknown, never as taxable", () => {
    const result = report({ accountWrappers: [] });
    expect(result.accounts[0]!.wrapper).toBe("unknown");
    expect(result.accounts[0]!.treatment).toBe("unknown");
    expect(result.byTreatment.some((group) => group.treatment === "taxable")).toBe(false);
  });
});

describe("report contract", () => {
  test("no tax-filing claim appears anywhere in the copy", () => {
    expect(REALIZED_REPORT_NOTICE).toMatch(/does not file taxes/);
    expect(REALIZED_REPORT_NOTICE).toMatch(/not tax advice/);
    const result = report();
    expect(result.notice).toBe(REALIZED_REPORT_NOTICE);
    expect(JSON.stringify(result)).not.toMatch(/tax return|tax filing|file your taxes/i);
  });

  test("an empty snapshot produces an empty report, not invented rows", () => {
    const result = report({ positions: [], trades: [], dividends: [], cashFlows: [] });
    expect(result.disposals).toEqual([]);
    expect(result.holdings).toEqual([]);
    expect(result.byTreatment).toEqual([]);
    expect(result.accounts).toEqual([]);
    expect(result.income.tieOut.status).toBe("no-income");
  });
});

describe("dashboard integration", () => {
  test("the dashboard carries the report and the selected position's realised summary", () => {
    const dashboard = buildInvestingDashboard({
      positions: [AAPL_POSITION],
      trades: [BUY, SELL],
      dividends: [DIVIDEND],
      cashFlows: [INTEREST],
      priceBars: PRICE_BARS,
      benchmarkBars: [],
      presentationCurrency: EUR,
      fxRates: FX_RATES,
      accountWrappers: WRAPPERS,
      selectedSymbol: "AAPL",
      today: "2026-06-01",
    });
    expect(dashboard.realized?.disposals).toHaveLength(1);
    expect(dashboard.realized?.byTreatment[0]?.treatment).toBe("tax-exempt");
    expect(dashboard.position?.realized).toEqual({
      disposals: 1,
      unknownDisposals: 0,
      netProceedsCents: 54_455,
      realizedGainCents: 8_955,
    });
    // The wire contract encodes the new section, so the client decodes it.
    const encoded = Schema.encodeSync(InvestingDashboardDataSchema)(dashboard);
    expect((encoded as { realized?: { disposals: unknown[] } }).realized?.disposals).toHaveLength(
      1,
    );
  });
});
