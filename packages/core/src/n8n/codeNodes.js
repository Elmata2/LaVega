/* Hoe de Code-nodes in docs/n8n/lavega-invoices.json gemaakt worden.
 *
 * Het probleem dat dit oplost: de logica van die workflow stond als STRING in
 * een JSON-bestand. Niets controleerde hem, en daardoor kon er maandenlang een
 * verzoek de deur uit gaan waar het halve bericht en de hele bijlage uit
 * weggelaten waren.
 *
 * Nu is het andersom. De logica staat in gewone .js-bestanden hiernaast, wordt
 * met vitest getest, en `pnpm run sync:n8n` schrijft hem letterlijk in de JSON.
 * `codeNodes.test.ts` bouwt hem opnieuw en vergelijkt met wat er in de JSON
 * staat, dus een node die uit de pas loopt laat de suite vallen.
 *
 * Kunnen ze alsnog uit elkaar lopen? Ja, op één manier: iemand bewerkt de Code
 * in de n8n-web-UI en exporteert de workflow terug. Dan wint de JSON en klopt
 * de test niet meer — precies wat je wil weten. De adapters onderaan elke node
 * (de $input-lussen, $getWorkflowStaticData, this.helpers) staan hieronder als
 * tekst en worden NIET getest; ze zijn met opzet zo kort mogelijk gehouden,
 * want alles wat daarin staat kan alleen in n8n zelf falen.
 */

/**
 * @typedef {Object} CodeNodeSpec
 * @property {string} id        node-id in de workflow-JSON
 * @property {string} name      node-naam
 * @property {string[]} sources bestandsnamen naast dit bestand, in volgorde
 * @property {string} adapter   de n8n-specifieke staart
 */

/**
 * Haal de `export { ... };`-regel eraf: n8n's Code-node kent geen modules.
 * Verder blijft de tekst letterlijk gelijk — dat is het hele punt.
 * @param {string} source
 * @returns {string}
 */
function stripExports(source) {
  return source.replace(/^export \{[\s\S]*?\};[ \t]*$/gm, '').trimEnd();
}

/**
 * @param {string[]} sources  de inhoud van de gedeelde bestanden, in volgorde
 * @param {string} adapter
 * @returns {string}
 */
function buildCodeNode(sources, adapter) {
  const body = sources
    .map(function (source) {
      return stripExports(source);
    })
    .join('\n\n');
  return body + '\n\n' + adapter.trim() + '\n';
}

const SHARED_NOTE = [
  '// ── n8n-adapter ─────────────────────────────────────────────────────────',
  '// Alles hierboven is LETTERLIJK gekopieerd uit packages/core/src/n8n/ en',
  '// wordt daar getest. Wijzig het daar en draai `pnpm run sync:n8n`; wijzig je',
  '// het hier of in de n8n-UI, dan valt `codeNodes.test.ts` om.',
].join('\n');

const NORMALISE_ADAPTER = [
  SHARED_NOTE,
  '',
  "const store = $getWorkflowStaticData('global');",
  'if (!Array.isArray(store.seenIds)) store.seenIds = [];',
  'const seen = new Set(store.seenIds);',
  "const helpers = typeof this !== 'undefined' && this && this.helpers ? this.helpers : null;",
  '',
  'const items = $input.all();',
  'const out = [];',
  'for (let i = 0; i < items.length; i++) {',
  '  const item = items[i];',
  '  const bin = item.binary || {};',
  '  const attachments = [];',
  '  for (const key of Object.keys(bin)) {',
  '    const b = bin[key] || {};',
  '    let data = \'\';',
  '    if (b.id && helpers && helpers.getBinaryDataBuffer) {',
  '      // b.id AANWEZIG betekent: de bytes staan NIET in het item. Dan bevat',
  "      // b.data een verwijzing ('filesystem-v2:...'), geen base64 — en die",
  '      // verwijzing als base64 doorsturen geeft precies de fout die we zagen:',
  '      // "Invalid base64 data". Dus b.id beslist, niet of b.data leeg is.',
  '      const buffer = await helpers.getBinaryDataBuffer(i, key);',
  "      data = buffer.toString('base64');",
  "    } else if (typeof b.data === 'string') {",
  '      data = b.data;',
  '    }',
  '    attachments.push({',
  '      key: key,',
  '      fileName: String(b.fileName || key),',
  "      mimeType: String(b.mimeType || ''),",
  '      data: data,',
  '    });',
  '  }',
  '  const message = normalizeGmailMessage(item.json || {}, attachments);',
  '  // Al door het model beoordeeld in een eerdere run? Dan niet opnieuw sturen:',
  '  // de schedule loopt elk uur over dezelfde zeven dagen mail.',
  '  if (message.messageId && seen.has(message.messageId)) continue;',
  '  out.push({ json: message });',
  '}',
  'return out;',
].join('\n');

const REQUEST_ADAPTER = [
  SHARED_NOTE,
  '',
  'const out = [];',
  'for (const item of $input.all()) {',
  '  const message = item.json;',
  '  const request = buildClaudeRequest(message);',
  '  const size = requestSize(request);',
  '  out.push({ json: {',
  '    source: message.source,',
  '    messageId: message.messageId,',
  '    subject: message.subject,',
  '    from: message.from,',
  '    date: message.date,',
  '    // In de run zelf te zien wat er de deur uit ging. 768 invoer-tokens zonder',
  '    // document was het teken dat er niets meeging; dit maakt dat zichtbaar',
  '    // zonder de tokenteller van Anthropic te hoeven lezen.',
  '    sent: {',
  '      documents: size.documents,',
  '      textChars: size.textChars,',
  '      pdfBytes: size.pdfBytes,',
  '      textSource: message.textSource,',
  '    },',
  '    body: request,',
  '  } });',
  '}',
  'return out;',
].join('\n');

const TO_LAVEGA_ADAPTER = [
  SHARED_NOTE,
  '',
  '// Een mislukte modelaanroep mag NIET stil als "0 facturen" eindigen. De',
  '// HTTP-node staat op continueRegularOutput zodat één rotte mail de run niet',
  '// sloopt; dat verbergt ook een kapotte sleutel, dus tellen we de fouten en',
  '// maken we de run rood als ALLES faalde.',
  'const failed = (j) => !!(j && (j.error || j.type === \'error\'));',
  'const items = $input.all();',
  'const errors = [];',
  'for (const it of items) {',
  '  const j = it.json || {};',
  '  if (!failed(j)) continue;',
  '  const e = j.error || j;',
  "  errors.push(String((e && e.error && e.error.message) || (e && e.message) || 'onbekende fout').slice(0, 300));",
  '}',
  'if (errors.length > 0 && errors.length === items.length) {',
  "  throw new Error('Alle modelaanroepen mislukten: ' + errors[0]);",
  '}',
  '',
  "const asked = $('Bouw Claude-verzoek').all();",
  'const invoices = [];',
  'const notices = [];',
  'const dropped = [];',
  'const processedIds = [];',
  '',
  'for (let i = 0; i < items.length; i++) {',
  '  const src = asked[i] ? asked[i].json : null;',
  '  if (!src) continue;',
  '  const j = items[i].json || {};',
  '  // Deze mail is NIET beoordeeld. Niet onthouden als gezien, dus de volgende',
  '  // run probeert hem opnieuw; de fout staat hieronder in de uitvoer.',
  '  if (failed(j)) continue;',
  '  const msg = {',
  '    source: src.source,',
  '    messageId: src.messageId,',
  '    subject: src.subject,',
  '    from: src.from,',
  '    date: src.date,',
  '  };',
  "  const text = j.content && j.content[0] ? j.content[0].text : '';",
  '  const entry = toQueueEntry(msg, parseModelJson(text));',
  '  if (entry.invoice) invoices.push(entry.invoice);',
  '  if (entry.notice) notices.push(entry.notice);',
  '  if (entry.dropped) dropped.push(entry.dropped);',
  '  processedIds.push(src.messageId);',
  '}',
  '',
  '// Eén verzoek met alles erin: LaVega zet ze in een wachtrij die JIJ bevestigt.',
  '// Er wordt niets automatisch geboekt.',
  'return [{ json: { invoices, notices, dropped, errors, processedIds } }];',
].join('\n');

const UNREADABLE_ADAPTER = [
  SHARED_NOTE,
  '',
  '// Hier komen de mails die de vorige node niet kon lezen: geen tekst én geen',
  '// PDF. Naar het model sturen heeft geen zin — dat is precies het lege verzoek',
  '// dat we aan het repareren zijn — maar weggooien mag ook niet, want dan lijkt',
  '// een gemiste factuur op geen factuur.',
  'const notices = [];',
  'for (const item of $input.all()) {',
  '  const m = item.json || {};',
  '  notices.push(noticeForUnreadable({',
  '    source: m.source,',
  '    messageId: m.messageId,',
  '    subject: m.subject,',
  '    from: m.from,',
  '    date: m.date,',
  '    reason: m.reason,',
  '  }));',
  '}',
  '// Beoordeeld zonder model, dus wél als gezien onthouden: één melding volstaat.',
  'return [{ json: {',
  '  invoices: [],',
  '  notices: notices,',
  '  dropped: [],',
  '  errors: [],',
  '  processedIds: notices.map((n) => n.messageId),',
  '} }];',
].join('\n');

const QUEUE_ADAPTER = [
  SHARED_NOTE,
  '',
  "// getWorkflowStaticData overleeft een run: n8n bewaart het bij de workflow in",
  '// zijn eigen database.',
  "const store = $getWorkflowStaticData('global');",
  'const batch = { invoices: [], notices: [], processedIds: [] };',
  'for (const item of $input.all()) {',
  '  const j = item.json || {};',
  '  for (const invoice of j.invoices || []) batch.invoices.push(invoice);',
  '  for (const notice of j.notices || []) batch.notices.push(notice);',
  '  for (const id of j.processedIds || []) batch.processedIds.push(id);',
  '}',
  'return [{ json: addToQueue(store, batch, new Date().toISOString()) }];',
].join('\n');

/** @type {CodeNodeSpec[]} */
const NODE_SPECS = [
  {
    id: 'b1000000-0000-4000-8000-000000000006',
    name: 'Normaliseer bericht',
    sources: ['normalizeGmailMessage.js'],
    adapter: NORMALISE_ADAPTER,
  },
  {
    id: 'b1000000-0000-4000-8000-000000000008',
    name: 'Bouw Claude-verzoek',
    sources: ['buildClaudeRequest.js'],
    adapter: REQUEST_ADAPTER,
  },
  {
    id: 'b1000000-0000-4000-8000-00000000000a',
    name: 'Naar LaVega-vorm',
    sources: ['claudeToLaVega.js'],
    adapter: TO_LAVEGA_ADAPTER,
  },
  {
    id: 'b1000000-0000-4000-8000-000000000010',
    name: 'Melding: zelf ophalen',
    sources: ['claudeToLaVega.js'],
    adapter: UNREADABLE_ADAPTER,
  },
  {
    id: 'b1000000-0000-4000-8000-00000000000c',
    name: 'Zet in de wachtrij',
    sources: ['queue.js'],
    adapter: QUEUE_ADAPTER,
  },
];

export { NODE_SPECS, buildCodeNode, stripExports };
