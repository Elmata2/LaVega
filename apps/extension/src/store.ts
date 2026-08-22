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
 * Er staan dus drie soorten dingen in:
 *   - welke kaarten hij heeft (zijn keuze, hoort bij hem);
 *   - op welke winkels het paneel aan mag (zijn keuze, hoort bij de winkel);
 *   - welke puntensaldi hij heeft opgeschreven (zijn eigen opgave over zichzelf).
 *
 * Alle drie zijn ze na het weghalen van de extensie weg, en alle drie zijn ze in
 * chrome://extensions in te zien. Er is geen tweede plek.
 *
 * ── WAAROM EEN PUNTENSALDO HIER MAG STAAN EN EEN BEDRAG NIET ───────────────
 *
 * Dat lijkt een tegenspraak met de alinea hierboven, dus hij staat er voluit.
 *
 * Wat er niet in mag, is alles wat aan een BEZOEK vastzit: het bedrag op de
 * pagina, het artikel, de winkel, het tijdstip. Dat is data die ONTSTAAT doordat
 * hij ergens kijkt, en bewaren maakt er een boodschappenlijst van.
 *
 * Een puntensaldo is het tegenovergestelde: het is zijn eigen opgave over
 * zichzelf, hij typt het in op een leeg formulier, en het verandert niet doordat
 * hij een winkel bezoekt. Het staat in dezelfde categorie als het lijstje
 * kaarten dat hier al stond. Er zit geen euro in, geen rekeningnummer en geen
 * transactie: een programmanaam, een aantal punten en de dag waarop hij het
 * opschreef.
 *
 * DIE DERDE IS GEEN OPSMUK. Een saldo dat hij in mei invoerde en dat in augustus
 * als "nu" op het scherm komt, is een stille onwaarheid — en die is aan een
 * kassa duurder dan geen saldo, want hij rekent erop.
 *
 * ── WAAROM HET SALDO IN DE EXTENSIE WORDT INGEVOERD EN NIET UIT DE KLUIS KOMT
 *
 * Er waren twee wegen en geen goede.
 *
 * EEN BRUG NAAR DE LAVEGA-TAB zou het saldo op één plek houden. Maar het is een
 * NIEUW KANAAL: `externally_connectable` of een hostrechten op het eigen domein,
 * een berichtvorm, en aan allebei de kanten een redactiegrens die bewaakt moet
 * worden. Elk van die drie is een manier om stuk te gaan, en de derde is een
 * manier om stuk te gaan waarbij er iets weglekt. Bovendien werkt hij niet als
 * de tab dicht is, en dan staat er aan de kassa niets — precies op het moment
 * waarvoor dit gebouwd is.
 *
 * TWEE KEER INVOEREN levert een saldo op dat uit elkaar loopt met de kluis. Dat
 * is een echte kost en hij is niet te vermijden, alleen zichtbaar te maken:
 * daarom draagt elk saldo de datum waarop hij het opschreef, staat die datum
 * altijd op het scherm, en zegt de extensie het er na negentig dagen bij (zie
 * `VEROUDERD_NA_DAGEN` in points.ts, hetzelfde getal als `isStale` in core).
 *
 * V1 kiest de tweede weg, want hij kan op minder manieren kapot: geen kanaal,
 * geen tweede grens, en hij werkt met de kluis dicht. De eerste weg blijft open
 * — komt er ooit een brug, dan vervangt die de invoer hier en verandert er aan
 * points.ts geen regel, want dat bestand krijgt zijn saldi als parameter.
 *
 * ── WAAROM ALLES DOOR EEN ZEEF GAAT BIJ HET LEZEN ──────────────────────────
 *
 * chrome.storage.local geeft terug wat er in staat, en wat erin staat kan van
 * een oudere versie zijn of met de hand veranderd. `as string[]` erop plakken
 * maakt dat niet waar. Een kapotte waarde die als lijst wordt behandeld, geeft
 * verderop een lege ranglijst zonder melding — en een lege ranglijst leest als
 * "er is niets te halen", wat een bewering is die de fout niet kan dragen. Dus
 * wordt er gefilterd, en wat niet door de zeef komt bestaat niet. */

import type { PointsBalance } from "./points.js";

const KEY_KAARTEN = "heldIds";
const KEY_SITES = "enabledSiteIds";
const KEY_PUNTEN = "pointsBalances";

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

/** Dezelfde zeef, voor puntensaldi. Strenger dan die voor de kaart-id's, omdat
 *  hier een GETAL doorheen komt en een getal verderop in een som belandt.
 *
 *  Wat er wordt afgedwongen en waarom:
 *
 *   - `program` is een niet-lege string van hooguit 60 tekens. Zonder grens kan
 *     één kapotte schrijfactie een programmanaam van een megabyte achterlaten
 *     die daarna in een paneel op een winkelpagina wordt afgedrukt.
 *   - `points` is een EINDIG, niet-negatief GEHEEL getal onder de miljard. NaN
 *     en Infinity komen uit `Number("")` en uit een oud veld rollen; ze zouden
 *     verderop een dekking van NaN cent opleveren, en dat rendert als "€ NaN"
 *     zonder dat er iets afgaat. Negatief bestaat niet als saldo. Niet-heel ook
 *     niet: een halve mijl is geen mijl.
 *   - `updatedAt` is een ISO-datum of anders de lege string. LIEVER LEEG DAN
 *     VERZONNEN: als de datum onleesbaar is, weten we niet hoe oud dit saldo is,
 *     en points.ts behandelt dat als verouderd. Er hier stilletjes vandaag van
 *     maken zou een saldo van vier maanden oud vers verklaren.
 *   - één regel per programma. Twee regels met dezelfde naam zouden allebei in
 *     het paneel komen en optellen tot een saldo dat hij niet heeft; de laatste
 *     wint, want dat is de meest recente invoer.
 *
 *  Wat niet door de zeef komt bestaat niet — precies zoals bij de lijst
 *  hierboven, en om dezelfde reden: een kapotte waarde die als saldo wordt
 *  behandeld, levert een uitspraak op die op niets rust. */
function schoonSaldi(v: unknown, max = 50): PointsBalance[] {
  if (!Array.isArray(v)) return [];
  const uit: PointsBalance[] = [];
  const gezien = new Map<string, number>();
  for (const x of v) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const r = x as Record<string, unknown>;

    const program = typeof r.program === "string" ? r.program.trim().slice(0, 60) : "";
    if (program === "") continue;

    const punten = typeof r.points === "number" ? r.points : Number.NaN;
    if (!Number.isFinite(punten) || !Number.isInteger(punten) || punten < 0 || punten > 1_000_000_000) {
      continue;
    }

    const ruweDatum = typeof r.updatedAt === "string" ? r.updatedAt.trim() : "";
    const updatedAt = /^\d{4}-\d{2}-\d{2}$/.test(ruweDatum) ? ruweDatum : "";

    const sleutel = program.toLowerCase();
    const bestaand = gezien.get(sleutel);
    if (bestaand !== undefined) {
      uit[bestaand] = { program, points: punten, updatedAt };
      continue;
    }
    if (uit.length >= max) continue;
    gezien.set(sleutel, uit.length);
    uit.push({ program, points: punten, updatedAt });
  }
  return uit;
}

export async function getPointsBalances(): Promise<PointsBalance[]> {
  const items = await chrome.storage.local.get([KEY_PUNTEN]);
  return schoonSaldi(items[KEY_PUNTEN]);
}

export async function setPointsBalances(saldi: readonly PointsBalance[]): Promise<void> {
  await chrome.storage.local.set({ [KEY_PUNTEN]: schoonSaldi(saldi) });
}

/* Alleen voor de test, zodat de zeven zelf ook nagelezen kunnen worden zonder
 * dat er een chrome.storage in het spel is. */
export const _schoonLijst = schoonLijst;
export const _schoonSaldi = schoonSaldi;
