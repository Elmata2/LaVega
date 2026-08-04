// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { makeInvoice } from "@lavega/core";
import { getAiExtractionEnabled } from "./settings.js";

beforeEach(() => {
  localStorage.clear();
});

// Building a draft from an AI extraction result (sourceType "llm" + confidence)
// must produce a valid `expected` invoice that the owner can confirm — and the
// confidence must NOT change the content-hashed identity, so a re-import or a
// later manual re-entry of the same invoice still dedups to one row.
test("AI-draft invoice: llm sourceType + confidence, identity unchanged", () => {
  const draft = {
    entity: "BV1",
    direction: "in" as const,
    counterparty: "ACME BV",
    issueDate: "2026-07-01",
    dueDate: "2026-07-31",
    amount: 121,
    currency: "EUR",
    status: "expected" as const,
  };

  const inv = makeInvoice({ ...draft, sourceType: "llm", confidence: 0.8 });
  expect(inv.sourceType).toBe("llm");
  expect(inv.confidence).toBe(0.8);
  expect(inv.amount).toBe(121);
  expect(inv.direction).toBe("in");
  expect(typeof inv.id).toBe("string");
  expect(inv.id.length).toBeGreaterThan(0);

  // Same invoice built WITHOUT confidence -> identical id (confidence is not in
  // the id-hash), proving confidence doesn't affect invoice identity.
  const same = makeInvoice({ ...draft, sourceType: "llm" });
  expect(same.id).toBe(inv.id);
});

test("AI extraction opt-in defaults to false", () => {
  expect(getAiExtractionEnabled()).toBe(false);
});
