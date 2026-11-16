import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { currencyAmountAt, detectLocale, readCsv, type CurrencyAmount } from "./read.js";
import { SALDO_TOLERANCE, walkSaldo, type SaldoRow } from "./saldo.js";

/* Issue #315: the account statement's Saldo walk.
 *
 * The fixture is the real NL header shape from `docs/investing/DEGIRO.md`; every
 * amount and balance in it is synthetic. The walk runs on the participating
 * rows only: the caller drops `Degiro Cash Sweep Transfer` (its Saldo reports
 * the flatex-bank leg) and every information line with an empty Mutatie, so the
 * helper below does the same and the walk itself stays pure arithmetic.
 */

const ACCOUNT_FIXTURE = "../__fixtures__/degiro/nl/account.csv";

const fixtureText = (): string => readFileSync(new URL(ACCOUNT_FIXTURE, import.meta.url), "utf8");

const sweep = (description: string): boolean =>
  description.startsWith("Degiro Cash Sweep Transfer");

/** Build the walk's input from the real fixture with the real reader. */
function fixtureRows(): SaldoRow[] {
  const table = readCsv(fixtureText());
  const locale = detectLocale(table);
  const rows: SaldoRow[] = [];

  for (const row of table.rows) {
    // Cell 5 is `Omschrijving`, 7/8 the `Mutatie` pair, 9/10 the `Saldo` pair.
    if (sweep(row.cells[5] ?? "")) continue;
    if ((row.cells[8] ?? "").trim() === "") continue;
    const change = currencyAmountAt(table.header, row.cells, 7, locale);
    const balance = currencyAmountAt(table.header, row.cells, 9, locale);
    if (change === null || balance === null) continue;
    rows.push({ line: row.line, change, balance });
  }

  return rows;
}

const amount = (currency: string, value: number): CurrencyAmount => ({ currency, amount: value });

const row = (line: number, change: CurrencyAmount, balance: CurrencyAmount): SaldoRow => ({
  line,
  change,
  balance,
});

test("the fixture passes the walk and reports its closing balances", () => {
  const table = readCsv(fixtureText());
  const rows = fixtureRows();

  // 29 data rows, 24 participate: the sweep and four information lines stay out.
  expect(table.rows).toHaveLength(29);
  expect(rows).toHaveLength(24);

  const walk = walkSaldo(rows);
  expect(walk.ok).toBe(true);
  expect(walk.problems).toEqual([]);
  expect([...walk.closing.keys()].sort()).toEqual(["EUR", "USD"]);
  expect(walk.closing.get("EUR")).toBeCloseTo(1467.64, 2);
  expect(walk.closing.get("USD")).toBeCloseTo(0, 2);
});

test("deleting a row names its walk successor, not the deleted row", () => {
  const rows = fixtureRows();
  // Line 26 is the EUR `Valuta Creditering` of +7.60. Without it the next EUR
  // row in walk order is line 25, whose expected balance no longer matches.
  const without = rows.filter((candidate) => candidate.line !== 26);
  expect(without).toHaveLength(23);

  const walk = walkSaldo(without);
  expect(walk.ok).toBe(false);
  expect(walk.problems).toHaveLength(1);
  expect(walk.problems[0]).toMatch(/^rij 25: saldo EUR is /);
  // The reported balance is still the closing one; one break must not cascade.
  expect(walk.closing.get("EUR")).toBeCloseTo(1467.64, 2);
});

test("reversing is not sorting: file order decides, even on one timestamp", () => {
  // A trade, its fee and its AutoFX legs share one Datum+Tijd, so these two
  // rows could look interchangeable. Only their given order is chronological.
  const sameTimestamp: SaldoRow[] = [
    row(10, amount("EUR", 5), amount("EUR", 105)),
    row(11, amount("EUR", 100), amount("EUR", 100)),
  ];

  const walk = walkSaldo(sameTimestamp);
  expect(walk.ok).toBe(true);
  expect(walk.problems).toEqual([]);
  expect(walk.closing.get("EUR")).toBe(105);

  // Swap the two rows and the walk must follow the new order, not a sort by line.
  const swapped = walkSaldo([...sameTimestamp].reverse());
  expect(swapped.ok).toBe(false);
  expect(swapped.problems).toHaveLength(1);
  expect(swapped.problems[0]).toMatch(/^rij 11: saldo EUR is /);
});

test("a currency mismatch is unprovable and does not poison either currency", () => {
  // Newest first: 2, 3, 4, 5. Row 4's Mutatie is EUR but its Saldo is USD.
  const rows: SaldoRow[] = [
    row(2, amount("EUR", 1), amount("EUR", 6)),
    row(3, amount("USD", 10), amount("USD", 110)),
    row(4, amount("EUR", 5), amount("USD", 100)),
    row(5, amount("EUR", 5), amount("EUR", 5)),
  ];

  const walk = walkSaldo(rows);
  expect(walk.ok).toBe(false);
  expect(walk.problems).toEqual(["rij 4: mutatie in EUR maar saldo in USD"]);
  // The reset adopted USD 100, so USD 110 proves out; EUR kept its own total.
  expect(walk.closing.get("USD")).toBe(110);
  expect(walk.closing.get("EUR")).toBe(6);
});

test("one bad row gives one problem, not one per remaining row", () => {
  // Newest first: row 3 is wrong (expected 3, reports 100). Rows 4 and 2 hold
  // relative to the adopted balance, so the break stops at row 3.
  const rows: SaldoRow[] = [
    row(2, amount("EUR", 1), amount("EUR", 101)),
    row(3, amount("EUR", 1), amount("EUR", 100)),
    row(4, amount("EUR", 1), amount("EUR", 2)),
    row(5, amount("EUR", 1), amount("EUR", 1)),
  ];

  const walk = walkSaldo(rows);
  expect(walk.ok).toBe(false);
  expect(walk.problems).toHaveLength(1);
  expect(walk.problems[0]).toMatch(/^rij 3: saldo EUR is 100, verwacht 3 \(2 \+ 1\)$/);
});

test("problems read top-to-bottom of the file, not in walk order", () => {
  // Two breaks: the walk meets line 3 first, then line 2. The exported list
  // must follow the file's own order (newest first), as the API promises.
  const rows: SaldoRow[] = [
    row(2, amount("EUR", 1), amount("EUR", 500)),
    row(3, amount("EUR", 1), amount("EUR", 1000)),
    row(4, amount("EUR", 1), amount("EUR", 1)),
  ];

  const walk = walkSaldo(rows);
  expect(walk.problems).toHaveLength(2);
  expect(walk.problems.map((problem) => problem.slice(0, 7))).toEqual(["rij 2: ", "rij 3: "]);
});

test("the first row of a currency is a reset, not a failure", () => {
  const walk = walkSaldo([row(7, amount("EUR", 25), amount("EUR", 1000))]);
  expect(walk.ok).toBe(true);
  expect(walk.problems).toEqual([]);
  expect(walk.closing.get("EUR")).toBe(1000);
});

test("empty input is a clean walk", () => {
  expect(walkSaldo([])).toEqual({ ok: true, problems: [], closing: new Map() });
});

test("the tolerance accepts half a cent and rejects a full cent", () => {
  expect(SALDO_TOLERANCE).toBe(0.005);

  const passes = walkSaldo([
    row(2, amount("EUR", 1), amount("EUR", 101.004)),
    row(3, amount("EUR", 10), amount("EUR", 100)),
  ]);
  expect(passes.ok).toBe(true);
  expect(passes.problems).toEqual([]);

  const fails = walkSaldo([
    row(2, amount("EUR", 1), amount("EUR", 101.01)),
    row(3, amount("EUR", 10), amount("EUR", 100)),
  ]);
  expect(fails.ok).toBe(false);
  expect(fails.problems).toHaveLength(1);
  expect(fails.problems[0]).toMatch(/^rij 2: saldo EUR is 101\.01, verwacht 101 \(100 \+ 1\)$/);
});
