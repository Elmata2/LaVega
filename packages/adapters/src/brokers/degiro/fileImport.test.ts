import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { brokerTradeRowIds } from "../brokerSnapshot.js";
import { createDeGiroFileImport } from "./fileImport.js";

/* The adapter turns the core import result into a `BrokerResult`: the account
 * statement alone must yield trades, dividends, cash balances, the cash flows
 * that fund them, a complete cash-history claim and the period, with the entity
 * and broker stamped. With a transaction export in the same import, its
 * provenance is merged in and the trade section stays complete. The fixtures are
 * core's sanitized real exports (#313/#317/#318), so the adapter is exercised on
 * the same bytes core tests. */

const fixture = (path: string): string =>
  readFileSync(
    new URL(`../../../../core/src/parsers/__fixtures__/degiro/${path}`, import.meta.url),
    "utf8",
  );

const account = (): string => fixture("nl/account.csv");

test("one account statement yields the full result, entity and broker stamped", async () => {
  const result = await createDeGiroFileImport().load({
    files: [{ filename: "Account.csv", text: account() }],
    entity: "BV1",
  });

  expect(result.source).toBe("DeGiro account");
  expect(result.problems).toEqual([]);

  /* The statement carries no holdings. `unavailable` keeps the snapshot from
   * treating the empty section as a broker that reported zero positions. */
  expect(result.sections.positions).toEqual({ status: "unavailable", rows: [] });

  expect(result.sections.trades.status).toBe("complete");
  expect(result.sections.trades.rows).toHaveLength(4);
  for (const trade of result.sections.trades.rows) {
    expect(trade.entity).toBe("BV1");
    expect(trade.broker).toBe("degiro");
    expect("settlement" in trade).toBe(false);
  }

  expect(result.sections.dividends.status).toBe("complete");
  expect(result.sections.dividends.rows).toHaveLength(2);
  for (const dividend of result.sections.dividends.rows) {
    expect(dividend.entity).toBe("BV1");
    expect(dividend.broker).toBe("degiro");
  }

  expect(result.sections.cashBalances.status).toBe("complete");
  expect(result.sections.cashBalances.rows).toHaveLength(2);
  for (const balance of result.sections.cashBalances.rows) {
    expect(balance.entity).toBe("BV1");
    expect(balance.broker).toBe("degiro");
  }

  expect(result.sections.cashFlows.status).toBe("complete");
  expect(result.sections.cashFlows.rows).toHaveLength(21);
  for (const flow of result.sections.cashFlows.rows) {
    expect(flow.entity).toBe("BV1");
    expect(flow.broker).toBe("degiro");
  }

  expect(result.cashHistory).toEqual({
    entity: "BV1",
    broker: "degiro",
    tradeCash: "cash-flows",
    status: "complete",
    from: "2026-01-05",
    to: "2026-03-06",
  });
  expect(result.period).toEqual({ from: "2026-01-05", to: "2026-03-06" });
});

test("DeGiro file import returns problems for empty input and never throws", async () => {
  const result = await createDeGiroFileImport().load({
    files: [{ filename: "empty.csv", text: "" }],
    entity: "BV1",
  });

  expect(result.source).toBe("");
  expect(result.problems).toHaveLength(1);
  // Nothing was read, so no section claims to be complete.
  expect(result.sections.positions.status).toBe("unavailable");
  expect(result.sections.trades).toEqual({ status: "unavailable", rows: [] });
  expect(result.sections.dividends.status).toBe("unavailable");
  expect(result.sections.cashBalances.status).toBe("unavailable");
  expect(result.sections.cashFlows.status).toBe("unavailable");
  expect(result.cashHistory).toBeUndefined();
  expect(result.period).toBeUndefined();
});

test("DeGiro file import reports an unknown header instead of guessing", async () => {
  const result = await createDeGiroFileImport().load({
    files: [
      {
        filename: "portfolio.csv",
        text: "Product;ISIN;Symbol;Amount;Price;Value;Currency;Date\nETF;IE00TEST;VUAA;2;10;20;EUR;2026-08-18",
      },
    ],
    entity: "BV2",
  });

  // The filename says portfolio; only the header may decide, and it does not match.
  expect(result.source).toBe("");
  expect(result.problems).toEqual([
    "onbekend DeGiro-formaat: Product;ISIN;Symbol;Amount;Price;Value;Currency;Date",
  ]);
  expect(result.sections.positions.rows).toEqual([]);
  expect(result.sections.trades.rows).toEqual([]);
});

test("a transactions-only import reports trades and no cash-history claim", async () => {
  const result = await createDeGiroFileImport().load({
    files: [{ filename: "Transactions.csv", text: fixture("nl/transactions.csv") }],
    entity: "BV1",
  });

  expect(result.source).toBe("DeGiro transactions");
  expect(result.problems).toEqual([]);
  expect(result.sections.trades.status).toBe("complete");
  expect(result.sections.trades.rows).toHaveLength(25);
  for (const trade of result.sections.trades.rows) {
    expect(trade.entity).toBe("BV1");
    expect(trade.broker).toBe("degiro");
  }
  // The transaction export reads trades only; every other section is unread.
  for (const section of [
    result.sections.positions,
    result.sections.dividends,
    result.sections.cashFlows,
    result.sections.cashBalances,
  ]) {
    expect(section).toEqual({ status: "unavailable", rows: [] });
  }
  expect(result.cashHistory).toEqual({
    entity: "BV1",
    broker: "degiro",
    tradeCash: "cash-flows",
    status: "unknown",
    reason: expect.stringMatching(/geen rekeningoverzicht/),
  });
});

test("account and transactions in one import merge and stay complete", async () => {
  const result = await createDeGiroFileImport().load({
    files: [
      { filename: "Account.csv", text: account() },
      { filename: "Transactions.csv", text: fixture("nl/transactions-overlap.csv") },
    ],
    entity: "BV1",
  });

  expect(result.source).toBe("DeGiro account + transactions");
  expect(result.problems).toEqual([]);
  expect(result.sections.trades.status).toBe("complete");
  expect(result.sections.trades.rows).toHaveLength(4);
  expect(result.cashHistory).toMatchObject({
    status: "complete",
    tradeCash: "cash-flows",
  });
  // Two fills share one Order Id; the snapshot ids must still be distinct.
  const ids = brokerTradeRowIds("degiro", result.sections.trades.rows);
  expect(ids).toHaveLength(result.sections.trades.rows.length);
  expect(new Set(ids).size).toBe(ids.length);
});

test("a dated portfolio import reports positions and the cash row, stamped", async () => {
  const result = await createDeGiroFileImport().load({
    files: [{ filename: "Portfolio.csv", text: fixture("nl/portfolio.csv") }],
    entity: "BV1",
    asOf: "2026-11-12",
  });

  expect(result.source).toBe("DeGiro portfolio");
  expect(result.problems).toEqual([]);
  expect(result.sections.positions.status).toBe("complete");
  expect(result.sections.positions.rows).toHaveLength(12);
  for (const position of result.sections.positions.rows) {
    expect(position.entity).toBe("BV1");
    expect(position.broker).toBe("degiro");
  }
  expect(result.sections.cashBalances).toEqual({
    status: "complete",
    rows: [
      { entity: "BV1", broker: "degiro", currency: "EUR", amount: 201.76, asOf: "2026-11-12" },
    ],
  });
  // The portfolio export proves no cash history.
  expect(result.cashHistory).toMatchObject({ status: "unknown" });
});

test("an undated portfolio import reports no positions and no cash-history claim", async () => {
  const result = await createDeGiroFileImport().load({
    files: [{ filename: "Portfolio.csv", text: fixture("nl/portfolio.csv") }],
    entity: "BV1",
  });

  expect(result.source).toBe("DeGiro portfolio");
  expect(result.problems).toHaveLength(1);
  expect(result.problems[0]).toMatch(/exportdatum/);
  expect(result.sections.positions).toEqual({ status: "unavailable", rows: [] });
  expect(result.sections.cashBalances).toEqual({ status: "unavailable", rows: [] });
  expect(result.cashHistory?.status).toBe("unknown");
});

test("account, transactions and portfolio in one import read every section", async () => {
  const result = await createDeGiroFileImport().load({
    files: [
      { filename: "Account.csv", text: account() },
      { filename: "Transactions.csv", text: fixture("nl/transactions-overlap.csv") },
      { filename: "Portfolio.csv", text: fixture("nl/portfolio.csv") },
    ],
    entity: "BV1",
    asOf: "2026-11-12",
  });

  expect(result.source).toBe("DeGiro account + transactions + portfolio");
  expect(result.problems).toEqual([]);
  expect(result.sections.trades.rows).toHaveLength(4);
  expect(result.sections.positions.rows).toHaveLength(12);
  for (const section of [
    result.sections.positions,
    result.sections.trades,
    result.sections.dividends,
    result.sections.cashFlows,
    result.sections.cashBalances,
  ]) {
    expect(section.status).toBe("complete");
  }
  expect(result.cashHistory).toMatchObject({ status: "complete" });
});
