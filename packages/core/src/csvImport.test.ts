import { describe, expect, test } from "vitest";
import type { Tx } from "./model.js";
import {
  applyGenericImport,
  detectDelimiter,
  detectGenericMapping,
  importFormatsFor,
  parseGenericRows,
  planGenericImport,
  revertImport,
  rowsFromCsv,
  type ImportSession,
} from "./csvImport.js";
import { assignTxIds } from "./hash.js";

/**
 * WS3.6 acceptance evidence (issue #294):
 *
 *  - a CSV maps, previews (dry run), imports and reverts;
 *  - the SAME file re-imported is detected within the same format, not doubled;
 *  - a SECOND format for the same account warns and is refused by default
 *    (CONTEXT: CSV + MT940 double-count);
 *  - revert removes exactly the records the import created (counts before and
 *    after, nothing else touched);
 *  - every rejected row carries a reason, and amounts keep integer cents.
 *
 * The file below is a Dutch generic export: header row, semicolons, Dutch
 * amounts, one bad date and one missing amount.
 */

const CSV = [
  "Datum;Tegenpartij;Omschrijving;Bedrag;Valuta",
  "2026-10-02;Albert Heijn;Boodschappen;-25,50;EUR",
  "2026-10-03;Werkgever;Salaris;2000,00;EUR",
  "2026-10-04;KPN;Internet;-49,99;EUR",
  "2026-10-05;Jumbo;Boodschappen;-12,34;EUR",
  "geen-datum;Onbekend;Zonder datum;-10,00;EUR",
  "2026-10-07;Onbekend;Zonder bedrag;;EUR",
].join("\n");

const parse = () => {
  const delimiter = detectDelimiter(CSV);
  const { headers, rows } = rowsFromCsv(CSV, delimiter);
  const guess = detectGenericMapping({ headers, sampleRows: rows, text: CSV });
  return { delimiter, headers, rows, guess };
};

const session = (overrides: Partial<ImportSession> = {}): ImportSession => ({
  id: "s0",
  documentId: null,
  filename: "export.csv",
  accountKey: "NL01INGB",
  format: "mt940",
  importedAt: "2026-11-01",
  txIds: [],
  rowsRead: 0,
  rowsImported: 0,
  duplicatesSkipped: 0,
  rowsRejected: 0,
  ...overrides,
});

describe("mapping and dry run", () => {
  test("the delimiter and all five columns are detected from the header", () => {
    const { delimiter, guess } = parse();
    expect(delimiter).toBe(";");
    expect(guess.mapping).toMatchObject({
      dateColumn: 0,
      amountColumn: 3,
      counterpartyColumn: 1,
      descriptionColumn: 2,
      currencyColumn: 4,
      dateOrder: "DMY",
    });
    expect(guess.confidence).toBe(1);
    expect(guess.sources).toContain("header:date");
  });

  test("the dry run counts parsed, rejected (with line + reason) and new rows", () => {
    const { rows, guess } = parse();
    const plan = planGenericImport({
      rows,
      mapping: guess.mapping,
      accountKey: "NL01INGB",
      existingTxs: [],
      sessions: [],
      format: "generic-csv",
    });
    expect(plan.rowsRead).toBe(6);
    expect(plan.parsed).toHaveLength(4);
    expect(plan.rejected).toEqual([
      {
        line: 6,
        reason: "date",
        cells: ["geen-datum", "Onbekend", "Zonder datum", "-10,00", "EUR"],
      },
      { line: 7, reason: "amount", cells: ["2026-10-07", "Onbekend", "Zonder bedrag", "", "EUR"] },
    ]);
    expect(plan.newRows).toHaveLength(4);
    expect(plan.newRows[0]).toMatchObject({
      date: "2026-10-02",
      amount: -25.5,
      counterparty: "Albert Heijn",
      description: "Boodschappen",
      currency: "EUR",
    });
    expect(plan.blocked).toBeNull();
  });

  test("a debit/credit pair maps to signed amounts without an amount column", () => {
    const text = [
      "Datum;Naam;Af;Bij",
      "2026-10-02;Huur;1200,00;",
      "2026-10-03;Salaris;;2500,00",
    ].join("\n");
    const { headers, rows } = rowsFromCsv(text, ";");
    const guess = detectGenericMapping({ headers, sampleRows: rows, text });
    expect(guess.mapping).toMatchObject({
      dateColumn: 0,
      amountColumn: null,
      debitColumn: 2,
      creditColumn: 3,
    });
    const { parsed } = parseGenericRows(rows, guess.mapping);
    expect(parsed.map((row) => row.amount)).toEqual([-1200, 2500]);
  });

  test("an inverted signed column and a month-first date order are honoured", () => {
    const text = [
      "date;name;amount",
      "10/25/2026;Huur;1200.00",
      "10/26/2026;Salaris;-2500.00",
    ].join("\n");
    const { headers, rows } = rowsFromCsv(text, ";");
    const guess = detectGenericMapping({ headers, sampleRows: rows, text });
    expect(guess.mapping.dateOrder).toBe("MDY");
    const { parsed } = parseGenericRows(rows, { ...guess.mapping, invertAmount: true });
    expect(parsed[0]).toMatchObject({ date: "2026-10-25", amount: -1200 });
    expect(parsed[1]).toMatchObject({ date: "2026-10-26", amount: 2500 });
  });
});

describe("import, re-import and cross-format refusal", () => {
  const baseInput = () => {
    const { rows, guess } = parse();
    return {
      rows,
      mapping: guess.mapping,
      accountKey: "NL01INGB",
      sessions: [] as ImportSession[],
    };
  };

  test("import creates exactly the new rows and records the session", () => {
    const input = baseInput();
    const plan = planGenericImport({ ...input, existingTxs: [], format: "generic-csv" });
    const result = applyGenericImport({
      existingTxs: [],
      plan,
      id: "session-1",
      filename: "export.csv",
      asOf: "2026-11-11",
      documentId: "sha-csv",
    });
    expect(result.txs).toHaveLength(4);
    expect(result.importedIds).toHaveLength(4);
    expect(result.session).toMatchObject({
      id: "session-1",
      documentId: "sha-csv",
      format: "generic-csv",
      rowsRead: 6,
      rowsImported: 4,
      rowsRejected: 2,
      duplicatesSkipped: 0,
    });
    expect(result.session.txIds).toEqual(result.importedIds);
    // Integer cents survive the boundary (ADR 0011): the stored amounts are
    // euros with two decimals, and no rounding text leaks in.
    expect(result.txs.map((tx) => tx.amount).sort((a, b) => a - b)).toEqual([
      -49.99, -25.5, -12.34, 2000,
    ]);
    expect(result.txs.every((tx) => Number.isFinite(tx.amount))).toBe(true);
  });

  test("the SAME file re-imported is detected within the same format, not doubled", () => {
    const input = baseInput();
    const first = applyGenericImport({
      existingTxs: [],
      plan: planGenericImport({ ...input, existingTxs: [], format: "generic-csv" }),
      id: "session-1",
      filename: "export.csv",
      asOf: "2026-11-11",
    });
    const secondPlan = planGenericImport({
      ...input,
      existingTxs: first.txs,
      sessions: [first.session],
      format: "generic-csv",
    });
    expect(secondPlan.duplicatesOnFile).toBe(4);
    expect(secondPlan.newRows).toHaveLength(0);
    expect(secondPlan.blocked).toBeNull(); // same format is never blocked
    const second = applyGenericImport({
      existingTxs: first.txs,
      plan: secondPlan,
      id: "session-2",
      filename: "export.csv",
      asOf: "2026-11-11",
    });
    expect(second.importedIds).toHaveLength(0);
    expect(second.txs).toHaveLength(4); // nothing doubled
    expect(second.session.rowsImported).toBe(0);
  });

  test("a repeat inside one file is a real second movement, not a duplicate", () => {
    const text = [
      "Datum;Tegenpartij;Omschrijving;Bedrag",
      "2026-10-02;Koffie;Koffie;-3,50",
      "2026-10-02;Koffie;Koffie;-3,50",
    ].join("\n");
    const { headers, rows } = rowsFromCsv(text, ";");
    const guess = detectGenericMapping({ headers, sampleRows: rows, text });
    const plan = planGenericImport({
      rows,
      mapping: guess.mapping,
      accountKey: "NL01INGB",
      existingTxs: [],
      sessions: [],
      format: "generic-csv",
    });
    expect(plan.newRows).toHaveLength(2);
    const result = applyGenericImport({
      existingTxs: [],
      plan,
      id: "s",
      filename: "koffie.csv",
      asOf: "2026-11-11",
    });
    expect(result.txs).toHaveLength(2);
    // Re-importing both: both are on file now, neither doubles.
    const again = planGenericImport({
      rows,
      mapping: guess.mapping,
      accountKey: "NL01INGB",
      existingTxs: result.txs,
      sessions: [result.session],
      format: "generic-csv",
    });
    expect(again.duplicatesOnFile).toBe(2);
    expect(again.newRows).toHaveLength(0);
  });

  test("a SECOND format for the same account warns and is refused by default", () => {
    const input = baseInput();
    const existing: Tx[] = assignTxIds([
      {
        accountKey: "NL01INGB",
        date: "2026-10-02",
        amount: -25.5,
        currency: "EUR",
        counterparty: "Albert Heijn",
        description: "Boodschappen",
        category: "",
        manual: false,
      },
    ]);
    const plan = planGenericImport({
      ...input,
      existingTxs: existing,
      sessions: [session({ format: "mt940" })],
      format: "generic-csv",
    });
    expect(plan.blocked).toEqual({ reason: "cross-format", formats: ["mt940"] });
    expect(plan.warnings).toEqual([{ kind: "cross-format", formats: ["mt940"] }]);
    expect(plan.newRows).toEqual([]);
    expect(() =>
      applyGenericImport({
        existingTxs: existing,
        plan,
        id: "s",
        filename: "export.csv",
        asOf: "2026-11-11",
      }),
    ).toThrow(/blocked/);
    // The owner may override explicitly after reading the warning.
    const allowed = planGenericImport({
      ...input,
      existingTxs: existing,
      sessions: [session({ format: "mt940" })],
      format: "generic-csv",
      allowCrossFormat: true,
    });
    expect(allowed.blocked).toBeNull();
    // The override skips the one row the ledger genuinely already holds (same
    // coordinates) and imports the rest: honest dedupe, not a blanket pass.
    expect(allowed.duplicatesOnFile).toBe(1);
    expect(allowed.newRows).toHaveLength(3);
    expect(importFormatsFor([session({ format: "mt940" })], "NL01INGB")).toEqual(["mt940"]);
  });

  test("CSV and XLSX are two formats too: a second generic format is refused", () => {
    const input = baseInput();
    const plan = planGenericImport({
      ...input,
      existingTxs: [],
      sessions: [session({ format: "generic-xlsx" })],
      format: "generic-csv",
    });
    expect(plan.blocked).toEqual({ reason: "cross-format", formats: ["generic-xlsx"] });
  });

  test("another account's rows never make this import look like a duplicate", () => {
    const input = baseInput();
    const other = assignTxIds([
      {
        accountKey: "ANDER",
        date: "2026-10-02",
        amount: -25.5,
        currency: "EUR",
        counterparty: "Albert Heijn",
        description: "Boodschappen",
        category: "",
        manual: false,
      },
    ]);
    const plan = planGenericImport({ ...input, existingTxs: other, format: "generic-csv" });
    expect(plan.duplicatesOnFile).toBe(0);
    expect(plan.newRows).toHaveLength(4);
  });
});

describe("revert removes exactly what the import created", () => {
  const imported = () => {
    const { rows, guess } = parse();
    const plan = planGenericImport({
      rows,
      mapping: guess.mapping,
      accountKey: "NL01INGB",
      existingTxs: [],
      sessions: [],
      format: "generic-csv",
    });
    return applyGenericImport({
      existingTxs: [],
      plan,
      id: "session-1",
      filename: "export.csv",
      asOf: "2026-11-11",
      documentId: "sha-csv",
    });
  };

  test("counts before and after match, and nothing else is touched", () => {
    const before = assignTxIds([
      {
        accountKey: "NL01INGB",
        date: "2026-09-01",
        amount: -10,
        currency: "EUR",
        counterparty: "Bestaand",
        description: "Rij",
        category: "",
        manual: false,
      },
    ]);
    const result = imported();
    const combined = [...before, ...result.txs];
    const reverted = revertImport({
      txs: combined,
      sessions: [result.session],
      sessionId: "session-1",
    });
    expect(reverted.removedIds).toHaveLength(4);
    expect(reverted.txs).toHaveLength(before.length);
    expect(reverted.txs.map((tx) => tx.id)).toEqual(before.map((tx) => tx.id));
    expect(reverted.session?.id).toBe("session-1");
    expect(reverted.documentId).toBe("sha-csv");
  });

  test("a row that changed since the import is not invented back; revert is exact on what remains", () => {
    const result = imported();
    // One imported row was merged/replaced since: its id is gone.
    const changed = result.txs.slice(1);
    const reverted = revertImport({
      txs: changed,
      sessions: [result.session],
      sessionId: "session-1",
    });
    expect(reverted.removedIds).toHaveLength(3);
    expect(reverted.txs).toHaveLength(0);
  });

  test("reverting an unknown session is a no-op, not a guess", () => {
    const result = imported();
    const reverted = revertImport({ txs: result.txs, sessions: [], sessionId: "ghost" });
    expect(reverted.txs).toHaveLength(result.txs.length);
    expect(reverted.removedIds).toEqual([]);
    expect(reverted.session).toBeNull();
  });
});
