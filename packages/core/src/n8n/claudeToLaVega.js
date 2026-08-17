/* Het antwoord van Claude naar de vorm die LaVega verwacht.
 *
 * DIT BESTAND DRAAIT OP DRIE PLEKKEN — het is de bron van de Code-nodes
 * "Naar LaVega-vorm" en "Melding: zelf ophalen" in
 * docs/n8n/lavega-invoices.json. `pnpm run sync:n8n` kopieert het daarin.
 * Geen TypeScript-syntax, alleen JSDoc.
 *
 * Twee soorten uitkomst, en het verschil is de hele veiligheid van deze
 * workflow:
 *
 *   FACTUUR — heeft een bedrag, en wordt in LaVega een regel die de eigenaar
 *   bevestigt. Zonder bedrag komt hij er niet in. Nooit.
 *
 *   MELDING — heeft GEEN bedragveld, ook geen leeg veld. Een melding kan dus
 *   structureel geen boeking worden; daar is geen validatie voor nodig. Het is
 *   een briefje: "hier wacht iets op je, haal het zelf op."
 *
 * Waarom de melding er is: een mail die zegt "uw factuur staat klaar" is geen
 * factuur, maar hem stil als "geen factuur" wegzetten is liegen door weglating.
 * De eigenaar moet weten dat er iets ligt. De link wijst naar zijn EIGEN
 * mailbox, niet naar de leverancier: die URL komt uit een mail van buiten, en
 * daar sturen we hem niet blind heen.
 */

/**
 * De herkomst van een regel die via het doorstuuradres binnenkwam. ALLE velden
 * zijn optioneel, en dat is de betekenis: bij een bericht uit Gmail staan ze er
 * niet, want er wás geen doorstuuradres en er is geen SPF-uitslag. Een leeg
 * `deliveredTo` zou iets anders zeggen — namelijk dat er wél een adres was en
 * dat we het kwijt zijn.
 *
 * `senderCheck` is nooit een goedkeuring van de factuur. 'passed' betekent
 * alleen dat het domein van de afzender SPF of DKIM doorstond.
 *
 * @typedef {Object} Provenance
 * @property {string} [deliveredTo]  het adres waarop de mail binnenkwam
 * @property {string} [queueKey]     het lokale deel daarvan
 * @property {'passed'|'failed'|'unknown'} [senderCheck]
 * @property {{spf: string, dkim: string, dmarc: string}} [senderChecks]
 */

/**
 * Wat er BINNENKOMT uit de n8n-node — ongevalideerd, want het komt uit een
 * Code-node en uiteindelijk uit een mail van buiten. `senderCheck` is hier
 * gewoon `string`: `provenanceOf` maakt er 'unknown' van als het geen bekende
 * stand is. Het verschil tussen dit type en `Provenance` IS de validatie, en
 * daarom staan ze allebei opgeschreven.
 *
 * @typedef {Object} ProvenanceInput
 * @property {string} [deliveredTo]
 * @property {string} [queueKey]
 * @property {string} [senderCheck]
 * @property {{spf?: string, dkim?: string, dmarc?: string}} [senderChecks]
 */

/**
 * @typedef {Object} QueueInvoice
 * @property {string} source
 * @property {string} messageId
 * @property {string} subject
 * @property {string} from            wie hem stuurde. NIET geverifieerd.
 * @property {string|null} invoiceNumber
 * @property {string|null} issueDate
 * @property {string|null} dueDate
 * @property {number} amountCents
 * @property {number|null} vatCents
 * @property {string|null} currency
 * @property {string|null} counterparty
 * @property {'income'|'expense'} direction
 * @property {string} [note]
 * @property {string} [deliveredTo]
 * @property {string} [queueKey]
 * @property {'passed'|'failed'|'unknown'} [senderCheck]
 * @property {{spf: string, dkim: string, dmarc: string}} [senderChecks]
 */

/**
 * @typedef {Object} QueueNotice
 * @property {string} source
 * @property {string} messageId
 * @property {string} subject
 * @property {string} from
 * @property {string} receivedAt
 * @property {'notification'|'reminder'|'no-amount'|'unreadable'} kind
 * @property {string} reason
 * @property {string} mailUrl
 * @property {string} [deliveredTo]
 * @property {string} [queueKey]
 * @property {'passed'|'failed'|'unknown'} [senderCheck]
 * @property {{spf: string, dkim: string, dmarc: string}} [senderChecks]
 */

/**
 * Naar de mail in zijn eigen Gmail. Niet naar de link uit de mail: die is
 * afkomstig van buiten, is vaak eenmalig, en een nepfactuur ziet er precies
 * hetzelfde uit.
 * @param {string} messageId
 * @returns {string}
 */
function gmailUrl(messageId) {
  return messageId ? 'https://mail.google.com/mail/u/0/#all/' + messageId : '';
}

/**
 * Alleen berichten uit Gmail hebben een Gmail-URL. Een bericht dat op het
 * doorstuuradres binnenkwam heeft een Message-ID van de VERZENDENDE server;
 * dat in een Gmail-URL plakken levert een link op die gegarandeerd nergens op
 * uitkomt. Liever geen link dan een knop die niet kan werken — LaVega laat een
 * lege `mailUrl` gewoon weg.
 * @param {{source?: string, messageId?: string}} msg
 * @returns {string}
 */
function mailUrlFor(msg) {
  return msg.source === 'gmail' ? gmailUrl(String(msg.messageId || '')) : '';
}

/**
 * De herkomst van een regel, en alleen als die er is.
 *
 * Bij Gmail is er geen doorstuuradres en geen SPF-uitslag. Dan komen deze
 * velden er NIET bij staan — een leeg `deliveredTo` zou suggereren dat er wél
 * een adres was en dat we het kwijt zijn. Afwezig is de eerlijke vorm van
 * "niet van toepassing".
 *
 * @param {Record<string, unknown>} msg
 * @returns {Provenance}
 */
function provenanceOf(msg) {
  const deliveredTo = typeof msg.deliveredTo === 'string' ? msg.deliveredTo.trim() : '';
  if (!deliveredTo) return {};
  const checks = /** @type {Record<string, unknown>} */ (
    msg.senderChecks && typeof msg.senderChecks === 'object' ? msg.senderChecks : {}
  );
  return {
    deliveredTo: deliveredTo.slice(0, 200),
    queueKey: String(msg.queueKey || '').slice(0, 120),
    // 'passed' betekent: het domein van de afzender doorstond SPF of DKIM. Het
    // betekent NIET dat de factuur echt is, en LaVega mag dat ook niet zeggen.
    senderCheck: msg.senderCheck === 'passed' || msg.senderCheck === 'failed' ? msg.senderCheck : 'unknown',
    senderChecks: {
      spf: String(checks.spf || 'unknown'),
      dkim: String(checks.dkim || 'unknown'),
      dmarc: String(checks.dmarc || 'unknown'),
    },
  };
}

/**
 * @param {unknown} v
 * @returns {number|null}
 */
function toCents(v) {
  return typeof v === 'number' && isFinite(v) ? Math.round(v * 100) : null;
}

/**
 * @param {unknown} v
 * @returns {string|null}
 */
function toIsoDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * @param {unknown} v
 * @param {number} max
 * @returns {string|null}
 */
function toText(v, max) {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

/**
 * Het model antwoordt met JSON, maar soms met een zin eromheen. Pak het eerste
 * blok tussen accolades; lukt dat niet, dan is er GEEN antwoord — niet "geen
 * factuur".
 * @param {unknown} text
 * @returns {Record<string, unknown>|null}
 */
function parseModelJson(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

/**
 * Welke soort mail zegt het model dat dit is? Een onbekende of ontbrekende
 * `kind` wordt niet stilzwijgend "invoice": we leiden hem af uit isInvoice, en
 * anders is het "other".
 * @param {Record<string, unknown>} parsed
 * @returns {'invoice'|'notification'|'reminder'|'receipt'|'other'}
 */
function modelKind(parsed) {
  const kind = parsed.kind;
  if (kind === 'invoice' || kind === 'notification' || kind === 'reminder' || kind === 'receipt' || kind === 'other') {
    return kind;
  }
  return parsed.isInvoice === true ? 'invoice' : 'other';
}

/**
 * Eén beoordeeld bericht → hooguit één factuurregel OF één melding.
 * `dropped` is de derde uitkomst, met reden, zodat een run kan zeggen hoeveel
 * er wegviel en waarom.
 * @param {{source: string, messageId: string, subject: string, from: string, date: string} & ProvenanceInput} msg
 * @param {Record<string, unknown>|null} parsed
 * @returns {{ invoice: QueueInvoice|null, notice: QueueNotice|null, dropped: string|null }}
 */
function toQueueEntry(msg, parsed) {
  const provenance = provenanceOf(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (msg)));

  if (!parsed) {
    return {
      invoice: null,
      notice: Object.assign(
        /** @type {QueueNotice} */ ({
          source: msg.source,
          messageId: msg.messageId,
          subject: String(msg.subject || '').slice(0, 200),
          from: String(msg.from || '').slice(0, 200),
          receivedAt: String(msg.date || ''),
          kind: 'unreadable',
          reason: 'Het model gaf geen leesbaar antwoord over deze mail. Kijk er zelf even naar.',
          mailUrl: mailUrlFor(msg),
        }),
        provenance,
      ),
      dropped: null,
    };
  }

  const kind = modelKind(parsed);
  const note = toText(parsed.note, 400);

  /** @type {(k: QueueNotice['kind'], reason: string) => QueueNotice} */
  const notice = function (k, reason) {
    return Object.assign(
      {
        source: msg.source,
        messageId: msg.messageId,
        subject: String(msg.subject || '').slice(0, 200),
        from: String(msg.from || '').slice(0, 200),
        receivedAt: String(msg.date || ''),
        kind: k,
        reason: reason,
        mailUrl: mailUrlFor(msg),
      },
      provenance,
    );
  };

  if (kind === 'notification') {
    return { invoice: null, notice: notice('notification', note || 'Deze mail meldt een factuur die er niet in staat; haal hem zelf op.'), dropped: null };
  }
  if (kind === 'reminder') {
    // Een aanmaning NOEMT vaak het bedrag. Boeken we hem, dan staat dezelfde
    // factuur twee keer in de boekhouding — dedup gaat op messageId en die is
    // anders. Dus: melding, en de eigenaar kijkt zelf of hij hem al heeft.
    return { invoice: null, notice: notice('reminder', note || 'Herinnering of aanmaning: controleer of deze factuur al in LaVega staat.'), dropped: null };
  }
  if (kind === 'receipt') {
    // Al betaald, dus het staat al in de bankafschriften. Als verwachte factuur
    // inboeken zou het bedrag dubbel in de prognose zetten.
    return { invoice: null, notice: null, dropped: 'betaalbewijs' };
  }
  if (kind !== 'invoice' || parsed.isInvoice !== true) {
    return { invoice: null, notice: null, dropped: 'geen factuur' };
  }

  const amountCents = toCents(parsed.amount);
  if (amountCents === null || amountCents <= 0) {
    // Het model zag wél een factuur maar geen bedrag. Niet boeken, en ook niet
    // stil weggooien: dan lijkt een gemiste factuur op geen factuur.
    return {
      invoice: null,
      notice: notice('no-amount', note || 'Het model herkende een factuur maar las er geen bedrag in. Zoek het bedrag zelf op.'),
      dropped: null,
    };
  }

  const currency = toText(parsed.currency, 3);
  return {
    invoice: Object.assign(/** @type {QueueInvoice} */ ({
      source: msg.source,
      messageId: msg.messageId,
      subject: String(msg.subject || '').slice(0, 200),
      // De afzender stond tot nu toe alleen op een MELDING. Op een factuurregel
      // hoort hij ook: bij een doorstuuradres is "wie stuurde dit" het enige
      // waarmee hij een regel kan beoordelen die hij niet verwachtte.
      from: String(msg.from || '').slice(0, 200),
      invoiceNumber: toText(parsed.invoiceNumber, 60),
      issueDate: toIsoDate(parsed.issueDate),
      dueDate: toIsoDate(parsed.dueDate),
      amountCents: amountCents,
      vatCents: toCents(parsed.vatAmount),
      // Geen valuta gelezen? Dan null, nooit stilzwijgend 'EUR' — zie de
      // systeemprompt en de Grenzen in FACTUREN.md.
      currency: currency && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : null,
      counterparty: toText(parsed.counterparty, 120),
      direction: parsed.direction === 'income' ? 'income' : 'expense',
      note: note || undefined,
    }), provenance),
    notice: null,
    dropped: null,
  };
}

/**
 * Een mail waar niets uit te lezen viel — geen tekst, geen PDF. Die gaat niet
 * naar het model (dat zou een leeg verzoek zijn, precies de fout die we aan het
 * repareren zijn) maar hij verdwijnt ook niet: hij wordt een melding.
 * @param {{source: string, messageId: string, subject: string, from: string, date: string, reason: string} & ProvenanceInput} msg
 * @returns {QueueNotice}
 */
function noticeForUnreadable(msg) {
  return Object.assign(
    /** @type {QueueNotice} */ ({
      source: msg.source,
      messageId: msg.messageId,
      subject: String(msg.subject || '').slice(0, 200),
      from: String(msg.from || '').slice(0, 200),
      receivedAt: String(msg.date || ''),
      kind: 'unreadable',
      reason: (msg.reason || 'Er viel niets uit deze mail te lezen.') + ' Open hem zelf.',
      mailUrl: mailUrlFor(msg),
    }),
    provenanceOf(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (msg))),
  );
}

export { gmailUrl, mailUrlFor, provenanceOf, parseModelJson, modelKind, toQueueEntry, noticeForUnreadable };
