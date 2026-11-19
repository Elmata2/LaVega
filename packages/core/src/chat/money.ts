import { formatCents } from "../instinct/render.js";
import type { ChatLocale } from "./view.js";

/** Every amount a tool returns: integer cents plus the text the model may quote.
 *  `text` is what the number guard matches an answer against. */
export type Money = { cents: number; text: string };

const TAG = { nl: "nl-NL", en: "en-GB" } as const;

/** `cents` is signed: a payment out or a debt is negative, shown with a leading minus. */
export function moneyOf(locale: ChatLocale, cents: number, currency = "EUR"): Money {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  if (currency.trim().toUpperCase() === "EUR")
    return { cents, text: `${sign}${formatCents(locale, abs)}` };
  let body: string;
  try {
    body = new Intl.NumberFormat(TAG[locale], { style: "currency", currency })
      .format(abs / 100)
      .replaceAll(" ", " ");
  } catch {
    body = `${(abs / 100).toFixed(2)} ${currency}`;
  }
  return { cents, text: `${sign}${body}` };
}

/** The vault stores decimal euros; the tools speak integer cents. */
export const centsOf = (euros: number): number => Math.round(euros * 100);
