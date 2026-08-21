import { useEffect, useMemo, useRef, useState } from "react";
import {
  WORLD_LATLON_BOUNDS,
  WORLD_MAP_FILL_RULE,
  WORLD_MAP_SOURCES,
  allCountries,
  conversionFor,
  countryAtLonLat,
  countryFocus,
  countryLabel,
  mapCountries,
  searchCountries,
  type WorldCountry,
  type WorldCurrency,
} from "../worldMap.js";
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
  type PreparedRing,
  type Rotation,
  type Viewport,
} from "../globeProjection.js";

/* De draaibare wereldbol in de Valuta-tab: een derde manier om de DOELVALUTA te
 * kiezen, naast het dropdown en het kiezen van een rekening. Je denkt zelden
 * "USD", je denkt "Japan".
 *
 * DIT VERVANGT DE PLATTE KAART (components/WorldMap.tsx, verwijderd). Wat er van
 * die kaart is overgenomen is niet de vorm maar het GEDRAG, want dat was het
 * moeilijke deel en het was af:
 *
 *   - de bol is alleen een INVOER. Valuta.tsx houdt de bedragen, de middenkoers
 *     en de rangschikking van banken; hier wordt alleen `to` gezet. Er stond hier
 *     eerder een eigen "wat kost het daarheen" en dat liep binnen een dag uit de
 *     pas met het paneel ernaast — twee schermen die over hetzelfde bedrag iets
 *     anders zeggen is erger dan één scherm zonder bol.
 *   - daarom wordt `onPick` NIET altijd aangeroepen. Een land geeft vijf soorten
 *     antwoord (zie worldMap.ts) en maar twee daarvan zijn een valuta waar de
 *     berekening mee verder kan:
 *       euro      → doelvaluta naar EUR, en het paneel zegt het echte antwoord:
 *                   vanuit euro's valt er niets te wisselen. Dat is geen tarief
 *                   van nul, er is geen tarief.
 *       priceable → doelvaluta om, de berekening rekent verder.
 *       choice    → de bol kiest NIETS en vraagt welke valuta. In Panama kennen
 *                   wij de dollar wel en de balboa niet; "de eerste pakken"
 *                   verandert het antwoord.
 *       noRate    → doelvaluta blijft staan en het paneel noemt de oorzaak: wij
 *                   hebben geen koers. Een doelvaluta zetten waar de berekening
 *                   geen koers voor heeft levert een leeg <select> en een
 *                   "onbekend" zonder uitleg.
 *       unknown   → de bron noemt geen valuta. Ook dat is geen nul.
 *   - PRIJSBAAR VOLGENS DE LIVE LIJST (`supported`), niet volgens de vlag uit de
 *     bundel. Die vlag zegt of de valuta op de dag van de sweep in de ECB-lijst
 *     stond; de tab rekent vandaag met /api/fx/rate. Een bol die een valuta
 *     aanbiedt die het <select> ernaast niet kent, is stuk. De vlag is de
 *     terugval als er geen lijst meekomt.
 *
 * WAT ER NIEUW IS EN WAAROM HET ANDERS MOEST.
 *
 * 1. EEN CANVAS, GEEN SVG-PADEN. De platte kaart was 236 <path>-elementen met een
 *    vast `d`. Op een bol verandert élk punt bij élke graad draaien, dus dat zou
 *    236 attribuutmutaties per sleepbeeld zijn — dat is precies waar de browser
 *    het langzaamst in is. Nu wordt er per beeld één keer getekend. Gemeten op
 *    deze data (236 landen, 649 ringen, 11.580 punten, r = 208): het voorbereiden
 *    kost 2,1 ms éénmalig en het herprojecteren van alles plus de graticule
 *    0,36 ms per beeld. Dat is de MEETKUNDE; het vullen van die 236 paden doet de
 *    browser daar bovenop, en dat is niet in Node te meten.
 * 2. AANWIJZEN GAAT VIA DE OMGEKEERDE PROJECTIE, niet via een tweede canvas met
 *    een kleur per land. Die kleurtruc is sneller op papier, maar het is een
 *    TWEEDE antwoord op "waar klikte ik": hij rastert op hele pixels, hij hangt
 *    aan devicePixelRatio en hij weet niets van de dertien landen zonder vlak.
 *    `unproject()` + `countryAtLonLat()` is exact, kost gemeten 15 µs per
 *    muisbeweging, en gebruikt dezelfde even-odd-regel als het tekenen — één
 *    antwoord in plaats van twee die op een dag uit elkaar lopen.
 * 3. EEN CANVAS BESTAAT NIET VOOR EEN SCHERMLEZER. De platte kaart had 236
 *    aanklikbare paden met een verschuivende focus; op een doek is daar niets van
 *    over. Daarom staat de LANDENLIJST ernaast en is die niet de terugval maar de
 *    tweede volwaardige besturing: één tabstop, alle 249 landen (ook de dertien
 *    zonder vlak), pijltjes lopen erdoor, Enter kiest, en typen filtert. Het doek
 *    heeft een beschrijving en is met de pijltjes te draaien, maar wie hem niet
 *    ziet mist niets: alles wat de bol kan, kan de lijst ook.
 * 4. NAAR EEN LAND TOEDRAAIEN gebeurt in één sprong. Er zit geen tussenstand in
 *    en dat is geen bezuiniging: bewegen loopt in dit project via een eigen laag,
 *    dus een bol die naar Japan toe glijdt is een besluit dat daar hoort. Slepen
 *    is geen animatie — daar beweegt de vinger.
 *
 * ER WORDT NIETS OPGEHAALD. De grenzen staan in de bundel (assets/GEODATA.md).
 * Een tile-request zou die server vertellen naar welk land iemand kijkt, en in
 * deze tab is dat "waar ga ik heen". */

export type GlobeProps = {
  /** De doelvaluta van de omwisselberekening zoals die nu staat. */
  value: string;
  /** Zet de doelvaluta. Wordt alleen aangeroepen met een valuta waarvoor de tab
   *  een koers heeft. */
  onPick: (code: string) => void;
  /** Waar het geld nu in staat. Alleen nodig om het euro-antwoord precies te
   *  krijgen: vanuit euro's valt er niets te wisselen, vanuit dollars wel. */
  from?: string;
  /** De valuta's waarvoor de tab een koers heeft. Afwezig of leeg: dan valt de
   *  bol terug op de `priceable`-vlag uit de bundel. */
  supported?: readonly string[];
};

/** De maat van het doek in CSS-pixels als er nog niets gemeten is. Ook de maat in
 *  een test, want jsdom heeft geen layout: `getBoundingClientRect()` is daar
 *  0×0. Een vaste beginmaat maakt het middelpunt van de bol daardoor
 *  voorspelbaar, en dat is precies wat een test over klikken nodig heeft. */
export const DEFAULT_SIZE = 420;
const MIN_SIZE = 220;
const MAX_SIZE = 460;

/** Ruimte tussen de rand van de bol en de rand van het doek, zodat de rand-stroke
 *  er niet half afvalt. */
const EDGE_PAD = 2;

/** Waar de schijf op het doek ligt bij een gegeven maat. Geëxporteerd omdat een
 *  test die op de bol klikt moet kunnen uitrekenen waar een land op het doek
 *  terechtkomt — die berekening mag hij niet zelf naschrijven, want dan meet hij
 *  zijn eigen kopie en niet wat de gebruiker aanwijst. */
export function globeViewport(size: number): Viewport {
  return { cx: size / 2, cy: size / 2, r: size / 2 - EDGE_PAD };
}

/** Waar de bol op staat als de tab opengaat: de Middellandse Zee. Niet Nederland
 *  in het midden — dan staat de helft van de bol vol Noordpool en zie je Amerika
 *  noch Azië. Vanaf hier zijn Europa, Afrika en de rand van beide Amerika's in
 *  beeld, en dat is waar de meeste bestemmingen liggen. */
const START_ROTATION: Rotation = { lon: 8, lat: 30 };

/** Hoeveel graden één pijltjestoets draait. 10° is ongeveer een land in Europa en
 *  ongeveer een provincie in Rusland; kleiner en je tikt jezelf een ongeluk naar
 *  Japan. */
const KEY_STEP = 10;

/** Onder deze afstand (in CSS-pixels) is een sleep geen sleep maar een klik. Nul
 *  kan niet: een vinger op glas beweegt altijd een pixel of twee, en dan zou
 *  aanwijzen op een telefoon nooit werken. */
const CLICK_SLOP = 4;

/** Een land dat in graden kleiner is dan dit krijgt een speld in plaats van
 *  alleen zijn vlak. Gemeten op de bundel: Singapore is 0,35° × 0,18° en dat is
 *  op een bol van 420 px ruim één pixel; Monaco en Vaticaanstad zijn kleiner nog.
 *  Zonder speld kies je die landen wel en zie je niets veranderen. */
const PIN_MAX_SPAN = 3;

const TAU = Math.PI * 2;

/** Hoeveel echte pixels er in één CSS-pixel gaan, afgetopt op 2. Een telefoon met
 *  factor 3 zou van een bol van 460 px een doek van 1380 × 1380 maken en dat is
 *  1,9 miljoen pixels vullen per sleepbeeld voor een scherpte die niemand op die
 *  afstand ziet. */
function pixelRatio(): number {
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  return Math.min(2, Math.max(1, dpr));
}

/** Welke kleurgroep een land krijgt. Dit gaat over ONS, niet over het land:
 *  "geen koers" is een leemte aan onze kant en de legenda zegt dat ook zo. */
type Tone = "euro" | "rate" | "norate";

/** Elk land één keer voorgekauwd. Dit staat buiten de component omdat het niet van
 *  props afhangt en 2,1 ms kost: bij het openen van een andere tab en weer terug
 *  zou dat er anders elke keer bij komen. Lui, want wie de Valuta-tab nooit
 *  opent, hoeft er ook niet voor te betalen. */
type Land = { c: WorldCountry; tone: Tone; rings: PreparedRing[] };
let PREPARED: { c: WorldCountry; rings: PreparedRing[] }[] | null = null;
let GRID: PreparedRing[] | null = null;

function preparedLands(): { c: WorldCountry; rings: PreparedRing[] }[] {
  if (!PREPARED) PREPARED = mapCountries().map((c) => ({ c, rings: c.rings.map((r) => prepareRing(r)) }));
  return PREPARED;
}
function preparedGrid(): PreparedRing[] {
  if (!GRID) GRID = graticule(30, 5);
  return GRID;
}

function tone(c: WorldCountry, canPrice: (x: WorldCurrency) => boolean): Tone {
  if (c.currencies.length > 0 && c.currencies.every((x) => x.code === "EUR")) return "euro";
  return c.currencies.some(canPrice) ? "rate" : "norate";
}

/** Wat de bol met een land kan doen, nadat de live koerslijst erover heen is
 *  gelegd. Losgetrokken van `conversionFor` omdat "wij kennen deze valuta wel,
 *  maar de tab van vandaag niet" hetzelfde gevolg heeft als "wij kennen hem
 *  niet" — en dat mag niet twee keer in de JSX staan. */
type Effect =
  | { kind: "euro" }
  | { kind: "set"; code: string }
  | { kind: "noRate"; code: string }
  | { kind: "choice"; currencies: readonly WorldCurrency[] }
  | { kind: "unknown" };

function resolve(id: string, canPrice: (c: WorldCurrency) => boolean): Effect {
  const answer = conversionFor(id);
  switch (answer.kind) {
    case "euro":
      return { kind: "euro" };
    case "choice":
      return { kind: "choice", currencies: answer.currencies };
    case "priceable":
    case "noRate":
      return canPrice(answer.currency)
        ? { kind: "set", code: answer.currency.code }
        : { kind: "noRate", code: answer.currency.code };
    default:
      return { kind: "unknown" };
  }
}

/** "Amerikaanse dollar (USD)", of gewoon "USD" als het platform de code niet
 *  kent. Nooit een lege string: een melding zonder de code erin is voor de
 *  gebruiker niet na te trekken. */
function currencyLabel(code: string): string {
  try {
    const name = new Intl.DisplayNames(["nl"], { type: "currency" }).of(code);
    return name && name.toUpperCase() !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

/** Waarmee er in dit land betaald wordt, kort. Leeg is hier "valuta onbekend" en
 *  niet een streepje: een streepje leest als nul. */
function codesOf(c: WorldCountry): string {
  return c.currencies.length === 0 ? "valuta onbekend" : c.currencies.map((x) => x.code).join(" / ");
}

/* --- kleuren -------------------------------------------------------------- */

/** De kleuren die het doek nodig heeft. Een canvas kan geen `var(--token)`, dus
 *  moeten ze als string bekend zijn — en dat is precies waar een tweede palet
 *  ontstaat dat na een themawijziging gaat afwijken.
 *
 *  Daarom staat er GEEN kleur in dit bestand. In worldmap.css staat per rol een
 *  onzichtbaar spannetje met `color: var(--lv-globe-…)`, en hier wordt de
 *  BEREKENDE `color` van dat spannetje gelezen. Dat is de enige manier om een
 *  color-mix() op tokens als echte kleur terug te krijgen: de berekende waarde
 *  van een custom property is de tekst zoals hij er staat ("color-mix(in srgb,
 *  var(--accent) …)"), met de var() er nog ongereduceerd in, en daar kan een
 *  canvas niets mee. `color` is een echte eigenschap en komt er als rgb() uit.
 *
 *  Eén keer per doek gelezen en niet per beeld: getComputedStyle dwingt de
 *  browser tot een stijlberekening, en dat per sleepbeeld doen kost meer dan het
 *  hele tekenen. De app heeft vandaag één thema; komt er een tweede, dan hoort
 *  hier een herlezing bij het omschakelen. */
const INK_ROLES = ["sea", "grid", "rim", "euro", "rate", "norate", "hover", "selected", "pin"] as const;
type Palette = Record<(typeof INK_ROLES)[number], string>;

function readPalette(host: HTMLElement): Palette | null {
  if (typeof getComputedStyle !== "function") return null;
  const out = {} as Palette;
  for (const role of INK_ROLES) {
    const probe = host.querySelector<HTMLElement>(`[data-ink="${role}"]`);
    const value = probe ? getComputedStyle(probe).color : "";
    /* Niets teruggekregen betekent dat het stijlblad er (nog) niet is. Dan wordt
     * er niet getekend in plaats van dat hier een hex-waarde wordt verzonnen die
     * bij het volgende thema fout staat — de lijst ernaast werkt gewoon door. */
    if (!value || value === "rgba(0, 0, 0, 0)") return null;
    out[role] = value;
  }
  return out;
}

/* --- de component --------------------------------------------------------- */

export default function Globe({ value, onPick, from = "EUR", supported }: GlobeProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** Bij een land met meer dan één valuta: welke de gebruiker aanwees. Null is
   *  "nog niet gekozen" en dan blijft de vraag staan. */
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [dragging, setDragging] = useState(false);
  /** Er is geklikt, maar er zat geen land. Dat is een antwoord en geen fout, en
   *  het hoort met de echte oorzaak op het scherm te komen — anders zoekt iemand
   *  de klik nog vier keer. */
  const [miss, setMiss] = useState<null | "off" | "sea" | "polar">(null);

  const figureRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const rotRef = useRef<Rotation>(START_ROTATION);
  const rafRef = useRef<number | null>(null);
  const paintRef = useRef<() => void>(() => {});
  const paletteRef = useRef<Palette | null>(null);
  /** `undefined` = nog niet gevraagd. Eén keer vragen, want in een omgeving
   *  zonder 2D-context (jsdom in de test) klaagt elke aanroep opnieuw. */
  const ctxRef = useRef<CanvasRenderingContext2D | null | undefined>(undefined);
  const dragRef = useRef({ active: false, sx: 0, sy: 0, rot: START_ROTATION, moved: false });

  const supportedSet = useMemo(
    () => (supported && supported.length > 0 ? new Set(supported.map((c) => c.toUpperCase())) : null),
    [supported],
  );
  const canPrice = useMemo(
    () => (c: WorldCurrency) => (supportedSet ? supportedSet.has(c.code) : c.priceable),
    [supportedSet],
  );
  const lands = useMemo<Land[]>(
    () => preparedLands().map((p) => ({ ...p, tone: tone(p.c, canPrice) })),
    [canPrice],
  );

  const view = useMemo<Viewport>(() => globeViewport(size), [size]);

  /* --- tekenen ----------------------------------------------------------- */

  /* Elke render wordt de tekenfunctie opnieuw gemaakt (hij leest de selectie, de
   * hover en het palet) en in een ref gelegd. Het slepen tekent daarna via die
   * ref, zónder een React-render — en daarom staat de STAND VAN DE BOL in een ref
   * en niet in state.
   *
   * De reden is de lijst ernaast: 249 <li>. Zet de stand in state en elke
   * pointermove is een render van die 249 regels, die er allemaal hetzelfde uit
   * blijven zien. Dat is werk zonder uitkomst. Eerlijk gezegd: dit is niet
   * gemeten maar vermeden — ik heb nooit een versie gebouwd waarin de stand in
   * state stond, dus ik kan niet zeggen hoeveel het kost, alleen dat het niets
   * oplevert. Wat wél gemeten is, staat in de kop: 0,34 ms per beeld voor de
   * meetkunde. */
  paintRef.current = () => {
    const canvas = canvasRef.current;
    const host = figureRef.current;
    if (!canvas || !host) return;
    if (ctxRef.current === undefined) {
      try {
        ctxRef.current = canvas.getContext("2d");
      } catch {
        ctxRef.current = null;
      }
    }
    const ctx = ctxRef.current;
    if (!ctx) return; // geen doek om op te tekenen; de lijst werkt door
    if (!paletteRef.current) paletteRef.current = readPalette(host);
    const palette = paletteRef.current;
    if (!palette) return;

    const dpr = pixelRatio();
    const frame = globeFrame(rotRef.current, view);
    const { cx, cy, r } = view;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // De zee is de bol zelf: één gevulde cirkel. Alles daarna ligt erop.
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = palette.sea;
    ctx.fill();

    /* Alles binnen de schijf houden. `traceRing` levert nooit een punt buiten de
     * bol, maar een stroke van 1 px steekt er wel half uit; met deze clip is de
     * rand van de bol een harde rand en niet een rafel. */
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.clip();

    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (const line of preparedGrid()) traceLine(line, frame, ctx);
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    /* Per land één pad en één vulling, en met opzet niet drie grote paden per
     * kleurgroep. Dat zou 236 vullingen terugbrengen tot 3, maar de even-odd-regel
     * werkt dan over landen HEEN: Vaticaanstad ligt binnen het vlak van Italië en
     * is ook "euro", dus Rome zou een gat krijgen. */
    const paint = (land: Land, color: string) => {
      ctx.beginPath();
      let any = false;
      for (const ring of land.rings) any = traceRing(ring, frame, ctx) || any;
      if (!any) return;
      ctx.fillStyle = color;
      ctx.fill(WORLD_MAP_FILL_RULE);
      /* De stroke is geen decoratie maar een reparatie: elk land is los
       * vereenvoudigd, dus tussen twee buurlanden staat een haarlijn van een
       * fractie van een graad. Dezelfde kleur als de vulling dicht die. */
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    for (const land of lands) if (land.c.id !== hoverId && land.c.id !== selectedId) paint(land, palette[land.tone]);
    /* Aangewezen en gekozen gaan er bovenop, en in die volgorde: het gekozen land
     * blijft het gekozen land ook als de muis ergens anders hangt. Ze apart
     * overtekenen in plaats van in de lus mee te kleuren scheelt niets in
     * rekenwerk en voorkomt dat de stroke van een buurland eroverheen valt. */
    for (const land of lands) if (land.c.id === hoverId && land.c.id !== selectedId) paint(land, palette.hover);
    for (const land of lands) if (land.c.id === selectedId) paint(land, palette.selected);

    /* De speld. Voor een land dat te klein is om te zien en voor de dertien
     * landen zonder vlak: zonder dit kies je Singapore en verandert er niets
     * zichtbaar op de bol. */
    if (selectedId) {
      const focus = countryFocus(selectedId);
      const c = lands.find((l) => l.c.id === selectedId)?.c;
      const tiny = !focus?.span || Math.max(focus.span[0], focus.span[1]) < PIN_MAX_SPAN;
      const at = c?.pin ?? focus?.center ?? null;
      if (at && (tiny || !c)) {
        const p = project(at[0], at[1], frame);
        if (p.front) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, TAU);
          ctx.fillStyle = palette.pin;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = palette.sea;
          ctx.stroke();
        }
      }
    }

    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.strokeStyle = palette.rim;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  /** Eén beeld per animatieframe, hoeveel pointermove-gebeurtenissen er ook
   *  binnenkomen. Dit is geen animatie: er wordt niets bewogen dat niet door de
   *  vinger bewogen wordt, er is geen tijdlijn en geen easing. Het is alleen de
   *  rem op "acht keer tekenen tussen twee beelden". */
  function schedule() {
    if (rafRef.current !== null) return;
    if (typeof requestAnimationFrame !== "function") {
      paintRef.current();
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paintRef.current();
    });
  }

  // Na elke render opnieuw tekenen: de selectie, de hover of de maat kan gewijzigd
  // zijn, en het doek onthoudt niets van zichzelf.
  useEffect(() => {
    paintRef.current();
  });

  useEffect(
    () => () => {
      if (rafRef.current !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  /* De maat van het doek volgt de kolom waarin hij staat. ResizeObserver en niet
   * een window-resize-luisteraar: de kolom kan ook smaller worden zonder dat het
   * venster verandert (het paneel ernaast dat uitklapt). Bestaat hij niet, dan
   * blijft de beginmaat staan — een bol van 420 px is geen fout, alleen niet
   * meegegroeid. */
  useEffect(() => {
    const host = figureRef.current;
    if (!host || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setSize(Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.floor(w))));
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  /* --- kiezen ------------------------------------------------------------- */

  /** `turn` staat aan als de keuze uit de LIJST komt: dan draait de bol naar het
   *  land toe, want anders zoek je iets op dat aan de achterkant zit. Bij een
   *  klik op de bol staat hij uit — de plek waar je net klikte onder je vinger
   *  wegtrekken is precies wat een kaart niet moet doen. */
  function select(id: string, turn: boolean) {
    setSelectedId(id);
    setPickedCode(null);
    setMiss(null);
    if (turn) {
      const focus = countryFocus(id);
      /* Geen focus betekent: wij weten niet waar dit land ligt (acht landen
       * hebben vlak noch labelpunt). Dan draait de bol NIET naar [0, 0] — dat is
       * een plek in de Golf van Guinee — en zegt het paneel eronder dat wij het
       * niet weten. */
      if (focus) {
        rotRef.current = normalizeRotation({ lon: focus.center[0], lat: focus.center[1] });
        schedule();
      }
    }
    const effect = resolve(id, canPrice);
    if (effect.kind === "euro") onPick("EUR");
    if (effect.kind === "set") onPick(effect.code);
  }

  /** Een valuta uit het keuzelijstje. Onprijsbaar mag óók aangewezen worden — dan
   *  legt het paneel uit waarom er niets verandert. Een knop die niets doet en
   *  niets zegt is de derde regel schenden. */
  function pickCurrency(c: WorldCurrency) {
    setPickedCode(c.code);
    if (canPrice(c)) onPick(c.code);
  }

  /* --- de bol aanwijzen en draaien --------------------------------------- */

  /** Van een gebeurtenis naar een punt op het doek in CSS-pixels.
   *
   *  De omrekening met `rect.width` vangt op dat het doek door CSS breder of
   *  smaller getekend kan zijn dan de maat die wij aanhouden (zoom, of een kolom
   *  die tussen twee metingen smaller werd). Is die rechthoek leeg — jsdom heeft
   *  geen layout — dan is 1:1 het enige zinnige antwoord, en dat maakt de
   *  klikproef in de test mogelijk. */
  function localPoint(e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = rect.width > 0 ? size / rect.width : 1;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  }

  function countryAtPoint(x: number, y: number): { id: string | null; miss: "off" | "sea" | "polar" | null } {
    const at = unproject(x, y, globeFrame(rotRef.current, view));
    if (!at) return { id: null, miss: "off" };
    const c = countryAtLonLat(at[0], at[1]);
    if (c) return { id: c.id, miss: null };
    /* Onder de onderrand van de bundel houdt onze data op. Dat is een ander
     * antwoord dan "hier is zee": wij hebben daar niets, en wat er wél ligt kan
     * deze tabel niet zeggen. De melding zegt dus wat ONS mankeert en niet wat
     * daar is — "daar is water" zou een bewering zijn die de leemte niet draagt. */
    return { id: null, miss: at[1] < WORLD_LATLON_BOUNDS[1] ? "polar" : "sea" };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = localPoint(e);
    dragRef.current = { active: true, sx: p.x, sy: p.y, rot: rotRef.current, moved: false };
    setDragging(true);
    const el = e.currentTarget;
    /* Zonder pointer capture stopt een sleep zodra de vinger het doek verlaat.
     * Oudere browsers en jsdom hebben hem niet; dan is dat het gedrag, en dat is
     * hinderlijk maar niet stuk. */
    if (typeof el.setPointerCapture === "function" && Number.isFinite(e.pointerId)) {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* mag mislukken; de sleep werkt dan alleen binnen het doek */
      }
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = localPoint(e);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const d = dragRef.current;
    if (d.active) {
      const dx = p.x - d.sx;
      const dy = p.y - d.sy;
      if (Math.abs(dx) + Math.abs(dy) > CLICK_SLOP) d.moved = true;
      rotRef.current = dragRotation(d.rot, dx, dy, view);
      schedule();
      return;
    }
    // Aanwijzen kost gemeten 15 µs; alleen bij een ANDER land een render.
    const hit = countryAtPoint(p.x, p.y);
    if (hit.id !== hoverId) setHoverId(hit.id);
  }

  function endDrag(e: React.PointerEvent<HTMLCanvasElement>, pick: boolean) {
    const d = dragRef.current;
    const wasActive = d.active;
    d.active = false;
    setDragging(false);
    const el = e.currentTarget;
    if (typeof el.releasePointerCapture === "function" && Number.isFinite(e.pointerId)) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* al vrijgegeven */
      }
    }
    if (!wasActive || !pick || d.moved) return;
    const p = localPoint(e);
    const hit = countryAtPoint(p.x, p.y);
    if (hit.id) select(hit.id, false);
    else setMiss(hit.miss);
  }

  /** Draaien met het toetsenbord. Niet de weg naar een land — dat is de lijst —
   *  maar wie de bol ziet en geen muis heeft, mag hem ook kunnen ronddraaien. */
  function onCanvasKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    const dLon = e.key === "ArrowLeft" ? -KEY_STEP : e.key === "ArrowRight" ? KEY_STEP : 0;
    const dLat = e.key === "ArrowUp" ? KEY_STEP : e.key === "ArrowDown" ? -KEY_STEP : 0;
    if (dLon === 0 && dLat === 0) return;
    e.preventDefault();
    const now = rotRef.current;
    rotRef.current = normalizeRotation({ lon: now.lon + dLon, lat: now.lat + dLat });
    schedule();
  }

  /* --- de lijst ----------------------------------------------------------- */

  /** Alle landen, alfabetisch — óók de dertien zonder vlak, want die zijn hier de
   *  enige plek waar ze te kiezen zijn. Een leeg zoekveld toont ze allemaal: een
   *  lijst die pas iets laat zien als je het juiste woord al weet, is geen
   *  besturing. */
  const everything = useMemo(
    () => [...allCountries()].sort((a, b) => (countryLabel(a.id) || a.id).localeCompare(countryLabel(b.id) || b.id, "nl")),
    [],
  );
  const results = useMemo(
    () => (query.trim() === "" ? everything : searchCountries(query, everything.length)),
    [query, everything],
  );

  const optionId = (id: string) => `lv-globe-opt-${id}`;

  function moveActive(step: number) {
    if (results.length === 0) return;
    const next = activeIndex < 0 ? (step > 0 ? 0 : results.length - 1) : (activeIndex + step + results.length) % results.length;
    setActiveIndex(next);
    const el = listRef.current?.querySelector<HTMLElement>(`[data-country="${results[next].id}"]`);
    // Zonder smooth: dat zou een animatie zijn, en de lijst hoeft alleen te staan
    // waar de keuze staat.
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Enter") {
      const c = results[activeIndex] ?? (results.length === 1 ? results[0] : null);
      if (!c) return;
      e.preventDefault();
      select(c.id, true);
      return;
    }
    if (e.key === "Escape" && query !== "") {
      e.preventDefault();
      setQuery("");
      setActiveIndex(-1);
    }
  }

  /* --- wat er op het scherm staat ---------------------------------------- */

  /* De leesregel. Hover bestaat niet op een telefoon, dus dezelfde regel valt
   * terug op de SELECTIE: na een tik staat de naam plus de valutacode er gewoon,
   * zonder dat er iets aangewezen wordt. */
  const readoutId = hoverId ?? selectedId;
  const readout = readoutId ? conversionFor(readoutId) : null;

  const effect = selectedId ? resolve(selectedId, canPrice) : null;
  const label = selectedId ? countryLabel(selectedId) || selectedId : "";
  const focus = selectedId ? countryFocus(selectedId) : null;
  const dpr = pixelRatio();

  return (
    <div className="lv-globe">
      <div className="lv-globe-stage">
        <div className="lv-globe-figure" ref={figureRef}>
          <p className="lv-globe-readout" data-testid="bol-readout">
            {readoutId ? (
              <>
                <span className="lv-globe-readout-name">{countryLabel(readoutId) || readoutId}</span>
                <span className="lv-globe-readout-ccy">
                  {readout && readout.currencies.length > 0
                    ? readout.currencies.map((c) => c.code).join(" / ")
                    : "valuta onbekend"}
                </span>
              </>
            ) : (
              <span className="lv-globe-readout-empty">Draai de bol en wijs een land aan, of kies er een uit de lijst.</span>
            )}
          </p>

          <canvas
            ref={canvasRef}
            className="lv-globe-canvas"
            data-testid="bol-canvas"
            data-dragging={dragging ? "1" : undefined}
            width={Math.round(size * dpr)}
            height={Math.round(size * dpr)}
            style={{ width: `${size}px`, height: `${size}px` }}
            role="img"
            tabIndex={0}
            aria-label="Wereldbol met de bestemmingen. Slepen of de pijltjestoetsen draaien de bol; klikken kiest het land eronder. Elk land is ook te kiezen in de landenlijst hiernaast."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endDrag(e, true)}
            onPointerCancel={(e) => endDrag(e, false)}
            onPointerLeave={() => setHoverId(null)}
            onKeyDown={onCanvasKeyDown}
          />

          <ul className="lv-globe-legend">
            <li>
              <span className="lv-globe-swatch" data-tone="euro" aria-hidden="true" /> euro — niets te wisselen
            </li>
            <li>
              <span className="lv-globe-swatch" data-tone="rate" aria-hidden="true" /> LaVega heeft een koers
            </li>
            <li>
              <span className="lv-globe-swatch" data-tone="norate" aria-hidden="true" /> geen koers bij LaVega
            </li>
            <li>
              <span className="lv-globe-swatch" data-tone="selected" aria-hidden="true" /> gekozen
            </li>
          </ul>

          {/* De kleuren van het doek, als tekst leesbaar gemaakt. Zie readPalette. */}
          <span className="lv-globe-inks" aria-hidden="true">
            {INK_ROLES.map((role) => (
              <span key={role} data-ink={role} />
            ))}
          </span>
        </div>

        <div className="lv-globe-side">
          <div className="lv-globe-search">
            <label htmlFor="lv-globe-q">Zoek of kies een land</label>
            <input
              id="lv-globe-q"
              type="search"
              autoComplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls="lv-globe-list"
              aria-activedescendant={activeIndex >= 0 && results[activeIndex] ? optionId(results[activeIndex].id) : undefined}
              value={query}
              placeholder="Nederland, Japan, Singapore…"
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(-1);
              }}
              onKeyDown={onSearchKeyDown}
            />
            <ul
              id="lv-globe-list"
              ref={listRef}
              className="lv-globe-results"
              role="listbox"
              aria-label="Landen"
              data-testid="bol-landen"
            >
              {results.length === 0 ? (
                <li className="lv-globe-results-empty">Geen land met die naam of code in de gebundelde lijst.</li>
              ) : (
                results.map((c, i) => (
                  <li
                    key={c.id}
                    id={optionId(c.id)}
                    role="option"
                    aria-selected={c.id === selectedId}
                    data-country={c.id}
                    data-active={i === activeIndex ? "1" : undefined}
                    onClick={() => select(c.id, true)}
                  >
                    <span>{countryLabel(c.id) || c.name}</span>
                    <span className="cell-sub">
                      {codesOf(c)}
                      {c.rings === null ? " · niet op de bol" : ""}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>

      <div className="lv-globe-answer" data-testid="bol-antwoord" aria-live="polite">
        {miss ? (
          <p className="lv-globe-miss" data-testid="bol-misser">
            {miss === "off"
              ? "Dat punt ligt naast de bol, dus er is daar geen land."
              : miss === "polar"
                ? "Zo ver naar het zuiden houdt onze gebundelde data op: onder 55,6° zuiderbreedte staat er niets in — Antarctica is weggelaten. Wat daar ligt kan LaVega dus niet zeggen."
                : "Daar ligt geen land in onze grenzen: zee, of een land dat op deze schaal geen eigen vlak heeft. Die laatste staan wel in de lijst."}
            {effect ? ` Er is niets veranderd; ${label} blijft gekozen.` : ""}
          </p>
        ) : null}
        {!effect ? (
          <p>
            Kies een land op de bol of uit de lijst om de doelvaluta te zetten. De berekening staat nu op{" "}
            <strong>{value}</strong>.
          </p>
        ) : effect.kind === "euro" ? (
          <>
            <p className="lv-globe-answer-lead">{label} — euro</p>
            {from.toUpperCase() === "EUR" ? (
              <p>
                Daar betaal je met euro's, net als hier. Er valt niets om te wisselen: er is geen omwisseling, en dus
                ook geen tarief om te vergelijken.
              </p>
            ) : (
              <p>
                Daar betaal je met euro's. Je zet {from.toUpperCase()} over, dus dit is wél een omwisseling. De
                doelvaluta staat nu op EUR.
              </p>
            )}
          </>
        ) : effect.kind === "set" ? (
          <>
            <p className="lv-globe-answer-lead">
              {label} — {currencyLabel(effect.code)}
            </p>
            <p>
              De doelvaluta staat nu op <strong>{effect.code}</strong>. LaVega heeft daar een koers van, dus de
              berekening hierboven rekent er verder mee.
            </p>
          </>
        ) : effect.kind === "noRate" ? (
          <>
            <p className="lv-globe-answer-lead">{label} — geen koers</p>
            <p>
              Daar betaal je met {currencyLabel(effect.code)}. Van die valuta heeft LaVega geen koers, dus wat er
              aankomt kan LaVega niet uitrekenen. Dat is een leemte bij ons en het is geen nul.
            </p>
            <p className="cell-sub">De doelvaluta is niet veranderd; die staat nog op {value}.</p>
          </>
        ) : effect.kind === "choice" ? (
          <>
            <p className="lv-globe-answer-lead">{label} — meer dan één valuta</p>
            <p>
              Daar wordt met meer dan één valuta betaald. LaVega kiest er geen voor je, want dat verandert het
              antwoord. Welke bedoel je?
            </p>
            <ul className="lv-globe-choice">
              {effect.currencies.map((c) => (
                <li key={c.code}>
                  <button type="button" className="btn" aria-pressed={pickedCode === c.code} onClick={() => pickCurrency(c)}>
                    {c.code}
                    {canPrice(c) ? "" : " — geen koers"}
                  </button>
                </li>
              ))}
            </ul>
            {pickedCode ? (
              effect.currencies.some((c) => c.code === pickedCode && canPrice(c)) ? (
                <p>
                  De doelvaluta staat nu op <strong>{pickedCode}</strong>.
                </p>
              ) : (
                <p>
                  Van {currencyLabel(pickedCode)} heeft LaVega geen koers, dus de doelvaluta blijft op {value} staan.
                  Dat is een leemte bij ons en het is geen nul.
                </p>
              )
            ) : null}
          </>
        ) : (
          <>
            <p className="lv-globe-answer-lead">{label} — valuta onbekend</p>
            <p>
              De gebundelde bron noemt voor dit land geen valuta, dus LaVega weet niet waarin je daar betaalt. Dat is
              wat wij niet weten; het betekent niet dat er geen kosten zijn.
            </p>
            <p className="cell-sub">De doelvaluta is niet veranderd; die staat nog op {value}.</p>
          </>
        )}
        {/* Waar de bol wél of niet naartoe kon draaien. Dit hoort bij het antwoord
            en niet bij de bol: wie een land kiest dat wij niet tekenen, ziet
            anders een bol die zwijgt. */}
        {effect && !focus ? (
          <p className="cell-sub">
            Waar dit land ligt weet LaVega niet — de gebundelde bron heeft er vlak noch punt voor. De bol is daarom
            niet gedraaid.
          </p>
        ) : effect && focus?.from === "pin" ? (
          <p className="cell-sub">
            Dit land wordt op deze schaal niet getekend. De bol staat op de plek waar de bron het neerzet; de speld is
            het enige wat je er ziet.
          </p>
        ) : null}
      </div>

      <p className="lv-globe-source">
        Grenzen en valuta's zijn meegebundeld (Natural Earth, CLDR), opgehaald op {WORLD_MAP_SOURCES.fetchedAt}. Er
        wordt niets opgehaald terwijl je aan de bol draait. Antarctica zit niet in die grenzen: draai je naar de
        zuidpool, dan is daar leegte — dat is een gat in onze data en geen zee.
      </p>
    </div>
  );
}
