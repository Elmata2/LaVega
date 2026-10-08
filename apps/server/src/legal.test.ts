import { expect, test } from "vitest";
import { privacyHtml, termsHtml } from "./legal.js";

/* legal.ts says of itself: "Content reflects how LaVega actually works. Keep
 * this truthful." It stopped being true on 2026-08-03, when the AI features,
 * the invoice mail pipeline and the waitlist shipped without the policy moving.
 * These tests are the thing that was missing — they fail when a processor is in
 * the code but not in the policy. */

test("every third party the code sends data to is named in the policy", () => {
  // Railway was here until 2026-09-01, when hosting moved to Vercel and the
  // database to Neon. A processor leaving the stack has to leave the policy too,
  // or it names a company that no longer holds anything.
  for (const processor of [
    "Enable Banking",
    "Mistral",
    "Cloudflare",
    "n8n",
    "Resend",
    "Vercel",
    "Neon",
    "Sentry",
    "Frankfurter",
  ]) {
    expect(privacyHtml, `policy does not name ${processor}`).toContain(processor);
  }
});

test("the policy no longer claims financial data is NEVER sent to a LaVega server", () => {
  // Transaction descriptions, invoice PDFs and chat context do pass through the
  // server on their way to Mistral. Redacted and opt-in, but not "never".
  expect(privacyHtml).not.toMatch(/nooit<\/strong> naar servers van LaVega/);
});

test("the policy says the AI features are opt-in, which is what the code enforces", () => {
  expect(privacyHtml.toLowerCase()).toContain("opt-in");
});

test("the policy names where the AI processor handles the data, which is the AVG-relevant fact", () => {
  expect(privacyHtml).toMatch(/binnen de EU/i);
});

test("the policy and terms say a forgotten password no longer loses the data", () => {
  // docs/adr/0009: the vault key belongs to the account, so "password lost =
  // data lost" and "the key never leaves your device" became false.
  expect(termsHtml).not.toContain("Wachtwoord kwijt = gegevens kwijt");
  expect(termsHtml).toContain("Wachtwoord vergeten");
  expect(privacyHtml).not.toContain("sleutel alleen op je apparaat");
  expect(privacyHtml).toContain("technisch zouden kunnen openen");
});

test("the policy does not claim the server stores nothing, now that Neon does", () => {
  // It said "De LaVega-server bewaart je administratie niet" while a vault
  // backup, broker credentials and preferences sat in Neon. That is the same
  // failure as the one above: the architecture moved and the policy did not.
  expect(privacyHtml).not.toContain("bewaart je administratie niet");
  expect(privacyHtml).toContain("Wat er wél op de server staat");
});

test("the policy does not claim a vault we cannot read", () => {
  // Both the personal vault key and the broker vault are sealed with OUR key
  // (docs/adr/0009). Claiming otherwise would be false.
  expect(privacyHtml).not.toMatch(/die wij niet kunnen lezen/);
  expect(privacyHtml).toMatch(/die wij wél kunnen lezen/);
});

test("the policy tells the user how to erase what is on the server", () => {
  // Wiping browser storage no longer removes everything, so the policy has to
  // say what survives it and what removes that.
  expect(privacyHtml).not.toContain("het wissen van de browseropslag verwijdert alles definitief");
  expect(privacyHtml).toContain("verwijderen van je gegevens op de server");
  expect(privacyHtml).toContain("Autoriteit Persoonsgegevens");
});

test("the policy names Resend for account mail and no longer names the retired waitlist processor", () => {
  expect(privacyHtml).toContain("Resend");
  expect(privacyHtml).not.toContain("Apps Script");
  expect(privacyHtml).not.toMatch(/wachtlijst/i);
});
