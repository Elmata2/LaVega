import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/* Issue #313: the real-format DeGiro fixtures.
 *
 * These encodings were observed on real exports of 2026-11-12 and are recorded
 * in `docs/investing/DEGIRO.md`:
 *  - account statement: NL only, dot decimals, `DD-MM-YYYY`, newest row first;
 *  - transactions: NL and EN header, comma decimals, comma delimiter;
 *  - portfolio: NL and EN header, comma decimals, first row is the cash row.
 *
 * The rows are synthetic. Every amount, balance, Order Id, ISIN and product was
 * replaced; only the header, the encoding and the row-kind sequence come from
 * the real files. The Saldo walk below is the check that the replacement kept
 * the statement internally consistent.
 */

const fixture = (path: string): string =>
  readFileSync(new URL(`./__fixtures__/degiro/${path}`, import.meta.url), "utf8");

/** Minimal CSV split for these quoted, comma-delimited files. */
function rows(text: string): string[][] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const cells: string[] = [];
      let cell = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i]!;
        if (quoted) {
          if (char === '"' && line[i + 1] === '"') {
            cell += '"';
            i++;
          } else if (char === '"') quoted = false;
          else cell += char;
        } else if (char === '"') quoted = true;
        else if (char === ",") {
          cells.push(cell);
          cell = "";
        } else cell += char;
      }
      cells.push(cell);
      return cells;
    });
}

const ACCOUNT_HEADER =
  "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id";
const TRANSACTIONS_NL =
  "Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde EUR,Wisselkoers,AutoFX Kosten,Transactiekosten en/of kosten van derden EUR,Totaal EUR,Order ID";
const TRANSACTIONS_EN =
  "Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID";
const PORTFOLIO_NL = "Product,Symbool/ISIN,Aantal,Slotkoers,Lokale waarde,,Waarde in EUR";
const PORTFOLIO_EN = "Product,Symbol/ISIN,Amount,Closing,Local value,,Value in EUR";

const ddMmYyyy = (value: string): number => {
  const [day, month, year] = value.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!);
};

const amount = (value: string): number => Number(value);

/* The account statement is newest first. Reverse it; never re-sort, because a
 * trade, its fee and its AutoFX legs share one Datum and Tijd.
 *
 * Two kinds of row do not take part in the cash walk:
 *  - `Degiro Cash Sweep Transfer` moves cash between the DeGiro account and the
 *    flatex bank; its Saldo column reports the flatex-bank leg.
 *  - a row with an empty `Mutatie` is an information line; no cash moves.
 * The real files prove both exclusions: the naive walk fails on every sweep and
 * information row, while this one holds on all three real exports.
 */
function saldoWalk(account: string[][]): Map<string, number> {
  const balance = new Map<string, number>();
  for (const row of [...account].reverse()) {
    const [, , , , , description, , mutatieCurrency, mutatie, saldoCurrency, saldo] = row;
    if (!mutatieCurrency || !mutatie) continue;
    if (description!.startsWith("Degiro Cash Sweep Transfer")) continue;
    const previous = balance.get(mutatieCurrency);
    const next = amount(mutatie);
    const reported = amount(saldo!);
    if (previous === undefined) {
      expect(saldoCurrency).toBe(mutatieCurrency);
      balance.set(mutatieCurrency, reported);
      continue;
    }
    expect(reported).toBeCloseTo(previous + next, 6);
    balance.set(mutatieCurrency, reported);
  }
  return balance;
}

test("the account fixture keeps the real NL header and encoding", () => {
  const text = fixture("nl/account.csv");
  const [header, ...account] = rows(text);
  expect(header!.join(",")).toBe(ACCOUNT_HEADER);
  expect(text.split("\n")[0]).toBe(ACCOUNT_HEADER);
  expect(account.length).toBeGreaterThan(20);
  for (const row of account) expect(row).toHaveLength(12);
  // Newest first: the dates never increase down the file.
  const dates = account.map((row) => ddMmYyyy(row[0]!));
  expect(dates).toEqual([...dates].sort((a, b) => b - a));
});

test("the Saldo walk holds per currency on the account fixture", () => {
  const [, ...account] = rows(fixture("nl/account.csv"));
  const closing = saldoWalk(account);
  expect([...closing.keys()].sort()).toEqual(["EUR", "USD"]);
  // The newest row carries the closing balance for its currency.
  for (const [currency, balance] of closing) {
    const newest = account.find((row) => row[7] === currency);
    expect(amount(newest![10]!)).toBeCloseTo(balance, 6);
  }
});

test("the account fixture holds every row kind the spec lists", () => {
  const [, ...account] = rows(fixture("nl/account.csv"));
  const descriptions = account.map((row) => row[5]!);
  const has = (kind: string) => descriptions.some((description) => description.includes(kind));

  for (const kind of [
    "Koop",
    "Verkoop",
    "DEGIRO Transactiekosten en/of kosten van derden",
    "Valuta Creditering",
    "Valuta Debitering",
    "Dividend",
    "Dividendbelasting",
    "flatex Storting",
    "iDEAL Deposit",
    "Reservation iDEAL / Sofort Deposit",
    "Processed Flatex Withdrawal",
    "Degiro Cash Sweep Transfer",
    "Overboeking van uw geldrekening",
    "Overboeking naar uw geldrekening",
    "Flatex Interest Income",
    "Rente",
    "DEGIRO Aansluitingskosten",
    "Splitsing",
    "Overboeking effecten",
  ])
    expect(has(kind), `missing row kind: ${kind}`).toBe(true);

  // Information lines and corporate actions carry no cash movement.
  for (const row of account) {
    if (
      row[5]!.startsWith("Overboeking ") ||
      row[5]!.startsWith("Splitsing") ||
      row[5] === "Overboeking effecten"
    ) {
      expect(row[8]).toBe("");
    }
  }
});

test("a trade, its fee and its AutoFX legs share one timestamp and Order Id", () => {
  const [, ...account] = rows(fixture("nl/account.csv"));
  const groups = new Map<string, string[][]>();
  for (const row of account) {
    if (!row[11]) continue;
    groups.set(row[11], [...(groups.get(row[11]) ?? []), row]);
  }
  const fxGroup = [...groups.values()].find((group) =>
    group.some((row) => row[5] === "Valuta Creditering"),
  )!;
  expect(new Set(fxGroup.map((row) => `${row[0]}/${row[1]}`)).size).toBe(1);
  expect(fxGroup.map((row) => row[5])).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^Koop/),
      "DEGIRO Transactiekosten en/of kosten van derden",
      "Valuta Debitering",
      "Valuta Creditering",
    ]),
  );
  // Partial fill: one Order Id with two buy executions and two fee rows.
  const partialFill = [...groups.values()].find(
    (group) => group.filter((row) => row[5]!.startsWith("Koop")).length === 2,
  )!;
  expect(partialFill.filter((row) => row[5]!.startsWith("Koop"))).toHaveLength(2);
  // Sell and its fee.
  expect(
    [...groups.values()].some((group) => group.some((row) => row[5]!.startsWith("Verkoop"))),
  ).toBe(true);
});

test("the transactions fixtures keep both real headers and the same rows", () => {
  const nl = rows(fixture("nl/transactions.csv"));
  const en = rows(fixture("en/transactions.csv"));
  expect(nl[0]!.join(",")).toBe(TRANSACTIONS_NL);
  expect(en[0]!.join(",")).toBe(TRANSACTIONS_EN);
  expect(nl.slice(1)).toEqual(en.slice(1));
  expect(nl.slice(1)).toHaveLength(25);
  for (const row of nl.slice(1)) expect(row).toHaveLength(17);
});

test("the transactions fixture stays internally consistent", () => {
  const [, ...transactions] = rows(fixture("nl/transactions.csv"));
  const orderIds = new Set<string>();
  for (const row of transactions) {
    const quantity = Number(row[6]);
    const price = amount(row[7]!.replace(",", "."));
    const local = amount(row[9]!.replace(",", "."));
    const rate = amount(row[12]!.replace(",", "."));
    const valueEur = amount(row[11]!.replace(",", "."));
    const total = amount(row[15]!.replace(",", "."));
    expect(quantity).toBeGreaterThan(0);
    expect(local).toBeCloseTo(-quantity * price, 2);
    expect(valueEur).toBeCloseTo(local / rate, 2);
    expect(total).toBeCloseTo(
      valueEur + amount(row[13]!.replace(",", ".")) + amount(row[14]!.replace(",", ".")),
      2,
    );
    orderIds.add(row[16]!);
  }
  // 25 rows, 24 orders: the partial-fill pair shares one Order Id.
  expect(orderIds.size).toBe(24);
  // Sanitised: every order id is a synthetic one, never a real UUID.
  for (const id of orderIds) expect(id.startsWith("11111111-1111-4111-8111-")).toBe(true);
});

test("the portfolio fixtures keep both real headers and the cash row", () => {
  const nl = rows(fixture("nl/portfolio.csv"));
  const en = rows(fixture("en/portfolio.csv"));
  expect(nl[0]!.join(",")).toBe(PORTFOLIO_NL);
  expect(en[0]!.join(",")).toBe(PORTFOLIO_EN);
  expect(nl.slice(1)).toEqual(en.slice(1));
  expect(nl.slice(1)).toHaveLength(13);

  const [, cash, ...positions] = nl;
  // The real export starts with a `CASH & CASH FUND …` row: a cash balance,
  // not a position. It has no ISIN, quantity or closing price.
  expect(cash![0]).toMatch(/^CASH & CASH FUND/);
  expect(cash![1]).toBe("");
  expect(cash![2]).toBe("");
  expect(cash![3]).toBe("");
  for (const row of positions) {
    expect(row).toHaveLength(7);
    const quantity = Number(row[2]);
    const close = amount(row[3]!.replace(",", "."));
    expect(quantity).toBeGreaterThan(0);
    expect(amount(row[5]!.replace(",", "."))).toBeCloseTo(quantity * close, 2);
  }
});

test("the fixtures hold no real product, ISIN or Order Id", () => {
  const text = [
    fixture("nl/account.csv"),
    fixture("nl/transactions.csv"),
    fixture("en/transactions.csv"),
    fixture("nl/portfolio.csv"),
    fixture("en/portfolio.csv"),
  ].join("\n");

  // Products are the sanitizer's own.
  for (const row of rows(fixture("nl/portfolio.csv")).slice(1)) {
    if (row[1]) expect(row[0]!.startsWith("VOORBEELD ")).toBe(true);
  }
  // ISINs are synthetic: 12 characters, valid Luhn check digit.
  const isins = [...text.matchAll(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/g)].map((match) => match[0]);
  expect(isins.length).toBeGreaterThan(0);
  for (const isin of isins) {
    expect(isin).toMatch(/^(NL|IE|XS)/);
    const body = isin.slice(0, -1);
    const digits = [...body]
      .map((char) => (/\d/.test(char) ? char : String(char.charCodeAt(0) - 55)))
      .join("");
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let digit = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 0) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    expect(((10 - (sum % 10)) % 10).toString()).toBe(isin.slice(-1));
  }
  // Order ids are synthetic in both files.
  for (const id of text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ??
    [])
    expect(/^(00000000|11111111)-/.test(id)).toBe(true);
});
