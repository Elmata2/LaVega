/* De kaart in de Valuta-tab, het pure deel: van een land naar het antwoord op
 * "wat kost het om hierheen om te wisselen".
 *
 * De vlakken en de valuta's komen uit `assets/world-map.generated.ts`, tijdens
 * een sweep opgehaald en meegebundeld (zie `assets/GEODATA.md`). Dit bestand
 * haalt niets op, kent geen klok en heeft geen opslag — het leest die tabel en
 * beantwoordt vragen erover.
 *
 * HET ANTWOORD IS EEN SOORT, GEEN GETAL. Dat is de hele reden dat dit bestand
 * bestaat in plaats van een `Record<string, string>` in de view. Er zijn vier
 * manieren waarop "wat kost omwisselen daarheen" kan eindigen en ze zien er in
 * een tabel bedrieglijk hetzelfde uit:
 *
 *   euro      — daar betaal je in euro's, er valt niets om te wisselen. Dit is
 *               NIET "gratis" en al helemaal geen 0%: er is geen transactie.
 *   priceable — één valuta en wij kennen de koers (de ECB-lijst die de
 *               Valuta-tab al gebruikt). Hier mag een bedrag komen te staan.
 *   choice    — meer dan één valuta is er in gebruik. Dan kiest de datalaag er
 *               GEEN. In Panama kennen wij de dollarkoers wel en de balboakoers
 *               niet, dus "gewoon de eerste pakken" verandert het antwoord.
 *               De UI hoort het te vragen.
 *   noRate    — wij weten waarmee er betaald wordt, maar wij hebben geen koers.
 *               Dat is een leemte bij ONS. Het mag nooit als 0%, "gratis" of
 *               een streepje-dat-op-nul-lijkt op het scherm komen.
 *   unknown   — de bron kent voor dit land geen valuta, of het land bestaat
 *               niet in de tabel. Ook dit is niet nul.
 *
 * Dertien van de 249 landen hebben `path: null`: de bron heeft op deze schaal geen
 * eigen vlak voor ze (Gibraltar, Caribisch Nederland, de Franse overzeese
 * departementen). Ze staan
 * er wél in, met valuta, want een land dat je niet kunt aanklikken is nog steeds
 * een land waarover je iets kunt vragen. `mapCountries()` geeft alleen wat er te
 * tekenen valt; `allCountries()` geeft alles, en dat is wat de zoekbalk hoort te
 * doorzoeken. */
import {
  WORLD_COUNTRIES,
  WORLD_MAP_BOUNDS,
  WORLD_MAP_FILL_RULE,
  WORLD_MAP_SOURCES,
  WORLD_MAP_VIEWBOX,
  type WorldCountry,
  type WorldCurrency,
} from "./assets/world-map.generated.js";
import { countryName } from "./countries.js";

export type { WorldCountry, WorldCurrency };
export { WORLD_MAP_BOUNDS, WORLD_MAP_FILL_RULE, WORLD_MAP_SOURCES, WORLD_MAP_VIEWBOX };

const BY_ID = new Map(WORLD_COUNTRIES.map((c) => [c.id, c]));

/** Alles, ook de landen zonder vlak. */
export function allCountries(): readonly WorldCountry[] {
  return WORLD_COUNTRIES;
}

/** Alleen wat er te tekenen valt. `path` is hier gegarandeerd een string, zodat
 *  de component er geen null-check omheen hoeft te zetten die hij zou vergeten. */
export function mapCountries(): (WorldCountry & { path: string })[] {
  return WORLD_COUNTRIES.filter((c): c is WorldCountry & { path: string } => c.path !== null);
}

/** Een land op ISO-code. Onbekende of rommelige invoer geeft null, geen
 *  gegokt land. */
export function countryById(id: string): WorldCountry | null {
  return BY_ID.get(String(id ?? "").trim().toUpperCase()) ?? null;
}

/** De naam zoals hij op het scherm hoort. Het platform gaat voor op de
 *  gebundelde naam — dezelfde afweging als in `countries.ts`: die namen komen
 *  uit CLDR en verouderen dus niet met onze sweep mee. Kent het platform de
 *  code niet, dan is de gebundelde naam beter dan de code zelf. */
export function countryLabel(id: string): string {
  const c = countryById(id);
  if (!c) return "";
  const nl = countryName(c.id);
  return nl && nl !== c.id ? nl : c.name;
}

/** Kleine letters, zonder accenten en zonder leestekens: zo vindt "curacao" ook
 *  Curaçao en "cote divoire" ook Côte d'Ivoire. */
function fold(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Zoeken op naam of code, Nederlands en Engels tegelijk (de bron noemt Zuid-
 *  Afrika "South Africa", en iemand die dat intypt bedoelt hetzelfde land).
 *
 *  De volgorde is: exacte code, dan namen die met de zoekterm BEGINNEN, dan
 *  namen die hem bevatten. Zonder die volgorde zet "ind" India onder Indonesië
 *  en Brits Indische Oceaanterritorium, en dan lijkt de zoekbalk stuk. */
export function searchCountries(query: string, limit = 8): WorldCountry[] {
  const q = fold(query);
  if (!q) return [];
  const scored: { c: WorldCountry; rank: number; name: string }[] = [];
  for (const c of WORLD_COUNTRIES) {
    const label = countryLabel(c.id);
    const names = [fold(label), fold(c.name), fold(c.nameEn)];
    const rank =
      c.id.toLowerCase() === q
        ? 0
        : names.some((n) => n.startsWith(q))
          ? 1
          : names.some((n) => n.includes(q))
            ? 2
            : -1;
    if (rank >= 0) scored.push({ c, rank, name: label });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "nl"))
    .slice(0, Math.max(0, limit))
    .map((s) => s.c);
}

/** Waarmee er in dit land betaald wordt, met per valuta of wij er een koers van
 *  hebben. Leeg betekent: de bron zegt er niets over. Dat is niet "geen
 *  valuta" en het is zeker geen nul. */
export function currenciesFor(id: string): readonly WorldCurrency[] {
  return countryById(id)?.currencies ?? [];
}

/** Wat er met omwisselen naar dit land gebeurt. Zie de kop van dit bestand voor
 *  waarom dit vijf soorten zijn en niet één getal.
 *
 *  `currencies` staat in ELKE variant, ook als er maar één is: de UI die het
 *  antwoord toont wil bijna altijd ook de code kunnen noemen, en een tweede
 *  aanroep om die op te halen is een tweede plek waar iemand een andere valuta
 *  kan kiezen dan waar het antwoord over ging. */
export type ConversionAnswer =
  | { kind: "euro"; currencies: readonly WorldCurrency[] }
  | { kind: "priceable"; currency: WorldCurrency; currencies: readonly WorldCurrency[] }
  | { kind: "choice"; currencies: readonly WorldCurrency[] }
  | { kind: "noRate"; currency: WorldCurrency; currencies: readonly WorldCurrency[] }
  | { kind: "unknown"; currencies: readonly WorldCurrency[] };

export function conversionFor(id: string): ConversionAnswer {
  const c = countryById(id);
  const currencies = c?.currencies ?? [];
  if (!c || currencies.length === 0) return { kind: "unknown", currencies: [] };
  /* Alle valuta's de euro? Dan is er niets om te wisselen, hoeveel regels de
   * bron er ook van maakt. Let op wat hier NIET staat: "eurozone". Monaco,
   * Montenegro en Kosovo zijn geen lid en betalen wel in euro's — voor de vraag
   * "moet ik wisselen" is dat hetzelfde antwoord, en lidmaatschap is een
   * bewering die deze tabel niet kan dragen. */
  if (currencies.every((x) => x.code === "EUR")) return { kind: "euro", currencies };
  if (currencies.length > 1) return { kind: "choice", currencies };
  const only = currencies[0];
  return only.priceable ? { kind: "priceable", currency: only, currencies } : { kind: "noRate", currency: only, currencies };
}
