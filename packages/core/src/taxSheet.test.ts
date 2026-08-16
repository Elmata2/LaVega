import { expect, test } from "vitest";
import {
  periodStart,
  readSheetCsv,
  readSheetRows,
  readTaxSheet,
  suggestTaxSheetMapping,
  sumTaxFigures,
  taxSheetMappingFacts,
  TAX_SHEET_FIELD_LABELS,
} from "./taxSheet.js";
import { AGENTS } from "./agentFacts.js";
import { makeFact, upsertFacts } from "./facts.js";

/* A sheet the way an owner actually keeps one: Dutch headers, a column LaVega
 * has no use for, an amount with a thousands separator, a blank spacer row. */
const SHEET = `Maand;Omzet excl. btw;Kosten;Btw over omzet;Voorbelasting;Opmerking
2026-04;12.100,00;2.420,00;2.541,00;508,20;normale maand
2026-05;8.000,00;1.000,00;1.680,00;210,00;
;;;;;
2026-07;9.000,00;900,00;1.890,00;189,00;buiten Q2
`;

test("readSheetCsv sniffs the delimiter and splits header from data", () => {
  const t = readSheetCsv(SHEET);
  expect(t.header).toEqual(["Maand", "Omzet excl. btw", "Kosten", "Btw over omzet", "Voorbelasting", "Opmerking"]);
  expect(t.rows).toHaveLength(3);
  expect(t.rows[0][1]).toBe("12.100,00");
});

test("readSheetRows takes cells from anywhere (an XLSX worksheet, a pasted table)", () => {
  const t = readSheetRows([["Periode", "Omzet"], ["", ""], ["2026-04", "100"]]);
  expect(t.header).toEqual(["Periode", "Omzet"]);
  expect(t.rows).toEqual([["2026-04", "100"]]);
});

test("the first import is guessed from the header, in his language", () => {
  const { header } = readSheetCsv(SHEET);
  expect(suggestTaxSheetMapping(header)).toEqual({
    period: "Maand",
    revenue: "Omzet excl. btw",
    expenses: "Kosten",
    vatCharged: "Btw over omzet",
    vatPaid: "Voorbelasting",
  });
});

test("German and English headers are guessed too — the sheet may be the accountant's", () => {
  const de = suggestTaxSheetMapping(["Monat", "Umsatz", "Aufwand", "Gewinn", "Umsatzsteuer", "Vorsteuer"]);
  expect(de).toEqual({
    period: "Monat", revenue: "Umsatz", expenses: "Aufwand", profit: "Gewinn",
    vatCharged: "Umsatzsteuer", vatPaid: "Vorsteuer",
  });
  const en = suggestTaxSheetMapping(["Month", "Revenue", "Costs", "Profit"]);
  expect(en).toMatchObject({ period: "Month", revenue: "Revenue", expenses: "Costs", profit: "Profit" });
});

test("readTaxSheet maps the columns onto cents and says what it could not find", () => {
  const table = readSheetCsv(SHEET);
  const { rows, problems } = readTaxSheet(table, suggestTaxSheetMapping(table.header));

  expect(rows).toHaveLength(3);
  expect(rows[0]).toEqual({
    period: "2026-04",
    date: "2026-04-01",
    revenueCents: 1_210_000,
    expensesCents: 242_000,
    profitCents: null, // this sheet has no profit column
    vatChargedCents: 254_100,
    vatPaidCents: 50_820,
  });
  expect(problems).toEqual([`geen kolom gekoppeld voor: ${TAX_SHEET_FIELD_LABELS.profit}`]);
});

test("a period is read as a period, whatever the owner writes", () => {
  expect(periodStart("2026-04")).toBe("2026-04-01");
  expect(periodStart("Q2 2026")).toBe("2026-04-01");
  expect(periodStart("2026-Q2")).toBe("2026-04-01");
  expect(periodStart("apr 2026")).toBe("2026-04-01");
  expect(periodStart("April 2026")).toBe("2026-04-01");
  expect(periodStart("2026")).toBe("2026-01-01");
  expect(periodStart("30-06-2026")).toBe("2026-06-30");
  expect(periodStart("totaal")).toBeNull();
});

test("sumTaxFigures totals one window and never turns 'unknown' into zero", () => {
  const table = readSheetCsv(SHEET);
  const { rows } = readTaxSheet(table, suggestTaxSheetMapping(table.header));
  const q2 = sumTaxFigures(rows, "2026-04-01", "2026-06-30");

  expect(q2.rowCount).toBe(2); // July stayed out
  expect(q2.revenueCents).toBe(2_010_000);
  expect(q2.expensesCents).toBe(342_000);
  expect(q2.profitCents).toBe(1_668_000); // no profit column -> revenue - expenses, his own arithmetic
  expect(q2.vatChargedCents).toBe(422_100);
  expect(q2.vatPaidCents).toBe(71_820);

  const empty = sumTaxFigures(rows, "2030-01-01", "2030-12-31");
  expect(empty.rowCount).toBe(0);
  expect(empty.revenueCents).toBeNull();
  expect(empty.profitCents).toBeNull();
});

test("a row with no readable period is kept but never counted, and reported", () => {
  const table = readSheetRows([["Periode", "Omzet"], ["totaal", "1000"], ["2026-04", "100"]]);
  const { rows, problems } = readTaxSheet(table, { period: "Periode", revenue: "Omzet" });
  expect(rows).toHaveLength(2);
  expect(rows[0].date).toBeNull();
  expect(problems.some((p) => p.includes("zonder leesbare periode"))).toBe(true);
  expect(sumTaxFigures(rows, "2026-01-01", "2026-12-31").revenueCents).toBe(10_000);
});

/* ── the second import is one click ───────────────────────────────────────
 * The mapping the owner confirmed is stored as LearnedFacts in the `belasting`
 * namespace, under the same guard as every other fact. */

test("a confirmed mapping survives the fact guard and comes back next time", () => {
  const header = ["Maand", "Omzet incl. btw", "Omzet excl. btw", "Kosten"];
  // the guess picks the wrong turnover column — it is simply the first match
  expect(suggestTaxSheetMapping(header).revenue).toBe("Omzet incl. btw");

  // the owner corrects it, and that mapping is remembered
  const corrected = { ...suggestTaxSheetMapping(header), revenue: "Omzet excl. btw" };
  const facts = upsertFacts([], taxSheetMappingFacts(corrected, "2026-08-16"));
  expect(facts).toHaveLength(3); // period, revenue, expenses — no profit/vat column in this sheet
  expect(facts.every((f) => f.agent === AGENTS.belasting && f.key === "kolom" && f.source === "user")).toBe(true);

  // next import of the same sheet: one click, and the correction stuck
  expect(suggestTaxSheetMapping(header, facts).revenue).toBe("Omzet excl. btw");

  // a re-guess can never overwrite what he said (the learning rule)
  const reguessed = upsertFacts(facts, taxSheetMappingFacts(suggestTaxSheetMapping(header), "2026-09-01")
    .map((f) => ({ ...f, source: "agent" as const })));
  expect(suggestTaxSheetMapping(header, reguessed).revenue).toBe("Omzet excl. btw");
});

test("a remembered column that this sheet does not have gets out of the way", () => {
  const facts = upsertFacts([], taxSheetMappingFacts({ revenue: "Omzet excl. btw" }, "2026-08-16"));
  const other = suggestTaxSheetMapping(["Month", "Revenue", "Costs"], facts);
  expect(other.revenue).toBe("Revenue");
});

test("what is remembered is WHERE a figure lives, never the figure", () => {
  // a header that is itself an amount is refused by the guard, so it can never
  // reach the vault via the mapping
  const poisoned = taxSheetMappingFacts({ revenue: "12.450,00" }, "2026-08-16");
  expect(upsertFacts([], poisoned)).toEqual([]);
  // and the facts that do land carry no numbers of his at all
  const good = upsertFacts([], taxSheetMappingFacts({ revenue: "Omzet 2026" }, "2026-08-16"));
  expect(good.map((f) => f.value)).toEqual(["Omzet 2026"]);
});

test("makeFact ids are stable per field, so a re-confirmed mapping upserts in place", () => {
  const a = taxSheetMappingFacts({ revenue: "Omzet" }, "2026-08-16");
  const b = taxSheetMappingFacts({ revenue: "Netto omzet" }, "2026-09-01");
  expect(a[0].id).toBe(b[0].id);
  expect(a[0].id).toBe(makeFact({ agent: AGENTS.belasting, subject: "revenue", key: "kolom", value: "x", source: "user", updatedAt: "" }).id);
  expect(upsertFacts(a, b)).toHaveLength(1);
});
