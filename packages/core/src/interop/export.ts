/**
 * LaVega portable export (WS6.1, issue #302).
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure sources: the export/interop vocabulary in `docs/research/sure/
 * 02-platform-ai.md` §4 (their NDJSON/CSV export shapes and family export
 * endpoint); no Ruby is copied. The record vocabulary is adapted where it fits
 * (accounts, transactions, transfers, recurring_transactions/occurrences/
 * allocations, budget rows); LaVega's own fields are kept where Sure has no
 * equivalent.
 *
 * WHY. The `.lavega` back-up is an encrypted vault blob: restorable, but not
 * portable. This module produces a plain, readable archive the owner can keep
 * or hand to a tool: a versioned ZIP containing a manifest, one NDJSON file per
 * record type, and two CSV companions (accounts, transactions). Money crosses
 * this boundary as integer cents (ADR 0011); the vault's decimal euros stay
 * untouched. Nothing here reads storage, the clock, or the filesystem: the
 * browser builds the bytes from the open vault and the caller downloads them.
 *
 * READBACK IS THE ACCEPTANCE. `readLavegaExport` parses the very bytes this
 * module writes (CRC-checked by `zip.ts`), validates the manifest against the
 * actual row counts and re-checks the CSV companions. A file that downloads is
 * not proof; reading it back into the same rows is.
 *
 * WHAT IS NOT IN THE ARCHIVE, stated in the manifest instead of silently
 * dropped: sealed document BYTES (they live in the encrypted `.lavega` bundle;
 * the archive carries the document index only), credentials, the assistant
 * memory store and the encrypted vault blob itself. Cross-format dedupe is not
 * promised: re-importing this archive is a future importer's job, and the
 * manifest says so.
 */
import type { Account, Invoice, Rule, ScheduledFlow, Tx, VatSettings } from "../model.js";
import type { Merchant } from "../labels.js";
import type { TransferPair } from "../transfers.js";
import type { Bill, BillDecisions, BillOccurrence } from "../bills/model.js";
import type { BudgetPeriod, CategoryGroup } from "../budget.js";
import type { Valuation } from "../balance.js";
import type { ImportSession } from "../csvImport.js";
import type { VaultDocument } from "../statements/types.js";
import { buildStoreZip, readStoreZip, utf8Bytes, utf8Text, type ZipEntry } from "./zip.js";

/* ── Version and names ───────────────────────────────────────────────────── */

/** Bump only for a breaking change to the archive layout; readers refuse an
 *  unknown major version instead of guessing. */
export const LAVEGA_EXPORT_FORMAT = "lavega-export";
export const LAVEGA_EXPORT_VERSION = 1;

/** The plain-data sections, named after the Sure records they correspond to
 *  where one exists. Order is the manifest and archive order. */
export const LAVEGA_EXPORT_SECTIONS = [
  "accounts",
  "transactions",
  "rules",
  "transfers",
  "merchants",
  "recurring_transactions",
  "recurring_occurrences",
  "recurring_allocations",
  "recurring_marks",
  "recurring_match_rejections",
  "recurring_price_changes",
  "budgets",
  "budget_category_groups",
  "scheduled_flows",
  "invoices",
  "vat_settings",
  "valuations",
  "import_sessions",
  "document_index",
  "fx_history",
] as const;

export type LavegaExportSection = (typeof LAVEGA_EXPORT_SECTIONS)[number];

/** Sections that exist in the export but deliberately do not travel. The
 *  manifest names them so a reader cannot mistake "absent" for "empty". */
export const LAVEGA_EXPORT_EXCLUDED = [
  { name: "document_bytes", reason: "sealed document bytes stay in the encrypted .lavega bundle" },
  { name: "credentials", reason: "broker credentials never travel in a plain export" },
  { name: "assistant_memory", reason: "assistant threads and theses are not ledger data; export on request" },
  { name: "vault_blob", reason: "the encrypted vault is the .lavega back-up, not this archive" },
  { name: "profile", reason: "the adviser intake answers are entered data, not ledger rows" },
  { name: "plan_preferences", reason: "plan thresholds and preferences are settings; the budget rows they produced are included" },
  { name: "facts_and_events", reason: "learned facts and the audit event log are rebuildable side state" },
  { name: "n8n_queue", reason: "pending invoice/notice rows are an external mail transport's queue" },
] as const;

export type LavegaExportManifest = {
  format: typeof LAVEGA_EXPORT_FORMAT;
  version: number;
  /** ISO day the export was built; caller-supplied (no clock in core). */
  createdAt: string;
  generator: { app: "lavega"; appVersion?: string };
  /** "sure-record-v1": adapted Sure vocabulary where a Sure record exists. */
  vocabulary: "sure-record-v1";
  money: "integer cents (ADR 0011)";
  /** Row count the writer promised per section. Readback checks it. */
  recordCounts: Record<string, number>;
  sections: Array<{
    name: LavegaExportSection;
    file: string;
    format: "ndjson";
    rows: number;
  }>;
  csvFiles: Array<{ name: "accounts" | "transactions"; file: string; rows: number }>;
  /** What is NOT in the archive, with a reason (never a silent omission). */
  excluded: Array<{ name: string; reason: string }>;
  /** Document BYTES are never included in a plain export. */
  binaries: { documents: { included: false; reason: string } };
  /** No promise that a future import can dedupe across these formats. */
  importNote: string;
};

export type LavegaExport = {
  bytes: Uint8Array;
  manifest: LavegaExportManifest;
};

/* ── Input ───────────────────────────────────────────────────────────────── */

/** Everything the vault can hand over. All lists optional so a caller can
 *  export what it holds; an absent list and an empty list both mean "no rows",
 *  and the manifest states zero. */
export type LavegaExportInput = {
  createdAt: string;
  appVersion?: string;
  accounts: readonly Account[];
  transactions: readonly Tx[];
  rules?: readonly Rule[];
  transfers?: readonly TransferPair[];
  merchants?: readonly Merchant[];
  bills?: readonly Bill[];
  billOccurrences?: readonly BillOccurrence[];
  billDecisions?: BillDecisions;
  budgetPeriods?: readonly BudgetPeriod[];
  categoryGroups?: readonly CategoryGroup[];
  scheduledFlows?: readonly ScheduledFlow[];
  invoices?: readonly Invoice[];
  vatSettings?: readonly VatSettings[];
  valuations?: readonly Valuation[];
  importSessions?: readonly ImportSession[];
  documents?: readonly VaultDocument[];
  fxHistory?: Readonly<Record<string, Readonly<Record<string, number>>>>;
};

/* ── Record shapes (the portable surface, money in integer cents) ────────── */

export type AccountRecord = {
  key: string;
  iban?: string;
  name: string;
  bank?: string;
  type?: string;
  entity: string;
  currency: string;
  /** Signed like `Account.balance`, in cents; null = unknown, never zero. */
  balanceCents: number | null;
  balanceDate?: string;
};

export type TransactionRecord = {
  id: string;
  accountKey: string;
  date: string;
  /** Sign preserved (ADR 0011): negative = outflow. */
  amountCents: number;
  currency: string;
  counterparty: string;
  description: string;
  category: string;
  manual: boolean;
  excluded: boolean;
  pending: boolean;
  notes?: string;
  tags?: string[];
};

/** Money in the vault is decimal euros at this boundary only; everything else
 *  already carries integer cents. */
const euroToCents = (amount: number): number => Math.round(amount * 100);

function accountRecord(account: Account): AccountRecord {
  return {
    key: account.key,
    ...(account.iban == null ? {} : { iban: account.iban }),
    name: account.name,
    ...(account.bank == null ? {} : { bank: account.bank }),
    ...(account.type == null ? {} : { type: account.type }),
    entity: account.entity,
    currency: account.currency,
    balanceCents: account.balance == null ? null : euroToCents(account.balance),
    ...(account.balanceDate == null ? {} : { balanceDate: account.balanceDate }),
  };
}

function transactionRecord(tx: Tx): TransactionRecord {
  return {
    id: tx.id,
    accountKey: tx.accountKey,
    date: tx.date,
    amountCents: euroToCents(tx.amount),
    currency: tx.currency,
    counterparty: tx.counterparty,
    description: tx.description,
    category: tx.category,
    manual: tx.manual,
    excluded: tx.excluded ?? false,
    pending: tx.pending ?? false,
    ...(tx.notes == null ? {} : { notes: tx.notes }),
    ...(tx.tags == null ? {} : { tags: [...tx.tags] }),
  };
}

function invoiceRecord(invoice: Invoice): Record<string, unknown> {
  return {
    ...invoice,
    amountCents: euroToCents(invoice.amount),
    vatAmountCents: invoice.vatAmount == null ? null : euroToCents(invoice.vatAmount),
  };
}

function documentRecord(document: VaultDocument): Record<string, unknown> {
  // Metadata only: the bytes are sealed in the encrypted bundle and the
  // manifest says so. Never the file's plaintext content.
  const { id, sha256, filename, mime, byteSize, kind, source, uploadedAt, reviewStatus } = document;
  return { id, sha256, filename, mime, byteSize, kind, source, uploadedAt, reviewStatus };
}

/* ── Section records ─────────────────────────────────────────────────────── */

function sectionRecords(input: LavegaExportInput): Record<LavegaExportSection, unknown[]> {
  const decisions = input.billDecisions;
  return {
    accounts: input.accounts.map(accountRecord),
    transactions: input.transactions.map(transactionRecord),
    rules: [...(input.rules ?? [])],
    transfers: [...(input.transfers ?? [])],
    merchants: [...(input.merchants ?? [])],
    recurring_transactions: [...(input.bills ?? [])],
    recurring_occurrences: [...(input.billOccurrences ?? [])],
    recurring_allocations: [...(decisions?.matches ?? [])],
    recurring_marks: [...(decisions?.marks ?? [])],
    recurring_match_rejections: [...(decisions?.rejections ?? [])],
    recurring_price_changes: [...(decisions?.priceChanges ?? [])],
    budgets: [...(input.budgetPeriods ?? [])],
    budget_category_groups: [...(input.categoryGroups ?? [])],
    scheduled_flows: [...(input.scheduledFlows ?? [])],
    invoices: (input.invoices ?? []).map(invoiceRecord),
    vat_settings: [...(input.vatSettings ?? [])],
    valuations: [...(input.valuations ?? [])],
    import_sessions: [...(input.importSessions ?? [])],
    document_index: (input.documents ?? []).map(documentRecord),
    fx_history: Object.entries(input.fxHistory ?? {})
      .flatMap(([currency, days]) =>
        Object.entries(days).map(([date, unitsPerEur]) => ({ currency, date, unitsPerEur })),
      )
      .sort((a, b) => a.currency.localeCompare(b.currency) || a.date.localeCompare(b.date)),
  };
}

/* ── NDJSON / CSV ────────────────────────────────────────────────────────── */

/** One JSON value per line, compact and stable. A value containing a newline is
 *  impossible: JSON.stringify escapes it, so line-per-record stays exact. */
function toNdjson(rows: readonly unknown[]): string {
  return rows.length === 0 ? "" : `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function fromNdjson(text: string): unknown[] {
  const rows: unknown[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      throw new Error(`NDJSON regel ${index + 1} is geen JSON`);
    }
  }
  return rows;
}

/** RFC 4180 quoting: a field with a comma, quote or newline is quoted and its
 *  quotes doubled. */
function csvField(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(headers: readonly string[], rows: ReadonlyArray<Record<string, unknown>>): string {
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvField(row[header])).join(","));
  return `${lines.join("\n")}\n`;
}

/** Minimal RFC 4180 reader, enough to verify the companions this writer made. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const ACCOUNT_CSV_HEADERS = [
  "key",
  "iban",
  "name",
  "bank",
  "type",
  "entity",
  "currency",
  "balanceCents",
  "balanceDate",
] as const;

const TRANSACTION_CSV_HEADERS = [
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
] as const;

/* ── Build ───────────────────────────────────────────────────────────────── */

/** Build the archive bytes and the manifest. Deterministic for the same input:
 *  fixed ZIP timestamps, sorted FX rows, section order fixed. */
export function buildLavegaExport(input: LavegaExportInput): LavegaExport {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.createdAt)) {
    throw new Error("createdAt moet een ISO-datum zijn");
  }
  const records = sectionRecords(input);
  const entries: ZipEntry[] = [];

  const manifest: LavegaExportManifest = {
    format: LAVEGA_EXPORT_FORMAT,
    version: LAVEGA_EXPORT_VERSION,
    createdAt: input.createdAt,
    generator: { app: "lavega", ...(input.appVersion == null ? {} : { appVersion: input.appVersion }) },
    vocabulary: "sure-record-v1",
    money: "integer cents (ADR 0011)",
    recordCounts: {},
    sections: [],
    csvFiles: [],
    excluded: LAVEGA_EXPORT_EXCLUDED.map((entry) => ({ ...entry })),
    binaries: {
      documents: {
        included: false,
        reason: "sealed document bytes live in the encrypted .lavega bundle; this archive carries metadata only",
      },
    },
    importNote:
      "Versioned archive for portability; this writer does not promise cross-format dedupe and no importer is bundled.",
  };

  for (const name of LAVEGA_EXPORT_SECTIONS) {
    const rows = records[name];
    const file = `${name}.ndjson`;
    manifest.recordCounts[name] = rows.length;
    manifest.sections.push({ name, file, format: "ndjson", rows: rows.length });
    entries.push({ path: file, bytes: utf8Bytes(toNdjson(rows)) });
  }

  const accountsCsv = toCsv(ACCOUNT_CSV_HEADERS, records.accounts as AccountRecord[]);
  const transactionsCsv = toCsv(
    TRANSACTION_CSV_HEADERS,
    records.transactions as TransactionRecord[],
  );
  manifest.csvFiles.push({ name: "accounts", file: "csv/accounts.csv", rows: records.accounts.length });
  manifest.csvFiles.push({
    name: "transactions",
    file: "csv/transactions.csv",
    rows: records.transactions.length,
  });
  entries.push({ path: "csv/accounts.csv", bytes: utf8Bytes(accountsCsv) });
  entries.push({ path: "csv/transactions.csv", bytes: utf8Bytes(transactionsCsv) });

  entries.unshift({ path: "manifest.json", bytes: utf8Bytes(`${JSON.stringify(manifest, null, 2)}\n`) });
  return { bytes: buildStoreZip(entries), manifest };
}

/* ── Readback ────────────────────────────────────────────────────────────── */

export type LavegaExportReadback = {
  manifest: LavegaExportManifest;
  /** Parsed records per section, in manifest order. */
  sections: Record<string, unknown[]>;
  /** Parsed CSV companions: header row first, then rows. */
  csv: { accounts: string[][]; transactions: string[][] };
  /** Empty when the archive is internally consistent. */
  problems: string[];
  /** True when every manifest promise held. */
  ok: boolean;
};

/**
 * Parse an export archive back into rows and check every promise its manifest
 * makes: version supported, every declared file present, row counts equal,
 * CSV companions parse with the promised row count, and every transaction has
 * the identity fields an importer needs. Throws only when the archive is not a
 * ZIP this writer could have produced; a readable-but-inconsistent archive
 * comes back with `ok: false` and the reasons.
 */
export function readLavegaExport(bytes: Uint8Array): LavegaExportReadback {
  const entries = readStoreZip(bytes);
  const manifestBytes = entries.get("manifest.json");
  if (manifestBytes == null) throw new Error("manifest.json ontbreekt");
  const manifest = JSON.parse(utf8Text(manifestBytes)) as LavegaExportManifest;
  const problems: string[] = [];

  if (manifest.format !== LAVEGA_EXPORT_FORMAT) problems.push("onbekend exportformaat");
  if (manifest.version !== LAVEGA_EXPORT_VERSION) {
    problems.push(`exportversie ${manifest.version} wordt niet ondersteund`);
  }

  const sections: Record<string, unknown[]> = {};
  for (const section of manifest.sections) {
    const fileBytes = entries.get(section.file);
    if (fileBytes == null) {
      problems.push(`${section.file} ontbreekt`);
      sections[section.name] = [];
      continue;
    }
    let rows: unknown[];
    try {
      rows = fromNdjson(utf8Text(fileBytes));
    } catch (error) {
      problems.push(`${section.file}: ${error instanceof Error ? error.message : String(error)}`);
      rows = [];
    }
    sections[section.name] = rows;
    if (rows.length !== section.rows) {
      problems.push(`${section.name}: manifest zegt ${section.rows} rijen, bestand heeft ${rows.length}`);
    }
    if ((manifest.recordCounts[section.name] ?? -1) !== rows.length) {
      problems.push(`${section.name}: recordCounts wijkt af van het bestand`);
    }
  }

  const csv: LavegaExportReadback["csv"] = { accounts: [], transactions: [] };
  for (const csvFile of manifest.csvFiles) {
    const fileBytes = entries.get(csvFile.file);
    if (fileBytes == null) {
      problems.push(`${csvFile.file} ontbreekt`);
      continue;
    }
    const rows = parseCsv(utf8Text(fileBytes));
    if (csvFile.name === "accounts" || csvFile.name === "transactions") csv[csvFile.name] = rows;
    const dataRows = Math.max(0, rows.length - 1);
    if (dataRows !== csvFile.rows) {
      problems.push(`${csvFile.name}: CSV heeft ${dataRows} rijen, manifest zegt ${csvFile.rows}`);
    }
  }

  const transactions = sections.transactions ?? [];
  for (const row of transactions) {
    const record = row as Partial<TransactionRecord>;
    if (
      typeof record.id !== "string" ||
      typeof record.accountKey !== "string" ||
      typeof record.date !== "string" ||
      typeof record.amountCents !== "number" ||
      typeof record.currency !== "string"
    ) {
      problems.push("transactie mist een verplicht identiteitsveld");
      break;
    }
  }
  if (!manifest.binaries?.documents || manifest.binaries.documents.included !== false) {
    problems.push("manifest zegt niet dat documentbytes ontbreken");
  }

  return { manifest, sections, csv, problems, ok: problems.length === 0 };
}

/** Convenience for the UI and the test: build, then read the very bytes back.
 *  Returns the manifest and the readback report; throws on an unreadable
 *  archive (which would mean the writer produced bytes the reader cannot
 *  parse). */
export function buildAndVerifyLavegaExport(input: LavegaExportInput): {
  bytes: Uint8Array;
  manifest: LavegaExportManifest;
  readback: LavegaExportReadback;
} {
  const built = buildLavegaExport(input);
  return { ...built, readback: readLavegaExport(built.bytes) };
}

/** Stable export filename for the browser download. */
export function lavegaExportFilename(createdAt: string): string {
  return `lavega-export-${createdAt}.zip`;
}
