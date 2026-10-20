/* De misbruikgrens per wachtrij, op de Workers Rate Limiting-binding.
 *
 * WAAROM HIER EN NIET IN packages/core. De wachtrij wordt gevuld door één
 * Cloudflare Worker. Een grens in n8n komt te laat: dan is de mail al
 * aangenomen, gelezen en gepost. De binding telt per sleutel en per
 * Worker-locatie, zonder namespace die je moet aanmaken en zonder dependency.
 *
 * DE SLEUTEL IS HET LOKALE DEEL van het ontvangende adres, dus per wachtrij.
 * Dat is het enige adresdeel dat de client niet kan kiezen: het komt uit RCPT TO
 * en bepaalde welke rij de mail raakt. Een afzender die zijn From-adres
 * verandert, verlegt de grens dus niet.
 *
 * FAIL OPEN, en dat is de belangrijkste regel hier. Ontbreekt de binding of
 * gooit hij, dan gaat de mail gewoon door en staat de reden één keer in het log.
 * Een ontbrekende teller mag nooit een echte factuur weigeren; het ergste wat
 * dit product kan doen is een doorgestuurde factuur laten verdwijnen.
 *
 * De getallen staan ook in wrangler.toml (`[[ratelimits]]`). Ze moeten gelijk
 * zijn, anders belooft de bounce iets anders dan Cloudflare doet; een test leest
 * het TOML-bestand en vergelijkt ze.
 */

import type { RateLimitBinding } from "./types.js";

/** Aantal berichten per wachtrij per periode. */
export const INBOUND_LIMIT = 20;

/** De periode in seconden. Cloudflare staat 10 of 60 toe. */
export const INBOUND_PERIOD_SECONDS = 60;

export type QueueLimitOutcome = { kind: "allowed" } | { kind: "throttled"; reason: string };

/** Alleen loggen als de teller niet werkt, en dat één keer per isolate. */
let warnedAboutLimiter = false;

/** Testhaak: elke test hoort de waarschuwing weer te kunnen zien. */
export function resetLimiterWarning(): void {
  warnedAboutLimiter = false;
}

function warnOnce(warn: (message: string) => void, reason: string): void {
  if (warnedAboutLimiter) return;
  warnedAboutLimiter = true;
  warn(
    "[lavega-email-in] INBOUND_RATE_LIMIT doet niets: " +
      reason +
      ". Inkomende mail wordt niet begrensd.",
  );
}

export function throttledReason(queueKey: string): string {
  return (
    "LaVega heeft deze mail niet aangenomen: wachtrij " +
    queueKey +
    " kreeg te veel mail in korte tijd (de grens is " +
    INBOUND_LIMIT +
    " berichten per " +
    INBOUND_PERIOD_SECONDS +
    " seconden per wachtrij). De mail is NIET verwerkt; stuur hem over een minuut opnieuw door."
  );
}

/**
 * Vraagt de binding om toestemming voor deze wachtrij. Puur genoeg om te testen:
 * de binding en de logger komen erin, er is geen import van Cloudflare.
 */
export async function allowQueueMessage(
  limiter: RateLimitBinding | undefined,
  queueKey: string,
  warn: (message: string) => void = (message) => console.warn(message),
): Promise<QueueLimitOutcome> {
  // De binding komt uit configuratie, niet uit code. Een verkeerd gedeclareerde
  // binding is daarom een mogelijkheid, en dan moet de mail nog steeds door.
  if (!limiter || typeof limiter.limit !== "function") {
    warnOnce(warn, "de binding ontbreekt in de Worker-configuratie");
    return { kind: "allowed" };
  }
  try {
    const { success } = await limiter.limit({ key: queueKey });
    return success ? { kind: "allowed" } : { kind: "throttled", reason: throttledReason(queueKey) };
  } catch (error) {
    warnOnce(
      warn,
      "de binding gaf een fout (" + (error instanceof Error ? error.message : String(error)) + ")",
    );
    return { kind: "allowed" };
  }
}
