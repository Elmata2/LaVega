/* De wereldbol in de Valuta-tab, het rekenkundige deel: van graden naar pixels en
 * terug. Geen React, geen canvas, geen klok — alleen meetkunde, zodat de moeilijke
 * helft van een bol te testen is zonder hem te tekenen.
 *
 * WAAROM ORTHOGRAFISCH EN NIET EEN PERSPECTIEF. Orthografisch is wat je ziet als
 * je van heel ver naar een bol kijkt: de omtrek is een cirkel, en een punt op de
 * bol projecteert loodrecht op het vlak. Dat is precies het beeld van een fysieke
 * wereldbol op een meter afstand, en het heeft één eigenschap die de rest van dit
 * bestand mogelijk maakt: de afstand tot het midden van de schijf zegt alles over
 * of een punt zichtbaar is. Een perspectiefprojectie (fisheye) zou dichtbij iets
 * groter maken, en dan is de rand van het zichtbare deel geen cirkel meer maar
 * een cirkel die van de kijkafstand afhangt — meer wiskunde voor een verschil dat
 * op 420 px niemand ziet.
 *
 * DE STAND VAN DE BOL IS TWEE GETALLEN: welke lengte- en breedtegraad in het
 * midden van de schijf staan. Een derde as (kanteling van de horizon) zit er
 * bewust niet in. Die kán, maar een bol die scheef blijft hangen na een schuine
 * sleep voelt kapot, en met twee assen is "noord is boven" een garantie in plaats
 * van iets wat je moet herstellen.
 *
 * WAT HIER NIET IN ZIT: een animatie. Er is geen tussenstand, geen easing en geen
 * tijd in dit bestand. `dragRotation()` rekent een vingerbeweging om naar een
 * stand en dat is alles; naar een land toe DRAAIEN is dus één sprong (zie
 * Globe.tsx). Dat is een afspraak in dit project en geen toeval.
 *
 * DE PRESTATIE ZIT IN `prepareRing()`, en dat is nagemeten en niet aangenomen.
 * Sin en cos van een punt hangen NIET van de stand van de bol af, alleen van het
 * punt zelf. Ze worden dus één keer uitgerekend en in een Float64Array gelegd, en
 * daarna is een beeld alleen nog optellen en vermenigvuldigen.
 *
 * Opnieuw gemeten toen Antarctica erbij kwam (237 landen, 710 ringen, 12.440
 * punten, r = 208; Node 22, 400 standen achter elkaar):
 *
 *   voorbereiden   1,3 ms de eerste keer, 0,4 ms als de JIT warm is — eenmalig
 *   een heel beeld 0,31 ms, alle ringen afkappen en de bogen erbij
 *   zonder voorkauwen 1,33 ms per beeld
 *
 * `traceRing` raakt elk punt twee keer (één keer om te weten of het voor of
 * achter zit, één keer voor x/y), dus zonder voorkauwen zijn dat 12.440 × 8 =
 * 99.520 sin/cos per beeld. Die 1,33 ms is de eerlijke variant van "hetzelfde
 * werk met `project()` per punt", dus inclusief het object dat die functie per
 * punt teruggeeft; puur de trigonometrie is een stuk daarvan. Zo of zo: ruim vier
 * keer zo duur.
 *
 * Wat de vorige meting zei (11.580 punten, 0,34 ms per beeld, 2,1 ms
 * voorbereiden) klopt daar redelijk mee: 7% meer punten, en de 2,1 ms was een
 * koude eerste run. De volgorde van grootte is niet veranderd door Antarctica.
 *
 * Eerlijk over wat dat NIET zegt: 1 ms past ook in een beeld van 16 ms, dus het
 * was zonder dit niet stuk. Het kost eenmalig ruim een milliseconde en 389 kB om
 * vier keer goedkoper te zijn, en het VULLEN van 237 paden komt bij die 0,31 ms
 * nog bovenop — die ruimte is dus niet over.
 */
import type { LonLat, Ring } from "./assets/world-map.generated.js";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** De stand van de bol: deze lengte- en breedtegraad staan in het midden van de
 *  schijf. */
export type Rotation = { lon: number; lat: number };

/** Waar de schijf op het doek ligt. `r` is de radius in CSS-pixels; het middelpunt
 *  staat er los bij zodat de bol niet per se in het midden van het doek hoeft te
 *  liggen. */
export type Viewport = { cx: number; cy: number; r: number };

/** Een stand met de vier sinussen en cosinussen die elk punt van dat beeld nodig
 *  heeft, één keer uitgerekend. Zonder dit staan er vier trigonometrische
 *  aanroepen per PUNT in de tekenlus in plaats van vier per BEELD. */
export type GlobeFrame = {
  rot: Rotation;
  view: Viewport;
  sinLat0: number;
  cosLat0: number;
  sinLon0: number;
  cosLon0: number;
};

/** Lengtegraad terug naar het bereik van de tabel. −180 blijft −180 en wordt niet
 *  180: de bron knipt Rusland, Fiji en de Aleoeten op de datumgrens in twee
 *  vlakken, en die twee helften liggen in de tabel aan tegenovergestelde kanten.
 *  Een punt van de ene kant naar de andere verplaatsen zou dus van vlak
 *  verwisselen. */
export function wrapLon(lon: number): number {
  return (((lon + 180) % 360) + 360) % 360 - 180;
}

/** Een hoekverschil terug naar (−π, π]. Gebruikt om te meten hoe ver een pad in
 *  de projectie ronddraait; zonder dit springt een verschil van 1° over de
 *  −180/180-grens naar 359°. */
function wrapAngle(d: number): number {
  return (((d + Math.PI) % TAU) + TAU) % TAU - Math.PI;
}

/** De breedtegraad wordt GEKLEMD en de lengtegraad omgeslagen, en dat verschil is
 *  echt: doorschuiven in de lengte laat de bol ronddraaien (180 en −180 zijn
 *  hetzelfde punt), doorschuiven in de breedte zou hem over de pool heen kantelen
 *  en dan staat de wereld op zijn kop. Bij ±90 kijk je recht op de pool; dat is
 *  het einde van de sleep en niet een fout. */
export function normalizeRotation(rot: Rotation): Rotation {
  return { lon: wrapLon(rot.lon), lat: Math.max(-90, Math.min(90, rot.lat)) };
}

export function globeFrame(rot: Rotation, view: Viewport): GlobeFrame {
  const lat0 = rot.lat * DEG;
  const lon0 = rot.lon * DEG;
  return {
    rot,
    view,
    sinLat0: Math.sin(lat0),
    cosLat0: Math.cos(lat0),
    sinLon0: Math.sin(lon0),
    cosLon0: Math.cos(lon0),
  };
}

export type ProjectedPoint = {
  x: number;
  y: number;
  /** Zit dit punt op de zichtbare helft? */
  front: boolean;
  /** De cosinus van de hoek tot het midden van de schijf: 1 is pal in het midden,
   *  0 is precies op de rand (de limbus), −1 is het punt aan de andere kant van de
   *  aarde. Dit is het getal waar `front` uit volgt, en het staat erbij omdat de
   *  rand het lastige geval is: een punt met `toward` bijna 0 ligt op de limbus en
   *  daar hoort een vlak afgekapt te worden. */
  toward: number;
};

/** Eén punt projecteren. Dit is de vriendelijke variant — voor een speld, een
 *  test of een enkel label. De tekenlus gebruikt `traceRing()`, dat hetzelfde
 *  rekent maar met voorgekauwde sinussen.
 *
 *  y loopt naar BENEDEN, zoals op een doek. Noord is dus boven, en dat kost hier
 *  één minteken; het alternatief (de omkering in de component) zou dat minteken
 *  op elke aanroepplek zetten en precies één keer vergeten worden. */
export function project(lon: number, lat: number, frame: GlobeFrame): ProjectedPoint {
  const la = lat * DEG;
  const d = (lon - frame.rot.lon) * DEG;
  const sinLat = Math.sin(la);
  const cosLat = Math.cos(la);
  const sinD = Math.sin(d);
  const cosD = Math.cos(d);
  const X = cosLat * sinD;
  const Y = frame.cosLat0 * sinLat - frame.sinLat0 * cosLat * cosD;
  const Z = frame.sinLat0 * sinLat + frame.cosLat0 * cosLat * cosD;
  return {
    x: frame.view.cx + frame.view.r * X,
    y: frame.view.cy - frame.view.r * Y,
    front: Z > 0,
    toward: Z,
  };
}

/** Van een punt op het doek terug naar graden, of `null` als het punt BUITEN de
 *  schijf ligt.
 *
 *  Die null is het hele punt van deze functie. Een klik naast de bol is geen punt
 *  op de aarde, en hem naar de rand toe schuiven zou een klik verzinnen die
 *  niemand gedaan heeft — dan kies je een land omdat je ernaast klikte. De
 *  aanroeper hoort "hier is geen bol" te melden, niet "hier is water".
 *
 *  Dit is de inverse van `project()` en niet een tweede benadering: dezelfde
 *  formule van Snyder, omgekeerd. Daarom kan de bol het aanwijzen van een land
 *  overlaten aan `countryAtLonLat()` in worldMap.ts, dat al met de even-odd-regel
 *  meet waarmee ook getekend wordt. Het alternatief — een tweede, onzichtbaar
 *  canvas waarin elk land in zijn eigen kleur staat en de kleur onder de cursor
 *  het land is — is sneller op papier, maar het is een TWEEDE antwoord op "waar
 *  klikte ik": het rastert op hele pixels, het hangt aan devicePixelRatio en het
 *  weet niets van de dertien landen zonder vlak. Twee antwoorden op dezelfde
 *  vraag lopen een keer uit elkaar; deze weg heeft er één. */
export function unproject(x: number, y: number, frame: GlobeFrame): LonLat | null {
  const { cx, cy, r } = frame.view;
  if (!(r > 0)) return null;
  const dx = (x - cx) / r;
  const dy = (cy - y) / r; // op het doek loopt y naar beneden, in de meetkunde naar boven
  const rho2 = dx * dx + dy * dy;
  if (!(rho2 <= 1)) return null; // buiten de schijf — en NaN valt hier ook uit
  const cosc = Math.sqrt(1 - rho2);
  const lat = Math.asin(cosc * frame.sinLat0 + dy * frame.cosLat0);
  const lon = frame.rot.lon + Math.atan2(dx, cosc * frame.cosLat0 - dy * frame.sinLat0) / DEG;
  return [wrapLon(lon), lat / DEG];
}

/** Hoeveel graden draait de bol per gesleepte pixel. Lineair, met de radius erin:
 *  in het MIDDEN van de schijf volgt het punt onder de vinger daarmee exact (daar
 *  is 1 px precies 1/r radiaan), en naar de rand toe loopt de bol iets achter.
 *
 *  Dat is een keuze en niet een benadering-uit-luiheid. Exact overal meelopen kan
 *  wél — je draait dan om de as door het startpunt (een "versor"-sleep) — maar dan
 *  kantelt de horizon mee en blijft de bol scheef hangen zodra je schuin sleept.
 *  Bij het uitproberen voelde dat als een bol die uit je hand glipt; dit voelt als
 *  een bol op een as. */
export function dragDegreesPerPixel(view: Viewport): number {
  return view.r > 0 ? 180 / (Math.PI * view.r) : 0;
}

/** De stand na een sleep van (dx, dy) pixels ten opzichte van waar de vinger
 *  neerkwam. Met opzet gerekend vanaf de stand BIJ HET NEERKOMEN en niet stapje
 *  voor stapje: bij het optellen van losse stapjes klemt de breedtegraad
 *  onderweg op ±90 en dan komt de bol niet meer terug als je binnen dezelfde
 *  sleep omhoog gaat — hij "kleeft" aan de pool.
 *
 *  Het teken volgt de vinger: naar rechts slepen brengt wat links lag in het
 *  midden, dus de lengtegraad in het midden gaat OMLAAG. */
export function dragRotation(start: Rotation, dx: number, dy: number, view: Viewport): Rotation {
  const k = dragDegreesPerPixel(view);
  return normalizeRotation({ lon: start.lon - dx * k, lat: start.lat + dy * k });
}

/* --- ringen tekenen -------------------------------------------------------- */

/** Waar een ring naartoe getekend wordt. Dit is precies de doorsnede die een
 *  CanvasRenderingContext2D al heeft, zodat de tekenlus `traceRing(ring, frame,
 *  ctx)` kan doen zonder een tussenlaag die per beeld duizenden objecten
 *  aanmaakt. In de test staat er een sink die alles opschrijft; dat is hoe je
 *  kunt nakijken dat er geen lijn dwars over de bol loopt zonder een pixel te
 *  tekenen. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(cx: number, cy: number, r: number, from: number, to: number, ccw?: boolean): void;
  closePath(): void;
}

/** Een ring met per punt sin/cos van de breedte- en lengtegraad, vier getallen
 *  per punt achter elkaar. Een Float64Array en geen array van objecten: 11.580
 *  punten als objecten is 11.580 keer een pointer volgen per beeld, en dat was
 *  in de eerste versie de helft van de tijd. */
export type PreparedRing = Float64Array;

export const PREPARED_STRIDE = 4;

export function prepareRing(ring: Ring | readonly LonLat[]): PreparedRing {
  const out = new Float64Array(ring.length * PREPARED_STRIDE);
  for (let i = 0; i < ring.length; i++) {
    const la = ring[i][1] * DEG;
    const lo = ring[i][0] * DEG;
    out[i * 4] = Math.sin(la);
    out[i * 4 + 1] = Math.cos(la);
    out[i * 4 + 2] = Math.sin(lo);
    out[i * 4 + 3] = Math.cos(lo);
  }
  return out;
}

/** Het punt waar het lijnstuk P→Q de rand van de zichtbare helft kruist, als
 *  eenheidsvector in het projectievlak.
 *
 *  Dit is EXACT en niet een benadering, en dat is een fijn gevolg van hoe de data
 *  al lag. De grootcirkel door P en Q ligt in het vlak door P, Q en het
 *  middelpunt; de koorde P→Q ligt in datzelfde vlak. Het punt M op de koorde waar
 *  Z nul wordt ligt dus op de snijlijn van dat vlak met het vlak Z=0 — en die
 *  snijlijn gaat door de oorsprong. M op lengte 1 normaliseren geeft daarmee
 *  precies waar de grootcirkel de limbus raakt. Voorwaarde is dat de grens tussen
 *  twee punten ook echt als grootcirkel bedoeld is, en dat is waarom de datalaag
 *  stukken langer dan 5° heeft opgedeeld.
 *
 *  Als M in de oorsprong valt liggen P en Q recht tegenover elkaar in de
 *  projectie; dan is er geen richting te normaliseren en pakken we die van P. Dat
 *  kan alleen bij een lijnstuk dat vrijwel door de kijk-as loopt, en met stukken
 *  van maximaal 5° zit dat punt dan pal aan de rand — het verschil is
 *  onzichtbaar. */
function limbusCrossing(
  pX: number,
  pY: number,
  pZ: number,
  qX: number,
  qY: number,
  qZ: number,
): [number, number] {
  const t = pZ / (pZ - qZ);
  const mx = pX + t * (qX - pX);
  const my = pY + t * (qY - pY);
  const m = Math.hypot(mx, my);
  if (m > 1e-12) return [mx / m, my / m];
  const p = Math.hypot(pX, pY);
  return p > 1e-12 ? [pX / p, pY / p] : [1, 0];
}

/** Welke kant de boog over de limbus op moet: `true` is tegen de klok in (in
 *  canvas-hoeken: aflopend). `sweep` is hoeveel hoek het VERBORGEN stuk in de
 *  projectie heeft afgelegd, van het uitgangspunt naar het punt waar de ring weer
 *  in beeld komt — met teken, en mogelijk meer dan een hele slag.
 *
 *  De boog moet diezelfde verplaatsing maken. Er zijn maar twee mogelijkheden —
 *  met de klok mee (0…+2π) of ertegenin (−2π…0) — en de juiste is die welke het
 *  DICHTST bij `sweep` ligt.
 *
 *  DAT "DICHTST BIJ" IS DE HELE CLOU, en het heeft een echte fout gerepareerd.
 *  Eerst stond hier alleen het TEKEN van `sweep`, en dat is bijna altijd
 *  hetzelfde antwoord — maar niet als het verborgen stuk nauwelijks ronddraait.
 *  Gemeten geval: bij een stand rond 99° oost is van Groot-Brittannië een haartje
 *  zichtbaar, pal op de rand (Z = +0,035). De rest van de kust ligt er net achter
 *  en draait in de projectie nauwelijks; `sweep` was −0,5°. Dat teken koos de weg
 *  van 359° over de limbus — en dan is niet een sikkeltje Engeland gevuld maar de
 *  HELE bol, in de kleur van het Verenigd Koninkrijk. Op de schermafdruk was de
 *  wereld één blauw vlak met een paar eilandjes erop. Met "dichtst bij −0,5°"
 *  komt daar de boog van 1° uit, en dus het sikkeltje. Hetzelfde gold voor een
 *  klein vlak van de Verenigde Staten. */
function arcCounterclockwise(from: number, to: number, sweep: number): boolean {
  const forward = (((to - from) % TAU) + TAU) % TAU; // met de klok mee: 0…+2π
  const backward = forward - TAU; //                   ertegenin: −2π…0
  return Math.abs(backward - sweep) < Math.abs(forward - sweep);
}

/** Eén gesloten ring naar de sink, met de achterkant eraf. `false` betekent: er
 *  was niets zichtbaar (de hele ring zit achter de bol) en er is niets
 *  geschreven.
 *
 *  DIT IS HET LASTIGE STUK VAN EEN BOL. Een ring die half achter de bol zit mag
 *  je niet "gewoon de achterste punten weglaten en de rest doorverbinden": dan
 *  loopt er een rechte lijn dwars over de schijf en zie je Amerika door Azië
 *  heen. Wat hier gebeurt:
 *
 *   1. de ring wordt bij elke overgang voor/achter AFGEKAPT op de limbus, met het
 *      exacte snijpunt (zie limbusCrossing);
 *   2. het verborgen stuk tussen twee zichtbare stukken wordt vervangen door een
 *      BOOG over de limbus.
 *
 *  Stap 2 is waarom hier een `arc` in de sink zit en niet alleen lijnen. Zonder
 *  die boog sluit het canvas een half-verborgen land met een rechte koorde tussen
 *  de twee randpunten, en dan is Rusland bij een halve slag afgesneden met een
 *  liniaal — op een bol van 420 px is dat tientallen pixels Siberië die
 *  verdwijnen. Met de boog volgt de rand van het land de rand van de bol, wat het
 *  in het echt ook doet.
 *
 *  WELKE KANT DE BOOG OP GAAT is de enige echt subtiele beslissing — zie
 *  arcCounterclockwise, inclusief wat er misging toen daar alleen een teken stond.
 *
 *  WAT ER AAN ARTEFACT OVERBLIJFT, bewust: tussen twee opeenvolgende punten wordt
 *  een RECHTE lijn getekend, ook pal aan de rand waar de projectie het sterkst
 *  kromt. Een grootcirkel van 5° projecteert daar naar een lichte boog en wij
 *  tekenen de koorde; dat is op de rand van de schijf ten hoogste een fractie van
 *  een pixel bij kleine stukken en zichtbaar als lichte "hoekigheid" bij de
 *  langste. Het exact volgen zou betekenen dat elk lijnstuk per beeld verder
 *  opgedeeld wordt naar hoe schuin het staat, en dat is rekenwerk per punt per
 *  beeld voor een verschil dat je alleen ziet als je ernaar zoekt. */
export function traceRing(ring: PreparedRing, frame: GlobeFrame, sink: PathSink): boolean {
  const n = (ring.length / PREPARED_STRIDE) | 0;
  if (n < 3) return false;
  const { cx, cy, r } = frame.view;
  const sl0 = frame.sinLat0;
  const cl0 = frame.cosLat0;
  const so0 = frame.sinLon0;
  const co0 = frame.cosLon0;

  /* Alleen Z, voor de vraag "zit dit punt aan de voorkant". Twee keer per punt
   * uitrekenen (hier en straks) is goedkoper dan een hulparray van 11.580
   * getallen per beeld aanmaken — en het houdt dit bestand zonder verborgen
   * toestand tussen aanroepen. */
  const zAt = (i: number): number => {
    const b = i * 4;
    const cosD = ring[b + 3] * co0 + ring[b + 2] * so0;
    return sl0 * ring[b] + cl0 * ring[b + 1] * cosD;
  };

  let fronts = 0;
  let start = -1;
  let prevFront = zAt(n - 1) > 0;
  for (let i = 0; i < n; i++) {
    const f = zAt(i) > 0;
    if (f) {
      fronts++;
      if (!prevFront && start < 0) start = i;
    }
    prevFront = f;
  }
  if (fronts === 0) return false;

  // X, Y en Z van één punt. Alles hierna rekent in eenheden van de bol; pas bij
  // het schrijven naar de sink gaat het maal r.
  let X = 0;
  let Y = 0;
  let Z = 0;
  const at = (i: number): void => {
    const b = i * 4;
    const sinD = ring[b + 2] * co0 - ring[b + 3] * so0;
    const cosD = ring[b + 3] * co0 + ring[b + 2] * so0;
    X = ring[b + 1] * sinD;
    Y = cl0 * ring[b] - sl0 * ring[b + 1] * cosD;
    Z = sl0 * ring[b] + cl0 * ring[b + 1] * cosD;
  };

  if (fronts === n) {
    // Helemaal zichtbaar: een gewone gesloten veelhoek, geen limbus in zicht.
    at(0);
    sink.moveTo(cx + r * X, cy - r * Y);
    for (let i = 1; i < n; i++) {
      at(i);
      sink.lineTo(cx + r * X, cy - r * Y);
    }
    sink.closePath();
    return true;
  }

  /* Gemengd. We beginnen bij `start`: dat punt is zichtbaar en zijn voorganger
   * niet, dus de eerste stap is altijd een binnenkomst op de limbus en de laatste
   * stap zit altijd in een verborgen stuk. Dat maakt het afsluiten na de lus
   * onvoorwaardelijk. */
  at((start - 1 + n) % n);
  let pX = X;
  let pY = Y;
  let pZ = Z;
  let inPiece = false;
  let firstEntry = 0;
  let lastExit = 0;
  let hiddenFrom = 0;
  let sweep = 0;

  for (let k = 0; k < n; k++) {
    at((start + k) % n);
    const cX = X;
    const cY = Y;
    const cZ = Z;
    if (cZ > 0) {
      if (!inPiece) {
        const [ex, ey] = limbusCrossing(cX, cY, cZ, pX, pY, pZ);
        const a = Math.atan2(-ey, ex);
        if (k === 0) {
          sink.moveTo(cx + r * ex, cy - r * ey);
          firstEntry = a;
        } else {
          sink.arc(cx, cy, r, lastExit, a, arcCounterclockwise(lastExit, a, sweep));
        }
        inPiece = true;
      }
      sink.lineTo(cx + r * cX, cy - r * cY);
    } else {
      if (inPiece) {
        const [ex, ey] = limbusCrossing(pX, pY, pZ, cX, cY, cZ);
        sink.lineTo(cx + r * ex, cy - r * ey);
        lastExit = Math.atan2(-ey, ex);
        hiddenFrom = lastExit;
        sweep = 0;
        inPiece = false;
      }
      /* De hoek van een VERBORGEN punt in de projectie. Het punt zelf ligt binnen
       * de schijf en wordt niet getekend; alleen de richting waarin het van het
       * midden af ligt telt, want die richting is wat de boog moet volgen. Pal op
       * de kijk-as-tegenpool is die richting onbepaald (atan2(0,0) geeft 0); dat
       * zet de som iets scheef en kan alleen bij een ring die bijna een halve bol
       * beslaat. */
      const a = Math.atan2(-cY, cX);
      sweep += wrapAngle(a - hiddenFrom);
      hiddenFrom = a;
    }
    pX = cX;
    pY = cY;
    pZ = cZ;
  }

  sweep += wrapAngle(firstEntry - hiddenFrom);
  sink.arc(cx, cy, r, lastExit, firstEntry, arcCounterclockwise(lastExit, firstEntry, sweep));
  sink.closePath();
  return true;
}

/** Een OPEN lijn (geen ring): elk zichtbaar stuk wordt een eigen subpad, tot aan
 *  de limbus afgekapt. Voor de graticule — de meridianen en breedtecirkels.
 *
 *  Die lijnen zijn niet decoratie. Een gevulde cirkel met continenten erop leest
 *  als een sticker; pas met een raster erop ziet een mens dat het ding DRAAIT, en
 *  dat is het hele verschil tussen een plaatje en een bol die je kunt pakken. Ze
 *  gaan hier langs omdat het afkappen op de rand hetzelfde probleem is als bij een
 *  ring — alleen zonder boog, want een lijn heeft geen binnenkant om te sluiten. */
export function traceLine(line: PreparedRing, frame: GlobeFrame, sink: PathSink): boolean {
  const n = (line.length / PREPARED_STRIDE) | 0;
  if (n < 2) return false;
  const { cx, cy, r } = frame.view;
  const sl0 = frame.sinLat0;
  const cl0 = frame.cosLat0;
  const so0 = frame.sinLon0;
  const co0 = frame.cosLon0;
  let X = 0;
  let Y = 0;
  let Z = 0;
  const at = (i: number): void => {
    const b = i * 4;
    const sinD = line[b + 2] * co0 - line[b + 3] * so0;
    const cosD = line[b + 3] * co0 + line[b + 2] * so0;
    X = line[b + 1] * sinD;
    Y = cl0 * line[b] - sl0 * line[b + 1] * cosD;
    Z = sl0 * line[b] + cl0 * line[b + 1] * cosD;
  };

  let drew = false;
  let open = false;
  let pX = 0;
  let pY = 0;
  let pZ = 0;
  for (let i = 0; i < n; i++) {
    at(i);
    const cX = X;
    const cY = Y;
    const cZ = Z;
    if (cZ > 0) {
      if (!open) {
        if (i > 0) {
          const [ex, ey] = limbusCrossing(cX, cY, cZ, pX, pY, pZ);
          sink.moveTo(cx + r * ex, cy - r * ey);
          sink.lineTo(cx + r * cX, cy - r * cY);
        } else {
          sink.moveTo(cx + r * cX, cy - r * cY);
        }
        open = true;
        drew = true;
      } else {
        sink.lineTo(cx + r * cX, cy - r * cY);
      }
    } else if (open) {
      const [ex, ey] = limbusCrossing(pX, pY, pZ, cX, cY, cZ);
      sink.lineTo(cx + r * ex, cy - r * ey);
      open = false;
    }
    pX = cX;
    pY = cY;
    pZ = cZ;
  }
  return drew;
}

/** De graticule als lijsten van graden: breedtecirkels en meridianen elke
 *  `stepDeg` graden. Hier en niet in de component, omdat het bij de projectie
 *  hoort en omdat een test er dan bij kan.
 *
 *  De punten staan 5° uit elkaar, precies zoals de landsgrenzen: fijner is
 *  onzichtbaar en grover laat een breedtecirkel bij de rand hoekig worden. */
export function graticule(stepDeg = 30, sampleDeg = 5): PreparedRing[] {
  const out: PreparedRing[] = [];
  for (let lat = -90 + stepDeg; lat <= 90 - stepDeg + 1e-9; lat += stepDeg) {
    const ring: LonLat[] = [];
    for (let lon = -180; lon <= 180 + 1e-9; lon += sampleDeg) ring.push([lon, lat]);
    out.push(prepareRing(ring));
  }
  for (let lon = -180; lon < 180 - 1e-9; lon += stepDeg) {
    const ring: LonLat[] = [];
    for (let lat = -90; lat <= 90 + 1e-9; lat += sampleDeg) ring.push([lon, lat]);
    out.push(prepareRing(ring));
  }
  return out;
}
