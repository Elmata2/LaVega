/* Een antwoordmail in elkaar zetten, met de hand en zonder bibliotheek.
 *
 * PUUR: velden erin, één RFC-5322-string eruit.
 *
 * WAAROM ZELF EN NIET `mimetext`: dit is dertig regels, en een Worker die een
 * bounce moet kunnen sturen is de laatste plek waar je een afhankelijkheid wil
 * die stil kan breken. De hele functie van dit bestand is: er gaat GEEN mail
 * verloren zonder dat iemand het hoort.
 *
 * WAT CLOUDFLARE EIST van een antwoord op een inkomende mail (email.reply):
 *   - `From` van het antwoord = het adres waaraan de mail geadresseerd was;
 *   - `To` = de afzender van de mail;
 *   - `In-Reply-To` = de Message-ID van de mail. Zonder die header weigert
 *     Cloudflare het antwoord — daarom geeft buildReplyMime null terug als er
 *     geen Message-ID was, zodat de aanroeper op een bounce kan terugvallen in
 *     plaats van te doen alsof er geantwoord is.
 *
 * Tekst gaat als base64 met charset utf-8, en het onderwerp als RFC 2047
 * encoded-word. Niet uit netheid: de tekst is Nederlands, en een 8-bits byte in
 * een SMTP-header of -body is precies hoe zo'n antwoord alsnog onleesbaar
 * aankomt.
 *
 * ELKE HEADER GAAT DOOR `encodeHeaderValue`, en From/Message-ID worden geweigerd
 * als er een regelovergang in staat. Reden (bevinding M11): `Message-ID` en de
 * envelop-afzender komen van buiten, en `parseMail` ziet een LOSSE `\r` niet als
 * regelscheiding. Een `Message-ID` met zo'n `\r` zet anders een eigen `Bcc:` in
 * een mail die wij namens invoices.lavega.dev versturen. Weigeren betekent: geen
 * antwoord mogelijk → de aanroeper bouncet, en er verdwijnt nog steeds niets.
 *
 * `Auto-Submitted: auto-replied` en `Precedence: bulk` staan er met opzet in
 * (bevinding M13): zonder die twee kan een antwoord op een automatisch bericht
 * een mail-lus starten, en dat verbrandt de n8n- en Claude-budgetten van de
 * eigenaar. Ze zijn niet genoeg op zichzelf — de aanroeper weigert ook al te
 * antwoorden op een afzender die zelf een automaat is.
 */

import { bytesToBase64 } from "./parseMail.js";

export type ReplyFields = {
  /** Het adres waarop de mail binnenkwam. */
  from: string;
  /** De afzender van de mail. */
  to: string;
  /** Het onderwerp van de mail; hier komt "Re: " voor. */
  subject: string;
  /** De Message-ID van de mail. Leeg = geen antwoord mogelijk. */
  inReplyTo: string;
  /** De uitleg. Platte tekst, Nederlands. */
  body: string;
};

function utf8Base64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** Alles wat niet ASCII is (of een dubbele punt of nieuwe regel bevat) mag niet
 *  rauw in een header. */
function encodeHeaderValue(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(clean) ? clean : "=?UTF-8?B?" + utf8Base64(clean) + "?=";
}

/** base64 in een mailbody hoort op regels van 76 tekens. */
function wrap76(text: string): string {
  return (text.match(/.{1,76}/g) ?? []).join("\r\n");
}

/**
 * @returns de mail als string, of `null` als er geen Message-ID was om op te
 *   antwoorden. `null` is geen fout die je mag negeren: het betekent dat de
 *   aanroeper moet bouncen.
 */
export function buildReplyMime(fields: ReplyFields): string | null {
  const inReplyTo = fields.inReplyTo.trim();
  if (!inReplyTo) return null;
  // Een regelovergang in From of Message-ID is geen adres of id maar een poging
  // er een header bij te smokkelen (M11). Geen antwoord mogelijk: bouncen.
  if (/[\r\n]/.test(fields.from) || /[\r\n]/.test(inReplyTo)) return null;

  const subject = fields.subject.trim();
  const lines = [
    "From: " + encodeHeaderValue(fields.from),
    // `To` is de envelop-afzender en dus van buiten; encodeHeaderValue haalt er
    // elke regelovergang uit. Een antwoord hoort een antwoord te zijn, geen
    // doorgeefluik voor headers van de afzender.
    "To: " + encodeHeaderValue(fields.to),
    "In-Reply-To: " + encodeHeaderValue(inReplyTo),
    "References: " + encodeHeaderValue(inReplyTo),
    "Subject: " +
      encodeHeaderValue(subject.toLowerCase().startsWith("re:") ? subject : "Re: " + subject),
    "Auto-Submitted: auto-replied",
    "Precedence: bulk",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "MIME-Version: 1.0",
    "",
    wrap76(utf8Base64(fields.body)),
    "",
  ];
  return lines.join("\r\n");
}
