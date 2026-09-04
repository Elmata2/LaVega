/* Normaliseer één bericht dat via het DOORSTUURADRES binnenkwam.
 *
 * DIT BESTAND DRAAIT OP TWEE PLEKKEN. Het is, samen met
 * normalizeGmailMessage.js, de bron van de Code-node "Normaliseer binnengekomen
 * mail" in docs/n8n/lavega-invoices.json: `pnpm run sync:n8n` plakt beide
 * bestanden achter elkaar in die node. Daarom staat er geen TypeScript-syntax
 * in — types staan in JSDoc — en daarom worden de `import`-regels hieronder bij
 * het genereren wéggehaald: in n8n staat de inhoud van
 * normalizeGmailMessage.js er letterlijk bóven, dus die functies bestaan daar
 * gewoon in dezelfde scope.
 *
 * WAAROM DIT GEEN TWEEDE NORMALISATIE IS. Alles wat betekenis heeft — welke
 * tekst de hoofdtekst is, welke bijlage een factuur kan zijn, wanneer er niets
 * te lezen valt — komt uit `pickBody` en `pickPdfs` hiernaast, precies dezelfde
 * functies die de Gmail-tak gebruikt en die daar getest zijn. Wat hier staat is
 * alleen de ENVELOP: welk veld van de Cloudflare Email Worker welk veld van een
 * bericht is. Twee normalisaties naast elkaar zouden binnen een maand uit elkaar
 * lopen, en de eerste die dat merkt is een gemiste factuur.
 *
 * WAT HIER ANDERS IS DAN BIJ GMAIL, en waarom dat er in de rij bij moet staan:
 *
 *   1. HERKOMST. Een mail uit Gmail is per definitie zijn eigen mail. Een mail
 *      op het doorstuuradres kan van iedereen komen die het adres kent. Daarom
 *      dragen deze regels `deliveredTo` (op welk adres hij binnenkwam) en
 *      `from` (wie hem stuurde) mee tot in de wachtrij: hij moet een regel die
 *      hij niet verwachtte kunnen beoordelen.
 *
 *   2. DE AFZENDER IS NIET GECONTROLEERD. `senderChecks` is wat Cloudflare in
 *      de header `Authentication-Results` zette, letterlijk doorgegeven.
 *      `senderCheck` vat dat samen in drie standen — 'passed', 'failed',
 *      'unknown' — en 'passed' betekent uitsluitend dat het DOMEIN de controle
 *      doorstond, niet dat de factuur echt is. Een mail die zakt wordt GEMARKEERD,
 *      niet weggegooid: wegggooien is het enige wat erger is dan een nepfactuur
 *      tonen, want dan mist hij een echte zonder het te weten.
 *
 *   3. GEEN GMAIL-LINK. `toQueueEntry` zet `mailUrl` alleen voor bron 'gmail'.
 *      Een mail-id uit een doorgestuurd bericht in een Gmail-URL plakken levert
 *      een link op die naar niets wijst; dat is een advies dat niet kan werken.
 */

import {
  MAX_TEXT_CHARS,
  MIN_TEXT_CHARS,
  asString,
  pickBody,
  pickPdfs,
} from "./normalizeGmailMessage.js";

/** @typedef {import('./normalizeGmailMessage.js').InvoicePdf} InvoicePdf */

/**
 * Eén bijlage zoals de Worker hem in de JSON zet: de bytes als base64, niets
 * meer. Er is geen n8n-binaire opslag in dit pad.
 * @typedef {{ fileName: string, mimeType: string, data: string }} InboundAttachment
 */

/**
 * De uitslag van SPF/DKIM/DMARC zoals Cloudflare hem in `Authentication-Results`
 * zet. Een waarde die we niet kennen — of een ontbrekende header — wordt
 * 'unknown'. NOOIT 'pass': onbekend is geen goedkeuring.
 * @typedef {'pass'|'fail'|'softfail'|'neutral'|'none'|'temperror'|'permerror'|'unknown'} AuthResult
 */

/**
 * @typedef {{ spf: AuthResult, dkim: AuthResult, dmarc: AuthResult }} SenderChecks
 */

/**
 * Wat de Cloudflare Email Worker POST naar de webhook "E-mail binnen".
 * @typedef {Object} InboundMailPayload
 * @property {string} to          het volledige adres waarop de mail binnenkwam
 * @property {string} queueKey    het lokale deel daarvan; identificeert de rij
 * @property {string} from        de afzender, ONGECONTROLEERD
 * @property {string} subject
 * @property {string} date
 * @property {string} messageId
 * @property {string} text        het text/plain-deel, leeg als het er niet was
 * @property {string} html        het text/html-deel, leeg als het er niet was
 * @property {SenderChecks} [auth]
 * @property {InboundAttachment[]} attachments
 */

/**
 * Precies de gedeelde vorm uit normalizeGmailMessage.js, plus de herkomst. Dit
 * is met opzet een UITBREIDING en geen eigen typedef: zodra de twee vormen los
 * van elkaar opgeschreven staan, kunnen ze los van elkaar veranderen.
 *
 * @typedef {import('./normalizeGmailMessage.js').NormalizedMessage & {
 *   deliveredTo: string,
 *   queueKey: string,
 *   senderChecks: SenderChecks,
 *   senderCheck: 'passed'|'failed'|'unknown'
 * }} NormalizedInboundMessage
 */

/** De uitslagen die SPF/DKIM/DMARC volgens RFC 7601 kunnen geven. */
const AUTH_RESULTS = ["pass", "fail", "softfail", "neutral", "none", "temperror", "permerror"];

/**
 * Alles wat we niet als geldige uitslag herkennen wordt 'unknown'. Dit is de
 * plek waar de regel "onbekend is nooit stilzwijgend een waarde" wordt
 * afgedwongen: een ontbrekende of rare `auth` levert drie keer 'unknown' op, en
 * dat is zichtbaar iets anders dan drie keer 'pass'.
 * @param {unknown} v
 * @returns {AuthResult}
 */
function readAuthResult(v) {
  const value = asString(v).toLowerCase().trim();
  return AUTH_RESULTS.indexOf(value) >= 0 ? /** @type {AuthResult} */ (value) : "unknown";
}

/**
 * @param {unknown} v
 * @returns {SenderChecks}
 */
function readSenderChecks(v) {
  const o = /** @type {Record<string, unknown>} */ (v && typeof v === "object" ? v : {});
  return {
    spf: readAuthResult(o.spf),
    dkim: readAuthResult(o.dkim),
    dmarc: readAuthResult(o.dmarc),
  };
}

/**
 * Drie standen, en de derde is het punt. Een mail waarvan we NIETS weten mag
 * niet dezelfde kleur krijgen als een mail die de controle doorstond.
 *
 * 'failed'  — minstens één controle zakte (fail, softfail of permerror).
 * 'passed'  — niets zakte én SPF of DKIM stond echt op 'pass'.
 * 'unknown' — al het andere: geen header, tijdelijke fout, alleen 'none'.
 *
 * 'passed' zegt: deze mail kwam echt van dat domein. Het zegt NIETS over de
 * vraag of de factuur klopt.
 * @param {SenderChecks} checks
 * @returns {'passed'|'failed'|'unknown'}
 */
function senderCheckOf(checks) {
  const bad = ["fail", "softfail", "permerror"];
  if (
    bad.indexOf(checks.spf) >= 0 ||
    bad.indexOf(checks.dkim) >= 0 ||
    bad.indexOf(checks.dmarc) >= 0
  ) {
    return "failed";
  }
  if (checks.spf === "pass" || checks.dkim === "pass") return "passed";
  return "unknown";
}

/**
 * Waarom viel er niets te lezen? De vraag is niet retorisch: elk van deze
 * antwoorden wijst een andere knop aan, en een melding die de verkeerde
 * aanwijst kost hem een middag.
 * @param {number} textChars
 * @param {string[]} skipped
 * @param {number} attachmentCount
 * @returns {string}
 */
function reasonForUnreadable(textChars, skipped, attachmentCount) {
  if (skipped.length > 0) {
    return "Geen leesbare tekst, en de bijlage ging niet mee — " + skipped.join("; ") + ".";
  }
  if (textChars > 0) {
    return "Maar " + textChars + " tekens tekst en geen PDF-bijlage in de doorgestuurde mail.";
  }
  if (attachmentCount > 0) {
    return (
      "Geen leesbare tekst, en van de " +
      attachmentCount +
      " bijlage(n) was er geen enkele een PDF. Een gescande bon als afbeelding wordt niet gelezen; stuur de PDF door."
    );
  }
  return "Geen leesbare tekst en geen bijlage in de doorgestuurde mail.";
}

/**
 * @param {InboundMailPayload|Record<string, unknown>} payload
 * @returns {NormalizedInboundMessage}
 */
function normalizeInboundMail(payload) {
  const p = /** @type {Record<string, unknown>} */ (
    payload && typeof payload === "object" ? payload : {}
  );

  // pickBody kijkt naar text / textAsHtml / html en pakt de LANGSTE. Bij gelijke
  // lengte wint text/plain, want die staat vooraan in zijn kandidatenlijst — en
  // dat is precies de voorkeur die hier hoort. Alleen text/plain nemen zou de
  // fout van 16 augustus herhalen: de leverancier stuurt twee regels platte
  // tekst ("Bekijk uw factuur online") náást de hele factuur in HTML.
  const body = pickBody({ text: asString(p.text), html: asString(p.html) });
  const textChars = body.text.length;
  const text = body.text.slice(0, MAX_TEXT_CHARS);

  const rawAttachments = Array.isArray(p.attachments) ? p.attachments : [];
  const attachments = rawAttachments.map(function (a, index) {
    const o = /** @type {Record<string, unknown>} */ (a && typeof a === "object" ? a : {});
    return {
      key: "attachment_" + index,
      fileName: asString(o.fileName),
      mimeType: asString(o.mimeType),
      data: asString(o.data),
    };
  });
  const picked = pickPdfs(attachments, "inbound-mail");

  const ok = picked.pdfs.length > 0 || text.length >= MIN_TEXT_CHARS;
  const senderChecks = readSenderChecks(p.auth);

  return {
    source: "inbound-mail",
    messageId: asString(p.messageId),
    subject: asString(p.subject),
    from: asString(p.from),
    date: asString(p.date),
    text: text,
    textSource: textChars === 0 ? "none" : body.textSource,
    textChars: textChars,
    truncated: textChars > text.length,
    pdfs: picked.pdfs,
    skipped: picked.skipped,
    ok: ok,
    reason: ok ? "" : reasonForUnreadable(textChars, picked.skipped, attachments.length),
    deliveredTo: asString(p.to),
    queueKey: asString(p.queueKey),
    senderChecks: senderChecks,
    senderCheck: senderCheckOf(senderChecks),
  };
}

export { AUTH_RESULTS, readAuthResult, readSenderChecks, senderCheckOf, normalizeInboundMail };
