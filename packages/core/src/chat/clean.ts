import { scrubIdentifiers } from "../categorize.js";

/* Text from bank data or from the owner (a merchant, an account or a bill name)
 * made safe to put in a tool result. Imports set an account's name to its key or
 * to a file name, and bank text carries IBANs and card numbers in every spelling,
 * so this is deliberately wide: identifiers in any separator style go, URLs shrink
 * to their host, invisible and control characters go. Ordinary names (store
 * numbers of four digits included) are left alone. It stays DATA: a merchant
 * called "Ignore previous instructions" is passed on as that text and nothing
 * else. */

// IBAN with spaces, dots or dashes between groups, any case.
// Boundaries are letters and digits, not \b: an underscore ("export_NL91...") is a word character.
// After the country code and check digits comes one group of four (the bank
// code, letters or digits) and then two to seven groups of up to four that each
// hold a digit. A following word ("… Albert Heijn", "t.n.v.") has no digit, so
// it is never swallowed: the merchant behind an IBAN stays readable.
const IBAN_LOOSE =
  /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}[ .-]?[A-Z0-9]{4}(?:[ .-]?(?=[A-Z0-9]{0,3}\d)[A-Z0-9]{1,4}){2,7}(?![\p{L}\p{N}])/giu;
// E-mail addresses with any letters (jörg@exämple.de).
const EMAIL_UNICODE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
// International phone numbers: +CC, optional "(0)", then six or more digits.
const PHONE_INTL = /\+\d{1,3}[\s.-]*(?:\(\d\)[\s.-]*)?\d(?:[\s.-]?\d){5,}/g;
// Nine or more digits, singly joined by space, dot or dash: card, account, BSN, phone.
const DIGIT_RUN = /\d(?:[ .-]?\d){8,}/g;
const URL = /\b(?:https?:\/\/|www\.)([^\s/?#]+)[^\s]*/gi;

export function cleanName(raw: string, max = 60): string {
  const s = String(raw)
    .replace(/\p{Cf}+/gu, "")
    .replace(/\p{Cc}+/gu, " ")
    .replace(URL, "$1")
    .replace(EMAIL_UNICODE, "[EMAIL]")
    .replace(IBAN_LOOSE, "[IBAN]")
    .replace(PHONE_INTL, "[TEL]");
  const scrubbed = scrubIdentifiers(s).replace(DIGIT_RUN, "[nr]").replace(/\s+/g, " ").trim();
  return scrubbed.length <= max ? scrubbed : `${scrubbed.slice(0, max - 1).trimEnd()}…`;
}
