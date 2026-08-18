import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readIngTariffs } from "./pdfText.js";

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
