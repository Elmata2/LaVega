import { describe, expect, test } from "vitest";
import { assignTradeIds } from "@lavega/core";
import { parseFlexStatement } from "./flexParser.js";

const xml = `<FlexStatements><FlexStatement><OpenPositions>
  <OpenPosition symbol="AAPL" isin="US0378331005" position="2" avgPrice="100" markPrice="110" positionValue="220" currency="USD" reportDate="20260818" description="Apple &amp; Co" />
</OpenPositions><Trades>
  <Trade symbol="AAPL" transactionID="tx-1" tradeDate="20260818;101500" buySell="BUY" quantity="2" tradePrice="100" proceeds="-200" ibCommission="1" currency="USD" />
</Trades><CashReport>
  <CashReportCurrency accountId="U1" currency="USD" toDate="20260818" endingCash="125.50" />
  <CashReportCurrency accountId="U2" currency="USD" toDate="20260818" endingCash="24.50" />
  <CashReportCurrency accountId="U1" currency="EUR" toDate="20260818" endingCash="80" />
  <CashReportCurrency accountId="U1" currency="Base Summary" toDate="20260818" endingCash="250" />
</CashReport><StatementOfFunds>
  <StatementOfFundsLine accountId="U1" transactionID="deposit-1" date="20260810" currency="USD" activityCode="DEP" activityDescription="Deposit" amount="100" />
  <StatementOfFundsLine accountId="U1" transactionID="withdrawal-1" date="20260811" currency="USD" activityCode="WTH" activityDescription="Withdrawal" amount="50" />
  <StatementOfFundsLine accountId="U1" transactionID="interest-1" date="20260812" currency="USD" activityCode="BINT" activityDescription="Broker interest paid" amount="1.25" />
  <StatementOfFundsLine accountId="U1" transactionID="fee-1" date="20260813" currency="USD" activityCode="FEE" activityDescription="Data fee" amount="3" />
  <StatementOfFundsLine accountId="U1" transactionID="trade-cash-1" date="20260814" currency="USD" activityCode="BUY" activityDescription="AAPL purchase" amount="-200" />
  <StatementOfFundsLine accountId="U1" transactionID="dividend-1" date="20260815" currency="USD" activityCode="DIV" activityDescription="AAPL dividend" symbol="AAPL" isin="US0378331005" amount="2.50" />
  <StatementOfFundsLine accountId="U1" transactionID="deposit-1" date="20260810" currency="USD" activityCode="DEP" activityDescription="Deposit" amount="100" />
</StatementOfFunds></FlexStatement></FlexStatements>`;

describe("parseFlexStatement", () => {
  test("maps open positions and trades from one Flex statement", () => {
    const result = parseFlexStatement(xml, "personal");

    expect(result.problems).toEqual([]);
    expect(result.positions).toEqual([
      expect.objectContaining({
        entity: "personal",
        symbol: "AAPL",
        isin: "US0378331005",
        quantity: 2,
        marketValue: 220,
        asOf: "2026-08-18",
        description: "Apple & Co",
      }),
    ]);
    expect(result.trades).toEqual([
      expect.objectContaining({
        entity: "personal",
        side: "buy",
        date: "2026-08-18",
        quantity: 2,
        amount: -200,
        brokerTradeId: "tx-1",
      }),
    ]);
    expect(result.cashBalances).toEqual([
      expect.objectContaining({ broker: "ibkr", currency: "USD", amount: 150, asOf: "2026-08-18" }),
      expect.objectContaining({ broker: "ibkr", currency: "EUR", amount: 80, asOf: "2026-08-18" }),
    ]);
    expect(result.cashFlows).toEqual([
      expect.objectContaining({ brokerFlowId: "U1:deposit-1", kind: "deposit", amount: 100 }),
      expect.objectContaining({ brokerFlowId: "U1:withdrawal-1", kind: "withdrawal", amount: -50 }),
      expect.objectContaining({ brokerFlowId: "U1:interest-1", kind: "interest", amount: 1.25 }),
      expect.objectContaining({ brokerFlowId: "U1:fee-1", kind: "fee", amount: -3 }),
      expect.objectContaining({ brokerFlowId: "U1:trade-cash-1", kind: "other", amount: -200 }),
    ]);
    expect(result.dividends).toEqual([
      expect.objectContaining({
        broker: "ibkr",
        brokerDividendId: "U1:dividend-1",
        symbol: "AAPL",
        amount: 2.5,
      }),
    ]);
  });

  test("keeps valid rows when one row is malformed", () => {
    const result = parseFlexStatement(
      xml.replace('symbol="AAPL" transactionID', "transactionID"),
      "personal",
    );

    expect(result.positions).toHaveLength(1);
    expect(result.trades).toHaveLength(0);
    expect(result.problems).toEqual(["IBKR Flex Trade symbol is missing"]);
  });

  test("uses core identity assignment for repeated trades", () => {
    const result = parseFlexStatement(xml, "personal");
    const [withId] = assignTradeIds(result.trades);
    expect(withId?.id).toBeTruthy();
  });

  test("keeps partial cash history and reports invalid cash rows", () => {
    const partial = `<FlexStatements><FlexStatement><CashReport>
      <CashReportCurrency currency="GBP" toDate="20260818" endingCash="25" />
    </CashReport><StatementOfFunds>
      <StatementOfFundsLine transactionID="ok" date="20260817" currency="GBP" activityCode="DEP" amount="10" />
      <StatementOfFundsLine transactionID="bad" date="20260817" currency="GBP" activityCode="FEE" />
    </StatementOfFunds></FlexStatement></FlexStatements>`;
    const result = parseFlexStatement(partial, "personal");

    expect(result.cashBalances).toEqual([expect.objectContaining({ currency: "GBP", amount: 25 })]);
    expect(result.cashFlows).toEqual([
      expect.objectContaining({ brokerFlowId: "ok", kind: "deposit" }),
    ]);
    expect(result.problems).toEqual(["IBKR Flex Statement of Funds amount is missing or invalid"]);
  });
});
