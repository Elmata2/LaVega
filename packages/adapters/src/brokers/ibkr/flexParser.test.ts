import { describe, expect, test } from "vitest";
import { assignTradeIds } from "@lavega/core";
import { parseFlexStatement } from "./flexParser.js";

const xml = `<FlexStatements><FlexStatement><OpenPositions>
  <OpenPosition symbol="AAPL" isin="US0378331005" position="2" avgPrice="100" markPrice="110" positionValue="220" currency="USD" reportDate="20260818" description="Apple &amp; Co" />
</OpenPositions><Trades>
  <Trade symbol="AAPL" transactionID="tx-1" tradeDate="20260818;101500" buySell="BUY" quantity="2" tradePrice="100" proceeds="-200" ibCommission="1" currency="USD" />
</Trades></FlexStatement></FlexStatements>`;

describe("parseFlexStatement", () => {
  test("maps open positions and trades from one Flex statement", () => {
    const result = parseFlexStatement(xml, "personal");

    expect(result.problems).toEqual([]);
    expect(result.positions).toEqual([expect.objectContaining({
      entity: "personal",
      symbol: "AAPL",
      isin: "US0378331005",
      quantity: 2,
      marketValue: 220,
      asOf: "2026-08-18",
      description: "Apple & Co",
    })]);
    expect(result.trades).toEqual([expect.objectContaining({
      entity: "personal",
      side: "buy",
      date: "2026-08-18",
      quantity: 2,
      amount: -200,
      brokerTradeId: "tx-1",
    })]);
  });

  test("keeps valid rows when one row is malformed", () => {
    const result = parseFlexStatement(xml.replace('symbol="AAPL" transactionID', 'transactionID'), "personal");

    expect(result.positions).toHaveLength(1);
    expect(result.trades).toHaveLength(0);
    expect(result.problems).toEqual(["IBKR Flex Trade symbol is missing"]);
  });

  test("uses core identity assignment for repeated trades", () => {
    const result = parseFlexStatement(xml, "personal");
    const [withId] = assignTradeIds(result.trades);
    expect(withId?.id).toBeTruthy();
  });
});
