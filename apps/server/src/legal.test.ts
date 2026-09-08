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
    "Google",
    "Vercel",
    "Neon",
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

test("the policy still states the things that remained true", () => {
  expect(privacyHtml).toContain("alleen-lezen"); // no payment initiation
  expect(privacyHtml).toContain("AES-GCM"); // vault crypto
  expect(termsHtml).toContain("Wachtwoord kwijt");
});

test("both pages are complete HTML documents", () => {
  for (const html of [privacyHtml, termsHtml]) {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  }
});

test("the policy does not claim the server stores nothing, now that Neon does", () => {
  // It said "De LaVega-server bewaart je administratie niet" while a vault
  // backup, broker credentials and preferences sat in Neon. That is the same
  // failure as the one above: the architecture moved and the policy did not.
  expect(privacyHtml).not.toContain("bewaart je administratie niet");
  expect(privacyHtml).toContain("Wat er wél op de server staat");
});

test("the policy separates the vault we cannot read from the broker data we can", () => {
  // One blanket "your data is yours" would be false for the broker vault, which
  // is sealed with OUR key because the server has to use it to sync.
  expect(privacyHtml).toMatch(/die wij niet kunnen lezen/);
  expect(privacyHtml).toMatch(/die wij wél kunnen lezen/);
});

test("the policy tells the user how to erase what is on the server", () => {
  // Wiping browser storage no longer removes everything, so the policy has to
  // say what survives it and what removes that.
  expect(privacyHtml).not.toContain("het wissen van de browseropslag verwijdert alles definitief");
  expect(privacyHtml).toContain("verwijderen van je gegevens op de server");
  expect(privacyHtml).toContain("Autoriteit Persoonsgegevens");
});
