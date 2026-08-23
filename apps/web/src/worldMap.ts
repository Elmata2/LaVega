/* De wereldbol in de Valuta-tab, het pure deel: van een land naar het antwoord op
 * "wat kost het om hierheen om te wisselen", en van een punt op de bol naar een
 * land.
 *
 * De vlakken en de valuta's komen uit `assets/world-map.generated.ts`, tijdens
 * een sweep opgehaald en meegebundeld (zie `assets/GEODATA.md`). Dit bestand
 * haalt niets op, kent geen klok en heeft geen opslag — het leest die tabel en
 * beantwoordt vragen erover.
 *
 * DE VLAKKEN ZIJN RUWE GRADEN GEWORDEN, GEEN SVG-PADEN. Hier stonden paden in een
 * viewBox van 1000×500; die kon de component rechtstreeks tekenen. Dat kan niet
 * meer, en de reden is niet dat het mooier is: een bol projecteert per frame
 * anders, want de stand van de bol zit in de projectie. Wat dit bestand teruggeeft
 * zijn dus lijsten `[lengtegraad, breedtegraad]` en het projecteren is van de
 * component. De vertaling terug — van een punt op de bol naar een land — staat
 * hier wél (`countryAtLonLat`), want dat is pure meetkunde over dezelfde tabel en
 * het moet dezelfde vulregel volgen als het tekenen. Zou de component dat zelf
 * doen, dan zijn er twee antwoorden op "waar klikte ik" en gaat er één een keer
 * afwijken.
 *
 * Wat de bol verder van deze laag vraagt is één ding: WAAR EEN LAND LIGT, in
 * graden. Dat is `countryFocus()`. Een zoekveld zonder dat antwoord is een
 * zoekveld dat een land vindt en er niets mee doet — je typt "Singapore" en het
 * blijft aan de achterkant van de bol zitten. De soorten antwoorden over valuta
 * hieronder waren daarbij niet veranderd; die waren af. Er is er sindsdien één
 * bijgekomen, en niet omdat de tabel rijker werd maar omdat er een LAND bijkwam:
 * Antarctica staat nu op de bol, en dat is het eerste land waar geen munt is.
 * Zie `noTender` hieronder.
 *
 * HET ANTWOORD IS EEN SOORT, GEEN GETAL. Dat is de hele reden dat dit bestand
 * bestaat in plaats van een `Record<string, string>` in de view. Er zijn ZES
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
 *   noTender  — er is daar geen wettig betaalmiddel. Vandaag is dat Antarctica
 *               en alleen Antarctica (CLDR zet er XXX neer). Er valt niets te
 *               wisselen omdat er geen munt is — het gat zit niet bij ons.
 *   unknown   — de bron kent voor dit land geen valuta, of het land bestaat
 *               niet in de tabel. Ook dit is niet nul.
 *
 * DE LAATSTE TWEE ZIJN HET PAAR DAT ER TOE DOET, en dat is de reden dat de zesde
 * er is. Ze hebben allebei een leeg valutalijstje en ze betekenen het
 * tegenovergestelde: bij `noTender` heeft de bron gekeken en is er niets, bij
 * `unknown` heeft de bron niets gezegd. Zonder dat onderscheid zou de bol op
 * Antarctica "valuta onbekend" melden — een leemte aan onze kant verzinnen waar
 * de bron een antwoord geeft. Precies andersom als de valkuil aan de andere kant
 * (een leemte als 0% tonen), en even fout.
 *
 * Dertien van de 250 landen hebben `rings: null`: de bron heeft op deze schaal geen
 * eigen vlak voor ze (Gibraltar, Caribisch Nederland, de Franse overzeese
 * departementen). Ze staan
 * er wél in, met valuta, want een land dat je niet kunt aanklikken is nog steeds
 * een land waarover je iets kunt vragen. Vijf van die dertien hebben wel een
 * `pin`: dan weten we waar het ligt en tekenen we het niet, en kan de bol er via
 * de zoekbalk toch naartoe draaien. `mapCountries()` geeft alleen wat er te
 * tekenen valt; `allCountries()` geeft alles, en dat is wat de zoekbalk hoort te
 * doorzoeken. */
import {
  WORLD_COUNTRIES,
  WORLD_LATLON_BOUNDS,
  WORLD_MAP_FILL_RULE,
  WORLD_MAP_SOURCES,
  type LonLat,
  type Ring,
  type WorldCountry,
  type WorldCurrency,
} from "./assets/world-map.generated.js";
import { countryName } from "./countries.js";

export type { LonLat, Ring, WorldCountry, WorldCurrency };
export { WORLD_LATLON_BOUNDS, WORLD_MAP_FILL_RULE, WORLD_MAP_SOURCES };

const BY_ID = new Map(WORLD_COUNTRIES.map((c) => [c.id, c]));

/** Alles, ook de landen zonder vlak. */
export function allCountries(): readonly WorldCountry[] {
  return WORLD_COUNTRIES;
}

/** Alleen wat er te tekenen valt. `rings` en `bbox` zijn hier gegarandeerd
 *  gevuld, zodat de component er geen null-check omheen hoeft te zetten die hij
 *  zou vergeten — en `pin` ook, want een land met een vlak heeft altijd een punt
 *  in dat vlak. */
export type DrawableCountry = WorldCountry & {
  rings: readonly Ring[];
  bbox: readonly [number, number, number, number];
  pin: LonLat;
};

export function mapCountries(): DrawableCountry[] {
  return WORLD_COUNTRIES.filter((c): c is DrawableCountry => c.rings !== null);
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
 *  hebben. Leeg is hier NIET één antwoord: het kan "de bron zegt er niets over"
 *  zijn of "de bron zegt dat er geen betaalmiddel is". Wie dat onderscheid nodig
 *  heeft — en dat is iedereen die er een zin over op het scherm zet — moet
 *  `conversionFor()` gebruiken. Nul is het in geen van beide gevallen. */
export function currenciesFor(id: string): readonly WorldCurrency[] {
  return countryById(id)?.currencies ?? [];
}

/** Wat er met omwisselen naar dit land gebeurt. Zie de kop van dit bestand voor
 *  waarom dit zes soorten zijn en niet één getal.
 *
 *  `currencies` staat in ELKE variant, ook als er maar één is: de UI die het
 *  antwoord toont wil bijna altijd ook de code kunnen noemen, en een tweede
 *  aanroep om die op te halen is een tweede plek waar iemand een andere valuta
 *  kan kiezen dan waar het antwoord over ging. Bij `noTender` en `unknown` is die
 *  lijst leeg — en de UI mag dat lege lijstje dus NIET zelf interpreteren, want
 *  de twee betekenen niet hetzelfde. Daar is `kind` voor. */
export type ConversionAnswer =
  | { kind: "euro"; currencies: readonly WorldCurrency[] }
  | { kind: "priceable"; currency: WorldCurrency; currencies: readonly WorldCurrency[] }
  | { kind: "choice"; currencies: readonly WorldCurrency[] }
  | { kind: "noRate"; currency: WorldCurrency; currencies: readonly WorldCurrency[] }
  | { kind: "noTender"; currencies: readonly WorldCurrency[] }
  | { kind: "unknown"; currencies: readonly WorldCurrency[] };

export function conversionFor(id: string): ConversionAnswer {
  const c = countryById(id);
  const currencies = c?.currencies ?? [];
  if (!c) return { kind: "unknown", currencies: [] };
  /* Geen valuta in de tabel — en dan hangt alles aan wie dat zegt. `noTender`
   * staat er alleen als de BRON meldt dat er geen wettig betaalmiddel is (CLDR:
   * XXX; vandaag alleen Antarctica). Ontbreekt die vlag, dan weten wij het niet,
   * en dan is `unknown` het enige eerlijke antwoord. Dit was tot voor kort één
   * tak — met alleen `unknown` — en dat was precies goed zolang Antarctica niet
   * op de bol stond. Met Antarctica erop zou het betekenen dat de bol een leemte
   * bij ONS meldt op de enige plek waar de bron juist wél iets zegt. */
  if (currencies.length === 0) {
    return c.noTender ? { kind: "noTender", currencies: [] } : { kind: "unknown", currencies: [] };
  }
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

/* --- van de bol terug naar een land ---------------------------------------- */

/** De omhullende van ÁLLE ringen van een land, één keer uitgerekend.
 *
 *  Dit is niet dezelfde omhullende als `bbox` in de tabel, en dat verschil is
 *  precies waarom hij hier staat. `bbox` is van `rings[0]` — van het grootste
 *  vlak — omdat dat het antwoord is op "waar ligt Rusland" (Siberië, en niet
 *  "−180 tot 180"). Maar voor de vraag "kan een klik hier dit land nog raken"
 *  moet ELK vlak meedoen: wie op Hawaï klikt bedoelt de Verenigde Staten, en de
 *  bbox van het grootste vlak van de VS houdt op bij Californië. Die bbox als
 *  voorfilter gebruiken zou dus alle eilanden onklikbaar maken — een fout die
 *  niet opvalt, want de kaart tekent ze wél.
 *
 *  Bij de datumgrens levert dit voor Rusland en Fiji −180…180 op. Dat maakt het
 *  voorfilter voor die landen nutteloos, niet verkeerd: er wordt dan gewoon door
 *  de ringen heen gelopen. */
type Extent = { c: WorldCountry; rings: readonly Ring[]; box: [number, number, number, number]; area: number };

const EXTENTS: Extent[] = (() => {
  const out: Extent[] = [];
  for (const c of WORLD_COUNTRIES) {
    if (!c.rings) continue;
    let lonMin = Infinity;
    let latMin = Infinity;
    let lonMax = -Infinity;
    let latMax = -Infinity;
    for (const ring of c.rings) {
      for (const [lon, lat] of ring) {
        if (lon < lonMin) lonMin = lon;
        if (lon > lonMax) lonMax = lon;
        if (lat < latMin) latMin = lat;
        if (lat > latMax) latMax = lat;
      }
    }
    out.push({
      c,
      rings: c.rings,
      box: [lonMin, latMin, lonMax, latMax],
      area: (lonMax - lonMin) * (latMax - latMin),
    });
  }
  /* KLEINSTE EERST, en dat is geen optimalisatie maar het antwoord op de
   * enclaves. Vaticaanstad en San Marino liggen binnen het vlak van Italië en
   * Monaco binnen dat van Frankrijk: hun gaatje in de buurlanden is kleiner dan
   * de drempel waaronder de sweep losse vlakken weglaat (±400 km²), dus die
   * gaten bestaan niet en de vlakken OVERLAPPEN. Gemeten op de gebundelde tabel:
   * de speld van VA, SM en MC ligt in alle drie de gevallen óók binnen het
   * buurland. Wie daar klikt bedoelt de enclave — dus wint het kleinste land.
   *
   * Hetzelfde geldt voor de haarlijn tussen twee buurlanden: elk land is los
   * vereenvoudigd, dus grenzen vallen tot ±0,15° niet exact samen en een klik
   * pal op de grens kan bij beide landen binnen liggen. Dan wint ook het
   * kleinste, en dat is willekeurig maar wél altijd hetzelfde — een klik die de
   * ene keer België en de andere keer Nederland geeft is erger dan een klik die
   * er consequent naast zit.
   *
   * DAT IS EEN KEUZE EN GEEN BUG; NIET REPAREREN. Het ziet er bij het lezen uit
   * als slordigheid ("waarom het kleinste? dat slaat nergens op"), en de twee
   * voor de hand liggende verbeteringen zijn allebei slechter:
   *
   *   - HET DICHTSTBIJZIJNDE MIDDELPUNT PAKKEN. Dan verliest de enclave: het
   *     middelpunt van Italië ligt dichter bij Vaticaanstad dan het middelpunt
   *     van Vaticaanstad bij een klik aan de rand ervan, en San Marino en Monaco
   *     worden onaanklikbaar. De overlap bij de enclaves is groot (het hele
   *     landje); die bij een grens is een haartje. Eén regel moet allebei
   *     bedienen, en "het kleinste wint" is de enige die dat doet.
   *   - DE OVERLAP OPLOSSEN BIJ DE BRON (topologisch vereenvoudigen, gedeelde
   *     grenzen één keer). Dat is de echte oplossing en hij staat als volgende
   *     stap in GEODATA.md. Maar hij haalt de enclave-overlap NIET weg — die
   *     komt van de drempel voor kleine vlakken, niet van het vereenvoudigen —
   *     dus deze regel blijft daarna even hard nodig.
   *
   * Wat er níét onder valt is willekeur bij de UITKOMST: dezelfde klik geeft
   * altijd hetzelfde land, want deze lijst wordt één keer gesorteerd en de
   * volgorde hangt nergens van af. Dat is het enige dat hier beloofd wordt, en
   * het is meer waard dan gelijk hebben op een haartje.
   *
   * Sinds Antarctica erbij staat, is dat meteen het grootste vak in deze lijst:
   * zijn omhullende is de hele wereld onder −63°. Het komt dus als laatste aan
   * de beurt en kan niets overstemmen — precies de bedoeling van "kleinste
   * eerst", nu met een land dat er echt op uitkomt.
   *
   * Lesotho hoeft dit niet: dat is groot genoeg om als gat in Zuid-Afrika te
   * blijven staan, en de even-odd-regel doet daar de rest. */
  return out.sort((a, b) => a.area - b.area);
})();

/** Even-odd: hoeveel keer kruist een straal naar links de ringen van dit land?
 *  Oneven is binnen. Dit MOET dezelfde regel zijn als waarmee getekend wordt
 *  (`WORLD_MAP_FILL_RULE`) en als waarmee de sweep de speld plaatst — anders
 *  klikt de gebruiker op vulling die volgens ons geen land is, of andersom.
 *  Ringen zijn impliciet gesloten, dus het segment van het laatste punt terug
 *  naar het eerste doet mee; dat is bij Egypte precies de woestijngrens. */
function insideRings(rings: readonly Ring[], lon: number, lat: number): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Welk land ligt op dit punt van de bol? `null` betekent "hier is geen land" —
 *  water, of een land dat op deze schaal geen vlak heeft. Dat is een antwoord en
 *  geen fout, en de UI hoort het als zodanig te melden.
 *
 *  De lengtegraad mag buiten −180…180 liggen; bij het slepen loopt hij door en
 *  190° is 170° west. Alleen dán wordt hij teruggerekend: een punt dat al binnen
 *  bereik ligt blijft precies waar het is, want 180 en −180 zijn op de bol
 *  hetzelfde punt maar niet in deze tabel — de bron knipt Rusland en Fiji daar in
 *  twee vlakken, en een klik die van 180 naar −180 wordt verplaatst springt naar
 *  de andere helft.
 *
 *  De breedtegraad wordt NIET geklemd. Een klik buiten de schijf is geen punt op
 *  de bol, en die naar de pool toe schuiven zou een klik verzinnen die niemand
 *  gedaan heeft. */
export function countryAtLonLat(lon: number, lat: number): WorldCountry | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90) return null;
  const x = lon >= -180 && lon <= 180 ? lon : (((lon + 180) % 360) + 360) % 360 - 180;
  for (const e of EXTENTS) {
    if (x < e.box[0] || x > e.box[2] || lat < e.box[1] || lat > e.box[3]) continue;
    if (insideRings(e.rings, x, lat)) return e.c;
  }
  return null;
}

/* --- waar de bol naartoe draait -------------------------------------------- */

/** Waar de bol naartoe moet als iemand een land kiest, en hoe groot dat land is.
 *
 *  `center` en `pin` zijn met opzet twee dingen. `pin` ligt IN het land — daar
 *  hoort een bolletje of een label. `center` is het midden van de omhullende van
 *  het grootste vlak: dat is waar je naartoe draait, want dan staat het hele land
 *  in het midden van de schijf in plaats van een punt dat binnen het land ergens
 *  uit het midden ligt. Bij een holle vorm liggen ze ver uit elkaar: het midden
 *  van de omhullende van Kroatië ligt in Bosnië. Voor draaien is dat goed (heel
 *  Kroatië komt in beeld), voor een speld zou het fout zijn — vandaar twee
 *  velden en niet één compromis. */
export type CountryFocus = {
  /** [lengtegraad, breedtegraad]. */
  center: LonLat;
  /** Hoe breed en hoog het grootste vlak is, in graden. `null` bij een land
   *  zonder vlak: dan weten we wáár het ligt en niet hoe groot het is, en 0 zou
   *  beweren dat het geen omvang heeft. Singapore is [0,35, 0,18] — op een bol
   *  van 640 px ruim één pixel, dus dit is het getal waarop de component mag
   *  besluiten een punt te tekenen in plaats van een vlak. */
  span: readonly [number, number] | null;
  /** Waar `center` uit komt: de omhullende van het grootste vlak, of het
   *  labelpunt van een land dat wij niet tekenen. Het verschil hoort de UI te
   *  kunnen zien — naar een labelpunt draaien laat een bol zien met niets erop,
   *  en dan hoort er te staan dat wij dit land niet tekenen. */
  from: "bbox" | "pin";
};

/** Het middelpunt van een land in graden, of `null` als wij niet weten waar het
 *  ligt. Die null is geen [0, 0]: dat is een plek in de Golf van Guinee, en een
 *  bol die daarheen draait beweert dat Bonaire in de Atlantische Oceaan ligt.
 *  Acht van de 249 landen hebben noch een vlak noch een labelpunt; die hóren hier
 *  niets terug te krijgen, zodat de UI kan zeggen dat de bol niet weet waar het
 *  is in plaats van ergens heen te draaien. */
export function countryFocus(id: string): CountryFocus | null {
  const c = countryById(id);
  if (!c) return null;
  if (c.bbox) {
    const [lonMin, latMin, lonMax, latMax] = c.bbox;
    /* Het gemiddelde van de twee grenzen mag hier zonder omweg, omdat geen enkel
     * vlak de datumgrens oversteekt: de bron knipt daar op ±180 en `bbox` is van
     * één vlak. Was dat niet zo, dan zou dit gemiddelde bij Fiji op 0° uitkomen —
     * in de Golf van Guinee, weer.
     *
     * ANTARCTICA IS DE ENE UITZONDERING, en hij bewijst de regel niet, hij past
     * er toevallig in. Zijn vlak loopt wél van −180 tot 180, want het is een kap
     * om de pool en niet een vlak dat in tweeën is geknipt. Het gemiddelde is dus
     * 0° — en dat is hier geen Golf van Guinee maar Koningin Maudland, midden op
     * het continent. Nagemeten op de gebundelde tabel: draaien naar [0, −76,6]
     * zet Antarctica in het midden van de schijf. */
    return {
      center: [Math.round((lonMin + lonMax) * 50) / 100, Math.round((latMin + latMax) * 50) / 100],
      span: [Math.round((lonMax - lonMin) * 100) / 100, Math.round((latMax - latMin) * 100) / 100],
      from: "bbox",
    };
  }
  if (c.pin) return { center: c.pin, span: null, from: "pin" };
  return null;
}
