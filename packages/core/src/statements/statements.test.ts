import { describe, expect, test } from "vitest";
import type { Account, Tx } from "../model.js";
import {
  DOCUMENT_MAX_BYTES,
  checkDocumentUpload,
  findDocumentBySha,
  removeDocument,
  upsertDocument,
  type VaultDocument,
} from "./types.js";
import { datesIn, detectStatementMetadata, monthIn } from "./detect.js";
import {
  MATCH_MIN_CONFIDENCE,
  accountMatchConfidence,
  matchStatementAccount,
  reconcileStatement,
  statementCoverage,
  statementReviewQueue,
} from "./review.js";

/**
 * WS3.5 acceptance evidence (issue #293):
 *
 *  - period detection from a filename (dates, month-year, month names, Dutch
 *    month names) and the last-four / institution hints;
 *  - deterministic account matching with fixed weights, a 0.35 floor and a
 *    REFUSAL when two accounts tie;
 *  - report-only reconciliation with a one-cent tolerance that never claims
 *    "verified" without checks;
 *  - month coverage statuses, including duplicate and ambiguous;
 *  - the review queue keeps a no-period statement visible.
 *
 * The household is hand-worked: an ING current account with an opening anchor
 * and two October movements, an ING savings account, an ABN business account,
 * and two identical ING "Betaalrekening" rows that the hints cannot tell apart.
 */

const account = (overrides: Partial<Account> = {}): Account => ({
  key: "NL01INGB",
  iban: "NL01INGB00001234",
  name: "Betaalrekening",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: null,
  openingBalanceCents: 100000,
  openingDate: "2026-10-01",
  ...overrides,
});

const tx = (date: string, amount: number, id: string): Tx => ({
  id,
  accountKey: "NL01INGB",
  date,
  amount,
  currency: "EUR",
  counterparty: "",
  description: "",
  category: "",
  manual: false,
});

const ACCOUNTS: Account[] = [
  account(),
  account({ key: "NL03INGB", iban: "NL03INGB00005678", name: "Spaarrekening" }),
  account({ key: "NL02ABNA", iban: "NL02ABNA00009999", name: "Zakelijk", bank: "ABN AMRO" }),
  account({ key: "TWIN1", iban: "", name: "Betaalrekening" }),
  account({ key: "TWIN2", iban: "", name: "Betaalrekening" }),
];

const TXS: Tx[] = [tx("2026-10-02", -100, "t1"), tx("2026-10-15", 2000, "t2")];

const document = (overrides: Partial<VaultDocument> = {}): VaultDocument => ({
  id: "sha-oct",
  sha256: "sha-oct",
  filename: "ING afschrift 2026-10.pdf",
  mime: "application/pdf",
  byteSize: 1000,
  kind: "statement",
  source: "manual-upload",
  uploadedAt: "2026-11-11",
  periodFrom: "2026-10-01",
  periodTo: "2026-10-31",
  currency: "EUR",
  accountKey: null,
  suggestedAccountKey: null,
  matchConfidence: null,
  accountLast4: null,
  institutionHint: null,
  accountNameHint: null,
  openingBalanceCents: null,
  closingBalanceCents: null,
  reviewStatus: "unmatched",
  metadataSources: [],
  ...overrides,
});

describe("upload gate", () => {
  test("a file above the 25 MB cap is refused with a reason", () => {
    const result = checkDocumentUpload({
      filename: "groot.pdf",
      mime: "application/pdf",
      byteSize: DOCUMENT_MAX_BYTES + 1,
    });
    expect(result).toEqual({ ok: false, problem: "too-large" });
    expect(checkDocumentUpload({ filename: "ok.pdf", byteSize: DOCUMENT_MAX_BYTES }).ok).toBe(true);
  });

  test("an unsupported extension, an empty file and a nameless file are refused", () => {
    expect(checkDocumentUpload({ filename: "notities.txt", byteSize: 10 })).toEqual({
      ok: false,
      problem: "type",
    });
    expect(checkDocumentUpload({ filename: "leeg.pdf", byteSize: 0 })).toEqual({
      ok: false,
      problem: "empty",
    });
    expect(checkDocumentUpload({ filename: "geen-extensie", byteSize: 10 })).toEqual({
      ok: false,
      problem: "name",
    });
  });

  test("the same bytes are ONE document: identity is the SHA-256", () => {
    const first = document({ id: "abc", sha256: "abc" });
    const documents = upsertDocument([], first);
    const again = findDocumentBySha(documents, "abc");
    expect(again?.id).toBe("abc");
    // A re-upload replaces the row, it never adds a second one.
    expect(upsertDocument(documents, { ...first, filename: "hernoemd.pdf" })).toHaveLength(1);
    expect(removeDocument(documents, "abc")).toEqual([]);
  });
});

describe("period and hint detection", () => {
  test("two dates in a filename become the period", () => {
    const detected = detectStatementMetadata({
      filename: "ING afschrift 2026-10-01 2026-10-31.pdf",
    });
    expect(detected.periodFrom).toBe("2026-10-01");
    expect(detected.periodTo).toBe("2026-10-31");
    expect(detected.metadataSources).toContain("filename");
    expect(detected.parserConfidence).toBe(0.65);
  });

  test("a month-year filename covers that whole month", () => {
    const detected = detectStatementMetadata({ filename: "ABN 2026-09.pdf" });
    expect(detected.periodFrom).toBe("2026-09-01");
    expect(detected.periodTo).toBe("2026-09-30");
  });

  test("Dutch and English month names are read", () => {
    expect(detectStatementMetadata({ filename: "afschrift augustus 2026.pdf" }).periodFrom).toBe(
      "2026-08-01",
    );
    expect(detectStatementMetadata({ filename: "statement September 2026.pdf" }).periodFrom).toBe(
      "2026-09-01",
    );
    expect(monthIn("oktober 2026")).toBe("2026-10");
    expect(datesIn("20261005")).toEqual(["2026-10-05"]);
  });

  test("a file with no date at all has NO period", () => {
    const detected = detectStatementMetadata({ filename: "scan.pdf" });
    expect(detected.periodFrom).toBeNull();
    expect(detected.periodTo).toBeNull();
    // A name hint alone is Sure's 0.45 tier; nothing at all would be 0.1.
    expect(detected.parserConfidence).toBe(0.45);
  });

  test("a last-four and an institution hint are read, and a generic name is not a hint", () => {
    const detected = detectStatementMetadata({ filename: "ING ending 1234 2026-10.pdf" });
    expect(detected.accountLast4).toBe("1234");
    expect(detected.institutionHint?.toLowerCase()).toContain("ing");
    const generic = detectStatementMetadata({ filename: "bank statement 2026-10.pdf" });
    expect(generic.institutionHint).toBeNull();
    expect(generic.periodFrom).toBe("2026-10-01");
  });

  test("extracted text wins over the filename, like Sure's tiers", () => {
    const detected = detectStatementMetadata({
      filename: "scan.pdf",
      text: "Periode 2026-09-01 tot 2026-09-30\nIBAN NL01INGB00001234\nEUR",
    });
    expect(detected.periodFrom).toBe("2026-09-01");
    expect(detected.accountLast4).toBe("1234");
    expect(detected.currency).toBe("EUR");
    expect(detected.parserConfidence).toBe(0.85);
  });
});

describe("account matching", () => {
  test("the weights are Sure's, with the 0.35 floor", () => {
    expect(MATCH_MIN_CONFIDENCE).toBe(0.35);
    expect(
      accountMatchConfidence(ACCOUNTS[0] as Account, {
        institutionHint: "ing",
        accountNameHint: "betaalrekening",
        accountLast4: "1234",
        currency: "EUR",
      }),
    ).toBe(1);
    // Currency alone never even enters the matcher (Sure's own guard): a
    // statement with no institution/name/last-four hint matches nothing.
    expect(accountMatchConfidence(ACCOUNTS[0] as Account, { currency: "EUR" })).toBe(0);
    expect(matchStatementAccount({ currency: "EUR" }, ACCOUNTS)).toEqual({ status: "none" });
  });

  test("a unique hint match wins, and a below-floor hint matches nothing", () => {
    const match = matchStatementAccount(
      { institutionHint: "ing", accountLast4: "1234", currency: "EUR" },
      ACCOUNTS,
    );
    expect(match).toEqual({ status: "matched", accountKey: "NL01INGB", confidence: 0.75 });
    expect(matchStatementAccount({ institutionHint: "Rabobank" }, ACCOUNTS)).toEqual({
      status: "none",
    });
  });

  test("two accounts the hints cannot tell apart are a REFUSAL, not a coin flip", () => {
    const twins = [ACCOUNTS[3] as Account, ACCOUNTS[4] as Account];
    const match = matchStatementAccount({ institutionHint: "ing", currency: "EUR" }, twins);
    expect(match.status).toBe("ambiguous");
    if (match.status === "ambiguous") {
      expect(match.tiedKeys).toEqual(["TWIN1", "TWIN2"]);
    }
  });
});

describe("reconciliation: never a claim without checks", () => {
  const matched = document({
    accountKey: "NL01INGB",
    openingBalanceCents: 100000,
    closingBalanceCents: 290000,
  });

  test("a statement that reconciles within one cent is verified", () => {
    const result = reconcileStatement({
      doc: matched,
      accounts: ACCOUNTS,
      txs: TXS,
      asOf: "2026-11-11",
    });
    expect(result.status).toBe("matched");
    expect(result.verified).toBe(true);
    expect(result.checks.map((c) => c.key)).toEqual([
      "opening_balance",
      "closing_balance",
      "period_movement",
    ]);
    expect(result.checks.every((c) => c.matched)).toBe(true);
  });

  test("one cent of difference is still within tolerance; two is a mismatch", () => {
    const within = reconcileStatement({
      doc: { ...matched, closingBalanceCents: 290001 },
      accounts: ACCOUNTS,
      txs: TXS,
      asOf: "2026-11-11",
    });
    expect(within.status).toBe("matched");
    const over = reconcileStatement({
      doc: { ...matched, closingBalanceCents: 290002 },
      accounts: ACCOUNTS,
      txs: TXS,
      asOf: "2026-11-11",
    });
    expect(over.status).toBe("mismatched");
    expect(over.verified).toBe(false);
    expect(over.reason).toBe("difference");
    expect(over.checks.find((c) => c.key === "closing_balance")?.differenceCents).toBe(2);
  });

  test("no account, no period, no balances or no ledger value means UNAVAILABLE, never verified", () => {
    const cases = [
      reconcileStatement({ doc: document(), accounts: ACCOUNTS, txs: TXS, asOf: "2026-11-11" }),
      reconcileStatement({
        doc: document({ accountKey: "NL01INGB", periodFrom: null, periodTo: null }),
        accounts: ACCOUNTS,
        txs: TXS,
        asOf: "2026-11-11",
      }),
      reconcileStatement({
        doc: document({ accountKey: "NL01INGB" }),
        accounts: ACCOUNTS,
        txs: TXS,
        asOf: "2026-11-11",
      }),
      reconcileStatement({
        doc: { ...matched, accountKey: "ONBEKEND" },
        accounts: ACCOUNTS,
        txs: TXS,
        asOf: "2026-11-11",
      }),
    ];
    for (const result of cases) {
      expect(result.status).toBe("unavailable");
      expect(result.verified).toBe(false);
      expect(result.checks).toEqual([]);
    }
    expect(cases[0]?.reason).toBe("no-account");
    expect(cases[1]?.reason).toBe("no-period");
    expect(cases[2]?.reason).toBe("no-statement-balances");
  });

  test("a gap in the ledger is unavailable, not a zero to compare against", () => {
    const noAnchor = account({
      key: "GEEN",
      iban: "",
      name: "Betaalrekening",
      openingBalanceCents: undefined,
      openingDate: undefined,
    });
    const result = reconcileStatement({
      doc: { ...matched, accountKey: "GEEN" },
      accounts: [noAnchor],
      txs: TXS,
      asOf: "2026-11-11",
    });
    expect(result.status).toBe("unavailable");
    expect(result.verified).toBe(false);
  });
});

describe("month coverage and the review queue", () => {
  const october = document({
    accountKey: "NL01INGB",
    openingBalanceCents: 100000,
    closingBalanceCents: 290000,
    reviewStatus: "linked",
  });

  test("covered, mismatched, duplicate and not-expected months read differently", () => {
    const mismatched = document({
      id: "sha-nov",
      sha256: "sha-nov",
      accountKey: "NL01INGB",
      periodFrom: "2026-11-01",
      periodTo: "2026-11-30",
      closingBalanceCents: 5,
      reviewStatus: "linked",
    });
    const coverage = statementCoverage({
      documents: [october, mismatched],
      accountKey: "NL01INGB",
      months: ["2026-08", "2026-10", "2026-11"],
      accounts: ACCOUNTS,
      txs: TXS,
      asOf: "2026-11-11",
      expectedFromMonth: "2026-09",
    });
    expect(coverage.map((c) => [c.month, c.status])).toEqual([
      ["2026-08", "not_expected"],
      ["2026-10", "covered"],
      ["2026-11", "mismatched"],
    ]);
    expect(coverage[2]?.reason).toBe("reconciliation-difference");

    const duplicate = statementCoverage({
      documents: [october, { ...october, id: "sha-oct-2", sha256: "sha-oct-2" }],
      accountKey: "NL01INGB",
      months: ["2026-10"],
      accounts: ACCOUNTS,
      txs: TXS,
      asOf: "2026-11-11",
    });
    expect(duplicate[0]?.status).toBe("duplicate");
    expect(duplicate[0]?.reason).toBe("two-statements");
  });

  test("an unmatched statement covering a month keeps that month ambiguous", () => {
    const unmatched = document({ institutionHint: "ing", currency: "EUR" });
    const coverage = statementCoverage({
      documents: [unmatched],
      accountKey: "NL01INGB",
      months: ["2026-10"],
      accounts: ACCOUNTS,
      txs: TXS,
      asOf: "2026-11-11",
    });
    expect(coverage[0]?.status).toBe("ambiguous");
    expect(coverage[0]?.documentIds).toEqual(["sha-oct"]);
  });

  test("a statement with NO period stays visible in the review queue", () => {
    const noPeriod = document({
      id: "sha-scan",
      sha256: "sha-scan",
      filename: "scan.pdf",
      periodFrom: null,
      periodTo: null,
    });
    const queue = statementReviewQueue({
      documents: [noPeriod, october],
      accounts: ACCOUNTS,
    });
    expect(queue.map((item) => [item.document.id, item.reason])).toEqual([
      ["sha-scan", "no-period"],
    ]);
  });

  test("the queue reports a tie and a missing hint instead of guessing", () => {
    const tie = document({ institutionHint: "ing", currency: "EUR" });
    const noHint = document({
      id: "sha-nohint",
      sha256: "sha-nohint",
      filename: "scan 2026-10.pdf",
    });
    const queue = statementReviewQueue({ documents: [tie, noHint], accounts: ACCOUNTS });
    const reasons = Object.fromEntries(queue.map((item) => [item.document.id, item.reason]));
    expect(reasons["sha-oct"]).toBe("ambiguous");
    expect(reasons["sha-nohint"]).toBe("no-hint");
    expect(queue.find((item) => item.document.id === "sha-oct")?.suggestion.status).toBe(
      "ambiguous",
    );
  });
});
