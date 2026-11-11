import { describe, expect, test } from "vitest";
import type { Account, Invoice, ScheduledFlow, Tx } from "../model.js";
import type { Bill, BillOccurrence } from "../bills/model.js";
import type { Valuation } from "../balance.js";
import type { VaultDocument } from "../statements/types.js";
import {
  LAVEGA_EXPORT_VERSION,
  buildAndVerifyLavegaExport,
  buildLavegaExport,
  lavegaExportFilename,
  parseCsv,
  readLavegaExport,
} from "./export.js";
import { buildStoreZip, utf8Bytes } from "./zip.js";

/* WS6.1 acceptance: the archive is portable AND readable back. Every test here
 * is synthetic (plan §2.6): no real account, counterparty, IBAN or amount from
 * the owner's vault appears. */

const SAMPLE_ACCOUNTS: Account[] = [
  {
    key: "B1",
    iban: "NL00TEST0000000001",
    name: "Testrekening",
    bank: "Testbank",
    type: "Betaal",
    entity: "Prive",
    currency: "EUR",
    balance: 1234.56,
    balanceDate: "2026-11-11",
  },
  {
    key: "S1",
    iban: "NL00TEST0000000002",
    name: "Test Spaar",
    bank: "Testbank",
    type: "Spaar",
    entity: "Prive",
    currency: "EUR",
    balance: null,
  },
];

const SAMPLE_TXS: Tx[] = [
  {
    id: "tx-1",
    accountKey: "B1",
    date: "2026-11-01",
    amount: -34.56,
    currency: "EUR",
    counterparty: "Leverancier A, met komma",
    description: 'Notitie met "quote"',
    category: "Wonen",
    manual: false,
    excluded: false,
    pending: false,
  },
  {
    id: "tx-2",
    accountKey: "B1",
    date: "2026-10-25",
    amount: 3800,
    currency: "EUR",
    counterparty: "Werkgever",
    description: "Salaris",
    category: "Inkomen",
    manual: true,
    notes: "synthetisch",
    tags: ["salaris"],
  },
];

const SAMPLE_BILLS: Bill[] = [
  {
    id: "b-1",
    name: "Rekening A",
    type: "bill",
    status: "active",
    direction: "out",
    amountCents: 10_000,
    amountStrategy: "fixed",
    currency: "EUR",
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 1 }],
    anchorDate: "2026-01-01",
    weekendAdjust: "none",
    endMode: "never",
    tags: [],
    accountKey: "B1",
  },
];

const SAMPLE_OCCURRENCES: BillOccurrence[] = [
  {
    id: "b-1|2026-11-01",
    billId: "b-1",
    originalDueOn: "2026-11-01",
    dueOn: "2026-11-01",
    currency: "EUR",
    expectedAmountCents: null,
    status: "scheduled",
  },
];

const SAMPLE_FLOWS: ScheduledFlow[] = [
  {
    id: "flow-1",
    entity: "Prive",
    label: "Testflow",
    sign: -1,
    amountCents: 5000,
    dueDate: "2026-12-01",
    source: "manual",
    status: "expected",
  },
];

const SAMPLE_INVOICES: Invoice[] = [
  {
    id: "inv-1",
    entity: "Prive",
    direction: "out",
    counterparty: "Leverancier B",
    issueDate: "2026-11-01",
    dueDate: "2026-11-30",
    amount: 99.95,
    vatAmount: 17.35,
    currency: "EUR",
    status: "expected",
    sourceType: "manual",
  },
];

const SAMPLE_VALUATIONS: Valuation[] = [
  {
    id: "B1|2026-11-01",
    accountKey: "B1",
    date: "2026-11-01",
    amountCents: 123_456,
    currency: "EUR",
    kind: "opening",
    source: "import",
    createdAt: "2026-11-01",
  },
];

const SAMPLE_DOCUMENTS: VaultDocument[] = [
  {
    id: "sha-1",
    sha256: "sha-1",
    filename: "testrekening-2026-10.csv",
    mime: "text/csv",
    byteSize: 2048,
    kind: "statement",
    source: "manual-upload",
    uploadedAt: "2026-10-31",
    periodFrom: "2026-10-01",
    periodTo: "2026-10-31",
    currency: "EUR",
    accountKey: "B1",
    suggestedAccountKey: "B1",
    matchConfidence: 1,
    accountLast4: "0001",
    institutionHint: "Testbank",
    accountNameHint: "Testrekening",
    openingBalanceCents: null,
    closingBalanceCents: 123_456,
    reviewStatus: "linked",
    metadataSources: ["owner"],
  },
];

function sampleInput() {
  return {
    createdAt: "2026-11-11",
    appVersion: "0.0.0-test",
    accounts: SAMPLE_ACCOUNTS,
    transactions: SAMPLE_TXS,
    rules: [],
    transfers: [
      {
        id: "pair-1",
        outflowTxId: "tx-1",
        inflowTxId: "tx-2",
        status: "confirmed" as const,
        kind: "funds_movement" as const,
        amountCents: 34_560,
        currency: "EUR",
        createdAt: "2026-11-01",
        decidedAt: "2026-11-02",
      },
    ],
    merchants: [{ key: "leverancier a", name: "Leverancier A", aliases: ["LEVERANCIER A"] }],
    bills: SAMPLE_BILLS,
    billOccurrences: SAMPLE_OCCURRENCES,
    billDecisions: {
      matches: [
        {
          id: "b-1|2026-11-01|tx-1",
          occurrenceId: "b-1|2026-11-01",
          billId: "b-1",
          txId: "tx-1",
          amountCents: 10_000,
          currency: "EUR",
          source: "user" as const,
          confidence: 1,
          decidedAt: "2026-11-01",
        },
      ],
      marks: [],
      rejections: [],
      priceChanges: [],
    },
    budgetPeriods: [],
    categoryGroups: [{ name: "Wonen", categories: ["Wonen"] }],
    scheduledFlows: SAMPLE_FLOWS,
    invoices: SAMPLE_INVOICES,
    vatSettings: [],
    valuations: SAMPLE_VALUATIONS,
    importSessions: [],
    documents: SAMPLE_DOCUMENTS,
    fxHistory: {
      USD: { "2026-11-10": 1.07 },
      HUF: { "2026-11-09": 390.5, "2026-11-10": 391 },
    },
  };
}

describe("build + readback", () => {
  test("round-trips the rows with cents at the boundary and the manifest counts", () => {
    const built = buildAndVerifyLavegaExport(sampleInput());
    expect(built.readback.ok).toBe(true);
    expect(built.readback.problems).toEqual([]);
    expect(built.manifest.version).toBe(LAVEGA_EXPORT_VERSION);

    const accounts = built.readback.sections.accounts as Array<Record<string, unknown>>;
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      key: "B1",
      name: "Testrekening",
      balanceCents: 123_456, // EUR 1234,56 -> cents
      entity: "Prive",
    });
    expect(accounts[1].balanceCents).toBeNull(); // unknown stays null, never 0

    const txs = built.readback.sections.transactions as Array<Record<string, unknown>>;
    expect(txs).toHaveLength(2);
    expect(txs[0]).toMatchObject({
      id: "tx-1",
      accountKey: "B1",
      date: "2026-11-01",
      amountCents: -3456, // sign preserved, ADR 0011
      currency: "EUR",
      category: "Wonen",
    });
    expect(txs[1]).toMatchObject({ id: "tx-2", amountCents: 380_000, manual: true });
    expect(txs[1].tags).toEqual(["salaris"]);

    // Section counts come from the manifest and match the parsed rows.
    expect(built.manifest.recordCounts.transactions).toBe(2);
    expect(built.manifest.recordCounts.recurring_transactions).toBe(1);
    expect(built.manifest.sections.find((s) => s.name === "transactions")?.rows).toBe(2);

    // Money-bearing foreign records keep their integer cents.
    const invoices = built.readback.sections.invoices as Array<Record<string, unknown>>;
    expect(invoices[0]).toMatchObject({ amountCents: 9995, vatAmountCents: 1735 });
    const valuations = built.readback.sections.valuations as Array<Record<string, unknown>>;
    expect(valuations[0]).toMatchObject({ amountCents: 123_456, accountKey: "B1" });

    // FX history is one row per currency/day, sorted, not a nested blob.
    const fx = built.readback.sections.fx_history as Array<Record<string, unknown>>;
    expect(fx).toEqual([
      { currency: "HUF", date: "2026-11-09", unitsPerEur: 390.5 },
      { currency: "HUF", date: "2026-11-10", unitsPerEur: 391 },
      { currency: "USD", date: "2026-11-10", unitsPerEur: 1.07 },
    ]);
  });

  test("the CSV companions parse back with the promised rows and quoting", () => {
    const built = buildAndVerifyLavegaExport(sampleInput());
    const accountRows = built.readback.csv.accounts;
    const transactionRows = built.readback.csv.transactions;
    expect(accountRows).toHaveLength(3); // header + 2
    expect(transactionRows).toHaveLength(3);
    expect(transactionRows[0]).toEqual([
      "id",
      "accountKey",
      "date",
      "amountCents",
      "currency",
      "counterparty",
      "description",
      "category",
      "manual",
      "excluded",
      "pending",
    ]);
    // Comma and quotes survive the CSV round-trip.
    expect(transactionRows[1][5]).toBe("Leverancier A, met komma");
    expect(transactionRows[1][6]).toBe('Notitie met "quote"');
    expect(transactionRows[1][3]).toBe("-3456");
    expect(built.manifest.csvFiles.map((file) => file.rows)).toEqual([2, 2]);
  });

  test("document metadata travels, the bytes and credentials do not", () => {
    const built = buildAndVerifyLavegaExport(sampleInput());
    const documents = built.readback.sections.document_index as Array<Record<string, unknown>>;
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ sha256: "sha-1", filename: "testrekening-2026-10.csv" });
    expect(documents[0]).not.toHaveProperty("bytes");
    expect(built.manifest.binaries.documents.included).toBe(false);
    expect(built.manifest.excluded.map((entry) => entry.name)).toContain("document_bytes");
    expect(built.manifest.excluded.map((entry) => entry.name)).toContain("credentials");
    expect(built.manifest.importNote).toContain("does not promise cross-format dedupe");
  });

  test("an empty vault exports and reads back, with zero counts (not missing files)", () => {
    const built = buildAndVerifyLavegaExport({
      createdAt: "2026-11-11",
      accounts: [],
      transactions: [],
    });
    expect(built.readback.ok).toBe(true);
    expect(Object.values(built.manifest.recordCounts).every((count) => count === 0)).toBe(true);
    expect(built.manifest.sections).toHaveLength(20);
  });

  test("identical input produces identical bytes", () => {
    const first = buildLavegaExport(sampleInput());
    const second = buildLavegaExport(sampleInput());
    expect(Array.from(first.bytes)).toEqual(Array.from(second.bytes));
  });

  test("the file name carries the creation day", () => {
    expect(lavegaExportFilename("2026-11-11")).toBe("lavega-export-2026-11-11.zip");
  });
});

describe("corruption and foreign archives", () => {
  test("a flipped data byte fails the CRC check instead of reading silently", () => {
    const { bytes } = buildLavegaExport(sampleInput());
    const corrupted = bytes.slice();
    // The first data byte after the manifest's local header + name: find the
    // '[' of a JSON array and flip it.
    const index = corrupted.findIndex((byte) => byte === 0x5b); // '['
    expect(index).toBeGreaterThan(0);
    corrupted[index] = 0x7b; // '{'
    expect(() => readLavegaExport(corrupted)).toThrow(/CRC/);
  });

  test("an archive with an unknown export version reads back as not ok", () => {
    const manifest = {
      format: "lavega-export",
      version: 99,
      createdAt: "2026-11-11",
      generator: { app: "lavega" },
      vocabulary: "sure-record-v1",
      money: "integer cents (ADR 0011)",
      recordCounts: {},
      sections: [],
      csvFiles: [],
      excluded: [],
      binaries: { documents: { included: false, reason: "test" } },
      importNote: "test",
    };
    const bytes = buildStoreZip([
      { path: "manifest.json", bytes: utf8Bytes(JSON.stringify(manifest)) },
    ]);
    const readback = readLavegaExport(bytes);
    expect(readback.ok).toBe(false);
    expect(readback.problems.join("\n")).toContain("exportversie 99");
  });

  test("the CSV reader handles an empty field and a trailing newline", () => {
    expect(parseCsv("a,b\n1,\n")).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
  });
});
