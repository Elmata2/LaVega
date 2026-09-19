/* De wachtrij in n8n: wat erin gaat, wat eruit valt, en wat we onthouden.
 *
 * DIT BESTAND DRAAIT OP DRIE PLEKKEN — het is de bron van de Code-nodes "Zet in
 * de wachtrij" ÉN "Geef de rij en leeg hem" in docs/n8n/lavega-invoices.json.
 * `pnpm run sync:n8n` kopieert het in allebei. Geen TypeScript-syntax, alleen
 * JSDoc.
 *
 * De rij blijft in n8n staan, niet op de LaVega-server: een factuurbedrag is
 * van de eigenaar, en de server hoeft het nooit te zien.
 *
 * PARTITIONERING PER `queueKey`. Eén n8n kan straks voor meerdere mensen
 * draaien, en elk krijgt zijn eigen doorstuuradres — `queueKey` is het lokale
 * deel daarvan (normalizeInboundMail.js). Vóór vandaag stond alles in één plat
 * `store.queue`/`store.notices`, en wie het eerst ophaalde kreeg IEDEREENS
 * facturen en leegde de rij voor de rest. Nu is de opslag een MAP van sleutel
 * naar rijen (`store.queueByKey`, `store.noticesByKey`), en `drainQueue` haalt
 * en leegt precies één sleutel.
 *
 * EEN RIJ ZONDER SLEUTEL is geen vrije plek voor wie het eerst vraagt. Gmail
 * heeft sowieso geen doorstuuradres — er is maar één Gmail-postbus gekoppeld,
 * en die is van de eigenaar — en een doorgestuurde mail met een lege
 * `queueKey` is een vervormd of onvolledig verzoek, niet een aanwijzing om te
 * raden. Beide gevallen krijgen dezelfde behandeling: `OWNER_KEY`, de sleutel
 * van de eigenaar zelf. Hij is de enige die zulke regels kan uitzoeken, en hij
 * kan er zonder token bij (het is zijn eigen n8n). `OWNER_KEY` bevat een "@" —
 * een teken dat in het lokale deel van een e-mailadres nooit voorkomt — juist
 * zodat geen echt doorstuuradres hem ooit kan claimen.
 *
 * MIGRATIE. Zijn levende n8n heeft nu een gevulde `store` in de OUDE platte
 * vorm, met rijen die onderweg zijn. `migrateStore` herkent dat (`store.queue`
 * is een array in plaats van de nieuwe map) en verhuist die rijen ÉÉN keer naar
 * `store.queueByKey[OWNER_KEY]` — precies waar ze horen: het was altijd zijn
 * eigen rij. Idempotent: al gemigreerd, dan doet het niets. Draait op elke
 * aanroep van `addToQueue` én `drainQueue`, dus het maakt niet uit welke van de
 * twee het eerst weer loopt.
 *
 * DE GRENZEN (`MAX_QUEUE`, `MAX_NOTICES`) BLIJVEN GLOBAAL, niet per sleutel:
 * duizend doorstuuradressen mogen het plafond niet met duizend vermenigvuldigen.
 * `trimGlobal` telt alle sleutels bij elkaar op en gooit — over de hele map heen
 * — de oudste rijen eruit tot de rij weer onder de grens zit. `seenIds`
 * (`MAX_SEEN`) was en blijft ongepartitioneerd: dat onthoudt welke mail het
 * model al beoordeelde, en dat gaat over het BERICHT, niet over voor wie het
 * was.
 *
 * `seenIds` lost een dure fout op. De schedule loopt elk uur over dezelfde
 * zeven dagen mail, en de rij wordt bij elk ophalen geleegd — dus stond er
 * niets in de weg om dezelfde mail (mét PDF, en dus met echte tokens) tot wel
 * 168 keer aan het model te sturen. Een messageId komt hier pas in `seenIds`
 * als het model hem ook echt beoordeeld heeft; mislukt de aanroep, dan blijft
 * hij onbekend en probeert de volgende run het opnieuw.
 */

/** Een rij die niemand ophaalt is een lek, geen archief. */
const MAX_QUEUE = 200;
const MAX_NOTICES = 200;
/** Genoeg voor zeven dagen mail met ruime marge; ouder dan dat valt toch buiten de zoekopdracht. */
const MAX_SEEN = 2000;

/** De sleutel voor rijen zonder (bruikbare) `queueKey`: Gmail-berichten (er is
 *  geen doorstuuradres) en doorgestuurde mail met een lege of ontbrekende
 *  `queueKey` (vervormd verzoek). Bevat een "@": een lokaal deel van een
 *  e-mailadres kan dat teken nooit bevatten, dus geen echt doorstuuradres kan
 *  hem ooit per ongeluk — of expres — claimen. */
const OWNER_KEY = "owner@lavega.internal";

/**
 * @typedef {Object.<string, unknown[]>} QueueMap
 */

/**
 * @typedef {Object} QueueStore
 * @property {unknown} [queue]        OUDE platte vorm, alleen tijdens migratie gelezen
 * @property {unknown} [notices]      OUDE platte vorm, alleen tijdens migratie gelezen
 * @property {QueueMap} [queueByKey]
 * @property {QueueMap} [noticesByKey]
 * @property {unknown} [seenIds]
 */

/**
 * @typedef {Object} QueueBatch
 * @property {{ messageId?: string, queueKey?: string }[]} invoices
 * @property {{ messageId?: string, queueKey?: string }[]} notices
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
 * @param {unknown} v
 * @returns {v is QueueMap}
 */
function isMap(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Een rij hoort bij haar eigen `queueKey`, getrimd en leeg-of-onbruikbaar
 * samengevouwen tot `OWNER_KEY`. Nooit stilzwijgend "" — een lege sleutel is
 * precies het geval dat `OWNER_KEY` moet opvangen.
 * @param {unknown} v
 * @returns {string}
 */
function normalizeKey(v) {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s.slice(0, 120) : OWNER_KEY;
}

/**
 * Zet de OUDE platte vorm (`store.queue`/`store.notices` als array) één keer
 * om naar de nieuwe, gepartitioneerde vorm, onder `OWNER_KEY` — dat was altijd
 * zijn eigen rij. Idempotent en goedkoop, dus gewoon bij elke aanroep.
 *
 * Geeft de twee maps ook terug (in plaats van de aanroeper `store.queueByKey`
 * opnieuw te laten lezen): `store`'s eigen typedef houdt ze optioneel, want dat
 * zijn ze VOORDAT dit draait, en TypeScript kan een mutatie op `store` hier
 * niet doorzien naar de rest van de functie die dit aanroept.
 * @param {QueueStore} store
 * @returns {{ queueByKey: QueueMap, noticesByKey: QueueMap }}
 */
function migrateStore(store) {
  // Lokale const'en, niet `store.queueByKey` na de toewijzing teruglezen: TS
  // laat property-narrowing niet staan over een tussenliggende functie-
  // aanroep heen (de tweede `isMap`-check hierbeneden telt al als zo'n
  // aanroep), dus `store.queueByKey` zou hierna weer "possibly undefined" zijn.
  const queueByKey = isMap(store.queueByKey)
    ? store.queueByKey
    : Array.isArray(store.queue)
      ? { [OWNER_KEY]: store.queue }
      : {};
  const noticesByKey = isMap(store.noticesByKey)
    ? store.noticesByKey
    : Array.isArray(store.notices)
      ? { [OWNER_KEY]: store.notices }
      : {};
  store.queueByKey = queueByKey;
  store.noticesByKey = noticesByKey;
  delete store.queue;
  delete store.notices;
  return { queueByKey: queueByKey, noticesByKey: noticesByKey };
}

/**
 * @param {QueueMap} map
 * @returns {number}
 */
function totalRows(map) {
  let n = 0;
  for (const k of Object.keys(map)) n += asArray(map[k]).length;
  return n;
}

/**
 * Houdt het GLOBALE totaal aan rijen in `map` onder `max`, over alle sleutels
 * heen — niet per sleutel, anders vermenigvuldigt elke nieuwe sleutel het
 * plafond. `queuedAt` is ISO en dus lexicografisch te sorteren; bij gelijke
 * tijd (alle rijen van één run delen `now`) beslist de oorspronkelijke
 * volgorde, want `sort` in Node is stabiel.
 * @param {QueueMap} map
 * @param {number} max
 * @returns {void}
 */
function trimGlobal(map, max) {
  const flat = [];
  for (const k of Object.keys(map)) {
    for (const row of asArray(map[k])) flat.push(row);
  }
  if (flat.length <= max) return;
  const ordered = flat
    .map(function (row, i) {
      return { row: row, i: i };
    })
    .sort(function (a, b) {
      const byTime = String(a.row.queuedAt).localeCompare(String(b.row.queuedAt));
      return byTime !== 0 ? byTime : a.i - b.i;
    });
  const kept = new Set(
    ordered.slice(ordered.length - max).map(function (e) {
      return e.row;
    }),
  );
  for (const k of Object.keys(map)) {
    const filtered = asArray(map[k]).filter(function (row) {
      return kept.has(row);
    });
    if (filtered.length > 0) {
      map[k] = filtered;
    } else {
      delete map[k];
    }
  }
}

/**
 * Voeg de uitkomst van één run toe aan de opgeslagen rij. Eén run kan
 * berichten voor MEERDERE sleutels bevatten (Gmail + elk doorstuuradres),
 * dus elke rij gaat naar zijn EIGEN sleutel — niet naar één sleutel voor de
 * hele batch.
 *
 * De tellers die dit teruggeeft zijn met opzet GLOBAAL gebleven, niet per
 * sleutel: dit is de uitvoer van één Code-node-run in de n8n-UI, en niets
 * stroomafwaarts leest ze — ze zijn er voor een mens die meekijkt, en "3 nieuw,
 * 45 in de rij" blijft net zo leesbaar als vroeger. Per-sleutel detail zou hier
 * alleen ruis toevoegen.
 * @param {QueueStore} store  $getWorkflowStaticData('global')
 * @param {QueueBatch} batch
 * @param {string} now        ISO-tijd; als parameter zodat een test hem vast kan zetten
 * @returns {{ addedInvoices: number, addedNotices: number, inQueue: number, noticesInQueue: number, remembered: number }}
 */
function addToQueue(store, batch, now) {
  const maps = migrateStore(store);
  const queueByKey = maps.queueByKey;
  const noticesByKey = maps.noticesByKey;
  const seenIds = asArray(store.seenIds);

  const seenInQueue = new Set();
  for (const k of Object.keys(queueByKey)) {
    for (const row of asArray(queueByKey[k])) seenInQueue.add(row.messageId);
  }
  const seenInNotices = new Set();
  for (const k of Object.keys(noticesByKey)) {
    for (const row of asArray(noticesByKey[k])) seenInNotices.add(row.messageId);
  }

  let addedInvoices = 0;
  for (const invoice of asArray(batch.invoices)) {
    if (!invoice.messageId || seenInQueue.has(invoice.messageId)) continue;
    seenInQueue.add(invoice.messageId);
    const key = normalizeKey(invoice.queueKey);
    if (!Array.isArray(queueByKey[key])) queueByKey[key] = [];
    queueByKey[key].push(Object.assign({}, invoice, { queuedAt: now }));
    addedInvoices++;
  }

  let addedNotices = 0;
  for (const notice of asArray(batch.notices)) {
    if (!notice.messageId || seenInNotices.has(notice.messageId)) continue;
    seenInNotices.add(notice.messageId);
    const key = normalizeKey(notice.queueKey);
    if (!Array.isArray(noticesByKey[key])) noticesByKey[key] = [];
    noticesByKey[key].push(Object.assign({}, notice, { queuedAt: now }));
    addedNotices++;
  }

  const remembered = new Set(seenIds);
  for (const id of asArray(batch.processedIds)) {
    if (id) remembered.add(id);
  }

  // Oudste eruit als het te lang wordt — globaal, over alle sleutels heen.
  trimGlobal(queueByKey, MAX_QUEUE);
  trimGlobal(noticesByKey, MAX_NOTICES);
  const rememberedList = Array.from(remembered);
  store.seenIds =
    rememberedList.length > MAX_SEEN ? rememberedList.slice(-MAX_SEEN) : rememberedList;

  return {
    addedInvoices: addedInvoices,
    addedNotices: addedNotices,
    inQueue: totalRows(queueByKey),
    noticesInQueue: totalRows(noticesByKey),
    remembered: asArray(store.seenIds).length,
  };
}

/**
 * Geef de rij van precies ÉÉN sleutel terug en leeg alleen die — de andere
 * sleutels blijven onaangeroerd staan voor wanneer hún eigenaar vraagt. Een
 * sleutel die leeg wordt, verdwijnt uit de map in plaats van als lege array te
 * blijven hangen: anders groeit de map met elke afgehandelde doorstuurregel.
 * @param {QueueStore} store  $getWorkflowStaticData('global')
 * @param {unknown} key       de opgevraagde sleutel, ongevalideerd (query-param uit de webhook)
 * @param {string} now        ISO-tijd; als parameter zodat een test hem vast kan zetten
 * @returns {{ invoices: unknown[], notices: unknown[], servedAt: string }}
 */
function drainQueue(store, key, now) {
  const maps = migrateStore(store);
  const k = normalizeKey(key);
  const rows = asArray(maps.queueByKey[k]);
  const alerts = asArray(maps.noticesByKey[k]);
  delete maps.queueByKey[k];
  delete maps.noticesByKey[k];
  return { invoices: rows, notices: alerts, servedAt: now };
}

export { MAX_QUEUE, MAX_NOTICES, MAX_SEEN, OWNER_KEY, addToQueue, drainQueue };
