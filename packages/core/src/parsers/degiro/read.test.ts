import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  currencyAmountAt,
  dateProblems,
  detectLocale,
  parseClockTime,
  parseDecimal,
  parseIsoDate,
  readCsv,
} from "./read.js";

/* Issue #314: the strict DeGiro CSV reader. Fixtures live one directory up in
 * `__fixtures__/degiro/` and are the real header shapes described in
 * `docs/investing/DEGIRO.md`. Every amount in them is synthetic. */

const fixture = (path: string): string =>
  readFileSync(new URL(`../__fixtures__/degiro/${path}`, import.meta.url), "utf8");

/** Minimal writer used by the dot/comma acceptance test; quotes like RFC 4180. */
const toCsv = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [header, ...rows]
    .map((cells) =>
      cells
        .map((cell) => (/[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(","),
    )
    .join("\n");

test("readCsv: BOM, CRLF, LF, quoted commas and doubled quotes", () => {
  const text = `\uFEFFA,B\r\n1,2\r\n\r\n"x,y","he said ""hi"""\r\n3,4\n`;
  const table = readCsv(text);

  expect(text.startsWith("\uFEFF")).toBe(true);
  expect(table.header).toEqual(["A", "B"]);
  expect(table.rows).toEqual([
    { line: 2, cells: ["1", "2"] },
    { line: 4, cells: ["x,y", 'he said "hi"'] },
    { line: 5, cells: ["3", "4"] },
  ]);
  expect(table.rows[0]!.cells).toHaveLength(2);
});

test("readCsv: a newline inside a quoted field is literal but advances the line counter", () => {
  const table = readCsv('A,B\n"line1\nline2",3\n4,5\n');

  expect(table.rows).toEqual([
    { line: 2, cells: ["line1\nline2", "3"] },
    { line: 4, cells: ["4", "5"] },
  ]);
});

test("readCsv: a lone CR is a record separator", () => {
  const table = readCsv("A,B\r1,2\r3,4");
  expect(table.rows).toEqual([
    { line: 2, cells: ["1", "2"] },
    { line: 3, cells: ["3", "4"] },
  ]);
});

test("readCsv: header cells are trimmed, row cells are verbatim", () => {
  const table = readCsv(" A , B \n 1 ,2\n");
  expect(table.header).toEqual(["A", "B"]);
  expect(table.rows).toEqual([{ line: 2, cells: [" 1 ", "2"] }]);
});

test("readCsv: empty and whitespace-only input give an empty table", () => {
  expect(readCsv("")).toEqual({ header: [], rows: [] });
  expect(readCsv(" \n\t\n  \r\n")).toEqual({ header: [], rows: [] });
});

test("readCsv: a quoted field holding only spaces is not an empty record", () => {
  const table = readCsv('A,B\n"  ",1\n');
  expect(table.rows).toEqual([{ line: 2, cells: ["  ", "1"] }]);
});

test("readCsv: never throws on an unterminated quote", () => {
  expect(() => readCsv('A,B\n"unterminated,1\n')).not.toThrow();
});

test("detectLocale: decided once per file, from the numeric columns", () => {
  // Dot decimals: the account statement. Its free-text `Omschrijving` holds
  // comma decimals ("Koop 1 @ 49,12 EUR"); skipping prose is why this is dot.
  expect(detectLocale(readCsv(fixture("nl/account.csv")))).toBe("dot");
  expect(detectLocale(readCsv(fixture("nl/transactions.csv")))).toBe("comma");
  expect(detectLocale(readCsv(fixture("nl/portfolio.csv")))).toBe("comma");
  expect(detectLocale(readCsv(fixture("en/transactions.csv")))).toBe("comma");
  expect(detectLocale(readCsv(fixture("en/portfolio.csv")))).toBe("comma");
});

test("detectLocale: ties and no evidence mean dot", () => {
  const tie: ReturnType<typeof readCsv> = {
    header: ["A", "B"],
    rows: [
      { line: 2, cells: ["1.5", "2,5"] },
      { line: 3, cells: ["3,5", "4.5"] },
    ],
  };
  expect(detectLocale(tie)).toBe("dot");

  const noNumbers = { header: ["Product"], rows: [{ line: 2, cells: ["VOORBEELD FONDS"] }] };
  expect(detectLocale(noNumbers)).toBe("dot");
});

test("detectLocale: a dot-only thousands grouping abstains", () => {
  const grouped = {
    header: ["Value"],
    rows: [{ line: 2, cells: ["1.234"] }],
  };
  expect(detectLocale(grouped)).toBe("dot");
});

test("parseDecimal: dot, comma, both thousands forms, signs, zero, garbage", () => {
  expect(parseDecimal("21.76", "dot")).toBe(21.76);
  expect(parseDecimal("21,76", "comma")).toBe(21.76);
  expect(parseDecimal("1.234,56", "comma")).toBe(1234.56);
  expect(parseDecimal("1,234.56", "dot")).toBe(1234.56);
  expect(parseDecimal("  -21,76  ", "comma")).toBe(-21.76);
  expect(parseDecimal('"21,76"', "comma")).toBe(21.76);
  expect(parseDecimal("1\u00A0234,56", "comma")).toBe(1234.56);
  expect(parseDecimal("0", "dot")).toBe(0);
  expect(parseDecimal("0,00", "comma")).toBe(0);
  expect(parseDecimal("", "dot")).toBeNull();
  expect(parseDecimal("  ", "dot")).toBeNull();
  expect(parseDecimal("abc", "dot")).toBeNull();
  expect(parseDecimal("1.2.3", "dot")).toBeNull();
  expect(parseDecimal("12,", "comma")).toBeNull();
  expect(Number.isNaN(parseDecimal("nope", "dot") as number)).toBe(false);
});

test("parseIsoDate: real dates, leap years and impossible days", () => {
  expect(parseIsoDate("06-03-2026")).toBe("2026-03-06");
  expect(parseIsoDate("6-3-2026")).toBe("2026-03-06");
  expect(parseIsoDate("2026-11-12")).toBe("2026-11-12");
  expect(parseIsoDate("29-02-2024")).toBe("2024-02-29");
  expect(parseIsoDate("29-02-2023")).toBeNull();
  expect(parseIsoDate("29-02-2000")).toBe("2000-02-29");
  expect(parseIsoDate("29-02-1900")).toBeNull();
  expect(parseIsoDate("31-02-2026")).toBeNull();
  expect(parseIsoDate("31-04-2026")).toBeNull();
  expect(parseIsoDate("00-01-2026")).toBeNull();
  expect(parseIsoDate("01-13-2026")).toBeNull();
  expect(parseIsoDate("32-01-2026")).toBeNull();
  expect(parseIsoDate("2026-02-29")).toBeNull();
  expect(parseIsoDate("06/03/2026")).toBeNull();
  expect(parseIsoDate("not a date")).toBeNull();
  expect(parseIsoDate("")).toBeNull();
});

test("parseClockTime: zero-padded HH:MM, seconds ignored, impossible times rejected", () => {
  expect(parseClockTime("9:00")).toBe("09:00");
  expect(parseClockTime("09:05")).toBe("09:05");
  expect(parseClockTime("22:00")).toBe("22:00");
  expect(parseClockTime("22:00:59")).toBe("22:00");
  expect(parseClockTime(" 8:30 ")).toBe("08:30");
  expect(parseClockTime("24:00")).toBeNull();
  expect(parseClockTime("23:60")).toBeNull();
  expect(parseClockTime("9:0")).toBeNull();
  expect(parseClockTime("9.00")).toBeNull();
  expect(parseClockTime("")).toBeNull();
});

test("currencyAmountAt: account statement `Mutatie` and `Saldo`", () => {
  const table = readCsv(fixture("nl/account.csv"));
  const deposit = table.rows.find((row) => row.cells[5] === "iDEAL Deposit");
  expect(deposit).toBeDefined();

  expect(currencyAmountAt(table.header, deposit!.cells, 7, "dot")).toEqual({
    currency: "EUR",
    amount: 21.76,
  });
  expect(currencyAmountAt(table.header, deposit!.cells, 9, "dot")).toEqual({
    currency: "EUR",
    amount: 1467.64,
  });
});

test("currencyAmountAt: transactions `Koers` → USD, with the amount in column 7", () => {
  const table = readCsv(fixture("nl/transactions.csv"));
  const first = table.rows[0]!;
  expect(currencyAmountAt(table.header, first.cells, 7, "comma")).toEqual({
    currency: "USD",
    amount: 19.07,
  });
  expect(currencyAmountAt(table.header, first.cells, 9, "comma")).toEqual({
    currency: "USD",
    amount: -38.14,
  });
});

test("currencyAmountAt: portfolio `Lokale waarde` → local currency and amount", () => {
  const table = readCsv(fixture("nl/portfolio.csv"));
  const position = table.rows[1]!;
  expect(currencyAmountAt(table.header, position.cells, 4, "comma")).toEqual({
    currency: "USD",
    amount: 124.98,
  });
});

test("currencyAmountAt: an information line gives no amount", () => {
  const table = readCsv(fixture("nl/account.csv"));
  const info = table.rows.find((row) => row.cells[5] === "Overboeking effecten");
  expect(info).toBeDefined();
  expect(currencyAmountAt(table.header, info!.cells, 7, "dot")).toBeNull();
});

test("currencyAmountAt: no partner column, both currencies or an empty amount give null", () => {
  expect(currencyAmountAt(["Mutatie", "Saldo"], ["EUR", "21.76"], 0, "dot")).toBeNull();
  expect(currencyAmountAt(["Mutatie", ""], ["EUR", "USD"], 0, "dot")).toBeNull();
  expect(currencyAmountAt(["Mutatie", ""], ["EUR", ""], 0, "dot")).toBeNull();
  expect(currencyAmountAt(["Mutatie", ""], ["eur", "21.76"], 0, "dot")).toBeNull();
});

test("dateProblems: names the source line of every impossible date", () => {
  const table = readCsv(
    ["Datum,Tijd", "01-01-2026,09:00", "31-02-2026,10:00", ",11:00", "2026-13-01,12:00"].join("\n"),
  );

  expect(dateProblems(table, 0)).toEqual([
    'rij 3: onmogelijke datum "31-02-2026"',
    'rij 5: onmogelijke datum "2026-13-01"',
  ]);
});

test("dateProblems: row number survives a skipped blank line and a quoted newline", () => {
  const table = readCsv('Datum,Notitie\n\n01-01-2026,"twee\nregels"\n31-02-2026,x\n');
  expect(dateProblems(table, 0)).toEqual(['rij 5: onmogelijke datum "31-02-2026"']);
});

/* Acceptance criterion: one logical row in dot decimals and in comma decimals
 * must produce the same values. First at unit level, then across the whole
 * account fixture, re-detecting the locale from the rewritten text. */
test("acceptance: one logical row parses the same in dot and comma decimals", () => {
  const header = [
    "Datum",
    "Tijd",
    "Valutadatum",
    "Product",
    "ISIN",
    "Omschrijving",
    "FX",
    "Mutatie",
    "",
    "Saldo",
    "",
    "Order Id",
  ];
  const dotCells = [
    "01-01-2026",
    "09:00",
    "01-01-2026",
    "",
    "",
    "Deposit",
    "",
    "EUR",
    "21.76",
    "EUR",
    "1467.64",
    "",
  ];
  const commaCells = dotCells.map((cell) => (cell.includes(".") ? cell.replace(".", ",") : cell));

  const dotTable = { header, rows: [{ line: 2, cells: dotCells }] };
  const commaTable = { header, rows: [{ line: 2, cells: commaCells }] };
  expect(detectLocale(dotTable)).toBe("dot");
  expect(detectLocale(commaTable)).toBe("comma");

  const dotAmount = currencyAmountAt(header, dotCells, 7, detectLocale(dotTable));
  const commaAmount = currencyAmountAt(header, commaCells, 7, detectLocale(commaTable));
  expect(dotAmount).toEqual({ currency: "EUR", amount: 21.76 });
  expect(commaAmount).toEqual(dotAmount);
});

test("acceptance: the account fixture with comma decimals re-detects and parses identically", () => {
  const original = readCsv(fixture("nl/account.csv"));
  expect(detectLocale(original)).toBe("dot");
  const amountColumns = [8, 10];

  const originalAmounts = original.rows.map((row) =>
    amountColumns.map((column) => parseDecimal(row.cells[column] ?? "", "dot")),
  );
  // Both the amount and the balance columns become comma decimals; the prose
  // column keeps its commas and must not swing the detection.
  const commaRows = original.rows.map((row) =>
    row.cells.map((cell, column) =>
      amountColumns.includes(column) && cell.includes(".") ? cell.replace(".", ",") : cell,
    ),
  );
  const rewritten = readCsv(toCsv(original.header, commaRows));

  expect(detectLocale(rewritten)).toBe("comma");
  expect(rewritten.rows).toHaveLength(original.rows.length);
  const commaAmounts = rewritten.rows.map((row) =>
    amountColumns.map((column) => parseDecimal(row.cells[column] ?? "", "comma")),
  );
  expect(commaAmounts).toEqual(originalAmounts);
  expect(commaAmounts[0]).toEqual([21.76, 1467.64]);
});
