/**
 * Bundel de wereldkaart en de valuta per land — tijdens een sweep, nooit tijdens runtime.
 *
 *   pnpm exec tsx scripts/bundle-world-map.ts
 *   pnpm exec tsx scripts/bundle-world-map.ts --dry            # rapporteer, schrijf niets
 *   pnpm exec tsx scripts/bundle-world-map.ts --eps 0.5        # grover vereenvoudigen (kleiner bestand)
 *
 * WAAROM DIT BUITEN DE APP LOOPT. Dezelfde reden als de banklogo's
 * (scripts/bundle-bank-logos.ts), één trap erger: een kaarttile vertelt de
 * tileserver niet alleen DAT je een kaart bekijkt maar ook WAAR je naar kijkt,
 * en in de Valuta-tab is dat "waar ga ik heen en hoeveel geld neem ik mee".
 * Dus: hier ophalen, hier projecteren, als tekst in de bundel. In de browser
 * bestaat het verzoek niet. De uitvoer wordt gecommit en elke wijziging is een
 * leesbare git-diff.
 *
 * WAAROM HIER NIET MEER GEPROJECTEERD WORDT. Dat deed dit script wel: het rekende
 * elk punt om naar een equirectangular doek van 1000×500 en schreef SVG-paden
 * weg. Die paden zijn onbruikbaar geworden en dat is geen smaakkwestie. De kaart
 * is een DRAAIBARE BOL geworden, en een bol projecteert per frame anders — de
 * stand van de bol zit in de projectie. Een punt dat één keer is platgeslagen
 * kun je niet meer op een bol terugzetten, want de omkering is alleen exact als
 * je weet welke projectie erop zat, en dan nog kost het per frame hetzelfde
 * rekenwerk als het ruwe punt projecteren. Dus schrijft dit script nu RUWE
 * lengte- en breedtegraden weg en projecteert de component per frame.
 *
 * Wat we daarmee opgeven: de browser rekent nu wél per frame. Wat we ervoor
 * terugkrijgen: het is de enige vorm waarin een bol kan bestaan. De bundel blijft
 * even klein, want een afgeronde graad is niet langer dan een afgeronde pixel.
 *
 * WAAROM 50m EN NIET 110m. De opdracht noemt ne_110m; die is geprobeerd en
 * werkt (176 landen), maar hij KENT Singapore, Malta, Monaco en Bahrein niet —
 * die zijn op die schaal weggegeneraliseerd. Een land dat je niet kunt
 * aanklikken is voor deze tab een land dat niet bestaat, en Singapore is nu
 * precies een bestemming waar iemand geld voor wisselt. 50m geeft 236 landen en
 * past na vereenvoudiging ruim onder de 250 kB, dus die wint. 110m blijft in de
 * ketting staan als terugval, en de world-atlas-TopoJSON daaronder.
 *
 * WAT ER BEWUST AF GAAT (en in GEODATA.md komt te staan):
 *  - Antarctica. Er is geen valuta (CLDR: XXX, geen wettig betaalmiddel), en op
 *    de platte kaart beslaat het de hele onderrand. OP EEN BOL IS DAT EEN ANDERE
 *    AFWEGING: je kunt naar de zuidpool draaien en dan is daar niets — geen land,
 *    geen ijs, alleen de kleur van de oceaan. Op de kaart was het een afgesneden
 *    strook onderin, op de bol is het een gat waar je naartoe kunt draaien. Dit
 *    script laat het er nog steeds uit, maar dat is nu een keuze die de eigenaar
 *    hoort te maken; hij staat als open punt in GEODATA.md met de kosten erbij.
 *  - Eilandjes onder MIN_AREA. NOOIT het grootste vlak van een land: dan zou
 *    Malta van de kaart vallen omdat Malta klein is, en dat is geen kaart maar
 *    een mening.
 *
 * WAT HET NOOIT DOET. Een valuta invullen die de bron niet geeft, of een land
 * waarvan wij de koers niet kennen laten doorgaan voor "0%" of "gratis". Een
 * valuta buiten de ECB-lijst krijgt `priceable: false` NAAST de code, zodat de
 * UI "dit kunnen we niet prijzen" kan zeggen in plaats van een nul te tonen die
 * niemand heeft gemeten. Lukt de ECB-lijst niet, dan schrijft dit script niets:
 * dan zou elk land `priceable: false` krijgen en dat is een bewering over de
 * wereld op grond van onze eigen storing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
/* De ISO-lijst en de Nederlandse namen komen uit de app zelf, niet uit een
 * tweede tabel hier: countries.ts is al de plek waar is besloten dat de namen
 * van het platform komen (Intl/CLDR) en niet met de hand worden bijgehouden.
 * Twee lijsten zouden onvermijdelijk uit elkaar lopen — dan staat er een land
 * in de landkiezer dat niet op de kaart staat, of andersom. */
import { COUNTRY_CODES, countryName } from "../apps/web/src/countries.js";

const ASSETS = "apps/web/src/assets";
const OUT_TS = `${ASSETS}/world-map.generated.ts`;
const OUT_NOTICE = `${ASSETS}/GEODATA.md`;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const TIMEOUT_MS = 60_000;

/** Alles hieronder rekent in GRADEN. De oude doekeenheid (1000×500 voor de hele
 *  wereld) was precies 0,36° in beide richtingen; die factor staat er per
 *  drempel bij, zodat te zien is dat deze omzetting de kaart niet stilletjes
 *  grover of fijner heeft gemaakt dan hij was. */

/** Waarop de ringen worden afgerond. 0,1° is op de evenaar ±11 km. Op een bol
 *  van 640 px (dus 3,6 px per graad in het midden van de schijf) is dat 0,4 px,
 *  en naar de rand van de schijf toe knijpt de projectie horizontaal dicht —
 *  nooit open. Sub-pixel in het midden is dus sub-pixel overal.
 *  Dit is GROVER dan wat er stond: 0,1 doekeenheid was 0,036°. Dat verschil
 *  kostte bytes voor detail dat op geen enkele schermgrootte te zien was. Kleine
 *  landen die op dit raster in één cel vallen krijgen hieronder een fijner
 *  raster, per land, want een land wegronden is regel één overtreden. */
const RING_DECIMALS = 1;

/** Douglas-Peucker in graden. De oude drempel van 0,4 doekeenheid was 0,144°;
 *  0,15° is daar praktisch gelijk aan. Zoomt de component ver in, dan wordt de
 *  kustlijn hoekig; dat is de prijs en hij staat in GEODATA.md. */
const DEFAULT_EPS = 0.15;

/** Minimale oppervlakte van een los vlak, in graden². 0,0324 is exact de oude
 *  0,25 doekeenheid² (0,25 × 0,36²) — bewust exact, zodat deze omzetting geen
 *  andere eilanden weggooit dan de kaart die er lag. Op de evenaar is dat ±400
 *  km²: Corsica (8.700 km²) blijft, Ibiza (571 km²) valt af, Texel valt af.
 *
 *  Een graad² krimpt met cos(breedte), dus bij 75° NB is deze drempel nog maar
 *  ±100 km² en blijven daar kleinere eilanden staan. Op de platte kaart was dat
 *  een gelukje van de projectie; op de bol is het precies goed en daarom blijft
 *  het zo: je kunt recht op de noordpool kijken, en dan wil je de Canadese
 *  archipel zien staan in plaats van open water.
 *
 *  Het GROOTSTE vlak van een land valt hier nooit onder: anders verdwijnt een
 *  klein land in zijn geheel en dat is regel één. */
const MIN_AREA = 0.0324;

/** Het langste rechte stuk in graden, gemeten als hoekafstand. Dit is nieuw en
 *  het is puur een BOL-probleem.
 *
 *  Een lijn tussen twee geprojecteerde punten is een rechte op het SCHERM. Op een
 *  bol is dat de projectie van de koorde dwars door de bol, niet van de grens
 *  over het oppervlak. Op een platte kaart vallen die twee samen; op een bol
 *  niet, en Douglas-Peucker maakt het erger omdat het juist de lange rechte
 *  stukken tot twee punten terugbrengt.
 *
 *  Gemeten aan de twee ergste gevallen: de grens VS/Canada volgt de 49e
 *  breedtegraad 28° lang en houdt na vereenvoudigen twee punten over; de koorde
 *  daartussen wijkt 0,86° van die breedtegraad af (±95 km, op een bol van 640 px
 *  ruim 3 px zichtbaar door Canada heen). En een meridiaanstuk van 30° is wél een
 *  grootcirkel, maar de koorde snijdt de boog met een pijlhoogte van 0,034×R —
 *  op een bol van 320 px straal 11 px.
 *
 *  Dus: stukken langer dan 5° worden opgedeeld. Bij 5° is de pijlhoogte
 *  0,001×R (een derde pixel) en de afwijking van een breedtegraad 0,03°. Het
 *  opdelen gebeurt LINEAIR in lengte/breedte en niet over de grootcirkel, want
 *  zo zijn die grenzen ook gedefinieerd: de 49e breedtegraad VOLGT de
 *  breedtegraad, hij is geen grootcirkel. Interpoleren over de grootcirkel zou
 *  de grens 0,86° verkeerd neerzetten in plaats van goed. */
const MAX_SEG = 5;

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const eps = args.includes("--eps") ? Number(args[args.indexOf("--eps") + 1]) : DEFAULT_EPS;
if (!Number.isFinite(eps) || eps < 0) {
  console.error(`--eps moet een getal ≥ 0 zijn, kreeg: ${args[args.indexOf("--eps") + 1]}`);
  process.exit(1);
}

/* Kosovo heeft geen door ISO toegewezen code — XK is de gebruikerscode die de
 * EU, CLDR en Natural Earth alle drie gebruiken. Het staat dus niet in
 * COUNTRY_CODES (die lijst is expliciet "de 249 officieel toegewezen"), maar
 * het ligt wel op de kaart en er wordt in euro's betaald. Weglaten zou een gat
 * in de Balkan opleveren dat op niets klikt. */
const EXTRA_CODES = ["XK"];
/* Antarctica: wel een ISO-code, geen valuta, en het beslaat de hele onderrand. */
const DROP_CODES = new Set(["AQ"]);

/** Wat er per bron is geprobeerd, in volgorde. Ook de bronnen die niet meer
 *  nodig waren staan erin: "we hebben hem niet geprobeerd" is iets anders dan
 *  "hij deed het niet", en dat verschil hoort in GEODATA.md te staan en niet in
 *  het hoofd van degene die de sweep draaide. */
type Attempt = { url: string; ok: boolean | null; note: string };
const attempts: Attempt[] = [];

async function get(url: string): Promise<{ res: Response; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json,*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return { res, text: await res.text() };
  } catch {
    return null;
  }
}

/* --- 1. de grenzen --------------------------------------------------------- */

type Lonlat = [number, number];
/** Eén vlak: buitenring eerst, daarna eventuele gaten (Lesotho in Zuid-Afrika,
 *  Vaticaanstad in Italië). Gaten moeten mee, anders vult het gat zich met het
 *  omringende land en klikt Lesotho op Zuid-Afrika. */
type Polygon = Lonlat[][];
type GeoCountry = { code: string; name: string; polygons: Polygon[] };
type Geometry = { countries: GeoCountry[]; source: string; license: string; note: string; noIso: string[] };

const NE_LICENSE = "publiek domein (Natural Earth — geen bronvermelding vereist, wel gegeven)";

/** Natural Earth zet "-99" waar het geen ISO-code heeft (Noord-Cyprus,
 *  Somaliland, de Siachen-gletsjer). ISO_A2_EH is dezelfde kolom met de
 *  de-facto codes ingevuld voor Frankrijk, Noorwegen en Kosovo. Een land zonder
 *  code kan geen valuta krijgen, dus die gaan eruit — met naam en al in
 *  GEODATA.md, want stil weglaten is het probleem dat dit bestand vermijdt. */
function fromNaturalEarth(raw: string, url: string): Geometry {
  const fc = JSON.parse(raw) as {
    features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }[];
  };
  const byCode = new Map<string, GeoCountry>();
  const noIso: string[] = [];
  for (const f of fc.features) {
    const p = f.properties;
    const code = String(p.ISO_A2_EH ?? p.ISO_A2 ?? "-99").toUpperCase();
    const name = String(p.ADMIN ?? p.NAME ?? code);
    if (!/^[A-Z]{2}$/.test(code)) {
      noIso.push(name);
      continue;
    }
    if (!f.geometry) continue;
    const polys =
      f.geometry.type === "MultiPolygon"
        ? (f.geometry.coordinates as Polygon[])
        : f.geometry.type === "Polygon"
          ? [f.geometry.coordinates as Polygon]
          : [];
    const cur = byCode.get(code) ?? { code, name, polygons: [] };
    cur.polygons.push(...polys);
    byCode.set(code, cur);
  }
  return {
    countries: [...byCode.values()],
    source: url,
    license: NE_LICENSE,
    note: `${fc.features.length} vlakken, ${byCode.size} landen met een ISO-code`,
    noIso,
  };
}

/** Terugval: world-atlas' TopoJSON. Kleiner (arcs worden gedeeld) maar de
 *  landen zijn genummerd met ISO 3166-1 numeric, dus er is een tweede bron
 *  nodig om er alpha-2 van te maken — CLDR's codeMappings, dezelfde stal als de
 *  valutatabel hieronder. Deze tak draait alleen als Natural Earth onbereikbaar
 *  is; hij staat er omdat een sweep die op één host leunt geen sweep is. */
function fromTopoJson(raw: string, url: string, numericToAlpha2: Map<string, string>): Geometry {
  const topo = JSON.parse(raw) as {
    transform?: { scale: [number, number]; translate: [number, number] };
    arcs: [number, number][][];
    objects: Record<string, { geometries: { type: string; id?: string; arcs: unknown; properties?: { name?: string } }[] }>;
  };
  const t = topo.transform;
  const arcs: Lonlat[][] = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return (t ? [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]] : [x, y]) as Lonlat;
    });
  });
  /** Een negatieve index betekent: die arc, achterstevoren. Het eerste punt van
   *  een volgende arc is het laatste van de vorige, dus dat valt weg. */
  const ring = (idx: number[]): Lonlat[] => {
    const out: Lonlat[] = [];
    for (const i of idx) {
      const a = i < 0 ? [...arcs[~i]].reverse() : arcs[i];
      out.push(...(out.length ? a.slice(1) : a));
    }
    return out;
  };
  const obj = topo.objects.countries ?? Object.values(topo.objects)[0];
  const byCode = new Map<string, GeoCountry>();
  const noIso: string[] = [];
  for (const g of obj.geometries) {
    const code = numericToAlpha2.get(String(g.id ?? "").padStart(3, "0")) ?? "";
    const name = g.properties?.name ?? code;
    if (!/^[A-Z]{2}$/.test(code)) {
      noIso.push(name);
      continue;
    }
    const raw3 = g.arcs as number[][][] | number[][];
    const polys: Polygon[] =
      g.type === "MultiPolygon"
        ? (raw3 as number[][][]).map((poly) => poly.map(ring))
        : g.type === "Polygon"
          ? [(raw3 as number[][]).map(ring)]
          : [];
    const cur = byCode.get(code) ?? { code, name, polygons: [] };
    cur.polygons.push(...polys);
    byCode.set(code, cur);
  }
  return {
    countries: [...byCode.values()],
    source: url,
    license: "publiek domein (Natural Earth, herverpakt als TopoJSON door world-atlas)",
    note: `${obj.geometries.length} vlakken, ${byCode.size} landen met een ISO-code`,
    noIso,
  };
}

/** Labelpunten voor landen die op deze schaal geen eigen vlak hebben. Natural
 *  Earth heeft daar een aparte puntenlaag voor — dezelfde bron, dezelfde
 *  licentie, dus geen vierde partij erbij.
 *
 *  WAAROM DIT ER NU BIJ IS. Op de platte kaart was een land zonder vlak gewoon een
 *  regel in de tabel: je kon er niet op klikken, maar je kon hem in de zoekbalk
 *  vinden en het valuta-antwoord lezen. Op een bol met een zoekveld is dat niet
 *  genoeg: wie "Gibraltar" typt verwacht dat de bol ergens naartoe draait, en
 *  zonder punt kan de bol niets doen. Een punt zonder vlak is dan het eerlijke
 *  midden: we weten waar het ligt, we tekenen het niet.
 *
 *  Dit is OPTIONEEL en mag mislukken. Daarom staat het niet in de ketting van
 *  firstThatWorks(): daar zou een storing de hele sweep stoppen, en dat is te
 *  zwaar voor een handvol spelden. Mislukt het, dan houden die landen `pin: null`
 *  — een leemte die zich als leemte meldt — en staat dat in GEODATA.md.
 *
 *  Alleen Point-geometrie wordt gelezen. De laag bevat ook landen die we wél
 *  tekenen (Malta, Singapore); die worden niet gebruikt, want een punt uit een
 *  labellaag staat waar een NAAM moet passen en niet waar het land ligt. */
async function fetchLabelPoints(): Promise<{ byCountry: Map<string, Lonlat>; url: string; note: string } | null> {
  const url =
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_tiny_countries.geojson";
  const got = await get(url);
  if (!got) {
    attempts.push({ url, ok: false, note: "niet bereikbaar — landen zonder eigen vlak houden pin: null" });
    return null;
  }
  try {
    const fc = JSON.parse(got.text) as {
      features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }[];
    };
    const byCountry = new Map<string, Lonlat>();
    for (const f of fc.features) {
      const code = String(f.properties.ISO_A2_EH ?? f.properties.ISO_A2 ?? "-99").toUpperCase();
      if (!/^[A-Z]{2}$/.test(code) || f.geometry?.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      byCountry.set(code, [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100]);
    }
    if (!byCountry.size) throw new Error("geen enkel punt met een ISO-code");
    const note = `${byCountry.size} labelpunten (alleen gebruikt voor landen zonder eigen vlak)`;
    attempts.push({ url, ok: true, note });
    return { byCountry, url: got.res.url || url, note };
  } catch (e) {
    attempts.push({ url, ok: false, note: `onleesbaar antwoord: ${(e as Error).message}` });
    return null;
  }
}

/* --- 2. valuta per land ---------------------------------------------------- */

type Currencies = { byCountry: Map<string, string[]>; source: string; license: string; note: string };

/** CLDR zegt per land welke valuta wanneer gold. "Nu" is dus een peildatum en
 *  geen aanname: een regel met `_to` in het verleden is geschiedenis (de gulden
 *  staat er nog in), `_tender: false` is geen betaalmiddel maar een rekenmunt
 *  (USN, XDR, goud). Wat overblijft zijn de valuta's waarmee je er vandaag
 *  betaalt — meestal één, soms twee, en die twee blijven allebei staan. */
function fromCldr(raw: string, url: string, asOf: string): Currencies {
  const doc = JSON.parse(raw) as {
    supplemental: { currencyData: { region: Record<string, Record<string, Record<string, string>>[]> } };
  };
  const region = doc.supplemental.currencyData.region;
  const byCountry = new Map<string, string[]>();
  for (const [code, list] of Object.entries(region)) {
    if (!/^[A-Z]{2}$/.test(code)) continue;
    const live: string[] = [];
    for (const entry of list) {
      for (const [ccy, meta] of Object.entries(entry)) {
        if (meta._tender === "false") continue;
        if (meta._to && meta._to.slice(0, 10) <= asOf) continue;
        if (meta._from && meta._from.slice(0, 10) > asOf) continue;
        live.push(ccy);
      }
    }
    if (live.length) byCountry.set(code, live);
  }
  return {
    byCountry,
    source: url,
    license: "Unicode-ICU licentie (CLDR)",
    note: `${byCountry.size} landen met een geldige valuta op ${asOf}`,
  };
}

/** Terugval: de dataset waar restcountries zelf op draait. Ruwer — Zimbabwe
 *  krijgt er negen valuta's, want de lijst kent geen einddatum — dus alleen als
 *  CLDR onbereikbaar is. */
function fromMledoze(raw: string, url: string): Currencies {
  const list = JSON.parse(raw) as { cca2: string; currencies?: Record<string, unknown> }[];
  const byCountry = new Map<string, string[]>();
  for (const c of list) {
    const codes = Object.keys(c.currencies ?? {});
    if (codes.length) byCountry.set(c.cca2.toUpperCase(), codes);
  }
  return {
    byCountry,
    source: url,
    license: "ODbL v1.0 (mledoze/countries)",
    note: `${byCountry.size} landen, zonder einddatum per valuta — grover dan CLDR`,
  };
}

/** restcountries v3.1, de vorm die de opdracht noemt. Hij antwoordt tegenwoordig
 *  met HTTP 200 én een foutmelding in de body — dus de STATUS zegt niets en de
 *  body moet gelezen worden. Dat is precies waarom deze functie gooit in plaats
 *  van een lege map terug te geven: een lege map zou als geldig antwoord het
 *  bestand leegschrijven. */
function fromRestCountries(raw: string, url: string): Currencies {
  const doc = JSON.parse(raw) as unknown;
  if (!Array.isArray(doc)) {
    const err = (doc as { errors?: { message?: string }[] })?.errors?.[0]?.message;
    throw new Error(err ? `de dienst antwoordt met een fout: ${err}` : "geen lijst met landen");
  }
  const byCountry = new Map<string, string[]>();
  for (const c of doc as { cca2?: string; currencies?: Record<string, unknown> }[]) {
    const code = String(c.cca2 ?? "").toUpperCase();
    const codes = Object.keys(c.currencies ?? {});
    if (/^[A-Z]{2}$/.test(code) && codes.length) byCountry.set(code, codes);
  }
  return {
    byCountry,
    source: url,
    license: "Mozilla Public License 2.0 (restcountries)",
    note: `${byCountry.size} landen`,
  };
}

/** ISO 3166-1 numeric → alpha-2. Alleen nodig voor de TopoJSON-terugval, waar de
 *  landen genummerd zijn. Uit CLDR, dezelfde stal als de valutatabel, dus geen
 *  vierde partij erbij. */
async function numericToAlpha2(): Promise<Map<string, string>> {
  const url = "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/codeMappings.json";
  const got = await get(url);
  if (!got) {
    attempts.push({ url, ok: false, note: "niet bereikbaar — zonder deze tabel is de TopoJSON onbruikbaar" });
    return new Map();
  }
  const doc = JSON.parse(got.text) as { supplemental: { codeMappings: Record<string, { _numeric?: string }> } };
  const out = new Map<string, string>();
  for (const [alpha2, m] of Object.entries(doc.supplemental.codeMappings)) {
    if (m._numeric && /^[A-Z]{2}$/.test(alpha2)) out.set(m._numeric.padStart(3, "0"), alpha2);
  }
  attempts.push({ url, ok: true, note: `${out.size} nummers naar landcodes (voor de TopoJSON-terugval)` });
  return out;
}

/* --- 3. wat LaVega kan prijzen --------------------------------------------- */

/** Precies de lijst die de Valuta-tab al gebruikt (apps/server/src/fx.ts haalt
 *  zijn koersen bij dezelfde dienst). Staat een valuta hier niet in, dan hebben
 *  wij geen koers — niet "geen kosten". */
async function fetchPriceable(): Promise<{ codes: string[]; source: string } | null> {
  const url = "https://api.frankfurter.dev/v1/currencies";
  const got = await get(url);
  if (!got) {
    attempts.push({ url, ok: false, note: "niet bereikbaar" });
    return null;
  }
  try {
    const obj = JSON.parse(got.text) as Record<string, string>;
    const codes = Object.keys(obj).filter((c) => /^[A-Z]{3}$/.test(c));
    if (!codes.length) throw new Error("lege lijst");
    attempts.push({ url, ok: true, note: `${codes.length} valuta's (ECB, via Frankfurter)` });
    return { codes, source: got.res.url || url };
  } catch (e) {
    attempts.push({ url, ok: false, note: `onleesbaar antwoord: ${(e as Error).message}` });
    return null;
  }
}

/* --- vereenvoudigen, in graden --------------------------------------------- */

/** Ondertekende oppervlakte maakt niet uit — we gebruiken hem alleen om vlakken
 *  te rangschikken en om te zien of er na afronden nog iets van over is. In
 *  graden², dus niet in km²; zie MIN_AREA voor waarom dat hier goed uitkomt. */
function area(ring: Lonlat[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Douglas-Peucker, iteratief. Recursief is korter maar Rusland heeft ringen van
 *  tienduizenden punten en die legden de stack om in een eerdere versie. */
function simplify(pts: Lonlat[], epsilon: number): Lonlat[] {
  if (epsilon <= 0 || pts.length < 3) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    if (e <= s + 1) continue;
    const [x1, y1] = pts[s];
    const [x2, y2] = pts[e];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const den = Math.hypot(dx, dy);
    let best = -1;
    let bi = -1;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = pts[i];
      const d = den > 0 ? Math.abs(dx * (y1 - y) - (x1 - x) * dy) / den : Math.hypot(x - x1, y - y1);
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > epsilon) {
      keep[bi] = true;
      stack.push([s, bi], [bi, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Afronden op `decimals` en de punten weghalen die daarna op elkaar vallen.
 *  Rekenen gebeurt in hele tienden zodat 0,1 + 0,2 geen 0,30000000000000004
 *  oplevert in een bestand dat een mens moet kunnen lezen.
 *
 *  De klem op ±180 en ±90 is geen sier: de bron levert bij de datumgrens punten
 *  als 180.00000000000003, en dat is voor de bron afrondruis maar voor ons een
 *  coördinaat die niet bestaat. Zo'n punt doorschrijven zou de test die de
 *  grenzen bewaakt laten omvallen op iets wat geen echte fout is, en dat is de
 *  slechtste soort rode test. */
function quantize(pts: Lonlat[], decimals: number): Lonlat[] {
  const f = 10 ** decimals;
  const out: Lonlat[] = [];
  for (const [lon, lat] of pts) {
    const q: Lonlat = [
      Math.min(180, Math.max(-180, Math.round(lon * f) / f)),
      Math.min(90, Math.max(-90, Math.round(lat * f) / f)),
    ];
    const last = out[out.length - 1];
    if (last && last[0] === q[0] && last[1] === q[1]) continue;
    out.push(q);
  }
  // Een GeoJSON-ring herhaalt zijn eerste punt aan het eind. Wij sluiten de ring
  // impliciet (het laatste punt verbindt met het eerste), dus dat punt kan weg —
  // en de consument MOET die aanname kennen; hij staat in de kop van het
  // gegenereerde bestand.
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

const D2R = Math.PI / 180;

/** Hoekafstand tussen twee punten, grof: een graad lengte krimpt met cos van de
 *  breedte, een graad breedte niet. Goed genoeg — het enige waarvoor dit dient is
 *  beslissen in hoeveel stukken een segment moet, en een fout van een paar
 *  procent in die telling is op geen enkel scherm te zien. De haversine erbij
 *  halen zou nauwkeuriger zijn en niets veranderen. */
function span([lon1, lat1]: Lonlat, [lon2, lat2]: Lonlat): number {
  const k = Math.cos(((lat1 + lat2) / 2) * D2R);
  return Math.hypot((lon2 - lon1) * k, lat2 - lat1);
}

/** Lange rechte stukken opdelen. Zie MAX_SEG voor waarom dit op een bol moet en
 *  op een platte kaart niet. De ring is impliciet gesloten, dus het stuk van het
 *  laatste punt terug naar het eerste doet mee — dat is bij Egypte en Libië
 *  precies de kaarsrechte woestijngrens.
 *
 *  De bijgezette punten worden op hetzelfde raster afgerond als de rest; valt er
 *  één op zijn voorganger, dan gaat hij er weer af. Anders zou een fijn
 *  opgedeeld kort stuk dubbele punten opleveren. */
function densify(ring: Lonlat[], maxSeg: number, decimals: number): { ring: Lonlat[]; added: number } {
  const f = 10 ** decimals;
  const r = (n: number): number => Math.round(n * f) / f;
  const out: Lonlat[] = [];
  let added = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push(a);
    const n = Math.ceil(span(a, b) / maxSeg);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const p: Lonlat = [r(a[0] + (b[0] - a[0]) * t), r(a[1] + (b[1] - a[1]) * t)];
      const last = out[out.length - 1];
      if (last[0] === p[0] && last[1] === p[1]) continue;
      out.push(p);
      added++;
    }
  }
  return { ring: out, added };
}

/* --- waar de speld hoort ---------------------------------------------------- */

/** Even-odd: ligt dit punt in de ringen van dit land? Even-odd en niet nonzero,
 *  om dezelfde reden als de vulregel in de UI: het gat van Lesotho in Zuid-Afrika
 *  is een gewone ring in dezelfde lijst, en alleen even-odd maakt daar een gat van
 *  in plaats van vulling. Deze functie en de klikbepaling in worldMap.ts moeten
 *  hetzelfde antwoord geven — anders zet de sweep een speld in een gat waar de
 *  klik van de gebruiker "geen land" zegt. */
function insideRings(rings: Lonlat[][], [x, y]: Lonlat): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i];
      const [xj, yj] = r[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Afstand van een punt tot de dichtstbijzijnde grens, in graden, met de lengte
 *  geschaald op cos(breedte). Zonder die schaling schuift het "verste punt van
 *  de grens" in Rusland en Noorwegen naar het oosten of westen, want daar is een
 *  graad lengte de helft van een graad breedte. */
function distToRings(rings: Lonlat[][], p: Lonlat): number {
  const kx = Math.cos(p[1] * D2R);
  let best = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const ax = (r[j][0] - p[0]) * kx;
      const ay = r[j][1] - p[1];
      const bx = (r[i][0] - p[0]) * kx;
      const by = r[i][1] - p[1];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Het zwaartepunt van een ring. Alleen nog nodig als terugval: zie labelPoint. */
function centroid(ring: Lonlat[]): Lonlat {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (a === 0) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}

/** Waar de speld hoort: het punt in het GROOTSTE vlak dat het verst van elke
 *  grens af ligt.
 *
 *  WAAROM NIET HET MIDDEN VAN DE OMHULLENDE (wat er stond). Dat ligt bij
 *  Noorwegen midden in Zweden en bij Frankrijk — met Frans-Guyana in de
 *  omhullende — op de Atlantische Oceaan. Op een platte kaart met een speld van
 *  drie pixels viel dat niet op. Op een bol waar je naar je keuze toe draait valt
 *  het meteen op: je draait naar Zweden en er staat een bolletje in het niets.
 *
 *  WAAROM OOK NIET HET ZWAARTEPUNT. Beter, maar bij een land met een holle vorm
 *  ligt het zwaartepunt buiten het land: Kroatië krijgt er een speld in Bosnië.
 *
 *  Dus: grof raster over de omhullende van het grootste vlak, alleen de punten
 *  die er echt binnen liggen, en daarvan de verste van de grens. Daarna twee keer
 *  verfijnen rond de winnaar. Exact oplossen kan met een straal-skelet; dit is
 *  een sweep-script en drie rasters × 250 landen is een paar seconden.
 *
 *  ALLE ringen van het land doen mee aan de afstandsmeting, niet alleen de
 *  buitenrand. Anders legt de speld van Zuid-Afrika zich pal naast Lesotho: voor
 *  de afstand is dat gat ook een grens.
 *
 *  Lukt het niet — een land dat na afronden zo dun is dat geen enkel rasterpunt
 *  erbinnen valt — dan geeft dit het zwaartepunt terug MET `inside: false`, zodat
 *  het aantal in GEODATA.md komt te staan in plaats van dat het stil goed lijkt. */
function labelPoint(rings: Lonlat[][], decimals: number): { pin: Lonlat; inside: boolean } {
  const main = rings[0];
  let x0 = Math.min(...main.map((p) => p[0]));
  let x1 = Math.max(...main.map((p) => p[0]));
  let y0 = Math.min(...main.map((p) => p[1]));
  let y1 = Math.max(...main.map((p) => p[1]));
  let best: Lonlat | null = null;
  let bestD = -1;
  for (const steps of [24, 12, 12]) {
    const dx = (x1 - x0) / steps;
    const dy = (y1 - y0) / steps;
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const p: Lonlat = [x0 + i * dx, y0 + j * dy];
        if (!insideRings(rings, p)) continue;
        const d = distToRings(rings, p);
        if (d > bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    if (!best || dx === 0 || dy === 0) break;
    x0 = best[0] - dx;
    x1 = best[0] + dx;
    y0 = best[1] - dy;
    y1 = best[1] + dy;
  }
  /* De speld krijgt twee decimalen meer dan de ringen. Eén punt per land, dus dat
   * kost bytes die je in kilobytes niet terugziet, en het scheelt bij Monaco het
   * verschil tussen "in het land" en "in de Middellandse Zee". Na afronden nog
   * één keer nakijken: de winnaar ligt minstens een halve rastercel van de grens
   * (anders had hij niet gewonnen), dus dit hoort altijd te lukken — maar "hoort"
   * is geen bewijs. */
  const f = 10 ** (decimals + 2);
  const r = (n: number): number => Math.round(n * f) / f;
  if (best) {
    const pin: Lonlat = [r(best[0]), r(best[1])];
    if (insideRings(rings, pin)) return { pin, inside: true };
    return { pin, inside: false };
  }
  const c = centroid(main);
  return { pin: [r(c[0]), r(c[1])], inside: insideRings(rings, c) };
}

/* --- van bron naar ringen --------------------------------------------------- */

type Shape = {
  /** Het grootste vlak eerst. Ringen zijn impliciet gesloten. */
  rings: Lonlat[][];
  /** Van het GROOTSTE vlak, niet van alles — zie toShape. */
  bbox: [number, number, number, number];
  pin: Lonlat;
  pinInside: boolean;
  decimals: number;
  /** Ringen die onder MIN_AREA lagen. */
  dropped: number;
  /** Ringen die groot genoeg waren maar na afronden geen vlak meer waren. Apart
   *  geteld en niet bij `dropped` opgeteld, want het zijn twee verschillende
   *  uitspraken: "te klein om te tellen" en "te klein voor dit raster". Alleen de
   *  tweede is door de verhuizing naar graden veranderd, en dan hoort dat getal
   *  in GEODATA.md te staan in plaats van in een som die niemand kan uitsplitsen. */
  collapsed: number;
  added: number;
};

/** Van de ruwe bron naar de ringen die in de bundel komen.
 *
 *  De volgorde is: vereenvoudigen → afronden → controleren → lange stukken
 *  opdelen. Andersom afronden vóór het vereenvoudigen scheelt niets en levert
 *  kartelranden op, en opdelen vóór het vereenvoudigen zou Douglas-Peucker de
 *  bijgezette punten meteen weer weghalen.
 *
 *  DE UITZONDERING OP "1 DECIMAAL". Monaco is 0,02° breed: op één decimaal valt
 *  het hele land in één rastercel en houdt het nul punten over. Dan is de keuze
 *  "geen Monaco" of "meer decimalen voor dit ene land", en de eerste is regel één
 *  overtreden. Dus: 1 decimaal, en alleen als het grootste vlak dan niet
 *  overeind blijft fijner, tot het blijft staan. Dat kost bytes bij precies de
 *  landen die bijna geen bytes zijn.
 *
 *  Let op dat het niet alleen om decimalen gaat: bij een land van een halve graad
 *  haalt Douglas-Peucker met eps 0,15 de hele omtrek weg en houd je twee punten
 *  over, hoe fijn je daarna ook afrondt. Dus gaan eps én afronding samen omlaag.
 *
 *  DE OMHULLENDE IS VAN HET GROOTSTE VLAK EN NIET VAN ALLES. Dat is nieuw en het
 *  is de datumgrens: de bron knipt Rusland, Fiji en de Aleoeten op ±180° in twee
 *  stukken, dus de omhullende van álle ringen van Rusland is −180…180 — de hele
 *  wereld, en dus nutteloos om een bol naar Rusland toe te draaien. De omhullende
 *  van het grootste vlak is Siberië, en dat is wat iemand bedoelt. */
function toShape(polygons: Polygon[], epsilon: number): Shape | null {
  /* Sorteren op de oppervlakte van de buitenring. Er wordt NIETS geprojecteerd:
   * dat is de hele verandering ten opzichte van de platte kaart. */
  const sorted = polygons.filter((poly) => poly.length > 0).sort((a, b) => area(b[0]) - area(a[0]));
  if (!sorted.length) return null;

  const passes: { eps: number; decimals: number }[] = [
    { eps: epsilon, decimals: RING_DECIMALS },
    { eps: epsilon / 4, decimals: RING_DECIMALS + 1 },
    { eps: epsilon / 20, decimals: RING_DECIMALS + 2 },
    { eps: 0, decimals: RING_DECIMALS + 2 },
  ];
  for (const pass of passes) {
    const rings: Lonlat[][] = [];
    let dropped = 0;
    let collapsed = 0;
    let added = 0;
    let main: Lonlat[] | null = null;
    for (const [pi, poly] of sorted.entries()) {
      for (const [ri, ring] of poly.entries()) {
        // Het grootste vlak van een land blijft altijd; al het andere (los eiland
        // óf gat) moet groot genoeg zijn om op deze schaal iets te betekenen.
        const biggest = pi === 0 && ri === 0;
        if (!biggest && area(ring) < MIN_AREA) {
          dropped++;
          continue;
        }
        const q = quantize(simplify(ring, pass.eps), pass.decimals);
        /* Drie punten is de ondergrens van "een vlak", maar niet van "nog steeds
         * dit land". Singapore is 0,35° breed: op 0,1° past het in een handvol
         * rastercellen en houdt het drie punten over die toevallig geen driehoek
         * met oppervlakte nul zijn. Dat vlak overleeft de puntentelling en is
         * toch weg. Vandaar de tweede eis voor het grootste vlak: de helft van de
         * oorspronkelijke oppervlakte moet er nog zijn. Grote landen halen dat met
         * 99,9%, dus dit raakt alleen de landen waarom het gaat. */
        if (q.length < 3 || (biggest && area(q) < 0.5 * area(ring))) {
          collapsed++;
          continue;
        }
        const d = densify(q, MAX_SEG, pass.decimals);
        added += d.added;
        if (biggest) main = d.ring;
        rings.push(d.ring);
      }
    }
    if (!main) continue;
    const m: Lonlat[] = main;
    const { pin, inside } = labelPoint(rings, pass.decimals);
    return {
      rings,
      bbox: [
        Math.min(...m.map((p) => p[0])),
        Math.min(...m.map((p) => p[1])),
        Math.max(...m.map((p) => p[0])),
        Math.max(...m.map((p) => p[1])),
      ],
      pin,
      pinInside: inside,
      decimals: pass.decimals,
      dropped,
      collapsed,
      added,
    };
  }
  return null;
}

/* --- schrijven -------------------------------------------------------------- */

type Row = {
  id: string;
  name: string;
  nameEn: string;
  shape: Shape | null;
  /** Voor de landen die op deze schaal geen eigen vlak hebben: een labelpunt uit
   *  de puntenlaag van Natural Earth, zodat de bol er tenminste naartoe kan
   *  draaien. Zie labelOnly in main(). */
  labelOnly: Lonlat | null;
  currencies: { code: string; priceable: boolean }[];
};

type Sources = {
  geometry: { url: string; license: string; note: string };
  labelPoints: { url: string; note: string } | null;
  currencies: { url: string; license: string; note: string };
  priceable: { url: string };
  fetchedAt: string;
};

/** Eén ring als regel tekst. `[5.4,52.2],[5.5,52.3]` — geen ruimte tussen de
 *  paren, want dat is per punt één byte en er zijn er duizenden. Wel elke ring op
 *  zijn eigen regel: dan is een gewijzigde kustlijn in een git-diff één regel en
 *  niet het hele land. */
const ringText = (r: Lonlat[]): string => `[${r.map(([lon, lat]) => `[${lon},${lat}]`).join(",")}]`;

function tsFile(
  rows: Row[],
  sources: Sources,
  bounds: [number, number, number, number],
  points: number,
): string {
  const body = rows
    .map((r) => {
      const cur = r.currencies.map((c) => `{ code: ${JSON.stringify(c.code)}, priceable: ${c.priceable} }`).join(", ");
      const geom = r.shape
        ? `    bbox: [${r.shape.bbox.join(", ")}],\n` +
          `    pin: [${r.shape.pin.join(", ")}],\n` +
          `    rings: [\n${r.shape.rings.map((ring) => `      ${ringText(ring)},`).join("\n")}\n    ],\n`
        : `    bbox: null,\n` +
          `    pin: ${r.labelOnly ? `[${r.labelOnly.join(", ")}]` : "null"},\n` +
          `    rings: null,\n`;
      return (
        `  {\n` +
        `    id: ${JSON.stringify(r.id)},\n` +
        `    name: ${JSON.stringify(r.name)},\n` +
        `    nameEn: ${JSON.stringify(r.nameEn)},\n` +
        `    currencies: [${cur}],\n` +
        geom +
        `  },`
      );
    })
    .join("\n");

  return `/* GEGENEREERD door scripts/bundle-world-map.ts — niet met de hand aanpassen.
 *
 * De grenzen zijn tijdens een SWEEP opgehaald en hier als tekst neergelegd. In de
 * browser wordt er niets opgehaald: een tile-request zou die server vertellen naar
 * welk land de gebruiker kijkt, en in de Valuta-tab is dat "waar ga ik heen".
 *
 * Herkomst, licenties en wat er is weggelaten: GEODATA.md in deze map.
 *
 * DIT ZIJN RUWE GRADEN, GEEN PADEN. Hier stonden SVG-paden in een viewBox van
 * 1000×500. Die zijn eruit en niet ernaast blijven staan: de kaart is een
 * draaibare bol, een bol projecteert per frame anders, en een punt dat één keer
 * is platgeslagen kun je niet terugzetten. Twee vormen bewaren zou het bestand
 * verdubbelen voor data die niemand meer tekent.
 *
 * HOE JE DIT TEKENT.
 *  - Elk punt is [lengtegraad, breedtegraad] in graden. De component projecteert
 *    per frame, met de stand van de bol erin. ${points} punten in totaal — dat is
 *    per frame te doen, maar niet als je er per punt een array uit leest: één keer
 *    bij het laden platslaan naar getallenreeksen is de uitweg als het schokt.
 *  - \`rings\` is een PLATTE lijst ringen, het grootste vlak eerst. Buitenranden,
 *    losse eilanden en gaten staan door elkaar en zijn niet gelabeld — dat hoeft
 *    ook niet, want met de even-odd-regel komt het er hetzelfde uit: een gat
 *    binnen een buitenrand telt als tweede kruising en wordt dus leeg.
 *  - Een ring is IMPLICIET GESLOTEN. Het laatste punt verbindt met het eerste; dat
 *    punt staat er niet nog een tweede keer bij.
 *  - fill-rule="evenodd" is VERPLICHT. Landen met een gat (Lesotho in
 *    Zuid-Afrika, Vaticaanstad in Italië) hebben dat gat als gewone ring in
 *    dezelfde lijst; met de standaard nonzero-regel vult het zich en klikt
 *    Lesotho op Zuid-Afrika. Dezelfde regel geldt voor het BEPALEN WAAR IEMAND
 *    KLIKT — zie \`countryAtLonLat()\` in worldMap.ts, die telt kruisingen over
 *    alle ringen en is daarmee dezelfde regel in code.
 *  - Teken elk land met een STROKE in dezelfde kleur als de vulling (±0,1°). Elk
 *    land is los vereenvoudigd, dus twee buurlanden hebben niet meer exact
 *    dezelfde grenspunten en er blijft een haarlijn tussen staan. Datzelfde geldt
 *    bij de datumgrens: de bron knipt Rusland, Fiji en de Aleoeten op ±180° in
 *    twee vlakken. Op een bol sluiten die twee helften weer tegen elkaar aan, dus
 *    er is niets te herstellen — maar er loopt wel een rand langs de meridiaan,
 *    en die is alleen onzichtbaar als de stroke de kleur van de vulling heeft.
 *  - WAT ACHTER DE BOL ZIT MOET WEG. Een ring waarvan élk punt aan de achterkant
 *    ligt kun je overslaan. Een ring die half achter de bol zit moet je AFKAPPEN
 *    op de rand van de schijf; alleen de punten aan de achterkant weglaten en de
 *    rest verbinden trekt een rechte lijn dwars over de bol, en dan lijkt Rusland
 *    bij het draaien in te klappen.
 *  - Lange rechte stukken zijn al opgedeeld (maximaal 5° per stuk), zodat de
 *    kaarsrechte grenzen van Egypte en de 49e breedtegraad tussen de VS en Canada
 *    niet als koorde door de bol snijden. Deel ze niet nog een keer op.
 *
 * \`rings: null\` betekent: dit land heeft op deze schaal geen eigen vlak in de
 * bron (Gibraltar, de Franse overzeese departementen). Dat is GEEN uitspraak over
 * het land en al helemaal niet over zijn valuta — die staat er gewoon bij. Een
 * deel van die landen heeft wél een \`pin\`, uit de puntenlaag van dezelfde bron:
 * dan weten we waar het ligt en tekenen we het niet, en kan de bol er nog steeds
 * naartoe draaien. Is ook de pin \`null\`, dan weten we het niet — en dat is geen
 * [0, 0], want dat is een plek in de Golf van Guinee.
 *
 * \`bbox\` en \`pin\` horen bij \`rings[0]\`, het grootste vlak, en niet bij alles bij
 * elkaar. Bij de datumgrens is dat het verschil tussen "Siberië" en "de hele
 * wereld": de omhullende van álle ringen van Rusland loopt van −180° tot 180°.
 *
 * \`priceable\` staat NAAST de valutacode en niet naast het land, omdat een land
 * met twee valuta's er één kan hebben die wij wel kennen en één die wij niet
 * kennen (Panama: USD wel, PAB niet). \`false\` betekent "wij hebben geen koers",
 * nooit "geen kosten".
 */

/** [lengtegraad, breedtegraad] — in die volgorde, zoals GeoJSON. Andersom is de
 *  klassieke fout: [52.2, 5.7] legt Nederland in de Indische Oceaan. */
export type LonLat = readonly [number, number];

/** Eén gesloten ring. Het laatste punt verbindt met het eerste; dat punt staat er
 *  niet nog een keer bij. */
export type Ring = readonly LonLat[];

export type WorldCurrency = {
  /** ISO 4217. */
  code: string;
  /** Staat deze valuta in de ECB-lijst die de Valuta-tab gebruikt? */
  priceable: boolean;
};

export type WorldCountry = {
  /** ISO 3166-1 alpha-2 (plus XK voor Kosovo — zie GEODATA.md). */
  id: string;
  /** Nederlands, van het platform (Intl/CLDR) op de dag van de sweep. */
  name: string;
  /** Zoals de geometriebron het land noemt — voor zoeken en voor herkomst. */
  nameEn: string;
  /** Waarmee je er vandaag betaalt. Meer dan één is geen fout: dan is het aan de
   *  gebruiker, niet aan ons. */
  currencies: WorldCurrency[];
  /** Ruwe ringen in graden, het grootste vlak eerst, of null als de bron op deze
   *  schaal geen vlak voor dit land heeft. Nooit een lege lijst: leeg zou
   *  "getekend, maar nergens" betekenen. */
  rings: readonly Ring[] | null;
  /** [lonMin, latMin, lonMax, latMax] van rings[0]. */
  bbox: readonly [number, number, number, number] | null;
  /** Het punt in rings[0] dat het verst van elke grens ligt — daar hoort een speld
   *  of een label, en daar draait de bol naartoe. Bij een land zonder vlak is dit
   *  een labelpunt uit de puntenlaag, of null als ook die het niet heeft. */
  pin: LonLat | null;
};

/** De omhullende van alles wat er echt getekend wordt, in graden.
 *  [lonMin, latMin, lonMax, latMax]. De onderkant is niet −90: Antarctica is
 *  weggelaten, dus wie naar de zuidpool draait ziet water. Zie GEODATA.md. */
export const WORLD_LATLON_BOUNDS: readonly [number, number, number, number] = [${bounds.join(", ")}];

/** Zonder dit vullen de gaten zich. Zie de kop van dit bestand. */
export const WORLD_MAP_FILL_RULE = "evenodd" as const;

/** Waar dit vandaan komt. Meegegenereerd zodat een scherm de bron kan noemen
 *  zonder dat iemand hem uit een markdown-bestand overtypt. */
export const WORLD_MAP_SOURCES = {
  fetchedAt: ${JSON.stringify(sources.fetchedAt)},
  geometry: { url: ${JSON.stringify(sources.geometry.url)}, license: ${JSON.stringify(sources.geometry.license)} },
  currencies: { url: ${JSON.stringify(sources.currencies.url)}, license: ${JSON.stringify(sources.currencies.license)} },
  priceable: { url: ${JSON.stringify(sources.priceable.url)} },
} as const;

export const WORLD_COUNTRIES: WorldCountry[] = [
${body}
];
`;
}

function noticeFile(
  rows: Row[],
  sources: Sources,
  bounds: [number, number, number, number],
  stats: {
    drawn: number;
    noShape: Row[];
    pinnedOnly: Row[];
    droppedIslands: number;
    collapsedIslands: number;
    addedPoints: number;
    points: number;
    rings: number;
    finer: Row[];
    pinOutside: Row[];
    noIso: string[];
    bytes: number;
    priceableCount: number;
  },
): string {
  const table = attempts
    .map((a) => `| ${a.ok === null ? "niet geprobeerd" : a.ok ? "gelukt" : "mislukt"} | ${a.url} | ${a.note} |`)
    .join("\n");
  const finerByDecimals = new Map<number, string[]>();
  for (const r of stats.finer) {
    const d = r.shape?.decimals ?? RING_DECIMALS;
    finerByDecimals.set(d, [...(finerByDecimals.get(d) ?? []), r.id]);
  }
  const finerText = [...finerByDecimals.entries()]
    .sort(([a], [b]) => a - b)
    .map(([d, ids]) => `${ids.length} op ${d} decimalen (${ids.join(", ")})`)
    .join("; ");
  const multi = rows.filter((r) => r.currencies.length > 1);
  const list = (rs: Row[]): string => (rs.length ? rs.map((r) => `${r.name} (${r.id})`).join(", ") : "geen");
  /* Nederlandse komma. Anders staat er "0.15° (was 0,144°)" in één tabelregel en
   * dat leest als een typefout in plaats van als hetzelfde getal. */
  const nl = (n: number): string => String(n).replace(".", ",");
  return `# Kaartgegevens en valuta per land

_Gegenereerd door \`scripts/bundle-world-map.ts\` op ${sources.fetchedAt}. Niet met de hand aanpassen._

De wereldbol in de Valuta-tab wordt **tijdens de sweep opgehaald en
meegebundeld**, net als de banklogo's (zie \`TRADEMARKS.md\`). In de browser wordt
er niets opgehaald: een tile-request zou de tileserver vertellen naar welk land de
gebruiker kijkt, en in deze tab is dat "waar ga ik heen en hoeveel geld neem ik
mee". Het gegenereerde bestand is \`world-map.generated.ts\` (${Math.round(stats.bytes / 1024)} kB,
${stats.points} punten in ${stats.rings} ringen).

## Van platte kaart naar bol

Hier stonden **geprojecteerde SVG-paden** in een viewBox van 1000×500
(equirectangular). Die zijn eruit en er staat nu per land een lijst **ruwe ringen
in graden**: \`[lengtegraad, breedtegraad]\`, afgerond op ${RING_DECIMALS} decimaal.

De reden is niet smaak. Een bol projecteert **per frame anders** — de stand van de
bol zit in de projectie. Een punt dat één keer is platgeslagen kun je niet
terugzetten: de omkering is alleen exact als je weet welke projectie erop zat, en
dan kost hij per frame hetzelfde als het ruwe punt projecteren. De paden staan er
ook niet naast: dat zou het bestand verdubbelen voor data die niemand meer
tekent.

Wat er in de bundel opnieuw is afgewogen, nu de kaart een bol is:

| Drempel | Was (doekeenheden) | Is (graden) | Waarom |
| --- | --- | --- | --- |
| Afronden | 0,1 eenheid = 0,036° | ${RING_DECIMALS} decimaal = 0,1° (±11 km) | Op een bol van 640 px is 0,1° een halve pixel, en naar de rand van de schijf knijpt de projectie horizontaal dicht — nooit open. Wat sub-pixel is in het midden is dat overal. |
| Vereenvoudigen | 0,4 eenheid = 0,144° | ${nl(DEFAULT_EPS)}° | Praktisch dezelfde drempel, zodat de bol niet grover is dan de kaart die hij vervangt. |
| Los vlak weglaten | 0,25 eenheid² | ${nl(MIN_AREA)}°² | Exact dezelfde drempel omgerekend, zodat de verhuizing hier niets verandert. |
| Langste recht stuk | (bestond niet) | ${MAX_SEG}° | Nieuw, en puur een bol-probleem. Zie hieronder. |

### Lange rechte stukken (nieuw)

Een lijn tussen twee geprojecteerde punten is een rechte op het **scherm**, dus
op een bol de projectie van de koorde dwars door de bol — niet van de grens over
het oppervlak. Op een platte kaart valt dat samen, op een bol niet, en
Douglas-Peucker maakt het erger omdat het juist de lange rechte stukken tot twee
punten terugbrengt.

Gemeten aan de twee ergste gevallen: de grens VS/Canada volgt de 49e breedtegraad
28° lang, en de koorde daartussen wijkt **0,86°** (±95 km) van die breedtegraad af
— op een bol van 640 px ruim 3 px dwars door Canada. Een meridiaanstuk van 30° is
wél een grootcirkel, maar de koorde snijdt de boog met een pijlhoogte van
0,034×R: op 320 px straal is dat 11 px.

Daarom worden stukken langer dan ${MAX_SEG}° opgedeeld (${stats.addedPoints} punten bijgezet). Dat gebeurt
**lineair in lengte/breedte** en niet over de grootcirkel, want zo zijn die
grenzen ook gedefinieerd: de 49e breedtegraad *volgt* de breedtegraad.
Grootcirkel-interpolatie zou die grens 0,86° verkeerd neerzetten in plaats van
goed.

### De speld

\`pin\` was het midden van de omhullende van het grootste vlak. Dat ligt bij
Noorwegen in Zweden en bij Frankrijk — met Frans-Guyana in de omhullende — op de
Atlantische Oceaan. Op een platte kaart met een speld van drie pixels viel dat
niet op; op een bol waar je naar je keuze **toe draait** valt het meteen op.

\`pin\` is nu het punt in \`rings[0]\` dat het **verst van elke grens** af ligt, met
alle ringen van het land mee in de meting — anders legt de speld van Zuid-Afrika
zich pal naast Lesotho. Het zwaartepunt zou goedkoper zijn maar ligt bij een holle
vorm buiten het land (Kroatië krijgt er een speld in Bosnië).

Landen waar geen enkel rasterpunt binnen het vlak viel en de speld dus op het
zwaartepunt is gezet — dat is de eerlijke uitkomst, geen goed nieuws (${stats.pinOutside.length}): ${list(stats.pinOutside)}.

### De omhullende

\`bbox\` is van \`rings[0]\` en niet van alle ringen bij elkaar. Bij de datumgrens is
dat het verschil tussen bruikbaar en niet: de bron knipt Rusland, Fiji en de
Aleoeten op ±180° in twee vlakken, dus de omhullende van álle ringen van Rusland
loopt van −180° tot 180° — de hele wereld. Van het grootste vlak is het Siberië,
en dat is wat iemand bedoelt die "Rusland" zoekt.

De omhullende van alles wat er getekend wordt: ${bounds.join(", ")} (lonMin, latMin, lonMax, latMax).

Wat de bol daarmee doet staat in \`countryFocus()\` in \`worldMap.ts\`: het **midden
van de \`bbox\`** is waar de bol naartoe draait, en dat is met opzet een ander punt
dan \`pin\`. Draaien wil zeggen "zet het hele land in het midden van de schijf", en
dat doet het midden van de omhullende; \`pin\` ligt in het land en is waar een
bolletje of een label hoort. Bij een holle vorm liggen ze ver uit elkaar — het
midden van de omhullende van Kroatië ligt in Bosnië. Eén punt voor beide zou dus
of scheef draaien of een speld in het buurland zetten.

Diezelfde \`bbox\` geeft de **omvang** van een land in graden, en die is nodig
omdat een bol een schaal heeft die een platte kaart niet had: Singapore is 0,35°
breed, op een bol van 640 px ruim één pixel. Zonder dat getal zou een component
een vlak tekenen dat niemand kan aanwijzen; mét dat getal kan hij besluiten er een
punt van te maken. Bij een land zonder vlak is de omvang \`null\` en niet 0 — wij
weten waar het ligt, niet hoe groot het is.

## Bronnen

| Wat | Bron | Licentie | Gelezen op |
| --- | --- | --- | --- |
| Landgrenzen | ${sources.geometry.url} | ${sources.geometry.license} | ${sources.fetchedAt} |${
    sources.labelPoints
      ? `\n| Labelpunten voor landen zonder eigen vlak | ${sources.labelPoints.url} | ${NE_LICENSE} | ${sources.fetchedAt} |`
      : ""
  }
| Valuta per land | ${sources.currencies.url} | ${sources.currencies.license} | ${sources.fetchedAt} |
| Welke valuta wij kunnen prijzen | ${sources.priceable.url} | ECB-referentiekoersen via Frankfurter (open, geen sleutel) | ${sources.fetchedAt} |

### Wat er is geprobeerd

| Uitkomst | URL | Wat er gebeurde |
| --- | --- | --- |
${table}

## Wat er is weggelaten, en waarom

- **Antarctica.** Geen wettig betaalmiddel volgens CLDR (XXX), dus geen valuta om
  te wisselen. **Dit is een open punt geworden** — zie hieronder.
- **Losse eilanden onder ±400 km².** Vlakken kleiner dan ${nl(MIN_AREA)}°² gaan eruit
  (${stats.droppedIslands} in totaal): Corsica blijft, Ibiza en Texel niet. Het **grootste vlak van
  een land gaat er nooit uit** — anders zou Malta van de kaart vallen omdat Malta
  klein is. Een graad² krimpt met cos(breedte), dus bij 75° NB is deze drempel nog
  ±100 km² en blijven daar kleinere eilanden staan. Op de bol is dat precies goed:
  je kunt recht op de noordpool kijken, en dan wil je de Canadese archipel zien.
- **Eilandjes die op dit raster geen vlak meer zijn** (${stats.collapsedIslands}). Ze waren groot genoeg
  voor de drempel hierboven, maar houden na afronden geen omtrek meer over. Apart
  geteld, want het is een andere uitspraak dan "te klein om te tellen" — en het is
  de enige post waar de overstap van doekeenheden naar graden echt iets weghaalt.
  Gemeten bij die overstap: op het oude, fijnere raster (0,036°) gebeurde dit met
  152 vlakken, op 0,1° met ${stats.collapsedIslands}. Dat verschil zit bij eilanden rond de 400 km²:
  0,18° breed, dus op het oude raster vijf cellen en op dit raster minder dan
  twee. Op een bol van 640 px is zo'n eiland 0,65 px. Het **grootste** vlak van een
  land valt hier nooit onder: dat krijgt een fijner raster (zie hieronder) in
  plaats van te verdwijnen.
- **Detail onder ${nl(DEFAULT_EPS)}°.** Douglas-Peucker met die drempel. Ver inzoomen maakt de
  kustlijn hoekig — dat is de prijs van een bol die in de bundel past.

  Elk land wordt LOS vereenvoudigd, dus twee buurlanden houden niet exact dezelfde
  grenspunten over en er blijft een haarlijn tussen ze staan. De component hoort
  daarom elk vlak te tekenen met een \`stroke\` in de kleur van de vulling — dat
  dicht ook de rand die bij de datumgrens langs de meridiaan loopt. Topologisch
  vereenvoudigen (gedeelde grenzen één keer) zou het bij de bron oplossen en is de
  volgende stap als het ooit stoort.
- **Gebieden zonder ISO-code.** De geometriebron kent ze wel, maar zonder code is
  er geen valuta aan te koppelen: ${stats.noIso.length ? stats.noIso.join(", ") : "geen"}.
- **Landen zonder eigen vlak in de bron** (${stats.noShape.length}): ${list(stats.noShape)}. Ze staan wél in
  de tabel, met valuta, en met \`rings: null\`. Vier van de Franse overzeese
  departementen (GF, GP, MQ, RE) zitten in het vlak van Frankrijk: wie daar klikt
  krijgt Frankrijk, en omdat er in euro's betaald wordt is het antwoord hetzelfde.
  Nagemeten op de gebundelde tabel, want het is een bewering over wat er
  gebeurt en niet over wat er hoort te gebeuren: Frankrijk heeft ringen voor het
  vasteland, Frans-Guyana, Corsica, Réunion, Martinique en Guadeloupe. **Mayotte (YT)
  staat daar niet bij** — dat eiland is kleiner dan de drempel voor losse vlakken,
  dus er is niets om op te klikken. Dat is een leemte en geen antwoord: het
  valuta-antwoord (EUR) staat er wél. Hetzelfde geldt voor Spitsbergen: dat wordt
  getekend als deel van Noorwegen, dus een klik daar geeft NO en niet SJ — en
  omdat er in beide gevallen in NOK betaald wordt, verandert dat het antwoord niet.

  Van die landen hebben ${stats.pinnedOnly.length} wél een \`pin\` gekregen uit de puntenlaag van
  dezelfde bron (${list(stats.pinnedOnly)}): dan weten we waar het ligt, tekenen we het niet,
  en kan de bol er via de zoekbalk toch naartoe draaien. De rest heeft \`pin: null\`
  — dat betekent "wij weten het niet" en **niet** [0, 0], want dat is een plek in
  de Golf van Guinee.
- **Fijner afgerond waar het moest** (${stats.finer.length} landen). Op één decimaal valt een land van
  een halve graad in één rastercel en houdt het nul punten over — of het houdt
  drie punten over die niet meer op het land lijken. Een land moet daarom ook
  minstens de helft van zijn oppervlakte overhouden; lukt dat niet, dan gaat de
  afronding voor dat ene land fijner: ${finerText || "geen"}.

## Open punt: Antarctica

Antarctica staat **niet** in de bundel. Op de platte kaart was dat vooral
opruimen: het beslaat daar de hele onderrand, uitgesmeerd door de projectie, en er
is geen valuta.

Op een bol is die afweging anders. Je kunt naar de zuidpool **toe draaien**, en
dan is daar niets — geen land, geen ijs, alleen de kleur van de oceaan. De
onderkant van wat er wél staat ligt op ${bounds[1]}° NB; daaronder is de bol leeg.

Wat het kost om het terug te zetten: de kustlijn van Antarctica is met deze
drempels ongeveer 1.500 punten, dus ±15 kB — er is ruimte. Wat het kost om het
weg te laten: één zichtbaar gat, precies op de plek waar iemand die met een bol
speelt vroeg of laat naartoe draait.

Drie mogelijkheden, met wat elk betekent:

1. **Laten zoals het is.** Goedkoopst, en de vraag "wat kost omwisselen" is er
   niet — maar de bol liegt over de wereld.
2. **Wel tekenen, niet aanklikbaar, zonder valuta-antwoord.** Eerlijk: het land is
   er, er is niets te wisselen. Vraagt van de UI dat een klik daar "hier valt
   niets te wisselen" zegt en niet stil niets doet, en niet "0%" — daar zit de
   valkuil.
3. **Wel tekenen en aanklikbaar met het antwoord "geen wettig betaalmiddel".**
   Netter dan 2 en het is precies wat CLDR zegt (XXX). Vraagt een zesde soort
   antwoord in \`conversionFor()\`, want dit is niet \`unknown\` (wij weten het) en
   niet \`noRate\` (er is geen koers omdat er geen valuta is, niet omdat wij hem
   missen).

Advies: **3**, als er tijd is voor dat zesde antwoord, anders **2**. Beide zijn
beter dan een bol met een gat erin, en 1 is alleen goed te praten zolang de bol
niet naar de zuidpool kan draaien. De keuze is aan de eigenaar; dit script hoeft
er alleen \`DROP_CODES\` voor te verliezen.

## Landen met meer dan één valuta

${
    multi.length
      ? multi
          .map(
            (r) =>
              `- **${r.name}** (${r.id}) — ${r.currencies.map((c) => `${c.code}${c.priceable ? "" : " (geen koers bij ons)"}`).join(" en ")}`,
          )
          .join("\n")
      : "_(geen)_"
  }

Deze landen krijgen géén stilzwijgend gekozen valuta. De datalaag geeft ze
allebei terug en de UI hoort het te vragen; in Panama is USD wél te prijzen en
PAB niet, dus "de eerste maar pakken" zou het antwoord veranderen.

## Kosovo

Kosovo heeft geen door ISO toegewezen alpha-2-code. \`XK\` is de gebruikerscode
die de EU, CLDR en Natural Earth alle drie hanteren, en die gebruiken wij ook.
Zonder die uitzondering zit er een gat in de Balkan dat op niets klikt.

## Valuta die wij niet kunnen prijzen

De ECB-lijst dekt ${stats.priceableCount} valuta's. Alle andere staan in de tabel met
\`priceable: false\`. Dat betekent **"wij hebben geen koers"** en nooit "geen
kosten" of "0%": een land waarvan wij de koers niet kennen mag in de UI niet als
gratis eindigen. Bij landen met twee valuta's staat het per valuta, want in
Panama kennen wij de USD-koers wel en de PAB-koers niet.

## Verversen

\`\`\`
pnpm exec tsx scripts/bundle-world-map.ts --dry   # kijken
pnpm exec tsx scripts/bundle-world-map.ts         # schrijven
\`\`\`

Valt een bron weg, dan pakt het script de volgende in de ketting en zet hij dat
in de tabel hierboven. Valt de ECB-lijst weg, dan schrijft het script **niets**:
dan zou elk land \`priceable: false\` krijgen op grond van onze eigen storing, en
dat is een uitspraak over de wereld die een storing niet kan dragen. Valt alleen
de puntenlaag weg, dan schrijft het script wél — dan missen een paar landen zonder
vlak hun \`pin\`, en dat is een leemte die zichzelf netjes als \`null\` meldt.
`;
}

/* --- de sweep --------------------------------------------------------------- */

async function firstThatWorks<T>(
  candidates: { url: string; parse: (raw: string, url: string) => T | Promise<T> }[],
  /** Sommige diensten antwoorden met 200 én een foutmelding in de body; die moet
   *  je lezen, anders schrijf je een leeg bestand met een groen vinkje. */
  validate: (v: T) => string | null,
  describe: (v: T) => string,
): Promise<T | null> {
  for (const c of candidates) {
    const got = await get(c.url);
    if (!got) {
      attempts.push({ url: c.url, ok: false, note: "niet bereikbaar" });
      continue;
    }
    try {
      const parsed = await c.parse(got.text, got.res.url || c.url);
      const problem = validate(parsed);
      if (problem) {
        attempts.push({ url: c.url, ok: false, note: problem });
        continue;
      }
      attempts.push({ url: c.url, ok: true, note: describe(parsed) });
      for (const rest of candidates.slice(candidates.indexOf(c) + 1)) {
        attempts.push({ url: rest.url, ok: null, note: "niet nodig — de bron erboven werkte" });
      }
      return parsed;
    } catch (e) {
      const head = got.text.slice(0, 160).replace(/\s+/g, " ");
      attempts.push({ url: c.url, ok: false, note: `onleesbaar: ${(e as Error).message} — begint met: ${head}` });
    }
  }
  return null;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const geo = await firstThatWorks<Geometry>(
    [
      {
        url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
        parse: fromNaturalEarth,
      },
      {
        url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
        parse: fromNaturalEarth,
      },
      {
        url: "https://unpkg.com/world-atlas@2/countries-110m.json",
        parse: async (raw, url) => fromTopoJson(raw, url, await numericToAlpha2()),
      },
    ],
    (g) => (g.countries.length >= 100 ? null : `maar ${g.countries.length} landen — dat is geen wereldkaart`),
    (g) => g.note,
  );

  const cur = await firstThatWorks<Currencies>(
    [
      /* De opdracht noemt restcountries. Die staat hier vooropgesteld zodat het
       * antwoord van vandaag in GEODATA.md komt te staan en niet in iemands
       * hoofd: v3.1 is uitgezet (200 met een foutmelding in de body, niet eens
       * een 404) en v5 vraagt een bearer token. Wij zetten geen sleutel in een
       * sweep die iedereen moet kunnen draaien, dus valt hij door naar CLDR. */
      { url: "https://restcountries.com/v3.1/all?fields=cca2,currencies,name", parse: fromRestCountries },
      {
        url: "https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/currencyData.json",
        parse: (raw, url) => fromCldr(raw, url, today),
      },
      { url: "https://raw.githubusercontent.com/mledoze/countries/master/countries.json", parse: fromMledoze },
    ],
    (c) => (c.byCountry.size >= 100 ? null : `maar ${c.byCountry.size} landen met een valuta`),
    (c) => c.note,
  );

  const price = await fetchPriceable();
  const labels = await fetchLabelPoints();

  if (!geo || !cur || !price) {
    console.error(
      "\nSweep gestopt. Wat er is geprobeerd:\n" +
        attempts.map((a) => `  ${a.ok ? "ok  " : "fout"} ${a.url} — ${a.note}`).join("\n") +
        (!price
          ? "\n\nZonder de ECB-lijst schrijf ik niets: dan zou elk land `priceable: false` krijgen door onze eigen storing."
          : ""),
    );
    process.exit(1);
  }
  console.log(`grenzen:  ${geo.source}\n          ${geo.note}`);
  console.log(`valuta:   ${cur.source}\n          ${cur.note}`);
  console.log(`prijsbaar: ${price.codes.length} valuta's uit de ECB-lijst`);
  console.log(`labels:   ${labels ? labels.note : "geen puntenlaag — landen zonder vlak houden pin: null"}`);

  const priceable = new Set(price.codes);
  const shapes = new Map(geo.countries.map((c) => [c.code, c]));
  const codes = [...new Set([...COUNTRY_CODES, ...EXTRA_CODES, ...shapes.keys()])]
    .filter((c) => !DROP_CODES.has(c))
    .sort();

  const rows: Row[] = [];
  let droppedIslands = 0;
  let collapsedIslands = 0;
  for (const id of codes) {
    const g = shapes.get(id);
    const shape = g ? toShape(g.polygons, eps) : null;
    droppedIslands += shape?.dropped ?? 0;
    collapsedIslands += shape?.collapsed ?? 0;
    const currencies = (cur.byCountry.get(id) ?? []).map((code) => ({ code, priceable: priceable.has(code) }));
    rows.push({
      id,
      /* countryName() geeft de code terug als het platform geen naam heeft; dan
       * is de naam uit de geometriebron beter dan een code als label. */
      name: (() => {
        const nl = countryName(id);
        return nl && nl !== id ? nl : (g?.name ?? id);
      })(),
      nameEn: g?.name || countryName(id) || id,
      shape,
      /* Alleen voor landen ZONDER vlak. Hebben we wel een vlak, dan is de speld
       * die we zelf in dat vlak hebben uitgerekend beter dan een punt uit een
       * labellaag — die staat waar een naam moet passen, niet waar het land is. */
      labelOnly: shape ? null : (labels?.byCountry.get(id) ?? null),
      currencies,
    });
  }

  const drawn = rows.filter((r) => r.shape);
  const noShape = rows.filter((r) => !r.shape);
  const pinnedOnly = noShape.filter((r) => r.labelOnly);
  const finer = drawn.filter((r) => (r.shape?.decimals ?? RING_DECIMALS) > RING_DECIMALS);
  const pinOutside = drawn.filter((r) => r.shape && !r.shape.pinInside);
  const noCurrency = rows.filter((r) => !r.currencies.length);
  const allRings = drawn.flatMap((r) => r.shape!.rings);
  const points = allRings.reduce((n, ring) => n + ring.length, 0);
  const addedPoints = drawn.reduce((n, r) => n + r.shape!.added, 0);

  /* De omhullende van ALLES wat er getekend wordt, over alle ringen — niet over
   * de bbox'en, want die zijn per land van het grootste vlak. Dit is de enige
   * plek waar de datumgrens-knip juist niet stoort: hier hoort −180…180 te staan,
   * want daar staat ook echt land. De onderkant is wat telt: die vertelt hoe groot
   * het gat is waar Antarctica hoorde. */
  const bounds: [number, number, number, number] = [
    Math.min(...allRings.flat().map((p) => p[0])),
    Math.min(...allRings.flat().map((p) => p[1])),
    Math.max(...allRings.flat().map((p) => p[0])),
    Math.max(...allRings.flat().map((p) => p[1])),
  ].map((n) => Math.round(n * 10) / 10) as [number, number, number, number];

  const sources: Sources = {
    geometry: { url: geo.source, license: geo.license, note: geo.note },
    labelPoints: labels ? { url: labels.url, note: labels.note } : null,
    currencies: { url: cur.source, license: cur.license, note: cur.note },
    priceable: { url: price.source },
    fetchedAt: today,
  };

  const ts = tsFile(rows, sources, bounds, points);
  const anyPriceable = rows.filter((r) => r.currencies.some((c) => c.priceable)).length;
  const multi = rows.filter((r) => r.currencies.length > 1);

  console.log(
    `\n${rows.length} landen: ${drawn.length} met ringen, ${noShape.length} zonder (${pinnedOnly.length} daarvan met alleen een speld). ` +
      `${anyPriceable} met minstens één prijsbare valuta, ${rows.length - anyPriceable} zonder. ` +
      `${multi.length} met meer dan één valuta (${multi.map((m) => m.id).join(", ")}).`,
  );
  console.log(`${points} punten in ${allRings.length} ringen, waarvan ${addedPoints} bijgezet om stukken onder ${MAX_SEG}° te houden.`);
  console.log(`Omhullende: ${bounds.join(", ")} (lonMin, latMin, lonMax, latMax).`);
  if (noCurrency.length) console.log(`Zonder valuta in de bron: ${noCurrency.map((r) => r.id).join(", ")}`);
  if (finer.length) console.log(`Fijner afgerond om niet te verdwijnen: ${finer.map((r) => r.id).join(", ")}`);
  if (pinOutside.length) console.log(`Speld niet binnen het vlak te krijgen: ${pinOutside.map((r) => r.id).join(", ")}`);
  console.log(
    `${droppedIslands} losse vlakken weggelaten omdat ze onder ${MIN_AREA}°² lagen, ` +
      `${collapsedIslands} omdat ze op dit raster geen vlak meer waren. eps=${eps}.`,
  );
  console.log(`Bestand: ${Math.round(Buffer.byteLength(ts) / 1024)} kB.`);

  if (dry) {
    console.log("--dry: niets geschreven.");
    return;
  }
  if (drawn.length < 100) {
    console.error("Minder dan 100 landen met een vlak — dan schrijf ik de bundel niet over.");
    process.exit(1);
  }
  mkdirSync(ASSETS, { recursive: true });
  writeFileSync(OUT_TS, ts);
  writeFileSync(
    OUT_NOTICE,
    noticeFile(rows, sources, bounds, {
      drawn: drawn.length,
      noShape,
      pinnedOnly,
      droppedIslands,
      collapsedIslands,
      addedPoints,
      points,
      rings: allRings.length,
      finer,
      pinOutside,
      noIso: geo.noIso,
      bytes: Buffer.byteLength(ts),
      priceableCount: price.codes.length,
    }),
  );
  console.log(`Geschreven: ${OUT_TS} en ${OUT_NOTICE}`);
}

await main();
