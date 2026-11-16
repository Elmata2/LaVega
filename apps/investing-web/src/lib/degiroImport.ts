/* API client for the DeGiro import tab (issue #324).
 *
 * The server owns parsing, merging and the snapshot write. This module only
 * speaks the upload contract: a preview parses and returns per-file reports, a
 * commit merges under the broker lease, and a status read reports what the
 * stored snapshot already holds. The raw file is never stored.
 *
 * A transport problem is a value here, not an exception: every call resolves to
 * `ImportResponse<T>`, so the component's state machine decides what to show. */
import { Result, Schema } from "effect";
import { shortDate } from "./dates.js";

export type DeGiroProfile = "account" | "transactions" | "portfolio";

export type ImportRows = {
  trades: readonly unknown[];
  cashFlows: readonly unknown[];
  dividends: readonly unknown[];
  positions: readonly unknown[];
  cashBalances: readonly unknown[];
};

export type DeGiroImportFileReport = {
  filename: string;
  sha256: string;
  profile?: DeGiroProfile;
  period?: { from: string; to: string };
  rows: ImportRows;
  problems: string[];
};

export type DeGiroImportPreview = {
  mode: "preview";
  files: DeGiroImportFileReport[];
};

export type RowCounts = {
  trades: number;
  cashFlows: number;
  dividends: number;
  positions: number;
  cashBalances: number;
};

/** The server's coverage carries provenance. The web only needs the window it
 *  claims, so every field but `status` is optional. */
export type DeGiroCoverage = {
  entity?: string;
  broker?: string;
  tradeCash?: "trade-settlement" | "cash-flows";
  status: "complete" | "unknown";
  from?: string;
  to?: string;
  reason?: string;
};

export type DeGiroImportCommit = {
  mode: "commit";
  committed: boolean;
  importedAt?: string;
  files: DeGiroImportFileReport[];
  coverage?: DeGiroCoverage;
  totals: RowCounts;
  problems: string[];
};

export type DeGiroImportStatus = {
  mode: "status";
  importedAt: string | null;
  files: { filename: string; sha256: string }[];
  coverage: DeGiroCoverage | null;
  positionsAsOf: string | null;
};

export type ImportResponse<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; problems: string[] };

const rowsSchema = Schema.Struct({
  trades: Schema.Array(Schema.Unknown),
  cashFlows: Schema.Array(Schema.Unknown),
  dividends: Schema.Array(Schema.Unknown),
  positions: Schema.Array(Schema.Unknown),
  cashBalances: Schema.Array(Schema.Unknown),
});

const profileSchema = Schema.Literals(["account", "transactions", "portfolio"]);

const fileReportSchema = Schema.Struct({
  filename: Schema.String,
  sha256: Schema.String,
  profile: Schema.optional(profileSchema),
  period: Schema.optional(Schema.Struct({ from: Schema.String, to: Schema.String })),
  rows: rowsSchema,
  problems: Schema.Array(Schema.String),
});

const coverageSchema = Schema.Struct({
  entity: Schema.optional(Schema.String),
  broker: Schema.optional(Schema.String),
  tradeCash: Schema.optional(Schema.Literals(["trade-settlement", "cash-flows"])),
  status: Schema.Literals(["complete", "unknown"]),
  from: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  quantityProvenFrom: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
});

const countsSchema = Schema.Struct({
  trades: Schema.Number,
  cashFlows: Schema.Number,
  dividends: Schema.Number,
  positions: Schema.Number,
  cashBalances: Schema.Number,
});

const previewSchema = Schema.Struct({
  mode: Schema.Literal("preview"),
  files: Schema.Array(fileReportSchema),
});

const commitSchema = Schema.Struct({
  mode: Schema.Literal("commit"),
  committed: Schema.Boolean,
  importedAt: Schema.optional(Schema.String),
  files: Schema.Array(fileReportSchema),
  coverage: Schema.optional(coverageSchema),
  totals: countsSchema,
  problems: Schema.Array(Schema.String),
});

const statusSchema = Schema.Struct({
  mode: Schema.Literal("status"),
  importedAt: Schema.NullOr(Schema.String),
  files: Schema.Array(Schema.Struct({ filename: Schema.String, sha256: Schema.String })),
  coverage: Schema.NullOr(coverageSchema),
  positionsAsOf: Schema.NullOr(Schema.String),
});

export const PROFILE_LABELS: Record<DeGiroProfile, string> = {
  account: "Account statement",
  transactions: "Transactions export",
  portfolio: "Portfolio export",
};

export function profileLabel(profile?: DeGiroProfile): string {
  return profile === undefined ? "Unknown file" : PROFILE_LABELS[profile];
}

export function rowSummary(rows: ImportRows): string {
  const parts: string[] = [];
  const add = (count: number, one: string, many: string) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`);
  };
  add(rows.trades.length, "trade", "trades");
  add(rows.cashFlows.length, "cash flow", "cash flows");
  add(rows.dividends.length, "dividend", "dividends");
  add(rows.positions.length, "position", "positions");
  add(rows.cashBalances.length, "cash balance", "cash balances");
  return parts.length === 0 ? "No rows" : parts.join(" · ");
}

export function periodLabel(period?: { from: string; to: string }): string {
  if (period === undefined) return "No date in file";
  return `${shortDate(period.from)}–${shortDate(period.to)}`;
}

/** An import instant is a moment, not a calendar day. Show it in the reader's
 *  zone: 20:00 in New York on the 12th is already the 13th in UTC. */
const importedAtFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function importStatusLine(status: DeGiroImportStatus): string | null {
  if (status.importedAt === null) return null;
  const line = `Last imported ${importedAtFormatter.format(new Date(status.importedAt))}`;
  const coverage = status.coverage;
  if (coverage?.from && coverage.to)
    return `${line}, covers ${shortDate(coverage.from)}–${shortDate(coverage.to)}`;
  return line;
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function hasRows(files: readonly DeGiroImportFileReport[]): boolean {
  return files.some((file) => Object.values(file.rows).some((rows) => rows.length > 0));
}

export function portfolioSelected(files: readonly DeGiroImportFileReport[]): boolean {
  return files.some((file) => file.profile === "portfolio");
}

async function readProblems(response: Response): Promise<string[]> {
  const body: unknown = await response.json().catch(() => null);
  const problems = (body as { problems?: unknown } | null)?.problems;
  if (Array.isArray(problems) && problems.length > 0)
    return problems.map((problem) => String(problem));
  return ["The import request failed."];
}

async function send<T>(
  url: string,
  init: RequestInit,
  decodeBody: (payload: unknown) => T | null,
): Promise<ImportResponse<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { ok: false, status: 0, problems: ["The server could not be reached."] };
  }
  if (!response.ok)
    return { ok: false, status: response.status, problems: await readProblems(response) };
  const payload: unknown = await response.json().catch(() => null);
  const data = decodeBody(payload);
  if (data === null)
    return {
      ok: false,
      status: response.status,
      problems: ["The server returned an unexpected import result."],
    };
  return { ok: true, data };
}

function decodeStatusBody(payload: unknown): DeGiroImportStatus | null {
  const decoded = Schema.decodeUnknownResult(statusSchema)(payload);
  return Result.isSuccess(decoded) ? (decoded.success as DeGiroImportStatus) : null;
}

function decodePreviewBody(payload: unknown): DeGiroImportPreview | null {
  const decoded = Schema.decodeUnknownResult(previewSchema)(payload);
  return Result.isSuccess(decoded) ? (decoded.success as DeGiroImportPreview) : null;
}

function decodeCommitBody(payload: unknown): DeGiroImportCommit | null {
  const decoded = Schema.decodeUnknownResult(commitSchema)(payload);
  return Result.isSuccess(decoded) ? (decoded.success as DeGiroImportCommit) : null;
}

const IMPORT_PATH = "/api/investing/brokers/degiro/import";

function importForm(files: readonly File[], asOf: string | undefined): FormData {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  if (asOf !== undefined) form.append("asOf", asOf);
  return form;
}

export function readDeGiroImportStatus(
  signal?: AbortSignal,
): Promise<ImportResponse<DeGiroImportStatus>> {
  return send(IMPORT_PATH, { method: "GET", ...(signal ? { signal } : {}) }, decodeStatusBody);
}

export function previewDeGiroImport(
  files: readonly File[],
  asOf: string | undefined,
  signal?: AbortSignal,
): Promise<ImportResponse<DeGiroImportPreview>> {
  return send(
    `${IMPORT_PATH}?mode=preview`,
    {
      method: "POST",
      body: importForm(files, asOf),
      ...(signal ? { signal } : {}),
    },
    decodePreviewBody,
  );
}

export function commitDeGiroImport(
  files: readonly File[],
  asOf: string | undefined,
): Promise<ImportResponse<DeGiroImportCommit>> {
  return send(
    `${IMPORT_PATH}?mode=commit`,
    { method: "POST", body: importForm(files, asOf) },
    decodeCommitBody,
  );
}
