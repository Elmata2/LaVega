/*
 * Provenance citation grammar (plan §3 WS5.5, #300).
 *
 * Sure source: `app/models/assistant/function/record_valuation.rb` and
 * `Provenance::Citation.parse!` at pinned commit 562fe09, described in
 * `docs/llm-guides/wealth-agent-harness.md:138-163`. Sure's grammar is:
 *
 *   source := ["estimated: "] citation [" (grade: A|B|C)"]
 *   A = official document for that exact date; B = derived with a document;
 *   C = proxy/assumption (a standing TODO). "estimated: " requires a grade.
 *
 * Two deliberate divergences from Sure, both stricter:
 *
 *   1. STRUCTURED, NOT PROSE. Sure appends the citation to the entry's free-text
 *      notes, so it can neither be filtered nor enforced. LaVega takes the
 *      citation as typed fields and only RENDERS the Sure text for display and
 *      import. `parseProvenanceCitationText` is that import seam.
 *   2. GRADE IS REQUIRED. Sure only requires a grade when the value is marked
 *      estimated. A LaVega citation always states its grade, because "a value
 *      with no provenance is worse than a missing value" (the harness's own
 *      rule) and an ungraded source is indistinct from prose.
 *
 * The module is pure: no I/O, no clock, no database. The agent path and the
 * HTTP route both call `decodeProvenanceCitation`, so they cannot disagree about
 * what a valid citation is.
 */

import { Schema } from "effect";

export const PROVENANCE_GRADES = ["A", "B", "C"] as const;
export type ProvenanceGrade = (typeof PROVENANCE_GRADES)[number];

/** A citation a machine can check: one source, one grade, one date. */
export type ProvenanceCitation = {
  /** Where the number came from: a document, a statement, a named provider. */
  source: string;
  /** A = official document for that exact date; B = derived with a document; C = proxy/assumption. */
  grade: ProvenanceGrade;
  /** The date the cited source refers to, YYYY-MM-DD. */
  date: string;
  /** Optional stable id of the cited document (statement id, invoice id, URL). */
  documentId?: string;
  /** Sure's `estimated: ` marker: the figure is an estimate, not a booked value. */
  estimated?: boolean;
};

/** The wire schema for an already-validated citation (a stored row, a read
 *  model field). Untrusted input goes through `decodeProvenanceCitation`, which
 *  is stricter; this schema describes the trusted shape and is what the net
 *  worth read model carries to the UI. */
export const ProvenanceCitationSchema = Schema.Struct({
  source: Schema.String,
  grade: Schema.Literals(PROVENANCE_GRADES),
  date: Schema.String,
  documentId: Schema.optional(Schema.String),
  estimated: Schema.optional(Schema.Boolean),
});

/** The only fields a citation may carry. An unknown key is refused, not
 *  stripped: a free-text "note" is exactly how Sure's citation leaked back into
 *  prose, and a model must not smuggle one through. */
const CITATION_KEYS = new Set(["source", "grade", "date", "documentId", "estimated"]);

export const MAX_PROVENANCE_SOURCE_LENGTH = 300;
export const MAX_PROVENANCE_DOCUMENT_ID_LENGTH = 300;

/** Thrown when untrusted input is not a valid citation. Carries the field so a
 *  caller can say which part is wrong without echoing the value. */
export class ProvenanceError extends Schema.TaggedError<ProvenanceError>()("ProvenanceError", {
  message: Schema.String,
  field: Schema.String,
}) {}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Is this one of the three grades? Lowercase and "D" are not. */
export function isProvenanceGrade(value: unknown): value is ProvenanceGrade {
  return typeof value === "string" && (PROVENANCE_GRADES as readonly string[]).includes(value);
}

/** Strict YYYY-MM-DD that is a real calendar day. `2026-13-40` is not. */
export function isValidProvenanceDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function fail(field: string, message: string): never {
  throw new ProvenanceError({ message, field });
}

const cleanText = (
  value: unknown,
  field: "source" | "documentId",
  maxLength: number,
): string => {
  if (typeof value !== "string") fail(field, `${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) fail(field, `${field} must not be blank`);
  if (trimmed.length > maxLength) fail(field, `${field} is too long`);
  if (CONTROL_CHARS.test(trimmed)) fail(field, `${field} must be plain text`);
  return trimmed;
};

/**
 * Decode untrusted input (a tool argument, a request body, a stored row) into a
 * citation, or throw `ProvenanceError`.
 *
 * Exact-shape check, then each field: no unknown keys, no blank source, grade in
 * A/B/C, a real calendar date, and an optional documentId/estimated of the right
 * type.
 */
export function decodeProvenanceCitation(input: unknown): ProvenanceCitation {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    fail("citation", "citation must be an object with source, grade and date");
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!CITATION_KEYS.has(key))
      fail("citation", `citation has an unknown field "${key}"; prose does not belong here`);

  const source = cleanText(record.source, "source", MAX_PROVENANCE_SOURCE_LENGTH);
  const grade = record.grade;
  if (!isProvenanceGrade(grade))
    fail("grade", "grade must be A, B or C (A = official document, B = derived, C = proxy)");
  const date = record.date;
  if (!isValidProvenanceDate(date))
    fail("date", "date must be a real calendar date, YYYY-MM-DD");
  const citation: ProvenanceCitation = { source, grade, date };

  if (record.documentId !== undefined)
    citation.documentId = cleanText(
      record.documentId,
      "documentId",
      MAX_PROVENANCE_DOCUMENT_ID_LENGTH,
    );
  if (record.estimated !== undefined) {
    const estimated = record.estimated;
    if (typeof estimated !== "boolean")
      fail("estimated", "estimated must be a boolean when present");
    citation.estimated = estimated;
  }
  return citation;
}

/**
 * The safe shape the agent boundary answers with when a citation is missing or
 * malformed: `{error, hint}`, never the decoder's own text. `null` means the
 * input is valid.
 */
export function provenanceCitationProblem(
  input: unknown,
): { error: "citation_required" | "invalid_citation"; hint: string } | null {
  if (input === undefined || input === null)
    return {
      error: "citation_required",
      hint: "Every valuation write needs citation {source, grade: A|B|C, date: YYYY-MM-DD, documentId?}. A value with no provenance is worse than a missing value.",
    };
  try {
    decodeProvenanceCitation(input);
    return null;
  } catch (error) {
    if (!(error instanceof ProvenanceError))
      return { error: "invalid_citation", hint: "The citation is not valid." };
    const hints: Record<string, string> = {
      source: "source must be a short, non-blank description of the document or provider.",
      grade: "grade must be A (official document for that date), B (derived with a document) or C (proxy or assumption).",
      date: "date must be a real calendar date in YYYY-MM-DD form.",
      documentId: "documentId, when present, must be a short non-blank id or URL.",
      estimated: "estimated, when present, must be true or false.",
      citation:
        "citation must be a structured object {source, grade, date, documentId?, estimated?}; prose is not accepted.",
    };
    return {
      error: "invalid_citation",
      hint: hints[(error as ProvenanceError).field] ?? "The citation is not valid.",
    };
  }
}

/**
 * Render the Sure-compatible prose form, for display and for notes written by a
 * human. The structured fields stay the source of truth; this is presentation.
 */
export function formatProvenanceCitation(citation: ProvenanceCitation): string {
  const prefix = citation.estimated ? "estimated: " : "";
  const document = citation.documentId ? ` [${citation.documentId}]` : "";
  return `${prefix}${citation.source}${document} (grade: ${citation.grade})`;
}

/**
 * One line for a UI, from the structured fields — never from stored prose.
 * `estimated:` is kept because it changes what the number means.
 */
export function describeProvenanceCitation(citation: ProvenanceCitation): string {
  const estimate = citation.estimated ? "estimated " : "";
  const document = citation.documentId ? ` · ${citation.documentId}` : "";
  return `${estimate}${citation.source} · grade ${citation.grade} · ${citation.date}${document}`;
}

/**
 * Parse the Sure prose grammar into structured fields. `date` and `documentId`
 * travel separately exactly as in Sure's `record_valuation(account, date,
 * amount, source)`, where the source string never carried the date.
 *
 * Rejections match the research notes: blank citation, `(grade: D)`,
 * capital-`E` `Estimated:`, and `estimated:` without a grade. LaVega also
 * rejects a prose citation with no grade at all (see the header).
 */
export function parseProvenanceCitationText(
  source: unknown,
  on: { date: unknown; documentId?: unknown },
): ProvenanceCitation {
  if (typeof source !== "string") fail("source", "source must be a string");
  let text = source.trim();
  if (text.length === 0) fail("source", "source must not be blank");

  /* Capital-E `Estimated:` is rejected rather than normalized: Sure's parser is
   * case-sensitive and the harness's examples say so. */
  if (/^Estimated:/.test(text))
    fail("source", "the estimated marker is lowercase `estimated: `");

  let estimated = false;
  if (text.startsWith("estimated:")) {
    estimated = true;
    text = text.slice("estimated:".length).trim();
    if (text.length === 0) fail("source", "estimated: needs a citation after it");
  }

  const gradeMatch = / \(grade: ([A-Za-z])\)$/.exec(text);
  if (!gradeMatch && text.includes("(grade:"))
    fail("grade", "grade must be A, B or C, written as `(grade: A)`");
  if (!gradeMatch)
    fail(
      "grade",
      estimated
        ? "`estimated: ` requires a grade, written as `(grade: A|B|C)`"
        : "a citation requires a grade, written as `(grade: A|B|C)`",
    );
  const grade = gradeMatch![1];
  if (!isProvenanceGrade(grade)) fail("grade", "grade must be A, B or C");
  text = text.slice(0, gradeMatch!.index).trim();
  /* `formatProvenanceCitation` renders the document id as a trailing `[id]`;
   * accept it back so the two functions round-trip. An explicit documentId
   * argument wins over the rendered one. */
  let documentId = on.documentId;
  if (documentId === undefined) {
    const rendered = / \[([^[\]]{1,300})\]$/.exec(text);
    if (rendered) {
      documentId = rendered[1];
      text = text.slice(0, rendered.index).trim();
    }
  }
  if (text.length === 0) fail("source", "source must not be blank");

  return decodeProvenanceCitation({
    source: text,
    grade,
    date: on.date,
    ...(documentId === undefined ? {} : { documentId }),
    ...(estimated ? { estimated: true } : {}),
  });
}
