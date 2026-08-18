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
  // Revolut mistake, produced by our own parser instead of inherited. ING
  // publishes no unconditional 0% koersopslag anywhere in this document.
  const zeros = readIngTariffs(TEXT).filter((f) => f.value === 0);

  expect(zeros.length).toBeGreaterThan(0);
  for (const z of zeros) expect(z.conditions).not.toBeNull();
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
