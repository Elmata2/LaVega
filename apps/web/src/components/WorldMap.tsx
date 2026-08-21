import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  WORLD_MAP_BOUNDS,
  WORLD_MAP_FILL_RULE,
  WORLD_MAP_SOURCES,
  conversionFor,
  countryLabel,
  mapCountries,
  searchCountries,
  type WorldCountry,
  type WorldCurrency,
} from "../worldMap.js";

/* De wereldkaart in de Valuta-tab: een tweede manier om de DOELVALUTA te kiezen.
 *
 * Wat dit ding NIET is: een tweede berekening. Valuta.tsx houdt de bedragen, de
 * middenkoers en de rangschikking van banken; deze kaart zet alleen `to`. Bij een
 * eerdere opzet stond hier een eigen "wat kost het daarheen" en die liep binnen
 * een dag uit de pas met het paneel ernaast — twee schermen die over hetzelfde
 * bedrag iets anders zeggen is erger dan één scherm zonder kaart.
 *
 * DAAROM ROEPT DE KAART `onPick` NIET ALTIJD AAN. Een land geeft vijf soorten
 * antwoord (zie worldMap.ts) en maar twee daarvan zijn een valuta die de
 * berekening kan gebruiken:
 *
 *   euro      → de doelvaluta gaat naar EUR, maar het paneel zegt het echte
 *               antwoord: vanuit euro's valt er niets om te wisselen. Dat is
 *               geen tarief van nul, er is geen tarief.
 *   priceable → doelvaluta gaat om, de berekening rekent verder.
 *   choice    → de kaart kiest NIETS en vraagt welke valuta. In Panama kennen
 *               wij de dollar wel en de balboa niet; "de eerste pakken"
 *               verandert het antwoord.
 *   noRate    → doelvaluta blijft staan en het paneel noemt de oorzaak: wij
 *               hebben geen koers. Een doelvaluta zetten waar de berekening
 *               geen koers voor heeft, levert een leeg <select> en een "onbekend"
 *               zonder uitleg — de melding hoort de oorzaak te noemen, niet het
 *               gevolg te veroorzaken.
 *   unknown   → de bron noemt geen valuta. Ook dat is geen nul.
 *
 * PRIJSBAAR VOLGENS WIE. De bundel heeft per valuta een `priceable`-vlag: stond
 * die valuta in de ECB-lijst op de dag van de sweep. De lijst waar de tab
 * vandaag écht mee rekent komt uit /api/fx/rate. Die twee kunnen verschillen, en
 * dan telt de live lijst (`supported`): een kaart die een valuta aanbiedt die het
 * <select> ernaast niet kent, is stuk. De vlag uit de bundel is de terugval voor
 * als er geen lijst wordt meegegeven.
 *
 * TOETSENBORD. 236 landen als 236 tabstops maakt de rest van de pagina
 * onbereikbaar, dus de kaart is één tabstop met een verschuivende focus (roving
 * tabindex): pijltjes lopen door de landen, Enter of spatie kiest. De volgorde is
 * ALFABETISCH en niet geografisch. Geografisch klinkt logischer tot je het
 * probeert: het land "rechts van" Frankrijk is Duitsland of Zwitserland of
 * Italië, afhankelijk van de breedtegraad, en elke keuze daaruit voelt als een
 * kapot toetsenbord. Alfabetisch is voorspelbaar en het is dezelfde ordening als
 * de zoeklijst eronder. Die zoeklijst is trouwens niet alleen een fallback: 13
 * landen hebben geen eigen vlak op deze schaal en zijn ALLEEN daar te bereiken.
 *
 * ER WORDT NIETS OPGEHAALD. De vlakken staan in de bundel (assets/GEODATA.md).
 * Een tile-request zou die server vertellen naar welk land iemand kijkt, en in
 * deze tab is dat "waar ga ik heen". */

export type WorldMapProps = {
  /** De doelvaluta van de omwisselberekening zoals die nu staat. */
  value: string;
  /** Zet de doelvaluta. Wordt alleen aangeroepen met een valuta waarvoor de tab
   *  een koers heeft. */
  onPick: (code: string) => void;
  /** Waar het geld nu in staat. Alleen nodig om het euro-antwoord precies te
   *  krijgen: vanuit euro's valt er niets te wisselen, vanuit dollars wel. */
  from?: string;
  /** De valuta's waarvoor de tab een koers heeft. Afwezig of leeg: dan valt de
   *  kaart terug op de `priceable`-vlag uit de bundel. */
  supported?: readonly string[];
};

/** Wat de kaart met een land kan doen, nadat de live koerslijst erover heen is
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

/** Waarmee er in dit land betaald wordt, kort — voor de leesregel en het
 *  aria-label. Leeg is hier "valuta onbekend" en niet een streepje: een streepje
 *  leest als nul. */
function codesOf(c: WorldCountry): string {
  return c.currencies.length === 0 ? "valuta onbekend" : c.currencies.map((x) => x.code).join(" / ");
}

/** Welke kleurgroep het land op de kaart krijgt. Dit gaat over ONS, niet over
 *  het land: "geen koers" is een leemte aan onze kant en de legenda zegt dat
 *  ook zo. */
function tone(c: WorldCountry, canPrice: (x: WorldCurrency) => boolean): "euro" | "rate" | "norate" {
  if (c.currencies.length > 0 && c.currencies.every((x) => x.code === "EUR")) return "euro";
  return c.currencies.some(canPrice) ? "rate" : "norate";
}

/** Het ISO-land onder een gebeurtenis, of null als de gebeurtenis niet van een
 *  land kwam (de <g> zelf, of de zee). */
function countryFrom(target: EventTarget | null): string | null {
  const el = target as Element | null;
  if (!el || typeof el.getAttribute !== "function") return null;
  return el.getAttribute("data-country") || null;
}

/* De 236 vlakken apart en gememoiseerd. Zonder dit tekent React bij elke
 * muisbeweging alle landen opnieuw, want de leesregel boven de kaart hangt aan
 * `hover` en die staat in dezelfde component. De hover-vulling zit daarom in CSS
 * (:hover) en niet in de props: alleen "gekozen" en "waar staat de tabstop"
 * komen hier binnen. */
const Lands = memo(function Lands({
  countries,
  tones,
  selectedId,
  tabId,
}: {
  countries: readonly (WorldCountry & { path: string })[];
  tones: ReadonlyMap<string, "euro" | "rate" | "norate">;
  selectedId: string | null;
  tabId: string | null;
}) {
  return (
    <>
      {countries.map((c) => {
        const selected = c.id === selectedId;
        return (
          <path
            key={c.id}
            className="lv-map-land"
            d={c.path}
            data-country={c.id}
            data-tone={tones.get(c.id)}
            data-selected={selected ? "1" : undefined}
            role="button"
            tabIndex={c.id === tabId ? 0 : -1}
            aria-pressed={selected}
            aria-label={`${countryLabel(c.id) || c.name}, ${codesOf(c)}`}
          />
        );
      })}
    </>
  );
});

export default function WorldMap({ value, onPick, from = "EUR", supported }: WorldMapProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  /** Bij een land met meer dan één valuta: welke de gebruiker aanwees. Null is
   *  "nog niet gekozen" en dan blijft de vraag staan. */
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);

  const drawn = useMemo(() => mapCountries(), []);
  /** Alfabetisch — de volgorde van de pijltjes én van de zoeklijst. Zie de kop. */
  const order = useMemo(
    () => drawn.map((c) => c.id).sort((a, b) => (countryLabel(a) || a).localeCompare(countryLabel(b) || b, "nl")),
    [drawn],
  );
  const drawnIds = useMemo(() => new Set(order), [order]);

  const supportedSet = useMemo(
    () => (supported && supported.length > 0 ? new Set(supported.map((c) => c.toUpperCase())) : null),
    [supported],
  );
  const canPrice = useMemo(
    () => (c: WorldCurrency) => (supportedSet ? supportedSet.has(c.code) : c.priceable),
    [supportedSet],
  );
  const tones = useMemo(
    () => new Map(drawn.map((c) => [c.id, tone(c, canPrice)] as const)),
    [drawn, canPrice],
  );

  /** Eén tabstop. De focus staat waar hij het laatst stond, anders op het
   *  gekozen land, anders op het eerste land — nooit nergens, want dan doet Tab
   *  op de kaart niets. */
  const tabId =
    focusId && drawnIds.has(focusId)
      ? focusId
      : selectedId && drawnIds.has(selectedId)
        ? selectedId
        : (order[0] ?? null);

  /* De focus verhuist pas ná de render, want het vlak dat hij moet krijgen heeft
   * dan tabIndex 0. Bij het opstarten staat `focusId` op null, dus dit pakt geen
   * focus af van iets waar de gebruiker aan het typen was. */
  useEffect(() => {
    if (!focusId) return;
    const el = svgRef.current?.querySelector<SVGElement>(`[data-country="${focusId}"]`);
    if (el && typeof el.focus === "function") el.focus();
  }, [focusId]);

  /** `fromMap` is niet cosmetisch. Kiezen op de kaart verhuist de focus naar dat
   *  vlak — dat doet een browser bij een klik ook, en zonder dat wijst de
   *  leesregel na een Enter nog naar het land waar de pijltjes het laatst
   *  stonden. Kiezen uit de ZOEKLIJST doet het omgekeerde: de focus blijft in
   *  het zoekveld (anders springt hij weg terwijl iemand nog typt) en de kaart
   *  valt terug op het gekozen land als tabstop. */
  function select(id: string, fromMap: boolean) {
    setSelectedId(id);
    setFocusId(fromMap ? id : null);
    setPickedCode(null);
    setQuery("");
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

  function onKeyDown(e: React.KeyboardEvent<SVGGElement>) {
    const here = countryFrom(e.target) ?? tabId;
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      if (!here) return;
      e.preventDefault();
      select(here, true);
      return;
    }
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0 && e.key !== "Home" && e.key !== "End") return;
    if (order.length === 0) return;
    e.preventDefault();
    const at = here ? order.indexOf(here) : -1;
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? order.length - 1
          : (((at < 0 ? 0 : at) + step) + order.length) % order.length;
    setFocusId(order[next]);
  }

  const [x0, y0, x1, y1] = WORLD_MAP_BOUNDS;
  const viewBox = `${x0} ${y0} ${x1 - x0} ${y1 - y0}`;

  /* De leesregel. Hover bestaat niet op een telefoon, dus dezelfde regel valt
   * terug op de focus en daarna op de SELECTIE: na een tik staat de naam plus de
   * valutacode er gewoon, zonder dat er iets aangewezen wordt. */
  const readoutId = hoverId ?? focusId ?? selectedId;
  const readout = readoutId ? conversionFor(readoutId) : null;

  const results = useMemo(() => searchCountries(query, 8), [query]);
  const effect = selectedId ? resolve(selectedId, canPrice) : null;
  const label = selectedId ? countryLabel(selectedId) || selectedId : "";

  return (
    <div className="lv-map">
      <p className="lv-map-readout" data-testid="kaart-readout">
        {readoutId ? (
          <>
            <span className="lv-map-readout-name">{countryLabel(readoutId) || readoutId}</span>
            <span className="lv-map-readout-ccy">
              {readout && readout.currencies.length > 0
                ? readout.currencies.map((c) => c.code).join(" / ")
                : "valuta onbekend"}
            </span>
          </>
        ) : (
          <span className="lv-map-readout-empty">Wijs een land aan of kies er een uit de lijst.</span>
        )}
      </p>

      <div className="lv-map-figure">
        <svg
          ref={svgRef}
          className="lv-map-svg"
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label="Wereldkaart: kies de bestemming"
        >
          <rect className="lv-map-sea" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />
          <g
            className="lv-map-lands"
            fillRule={WORLD_MAP_FILL_RULE}
            onClick={(e) => {
              const id = countryFrom(e.target);
              if (id) select(id, true);
            }}
            onKeyDown={onKeyDown}
            onMouseOver={(e) => setHoverId(countryFrom(e.target))}
            onMouseOut={() => setHoverId(null)}
            onFocus={(e) => {
              const id = countryFrom(e.target);
              if (id) setFocusId(id);
            }}
          >
            <Lands countries={drawn} tones={tones} selectedId={selectedId} tabId={tabId} />
          </g>
        </svg>
      </div>

      <ul className="lv-map-legend">
        <li>
          <span className="lv-map-swatch" data-tone="euro" aria-hidden="true" /> euro — niets te wisselen
        </li>
        <li>
          <span className="lv-map-swatch" data-tone="rate" aria-hidden="true" /> LaVega heeft een koers
        </li>
        <li>
          <span className="lv-map-swatch" data-tone="norate" aria-hidden="true" /> geen koers bij LaVega
        </li>
        <li>
          <span className="lv-map-swatch" data-selected="1" aria-hidden="true" /> gekozen
        </li>
      </ul>

      <div className="lv-map-answer" data-testid="kaart-antwoord" aria-live="polite">
        {!effect ? (
          <p>
            Kies een land op de kaart of uit de lijst om de doelvaluta te zetten. De berekening staat nu op{" "}
            <strong>{value}</strong>.
          </p>
        ) : effect.kind === "euro" ? (
          <>
            <p className="lv-map-answer-lead">{label} — euro</p>
            {from.toUpperCase() === "EUR" ? (
              <p>
                Daar betaal je met euro's, net als hier. Er valt niets om te wisselen: er is geen omwisseling,
                en dus ook geen tarief om te vergelijken.
              </p>
            ) : (
              <p>
                Daar betaal je met euro's. Je zet {from.toUpperCase()} over, dus dit is wél een omwisseling.
                De doelvaluta staat nu op EUR.
              </p>
            )}
          </>
        ) : effect.kind === "set" ? (
          <>
            <p className="lv-map-answer-lead">
              {label} — {currencyLabel(effect.code)}
            </p>
            <p>
              De doelvaluta staat nu op <strong>{effect.code}</strong>. LaVega heeft daar een koers van, dus de
              berekening hierboven rekent er verder mee.
            </p>
          </>
        ) : effect.kind === "noRate" ? (
          <>
            <p className="lv-map-answer-lead">{label} — geen koers</p>
            <p>
              Daar betaal je met {currencyLabel(effect.code)}. Van die valuta heeft LaVega geen koers, dus wat er
              aankomt kan LaVega niet uitrekenen. Dat is een leemte bij ons en het is geen nul.
            </p>
            <p className="cell-sub">De doelvaluta is niet veranderd; die staat nog op {value}.</p>
          </>
        ) : effect.kind === "choice" ? (
          <>
            <p className="lv-map-answer-lead">{label} — meer dan één valuta</p>
            <p>
              Daar wordt met meer dan één valuta betaald. LaVega kiest er geen voor je, want dat verandert het
              antwoord. Welke bedoel je?
            </p>
            <ul className="lv-map-choice">
              {effect.currencies.map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    className="btn"
                    aria-pressed={pickedCode === c.code}
                    onClick={() => pickCurrency(c)}
                  >
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
                  Van {currencyLabel(pickedCode)} heeft LaVega geen koers, dus de doelvaluta blijft op {value}
                  staan. Dat is een leemte bij ons en het is geen nul.
                </p>
              )
            ) : null}
          </>
        ) : (
          <>
            <p className="lv-map-answer-lead">{label} — valuta onbekend</p>
            <p>
              De gebundelde bron noemt voor dit land geen valuta, dus LaVega weet niet waarin je daar betaalt.
              Dat is wat wij niet weten; het betekent niet dat er geen kosten zijn.
            </p>
            <p className="cell-sub">De doelvaluta is niet veranderd; die staat nog op {value}.</p>
          </>
        )}
      </div>

      <div className="lv-map-search">
        <label htmlFor="lv-map-q">Zoek een land</label>
        <input
          id="lv-map-q"
          type="search"
          autoComplete="off"
          value={query}
          placeholder="Nederland, Japan, Singapore…"
          onChange={(e) => setQuery(e.target.value)}
        />
        {query.trim() !== "" && (
          <ul className="lv-map-results" data-testid="kaart-zoekresultaten">
            {results.length === 0 ? (
              <li className="lv-map-results-empty">Geen land met die naam of code in de gebundelde lijst.</li>
            ) : (
              results.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => select(c.id, false)}>
                    <span>{countryLabel(c.id) || c.name}</span>
                    <span className="cell-sub">
                      {codesOf(c)}
                      {c.path === null ? " · staat niet op de kaart" : ""}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <p className="lv-map-source">
        Grenzen en valuta's zijn meegebundeld (Natural Earth, CLDR), opgehaald op {WORLD_MAP_SOURCES.fetchedAt}.
        Er wordt niets opgehaald terwijl je op de kaart kijkt.
      </p>
    </div>
  );
}
