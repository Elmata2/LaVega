import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { formatEuro } from "../../format.js";
import KaartenBlock, { ibanTail } from "./KaartenBlock";
import { accounts } from "./fixtures";

const amex: Account = {
  key: "amex-2026.csv",
  iban: "",
  name: "Amex Platinum",
  bank: "American Express",
  entity: "",
  currency: "EUR",
  balance: null,
};

test("KaartenBlock renders one card per account with the holder and the bank", () => {
  const html = renderToStaticMarkup(<KaartenBlock accounts={accounts} onNavigate={() => {}} />);
  expect(html).toContain("Je kaarten");
  expect(html).toContain("bank-card");
  expect(html).toContain("ING");
  expect(html).toContain("Rabobank");
  expect(html).toContain("Holding BV");
  expect(html).toContain("Betaalrekening");
  expect(html).toContain(formatEuro(182_310));
  // The tail of the REAL IBAN goes where the reference prints a card number.
  expect(html).toContain("0001");
});

test("KaartenBlock never renders a card number it does not have", () => {
  const html = renderToStaticMarkup(<KaartenBlock accounts={accounts} onNavigate={() => {}} />);
  // No sixteen-digit PAN, and no four-group filler.
  expect(html).not.toMatch(/\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}/);
  expect(html).toContain("Een kaartnummer heeft LaVega niet.");
});

test("KaartenBlock states what is missing instead of filling it in", () => {
  const html = renderToStaticMarkup(<KaartenBlock accounts={[amex]} onNavigate={() => {}} />);
  // A file-imported Amex has no IBAN, no entity and no saldo yet.
  expect(html).toContain("geen IBAN bekend");
  expect(html).toContain("geen entiteit ingesteld");
  expect(html).toContain("onbekend");
  expect(html).not.toContain(formatEuro(0));
  // And it is recognised as a card, so it sorts to the front of the strip.
  expect(html).toContain("Creditcard");
});

test("KaartenBlock renders an empty state with nothing connected", () => {
  const html = renderToStaticMarkup(<KaartenBlock accounts={[]} onNavigate={() => {}} />);
  expect(html).toContain("Nog geen rekeningen gekoppeld");
  expect(html).not.toContain("bank-card");
});

test("ibanTail returns the real last four, or null", () => {
  expect(ibanTail("NL91ABNA0417164300")).toBe("4300");
  expect(ibanTail("NL91 ABNA 0417 1643 00")).toBe("4300");
  expect(ibanTail("")).toBeNull();
  expect(ibanTail("NL9")).toBeNull();
});
