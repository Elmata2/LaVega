import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readAccountStatement } from "./account.js";
import { readCsv } from "./read.js";

/* Issue #315: account statement -> `CashFlow[]` plus the Saldo walk invariant.
 *
 * The fixture is the sanitized real NL statement from #313: 29 data rows, newest
 * first, EUR and USD, every row kind the spec lists. The bucket counts below are
 * the acceptance criterion "every row lands in exactly one of cash flow, #316,
 * #317, skipped-info". */

const fixture = (): string =>
  readFileSync(new URL("../__fixtures__/degiro/nl/account.csv", import.meta.url), "utf8");

const ACCOUNT_HEADER =
  "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id";

const dataRowCount = (text: string): number => readCsv(text).rows.length;

test("every fixture row lands in exactly one bucket and the counts sum to the rows", () => {
  const text = fixture();
  const statement = readAccountStatement(text);

  expect(statement.counts).toEqual({ cashFlow: 11, dividend: 3, trade: 10, skipped: 5 });
  const total =
    statement.counts.cashFlow +
    statement.counts.dividend +
    statement.counts.trade +
    statement.counts.skipped;
  expect(total).toBe(dataRowCount(text));
  // The emitted flows are the cash-flow bucket, one for one.
  expect(statement.cashFlows).toHaveLength(statement.counts.cashFlow);
});

test("the cash-flow kinds follow the spec table", () => {
  const { cashFlows } = readAccountStatement(fixture());
  const tally = cashFlows.reduce<Record<string, number>>((counts, flow) => {
    counts[flow.kind] = (counts[flow.kind] ?? 0) + 1;
    return counts;
  }, {});
  expect(tally).toEqual({ deposit: 3, withdrawal: 1, interest: 2, fee: 1, other: 4 });
});

test("the cash sweep is not a cash flow of the imported account", () => {
  const { cashFlows } = readAccountStatement(fixture());

  // The sweep moves cash between DeGiro and the flatex bank; its Saldo reports
  // the bank leg, so emitting it as a flow would break core's date-based cash
  // walk on every earlier date.
  expect(cashFlows.some((flow) => /sweep/i.test(flow.description ?? ""))).toBe(false);
  expect(cashFlows).toHaveLength(11);
});

test("sweep, FX and flatex transfer lines never count as deposit or withdrawal", () => {
  const { cashFlows } = readAccountStatement(fixture());
  const external = cashFlows.filter(
    (flow) => flow.kind === "deposit" || flow.kind === "withdrawal",
  );

  for (const flow of external) {
    expect(flow.description).toMatch(
      /^(flatex Storting|iDEAL Deposit|Processed Flatex Withdrawal)$/,
    );
    expect(flow.description).not.toMatch(/Reservation|Sweep|Valuta|Overboeking/);
  }
  // Deposits and withdrawals are the external money only: 3 in, 1 out.
  expect(external.filter((flow) => flow.kind === "deposit")).toHaveLength(3);
  expect(external.filter((flow) => flow.kind === "withdrawal")).toHaveLength(1);
});

test("the reservation rows are `other`, so the later iDEAL Deposit cannot double count", () => {
  const { cashFlows } = readAccountStatement(fixture());
  const reservations = cashFlows.filter((flow) => flow.description?.includes("Reservation"));
  expect(reservations).toHaveLength(2);
  for (const flow of reservations) expect(flow.kind).toBe("other");

  // No reservation row is a deposit, and the one real iDEAL Deposit is a deposit:
  // the reservation legs charge and release cash without ever claiming external
  // money, so counting them as deposits would add phantom deposits.
  const deposits = cashFlows.filter((flow) => flow.kind === "deposit");
  expect(deposits.some((flow) => flow.description?.includes("Reservation"))).toBe(false);
  expect(deposits.filter((flow) => flow.description === "iDEAL Deposit")).toHaveLength(1);
});

test("a trade with its commission and AutoFX legs at one timestamp passes the walk", () => {
  const text = fixture();
  const table = readCsv(text);
  // One timestamp carrying four rows: the buy, its commission and both FX legs.
  const group = table.rows.filter(
    (row) => row.cells[11] === "00000000-0000-4000-8000-000000000002",
  );
  expect(group).toHaveLength(4);
  expect(new Set(group.map((row) => `${row.cells[0]}/${row.cells[1]}`)).size).toBe(1);

  const statement = readAccountStatement(text);
  expect(statement.saldo.ok).toBe(true);
  expect(statement.saldo.problems).toEqual([]);
  expect(statement.problems).toEqual([]);
});

test("the Saldo walk passes on the fixture and closes at the newest balance per currency", () => {
  const statement = readAccountStatement(fixture());
  expect(statement.saldo.ok).toBe(true);
  expect([...statement.saldo.closing.entries()].sort()).toEqual([
    ["EUR", expect.closeTo(1467.64, 6)],
    ["USD", expect.closeTo(0, 6)],
  ]);
});

test("a fixture with one row deleted fails the walk and names the row", () => {
  const text = fixture();
  // Drop the second partial-fill execution (line 24). Its neighbour then jumps
  // by the missing amount, and the problem must name that neighbour's line.
  const broken = text.replace(
    '12-01-2026,11:00,12-01-2026,VOORBEELD DIVIDEND AANDEEL,NL0VORB00029,"Koop 2 @ 49,12 EUR",,EUR,-98.24,EUR,1416.88,00000000-0000-4000-8000-000000000001\n',
    "",
  );
  expect(broken).not.toBe(text);
  expect(dataRowCount(broken)).toBe(dataRowCount(text) - 1);

  const statement = readAccountStatement(broken);
  expect(statement.saldo.ok).toBe(false);
  expect(statement.saldo.problems).toHaveLength(1);
  expect(statement.saldo.problems[0]).toMatch(/^rij 23: saldo EUR is 1417\.59, verwacht /);
});

test("cash-flow ids are stable across a re-parse and unique", () => {
  const first = readAccountStatement(fixture());
  const second = readAccountStatement(fixture());

  expect(first.cashFlows.map((flow) => flow.id)).toEqual(second.cashFlows.map((flow) => flow.id));
  expect(new Set(first.cashFlows.map((flow) => flow.id)).size).toBe(first.cashFlows.length);
  // Identity is content, not position: the id survives the row moving.
  expect(first.cashFlows.map((flow) => flow.description)).toEqual(
    second.cashFlows.map((flow) => flow.description),
  );
});

test("two identical rows keep distinct ids", () => {
  const row = "01-01-2026,09:00,01-01-2026,,,Rente,,EUR,2.18,EUR,2.18,";
  const { cashFlows } = readAccountStatement([ACCOUNT_HEADER, row, row].join("\n"));

  expect(cashFlows).toHaveLength(2);
  expect(cashFlows[0]!.id).not.toBe(cashFlows[1]!.id);
  expect(cashFlows.map((flow) => flow.kind)).toEqual(["interest", "interest"]);
});

test("an unknown description becomes `other` and reports the text", () => {
  const row = "01-01-2026,09:00,01-01-2026,,,Onbekende boeking,,EUR,10.00,EUR,10.00,";
  const statement = readAccountStatement([ACCOUNT_HEADER, row].join("\n"));

  expect(statement.counts.cashFlow).toBe(1);
  expect(statement.cashFlows).toHaveLength(1);
  expect(statement.cashFlows[0]!.kind).toBe("other");
  expect(statement.cashFlows[0]!.amount).toBe(10);
  expect(statement.problems).toEqual([
    'rij 2: onbekende omschrijving "Onbekende boeking" — als "overig" geboekt',
  ]);
  expect(statement.saldo.ok).toBe(true);
});

test("an impossible date is reported and its row emits no flow", () => {
  const row = "31-02-2026,09:00,31-02-2026,,,iDEAL Deposit,,EUR,10.00,EUR,10.00,";
  const statement = readAccountStatement([ACCOUNT_HEADER, row].join("\n"));

  expect(statement.cashFlows).toEqual([]);
  expect(statement.counts.cashFlow).toBe(1);
  expect(statement.problems).toContain('rij 2: onmogelijke datum "31-02-2026"');
});

test("an information line emits nothing and stays out of the walk", () => {
  const rows = [
    "01-01-2026,09:00,01-01-2026,,,flatex Storting,,EUR,100.00,EUR,100.00,",
    '02-01-2026,09:00,02-01-2026,,,"Overboeking naar uw geldrekening bij flatexDEGIRO Bank: 100,00 EUR",,,,EUR,100.00,',
  ];
  const statement = readAccountStatement([ACCOUNT_HEADER, ...rows].join("\n"));

  expect(statement.counts.skipped).toBe(1);
  expect(statement.cashFlows).toHaveLength(1);
  expect(statement.saldo.ok).toBe(true);
});

test("the statement carries broker and description, and no entity", () => {
  const [flow] = readAccountStatement(fixture()).cashFlows;
  expect(flow!.broker).toBe("degiro");
  expect(flow!.description).toBeTruthy();
  expect("entity" in flow!).toBe(false);
});

test("a file that is not an account statement explains itself instead of guessing", () => {
  const transactions = readFileSync(
    new URL("../__fixtures__/degiro/nl/transactions.csv", import.meta.url),
    "utf8",
  );
  const statement = readAccountStatement(transactions);
  expect(statement.cashFlows).toEqual([]);
  expect(statement.problems).toEqual([
    "geen DeGiro rekeningoverzicht: dit bestand is een transactions-export",
  ]);

  const empty = readAccountStatement("");
  expect(empty.cashFlows).toEqual([]);
  expect(empty.problems).toHaveLength(1);
  expect(empty.problems[0]).toMatch(/leeg bestand/);
});
