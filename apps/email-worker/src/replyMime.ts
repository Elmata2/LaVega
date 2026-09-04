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

  const subject = fields.subject.trim();
  const lines = [
    "From: " + fields.from,
    "To: " + fields.to,
    "In-Reply-To: " + inReplyTo,
    "References: " + inReplyTo,
    "Subject: " +
      encodeHeaderValue(subject.toLowerCase().startsWith("re:") ? subject : "Re: " + subject),
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "MIME-Version: 1.0",
    "",
    wrap76(utf8Base64(fields.body)),
    "",
  ];
  return lines.join("\r\n");
}
