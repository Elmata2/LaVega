import { expect, test } from "vitest";
import {
  decodeProvenanceCitation,
  describeProvenanceCitation,
  formatProvenanceCitation,
  isProvenanceGrade,
  isValidProvenanceDate,
  MAX_PROVENANCE_SOURCE_LENGTH,
  parseProvenanceCitationText,
  ProvenanceError,
  provenanceCitationProblem,
  type ProvenanceCitation,
} from "./provenance.js";

/* Sure source: app/models/assistant/function/record_valuation.rb and
 * Provenance::Citation.parse! @ 562fe09. The valid and invalid examples below
 * are the ones the research notes name, plus the structured-shape refusals the
 * LaVega contract adds. */

const valid: ProvenanceCitation = {
  source: "Trading 212 account statement",
  grade: "A",
  date: "2026-10-31",
};

const rejects = (input: unknown, field?: string) => {
  try {
    decodeProvenanceCitation(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ProvenanceError);
    if (field) expect((error as ProvenanceError).field).toBe(field);
    return;
  }
  throw new Error(`expected rejection for ${JSON.stringify(input)}`);
};

test("a well-formed citation decodes to exactly its structured fields", () => {
  expect(decodeProvenanceCitation(valid)).toEqual({
    source: "Trading 212 account statement",
    grade: "A",
    date: "2026-10-31",
  });
});

test("documentId and estimated are optional and carried when present", () => {
  expect(
    decodeProvenanceCitation({
      source: "Quarterly valuation letter",
      grade: "B",
      date: "2026-09-30",
      documentId: "statement-2026-09",
      estimated: true,
    }),
  ).toEqual({
    source: "Quarterly valuation letter",
    grade: "B",
    date: "2026-09-30",
    documentId: "statement-2026-09",
    estimated: true,
  });
});

test("a malformed citation is rejected: missing source", () => {
  rejects({ grade: "A", date: "2026-10-31" }, "source");
  rejects({ source: "   ", grade: "A", date: "2026-10-31" }, "source");
  rejects({ source: 42, grade: "A", date: "2026-10-31" }, "source");
});

test("a malformed citation is rejected: grade not in A|B|C", () => {
  rejects({ ...valid, grade: "D" }, "grade");
  rejects({ ...valid, grade: "a" }, "grade");
  rejects({ ...valid, grade: 1 }, "grade");
  rejects({ ...valid, grade: undefined }, "grade");
});

test("a malformed citation is rejected: an impossible date", () => {
  rejects({ ...valid, date: "2026-13-40" }, "date");
  rejects({ ...valid, date: "31-10-2026" }, "date");
  rejects({ ...valid, date: "2026-02-30" }, "date");
  rejects({ ...valid, date: undefined }, "date");
});

test("a malformed citation is rejected: prose smuggled in as an unknown field", () => {
  rejects({ ...valid, note: "the broker said so" }, "citation");
  rejects({ ...valid, source_prose: "x" }, "citation");
});

test("a malformed citation is rejected: bad documentId or estimated type", () => {
  rejects({ ...valid, documentId: "" }, "documentId");
  rejects({ ...valid, documentId: 7 }, "documentId");
  rejects({ ...valid, estimated: "yes" }, "estimated");
});

test("a malformed citation is rejected: blank or non-object input", () => {
  rejects(null, "citation");
  rejects("statement", "citation");
  rejects([valid], "citation");
});

test("a citation with a very long source is rejected, so a note cannot ride along", () => {
  rejects({ ...valid, source: "x".repeat(MAX_PROVENANCE_SOURCE_LENGTH + 1) }, "source");
});

test("provenanceCitationProblem maps a missing citation to citation_required", () => {
  expect(provenanceCitationProblem(undefined)).toEqual({
    error: "citation_required",
    hint: expect.stringContaining("citation {source, grade"),
  });
});

test("provenanceCitationProblem maps a malformed citation to a safe hint, never the decoder text", () => {
  const problem = provenanceCitationProblem({ ...valid, grade: "D" });
  expect(problem).toEqual({
    error: "invalid_citation",
    hint: expect.stringContaining("grade must be A"),
  });
  expect(JSON.stringify(problem)).not.toContain("Expected");
  expect(provenanceCitationProblem(valid)).toBeNull();
});

test("grades and dates have their own predicates", () => {
  expect(isProvenanceGrade("A")).toBe(true);
  expect(isProvenanceGrade("C")).toBe(true);
  expect(isProvenanceGrade("D")).toBe(false);
  expect(isValidProvenanceDate("2026-02-29")).toBe(false); // 2026 is not a leap year
  expect(isValidProvenanceDate("2024-02-29")).toBe(true);
  expect(isValidProvenanceDate("2026-11-11")).toBe(true);
});

test("format renders the Sure grammar with the estimated marker and document id", () => {
  expect(formatProvenanceCitation(valid)).toBe("Trading 212 account statement (grade: A)");
  expect(
    formatProvenanceCitation({
      ...valid,
      estimated: true,
      documentId: "statement-1",
    }),
  ).toBe("estimated: Trading 212 account statement [statement-1] (grade: A)");
});

test("parse accepts the Sure prose grammar and returns structured fields", () => {
  expect(
    parseProvenanceCitationText("Trading 212 account statement (grade: A)", {
      date: "2026-10-31",
    }),
  ).toEqual(valid);
  expect(
    parseProvenanceCitationText("estimated: Broker app screenshot (grade: C)", {
      date: "2026-11-01",
      documentId: "screenshot-7",
    }),
  ).toEqual({
    source: "Broker app screenshot",
    grade: "C",
    date: "2026-11-01",
    documentId: "screenshot-7",
    estimated: true,
  });
});

test("parse rejects the exact cases the Sure grammar rejects", () => {
  const date = { date: "2026-10-31" };
  const rejectsText = (text: string, field?: string) => {
    try {
      parseProvenanceCitationText(text, date);
    } catch (error) {
      expect(error).toBeInstanceOf(ProvenanceError);
      if (field) expect((error as ProvenanceError).field).toBe(field);
      return;
    }
    throw new Error(`expected rejection for ${JSON.stringify(text)}`);
  };

  rejectsText("", "source"); // blank citation
  rejectsText("statement (grade: D)", "grade");
  rejectsText("Estimated: statement (grade: A)", "source"); // capital E
  rejectsText("estimated: statement", "grade"); // estimated without a grade
  rejectsText("statement", "grade"); // LaVega requires a grade
  rejectsText("statement (grade: A) trailing", "grade");
});

test("parse round-trips through format for every grade, document id included", () => {
  for (const grade of ["A", "B", "C"] as const) {
    const citation = {
      ...valid,
      grade,
      ...(grade === "C" ? { estimated: true } : {}),
      documentId: `doc-${grade}`,
    };
    const text = formatProvenanceCitation(citation);
    expect(parseProvenanceCitationText(text, { date: citation.date })).toEqual(citation);
  }
});

test("describeProvenanceCitation is a UI line built from structured fields only", () => {
  expect(describeProvenanceCitation(valid)).toBe(
    "Trading 212 account statement · grade A · 2026-10-31",
  );
  expect(
    describeProvenanceCitation({
      ...valid,
      estimated: true,
      documentId: "statement-2026-10",
    }),
  ).toBe("estimated Trading 212 account statement · grade A · 2026-10-31 · statement-2026-10");
});
