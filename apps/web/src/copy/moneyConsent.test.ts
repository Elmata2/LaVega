import { redactForAi } from "@lavega/core";
import { expect, test } from "vitest";
import { moneyCopy } from "./money.js";

/* The consent text above the AI categoriser lists what is removed from the text before it
 * leaves the browser, and what stays. Each claim is checked against `redactForAi`, the
 * function that does it, so the copy cannot say more than the code does. */

test("redactForAi removes what the consent text says it removes", () => {
  const removed: [string, string][] = [
    ["IBAN", "x NL91ABNA0417164300 y"],
    ["e-mail address", "x jan@example.com y"],
    ["date with a year", "x 01-08-2026 y"],
    ["amount with a euro sign", "x € 45 y"],
    ["amount with EUR in front", "x EUR 45 y"],
    ["amount with two decimals", "x 45,00 y"],
    ["number of four or more digits", "x 12345 y"],
  ];
  for (const [what, input] of removed) {
    const out = redactForAi(input);
    expect(out, what).toBe("x y");
  }
});

test("redactForAi keeps what the consent text says stays", () => {
  expect(redactForAi("x 45 y")).toBe("x 45 y");
  expect(redactForAi("x 14 juli y")).toBe("x 14 juli y");
  expect(redactForAi("x 14-07 y")).toBe("x 14-07 y");
});

test("the consent copy names exactly those removals and exceptions, in both languages", () => {
  const nl = moneyCopy.nl.transacties.consentAfter;
  for (const part of [
    "IBANs",
    "e-mailadressen",
    "datums met een jaar",
    "bedragen met € of EUR ervoor",
    "bedragen met twee decimalen",
    "getallen van vier of meer cijfers",
    "hele bedragen zonder decimalen",
    "datums in woorden",
    "datums zonder jaar",
  ])
    expect(nl, part).toContain(part);
  const en = moneyCopy.en.transacties.consentAfter;
  for (const part of [
    "IBANs",
    "e-mail addresses",
    "dates with a year",
    "amounts with € or EUR in front",
    "amounts with two decimals",
    "numbers of four or more digits",
    "whole amounts without decimals",
    "dates written in words",
    "dates without a year",
  ])
    expect(en, part).toContain(part);
  // The old promise that every amount and date is stripped was not true.
  expect(nl).not.toContain("herkenbare");
  expect(en).not.toContain("recognisable");
});
