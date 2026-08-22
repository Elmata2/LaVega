/* Van docs/catalog/staging-points.json naar src/generated/points-rates.generated.ts.
 *
 * Zelfde patroon als bundle-catalog.ts: opgehaald tijdens een sweep, hier
 * neergelegd, in de browser wordt er niets opgehaald. Draaien:
 * `pnpm --filter @lavega/extension bundle:points`.
 *
 * ── WAAROM DIT BESTAND ZO KLEIN IS, EN WAAROM DAT GOED NIEUWS IS ────────────
 *
 * Er komen vier regels uit. Eén daarvan draagt een echte koers (Amex), één een
 * uitgesproken nul (ING), één een uitgesproken "er is geen vaste waarde"
 * (Revolut) en één een gat dat we zelf niet hebben kunnen dichten (Flying Blue).
 * Dat aantal is de dekking, en het staat in de kop van het gegenereerde bestand
 * zodat niemand hoeft te raden hoe breed dit is.
 *
 * Dit is precies de omgekeerde situatie van de cashbackkant. Daar hadden we 77
 * producten en 0 bruikbare uitkomsten; hier hebben we 4 programma's en bij elk
 * ervan weten we WELKE SOORT uitspraak we mogen doen. Een klein bestand waarin
 * elke regel iets betekent, is meer waard dan een groot bestand waarin geen
 * enkele regel een som afmaakt.
 *
 * ── DE VIER SOORTEN, en waarom ze niet één veld met null mogen zijn ─────────
 *
 * "geen koers" is niet één ding, en het verschil hoort op het scherm:
 *
 *   koers              — de uitgever noemt een verhouding. Alleen hier mag er
 *                        een bedrag en een percentage op het scherm.
 *   uitgesproken-nul   — de uitgever zegt zélf dat punten geen geldwaarde
 *                        hebben (ING). Dat is een BEKENDE nul, de keerzijde van
 *                        "onbekend is nooit nul", en dus een feit dat we mogen
 *                        noemen — met de reikwijdte erbij, want ING's nul gaat
 *                        over geld en niet over korting in de ING Winkel.
 *   geen-vaste-waarde  — de uitgever zegt zelf dat de waarde per inwisselwijze
 *                        verschilt (Revolut). Ook een uitspraak van de bron,
 *                        maar een andere: er IS waarde, ze staat alleen niet
 *                        vast. Nul zou hier fout zijn.
 *   niet-gepubliceerd  — wij hebben het niet kunnen lezen (Flying Blue: 404 op
 *                        het inwisselpad). Dat is een gat in ONZE meting en geen
 *                        uitspraak van de uitgever, en de zin op het scherm mag
 *                        dat niet door elkaar halen.
 *
 * ── DE HERCONTROLE, met de hand bijgehouden en met opzet hier ──────────────
 *
 * De staging-meting is van 21 augustus 2026. Op 22 augustus heb ik twee van de
 * vier bronnen zelf opnieuw opgehaald met kale curl en een browser-UA. Wat er
 * uitkwam staat hieronder in `HERCONTROLE`, inclusief de bron die NIET lukte —
 * Revolut zit sinds vandaag achter een Cloudflare-uitdaging (HTTP 403, ook via
 * r.jina.ai). Een 403 is een antwoord en wordt niet omzeild; het gevolg is dat
 * die regel de datum van 21 augustus houdt en dat dát op het scherm komt.
 *
 * Waarom die tabel hier staat en niet in het gegenereerde bestand: het
 * gegenereerde bestand mag met de hand niet worden aangeraakt, en een meting is
 * met de hand gedaan. Dit is de plek waar handwerk hoort.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HIER = dirname(fileURLToPath(import.meta.url));
const STAGING = resolve(HIER, "../../../docs/catalog/staging-points.json");
const UIT = resolve(HIER, "../src/generated/points-rates.generated.ts");

type RuweWaarde = {
  programme: string;
  eurPerPoint: number | null;
  scope: string;
  evidence: string;
  sourceUrl: string;
  sourceDate: string | null;
  quote: string | null;
  note?: string;
};

const ruw = JSON.parse(readFileSync(STAGING, "utf8")) as {
  generatedAt: string;
  redemptionValues: RuweWaarde[];
};

/** De namen waaronder hij een programma kan invoeren. Genormaliseerd
 *  (kleine letters, geen leestekens) zodat "Amex" en "American Express"
 *  bij dezelfde regel uitkomen.
 *
 *  MET DE HAND, want een automatisch afgeleide alias is een gok. "Miles" alleen
 *  zou Flying Blue, Miles & More en Air Miles allemaal opeisen, en dan staat er
 *  een KLM-koers onder een Air Miles-saldo. Liever geen match dan de verkeerde:
 *  geen match levert "we kennen dit programma niet" op, en dat is waar. */
const ALIASSEN: Record<string, string[]> = {
  "Membership Rewards": [
    "membership rewards",
    "american express membership rewards",
    "amex membership rewards",
    "american express",
    "amex",
  ],
  "ING Punten": ["ing punten", "ing", "ing bank"],
  RevPoints: ["revpoints", "revolut revpoints", "revolut"],
  "Flying Blue Miles": ["flying blue miles", "flying blue klm air france", "flying blue"],
};

/** Wat er op 22 augustus 2026 gebeurde toen ik de bron zelf opnieuw ophaalde. */
const HERCONTROLE: Record<string, string> = {
  "Membership Rewards":
    "Op 22 augustus 2026 zelf opnieuw opgehaald met kale curl en een browser-UA: HTTP 200, " +
    "604.301 bytes, en het citaat staat er woordelijk in.",
  "ING Punten":
    "Op 22 augustus 2026 zelf opnieuw opgehaald met kale curl: de PDF geeft HTTP 200 (127.289 bytes) " +
    "en de zin 'geen geldwaarde' staat er nog in.",
  RevPoints:
    "Op 22 augustus 2026 niet opnieuw te lezen: zowel direct als via r.jina.ai komt er een " +
    "Cloudflare-uitdaging terug (HTTP 403). Die is niet omzeild, dus dit cijfer draagt de datum van " +
    "21 augustus 2026 en niet die van vandaag.",
};

/** Wat er nog meer vaststaat en wat de zin op het scherm niet mag weglaten. */
const NUANCE: Record<string, string> = {
  /* De reikwijdte van de koers staat al in de route-zin van lines.ts (`scope`),
   * dus die staat hier NIET nog een keer. Gemeten in een draaiende Chrome stond
   * er anders twee keer achter elkaar "niet in de kassa van deze winkel" — en
   * een waarheid twee keer opschrijven maakt de rest van de regel minder
   * geloofwaardig, niet meer. Wat hier overblijft is het stuk dat er nog NIET
   * staat. */
  "Membership Rewards":
    "Overboeken naar een luchtvaart- of hotelpartner heeft een andere waarde, en die publiceert " +
    "Amex niet.",
  "ING Punten":
    "Die nul gaat over inwisselen tegen GELD. Wat een punt aan korting oplevert in de ING Winkel is " +
    "een ander cijfer; dat staat achter Mijn ING en is niet openbaar.",
  RevPoints:
    "Revolut noemt wel één euro per punt, maar dat is een plafond op wat zij in rekening brengen bij " +
    "een negatief saldo (maximaal € 0,02 per punt) en geen inwisselwaarde.",
  "Flying Blue Miles":
    "Wat een mijl waard is hangt bij Flying Blue af van de vlucht; er is geen vaste koers om te lezen, " +
    "ook niet als de pagina het wel had gedaan.",
};

type Soort = "koers" | "uitgesproken-nul" | "geen-vaste-waarde" | "niet-gepubliceerd";

function soortVan(v: RuweWaarde): Soort {
  if (typeof v.eurPerPoint === "number" && v.eurPerPoint > 0) return "koers";
  if (v.eurPerPoint === 0 && v.evidence === "stated-absence") return "uitgesproken-nul";
  if (v.eurPerPoint === null && v.evidence === "stated-absence") return "geen-vaste-waarde";
  return "niet-gepubliceerd";
}

/** Welke rangorde een soort heeft als één programma meerdere regels draagt.
 *
 *  ING staat er twee keer in: een uitgesproken nul voor "inwisselen voor geld"
 *  en een leeg cijfer voor "korting in de ING Winkel". Aan een kassa gaat de
 *  vraag over geld — kan ik hiermee betalen — dus die regel wint, en de andere
 *  komt als nuance mee. Andersom zou de sterkste uitspraak die de bron doet
 *  verdwijnen achter een gat. */
const VOORRANG: Record<Soort, number> = {
  koers: 0,
  "uitgesproken-nul": 1,
  "geen-vaste-waarde": 2,
  "niet-gepubliceerd": 3,
};

const perProgramma = new Map<string, RuweWaarde>();
for (const v of ruw.redemptionValues) {
  const bestaand = perProgramma.get(v.programme);
  if (!bestaand || VOORRANG[soortVan(v)] < VOORRANG[soortVan(bestaand)]) {
    perProgramma.set(v.programme, v);
  }
}

/** "geen datum in het document (opgehaald 21-08-2026)" is geen datum van het
 *  document maar van ons. Zulke waarden worden null: het document zegt niets
 *  over zijn eigen ouderdom, en dat is iets anders dan een datum die we hebben
 *  weggelaten. */
function bronDatum(v: RuweWaarde): string | null {
  const d = (v.sourceDate ?? "").trim();
  if (d === "" || /geen datum in het document/i.test(d)) return null;
  return d;
}

const regels: string[] = [];
const telling: Record<Soort, number> = {
  koers: 0,
  "uitgesproken-nul": 0,
  "geen-vaste-waarde": 0,
  "niet-gepubliceerd": 0,
};

for (const [programma, v] of [...perProgramma.entries()].sort((a, b) => a[0].localeCompare(b[0], "nl"))) {
  const soort = soortVan(v);
  telling[soort]++;
  const aliassen = ALIASSEN[programma] ?? [];
  if (aliassen.length === 0) {
    throw new Error(
      `[bundle-points-rates] ${programma} heeft geen aliaslijst. Zonder alias komt een ingevoerd ` +
        `saldo er nooit bij uit en zegt de extensie "programma onbekend" over een programma dat ze kent.`,
    );
  }
  regels.push(
    `  {\n` +
      `    program: ${JSON.stringify(programma)},\n` +
      `    aliases: ${JSON.stringify(aliassen)},\n` +
      `    eurPerPoint: ${v.eurPerPoint === null ? "null" : JSON.stringify(v.eurPerPoint)},\n` +
      `    soort: ${JSON.stringify(soort)},\n` +
      `    scope: ${JSON.stringify(v.scope)},\n` +
      `    quote: ${JSON.stringify(v.quote ?? "")},\n` +
      `    sourceUrl: ${JSON.stringify(v.sourceUrl)},\n` +
      `    gelezenOp: ${JSON.stringify(ruw.generatedAt)},\n` +
      `    bronDatum: ${JSON.stringify(bronDatum(v))},\n` +
      `    hercontrole: ${JSON.stringify(HERCONTROLE[programma] ?? null)},\n` +
      `    nuance: ${JSON.stringify(NUANCE[programma] ?? null)},\n` +
      `  },`,
  );
}

const kop = `/* GEGENEREERD — niet met de hand bijwerken.
 *
 * Bron: docs/catalog/staging-points.json (generatedAt ${ruw.generatedAt}).
 * Gemaakt door apps/extension/scripts/bundle-points-rates.ts, waar ook staat
 * welke bron op 22 augustus 2026 opnieuw is opgehaald en welke niet lukte.
 *
 * ${perProgramma.size} programma's. Daarvan:
 *   ${telling.koers} met een gepubliceerde koers naar euro's,
 *   ${telling["uitgesproken-nul"]} met een uitgesproken nul van de uitgever zelf,
 *   ${telling["geen-vaste-waarde"]} waar de uitgever zelf zegt dat er geen vaste waarde is,
 *   ${telling["niet-gepubliceerd"]} die wij niet hebben kunnen lezen.
 *
 * DAT EERSTE GETAL BEPAALT WAAR EEN PERCENTAGE MAG STAAN. Bij ${telling.koers} van de
 * ${perProgramma.size} programma's kan de extensie zeggen wat een saldo hier dekt. Bij de
 * andere ${perProgramma.size - telling.koers} staat er alleen DAT hij punten heeft, met de reden
 * waarom er geen bedrag bij staat — en die reden is per programma een andere.
 *
 * Er zit geen saldo in dit bestand en er kan er geen in komen: een saldo is van
 * de gebruiker en staat in chrome.storage.local (zie store.ts). Dit bestand is
 * alleen de koers.
 */

/** Wat voor soort uitspraak we over dit programma mogen doen. */
export type RateSoort = "koers" | "uitgesproken-nul" | "geen-vaste-waarde" | "niet-gepubliceerd";

export type PointsRate = {
  /** De naam zoals de uitgever hem schrijft. */
  program: string;
  /** Genormaliseerde namen waaronder een ingevoerd saldo bij deze regel uitkomt. */
  aliases: readonly string[];
  /** Euro per punt. null zodra er geen koers is — nooit 0 om "onbekend" mee te
   *  bedoelen; 0 betekent hier dat de uitgever het zelf heeft uitgesproken. */
  eurPerPoint: number | null;
  soort: RateSoort;
  /** Waar de koers of de uitspraak over gaat. Zonder dit veld wordt een koers
   *  voor "Betalen met Punten in de Amex App" gelezen als een koers in de kassa
   *  van de winkel, en dat is hij niet. */
  scope: string;
  /** De letterlijke zin van de uitgever. */
  quote: string;
  sourceUrl: string;
  /** Wanneer WIJ de bron gelezen hebben. */
  gelezenOp: string;
  /** De datum die het document zelf draagt, of null als het er geen noemt. */
  bronDatum: string | null;
  /** Uitkomst van de laatste hercontrole, of null als die er niet was. */
  hercontrole: string | null;
  /** Wat de zin op het scherm niet mag weglaten. */
  nuance: string | null;
};

export const POINTS_RATES_READ_AT = ${JSON.stringify(ruw.generatedAt)};

export const POINTS_RATES: readonly PointsRate[] = [
`;

writeFileSync(UIT, kop + regels.join("\n") + "\n];\n", "utf8");
console.log(`[bundle-points-rates] ${UIT}`);
console.log(`[bundle-points-rates]`, telling);
