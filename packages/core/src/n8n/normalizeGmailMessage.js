/* Normaliseer één bericht uit de Gmail-node tot één vorm.
 *
 * DIT BESTAND DRAAIT OP TWEE PLEKKEN. Het is de bron van de Code-node
 * "Normaliseer bericht" in docs/n8n/lavega-invoices.json: `pnpm run sync:n8n`
 * kopieert de tekst hieronder letterlijk die node in. Daarom staat er geen
 * TypeScript-syntax in — types staan in JSDoc, en die overleeft de kopie.
 *
 * Wat hier misging (16 aug 2026): het model kreeg 768 invoer-tokens. Geen PDF,
 * en van sommige mails geen tekst. Twee oorzaken:
 *   1. Download Attachments stond in de Gmail-node náást Simplify in plaats van
 *      IN Options. n8n leest alleen `options.downloadAttachments`, dus er kwam
 *      nooit een bijlage mee. Dat is in de node zelf rechtgezet.
 *   2. Deze normalisatie las alleen `j.text` en `j.snippet`. Onder Simplify OFF
 *      bestaat `snippet` niet (n8n bouwt het item opnieuw op uit id, threadId,
 *      labelIds en sizeEstimate) en zet mailparser `text` NIET als de mail
 *      alleen een text/html-deel heeft — de gewoonste vorm van een
 *      factuurmail. Zulke mails leverden een lege tekst en vielen stil weg.
 *
 * Daarom leest dit blok nu `text`, `textAsHtml` én `html`, kiest de langste, en
 * zegt in `textSource` welke het geworden is. Wat niet gelezen kon worden, wordt
 * gemeld (`reason`, `skipped`) en nooit als "geen factuur" weggeslikt.
 */

/**
 * Eén bijlage zoals de adapter hem uit `item.binary` haalt.
 * @typedef {{ key: string, fileName: string, mimeType: string, data: string }} MailAttachment
 */

/**
 * Een PDF die aan het model meegaat. `bytes` is de echte grootte, niet de
 * base64-lengte.
 * @typedef {{ name: string, data: string, bytes: number }} InvoicePdf
 */

/**
 * De vorm waar alles ná dit punt op werkt. `source` staat er als unie in en niet
 * als 'gmail': dit is de GEDEELDE vorm, en normalizeInboundMail.js levert hem
 * ook. Zou hier 'gmail' staan, dan zou de tweede envelop een eigen type nodig
 * hebben, en een eigen type is het begin van een tweede pijplijn.
 *
 * @typedef {Object} NormalizedMessage
 * @property {'gmail'|'inbound-mail'} source
 * @property {string} messageId
 * @property {string} subject
 * @property {string} from
 * @property {string} date
 * @property {string} text            de leesbare hoofdtekst, afgekapt
 * @property {'text'|'textAsHtml'|'html'|'snippet'|'none'} textSource  waar die tekst vandaan komt
 * @property {number} textChars       lengte VÓÓR het afkappen
 * @property {boolean} truncated
 * @property {InvoicePdf[]} pdfs
 * @property {string[]} skipped       bijlagen die we bewust niet meesturen, met reden
 * @property {boolean} ok             valt er iets te lezen voor het model?
 * @property {string} reason          waarom niet, als ok false is ('' als ok true is)
 */

/** Meer dan drie PDF's per mail is bijna altijd een nieuwsbrief, geen factuur. */
const MAX_PDFS = 3;
/** Claude weigert documenten boven ongeveer deze grootte. */
const MAX_PDF_BYTES = 4 * 1024 * 1024;
/** Genoeg voor een factuurmail; daarboven betaal je voor voetteksten. */
const MAX_TEXT_CHARS = 6000;
/** Korter dan dit is een onderwerpregel, geen tekst om een factuur uit te lezen. */
const MIN_TEXT_CHARS = 40;

/**
 * @param {unknown} v
 * @returns {string}
 */
function asString(v) {
  return typeof v === 'string' ? v : '';
}

/**
 * Lees een header uit wat mailparser levert: een adresobject met `.text`, of
 * een hele headerregel ("From: Naam <naam@voorbeeld.nl>" — mailparser zet in
 * `headers` de HELE regel, niet alleen de waarde), of gewoon een string.
 * @param {unknown} v
 * @returns {string}
 */
function readHeader(v) {
  if (typeof v === 'string') return v.replace(/^[A-Za-z-]+:\s*/, '').trim();
  if (v && typeof v === 'object') {
    const o = /** @type {Record<string, unknown>} */ (v);
    if (typeof o.text === 'string') return o.text.trim();
    if (Array.isArray(o.value) && o.value.length > 0) {
      const first = /** @type {Record<string, unknown>} */ (o.value[0]);
      const name = asString(first.name);
      const address = asString(first.address);
      return (name ? name + ' <' + address + '>' : address).trim();
    }
  }
  return '';
}

/**
 * HTML naar leesbare tekst. Geen echte parser: blokelementen worden
 * regelovergangen, de rest verdwijnt. Voor een factuurtabel is dat genoeg —
 * bedragen en labels blijven op eigen regels staan.
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|thead|tbody|section|article)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' │ ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&euro;/gi, '€')
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map(function (line) {
      return line.replace(/\s*│\s*$/, '').trim();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Platte tekst opschonen zonder tags te strippen: in text/plain is "10 < 12"
 * gewoon tekst, en een tagfilter zou daar een gat in maken.
 * @param {string} text
 * @returns {string}
 */
function tidyText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Kies de hoofdtekst. mailparser vult `text` alleen bij een text/plain-deel;
 * een mail met uitsluitend HTML levert `html` en verder niets. Veel
 * leveranciers sturen daarnáást een text/plain van twee regels ("Bekijk uw
 * factuur online") met de hele factuur in de HTML — vandaar: pak de LANGSTE,
 * niet de eerste.
 * @param {Record<string, unknown>} j
 * @returns {{ text: string, textSource: 'text'|'textAsHtml'|'html'|'snippet'|'none' }}
 */
function pickBody(j) {
  /** @type {{ text: string, textSource: 'text'|'textAsHtml'|'html'|'snippet'|'none' }[]} */
  const candidates = [
    { text: tidyText(asString(j.text)), textSource: 'text' },
    { text: stripHtml(asString(j.textAsHtml)), textSource: 'textAsHtml' },
    { text: stripHtml(asString(j.html)), textSource: 'html' },
    // `snippet` bestaat niet onder Simplify OFF, maar kost niets als laatste
    // redmiddel — en als iemand de node ooit anders zet, is het er wél.
    { text: tidyText(asString(j.snippet)), textSource: 'snippet' },
  ];
  /** @type {{ text: string, textSource: 'text'|'textAsHtml'|'html'|'snippet'|'none' }} */
  let best = { text: '', textSource: 'none' };
  for (const candidate of candidates) {
    if (candidate.text.length > best.text.length) best = candidate;
  }
  return best;
}

/**
 * Alleen tekens die in base64 voorkomen, en een lengte die een veelvoud van vier
 * is. Een opslagverwijzing bevat een dubbele punt en streepjes en valt hier dus
 * meteen af — precies het onderscheid dat we nodig hebben.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isBase64(value) {
  const clean = String(value).replace(/\s+/g, '');
  if (clean.length === 0 || clean.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(clean);
}

/**
 * Uit alle bijlagen alleen de PDF's, met een reden voor elke die afvalt.
 *
 * `source` bepaalt alleen de TEKST van die redenen, niet de regels. Dat moet
 * wel: "controleer N8N_DEFAULT_BINARY_DATA_MODE" is voor een mail die via het
 * doorstuuradres binnenkwam een instelling die er niets mee te maken heeft, en
 * een melding die naar de verkeerde knop wijst is erger dan geen melding.
 *
 * @param {MailAttachment[]} attachments
 * @param {'gmail'|'inbound-mail'} source
 * @returns {{ pdfs: InvoicePdf[], skipped: string[] }}
 */
function pickPdfs(attachments, source) {
  /** @type {InvoicePdf[]} */
  const pdfs = [];
  /** @type {string[]} */
  const skipped = [];
  for (const attachment of attachments) {
    const name = attachment.fileName || attachment.key;
    const type = attachment.mimeType.toLowerCase();
    const looksPdf = type === 'application/pdf' || /\.pdf$/i.test(name);
    // Een logo van 4 kB uit een handtekening is geen factuur en kost wel tokens.
    if (!looksPdf) continue;
    if (!attachment.data) {
      // n8n bewaart binaire data soms buiten het item (N8N_DEFAULT_BINARY_DATA_MODE
      // op filesystem/s3/database). Dan staat hier geen base64 en mag dit NIET
      // als "geen bijlage" doorgaan.
      skipped.push(
        source === 'inbound-mail'
          ? name + ': de Worker stuurde geen inhoud mee voor deze bijlage'
          : name + ': n8n leverde geen inhoud (binaire opslag staat niet op default)',
      );
      continue;
    }
    // base64 is ~4/3 van de bytes; zo weten we de grootte zonder te decoderen.
    const bytes = Math.floor((attachment.data.length * 3) / 4);
    if (bytes > MAX_PDF_BYTES) {
      skipped.push(name + ': ' + Math.round(bytes / 1024 / 1024) + ' MB, groter dan de limiet van 4 MB');
      continue;
    }
    // Is dit ECHT base64? Toen n8n zijn binaire opslag buiten het item had staan,
    // bevatte `data` een verwijzing ("filesystem-v2:workflows/...") in plaats van
    // de bytes. Die ging ongecontroleerd mee en Claude antwoordde met "Invalid
    // base64 data" — een fout die pas bij de aanbieder aan het licht kwam. Liever
    // hier weigeren en het MELDEN dan iets versturen dat we niet gelezen hebben.
    if (!isBase64(attachment.data)) {
      skipped.push(
        source === 'inbound-mail'
          ? name +
              ': de inhoud is geen base64 maar een verwijzing — de Worker stuurde een opslagverwijzing in plaats van de bytes'
          : name + ': de inhoud is geen base64 maar een verwijzing — controleer N8N_DEFAULT_BINARY_DATA_MODE',
      );
      continue;
    }
    if (pdfs.length >= MAX_PDFS) {
      skipped.push(name + ': meer dan ' + MAX_PDFS + ' PDF-bijlagen in één mail');
      continue;
    }
    pdfs.push({ name: name, data: attachment.data, bytes: bytes });
  }
  return { pdfs: pdfs, skipped: skipped };
}

/**
 * @param {Record<string, unknown>} json      item.json uit de Gmail-node
 * @param {MailAttachment[]} attachments      item.binary, al opgelost door de adapter
 * @returns {NormalizedMessage}
 */
function normalizeGmailMessage(json, attachments) {
  const j = json || {};
  const headers = /** @type {Record<string, unknown>} */ (
    j.headers && typeof j.headers === 'object' ? j.headers : {}
  );

  const subject = asString(j.subject) || readHeader(headers.subject);
  const from = readHeader(j.from) || readHeader(headers.from) || asString(j.From);
  const date = asString(j.date) || readHeader(headers.date) || asString(j.internalDate);

  const body = pickBody(j);
  const textChars = body.text.length;
  const text = body.text.slice(0, MAX_TEXT_CHARS);
  const picked = pickPdfs(Array.isArray(attachments) ? attachments : [], 'gmail');

  const ok = picked.pdfs.length > 0 || text.length >= MIN_TEXT_CHARS;
  let reason = '';
  if (!ok) {
    if (j.payload) {
      reason =
        'De Gmail-node leverde een onbewerkte payload in plaats van gelezen tekst. ' +
        'Zet Simplify uit in de node "Gmail: recente mail".';
    } else if (textChars > 0) {
      reason = 'Maar ' + textChars + ' tekens tekst en geen PDF-bijlage.';
    } else {
      reason = 'Geen leesbare tekst en geen PDF-bijlage in dit bericht.';
    }
  }

  return {
    source: 'gmail',
    messageId: asString(j.id) || asString(j.messageId),
    subject: subject,
    from: from,
    date: date,
    text: text,
    textSource: textChars === 0 ? 'none' : body.textSource,
    textChars: textChars,
    truncated: textChars > text.length,
    pdfs: picked.pdfs,
    skipped: picked.skipped,
    ok: ok,
    reason: reason,
  };
}

export { MAX_PDFS, MAX_PDF_BYTES, MAX_TEXT_CHARS, MIN_TEXT_CHARS, asString, isBase64, stripHtml, tidyText, pickBody, pickPdfs, normalizeGmailMessage };
