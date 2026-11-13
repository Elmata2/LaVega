import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { CashFlowKind } from "../../investing/model.js";
import {
  type AccountBucket,
  type AccountClassification,
  type AccountRowRef,
  classifyAccountRow,
} from "./classify.js";
import { type CsvTable, readCsv } from "./read.js";

/* Issue #315: the classification table. `nl/account.csv` is the hand-built
 * fixture from #313/#314; its header is the verified NL account header, so the
 * column indices below are stable. Every value in it is synthetic. */

const accountTable = (): CsvTable =>
  readCsv(readFileSync(new URL("../__fixtures__/degiro/nl/account.csv", import.meta.url), "utf8"));

/** Build the only three inputs classification may see, from the header's layout. */
const rowRef = (cells: readonly string[]): AccountRowRef => ({
  description: (cells[5] ?? "").trim(),
  orderId: (cells[11] ?? "").trim(),
  hasAmount: (cells[8] ?? "").trim() !== "",
});

type FixtureRow = { ref: AccountRowRef; classification: AccountClassification };

const fixtureRows = (): FixtureRow[] =>
  accountTable().rows.map((row) => {
    const ref = rowRef(row.cells);
    return { ref, classification: classifyAccountRow(ref) };
  });

/** The expected classification for a plain cash-flow row. */
const cashFlow = (kind: CashFlowKind): AccountClassification => ({
  bucket: "cash-flow",
  kind,
  dividendKind: null,
  recognised: true,
  saldoWalk: true,
});

const trade = (): AccountClassification => ({
  bucket: "trade",
  kind: null,
  dividendKind: null,
  recognised: true,
  saldoWalk: true,
});

const dividend = (kind: "gross" | "tax"): AccountClassification => ({
  bucket: "dividend",
  kind: null,
  dividendKind: kind,
  recognised: true,
  saldoWalk: true,
});

const informationLine = (): AccountClassification => ({
  bucket: "skip",
  kind: null,
  dividendKind: null,
  recognised: true,
  saldoWalk: false,
});

test("acceptance: every fixture row lands in exactly one bucket, and the four counts sum to the row count", () => {
  const rows = fixtureRows();
  const counts: Record<AccountBucket, number> = {
    "cash-flow": 0,
    dividend: 0,
    trade: 0,
    skip: 0,
  };
  for (const { classification } of rows) counts[classification.bucket] += 1;

  expect(counts).toEqual({ "cash-flow": 11, dividend: 3, trade: 10, skip: 5 });
  expect(counts["cash-flow"] + counts.dividend + counts.trade + counts.skip).toBe(
    accountTable().rows.length,
  );
  expect(rows).toHaveLength(29);
});

test("acceptance: the fixture's cash-flow kinds are 3 deposits, 1 withdrawal, 2 interest, 1 fee, 4 other", () => {
  const kinds: Record<CashFlowKind, number> = {
    deposit: 0,
    withdrawal: 0,
    interest: 0,
    fee: 0,
    other: 0,
  };
  for (const { classification } of fixtureRows()) {
    if (classification.kind !== null) kinds[classification.kind] += 1;
  }

  expect(kinds).toEqual({ deposit: 3, withdrawal: 1, interest: 2, fee: 1, other: 4 });
  expect(kinds.deposit + kinds.withdrawal + kinds.interest + kinds.fee + kinds.other).toBe(11);
});

test("invariant: kind is non-null exactly when the bucket is cash-flow", () => {
  for (const { classification } of fixtureRows()) {
    expect(classification.kind !== null).toBe(classification.bucket === "cash-flow");
    expect(classification.dividendKind !== null).toBe(classification.bucket === "dividend");
  }
});

test("skip rows are the cash sweep and the four rows with an empty Mutatie", () => {
  const rows = fixtureRows();
  const skipped = rows.filter((row) => row.classification.bucket === "skip");

  expect(skipped.map((row) => row.ref.description)).toEqual([
    "Overboeking naar uw geldrekening bij flatexDEGIRO Bank: 23,24 EUR",
    "Degiro Cash Sweep Transfer",
    "Overboeking effecten",
    "Splitsing 2:1",
    "Overboeking van uw geldrekening bij flatexDEGIRO Bank 108,24 EUR",
  ]);
  // The sweep does have a Mutatie; it is skipped because its Saldo reports the
  // flatex-bank leg, not the imported account's cash.
  expect(skipped.filter((row) => row.ref.hasAmount).map((row) => row.ref.description)).toEqual([
    "Degiro Cash Sweep Transfer",
  ]);
  expect(skipped.map((row) => row.classification)).toEqual([
    informationLine(),
    informationLine(),
    informationLine(),
    informationLine(),
    informationLine(),
  ]);

  // The converse: every empty-Mutatie row is a skip, not an unknown cash flow.
  const emptyMutation = rows.filter((row) => !row.ref.hasAmount);
  expect(emptyMutation.map((row) => row.ref.description)).toEqual(
    skipped.filter((row) => !row.ref.hasAmount).map((row) => row.ref.description),
  );

  // Rule 1 is first: an empty amount wins even over a non-empty Order Id.
  expect(
    classifyAccountRow({ description: "Overboeking effecten", orderId: "0000", hasAmount: false }),
  ).toEqual(informationLine());
});

test("saldoWalk is false for exactly the sweep and the four information lines", () => {
  const rows = fixtureRows();
  const noWalk = rows
    .filter((row) => !row.classification.saldoWalk)
    .map((row) => row.ref.description);
  const information = rows.filter((row) => !row.ref.hasAmount).map((row) => row.ref.description);

  expect(noWalk).toHaveLength(5);
  expect(new Set(noWalk)).toEqual(new Set(["Degiro Cash Sweep Transfer", ...information]));
});

test("#317: every trade row carries an Order Id, and every dividend row does not", () => {
  const rows = fixtureRows();

  const trades = rows.filter((row) => row.classification.bucket === "trade");
  expect(trades).toHaveLength(10);
  for (const { ref, classification } of trades) {
    expect(ref.orderId).not.toBe("");
    expect(classification).toEqual(trade());
  }

  const dividends = rows.filter((row) => row.classification.bucket === "dividend");
  expect(dividends).toHaveLength(3);
  for (const { ref, classification } of dividends) {
    expect(ref.orderId).toBe("");
    expect(classification).toEqual(
      dividend(/^dividendbelasting/i.test(ref.description) ? "tax" : "gross"),
    );
  }
});

test("#316: `Dividendbelasting` is a dividend; the tax rule wins over the gross-dividend prefix", () => {
  const tax = classifyAccountRow({
    description: "Dividendbelasting",
    orderId: "",
    hasAmount: true,
  });
  expect(tax).toEqual(dividend("tax"));

  // Still a dividend when the text carries a suffix: the rule is a prefix, and a
  // looser `Dividend` rule must not label the tax as gross income by accident.
  expect(
    classifyAccountRow({ description: "Dividendbelasting 2026", orderId: "", hasAmount: true }),
  ).toEqual(tax);

  // Both shapes are #316 rows in the fixture.
  const descriptions = fixtureRows()
    .filter((row) => row.classification.bucket === "dividend")
    .map((row) => row.ref.description);
  expect(descriptions).toEqual(["Dividend", "Dividendbelasting", "Dividend"]);
});

test("a dividend stays a dividend even if it ever carried an Order Id", () => {
  expect(
    classifyAccountRow({
      description: "Dividend",
      orderId: "00000000-0000-4000-8000-000000000009",
      hasAmount: true,
    }),
  ).toEqual(dividend("gross"));
  expect(
    classifyAccountRow({ description: "Dividendbelasting", orderId: "0000", hasAmount: true }),
  ).toEqual(dividend("tax"));
});

test("#316: EN `Dividend tax` is a tax row, and non-dividend rows carry no dividend kind", () => {
  expect(classifyAccountRow({ description: "Dividend tax", orderId: "", hasAmount: true })).toEqual(
    dividend("tax"),
  );

  for (const row of [
    { description: "flatex Storting", orderId: "", hasAmount: true },
    { description: "Koop 1 @ 10,00 EUR", orderId: "", hasAmount: true },
    { description: "Overboeking effecten", orderId: "", hasAmount: false },
  ]) {
    expect(classifyAccountRow(row).dividendKind).toBeNull();
  }
});

test("reservation rows move real cash as kind other — never as a deposit", () => {
  const reservation = classifyAccountRow({
    description: "Reservation iDEAL / Sofort Deposit",
    orderId: "",
    hasAmount: true,
  });
  expect(reservation).toEqual(cashFlow("other"));

  const rows = fixtureRows();
  const reservations = rows.filter((row) => /^reservation/i.test(row.ref.description));
  expect(reservations).toHaveLength(2);
  expect(reservations.map((row) => row.classification)).toEqual([reservation, reservation]);

  // A reservation plus its later `iDEAL Deposit` must never count as two deposits.
  const reservationDeposits = rows.filter(
    (row) => row.classification.kind === "deposit" && /reservation/i.test(row.ref.description),
  );
  expect(reservationDeposits).toEqual([]);

  // The real deposits are the separate external rows, not the reservations.
  const deposits = rows.filter((row) => row.classification.kind === "deposit");
  expect(deposits.map((row) => row.ref.description)).toEqual([
    "iDEAL Deposit",
    "flatex Storting",
    "flatex Storting",
  ]);
});

test("an unknown description is a cash flow of kind other and never dropped", () => {
  const unknown = classifyAccountRow({
    description: "Onbekende boeking",
    orderId: "",
    hasAmount: true,
  });
  expect(unknown).toEqual({
    bucket: "cash-flow",
    kind: "other",
    dividendKind: null,
    recognised: false,
    saldoWalk: true,
  });

  // The fallback also covers an empty description: no wording is still a row.
  expect(classifyAccountRow({ description: "", orderId: "", hasAmount: true })).toEqual(unknown);

  // A known description reports itself as recognised.
  const known = classifyAccountRow({
    description: "flatex Storting",
    orderId: "",
    hasAmount: true,
  });
  expect(known.recognised).toBe(true);
  expect(known).toEqual(cashFlow("deposit"));
});

test("`DEGIRO Aansluitingskosten` matches by prefix, not by exact equality", () => {
  // The fee text carries a year and an exchange, so the match cannot be `===`.
  expect(
    classifyAccountRow({
      description: "DEGIRO Aansluitingskosten 2026 (Xetra - XET)",
      orderId: "",
      hasAmount: true,
    }),
  ).toEqual(cashFlow("fee"));
  expect(
    classifyAccountRow({
      description: "DEGIRO Aansluitingskosten 2027 (Nasdaq - NSQ)",
      orderId: "",
      hasAmount: true,
    }),
  ).toEqual(cashFlow("fee"));
  expect(
    classifyAccountRow({ description: "DEGIRO Aansluitingskosten", orderId: "", hasAmount: true }),
  ).toEqual(cashFlow("fee"));
});

test("an unknown description with an Order Id belongs to #317, not to the cash-flow fallback", () => {
  // The Order Id itself says "trade cash", whatever the wording. #317 parses the
  // text and reports its own problem; classification must not invent a cash flow.
  expect(
    classifyAccountRow({ description: "Kosten van iets", orderId: "0000", hasAmount: true }),
  ).toEqual(trade());
});

test("NL vocabulary outside the fixture: terugstorting, an orphan commission, case and spacing", () => {
  const classify = (description: string): AccountClassification =>
    classifyAccountRow({ description, orderId: "", hasAmount: true });

  expect(classify("flatex terugstorting")).toEqual(cashFlow("withdrawal"));
  // Without an Order Id a commission row cannot belong to a trade, so it is a fee.
  expect(classify("DEGIRO Transactiekosten en/of kosten van derden")).toEqual(cashFlow("fee"));
  // Description arrives trimmed, but classification must tolerate spacing and case.
  expect(classify("  FLATEX STORTING  ")).toEqual(cashFlow("deposit"));
  expect(classify("Rente")).toEqual(cashFlow("interest"));
  expect(classify("Verkoop 3 @ 55,5867 EUR")).toEqual(trade());
  expect(classify("Koop 1 @ 49,12 EUR")).toEqual(trade());
  expect(classify("Sell 1 @ 10,00 EUR")).toEqual(trade());
});

/* EN smoke test. The account statement has been observed in NL only, so these
 * names are forward-looking and prove nothing about a real English export; they
 * only keep the rows wired for the day one appears. */
test("EN smoke (unverified): deposit, withdrawal, currency legs and sweep", () => {
  const classify = (description: string): AccountClassification =>
    classifyAccountRow({ description, orderId: "", hasAmount: true });

  expect(classify("Deposit")).toEqual(cashFlow("deposit"));
  expect(classify("flatex Deposit")).toEqual(cashFlow("deposit"));
  expect(classify("Withdrawal")).toEqual(cashFlow("withdrawal"));
  expect(classify("Currency Credit")).toEqual(cashFlow("other"));
  expect(classify("Currency Debit")).toEqual(cashFlow("other"));
  // The sweep is a skip: the Saldo column reports the flatex-bank leg, so the
  // row is not cash of the imported account and emits nothing.
  expect(classify("Cash Sweep Transfer")).toEqual(informationLine());
});

test("guard: no sweep, FX leg or flatex transfer line is ever a deposit or a withdrawal", () => {
  // The two `Overboeking … bij flatexDEGIRO Bank` rows are the flatex transfer
  // lines; `Processed Flatex Withdrawal` is the real external withdrawal and is
  // deliberately outside this guard.
  const guarded = (description: string): boolean =>
    /sweep/i.test(description) ||
    /^valuta (creditering|debitering)\b/i.test(description) ||
    /^currency (credit|debit)\b/i.test(description) ||
    /^overboeking (van|naar) uw geldrekening\b/i.test(description);

  const rows = fixtureRows();
  expect(rows.some((row) => guarded(row.ref.description))).toBe(true);
  for (const { ref, classification } of rows) {
    if (!guarded(ref.description)) continue;
    expect(["deposit", "withdrawal"]).not.toContain(classification.kind);
    expect(classification.bucket).not.toBe("dividend");
  }

  // The same guard on built rows, for the FX legs the fixture only holds with an
  // Order Id and for the flatex transfer lines with their amount removed.
  const built = [
    "Degiro Cash Sweep Transfer",
    "Valuta Creditering",
    "Valuta Debitering",
    "Currency Credit",
    "Currency Debit",
    "Overboeking van uw geldrekening bij flatexDEGIRO Bank 1,00 EUR",
    "Overboeking naar uw geldrekening bij flatexDEGIRO Bank: 1,00 EUR",
  ];
  for (const description of built) {
    const { kind } = classifyAccountRow({ description, orderId: "", hasAmount: true });
    expect(["deposit", "withdrawal"]).not.toContain(kind);
  }
});
