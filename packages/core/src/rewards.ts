import { norm } from "./hash.js";

/** A hand-kept points/cashback balance. `intervalDays` and `snoozedUntil` are
 *  additive and optional — they drive the stale detector in `tracking.ts` (how
 *  often this programme should be re-confirmed, and "don't ask before X"). A
 *  vault written before them decrypts unchanged and falls back to the default
 *  interval. */
export type RewardsBalance = { id: string; program: string; points: number; updatedAt: string; note?: string;
  intervalDays?: number; snoozedUntil?: string };
export type RewardProgram = { name: string; category: string; note?: string };

/** One row per program: id is the normalized program name, so editing a
 *  program's balance updates the same row instead of duplicating it. */
export function makeRewardsBalance(r: Omit<RewardsBalance, "id">): RewardsBalance {
  return { ...r, id: norm(r.program) };
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** A balance is stale when it was last updated more than `maxDays` before asOf. */
export function isStale(b: RewardsBalance, asOf: string, maxDays = 90): boolean {
  return daysBetween(b.updatedAt, asOf) > maxDays;
}

/** WAT ER HIER STOND WAS WEERLEGD, en dat het nergens werd afgedrukt maakte het
 *  niet minder fout.
 *
 *  Tot 20 augustus 2026 droeg deze regel de note "ING NL heeft geen
 *  puntenprogramma — gebruik dit voor cashback/acties". Op 21 augustus is dat
 *  weerlegd langs ING's eigen pagemodel-API achter
 *  ing.nl/particulier/ing-punten/zo-spaar-je-ing-punten: de spaartabel staat er
 *  gewoon in, ING Punten bestaan. Zie docs/research/2026-08-20-punten-koersen.md.
 *
 *  Waarom hij toch weg moest terwijl geen enkel scherm hem afdrukt: een note in
 *  deze lijst is bedoeld om afgedrukt te worden — `programUnit` in de Punten-view
 *  leest hem al — en de eerstvolgende regel die hem naast de programmanaam zet,
 *  zet daarmee een ontkenning op het scherm van een programma dat de gebruiker in
 *  Mijn ING kan zien staan. Een onwaarheid die op de plank ligt is een onwaarheid
 *  met een datum erop.
 *
 *  WAAROM DEZE ZIN LANG IS. Elke bijzin houdt één verkeerde lezing tegen, en de
 *  korte versies lieten er telkens één door:
 *
 *  · "per drempel, niet per bestede euro" — anders wordt 250 punten bij meer dan
 *    € 100 besteding gelezen als 2,5 punt per euro. Die koers bestaat niet: bij
 *    € 4.000 besteding zijn het nog steeds 250 punten, dus de deling valt bij
 *    normaal gebruik een factor 40 te hoog uit. Daarom staan de drempels er in
 *    ING's eigen bewoordingen en staat er nergens een koers.
 *  · de letterlijke voorwaardenzin — "geen geldwaarde" is hier een UITGESPROKEN
 *    nul en dus iets anders dan onbekend, maar alleen voor inwisselen tegen geld.
 *    Het citaat zegt zelf waar het over gaat; een samenvatting deed dat niet.
 *  · de ING Winkel — zonder die bijzin leest "geen geldwaarde" als "een punt is
 *    niets waard". Wat een punt daar aan korting oplevert staat achter Mijn ING
 *    en is niet vastgesteld. Onbekend, geen nul.
 *  · bron en datum — in de note zelf en niet in een apart veld, want een apart
 *    veld kan door de afdrukkende regel worden overgeslagen en dan staat de claim
 *    er zonder herkomst. Zo kan dat niet: het citaat en zijn bron reizen samen.
 *
 *  De volledige verdien- en inwisselregels staan als gestructureerde velden in
 *  apps/web/src/views/Punten.tsx (`ING_PUNTEN`) onder de programmanaam "ING
 *  Punten". Deze regel heet "ING" en blijft de losse bankregel; ze verwijst er
 *  bewust niet naar, want core kan niet nakijken wat die view kent. */
const ING_NOTE =
  "ING Punten spaar je per drempel, niet per bestede euro: 250 punten per maand bij minimaal € 700 " +
  "instroom, 250 bij meer dan € 100 besteed met de Creditcard Extra of Max, 100 met de (studenten) " +
  "Creditcard More. Uit de voorwaarden geldig vanaf 1 oktober 2025: “ING Punten hebben geen geldwaarde. " +
  "Je kan je ING Punten niet inwisselen voor geld en niet overdragen aan anderen.” Wat een punt in de " +
  "ING Winkel aan korting oplevert, publiceert ING niet — dat is onbekend, geen nul. " +
  "Bron: ing.nl/particulier/ing-punten, gelezen 21-08-2026.";

/** Reference list of known programs, used for the add-balance datalist.
 *  No value/transfer data here — value and transfer questions go to the
 *  LaVega chat assistant, which looks up current rates live. */
export const REWARD_PROGRAMS: readonly RewardProgram[] = [
  { name: "American Express Membership Rewards", category: "Creditcard" },
  { name: "Flying Blue (KLM/Air France)", category: "Airline" },
  { name: "Avios (BA/Iberia)", category: "Airline" },
  { name: "Miles & More (Lufthansa)", category: "Airline" },
  { name: "Marriott Bonvoy", category: "Hotel" },
  { name: "World of Hyatt", category: "Hotel" },
  { name: "IHG One Rewards", category: "Hotel" },
  { name: "Hilton Honors", category: "Hotel" },
  { name: "bunq", category: "Bank", note: "cashback in euro's" },
  { name: "ING", category: "Bank", note: ING_NOTE },
];
