/* Wat de extensie onthoudt. Twee lijstjes met korte tekstjes, en dat is alles.
 *
 * ── WAT ER NOOIT IN MAG, en dat is de belangrijkste helft van dit bestand ───
 *
 * Geen bedragen. Geen artikelen. Geen winkelwagens. Geen URL's, geen hosts die
 * hij bezocht heeft, geen tijdstippen. Wie wil weten wat iemand koopt, hoeft
 * daarvoor geen bedragen te bewaren — een lijstje "wanneer stond het paneel
 * aan" is al een boodschappenlijst met datums. Daarom staat er niets in dat aan
 * een BEZOEK vastzit; alleen dingen die aan een KEUZE vastzitten.
 *
 * Er staan dus twee soorten dingen in:
 *   - welke kaarten hij heeft (zijn keuze, hoort bij hem);
 *   - op welke winkels het paneel aan mag (zijn keuze, hoort bij de winkel).
 *
 * Allebei zijn ze na het weghalen van de extensie weg, en allebei zijn ze in
 * chrome://extensions in te zien. Er is geen tweede plek.
 *
 * ── WAAROM ALLES DOOR EEN ZEEF GAAT BIJ HET LEZEN ──────────────────────────
 *
 * chrome.storage.local geeft terug wat er in staat, en wat erin staat kan van
 * een oudere versie zijn of met de hand veranderd. `as string[]` erop plakken
 * maakt dat niet waar. Een kapotte waarde die als lijst wordt behandeld, geeft
 * verderop een lege ranglijst zonder melding — en een lege ranglijst leest als
 * "er is niets te halen", wat een bewering is die de fout niet kan dragen. Dus
 * wordt er gefilterd, en wat niet door de zeef komt bestaat niet. */

const KEY_KAARTEN = "heldIds";
const KEY_SITES = "enabledSiteIds";

/** Alleen strings, geen lege, geen dubbele. Geen lengtegrens per string omdat de
 *  id's uit onze eigen gebundelde catalogus komen; wel een grens op het AANTAL,
 *  zodat een kapotte schrijfactie geen lijst van duizenden achterlaat. */
function schoonLijst(v: unknown, max = 200): string[] {
  if (!Array.isArray(v)) return [];
  const uit: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.trim();
    if (!s || uit.includes(s)) continue;
    uit.push(s);
    if (uit.length >= max) break;
  }
  return uit;
}

export async function getHeldIds(): Promise<string[]> {
  const items = await chrome.storage.local.get([KEY_KAARTEN]);
  return schoonLijst(items[KEY_KAARTEN]);
}

export async function setHeldIds(ids: readonly string[]): Promise<void> {
  await chrome.storage.local.set({ [KEY_KAARTEN]: schoonLijst(ids) });
}

export async function getEnabledSiteIds(): Promise<string[]> {
  const items = await chrome.storage.local.get([KEY_SITES]);
  return schoonLijst(items[KEY_SITES]);
}

export async function setEnabledSiteIds(ids: readonly string[]): Promise<void> {
  await chrome.storage.local.set({ [KEY_SITES]: schoonLijst(ids) });
}

/* Alleen voor de test, zodat de zeef zelf ook nagelezen kan worden zonder dat er
 * een chrome.storage in het spel is. */
export const _schoonLijst = schoonLijst;
