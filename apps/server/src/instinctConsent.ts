/* The consent the user gives when they turn the daily message on. Changing the
 * sentence below, or what the agent does with the data, bumps the version, so an
 * earlier consent never stands for a different promise. The web copy
 * (apps/web/src/copy/instinct.ts) carries the same sentences for the screen. */
export const CONSENT_VERSION = "2026-11-v1";

export const CONSENT_TEXT_NL =
  "LaVega leest elke nacht je transacties om je meldingen te sturen, en bewaart ze niet.";
export const CONSENT_TEXT_EN =
  "Every night LaVega reads your transactions to send you alerts, and does not store them.";
