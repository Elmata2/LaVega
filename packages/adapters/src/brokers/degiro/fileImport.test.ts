import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { createDeGiroFileImport } from "./fileImport.js";

/* The adapter turns the core account statement into a `BrokerResult`: one
 * `Account.csv` alone must yield trades, dividends, cash balances, the cash
 * flows that fund them, a complete cash-history claim and the period, with the
 * entity and broker stamped. The fixture is core's sanitized real NL statement
 * (#313/#317), so the adapter is exercised on the same bytes core tests. */

const account = (): string =>
  readFileSync(
    new URL("../../../../core/src/parsers/__fixtures__/degiro/nl/account.csv", import.meta.url),
    "utf8",
  );

test("one account statement yields the full result, entity and broker stamped", async () => {
  const result = await createDeGiroFileImport().load({
    filename: "Account.csv",
    text: account(),
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
    filename: "empty.csv",
    text: "",
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
    filename: "portfolio.csv",
    text: "Product;ISIN;Symbol;Amount;Price;Value;Currency;Date\nETF;IE00TEST;VUAA;2;10;20;EUR;2026-08-18",
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

test("a recognised transactions export is named but not mapped yet", async () => {
  const transactions = readFileSync(
    new URL(
      "../../../../core/src/parsers/__fixtures__/degiro/nl/transactions.csv",
      import.meta.url,
    ),
    "utf8",
  );
  const result = await createDeGiroFileImport().load({
    filename: "Transactions.csv",
    text: transactions,
    entity: "BV1",
  });

  expect(result.source).toBe("DeGiro transactions");
  expect(result.problems).toEqual([
    "DeGiro transactions-export herkend, maar nog niet uitgelezen: de rij-mapping volgt in #315–#319",
  ]);
  // No section was read: an empty complete section would wipe stored rows.
  for (const section of [
    result.sections.positions,
    result.sections.trades,
    result.sections.dividends,
    result.sections.cashBalances,
    result.sections.cashFlows,
  ]) {
    expect(section.status).toBe("unavailable");
    expect(section.rows).toEqual([]);
  }
  expect(result.cashHistory).toBeUndefined();
});
