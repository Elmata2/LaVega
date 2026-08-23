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
import type { Aanbieding, Lezing, LezingUitkomst } from "./amex.js";

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

/* ─────────────────────── de Amex-aanbiedingen ─────────────────────────────── */

/* ── WAAROM HIER WÉL EEN DATUM VAN EEN BEZOEK STAAT ──────────────────────────
 *
 * De kop van dit bestand zegt: niets dat aan een BEZOEK vastzit. Hieronder komt
 * `amexLezing` te staan, en daar zit de dag in waarop zijn aanbiedingenpagina
 * gelezen is. Dat verdient uitleg, want zonder uitleg is het een uitzondering
 * die de regel opeet.
 *
 * Het verschil is wat het ding IS. Een lijstje "wanneer stond het paneel aan bij
 * welke winkel" is een GESCHIEDENIS: het groeit, en wie het leest weet waar hij
 * is geweest. `amexLezing` is één waarde die bij elke lezing wordt OVERSCHREVEN,
 * en hij zegt niet waar hij is geweest maar hoe oud onze kopie is. Zonder die
 * datum zou het paneel een aanbieding van twee maanden geleden neerzetten alsof
 * hij vers is, en dat is precies de fout die hier nergens mag voorkomen: een
 * bewering die de gegevens niet kunnen dragen.
 *
 * Hij gaat ook over ÉÉN pagina, en wel de ene waar hij expliciet ja tegen heeft
 * gezegd, met de tekst uit `AMEX_WAT_WEL` erbij. Dat is iets anders dan een
 * spoor van winkels dat als bijvangst ontstaat.
 *
 * En hij is weg zodra hij de schakelaar omzet: `wisAmex` hieronder haalt de
 * sleutels ECHT weg in plaats van ze op leeg te zetten. Een lege lijst is nog
 * steeds een sleutel met een geschiedenis eraan vast. */

const KEY_AMEX_AAN = "amexAan";
const KEY_AMEX_AANBOD = "amexAanbiedingen";
const KEY_AMEX_LEZING = "amexLezing";

/** Standaard UIT, en dat is de belangrijkste regel van deze functie. Alles wat
 *  geen letterlijke `true` is — ontbrekend, null, de string "true", een 1 —
 *  levert false op. Een leestoestemming die "aan" wordt door een kapotte waarde
 *  is geen toestemming. */
export async function getAmexAan(): Promise<boolean> {
  const items = await chrome.storage.local.get([KEY_AMEX_AAN]);
  return items[KEY_AMEX_AAN] === true;
}

export async function setAmexAan(aan: boolean): Promise<void> {
  await chrome.storage.local.set({ [KEY_AMEX_AAN]: aan === true });
}

const UITKOMSTEN: readonly LezingUitkomst[] = [
  "gelezen",
  "niet-ingelogd",
  "uitgesproken-geen-aanbiedingen",
  "geen-aanbiedingenblok",
  "blok-zonder-kaarten",
];

/** Dezelfde zeef-gedachte als bij de puntensaldi: wat er in de opslag staat kan
 *  van een oudere versie zijn, en `as Aanbieding[]` erop plakken maakt het niet
 *  waar. Wat niet door de zeef komt bestaat niet.
 *
 *  Strenger op twee punten dan de andere zeven hier, en allebei met reden:
 *
 *   - `gelezenOp` MOET een geldige ISO-datum zijn. Een aanbieding zonder
 *     leesdatum kan aan een kassa niet worden neergezet, want dan is er geen
 *     manier om te zeggen hoe oud hij is — en dat is de enige eigenschap die
 *     hem beoordeelbaar maakt. Geen datum, geen aanbieding.
 *   - `domein` moet een hostnaamvorm hebben of null zijn. Rommel in dat veld
 *     zou aan de koppelregel worden gevoerd, en die regel is de enige die
 *     tegenhoudt dat een aanbieding van Nike op nike-outlet-fake.nl verschijnt. */
function schoonAanbod(v: unknown, max = 200): Aanbieding[] {
  if (!Array.isArray(v)) return [];
  const uit: Aanbieding[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const r = x as Record<string, unknown>;

    const winkel = typeof r.winkel === "string" ? r.winkel.trim().slice(0, 60) : "";
    const korting = typeof r.korting === "string" ? r.korting.trim().slice(0, 120) : "";
    if (winkel === "" || korting === "") continue;

    const gelezenOp = typeof r.gelezenOp === "string" ? r.gelezenOp.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gelezenOp)) continue;

    const totRuw = typeof r.totRuw === "string" ? r.totRuw.trim().slice(0, 40) : "";
    const totKandidaat = typeof r.tot === "string" ? r.tot.trim() : "";
    const tot = /^\d{4}-\d{2}-\d{2}$/.test(totKandidaat) ? totKandidaat : null;

    const domeinKandidaat = typeof r.domein === "string" ? r.domein.trim().toLowerCase() : "";
    const domein = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(domeinKandidaat)
      ? domeinKandidaat
      : null;

    uit.push({ winkel, korting, tot, totRuw, domein, gelezenOp });
    if (uit.length >= max) break;
  }
  return uit;
}

function schoonLezing(v: unknown): Lezing | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const uitkomst = typeof r.uitkomst === "string" ? r.uitkomst : "";
  if (!UITKOMSTEN.includes(uitkomst as LezingUitkomst)) return null;
  const op = typeof r.op === "string" ? r.op.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(op)) return null;
  const aantal = typeof r.aantal === "number" && Number.isInteger(r.aantal) && r.aantal >= 0 ? r.aantal : 0;
  const citaat = typeof r.citaat === "string" ? r.citaat.trim().slice(0, 120) : "";
  return { uitkomst: uitkomst as LezingUitkomst, aantal, op, citaat };
}

export async function getAanbiedingen(): Promise<Aanbieding[]> {
  const items = await chrome.storage.local.get([KEY_AMEX_AANBOD]);
  return schoonAanbod(items[KEY_AMEX_AANBOD]);
}

export async function getAmexLezing(): Promise<Lezing | null> {
  const items = await chrome.storage.local.get([KEY_AMEX_LEZING]);
  return schoonLezing(items[KEY_AMEX_LEZING]);
}

/** De uitkomst van één lezing wegschrijven.
 *
 *  DE AANBIEDINGEN WORDEN VERVANGEN EN NIET AANGEVULD. Samenvoegen met wat er al
 *  stond zou aantrekkelijk lijken — dan blijft een aanbieding staan die deze
 *  keer toevallig niet geladen was. Maar dan kan een aanbieding die Amex heeft
 *  WEGGEHAALD nooit meer verdwijnen, en groeit de lijst met dingen die niet
 *  meer bestaan. Wat er nu op zijn pagina staat, is de lijst.
 *
 *  Een MISLUKTE lezing raakt de lijst met opzet niet aan: die zegt niets over
 *  welke aanbiedingen er zijn, alleen dat we ze deze keer niet konden lezen. De
 *  lijst blijft dan staan mét zijn oude leesdatum, en die datum is precies wat
 *  het paneel gebruikt om te zeggen dat hij oud is. */
export async function setAmexLezing(lezing: Lezing, aanbiedingen: readonly Aanbieding[]): Promise<void> {
  if (lezing.uitkomst === "gelezen") {
    await chrome.storage.local.set({
      [KEY_AMEX_LEZING]: lezing,
      [KEY_AMEX_AANBOD]: schoonAanbod(aanbiedingen),
    });
    return;
  }
  await chrome.storage.local.set({ [KEY_AMEX_LEZING]: lezing });
}

/** Alles van de Amex-kant weg. Wordt aangeroepen zodra hij de schakelaar uitzet
 *  én zodra Chrome meldt dat de host-toestemming is ingetrokken — die tweede
 *  route loopt buiten ons scherm om en mag daarom niet vergeten worden.
 *
 *  `remove` en niet `set({ …: [] })`: een lege lijst is nog steeds een sleutel,
 *  en de vraag "wat weet deze extensie van mij" hoort na het uitzetten met
 *  "niets" beantwoord te worden in plaats van met "een lege lijst". Dat is te
 *  zien in chrome://extensions, dus het verschil is niet theoretisch. */
export async function wisAmex(): Promise<void> {
  await chrome.storage.local.remove([KEY_AMEX_AAN, KEY_AMEX_AANBOD, KEY_AMEX_LEZING]);
}

/* Voor de test, net als de zeven hierboven. */
export const _schoonAanbod = schoonAanbod;
export const _schoonLezing = schoonLezing;
