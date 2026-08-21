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
 * WAAROM DE PROJECTIE HIER GEBEURT EN NIET IN DE BROWSER. Twee dingen tegelijk:
 * de browser hoeft geen 3 MB GeoJSON te parsen en geen projectiewiskunde te
 * doen, en het gegenereerde bestand blijft klein omdat er per punt één
 * afgeronde coördinaat overblijft in plaats van twee floats van 15 cijfers.
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
 *  - Antarctica. Het beslaat op een equirectangular kaart de hele onderrand en
 *    er is geen valuta (CLDR: XXX, geen wettig betaalmiddel).
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

/** Het doek. Equirectangular: x is puur de lengtegraad, y puur de breedtegraad.
 *  Een bol is mooier, maar "waar reis ik heen" is een platte vraag — op een bol
 *  is de helft van de landen weggedraaid en moet je slepen voor je kunt klikken. */
const VIEW_W = 1000;
const VIEW_H = 500;

/** Douglas-Peucker in doekeenheden. 0,4 eenheid is 0,4 pixel als de kaart op
 *  1000 px breed staat — onder de zichtbaarheidsgrens, dus wat hier af gaat is
 *  detail dat toch niet te zien was. Zoomt de component ver in, dan wordt de
 *  kustlijn hoekig; dat is de prijs en hij staat in GEODATA.md. */
const DEFAULT_EPS = 0.4;
/** Minimale oppervlakte van een los vlak, in doekeenheden². Eén eenheid is
 *  0,36° in beide richtingen — op de evenaar ±40 bij 40 km, dus 0,25 eenheid²
 *  is grofweg 400 km². Corsica (8.700 km²) blijft, Ibiza (571 km²) valt af,
 *  Texel valt af. Het GROOTSTE vlak van een land valt hier nooit onder: anders
 *  verdwijnt een klein land in zijn geheel en dat is regel één. */
const MIN_AREA = 0.25;

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

/* --- projecteren en vereenvoudigen ----------------------------------------- */

type Pt = [number, number];

function project([lon, lat]: Lonlat): Pt {
  return [((lon + 180) / 360) * VIEW_W, ((90 - lat) / 180) * VIEW_H];
}

/** Ondertekende oppervlakte maakt niet uit — we gebruiken hem alleen om vlakken
 *  te rangschikken en om te zien of er na afronden nog iets over is. */
function area(ring: Pt[]): number {
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
function simplify(pts: Pt[], epsilon: number): Pt[] {
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
 *  oplevert in een pad dat een mens moet kunnen lezen. */
function quantize(pts: Pt[], decimals: number): Pt[] {
  const f = 10 ** decimals;
  const out: Pt[] = [];
  for (const [x, y] of pts) {
    const q: Pt = [Math.round(x * f) / f, Math.round(y * f) / f];
    const last = out[out.length - 1];
    if (last && last[0] === q[0] && last[1] === q[1]) continue;
    out.push(q);
  }
  // Een GeoJSON-ring herhaalt zijn eerste punt aan het eind; in een SVG-pad doet
  // "Z" dat werk, dus dat punt kan weg.
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

/** Eén ring als SVG-pad. Na de "M" volgen losse paren: een lineto is impliciet,
 *  dus elke "L" die je weglaat is een byte minder in de bundel. */
const ringPath = (r: Pt[]): string => `M${r.map(([x, y]) => `${x},${y}`).join(" ")}Z`;

type Shape = { path: string; bbox: [number, number, number, number]; pin: [number, number]; decimals: number; dropped: number };

/** Van bolcoördinaten naar één SVG-pad.
 *
 *  De volgorde is: projecteren → vereenvoudigen → afronden. Andersom afronden
 *  vóór het vereenvoudigen scheelt niets en levert kartelranden op.
 *
 *  DE UITZONDERING OP "1 DECIMAAL". Monaco is 0,05 doekeenheid breed: op één
 *  decimaal valt het hele land in één rastercel en houdt het nul punten over.
 *  Dan is de keuze "geen Monaco" of "meer decimalen voor dit ene land", en de
 *  eerste is regel één overtreden. Dus: 1 decimaal, en alleen als het grootste
 *  vlak dan verdwijnt fijner, tot het blijft staan. Dat kost bytes bij precies
 *  de landen die bijna geen bytes zijn. */
function toShape(polygons: Polygon[], epsilon: number): Shape | null {
  const projected = polygons
    .map((poly) => poly.map((ring) => ring.map(project)))
    .filter((poly) => poly.length > 0)
    .sort((a, b) => area(b[0]) - area(a[0]));
  if (!projected.length) return null;

  /* Elke poging is grover-naar-fijner. De eerste die het GROOTSTE vlak overeind
   * houdt wint; houdt hij dat niet, dan verdwijnt het land en dat mag niet.
   * Let op dat het niet alleen om decimalen gaat: bij een land van een halve
   * doekeenheid haalt Douglas-Peucker met eps 0,4 de hele omtrek weg en houd je
   * twee punten over, hoe fijn je daarna ook afrondt. Dus gaan eps én afronding
   * samen omlaag. */
  const passes: { eps: number; decimals: number }[] = [
    { eps: epsilon, decimals: 1 },
    { eps: epsilon / 4, decimals: 2 },
    { eps: epsilon / 20, decimals: 3 },
    { eps: 0, decimals: 3 },
  ];
  for (const pass of passes) {
    const rings: Pt[][] = [];
    let dropped = 0;
    let mainRing: Pt[] | null = null;
    projected.forEach((poly, pi) => {
      poly.forEach((ring, ri) => {
        // Het grootste vlak van een land blijft altijd; al het andere (los eiland
        // óf gat) moet groot genoeg zijn om op deze schaal iets te betekenen.
        const biggest = pi === 0 && ri === 0;
        if (!biggest && area(ring) < MIN_AREA) {
          dropped++;
          return;
        }
        const q = quantize(simplify(ring, pass.eps), pass.decimals);
        if (q.length < 3) {
          dropped++;
          return;
        }
        if (biggest) mainRing = q;
        rings.push(q);
      });
    });
    if (!mainRing) continue;
    const main: Pt[] = mainRing;
    const xs = rings.flat().map((p) => p[0]);
    const ys = rings.flat().map((p) => p[1]);
    const mx = main.map((p) => p[0]);
    const my = main.map((p) => p[1]);
    const r1 = (n: number): number => Math.round(n * 10) / 10;
    return {
      path: rings.map(ringPath).join(""),
      bbox: [r1(Math.min(...xs)), r1(Math.min(...ys)), r1(Math.max(...xs)), r1(Math.max(...ys))],
      pin: [r1((Math.min(...mx) + Math.max(...mx)) / 2), r1((Math.min(...my) + Math.max(...my)) / 2)],
      decimals: pass.decimals,
      dropped,
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
  currencies: { code: string; priceable: boolean }[];
};

type Sources = {
  geometry: { url: string; license: string; note: string };
  currencies: { url: string; license: string; note: string };
  priceable: { url: string };
  fetchedAt: string;
};

function tsFile(rows: Row[], sources: Sources, bounds: [number, number, number, number]): string {
  const body = rows
    .map((r) => {
      const cur = r.currencies.map((c) => `{ code: ${JSON.stringify(c.code)}, priceable: ${c.priceable} }`).join(", ");
      return (
        `  {\n` +
        `    id: ${JSON.stringify(r.id)},\n` +
        `    name: ${JSON.stringify(r.name)},\n` +
        `    nameEn: ${JSON.stringify(r.nameEn)},\n` +
        `    currencies: [${cur}],\n` +
        (r.shape
          ? `    bbox: [${r.shape.bbox.join(", ")}],\n` +
            `    pin: [${r.shape.pin.join(", ")}],\n` +
            `    path:\n      ${JSON.stringify(r.shape.path)},\n`
          : `    bbox: null,\n    pin: null,\n    path: null,\n`) +
        `  },`
      );
    })
    .join("\n");

  return `/* GEGENEREERD door scripts/bundle-world-map.ts — niet met de hand aanpassen.
 *
 * De kaart is tijdens een SWEEP opgehaald, geprojecteerd en hier als tekst
 * neergelegd. In de browser wordt er dus niets opgehaald: een tile-request zou
 * die server vertellen naar welk land de gebruiker kijkt, en in de Valuta-tab is
 * dat "waar ga ik heen".
 *
 * Herkomst, licenties en wat er is weggelaten: GEODATA.md in deze map.
 *
 * HOE JE DIT TEKENT.
 *  - viewBox "0 0 ${VIEW_W} ${VIEW_H}" (equirectangular, hele wereld). Alleen het
 *    getekende deel: ${bounds.map((n) => String(n)).join(" ")} — Antarctica is weggelaten, dus
 *    de onderste strook is leeg en de component mag daarop bijsnijden.
 *  - Teken elk land met een STROKE in dezelfde kleur als de vulling (±0,3
 *    eenheid). Elk land is los vereenvoudigd, dus twee buurlanden hebben niet
 *    meer exact dezelfde grenspunten en er blijft een haarlijn tussen staan —
 *    op 10× inzoomen zichtbaar gemeten, op ware grootte niet. Een stroke dicht
 *    dat; een achtergrondvlak in dezelfde kleur ook.
 *  - fill-rule="evenodd" is VERPLICHT. Landen met een gat (Lesotho in
 *    Zuid-Afrika, Vaticaanstad in Italië) hebben dat gat als tweede ring in
 *    hetzelfde pad; met de standaard nonzero-regel vult het zich en klikt
 *    Lesotho op Zuid-Afrika.
 *
 * \`path: null\` betekent: dit land heeft op deze schaal geen eigen vlak in de
 * bron (Gibraltar, de Franse overzeese departementen). Dat is GEEN uitspraak
 * over het land en al helemaal niet over zijn valuta — die staat er gewoon bij.
 *
 * \`priceable\` staat NAAST de valutacode en niet naast het land, omdat een land
 * met twee valuta's er één kan hebben die wij wel kennen en één die wij niet
 * kennen (Panama: USD wel, PAB niet). \`false\` betekent "wij hebben geen koers",
 * nooit "geen kosten".
 */

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
  /** SVG-pad in de viewBox hieronder, of null als de bron geen vlak heeft. */
  path: string | null;
  /** [x0, y0, x1, y1] van alle getekende ringen. */
  bbox: [number, number, number, number] | null;
  /** Midden van het GROOTSTE vlak — waar een label of speld hoort. Frankrijk
   *  bevat de overzeese departementen, dus het midden van àlles ligt op zee. */
  pin: [number, number] | null;
};

export const WORLD_MAP_VIEWBOX = { width: ${VIEW_W}, height: ${VIEW_H} } as const;

/** De omhullende van alles wat er echt getekend wordt. */
export const WORLD_MAP_BOUNDS: readonly [number, number, number, number] = [${bounds.join(", ")}];

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
  stats: {
    drawn: number;
    noShape: Row[];
    droppedIslands: number;
    finer: Row[];
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
    const d = r.shape?.decimals ?? 1;
    finerByDecimals.set(d, [...(finerByDecimals.get(d) ?? []), r.id]);
  }
  const finerText = [...finerByDecimals.entries()]
    .sort(([a], [b]) => a - b)
    .map(([d, ids]) => `${ids.length} op ${d} decimalen (${ids.join(", ")})`)
    .join("; ");
  const multi = rows.filter((r) => r.currencies.length > 1);
  return `# Kaartgegevens en valuta per land

_Gegenereerd door \`scripts/bundle-world-map.ts\` op ${sources.fetchedAt}. Niet met de hand aanpassen._

De kaart in de Valuta-tab wordt **tijdens de sweep opgehaald en meegebundeld**,
net als de banklogo's (zie \`TRADEMARKS.md\`). In de browser wordt er niets
opgehaald: een tile-request zou de tileserver vertellen naar welk land de
gebruiker kijkt, en in deze tab is dat "waar ga ik heen en hoeveel geld neem ik
mee". Het gegenereerde bestand is \`world-map.generated.ts\` (${Math.round(stats.bytes / 1024)} kB).

## Bronnen

| Wat | Bron | Licentie | Gelezen op |
| --- | --- | --- | --- |
| Landgrenzen | ${sources.geometry.url} | ${sources.geometry.license} | ${sources.fetchedAt} |
| Valuta per land | ${sources.currencies.url} | ${sources.currencies.license} | ${sources.fetchedAt} |
| Welke valuta wij kunnen prijzen | ${sources.priceable.url} | ECB-referentiekoersen via Frankfurter (open, geen sleutel) | ${sources.fetchedAt} |

### Wat er is geprobeerd

| Uitkomst | URL | Wat er gebeurde |
| --- | --- | --- |
${table}

## Wat er is weggelaten, en waarom

- **Antarctica.** Op een equirectangular kaart beslaat het de hele onderrand, en
  CLDR geeft het geen wettig betaalmiddel (XXX). Weggelaten uit de kaart én uit
  de tabel.
- **Losse eilanden onder ±400 km².** Vlakken kleiner dan ${MIN_AREA} doekeenheid² gaan
  eruit (${stats.droppedIslands} in totaal): Corsica blijft, Ibiza en Texel niet. Het **grootste
  vlak van een land gaat er nooit uit** — anders zou Malta van de kaart vallen
  omdat Malta klein is.
- **Detail onder ${eps} doekeenheid.** Douglas-Peucker met die drempel; op een kaart
  van 1000 px breed is dat minder dan een pixel. Ver inzoomen maakt de kustlijn
  hoekig — dat is de prijs van een kaart die in de bundel past.

  Elk land wordt LOS vereenvoudigd, dus twee buurlanden houden niet exact
  dezelfde grenspunten over en er blijft een haarlijn tussen ze staan (op 10×
  inzoomen zichtbaar gemeten; op ware grootte niet). De component hoort daarom
  elk vlak te tekenen met een \`stroke\` in de kleur van de vulling. Topologisch
  vereenvoudigen (gedeelde grenzen één keer) zou het bij de bron oplossen en is
  de volgende stap als het ooit stoort.
- **Gebieden zonder ISO-code.** De geometriebron kent ze wel, maar zonder code is
  er geen valuta aan te koppelen: ${stats.noIso.length ? stats.noIso.join(", ") : "geen"}.
- **Landen zonder eigen vlak in de bron** (${stats.noShape.length}): ${
    stats.noShape.length ? stats.noShape.map((r) => `${r.name} (${r.id})`).join(", ") : "geen"
  }. Ze staan wél in de tabel, met valuta, en met \`path: null\`. De Franse
  overzeese departementen (GF, GP, MQ, RE, YT) zitten in het vlak van Frankrijk:
  wie daar klikt krijgt Frankrijk, en omdat er in euro's betaald wordt is het
  antwoord hetzelfde.
- **Fijner afgerond waar het moest** (${stats.finer.length} landen). Op één decimaal valt een land
  van een halve doekeenheid in één rastercel en houdt het nul punten over — dan
  is fijner afronden de enige manier om het niet weg te gooien: ${finerText || "geen"}.

## Landen met meer dan één valuta

${
    multi.length
      ? multi.map((r) => `- **${r.name}** (${r.id}) — ${r.currencies.map((c) => `${c.code}${c.priceable ? "" : " (geen koers bij ons)"}`).join(" en ")}`).join("\n")
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
dat is een uitspraak over de wereld die een storing niet kan dragen.
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

  const priceable = new Set(price.codes);
  const shapes = new Map(geo.countries.map((c) => [c.code, c]));
  const codes = [...new Set([...COUNTRY_CODES, ...EXTRA_CODES, ...shapes.keys()])]
    .filter((c) => !DROP_CODES.has(c))
    .sort();

  const rows: Row[] = [];
  let droppedIslands = 0;
  for (const id of codes) {
    const g = shapes.get(id);
    const shape = g ? toShape(g.polygons, eps) : null;
    droppedIslands += shape?.dropped ?? 0;
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
      currencies,
    });
  }

  const drawn = rows.filter((r) => r.shape);
  const noShape = rows.filter((r) => !r.shape);
  const finer = drawn.filter((r) => (r.shape?.decimals ?? 1) > 1);
  const noCurrency = rows.filter((r) => !r.currencies.length);
  const bounds: [number, number, number, number] = [
    Math.min(...drawn.map((r) => r.shape!.bbox[0])),
    Math.min(...drawn.map((r) => r.shape!.bbox[1])),
    Math.max(...drawn.map((r) => r.shape!.bbox[2])),
    Math.max(...drawn.map((r) => r.shape!.bbox[3])),
  ].map((n) => Math.round(n * 10) / 10) as [number, number, number, number];

  const sources: Sources = {
    geometry: { url: geo.source, license: geo.license, note: geo.note },
    currencies: { url: cur.source, license: cur.license, note: cur.note },
    priceable: { url: price.source },
    fetchedAt: today,
  };

  const ts = tsFile(rows, sources, bounds);
  const anyPriceable = rows.filter((r) => r.currencies.some((c) => c.priceable)).length;
  const multi = rows.filter((r) => r.currencies.length > 1);

  console.log(
    `\n${rows.length} landen: ${drawn.length} met een vlak, ${noShape.length} zonder. ` +
      `${anyPriceable} met minstens één prijsbare valuta, ${rows.length - anyPriceable} zonder. ` +
      `${multi.length} met meer dan één valuta (${multi.map((m) => m.id).join(", ")}).`,
  );
  if (noCurrency.length) console.log(`Zonder valuta in de bron: ${noCurrency.map((r) => r.id).join(", ")}`);
  if (finer.length) console.log(`Fijner afgerond om niet te verdwijnen: ${finer.map((r) => r.id).join(", ")}`);
  console.log(`${droppedIslands} losse vlakken weggelaten (onder ${MIN_AREA} eenheid²), eps=${eps}.`);
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
    noticeFile(rows, sources, {
      drawn: drawn.length,
      noShape,
      droppedIslands,
      finer,
      noIso: geo.noIso,
      bytes: Buffer.byteLength(ts),
      priceableCount: price.codes.length,
    }),
  );
  console.log(`Geschreven: ${OUT_TS} en ${OUT_NOTICE}`);
}

await main();
