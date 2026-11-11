import { expect, test } from "vitest";
import { CONSENT_TEXT_EN, CONSENT_TEXT_NL, CONSENT_VERSION } from "./instinctConsent.js";

/* The server stamps the consent version and the policy repeats the sentence; the screen
 * shows the web copy. The two must not drift, so this test loads the web copy module by
 * path (the web package is not a dependency of the server). */
const WEB_COPY = new URL("../../web/src/copy/instinct.ts", import.meta.url).pathname;

test("the consent sentence on the screen is the one the server stamps, in both languages", async () => {
  const { instinctCopy } = (await import(/* @vite-ignore */ WEB_COPY)) as {
    instinctCopy: Record<"nl" | "en", { consent: string; whatsappAiConsent: string }>;
  };
  expect(instinctCopy.nl.consent).toBe(CONSENT_TEXT_NL);
  expect(instinctCopy.en.consent).toBe(CONSENT_TEXT_EN);
});

test("the consent sentences and version are the ones the owner agreed to", () => {
  expect(CONSENT_VERSION).toBe("2026-11-v2");
  expect(CONSENT_TEXT_NL).toBe(
    "LaVega leest elke dag rond het tijdstip dat jij kiest je transacties om je melding te maken, en ook wanneer je via WhatsApp een vraag stelt. LaVega bewaart je transacties niet. De meldingen en antwoorden die je krijgt blijven 90 dagen in je overzicht staan; je kunt ze eerder wissen.",
  );
  expect(CONSENT_TEXT_EN).toBe(
    "LaVega reads your transactions each day around the time you choose to make your message, and also when you ask a question on WhatsApp. LaVega does not store your transactions. The messages and answers you receive stay in your overview for 90 days; you can delete them sooner.",
  );
});
