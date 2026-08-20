import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { formatEuro } from "../../format.js";
import KaartenBlock, { bankLogo, ibanTail } from "./KaartenBlock";
import { BANK_LOGOS } from "../../assets/bank-logos.generated";
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
});

test("KaartenBlock carries no note line under it", () => {
  // The explanation that used to sit under the strip is gone (UI review round
  // 2): the faces already show only what LaVega holds, so the paragraph was
  // repeating the picture.
  const html = renderToStaticMarkup(<KaartenBlock accounts={accounts} onNavigate={() => {}} />);
  expect(html).not.toContain("module-foot");
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

/* --- Het banklogo (review 3, item 12) ------------------------------------ */

test("het logo op de kaart komt uit de bundel — er wordt niets opgehaald", () => {
  const html = renderToStaticMarkup(<KaartenBlock accounts={accounts} onNavigate={() => {}} />);
  // Wél een plaatje...
  expect(html).toContain('src="data:image/');
  // ...maar geen enkel verzoek naar buiten. Een logo-request zou die server
  // vertellen bij welke bank hij bankiert; dat is precies wat hier niet mag.
  expect(html).not.toMatch(/src="(https?:)?\/\//);
});

test("een bank zonder eigen logo krijgt er geen van een andere bank", () => {
  const vreemd: Account = { ...amex, bank: "Bank Van Nergens", key: "X1" };
  const html = renderToStaticMarkup(<KaartenBlock accounts={[vreemd]} onNavigate={() => {}} />);
  expect(html).not.toContain("<img");
  // De naam blijft staan — dat is de terugval, geen placeholder.
  expect(html).toContain("Bank Van Nergens");
});

test("bankLogo matcht de bank, en weigert te gokken", () => {
  expect(bankLogo("ING")?.slug).toBe("ing");
  // Zoals Enable Banking en de parsers hem kunnen aanleveren.
  expect(bankLogo("ING Bank N.V.")?.slug).toBe("ing");
  expect(bankLogo("Coöperatieve Rabobank U.A.")?.slug).toBe("rabobank");
  expect(bankLogo("american express")?.slug).toBe("americanexpress");
  // Onbekend is onbekend: geen half-gelijkende naam, geen default.
  expect(bankLogo("Rabo")).toBeNull();
  expect(bankLogo("Bank Van Nergens")).toBeNull();
  expect(bankLogo("")).toBeNull();
});

test("elk gebundeld logo is een data-URI en de bundel blijft klein", () => {
  expect(BANK_LOGOS.length).toBeGreaterThan(5);
  for (const logo of BANK_LOGOS) {
    expect(logo.dataUri.startsWith("data:image/")).toBe(true);
    expect(logo.sourceUrl).toMatch(/^https:\/\//);
    expect(logo.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Een favicon per uitgever, geen og:image-poster: houd het per stuk klein.
    expect(logo.bytes).toBeLessThanOrEqual(24_000);
  }
  const totaal = BANK_LOGOS.reduce((n, l) => n + l.dataUri.length, 0);
  expect(totaal).toBeLessThan(250_000);
});
