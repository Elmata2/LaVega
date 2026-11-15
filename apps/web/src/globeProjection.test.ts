import { expect, test } from "vitest";
import {
  dragRotation,
  globeFrame,
  graticule,
  normalizeRotation,
  prepareRing,
  project,
  traceLine,
  traceRing,
  unproject,
  wrapLon,
  type PathSink,
  type Viewport,
} from "./globeProjection.js";
import { countryById, mapCountries } from "./worldMap.js";

/* Wat hier bewaakt wordt is de helft van een bol die je op een plaatje niet ziet
 * maar wel meteen voelt:
 *
 *  1. staat een punt waar het hoort (midden, rand, achterkant),
 *  2. komt een klik terug op hetzelfde punt (anders wijs je een ander land aan
 *     dan waar je op klikte),
 *  3. en loopt er nooit een lijn dwars over de bol. Dat laatste is HET
 *     faalgeval van een draaibare bol: als de achterkant niet netjes wordt
 *     afgekapt, zie je Amerika door Azië heen. Het wordt hier gemeten op alle 237
 *     getekende landen bij vier standen, niet beoordeeld op een plaatje.
 *
 * Sinds Antarctica in de bundel zit is daar een vierde bij gekomen, en het is het
 * enige geval van zijn soort: een ring die de POOL OMSLUIT. Elk ander land is een
 * vlek op de bol; deze loopt van −180 tot 180 en sluit zichzelf via een naad langs
 * de meridiaan naar het punt −90. Dat raakt precies de plek waar dit bestand het
 * kwetsbaarst is (welke kant gaat de boog over de limbus op), dus daar staat een
 * eigen test voor.
 */

const VIEW: Viewport = { cx: 200, cy: 200, r: 100 };

/** Alles wat er naar een pad geschreven wordt, opgeschreven in plaats van
 *  getekend. Zo is een pad na te meten zonder canvas. */
type Op =
  | { op: "moveTo"; x: number; y: number }
  | { op: "lineTo"; x: number; y: number }
  | { op: "arc"; from: number; to: number; ccw: boolean }
  | { op: "closePath" };

function recorder(): { ops: Op[]; sink: PathSink } {
  const ops: Op[] = [];
  return {
    ops,
    sink: {
      moveTo: (x, y) => ops.push({ op: "moveTo", x, y }),
      lineTo: (x, y) => ops.push({ op: "lineTo", x, y }),
      arc: (_cx, _cy, _r, from, to, ccw) => ops.push({ op: "arc", from, to, ccw: ccw === true }),
      closePath: () => ops.push({ op: "closePath" }),
    },
  };
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** Het oppervlak dat een pad écht vult, in pixels². Bogen worden op 2° gesampled
 *  en dan is het gewoon de schoenveterformule.
 *
 *  Dit is de maat die de ergste fout van een bol betrapt en de langste-lijn-maat
 *  niet: een ring kan uit nette korte lijntjes bestaan en tóch de hele schijf
 *  vullen, namelijk als de boog over de limbus de verkeerde kant om gaat. Dat is
 *  precies wat er gebeurde (zie de test over het haartje Groot-Brittannië). */
function pathArea(ops: Op[], view: Viewport): number {
  let total = 0;
  let pts: [number, number][] = [];
  const flush = () => {
    if (pts.length > 2) {
      let s = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
        s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      total += Math.abs(s) / 2;
    }
    pts = [];
  };
  for (const o of ops) {
    if (o.op === "moveTo") {
      flush();
      pts.push([o.x, o.y]);
    } else if (o.op === "lineTo") {
      pts.push([o.x, o.y]);
    } else if (o.op === "arc") {
      const forward = (((o.to - o.from) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const d = o.ccw ? forward - Math.PI * 2 : forward;
      const steps = Math.max(1, Math.ceil(Math.abs(d) / ((2 * Math.PI) / 180)));
      for (let i = 1; i <= steps; i++) {
        const a = o.from + (d * i) / steps;
        pts.push([view.cx + view.r * Math.cos(a), view.cy + view.r * Math.sin(a)]);
      }
    }
  }
  flush();
  return total;
}

const DISC = Math.PI * VIEW.r * VIEW.r;

/** De langste RECHTE lijn in een pad, inclusief het stuk dat closePath terug naar
 *  het begin van het subpad trekt. Een boog telt niet mee: die volgt de rand van
 *  de schijf en kan nooit over de bol heen lopen. */
function longestSegment(ops: Op[], view: Viewport): number {
  let worst = 0;
  let cx: number | null = null;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const o of ops) {
    if (o.op === "moveTo") {
      cx = o.x;
      cy = o.y;
      sx = o.x;
      sy = o.y;
    } else if (o.op === "lineTo") {
      if (cx !== null) worst = Math.max(worst, dist(cx, cy, o.x, o.y));
      cx = o.x;
      cy = o.y;
    } else if (o.op === "arc") {
      // Na een boog staat de pen op het eindpunt van die boog.
      cx = view.cx + view.r * Math.cos(o.to);
      cy = view.cy + view.r * Math.sin(o.to);
    } else if (cx !== null) {
      worst = Math.max(worst, dist(cx, cy, sx, sy));
    }
  }
  return worst;
}

// ------------------------------------------------------------------ projectie

test("het midden van de projectie is de stand van de bol", () => {
  const f = globeFrame({ lon: 5, lat: 52 }, VIEW);
  const p = project(5, 52, f);
  expect(p.x).toBeCloseTo(200, 9);
  expect(p.y).toBeCloseTo(200, 9);
  expect(p.front).toBe(true);
  expect(p.toward).toBeCloseTo(1, 9);
});

test("noord is boven en oost is rechts", () => {
  const f = globeFrame({ lon: 0, lat: 0 }, VIEW);
  const noord = project(0, 90, f);
  expect(noord.x).toBeCloseTo(200, 9);
  expect(noord.y).toBeCloseTo(100, 9); // r omhoog = kleinere y
  const oost = project(30, 0, f);
  expect(oost.x).toBeGreaterThan(200);
  expect(oost.y).toBeCloseTo(200, 9);
});

test("een punt op 90° van het midden ligt op de rand van de schijf", () => {
  const f = globeFrame({ lon: 0, lat: 0 }, VIEW);
  const rand = project(90, 0, f);
  expect(dist(rand.x, rand.y, 200, 200)).toBeCloseTo(100, 6);
  expect(rand.toward).toBeCloseTo(0, 12);
  /* Er staat hier met opzet GEEN verwachting over `front`. Pal op de limbus is
   * `toward` nul op afrondingsniveau — cos(π/2) is in een double 6·10⁻¹⁷ en niet
   * 0 — dus of zo'n punt "voor" of "achter" heet, beslist de afronding. Dat mag,
   * want het maakt geen verschil op het doek: heet het voor, dan wordt het op de
   * rand getekend; heet het achter, dan rekent traceRing een snijpunt uit dat op
   * diezelfde rand ligt. Een test die hier een kant kiest, test de afronding. */
  expect(Math.abs(rand.toward)).toBeLessThan(1e-15);
});

test("de achterkant is achter, en het tegenpunt ligt in het midden van de schijf", () => {
  const f = globeFrame({ lon: 0, lat: 0 }, VIEW);
  const achter = project(150, 0, f);
  expect(achter.front).toBe(false);
  expect(achter.toward).toBeLessThan(0);
  // Verraderlijk: het tegenpunt projecteert óp het middelpunt van de schijf. Wie
  // alleen naar x/y kijkt en niet naar `front`, tekent de achterkant dus midden
  // over de voorkant heen.
  const tegen = project(180, 0, f);
  expect(dist(tegen.x, tegen.y, 200, 200)).toBeCloseTo(0, 6);
  expect(tegen.front).toBe(false);
  expect(tegen.toward).toBeCloseTo(-1, 9);
});

test("een klik komt terug op het punt waar hij vandaan kwam", () => {
  const f = globeFrame({ lon: 12, lat: -20 }, VIEW);
  for (const [lon, lat] of [
    [12, -20],
    [40, 10],
    [-30, -60],
    [90, 0],
    [12, 69],
    [-70, -5],
  ] as const) {
    const p = project(lon, lat, f);
    if (!p.front) continue;
    const back = unproject(p.x, p.y, f);
    expect(back).not.toBeNull();
    expect(back![0]).toBeCloseTo(lon, 6);
    expect(back![1]).toBeCloseTo(lat, 6);
  }
});

test("naast de bol geklikt is geen punt op de bol", () => {
  const f = globeFrame({ lon: 0, lat: 0 }, VIEW);
  expect(unproject(200 + 101, 200, f)).toBeNull();
  expect(unproject(200, 200 - 100.5, f)).toBeNull();
  expect(unproject(Number.NaN, 200, f)).toBeNull();
  // Precies op de rand is nog wél een punt op de bol.
  expect(unproject(300, 200, f)).not.toBeNull();
  // En een bol zonder maat levert niets op in plaats van een deling door nul.
  expect(unproject(0, 0, globeFrame({ lon: 0, lat: 0 }, { cx: 0, cy: 0, r: 0 }))).toBeNull();
});

test("de lengtegraad slaat om, de breedtegraad wordt geklemd", () => {
  expect(wrapLon(190)).toBeCloseTo(-170, 9);
  expect(wrapLon(-190)).toBeCloseTo(170, 9);
  expect(wrapLon(-180)).toBeCloseTo(-180, 9); // blijft staan: de tabel knipt daar
  expect(normalizeRotation({ lon: 400, lat: 120 })).toEqual({ lon: 40, lat: 90 });
  expect(normalizeRotation({ lon: -400, lat: -120 })).toEqual({ lon: -40, lat: -90 });
});

test("slepen volgt de vinger en klemt niet vast aan de pool", () => {
  const start = { lon: 0, lat: 0 };
  // Naar rechts slepen brengt wat links lag naar het midden: de lengtegraad zakt.
  expect(dragRotation(start, 50, 0, VIEW).lon).toBeLessThan(0);
  // Naar beneden slepen brengt het noorden in beeld.
  expect(dragRotation(start, 0, 50, VIEW).lat).toBeGreaterThan(0);
  // In het midden volgt het punt onder de vinger: r px slepen is 1 radiaan.
  expect(dragRotation(start, 100, 0, VIEW).lon).toBeCloseTo(-(180 / Math.PI), 6);
  // Ver doorslepen en binnen dezelfde sleep terug: de bol komt terug. Dit is
  // waarom er vanaf de STAND BIJ NEERKOMEN gerekend wordt en niet stapje voor
  // stapje — met stapjes blijft hij op de pool hangen.
  expect(dragRotation(start, 0, 900, VIEW).lat).toBe(90);
  expect(dragRotation(start, 0, 100, VIEW).lat).toBeCloseTo(180 / Math.PI, 6);
});

// ------------------------------------------------------------ ringen tekenen

/** Een vierkantje in graden, tegen de klok in. */
function box(lonMin: number, latMin: number, lonMax: number, latMax: number) {
  return prepareRing([
    [lonMin, latMin],
    [lonMax, latMin],
    [lonMax, latMax],
    [lonMin, latMax],
  ]);
}

test("een ring die helemaal zichtbaar is wordt één gesloten veelhoek", () => {
  const f = globeFrame({ lon: 0, lat: 0 }, VIEW);
  const { ops, sink } = recorder();
  expect(traceRing(box(-10, -10, 10, 10), f, sink)).toBe(true);
  expect(ops.filter((o) => o.op === "moveTo").length).toBe(1);
  expect(ops.filter((o) => o.op === "lineTo").length).toBe(3);
  expect(ops.filter((o) => o.op === "arc").length).toBe(0);
  expect(ops[ops.length - 1].op).toBe("closePath");
});

test("een ring die helemaal achter de bol zit wordt niet getekend", () => {
  const f = globeFrame({ lon: 0, lat: 0 }, VIEW);
  const { ops, sink } = recorder();
  expect(traceRing(box(150, -10, 170, 10), f, sink)).toBe(false);
  expect(ops.length).toBe(0);
});

test("een ring die half achter de bol zit wordt op de rand afgekapt en met een boog gesloten", () => {
  const f = globeFrame({ lon: 0, lat: 0 }, VIEW);
  const { ops, sink } = recorder();
  // 60°O..120°O: de helft tot 90° is zichtbaar, de rest niet.
  expect(traceRing(box(60, -10, 120, 10), f, sink)).toBe(true);

  const arcs = ops.filter((o): o is Extract<Op, { op: "arc" }> => o.op === "arc");
  expect(arcs.length).toBe(1);

  // Elk getekend punt ligt binnen de schijf; niets steekt erbuiten.
  for (const o of ops) {
    if (o.op === "moveTo" || o.op === "lineTo") {
      expect(dist(o.x, o.y, VIEW.cx, VIEW.cy)).toBeLessThanOrEqual(VIEW.r + 1e-9);
    }
  }

  /* De boog hoort het KORTE stuk rand langs te gaan waar het land tegenaan ligt
   * (van ongeveer +10° naar −10°, tegen de klok in), en niet de andere kant om —
   * dan zou het land bijna de hele schijf vullen. */
  expect(arcs[0].ccw).toBe(true);
  /* ±11,5° en niet ±10°, en dat is geen slordigheid maar het bewijs dat er op de
   * GROOTCIRKEL wordt afgekapt en niet op de breedtecirkel. De grens van dit
   * vierkant loopt langs de parallel −10°, maar tussen twee punten hoort een
   * grootcirkel, en die buigt in het zuidelijk halfrond naar de pool: op 90°
   * lengte zit hij op −11,5°. Bij een eerdere versie werd het snijpunt lineair in
   * de projectie geschat en dan kwam hier 10° uit — precies de fout die een land
   * bij de rand van de bol een halve graad laat verschuiven. */
  expect(arcs[0].from).toBeCloseTo(11.5 * (Math.PI / 180), 2);
  expect(arcs[0].to).toBeCloseTo(-11.5 * (Math.PI / 180), 2);

  /* Geen koorde dwars over de schijf. De grens staat hier ruimer dan bij de
   * echte data: de zijden van dít vierkant zijn 20° lang (34,7 px bij r=100),
   * want het is met de hand geschreven en niet door de datalaag opgedeeld. Een
   * lijn die over de bol heen springt is bijna 2·r. */
  expect(longestSegment(ops, VIEW)).toBeLessThan(VIEW.r * 0.5);
});

test("een lijn wordt op de rand afgekapt en niet gesloten", () => {
  const f = globeFrame({ lon: 0, lat: 0 }, VIEW);
  const { ops, sink } = recorder();
  const meridiaan = prepareRing(Array.from({ length: 37 }, (_, i) => [80, -90 + i * 5] as const));
  expect(traceLine(meridiaan, f, sink)).toBe(true);
  expect(ops.some((o) => o.op === "closePath")).toBe(false);
  expect(ops.some((o) => o.op === "arc")).toBe(false);
});

test("geen enkele lijn loopt dwars over de bol — alle landen, vier standen", () => {
  /* De echte test op de echte data. De datalaag heeft elk grensstuk opgedeeld tot
   * maximaal 5°, en 5° projecteert naar ten hoogste 2·r·sin(2,5°) = 0,0873·r
   * pixels. Elke rechte lijn die daar ruim boven komt is een lijn die over de bol
   * heen is gesprongen — precies het beeld waarin Amerika door Azië heen te zien
   * is. De grens staat op 0,1·r zodat de test over een afronding heen kijkt maar
   * niet over een koorde (die is bijna 2·r). */
  const bound = VIEW.r * 0.1;
  const countries = mapCountries();
  expect(countries.length).toBeGreaterThan(200);
  const prepared = countries.map((c) => c.rings.map((rg) => prepareRing(rg)));

  let drawn = 0;
  let worst = 0;
  let arcs = 0;
  for (const rot of [
    { lon: 0, lat: 0 },
    { lon: 100, lat: 20 },
    { lon: -75, lat: -35 },
    { lon: 175, lat: 60 },
  ]) {
    const f = globeFrame(rot, VIEW);
    for (const rings of prepared) {
      for (const ring of rings) {
        const { ops, sink } = recorder();
        if (!traceRing(ring, f, sink)) continue;
        drawn++;
        arcs += ops.filter((o) => o.op === "arc").length;
        worst = Math.max(worst, longestSegment(ops, VIEW));
      }
    }
  }
  expect(drawn).toBeGreaterThan(600);
  expect(arcs).toBeGreaterThan(0); // er zijn dus echt ringen op de rand afgekapt
  expect(worst).toBeLessThan(bound);
});

test("een land dat maar een haartje zichtbaar is, vult geen halve wereld", () => {
  /* HET GEMETEN FAALGEVAL, en de reden dat deze test bestaat. Bij een stand rond
   * 99° oost / 11° noord ligt Groot-Brittannië nét over de rand: één stukje kust
   * heeft Z = +0,035 en de rest zit erachter. Het verborgen stuk draait in de
   * projectie bijna niet rond (som −0,5°), en toen de richting van de boog alleen
   * aan het TEKEN van die som hing, koos hij de weg van 359° over de limbus. Op de
   * schermafdruk was de hele bol één blauw vlak in de kleur van het Verenigd
   * Koninkrijk, met een paar eilandjes erop. Gemeten na de reparatie: 0,006% van
   * de schijf. De grens staat op 1% — twee ordes onder de fout en twee ordes
   * boven de goede uitkomst. */
  const f = globeFrame({ lon: 98.9, lat: 10.7 }, VIEW);
  const gb = countryById("GB")?.rings?.[0];
  expect(gb).toBeTruthy();
  const { ops, sink } = recorder();
  expect(traceRing(prepareRing(gb!), f, sink)).toBe(true);
  expect(pathArea(ops, VIEW) / DISC).toBeLessThan(0.01);
});

test("bij zes standen loopt geen enkel land uit over de schijf", () => {
  /* Dezelfde fout, nu over alle landen tegelijk. Opnieuw gemeten met Antarctica
   * erbij (som van alle ringen per stand, gaten en enclaves dus dubbel geteld):
   * tussen 18,7% en 47,1% van de schijf, en de grootste losse ring is Rusland met
   * 10,0% bij de stand op 175° oost. Antarctica komt daar bij de zuidelijke stand
   * vlak achter met 9,1% — dat is de kap zoals hij hoort te zijn en niet een
   * uitloper. Wat er door Antarctica veranderde: de onderste stand was 9,5% en is
   * 18,7%, want daar stond eerst niets. Eén ring die de verkeerde kant om sluit is
   * meteen ~100%, dus de grenzen van 60% en 20% liggen ruim boven de meting en
   * ruim onder de fout. */
  const prepared = mapCountries().map((c) => c.rings.map((rg) => prepareRing(rg)));
  for (const rot of [
    { lon: 0, lat: 0 },
    { lon: 8, lat: 30 },
    { lon: 99, lat: 11 },
    { lon: -75, lat: -35 },
    { lon: 175, lat: 60 },
    { lon: 20, lat: -80 },
  ]) {
    const f = globeFrame(rot, VIEW);
    let sum = 0;
    let worst = 0;
    for (const rings of prepared) {
      for (const ring of rings) {
        const { ops, sink } = recorder();
        if (!traceRing(ring, f, sink)) continue;
        const a = pathArea(ops, VIEW);
        sum += a;
        worst = Math.max(worst, a);
      }
    }
    expect(sum / DISC).toBeLessThan(0.6);
    expect(worst / DISC).toBeLessThan(0.2);
  }
});

test("de kap om de zuidpool blijft een kap, van welke kant je hem ook ziet", () => {
  /* Antarctica is de enige ring die de pool OMSLUIT, en dat maakt hem het lastigste
   * geval in dit bestand. Zijn vlak loopt in de bron van lengtegraad −180 tot 180
   * en sluit zichzelf via een naad: langs meridiaan 180 omlaag naar breedtegraad
   * −90, dan naar −180, en weer omhoog. Op een bol vallen die twee naadstukken
   * precies op elkaar (180 en −180 zijn dezelfde meridiaan) en is het gat een
   * punt — maar alleen als het afkappen op de limbus en de boog eromheen kloppen.
   * Gaat de boog de verkeerde kant op, dan vult Antarctica de hele bol, en dat is
   * onderaan een scherm nu juist niet op te merken.
   *
   * Vier standen: recht op de zuidpool (alles zichtbaar), recht op de noordpool
   * (niets zichtbaar), en twee keer van opzij (half afgekapt). */
  const aq = countryById("AQ")?.rings;
  expect(aq, "Antarctica staat niet meer in de bundel").toBeTruthy();
  const rings = aq!.map((r) => prepareRing(r));

  // Van de noordpool af gezien is er niets van te zien, en dan hoort er ook niets
  // getekend te worden — geen leeg pad dat de vulregel in de war stuurt.
  const noord = globeFrame({ lon: 0, lat: 90 }, VIEW);
  for (const ring of rings) {
    const { sink } = recorder();
    expect(traceRing(ring, noord, sink)).toBe(false);
  }

  for (const rot of [
    { lon: 0, lat: -90 },
    { lon: 140, lat: -90 },
    { lon: 0, lat: -20 },
    { lon: 170, lat: 0 },
  ]) {
    const f = globeFrame(rot, VIEW);
    let sum = 0;
    let worst = 0;
    for (const ring of rings) {
      const { ops, sink } = recorder();
      if (!traceRing(ring, f, sink)) continue;
      sum += pathArea(ops, VIEW);
      worst = Math.max(worst, longestSegment(ops, VIEW));
    }
    /* Gemeten: recht op de pool beslaat de kap 9,3% van de schijf (de kustlijn
     * ligt in deze bron rond 70° zuid, dus het is een kap van ±18° en niet de
     * halve zuidelijke hemisfeer), van opzij 3,3% en op 170°/0° nog 0,7%. De grens
     * op 25% ligt ruim boven die metingen en ver onder de fout, want een boog die
     * de verkeerde kant om gaat maakt er in één keer ~100% van. */
    expect(sum / DISC, `stand ${rot.lon}/${rot.lat}`).toBeGreaterThan(0);
    expect(sum / DISC, `stand ${rot.lon}/${rot.lat}`).toBeLessThan(0.25);
    // En geen enkele rechte lijn dwars over de bol; zelfde grens als de test
    // hierboven over alle landen.
    expect(worst, `stand ${rot.lon}/${rot.lat}`).toBeLessThan(VIEW.r * 0.1);
  }
});

test("de graticule dekt de hele bol en blijft binnen de schijf", () => {
  const lines = graticule(30, 5);
  expect(lines.length).toBe(5 + 12); // 5 breedtecirkels (−60…60), 12 meridianen
  const f = globeFrame({ lon: 20, lat: 30 }, VIEW);
  let drew = 0;
  for (const line of lines) {
    const { ops, sink } = recorder();
    if (!traceLine(line, f, sink)) continue;
    drew++;
    for (const o of ops) {
      if (o.op === "moveTo" || o.op === "lineTo") {
        expect(dist(o.x, o.y, VIEW.cx, VIEW.cy)).toBeLessThanOrEqual(VIEW.r + 1e-9);
      }
    }
  }
  expect(drew).toBe(lines.length);
});
