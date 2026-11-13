import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readAccountStatement } from "./account.js";
import { readAccountDividends } from "./dividends.js";

/* Issue #316: account statement -> `Dividend[]` with withholding tax.
 *
 * Every amount, balance, ISIN and product below is synthetic. The CSV rows use
 * the verified NL account header and dot decimals, exactly like the fixture, so
 * the same reader, locale detection and classification run here. */

const ACCOUNT_HEADER =
  "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id";

const fixture = (): string =>
  readFileSync(new URL("../__fixtures__/degiro/nl/account.csv", import.meta.url), "utf8");

type RowOptions = {
  /** 1-based source-line order: the builder keeps the rows as given. */
  date: string;
  valueDate?: string;
  description: string;
  isin?: string;
  product?: string;
  currency?: string;
  /** Signed `Mutatie` with a dot decimal. */
  amount: string;
};

const row = ({
  date,
  valueDate,
  description,
  isin = "NL0VORB00029",
  product = "VOORBEELD DIVIDEND AANDEEL",
  currency = "EUR",
  amount,
}: RowOptions): string =>
  [
    date,
    "09:00",
    valueDate ?? date,
    product,
    isin,
    description,
    "",
    currency,
    amount,
    currency,
    "0.00",
    "",
  ].join(",");

const csv = (...rows: string[]): string => [ACCOUNT_HEADER, ...rows].join("\n");

test("the fixture yields two dividends: an EUR gross one and a USD one net of a tax refund", () => {
  const { dividends, counts, problems } = readAccountDividends(fixture());
  expect(dividends).toHaveLength(2);

  const eur = dividends.find((dividend) => dividend.currency === "EUR")!;
  expect(eur.date).toBe("2026-01-12");
  expect(eur.symbol).toBe("NL0VORB00045");
  expect(eur.isin).toBe("NL0VORB00045");
  expect(eur.amount).toBeCloseTo(5.76, 6);
  // No tax line: the field is absent, not 0.
  expect("withholdingTax" in eur).toBe(false);

  const usd = dividends.find((dividend) => dividend.currency === "USD")!;
  expect(usd.date).toBe("2026-01-09");
  expect(usd.symbol).toBe("NL0VORB00011");
  expect(usd.isin).toBe("NL0VORB00011");
  expect(usd.amount).toBeCloseTo(8.39, 6);
  // The fixture's tax row is a refund, so amount + withholdingTax is the gross.
  expect(usd.withholdingTax).toBeCloseTo(-0.63, 6);
  expect(usd.amount + (usd.withholdingTax ?? 0)).toBeCloseTo(7.76, 6);

  expect(counts).toEqual({ grossRows: 2, taxRows: 1, corrections: 0, unmatched: 0 });
  // grossRows + taxRows is every row classified into the dividend bucket.
  expect(counts.grossRows + counts.taxRows).toBe(3);
  expect(problems).toEqual([]);
});

test("a gross dividend and its tax charge become one dividend net of the tax", () => {
  const text = csv(
    row({ date: "15-03-2026", description: "Dividend", amount: "10.00" }),
    row({ date: "15-03-2026", description: "Dividendbelasting", amount: "-1.50" }),
  );
  const { dividends, counts, problems } = readAccountDividends(text);

  expect(dividends).toHaveLength(1);
  const [dividend] = dividends;
  expect(dividend!.amount).toBeCloseTo(8.5, 6);
  expect(dividend!.withholdingTax).toBeCloseTo(1.5, 6);
  expect(dividend!.amount + dividend!.withholdingTax!).toBeCloseTo(10, 6);
  expect(counts).toEqual({ grossRows: 1, taxRows: 1, corrections: 0, unmatched: 0 });
  expect(problems).toEqual([]);
});

test("a dividend without a tax row has no withholdingTax field, not zero", () => {
  const text = csv(row({ date: "15-03-2026", description: "Dividend", amount: "10.00" }));
  const { dividends } = readAccountDividends(text);

  expect(dividends).toHaveLength(1);
  expect("withholdingTax" in dividends[0]!).toBe(false);
});

test("two gross rows on one key share one tax line, so the tax is booked once", () => {
  // Same ISIN, currency and cash date but two rows. The tax line cannot belong to
  // both, so the first claimed row takes it and the pair is not counted twice.
  const text = csv(
    row({ date: "15-03-2026", description: "Dividend", amount: "10.00" }),
    row({ date: "15-03-2026", description: "Dividendbelasting", amount: "-1.50" }),
    row({ date: "15-03-2026", description: "Dividend", amount: "20.00" }),
  );
  const { dividends } = readAccountDividends(text);

  expect(dividends).toHaveLength(2);
  const total = dividends.reduce((sum, dividend) => sum + dividend.amount, 0);
  expect(total).toBeCloseTo(28.5, 6);
  const withheld = dividends.reduce((sum, dividend) => sum + (dividend.withholdingTax ?? 0), 0);
  expect(withheld).toBeCloseTo(1.5, 6);
});

test("a full reversal nets into the earlier dividend: one dividend, amount zero", () => {
  // Newest first, as in the export: the reversal row sits above the original.
  const text = csv(
    row({ date: "05-03-2026", description: "Dividend", amount: "-10.00" }),
    row({ date: "01-03-2026", description: "Dividend", amount: "10.00" }),
  );
  const { dividends, counts, problems } = readAccountDividends(text);

  expect(dividends).toHaveLength(1);
  expect(dividends[0]!.amount).toBeCloseTo(0, 6);
  expect(counts.corrections).toBe(1);
  expect(counts.unmatched).toBe(0);
  expect(problems).toEqual([]);
});

test("a partial reversal leaves the remaining dividend amount", () => {
  const text = csv(
    row({ date: "05-03-2026", description: "Dividend", amount: "-4.00" }),
    row({ date: "01-03-2026", description: "Dividend", amount: "10.00" }),
  );
  const { dividends } = readAccountDividends(text);

  expect(dividends).toHaveLength(1);
  expect(dividends[0]!.amount).toBeCloseTo(6, 6);
});

test("a reversal with a tax refund nets both amount and withholding to zero", () => {
  const text = csv(
    row({ date: "05-03-2026", description: "Dividendbelasting", amount: "1.50" }),
    row({ date: "05-03-2026", description: "Dividend", amount: "-10.00" }),
    row({ date: "01-03-2026", description: "Dividendbelasting", amount: "-1.50" }),
    row({ date: "01-03-2026", description: "Dividend", amount: "10.00" }),
  );
  const { dividends, counts, problems } = readAccountDividends(text);

  expect(dividends).toHaveLength(1);
  expect(dividends[0]!.amount).toBeCloseTo(0, 6);
  // Present and 0: the tax was taken and refunded, it was not absent.
  expect(dividends[0]!.withholdingTax).toBeCloseTo(0, 6);
  expect(counts).toEqual({ grossRows: 2, taxRows: 2, corrections: 1, unmatched: 0 });
  expect(problems).toEqual([]);
});

test("a tax row without its dividend is booked alone with a problem", () => {
  const text = csv(
    row({
      date: "15-03-2026",
      description: "Dividendbelasting",
      isin: "NL0VORB00011",
      currency: "USD",
      amount: "-0.63",
    }),
  );
  const { dividends, counts, problems } = readAccountDividends(text);

  expect(dividends).toHaveLength(1);
  expect(dividends[0]!.amount).toBeCloseTo(-0.63, 6);
  expect(dividends[0]!.withholdingTax).toBeCloseTo(0.63, 6);
  expect(counts).toEqual({ grossRows: 0, taxRows: 1, corrections: 0, unmatched: 1 });
  expect(problems).toEqual([
    expect.stringMatching(/dividendbelasting zonder bijbehorend dividend/),
  ]);
});

test("a reversal without an original is booked negative with a problem", () => {
  const text = csv(row({ date: "15-03-2026", description: "Dividend", amount: "-5.00" }));
  const { dividends, counts, problems } = readAccountDividends(text);

  expect(dividends).toHaveLength(1);
  expect(dividends[0]!.amount).toBeCloseTo(-5, 6);
  expect(counts).toEqual({ grossRows: 1, taxRows: 0, corrections: 0, unmatched: 1 });
  expect(problems).toEqual([expect.stringMatching(/zonder origineel/)]);
});

test("a dividend with an empty ISIN uses the product name as symbol", () => {
  const text = csv(
    row({
      date: "15-03-2026",
      description: "Dividend",
      isin: "",
      product: "VOORBEELD AANDEEL ZONDER ISIN",
      amount: "10.00",
    }),
  );
  const { dividends, problems } = readAccountDividends(text);

  expect(dividends).toHaveLength(1);
  expect(dividends[0]!.symbol).toBe("VOORBEELD AANDEEL ZONDER ISIN");
  expect("isin" in dividends[0]!).toBe(false);
  expect(problems).toEqual([expect.stringMatching(/zonder ISIN/)]);
});

test("an impossible date emits no dividend and reports the raw Datum", () => {
  const text = csv(
    row({
      date: "31-02-2026",
      valueDate: "31-02-2026",
      description: "Dividend",
      amount: "10.00",
    }),
  );
  const { dividends, counts, problems } = readAccountDividends(text);

  expect(dividends).toEqual([]);
  // The row is still counted: it is a dividend row that could not be placed.
  expect(counts.grossRows).toBe(1);
  expect(problems).toEqual([expect.stringMatching(/onmogelijke datum "31-02-2026"/)]);
});

test("ids are stable across a re-parse and two identical rows keep distinct ids", () => {
  const first = readAccountDividends(fixture());
  const second = readAccountDividends(fixture());

  expect(first.dividends.map((dividend) => dividend.id)).toEqual(
    second.dividends.map((dividend) => dividend.id),
  );
  expect(new Set(first.dividends.map((dividend) => dividend.id)).size).toBe(first.dividends.length);

  const repeated = csv(
    row({ date: "15-03-2026", description: "Dividend", amount: "10.00" }),
    row({ date: "15-03-2026", description: "Dividend", amount: "10.00" }),
  );
  const { dividends } = readAccountDividends(repeated);
  expect(dividends).toHaveLength(2);
  expect(dividends[0]!.id).not.toBe(dividends[1]!.id);
});

test("a file that is not an account statement explains itself instead of guessing", () => {
  const transactions = readFileSync(
    new URL("../__fixtures__/degiro/nl/transactions.csv", import.meta.url),
    "utf8",
  );
  const other = readAccountDividends(transactions);
  expect(other.dividends).toEqual([]);
  expect(other.counts).toEqual({ grossRows: 0, taxRows: 0, corrections: 0, unmatched: 0 });
  expect(other.problems).toEqual([
    "geen DeGiro rekeningoverzicht: dit bestand is een transactions-export",
  ]);

  const empty = readAccountDividends("");
  expect(empty.dividends).toEqual([]);
  expect(empty.problems).toHaveLength(1);
  expect(empty.problems[0]).toMatch(/leeg bestand/);
});

test("acceptance: the statement counts 3 dividend rows and emits none of them as a cash flow", () => {
  const text = fixture();
  const statement = readAccountStatement(text);

  expect(statement.counts.dividend).toBe(3);
  // The cash-flow mapper skips the dividend bucket, so a dividend cannot count
  // twice in the dashboard as both income and a cash movement.
  expect(statement.cashFlows.some((flow) => /^Dividend/i.test(flow.description ?? ""))).toBe(false);
});

test("dividends carry broker degiro and no entity", () => {
  const { dividends } = readAccountDividends(fixture());
  for (const dividend of dividends) {
    expect(dividend.broker).toBe("degiro");
    expect("entity" in dividend).toBe(false);
  }
});
