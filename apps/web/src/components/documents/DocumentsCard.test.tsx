// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, Tx, VaultDocument } from "@lavega/core";
import DocumentsCard, { type DocumentNotice } from "./DocumentsCard.js";

/* The documents card (WS3.4/WS3.5, issue #293): the upload gate's reasons, the
 * review queue with a no-period statement visible, and a reconciliation line
 * that says "checked" only when the checks actually matched. The pipeline
 * itself is pinned by core's statements.test.ts; these assertions are the
 * rendering contract. */

const AS_OF = "2026-11-11";

const account: Account = {
  key: "NL01INGB",
  iban: "NL01INGB00001234",
  name: "Betaalrekening",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: null,
  openingBalanceCents: 100000,
  openingDate: "2026-10-01",
};

const TXS: Tx[] = [
  {
    id: "t1",
    accountKey: "NL01INGB",
    date: "2026-10-02",
    amount: -100,
    currency: "EUR",
    counterparty: "",
    description: "",
    category: "",
    manual: false,
  },
];

const doc = (overrides: Partial<VaultDocument> = {}): VaultDocument => ({
  id: "doc",
  sha256: "doc",
  filename: "ING afschrift 2026-10.pdf",
  mime: "application/pdf",
  byteSize: 2048,
  kind: "statement",
  source: "manual-upload",
  uploadedAt: AS_OF,
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

const render = (documents: VaultDocument[], notice: DocumentNotice | null = null): string =>
  renderToStaticMarkup(
    <DocumentsCard
      documents={documents}
      accounts={[account]}
      txs={TXS}
      asOf={AS_OF}
      busy={false}
      notice={notice}
      onUpload={() => {}}
      onLink={() => {}}
      onReject={() => {}}
      onRemove={() => {}}
      onEraseAll={() => {}}
    />,
  );

test("a statement with no period stays in the review queue with its reason", () => {
  const noPeriod = doc({
    id: "scan",
    sha256: "scan",
    filename: "scan.pdf",
    periodFrom: null,
    periodTo: null,
  });
  const html = render([noPeriod]);
  expect(html).toContain('data-testid="documents-review"');
  expect(html).toContain('data-testid="documents-review-scan"');
  expect(html).toContain("Geen periode in het bestand gevonden");
});

test("reconciliation says checked only when the checks matched", () => {
  const verified = doc({
    id: "ok",
    sha256: "ok",
    accountKey: "NL01INGB",
    reviewStatus: "linked",
    openingBalanceCents: 100000,
    closingBalanceCents: 90000,
  });
  const mismatched = doc({
    id: "wrong",
    sha256: "wrong",
    accountKey: "NL01INGB",
    reviewStatus: "linked",
    openingBalanceCents: 100000,
    closingBalanceCents: 12345,
  });
  const silent = doc({
    id: "silent",
    sha256: "silent",
    accountKey: "NL01INGB",
    reviewStatus: "linked",
  });
  const html = render([verified, mismatched, silent]);
  expect(html).toContain('data-testid="documents-reconciliation-ok"');
  expect(html).toContain("Gecontroleerd tegen het grootboek");
  expect(html).toContain("Wijkt af van het grootboek");
  // No balances in the file: the card says it cannot check, never "verified".
  const unavailable = html.slice(html.indexOf('data-testid="documents-reconciliation-silent"'));
  expect(unavailable).toContain("Niet te controleren");
  expect(unavailable).toContain("geen saldi in het bestand");
});

test("an over-cap refusal is a reason on screen, and a duplicate says it is one document", () => {
  const refused = render([], {
    kind: "refused",
    filename: "groot.pdf",
    problem: "too-large",
  });
  expect(refused).toContain('data-testid="documents-notice"');
  expect(refused).toContain("groter dan de limiet");
  const duplicate = render([], { kind: "duplicate", filename: "dubbel.pdf" });
  expect(duplicate).toContain("al in de kluis");
  expect(duplicate).toContain("één document");
});

test("the review queue offers linking and rejecting, and a tie is named instead of guessed", () => {
  const suggested = doc({
    id: "suggested",
    sha256: "suggested",
    institutionHint: "ing",
    accountLast4: "1234",
    currency: "EUR",
  });
  const html = render([suggested]);
  expect(html).toContain('data-testid="documents-link-suggested"');
  expect(html).toContain('data-testid="documents-reject-suggested"');
  expect(html).toContain("Voorstel: Betaalrekening");
});

test("erase is offered for the documents on file", () => {
  const html = render([doc()]);
  expect(html).toContain('data-testid="documents-erase"');
  expect(html).toContain("Alle documenten wissen");
  expect(render([])).toContain("Nog geen documenten");
});
