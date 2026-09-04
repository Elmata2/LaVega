/* De wachtrij in n8n: wat erin gaat, wat eruit valt, en wat we onthouden.
 *
 * DIT BESTAND DRAAIT OP TWEE PLEKKEN — het is de bron van de Code-node
 * "Zet in de wachtrij" in docs/n8n/lavega-invoices.json. `pnpm run sync:n8n`
 * kopieert het daarin. Geen TypeScript-syntax, alleen JSDoc.
 *
 * De rij blijft in n8n staan, niet op de LaVega-server: een factuurbedrag is
 * van de eigenaar, en de server hoeft het nooit te zien.
 *
 * `seenIds` is nieuw en lost een dure fout op. De schedule loopt elk uur over
 * dezelfde zeven dagen mail, en de rij wordt bij elk ophalen geleegd — dus
 * stond er niets in de weg om dezelfde mail (mét PDF, en dus met echte tokens)
 * tot wel 168 keer aan het model te sturen. Een messageId komt hier pas in
 * `seenIds` als het model hem ook echt beoordeeld heeft; mislukt de aanroep,
 * dan blijft hij onbekend en probeert de volgende run het opnieuw.
 */

/** Een rij die niemand ophaalt is een lek, geen archief. */
const MAX_QUEUE = 200;
const MAX_NOTICES = 200;
/** Genoeg voor zeven dagen mail met ruime marge; ouder dan dat valt toch buiten de zoekopdracht. */
const MAX_SEEN = 2000;

/**
 * @typedef {{ queue?: unknown, notices?: unknown, seenIds?: unknown }} QueueStore
 */

/**
 * @typedef {Object} QueueBatch
 * @property {{ messageId?: string }[]} invoices
 * @property {{ messageId?: string }[]} notices
 * @property {string[]} processedIds
 */

/**
 * @param {unknown} v
 * @returns {any[]}
 */
function asArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Voeg de uitkomst van één run toe aan de opgeslagen rij.
 * @param {QueueStore} store  $getWorkflowStaticData('global')
 * @param {QueueBatch} batch
 * @param {string} now        ISO-tijd; als parameter zodat een test hem vast kan zetten
 * @returns {{ addedInvoices: number, addedNotices: number, inQueue: number, noticesInQueue: number, remembered: number }}
 */
function addToQueue(store, batch, now) {
  const queue = asArray(store.queue);
  const notices = asArray(store.notices);
  const seenIds = asArray(store.seenIds);

  const seenInQueue = new Set(
    queue.map(function (row) {
      return row.messageId;
    }),
  );
  const seenInNotices = new Set(
    notices.map(function (row) {
      return row.messageId;
    }),
  );

  let addedInvoices = 0;
  for (const invoice of asArray(batch.invoices)) {
    if (!invoice.messageId || seenInQueue.has(invoice.messageId)) continue;
    seenInQueue.add(invoice.messageId);
    queue.push(Object.assign({}, invoice, { queuedAt: now }));
    addedInvoices++;
  }

  let addedNotices = 0;
  for (const notice of asArray(batch.notices)) {
    if (!notice.messageId || seenInNotices.has(notice.messageId)) continue;
    seenInNotices.add(notice.messageId);
    notices.push(Object.assign({}, notice, { queuedAt: now }));
    addedNotices++;
  }

  const remembered = new Set(seenIds);
  for (const id of asArray(batch.processedIds)) {
    if (id) remembered.add(id);
  }

  // Oudste eruit als het te lang wordt.
  store.queue = queue.length > MAX_QUEUE ? queue.slice(-MAX_QUEUE) : queue;
  store.notices = notices.length > MAX_NOTICES ? notices.slice(-MAX_NOTICES) : notices;
  const rememberedList = Array.from(remembered);
  store.seenIds =
    rememberedList.length > MAX_SEEN ? rememberedList.slice(-MAX_SEEN) : rememberedList;

  return {
    addedInvoices: addedInvoices,
    addedNotices: addedNotices,
    inQueue: asArray(store.queue).length,
    noticesInQueue: asArray(store.notices).length,
    remembered: asArray(store.seenIds).length,
  };
}

export { MAX_QUEUE, MAX_NOTICES, MAX_SEEN, addToQueue };
