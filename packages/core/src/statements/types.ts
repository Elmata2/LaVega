/**
 * Statement metadata pipeline (WS3.5, issue #293).
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure sources: `app/models/account_statement.rb`,
 * `account_statement/{metadata_detector,account_matcher,coverage}.rb`.
 * No Ruby is copied.
 *
 * Sure stores an uploaded statement row with a filename, content type, byte
 * size, MD5/SHA-256, detected period and hints, a suggested account with a
 * confidence score, a review status, and a report-only reconciliation against
 * the ledger. LaVega keeps the same facts, but the BYTES never enter the vault
 * blob: they are sealed in a separate IndexedDB object store (see
 * `packages/adapters`), and `VaultDocument` here is only the metadata.
 *
 * Rules carried over verbatim in spirit:
 *  - same bytes twice is ONE document (SHA-256 identity);
 *  - account matching is hint-based with fixed weights, a minimum confidence,
 *    and a REFUSAL to guess when two accounts tie;
 *  - reconciliation is report-only with a one-cent tolerance, and the word
 *    "verified" is never printed without checks that actually matched.
 */
import type { Account } from "../model.js";

/** Sure's `MAX_FILE_SIZE` (25 MB), in bytes. */
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

/** Sure's allowed extensions → content types. LaVega keys on the extension and
 *  accepts the same set, so a .STA text file stays importable elsewhere. */
export const DOCUMENT_ALLOWED_TYPES: Record<string, readonly string[]> = {
  ".pdf": ["application/pdf"],
  ".csv": ["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
};

export type DocumentKind = "statement" | "other";

export type DocumentSource = "manual-upload" | "import";

export type DocumentReviewStatus = "unmatched" | "linked" | "rejected";

/** The metadata of one stored document. Identity is the SHA-256: the same bytes
 *  uploaded twice is one row, and the sealed bytes live under the same key in
 *  the document store. */
export type VaultDocument = {
  /** = `sha256`, so identity cannot drift from the content. */
  id: string;
  sha256: string;
  filename: string;
  mime: string;
  byteSize: number;
  kind: DocumentKind;
  source: DocumentSource;
  /** ISO day the owner added it (`asOf`, never a clock read in core). */
  uploadedAt: string;
  /** Detected period, null when the file says nothing (stays in the queue). */
  periodFrom: string | null;
  periodTo: string | null;
  currency: string | null;
  /** The account the owner (or the match) linked it to. */
  accountKey: string | null;
  /** The best hint-based suggestion, kept even after a rejection for display. */
  suggestedAccountKey: string | null;
  matchConfidence: number | null;
  accountLast4: string | null;
  institutionHint: string | null;
  accountNameHint: string | null;
  /** Ledger rows this document was linked to, when a later slice records them.
   *  Carried in the shape now so the metadata contract is stable. */
  txIds?: string[];
  /** The generic import session this document is the source of (WS3.6). */
  importId?: string;
  /** Absolute statement balances in integer cents, when the file/metadata has
   *  them (ADR 0011). Null = unknown, never zero. */
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  reviewStatus: DocumentReviewStatus;
  /** Which detector tiers spoke ("filename", "content", "owner"). */
  metadataSources: string[];
};

export type UploadProblem = "empty" | "too-large" | "type" | "name";

/** The upload gate, shared by the UI and the adapter: a refusal carries a
 *  reason code, never a silent drop. */
export type UploadCheck = { ok: true; extension: string } | { ok: false; problem: UploadProblem };

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot).toLowerCase();
}

export function checkDocumentUpload(input: {
  filename: string;
  mime?: string | null;
  byteSize: number;
}): UploadCheck {
  const extension = extensionOf(input.filename ?? "");
  if (!input.filename || input.filename.trim() === "" || extension === "") {
    return { ok: false, problem: "name" };
  }
  if (!(extension in DOCUMENT_ALLOWED_TYPES)) return { ok: false, problem: "type" };
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, problem: "empty" };
  }
  if (input.byteSize > DOCUMENT_MAX_BYTES) return { ok: false, problem: "too-large" };
  return { ok: true, extension };
}

/** A statement with no period stays in the queue; it is never dropped. */
export function documentCoversMonth(doc: VaultDocument, month: string): boolean {
  if (doc.periodFrom == null || doc.periodTo == null) return false;
  const start = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return doc.periodFrom <= end && doc.periodTo >= start;
}

export function isStatement(doc: VaultDocument): boolean {
  return doc.kind === "statement";
}

/** The one document with these bytes, or null. Same bytes = one document. */
export function findDocumentBySha(
  documents: readonly VaultDocument[],
  sha256: string,
): VaultDocument | null {
  return documents.find((doc) => doc.sha256 === sha256 || doc.id === sha256) ?? null;
}

/** Insert or replace by content identity, so a re-upload cannot duplicate. */
export function upsertDocument(
  documents: readonly VaultDocument[],
  doc: VaultDocument,
): VaultDocument[] {
  const index = documents.findIndex((existing) => existing.id === doc.id);
  if (index < 0) return [...documents, doc];
  const next = [...documents];
  next[index] = doc;
  return next;
}

export function removeDocument(documents: readonly VaultDocument[], id: string): VaultDocument[] {
  return documents.filter((doc) => doc.id !== id);
}

/** The document's own currency, else the linked account's, else EUR. Never a
 *  guess at a rate: this only labels the amount. */
export function documentCurrency(doc: VaultDocument, accounts: readonly Account[] = []): string {
  const linked = doc.accountKey == null ? null : accounts.find((a) => a.key === doc.accountKey);
  return doc.currency ?? linked?.currency ?? "EUR";
}
