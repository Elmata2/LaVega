/* The consent the user gives when they turn the daily message on. Changing the
 * sentence below, or what the agent does with the data, bumps the version, so an
 * earlier consent never stands for a different promise. The web copy
 * (apps/web/src/copy/instinct.ts) carries the same sentences for the screen. */
export const CONSENT_VERSION = "2026-11-v2";

export const CONSENT_TEXT_NL =
  "LaVega leest elke dag rond het tijdstip dat jij kiest je transacties om je melding te maken, en ook wanneer je via WhatsApp een vraag stelt. LaVega bewaart je transacties niet. De meldingen en antwoorden die je krijgt blijven 90 dagen in je overzicht staan; je kunt ze eerder wissen.";
export const CONSENT_TEXT_EN =
  "LaVega reads your transactions each day around the time you choose to make your message, and also when you ask a question on WhatsApp. LaVega does not store your transactions. The messages and answers you receive stay in your overview for 90 days; you can delete them sooner.";
