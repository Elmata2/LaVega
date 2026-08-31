import { expect, test } from "vitest";
import { privacyHtml, termsHtml } from "./legal.js";

/* legal.ts says of itself: "Content reflects how LaVega actually works. Keep
 * this truthful." It stopped being true on 2026-08-03, when the AI features,
 * the invoice mail pipeline and the waitlist shipped without the policy moving.
 * These tests are the thing that was missing — they fail when a processor is in
 * the code but not in the policy. */

test("every third party the code sends data to is named in the policy", () => {
  for (const processor of ["Enable Banking", "Anthropic", "Cloudflare", "n8n", "Google", "Railway", "Frankfurter"]) {
    expect(privacyHtml, `policy does not name ${processor}`).toContain(processor);
  }
});

test("the policy no longer claims financial data is NEVER sent to a LaVega server", () => {
  // Transaction descriptions, invoice PDFs and chat context do pass through the
  // server on their way to Anthropic. Redacted and opt-in, but not "never".
  expect(privacyHtml).not.toMatch(/nooit<\/strong> naar servers van LaVega/);
});

test("the policy says the AI features are opt-in, which is what the code enforces", () => {
  expect(privacyHtml.toLowerCase()).toContain("opt-in");
});

test("the policy names the transfer outside the EU, which is the AVG-relevant fact", () => {
  expect(privacyHtml).toMatch(/buiten de E[UER]/i);
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
