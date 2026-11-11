// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import {
  buildRealizedReport,
  type AccountWrapperEntry,
  type Dividend,
  type FxRate,
  type RealizedIncomeReportData,
  type Trade,
} from "@lavega/core";
import { RealizedReport } from "./RealizedReport";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => document.body.replaceChildren());

const EUR = "EUR";
const FX: FxRate[] = [
  { base: EUR, date: "2026-03-02", rates: { USD: 1.1 } },
  { base: EUR, date: "2026-04-01", rates: { USD: 1.1 } },
  { base: EUR, date: "2026-04-15", rates: { USD: 1.1 } },
  { base: EUR, date: "2026-06-01", rates: { USD: 1.1 } },
];

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
/** A disposal in a currency with no rate: the report must say unknown. */
const CHF_BUY: Trade = {
  id: "buy-chf",
  entity: "personal",
  broker: "ibkr",
  account: "Main",
  date: "2026-03-02",
  symbol: "NESN",
  side: "buy",
  quantity: 2,
  price: 90,
  amount: 180,
  currency: "CHF",
  commission: 0,
};
const CHF_SELL: Trade = {
  id: "sell-chf",
  entity: "personal",
  broker: "ibkr",
  account: "Main",
  date: "2026-04-01",
  symbol: "NESN",
  side: "sell",
  quantity: 2,
  price: 100,
  amount: 200,
  currency: "CHF",
  commission: 0,
  settlement: { currency: "CHF", amount: 200 },
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

const WRAPPERS: AccountWrapperEntry[] = [{ broker: "trading212", account: "ISA", wrapper: "isa" }];

function report(): RealizedIncomeReportData {
  return buildRealizedReport({
    positions: [],
    trades: [BUY, SELL, CHF_BUY, CHF_SELL],
    dividends: [DIVIDEND],
    cashFlows: [],
    priceBars: [],
    presentationCurrency: EUR,
    fxRates: FX,
    accountWrappers: WRAPPERS,
    today: "2026-06-01",
  });
}

function render(onSetWrapper?: (entry: AccountWrapperEntry) => void) {
  const container = document.createElement("div");
  document.body.append(container);
  act(() =>
    createRoot(container).render(
      <RealizedReport report={report()} {...(onSetWrapper ? { onSetWrapper } : {})} />,
    ),
  );
  return container;
}

test("shows the notice, the reconciled disposal and its broker-cash check", () => {
  const container = render();
  const text = container.textContent ?? "";
  expect(text).toContain("LaVega does not file taxes and this is not tax advice.");
  expect(text).toContain("AAPL");
  expect(text).toContain("Reconciled");
  expect(text).toContain("€89.55");
});

test("a disposal without FX shows unknown with the reason, never zero", () => {
  const container = render();
  const text = container.textContent ?? "";
  expect(text).toContain("FX rate missing");
  expect(text).toContain("FX missing");
  expect(text).not.toMatch(/€0\.00/);
});

test("income groups by symbol and month and says the total ties to cash movements", () => {
  const container = render();
  const text = container.textContent ?? "";
  expect(text).toContain("2026-04");
  expect(text).toContain("Ties to cash movements");
  expect(text).toContain("€5.68");
});

test("groups realised and unrealised by treatment and offers an account-type control", () => {
  const onSetWrapper = vi.fn();
  const container = render(onSetWrapper);
  const text = container.textContent ?? "";
  expect(text).toContain("Tax exempt");
  expect(text).toContain("Unknown treatment");
  // Accounts are ordered by broker: ibkr first, then trading212's ISA.
  const select = container.querySelectorAll<HTMLSelectElement>("select")[1]!;
  expect(select.value).toBe("isa");
  act(() => {
    select.value = "sipp";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onSetWrapper).toHaveBeenCalledWith({
    broker: "trading212",
    account: "ISA",
    wrapper: "sipp",
  });
});
