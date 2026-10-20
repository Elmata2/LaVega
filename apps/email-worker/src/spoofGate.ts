/* De lokale spoof-poort: wat er geweigerd wordt zonder één authenticatie-uitkomst.
 *
 * WAAROM DIT BESTAAT. Cloudflare meet SPF, DKIM en DMARC vóór aflevering aan de
 * Worker, maar `ForwardableEmailMessage` geeft die uitslag niet mee. Elke
 * `Authentication-Results`-regel is afzendertekst (authResults.ts). Een poort op
 * "SPF faalde" bestaat hier dus niet, en een poort op "de domeinen verschillen"
 * mag niet bestaan: dit product Accepteert DOORGESTUURDE facturen. Een
 * Gmail-gebruiker stuurt een leveranciersfactuur door; MAIL FROM is dan
 * gmail.com en From is de leverancier. Elke regel die eist dat envelop en From
 * hetzelfde domein hebben, weigert precies de hoofdstroom van dit product.
 *
 * WAT ER DAN WÉL overblijft, en waarom elk daarvan onbetwistbaar fout is:
 *
 *   1. De From-regel claimt een adres van ONS (lavega.dev of een subdomein,
 *      zoals invoices.lavega.dev) terwijl de envelop-afzender van buiten komt.
 *      Niemand buiten LaVega schrijft namens LaVega. Dit is impersonatie van de
 *      dienst, niet een leverancier met een afwijkend domein.
 *   2. De envelop-afzender is leeg (`<>`) en het bericht is geen
 *      delivery-statusmelding. Een bounce kan geen klantfactuur zijn en er is
 *      geen adres om op te antwoorden.
 *   3. Uit From of envelop-afzender komt helemaal geen bruikbaar domein. Dan is
 *      niet vast te stellen wie de factuur stuurde en kan er geen antwoord terug.
 *
 * Wat deze poort NIET doet, met opzet: hij keurt geen leverancier goed. Een mail
 * die hier doorheen komt, is nog steeds "afzender onbekend" in de wachtrij. De
 * poort haalt alleen berichten weg die aantoonbaar onwaar zijn.
 *
 * Regel 1 hangt aan de envelop, niet aan een header die de afzender kan
 * schrijven. Regel 2 is de enige uitzondering op "geen DSN weigeren": een
 * afzender kan `Content-Type: multipart/report` zetten om als bounce te lezen.
 * Dat levert hem niets op — de mail gaat dan het gewone pad op en blijft
 * `unknown` — dus dit is hygiëne, geen authenticatie.
 */

import { domainOf } from "./authResults.js";

export const SERVICE_DOMAIN = "lavega.dev";

export type SpoofRefusal =
  | { kind: "null-envelope-sender"; reason: string }
  | { kind: "service-impersonation"; reason: string }
  | { kind: "unusable-from-domain"; reason: string }
  | { kind: "unusable-envelope-domain"; reason: string };

export type SpoofCheckInput = {
  /** MAIL FROM, zoals Cloudflare hem aan de Worker geeft. Mag `<>` zijn. */
  envelopeFrom: string;
  /** De From-header uit de mail. Leeg als de mail er geen had. */
  fromHeader: string;
  /** Top-level headers, kleine letters. Alleen voor de DSN-uitzondering. */
  headers: Record<string, string>;
};

/** `lavega.dev` zelf of een subdomein daarvan. */
export function isServiceDomain(domain: string): boolean {
  return domain === SERVICE_DOMAIN || domain.endsWith("." + SERVICE_DOMAIN);
}

/**
 * Een domein dat een mens of een MTA echt kan hebben geschreven. Bewust ruim:
 * één punt minimaal, labels van letters/cijfers/streepjes, geen leeg label, en
 * een TLD van minstens twee tekens met een letter erin. `localhost`, `x`, en
 * `voorbeeld` vallen af; `xn--` (punycode) blijft erdoor.
 */
export function isPlausibleDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) return false;
  }
  const tld = labels[labels.length - 1];
  return tld.length >= 2 && /[a-z]/i.test(tld);
}

/**
 * RFC 3464: een delivery-statusmelding is `multipart/report` met
 * `report-type=delivery-status`. Alleen die vorm komt langs de lege-envelop-regel;
 * een gewone mail met een lege envelop is geen bounce en wordt geweigerd.
 */
export function isDeliveryStatusNotification(headers: Record<string, string>): boolean {
  const contentType = String(headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("multipart/report")) return false;
  return /report-type\s*=\s*"?delivery-status"?/.test(contentType);
}

/** Headertekst komt van buiten en gaat terug naar buiten in een bounce. */
function quote(value: string, max = 80): string {
  const clean = String(value || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function noAnswerAddress(): string {
  return "Zonder geldig afzenderadres kan LaVega niet antwoorden. Stuur de factuur vanaf een gewoon e-mailadres.";
}

/**
 * Het oordeel, of null als de mail door mag. Puur: geen platform-API, geen
 * tijd, geen netwerk.
 */
export function checkSpoofGate(input: SpoofCheckInput): SpoofRefusal | null {
  const envelope = String(input.envelopeFrom || "").trim();
  const fromHeader = String(input.fromHeader || "").trim();
  const envelopeDomain = domainOf(envelope);
  const fromDomain = domainOf(fromHeader);

  if (envelope === "" || envelope === "<>") {
    /* Een delivery-statusmelding heeft per RFC altijd een lege envelop. Die
     * mag door: hij is geen factuur, maar hem hier weigeren zou een echte
     * leveringsfout verbergen. Het gewone pad antwoordt er niets op. */
    if (isDeliveryStatusNotification(input.headers)) return null;
    return {
      kind: "null-envelope-sender",
      reason:
        "LaVega heeft deze mail niet aangenomen: de envelop-afzender is leeg (<>) en dit is geen leveringsmelding. " +
        "Een bounce kan geen factuur zijn. Stuur de factuur vanaf een gewoon e-mailadres.",
    };
  }

  if (isServiceDomain(fromDomain) && envelopeDomain && !isServiceDomain(envelopeDomain)) {
    return {
      kind: "service-impersonation",
      reason:
        "LaVega heeft deze mail niet aangenomen: de From-regel zegt " +
        fromDomain +
        " (een adres van LaVega zelf), maar de envelop-afzender " +
        quote(envelope) +
        " hoort niet bij " +
        SERVICE_DOMAIN +
        ". Een bericht dat zich voordoet als LaVega wordt niet verwerkt. Stuur de factuur vanaf je eigen adres.",
    };
  }

  if (!isPlausibleDomain(fromDomain)) {
    return {
      kind: "unusable-from-domain",
      reason: fromHeader
        ? "LaVega heeft deze mail niet aangenomen: uit de From-regel (" +
          quote(fromHeader) +
          ") komt geen bruikbaar domein. " +
          noAnswerAddress()
        : "LaVega heeft deze mail niet aangenomen: deze mail heeft geen bruikbare From-regel, dus LaVega weet niet wie de factuur stuurde. " +
          noAnswerAddress(),
    };
  }

  if (!isPlausibleDomain(envelopeDomain)) {
    return {
      kind: "unusable-envelope-domain",
      reason:
        "LaVega heeft deze mail niet aangenomen: de envelop-afzender (" +
        quote(envelope) +
        ") heeft geen bruikbaar domein. " +
        noAnswerAddress(),
    };
  }

  return null;
}
