import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readDocumentDate, readIngTariffs } from "./pdfText.js";

const TEXT = readFileSync(new URL("./__fixtures__/ingKostenoverzicht.txt", import.meta.url), "utf8");

test("the ING tariff sheet yields the debit-card koersopslag", () => {
  const figures = readIngTariffs(TEXT);
  const debit = figures.find((f) => /betaalpas/i.test(f.line) && !/opnemen|opname/i.test(f.line));

  expect(debit?.value).toBe(1.4);
  expect(debit?.line).toContain("koersopslag");
});

test("a tiered credit-card rate carries its threshold as a condition, not as a bare number", () => {
  // "tot € 500 per creditcardperiode 0,00%" and "boven € 500 2,00%" are one
  // product with a cap. Reported as a bare 0% it is the Revolut mistake again.
  const figures = readIngTariffs(TEXT);
  const tiered = figures.filter((f) => f.conditions !== null);

  expect(tiered.length).toBeGreaterThan(0);
  expect(tiered.some((f) => /€\s?\d/.test(f.conditions as string))).toBe(true);
});

test("a line with no percentage yields nothing rather than a zero", () => {
  expect(readIngTariffs("Overschrijvingen via Mijn ING   € 0,00")).toEqual([]);
});

test("a capped rate whose threshold sits on the line above is never emitted as a bare 0%", () => {
  // The withdrawal rows split one fact across three lines: "• Vreemde valuta
  // opnemen tot € 500 euro per / creditcardperiode2 ... + / 0,00% koersopslag".
  // Read one line at a time, that 0% arrives with no conditions at all — the
  // Revolut mistake, produced by our own parser instead of inherited.
  //
  // Scoped to the zeros whose own evidence states a cap. An earlier version of
  // this test asserted over ALL zeros, on the premise that "ING publishes no
  // unconditional 0% koersopslag anywhere in this document". That premise was
  // false, and false in this project's error-3 shape: it was concluded from a
  // fixture slice that stopped five lines short of the ING Creditcard Max block,
  // which publishes exactly such a rate. See the next test.
  const capped = readIngTariffs(TEXT).filter((f) => f.value === 0 && /\btot €/i.test(f.line));

  expect(capped.length).toBeGreaterThan(0);
  for (const z of capped) expect(z.conditions).not.toBeNull();
});

test("a 0% the source really does state without a cap stays unconditional", () => {
  // ING Creditcard Max: "• Vreemde valuta opnemen / met een minimum van € 4,50 + /
  // 0,00% koersopslag" — no creditcardperiode cap anywhere in that block, unlike
  // every other card in the table. conditions: null means UNCONDITIONAL, and this
  // row genuinely is. The rule cuts both ways: unknown is never zero, and a
  // documented zero is not to be pattern-matched into a condition it does not
  // have. This is a regression guard on the corrected premise above.
  const bare = readIngTariffs(TEXT).filter((f) => f.value === 0 && f.conditions === null);

  expect(bare.length).toBe(1);
  expect(bare[0].line).toContain("0,00% koersopslag");
  expect(bare[0].line).not.toMatch(/\btot €/i);
});

test("a two-tier statement on ONE line is not stamped with the tier where the rate is zero", () => {
  // The ING Creditcard Extra footnote puts BOTH tiers on one line:
  // "*** Tot € 1000 geen koersopslag per maandcyclus per creditcard contract,
  // daarboven 2,00%". Own-row-wins cannot separate them, so the first threshold
  // match — "Tot € 1000", the tier in which the rate is ZERO — gets stamped onto
  // the 2,00%. A rate carrying the condition under which it does NOT apply is
  // worse than a rate with no condition, because it looks established.
  const footnote = readIngTariffs(TEXT).filter((f) => /maandcyclus/i.test(f.line));

  expect(footnote.length).toBe(1);
  expect(footnote[0].value).toBe(2);
  expect(footnote[0].conditions).toMatch(/daarboven/i);
});

test("a tier's condition comes from its own row, not from the row above it", () => {
  // Two rows, one product: "tot € 500 … 0,00%" and then "boven € 500 … 2,00%".
  // Take the threshold from whichever line is nearest and the 2% inherits the
  // other tier's cap — a rate stamped with the condition under which it does NOT
  // apply. That is worse than no condition, because it looks established.
  const above = readIngTariffs(TEXT).filter((f) => /boven € 500/i.test(f.line) && f.value === 2);

  expect(above.length).toBeGreaterThan(0);
  for (const f of above) expect(f.conditions).toMatch(/boven/i);
});

test("a threshold clause stops before the neighbouring column's number", () => {
  // pdftotext -layout interleaves the columns, so the withdrawal row arrives as
  // "• Vreemde valuta opnemen tot € 500 euro per | 4,00% van het opgenomen bedrag"
  // with the clause's real tail ("creditcardperiode") on the NEXT line. A greedy
  // trailing run swallowed the 4,00 — the ATM withdrawal FEE from the column
  // beside it — and the condition read "tot € 500 euro per 4,00".
  //
  // This is not cosmetic: `conditions` is rendered as a note on screen and read
  // aloud by the chat agent, so it is user-visible text asserting a number that
  // is not part of the threshold at all.
  const withdrawal = readIngTariffs(TEXT).filter((f) => /opnemen tot € 500 euro/i.test(f.line));

  expect(withdrawal.length).toBeGreaterThan(0);
  for (const f of withdrawal) {
    expect(f.conditions).toMatch(/tot € 500/i);
    expect(f.conditions).not.toMatch(/4,00/);
  }
});

test("a figure the parser could not find a cap for is NOT reported as unconditional", () => {
  // The sweep hard-coded conditionsKnown:true on every PDF figure, so "my regex
  // matched no threshold" and "this rate has no conditions" became the same
  // value — the exact conflation the Revolut incident is named after.
  //
  // The cap here is phrased with "maximaal", stated AFTER the figure. Neither
  // shape is in THRESHOLD's vocabulary, so `conditions` is null. The figure is
  // then a 0% with a real source and a real date and nothing to say it expires
  // EUR 1.000 into the month: covered, ranked first, and wrong.
  const [f] = readIngTariffs("• In vreemde valuta 0,00% koersopslag (maximaal € 1.000 per maand, daarna 2,00%)");

  expect(f.value).toBe(0);
  expect(f.conditions).toBeNull();
  expect(f.conditionsKnown).toBe(false);
});

test("only a NAMED clause establishes conditions — absence of a match never does", () => {
  // This document contains its own counterexample to "no threshold in the block
  // means unconditional": the ING Creditcard Max row reads "• Vreemde valuta
  // opnemen / met een minimum van € 4,50 + / 0,00% koersopslag" with no cap in
  // sight, while footnote 2 says the 0% applies "tot het aangegeven maximum per
  // creditcardperiode". A three-line window cannot see a footnote, so silence in
  // the window is not evidence of absence — and the debit card's genuinely
  // uncapped 1,40% is indistinguishable from it by any local rule.
  //
  // So the parser affirms conditions only when it NAMES them. That costs us the
  // one figure the sweep had marked covered, which is the honest price: the
  // alternative is a rule that also marks the capped 0% covered.
  const figures = readIngTariffs(TEXT);

  for (const f of figures) expect(f.conditionsKnown).toBe(f.conditions !== null);
  expect(figures.some((f) => f.conditions !== null && f.conditionsKnown)).toBe(true);
  expect(figures.filter((f) => f.value === 0 && f.conditions === null)[0].conditionsKnown).toBe(false);
});

test("the document's own validity date is read from it, not stamped by the fetch", () => {
  // "A figure keeps the date of the SOURCE that stated it." pdfCheckedAt was a
  // constant typed into state.json by hand, while the sweep re-reads the VALUE
  // every Monday: ING reuses this asset URL across editions (the file is still
  // named _2023.pdf and holds the June 2026 edition), so the next edition's rate
  // would have been stamped with this edition's date. That is error #2 with a
  // delay fuse on it.
  expect(readDocumentDate(TEXT)).toBe("2026-06-15");
  expect(readDocumentDate("geen datum hier")).toBeNull();
});
