/* Bouw het verzoek aan Claude uit één genormaliseerd bericht.
 *
 * DIT BESTAND DRAAIT OP TWEE PLEKKEN — het is de bron van de Code-node
 * "Bouw Claude-verzoek" in docs/n8n/lavega-invoices.json. `pnpm run sync:n8n`
 * kopieert het daarin. Geen TypeScript-syntax, alleen JSDoc.
 *
 * Het verzoek wordt HIER opgebouwd en niet in een expressie op de HTTP-node:
 * met base64-PDF's erin wordt zo'n expressie onleesbaar en is een fout er niet
 * meer uit te halen.
 *
 * De PDF gaat als document-blok mee. Een factuur is een LAYOUT — bedragen staan
 * in kolommen, btw staat onderaan — en die layout overleeft het platslaan naar
 * tekst niet. Het model moet de pagina zien.
 *
 * En wat het model NIET te horen krijgt is net zo belangrijk. De oude versie
 * zette altijd een regel "Bijlagen: " in het bericht, ook als er geen bijlage
 * was. Dat leest als "er zat niets bij", terwijl wij alleen weten dat n8n ons
 * niets gaf. Op precies die regel antwoordde het model "bevat geen bijlage" —
 * het herhaalde onze eigen bewering. Een lege lijst is dus geen lijst: die
 * regel valt nu weg.
 */

/** @typedef {import('./normalizeGmailMessage.js').NormalizedMessage} NormalizedMessage */

/**
 * @typedef {Object} ClaudeRequest
 * @property {string} model
 * @property {number} max_tokens
 * @property {string} system
 * @property {{ role: 'user', content: unknown[] }[]} messages
 */

const INVOICE_MODEL = 'claude-sonnet-5';

const INVOICE_SYSTEM = [
  'Je leest e-mails en bijlagen en bepaalt of er een FACTUUR in zit.',
  'Antwoord UITSLUITEND met JSON, zonder uitleg eromheen:',
  '{"isInvoice": true|false, "kind": "invoice"|"notification"|"reminder"|"receipt"|"other",',
  ' "invoiceNumber": string|null, "issueDate": "YYYY-MM-DD"|null,',
  ' "dueDate": "YYYY-MM-DD"|null, "amount": number|null, "vatAmount": number|null,',
  ' "currency": string|null, "counterparty": string|null, "direction": "expense"|"income"|null,',
  ' "note": string}',
  'kind beschrijft wat de mail IS:',
  '"invoice" = de factuur zelf staat erin (in de tekst of als bijlage);',
  '"notification" = de mail meldt een factuur die er niet in staat ("uw factuur staat klaar",',
  'inloggen bij de leverancier, een link naar een portaal) — de eigenaar moet hem zelf ophalen;',
  '"reminder" = herinnering of aanmaning voor een factuur die hij al hoorde te hebben;',
  '"receipt" = betaalbewijs of bevestiging van een betaling die al gedaan is;',
  '"other" = geen van deze.',
  'isInvoice is alleen true bij kind "invoice". Een melding, een herinnering en een',
  'betaalbewijs zijn GEEN factuur, ook niet als er een bedrag in staat.',
  'amount is het TOTAAL inclusief btw, als getal, punt als decimaalteken, zonder valutateken.',
  'currency is de valuta die OP DE FACTUUR staat, als ISO-code (EUR, USD, GBP).',
  'Neem hem niet aan: staat er geen valuta, zet dan null. LaVega vraagt het dan zelf.',
  'Een factuur in dollars die als euro wordt geboekt is geen opmaakfoutje maar een',
  'verkeerd bedrag in een boekhouding, en niets waarschuwt de eigenaar daarvoor.',
  'vatAmount is alleen het btw-bedrag.',
  'direction: "expense" als iemand GELD VAN JOU wil, "income" als jij iemand factureert.',
  'Laat een veld null als het er niet staat. Verzin nooit een bedrag of een nummer:',
  'een verzonnen factuur in een boekhouding is erger dan een gemiste factuur.',
  'note is één zin in het Nederlands: wat je zag, en bij een melding of herinnering',
  'wat de eigenaar zelf moet doen.',
  'Staat er onder "Bijlagen" niets, ga dan niet beweren dat er geen bijlage was:',
  'je ziet alleen wat je is meegegeven.',
].join(' ');

/**
 * @param {NormalizedMessage} m
 * @returns {ClaudeRequest}
 */
function buildClaudeRequest(m) {
  const pdfs = Array.isArray(m.pdfs) ? m.pdfs : [];
  /** @type {unknown[]} */
  const content = [];
  for (const pdf of pdfs) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdf.data },
    });
  }

  /** @type {string[]} */
  const lines = [];
  lines.push('Onderwerp: ' + m.subject);
  lines.push('Afzender: ' + m.from);
  lines.push('Datum: ' + m.date);
  // Alleen een regel als er ook echt iets bij zit — zie de kop van dit bestand.
  if (pdfs.length > 0) {
    lines.push(
      'Bijlagen: ' +
        pdfs
          .map(function (p) {
            return p.name;
          })
          .join(', '),
    );
  }
  if (m.truncated) {
    lines.push('(De tekst hieronder is afgekapt; de mail was ' + m.textChars + ' tekens lang.)');
  }
  lines.push('');
  lines.push(m.text || '(deze mail had geen leesbare tekst)');

  content.push({ type: 'text', text: lines.join('\n') });

  return {
    model: INVOICE_MODEL,
    max_tokens: 1024,
    system: INVOICE_SYSTEM,
    messages: [{ role: 'user', content: content }],
  };
}

/**
 * Hoeveel tekens gaan er echt naartoe, PDF-bytes niet meegerekend? Puur om in
 * een run te kunnen zien dat het model gevoed is, in plaats van het aan de
 * tokenteller van Anthropic te moeten afleiden.
 * @param {ClaudeRequest} request
 * @returns {{ documents: number, textChars: number, pdfBytes: number }}
 */
function requestSize(request) {
  let documents = 0;
  let textChars = 0;
  let pdfBytes = 0;
  for (const block of request.messages[0].content) {
    const b = /** @type {Record<string, unknown>} */ (block);
    if (b.type === 'document') {
      documents += 1;
      const source = /** @type {Record<string, unknown>} */ (b.source);
      const data = typeof source.data === 'string' ? source.data : '';
      pdfBytes += Math.floor((data.length * 3) / 4);
    } else if (b.type === 'text') {
      textChars += typeof b.text === 'string' ? b.text.length : 0;
    }
  }
  return { documents: documents, textChars: textChars, pdfBytes: pdfBytes };
}

export { INVOICE_MODEL, INVOICE_SYSTEM, buildClaudeRequest, requestSize };
