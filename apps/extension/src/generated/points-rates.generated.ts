/* GEGENEREERD — niet met de hand bijwerken.
 *
 * Bron: docs/catalog/staging-points.json (generatedAt 2026-08-21).
 * Gemaakt door apps/extension/scripts/bundle-points-rates.ts, waar ook staat
 * welke bron op 22 augustus 2026 opnieuw is opgehaald en welke niet lukte.
 *
 * 4 programma's. Daarvan:
 *   1 met een gepubliceerde koers naar euro's,
 *   1 met een uitgesproken nul van de uitgever zelf,
 *   1 waar de uitgever zelf zegt dat er geen vaste waarde is,
 *   1 die wij niet hebben kunnen lezen.
 *
 * DAT EERSTE GETAL BEPAALT WAAR EEN PERCENTAGE MAG STAAN. Bij 1 van de
 * 4 programma's kan de extensie zeggen wat een saldo hier dekt. Bij de
 * andere 3 staat er alleen DAT hij punten heeft, met de reden
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

export const POINTS_RATES_READ_AT = "2026-08-21";

export const POINTS_RATES: readonly PointsRate[] = [
  {
    program: "Flying Blue Miles",
    aliases: ["flying blue miles","flying blue klm air france","flying blue"],
    eurPerPoint: null,
    soort: "niet-gepubliceerd",
    scope: "alle inwisselopties",
    quote: "",
    sourceUrl: "https://www.flyingblue.com/nl/miles/spend",
    gelezenOp: "2026-08-21",
    bronDatum: null,
    hercontrole: null,
    nuance: "Wat een mijl waard is hangt bij Flying Blue af van de vlucht; er is geen vaste koers om te lezen, ook niet als de pagina het wel had gedaan.",
  },
  {
    program: "ING Punten",
    aliases: ["ing punten","ing","ing bank"],
    eurPerPoint: 0,
    soort: "uitgesproken-nul",
    scope: "inwisselen voor geld",
    quote: "ING Punten hebben geen geldwaarde. Je kan je ING Punten niet inwisselen voor geld en niet overdragen aan anderen",
    sourceUrl: "https://assets.ing.com/m/410cccd97ce258bd/original/Voorwaarden-ING-Punten-vanaf-1-oktober-2025.pdf",
    gelezenOp: "2026-08-21",
    bronDatum: "1 oktober 2025",
    hercontrole: "Op 22 augustus 2026 zelf opnieuw opgehaald met kale curl: de PDF geeft HTTP 200 (127.289 bytes) en de zin 'geen geldwaarde' staat er nog in.",
    nuance: "Die nul gaat over inwisselen tegen GELD. Wat een punt aan korting oplevert in de ING Winkel is een ander cijfer; dat staat achter Mijn ING en is niet openbaar.",
  },
  {
    program: "Membership Rewards",
    aliases: ["membership rewards","american express membership rewards","amex membership rewards","american express","amex"],
    eurPerPoint: 0.003,
    soort: "koers",
    scope: "Betalen met Punten via de Amex App / online account",
    quote: "1.000 Membership Rewards punten zijn gelijk aan € 3.",
    sourceUrl: "https://www.americanexpress.com/nl-nl/rewards/membership-rewards/",
    gelezenOp: "2026-08-21",
    bronDatum: null,
    hercontrole: "Op 22 augustus 2026 zelf opnieuw opgehaald met kale curl en een browser-UA: HTTP 200, 604.301 bytes, en het citaat staat er woordelijk in.",
    nuance: "Overboeken naar een luchtvaart- of hotelpartner heeft een andere waarde, en die publiceert Amex niet.",
  },
  {
    program: "RevPoints",
    aliases: ["revpoints","revolut revpoints","revolut"],
    eurPerPoint: null,
    soort: "geen-vaste-waarde",
    scope: "alle inwisselopties",
    quote: "RevPoints hebben geen vaste geldwaarde en hun waarde hangt af van de gekozen inwisselmethode.",
    sourceUrl: "https://help.revolut.com/nl-NL/help/revpoints/what-is-revpoints/question-how-can-i-redeem-my-revpoints/",
    gelezenOp: "2026-08-21",
    bronDatum: null,
    hercontrole: "Op 22 augustus 2026 niet opnieuw te lezen: zowel direct als via r.jina.ai komt er een Cloudflare-uitdaging terug (HTTP 403). Die is niet omzeild, dus dit cijfer draagt de datum van 21 augustus 2026 en niet die van vandaag.",
    nuance: "Revolut noemt wel één euro per punt, maar dat is een plafond op wat zij in rekening brengen bij een negatief saldo (maximaal € 0,02 per punt) en geen inwisselwaarde.",
  },
];
