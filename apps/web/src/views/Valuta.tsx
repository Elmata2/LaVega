import { Fragment, useEffect, useMemo, useState } from "react";
import type {
  Account,
  CatalogueEntryLike,
  FxRate,
  FxRouteDelta,
  FxRouteOption,
  FxWhy,
  LearnedFact,
} from "@lavega/core";
import {
  FX_RATE_FALLBACK,
  accountLabel,
  crossRate,
  fxRouteDefault,
  fxRouteDelta,
  fxRouteSwitch,
  parseFxRatePayload,
  rankFxRoutes,
} from "@lavega/core";
import { API_BASE } from "../api";
import Module from "../components/Module";
import ModuleGrid from "../components/ModuleGrid";
import Globe from "../components/Globe";
import ToonMeer from "../components/ToonMeer";
// DEZELFDE WOORDEN ALS OP OVERZICHT, met opzet en niet uit gemak. Wat een kaart
// kost en wat er netto overblijft wordt daar al in drie toestanden verteld, en
// twee schermen die hetzelfde zeggen in andere woorden is een fout op zichzelf:
// dan gaat de lezer zoeken naar het verschil tussen de twee zinnen, en dat is er
// niet. Vandaar de component en niet een kopie ervan. (Hij hoort op termijn in
// components/ te staan in plaats van in een blok van Overzicht — zie het open
// punt bij deze lane; verplaatsen kan pas als één lane beide bestanden bezit.)
import { Kaartkosten } from "../components/blocks/TravelBlock";
import { formatCurrencyIn, formatEuroIn } from "../format.js";
import { useAppLocale } from "../appLocale.js";
import { optimiseCopy, formatPercentIn } from "../copy/optimise.js";
import type { ValutaCopy } from "../copy/optimise.js";
import type { Locale } from "../locale.js";
import catalogue from "../../../../docs/catalog/catalog.json";
import Button from "../components/ui/Button.js";
import "../styles/views.css";

/* Valuta — "Transfer money": from where, to where, how much, and what ARRIVES.
 *
 * TWO THINGS THE 20 AUGUST REVIEW CHANGED HERE.
 *
 * 1. ONE ROW PER BANK. "Just show one ING, because since we're converting it
 *    doesn't matter, just show the banks once." It used to rank per PRODUCT via
 *    `rankJourneys`, so ING arrived three times. The collapse lives in
 *    `rankFxRoutes` (packages/core/src/fxRoutes.ts) with the rules that keep a
 *    merge honest — nothing dropped, the product behind every figure named.
 *
 * 2. EVERY BANK, NOT ONLY HIS. "When I transfer a thousand euros to USD it should
 *    choose the best account or bank, and if the user wants to change they can
 *    choose through all the banks available and the fee difference." So the list
 *    is the whole catalogue's 73 covered surcharges, each priced against the
 *    chosen route in euros, and a bank he does not hold is marked as such —
 *    otherwise the screen recommends a transfer he cannot make.
 *
 * The multi-leg pricing (move to Revolut via iDEAL first, then pay) stays in the
 * travel block on Overzicht. That answers "which card do I pay with abroad"; this
 * screen answers "where do I convert", and one number per bank is the answer to
 * the second question.
 *
 * 3. WAT DE REKENING KOST TELT MEE (21 augustus). Dit was de vierde plek met een
 *    aanbeveling en de laatste die alleen naar de koersopslag keek. Op € 1.000
 *    scheelt 1,4% tegen 0% veertien euro — maar een kaart die daarvoor € 16,90 per
 *    maand vraagt is bijna drie euro DUURDER, niet veertien euro goedkoper. De
 *    rekensom staat in `rankFxRoutes`/`fxRouteDelta`/`fxRouteSwitch`; dit scherm
 *    toont hem, in de drie toestanden die het TYPE draagt en niet in een boolean
 *    van hier:
 *
 *      kosten bekend, netto positief  → het nettobedrag, met de aftrek erbij
 *      kosten bekend, netto nul of −  → geen aanbeveling, met de reden in euro's
 *      kosten onbekend                → alleen bruto; het woord "netto" valt niet
 *
 *    Een bank die hij AL heeft rendert daar niets: die prijs loopt toch al door,
 *    dus hij hoort niet bij DEZE keuze. En de PERIODE staat op het scherm — één
 *    hele factureringsperiode, want je kunt geen rekening voor een dag openen —
 *    omdat een nettobedrag zonder periode niet na te rekenen is.
 *
 * The rule that still shapes the whole screen: an unknown cost is NOT zero. When
 * the chosen route has no established figure, "wat er aankomt" stays "onbekend"
 * and the mid-market amount is shown separately, labelled as market value.
 *
 * The catalogue is imported at BUILD time — like `catalogue-rates.ts`, and for the
 * same reason: nothing about which banks a user compares should leave the device.
 *
 * THE GLOBE (components/Globe.tsx) is a THIRD way to set `to`, next to the
 * dropdown and picking an account — you rarely think "USD", you think "Japan".
 * It replaced a flat map on the owner's call: he pointed at a physical
 * interactive globe and wanted that, digitally. Nothing about the CONTRACT
 * changed with it, and that is deliberate — the globe is only an input: it sets
 * the target currency and nothing else, so there is one calculation on this
 * screen and not two that can disagree. It does NOT always set one, and that is
 * the point — a euro country, a currency we have no rate for and a country with
 * two currencies are three different answers, none of which may end up as a 0%
 * route in the ranking. The globe states the answer; `to` only moves when there
 * is a rate to move it to.
 *
 * 4. MEER KOERSEN, EN ZE ZIJN NIET ALLEMAAL EVENVEEL WAARD (22 augustus). Zijn
 *    woorden: "ja meer koersen hoe beter." De lijst gaat van 29 naar 166 doordat
 *    er een tweede laag onder de ECB-lijst ligt (apps/server/src/fx.ts). Dat is
 *    geen kwestie van meer regels in hetzelfde <select>: een aggregator die
 *    koersen samenvoegt uit bronnen die hij niet noemt is iets anders dan een
 *    referentiekoers van de ECB, en twee koersen die er hetzelfde uitzien
 *    zouden precies de vermenging zijn die de catalogus overal vermijdt. Wat dit
 *    bestand daaraan doet, op vier plekken:
 *
 *      de kiezer      → twee <optgroup>'s, ECB bovenaan, de dagkoersen eronder
 *      onder het bedrag → waar de koers van DIT paar vandaan komt, met datum
 *      vóór de plooi  → de verplichte bronvermelding van de tweede laag
 *      de bronregel   → beide lagen apart, met hun eigen datum en aantal
 *
 *    Wat er GEBEURT als de tweede laag wegvalt is een eis en geen bijkomstigheid:
 *    die valuta's zijn dan weer "geen koers". Er blijft geen oude waarde staan
 *    die zich als vers voordoet — de server bewaart die laag niet, en dit scherm
 *    toont alleen wat er binnenkomt.
 *
 *    HET GEVOLG VOOR DE BOL, nagemeten en niet aangenomen: `supported` is de live
 *    koerslijst, dus het aantal landen zonder koers gaat van 140 naar 1 (alleen
 *    Noord-Korea, KPW). Alle vijf de antwoordsoorten blijven bereikbaar en de
 *    legenda blijft waar — hij praat over of LaVega een koers HEEFT en niet over
 *    wie hem publiceerde. Zie de tests onderaan Globe.test.tsx.
 */

const CATALOGUE_FX: readonly CatalogueEntryLike[] =
  (catalogue as { entries?: CatalogueEntryLike[] }).entries ?? [];

/* ───────────── DE HERKOMST VAN EEN KOERS ─────────────
 *
 * De koerslijst heeft sinds 22 augustus TWEE LAGEN (zie apps/server/src/fx.ts).
 * De ECB publiceert referentiekoersen: één instelling, één vast tijdstip, een
 * methode die je kunt nalezen — 29 valuta. Daaronder ligt een aggregator die
 * koersen samenvoegt uit bronnen die hij niet noemt en één keer per dag
 * ververst — daarmee komt de lijst op 166. Allebei bruikbaar, niet hetzelfde
 * waard, en dus mogen ze niet als één lijst op het scherm staan: dan leest de
 * koers van Marokko als even hard als die van de dollar. Elke koers draagt hier
 * daarom zichtbaar zijn laag en zijn datum.
 *
 * De server doet het samenvoegen (ECB wint waar hij bestaat) en stuurt per
 * valutacode mee welke laag hem leverde. Dit bestand LABELT alleen; het rekent
 * niets om en het vult niets aan. */

type FxOrigin = "ecb" | "aggregator";
type FxLayerStatus = "live" | "geheugen" | "bundel";
type FxLayer = { status: FxLayerStatus; date: string; count: number };
type FxAggregatorLayer = FxLayer & { provider: string; nextUpdate: string | null };
type FxProvenance = {
  /** Valutacode -> laag. Dekt elke sleutel in `rates`, anders wordt hij geweigerd. */
  origins: Record<string, FxOrigin>;
  ecb: FxLayer | null;
  aggregator: FxAggregatorLayer | null;
};

/** DE VERPLICHTE BRONVERMELDING, hier en niet op de server.
 *
 *  ExchangeRate-API staat het gebruik van zijn open-access-koersen toe — ook
 *  commercieel — maar alleen MET vermelding. Nagekeken op 22 augustus 2026 op
 *  exchangerate-api.com/docs/free: "We require attribution on the pages you're
 *  using these rates with", met de linktekst hieronder. Let op de valstrik: de
 *  algemene voorwaardenpagina (/terms) noemt die plicht NIET — daar staat alleen
 *  dat gratis en betaalde accounts hetzelfde mogen en dat de data niet
 *  herverspreid mag worden. Wie alleen /terms leest concludeert ten onrechte dat
 *  vermelding niet hoeft.
 *
 *  Deze tabel staat in de UI en niet in de payload, zodat de vermelding niet
 *  afhangt van wat de server toevallig meestuurt. Kent dit bestand de aanbieder
 *  niet, dan worden zijn koersen NIET gebruikt — zie `rate` in de component, dat
 *  ze er dan uit filtert. Dat is de enige manier om de plicht structureel te
 *  maken in plaats van een belofte: een vermelding die je kunt vergeten is geen
 *  vermelding. */
const AGGREGATOR_CREDIT: Record<
  string,
  { naam: string; url: string; linktekst: string; voorwaarden: string }
> = {
  erapi: {
    naam: "ExchangeRate-API",
    url: "https://www.exchangerate-api.com",
    linktekst: "Rates By Exchange Rate API",
    voorwaarden: "https://www.exchangerate-api.com/terms",
  },
};

function parseLayer(raw: unknown): FxLayer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.status !== "live" && o.status !== "geheugen" && o.status !== "bundel") return null;
  if (typeof o.date !== "string" || o.date === "") return null;
  if (typeof o.count !== "number" || !Number.isFinite(o.count) || o.count < 0) return null;
  return { status: o.status, date: o.date, count: o.count };
}

function parseAggregatorLayer(raw: unknown): FxAggregatorLayer | null {
  const base = parseLayer(raw);
  if (!base) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.provider !== "string" || o.provider === "") return null;
  // Geen opgave van de volgende ronde is null en niet "morgen". Onbekend is geen
  // waarde die je zelf mag invullen.
  const nextUpdate = typeof o.nextUpdate === "string" && o.nextUpdate !== "" ? o.nextUpdate : null;
  return { ...base, provider: o.provider, nextUpdate };
}

/** De herkomstvelden uit het serverantwoord, of null als ze er niet zijn of niet
 *  kloppen. Null betekent hier NIET "alles komt van de aggregator" en ook niet
 *  "alles komt van de ECB" — het betekent dat dit scherm de herkomst niet weet,
 *  en dan wordt er ook niets over beweerd.
 *
 *  Strikt met opzet: één koers zonder herkomst is genoeg om de hele labeling te
 *  weigeren. Half labelen zou de ergste uitkomst zijn — een lijst waarin sommige
 *  koersen "ECB" heten en de rest niets, waar een lezer uit afleidt dat de rest
 *  ook ECB is. */
function parseFxProvenance(raw: unknown, rate: FxRate): FxProvenance | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!o.origins || typeof o.origins !== "object") return null;
  if (!o.layers || typeof o.layers !== "object") return null;

  const origins: Record<string, FxOrigin> = {};
  for (const [code, v] of Object.entries(o.origins as Record<string, unknown>)) {
    if (v !== "ecb" && v !== "aggregator") return null;
    origins[code] = v;
  }
  for (const code of Object.keys(rate.rates)) if (!(code in origins)) return null;

  const l = o.layers as Record<string, unknown>;
  const ecb = parseLayer(l.ecb);
  const aggregator = parseAggregatorLayer(l.aggregator);
  // Een laag die er WEL staat maar niet te lezen is, is een kapot antwoord — niet
  // een afwezige laag. Die twee uit elkaar houden is het hele punt van dit blok.
  if (l.ecb != null && !ecb) return null;
  if (l.aggregator != null && !aggregator) return null;
  return { origins, ecb, aggregator };
}

/** Waar de koers van dit ENE valutapaar vandaan komt.
 *
 *  Dit is de vraag die het scherm echt moet beantwoorden, en hij valt niet samen
 *  met "waar komt de lijst vandaan". Een omrekening loopt via de euro, dus
 *  USD → MAD gebruikt TWEE koersen: de dollar van de ECB en de dirham van de
 *  aggregator. Die kruising is niet zomaar "een ECB-koers" en niet zomaar "een
 *  dagkoers": hij is zo hard als zijn zwakste been, en het scherm noemt allebei
 *  de benen. */
type PairOrigin =
  | { kind: "same" }
  | { kind: "unknown" }
  | { kind: "ecb" }
  | { kind: "aggregator" }
  | { kind: "mixed"; ecbLeg: string; aggLeg: string };

function pairOrigin(from: string, to: string, base: string, prov: FxProvenance | null): PairOrigin {
  if (from === to) return { kind: "same" };
  if (!prov) return { kind: "unknown" };
  // De base is de eenheid en heeft geen koers; alleen de andere benen tellen.
  const legs = [from, to].filter((c) => c !== base);
  const kinds = legs.map((c) => prov.origins[c]);
  if (kinds.some((k) => k === undefined)) return { kind: "unknown" };
  if (kinds.every((k) => k === "ecb")) return { kind: "ecb" };
  if (kinds.every((k) => k === "aggregator")) return { kind: "aggregator" };
  return {
    kind: "mixed",
    ecbLeg: legs[kinds.indexOf("ecb")],
    aggLeg: legs[kinds.indexOf("aggregator")],
  };
}

/** Hoe vers de ECB-laag is, in woorden. Drie standen en niet twee: "geheugen" is
 *  een ECHTE ophaal van de server waarvan de laatste poging mislukte, en dat is
 *  iets anders dan de koers van zojuist én iets anders dan de meegebundelde
 *  momentopname. Ze samenvoegen tot "live" was precies de bewering die deze kop
 *  in juli onwaar maakte. */
function ecbVersheid(layer: FxLayer, rf: ValutaCopy["view"]["rateFreshness"]): string {
  if (layer.status === "live") return rf.live(layer.date);
  if (layer.status === "geheugen") return rf.memory(layer.date);
  return rf.bundled(layer.date);
}

/** How many alternatives to show before asking. His own banks are ALWAYS shown,
 *  however far down the ranking they sit — a bank he holds may never be hidden
 *  behind a "show more". */
const VISIBLE_ROUTES = 8;

type ValutaProps = {
  accounts: Account[];
  /** Learned card/route terms from the vault — including his own corrections,
   *  which outrank the catalogue for a product he holds. Absent means "we only
   *  know what the catalogue says", which is still a lot more than nothing. */
  facts?: readonly LearnedFact[];
  /** The product catalogue. Injectable so a test can state its own market. */
  entries?: readonly CatalogueEntryLike[];
};

const NO_ACCOUNT = "";

/** The read-out leg's figure: full size in ink once an amount is known, quieter
 *  and muted while it isn't (was `.xfer-out`/`.xfer-out-unknown` in views.css). */
function xferOutClass(unknown: boolean): string {
  return unknown
    ? "font-display text-[1.35rem] font-semibold text-muted min-w-0 [overflow-wrap:anywhere]"
    : "font-display text-[2rem] font-semibold text-ink min-w-0 [overflow-wrap:anywhere]";
}

/** HET VERSCHIL MET DE GEKOZEN ROUTE, IN WOORDEN, en de twee zinnen zijn met opzet
 *  niet inwisselbaar.
 *
 *  "In totaal" mag alleen als van beide kanten de prijs van de rekening bekend is:
 *  dan is het verschil het HELE verschil. Kennen we er één niet, dan gaat het
 *  alleen over de opslag en zegt de regel dat ook — anders leest een bedrag als
 *  compleet terwijl er nog een maandnota bij kan komen. Het woord "netto" komt in
 *  geen van beide voor; dat woord hoort bij het bedrag zelf en niet bij een
 *  verschil.
 *
 *  Bedragen in euro's: de opslag is een percentage en past zich aan elke valuta
 *  aan, maar de prijs van een rekening staat in euro's in een Nederlands
 *  tarievendocument. Zie `rankFxRoutes` — daar staat waarom die twee niet in
 *  dezelfde som mogen zonder dezelfde eenheid. */
function deltaWords(
  delta: FxRouteDelta,
  locale: Locale,
  dc: ValutaCopy["view"]["delta"],
): string | null {
  if (delta.kind === "unknown") return null;
  const money = formatEuroIn(locale, Math.abs(delta.cents) / 100);
  if (delta.kind === "net") {
    if (delta.cents === 0) return dc.evenExpensive;
    return delta.cents < 0 ? dc.lessInTotal(money) : dc.moreInTotal(money);
  }
  if (delta.cents === 0) return dc.sameSurcharge;
  return delta.cents < 0 ? dc.lessSurcharge(money) : dc.moreSurcharge(money);
}

type CcyGroup = { key: string; label: string | null; codes: string[] };

/** De valutakiezer, met de twee lagen als APARTE GROEPEN in plaats van als één
 *  alfabetische rij.
 *
 *  Dit is de plek waar de zwakkere laag zichtbaar zwakker gelabeld moet zijn: je
 *  kiest hier je valuta, dus hier hoort te staan wat voor koers je daarmee
 *  binnenhaalt. Het alternatief dat we niet genomen hebben was een achtervoegsel
 *  per regel ("MAD — dagkoers"); dat zet hetzelfde woord 137 keer op het scherm
 *  terwijl <optgroup> het één keer zegt en de browser het vastzet tijdens het
 *  scrollen.
 *
 *  De base (EUR) staat er LOS boven, zonder groep. Hij hoort bij geen van beide
 *  lagen: hij is de eenheid waarin de rest genoteerd staat, geen koers. Hem in de
 *  ECB-groep zetten zou hem een herkomst geven die hij niet heeft. */
function CcySelect({
  label,
  value,
  onChange,
  base,
  groups,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  base: string;
  groups: readonly CcyGroup[];
}) {
  const option = (c: string) => (
    <option key={c} value={c}>
      {c}
    </option>
  );
  return (
    <select
      className="flex-none appearance-none [border:0] rounded-pill bg-ink text-on-ink font-body text-[0.85rem] font-semibold py-[8px] px-[14px] cursor-pointer"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {option(base)}
      {groups.map((g) =>
        g.label === null ? (
          // Zonder bekende herkomst geen groepskop: een kop verzinnen zou de lijst
          // een bron toedichten die dit scherm niet kent.
          <Fragment key={g.key}>{g.codes.map(option)}</Fragment>
        ) : (
          <optgroup key={g.key} label={g.label}>
            {g.codes.map(option)}
          </optgroup>
        ),
      )}
    </select>
  );
}

/** The one place a route's `FxWhy` becomes a sentence. Exhaustive by switch,
 *  so a new kind in `rankFxRoutes` fails the build here instead of rendering
 *  nothing — same pattern as `holdSentence` in Facturen.tsx. */
function fxWhySentence(why: FxWhy, c: ValutaCopy["view"]["routeRow"]["why"], locale: Locale): string {
  switch (why.kind) {
    case "terms-unknown-held":
      return c.termsUnknownHeld;
    case "no-rate":
      return c.noRate;
    case "mine-only":
      return c.mineOnly(formatPercentIn(locale, why.pct), why.product ?? "");
    case "mine-cheaper-elsewhere":
      return c.mineCheaperElsewhere(
        formatPercentIn(locale, why.pct),
        why.product ?? "",
        why.cheaperProduct,
        formatPercentIn(locale, why.cheaperPct),
      );
    case "uniform-held":
      return c.uniformHeld(formatPercentIn(locale, why.pct), why.collapsed, why.bank);
    case "uniform-not-held":
      return c.uniformNotHeld(formatPercentIn(locale, why.pct), why.collapsed, why.bank);
    case "held-uncertain":
      return c.heldUncertain(formatPercentIn(locale, why.pct), why.product ?? "");
    case "not-held":
      return c.notHeld(formatPercentIn(locale, why.pct), why.product ?? "");
  }
}

/** One bank, once. Selectable, because the whole point is that he can overrule
 *  the default — and priced against the route currently chosen, in money. */
function RouteRow({
  route,
  chosen,
  against,
  onPick,
  locale,
  c,
}: {
  route: FxRouteOption;
  chosen: boolean;
  against: FxRouteOption | null;
  onPick: () => void;
  locale: Locale;
  c: ValutaCopy["view"];
}) {
  // Geen bedrag als argument: beide rijen zijn door dezelfde `rankFxRoutes`-aanroep
  // op hetzelfde bedrag geprijsd. Zou het verschil hier op een ander bedrag
  // uitgerekend worden, dan kan een rij lager staan met een lager bedrag ernaast —
  // en dat leest als een fout in de app in plaats van als een rangschikking.
  const diff = chosen ? null : deltaWords(fxRouteDelta(route, against), locale, c.delta);
  const kindLabel = route.kind ? (c.kindLabel as Record<string, string>)[route.kind] : undefined;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-pressed={chosen}
        className={`travel-journey${chosen ? " travel-journey-best" : ""}${route.pct === null ? " travel-journey-unknown" : ""}`}
        style={{ width: "100%", textAlign: "left", cursor: "pointer", display: "block" }}
      >
        <div className="travel-journey-head">
          <span className="travel-journey-name">
            {route.bank}{" "}
            <span className="badge">{route.held ? c.routeRow.heldBadge : c.routeRow.notHeldBadge}</span>
            {kindLabel ? (
              <>
                {" "}
                <span className="badge">{kindLabel}</span>
              </>
            ) : null}
          </span>
          <span className="travel-journey-cost">
            {route.pct === null ? c.routeRow.costUnknown : formatPercentIn(locale, route.pct)}
            {diff ? ` · ${diff}` : ""}
          </span>
        </div>
        <p className="cell-sub" style={{ margin: 0 }}>
          {fxWhySentence(route.why, c.routeRow.why, locale)}
          {route.asOf ? ` ${c.routeRow.sourceNote(route.asOf)}` : ""}
        </p>
        {/* WAT DE REKENING ZELF KOST — de helft van het criterium die tot 21
            augustus niet op het scherm stond. Zonder deze regel staat een rij met
            0% opslag onder een rij met 1,4% zonder dat er iets te zien is dat die
            volgorde verklaart, en dan leest de lijst als willekeur. Zonder
            `benefit`: het verschil dat deze rij zou opleveren staat al in de kop
            hierboven, en er is maar één rij waar het netto-verhaal thuishoort —
            de aanbeveling, hieronder in het overzetblok. Bij een bank die hij al
            heeft rendert dit niets. */}
        <Kaartkosten
          product={route.product ?? route.bank}
          cost={route.pct === null ? null : route.holdingCost}
          benefit={null}
          testId={`valuta-kosten-${route.key}`}
        />
      </button>
    </li>
  );
}

export default function Valuta({ accounts, facts = [], entries = CATALOGUE_FX }: ValutaProps) {
  const [locale] = useAppLocale();
  const c = optimiseCopy[locale].valuta.view;
  const [served, setServed] = useState<FxRate>(FX_RATE_FALLBACK);
  const [prov, setProv] = useState<FxProvenance | null>(null);
  const [source, setSource] = useState<"live" | "offline">("offline");
  const [amount, setAmount] = useState("1000");
  const [from, setFrom] = useState("EUR");
  const [to, setTo] = useState("USD");
  const [fromKey, setFromKey] = useState(NO_ACCOUNT);
  const [toKey, setToKey] = useState(NO_ACCOUNT);
  const [pickedBank, setPickedBank] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  /* Er stond hier ook `showInfo` en `showSource`: twee useState-vlaggen met elk
   * een eigen knop in de modulekop. Die zijn weg — het uitklappen zit nu in
   * <ToonMeer>, en dat houdt zijn stand in de <details> zelf. Scheelt twee
   * toestanden die niets met de berekening te maken hadden. */

  useEffect(() => {
    let ok = true;
    void fetch(`${API_BASE}/api/fx/rate`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const parsed = parseFxRatePayload(j);
        if (ok && parsed) {
          setServed(parsed);
          // De herkomst komt uit hetzelfde antwoord en wordt tegen dezelfde
          // koerslijst gecontroleerd. Lukt dat niet, dan blijft `prov` null en
          // beweert het scherm niets over herkomst — het verzint er geen.
          setProv(parseFxProvenance(j, parsed));
          setSource("live");
        }
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      ok = false;
    };
  }, []);

  /** De aanbieder van de tweede laag, zoals dit bestand hem kent. Null als er geen
   *  tweede laag is — of als de server een aanbieder noemt die hier niet in
   *  `AGGREGATOR_CREDIT` staat. */
  const credit = prov?.aggregator ? (AGGREGATOR_CREDIT[prov.aggregator.provider] ?? null) : null;

  /** GEEN VERMELDING, GEEN GEBRUIK.
   *
   *  De tweede laag mag alleen gebruikt worden met een zichtbare bronvermelding.
   *  Kent dit bestand de aanbieder niet, dan kan het die vermelding niet zetten,
   *  en dan gaan zijn koersen eruit — de tab valt terug op de ECB-lijst en de
   *  betrokken valuta's zijn weer "geen koers". Dat is streng, en dat is de
   *  bedoeling: de alternatieve uitkomst is een scherm dat koersen toont die het
   *  niet mag tonen, en dat merkt niemand tot het te laat is.
   *
   *  In de praktijk gebeurt dit alleen bij een server die een nieuwe bron in
   *  gebruik heeft genomen zonder hem hier aan te melden. Het scherm doet het dan
   *  nog, met minder valuta — en de bronregel noemt die oorzaak met de naam van de
   *  onbekende aanbieder erbij, zodat het niet leest als een bron die wegviel. */
  const rate = useMemo<FxRate>(() => {
    if (!prov?.aggregator || credit) return served;
    const rates: Record<string, number> = {};
    for (const [code, v] of Object.entries(served.rates)) {
      if (prov.origins[code] !== "aggregator") rates[code] = v;
    }
    return { ...served, rates };
  }, [served, prov, credit]);

  const currencies = useMemo(
    () => [rate.base, ...Object.keys(rate.rates)].filter((v, i, a) => a.indexOf(v) === i).sort(),
    [rate],
  );

  /** De valutalijst opgesplitst naar laag, in de volgorde waarin ze op het scherm
   *  horen: eerst wat een centrale bank publiceert, dan wat een aggregator
   *  samenstelt. Zonder herkomst één naamloze groep — dan staat de lijst er net zo
   *  bij als voor 22 augustus. */
  const ccyGroups = useMemo<CcyGroup[]>(() => {
    const rest = currencies.filter((code) => code !== rate.base);
    if (!prov) return [{ key: "onbekend", label: null, codes: rest }];
    const of = (o: FxOrigin) => rest.filter((code) => prov.origins[code] === o);
    const out: CcyGroup[] = [];
    const ecb = of("ecb");
    const agg = of("aggregator");
    if (ecb.length > 0)
      out.push({ key: "ecb", label: c.ccySelect.ecbGroupLabel(ecb.length), codes: ecb });
    if (agg.length > 0 && credit) {
      out.push({
        key: "aggregator",
        label: c.ccySelect.aggregatorGroupLabel(credit.naam, agg.length),
        codes: agg,
      });
    }
    return out;
  }, [currencies, rate.base, prov, credit, c]);

  const byKey = useMemo(() => new Map(accounts.map((a) => [a.key, a])), [accounts]);
  const fromAcc = fromKey ? (byKey.get(fromKey) ?? null) : null;
  const toAcc = toKey ? (byKey.get(toKey) ?? null) : null;

  const amt = Number(amount.replace(",", ".")) || 0;

  const mid = useMemo(() => {
    try {
      return crossRate(from, to, rate);
    } catch {
      return null;
    }
  }, [from, to, rate]);

  /** Waar de koers van DIT paar vandaan komt. Niet hetzelfde als waar de lijst
   *  vandaan komt: een omrekening loopt via de euro en kan dus twee lagen
   *  aanraken. */
  const pair = useMemo(() => pairOrigin(from, to, rate.base, prov), [from, to, rate.base, prov]);

  /** De regel die de koers onder het bedrag verantwoordt. Null waar er niets te
   *  verantwoorden valt: bij gelijke valuta is er geen koers, en zonder bekende
   *  herkomst wordt er niets beweerd (regel 2 — een afwezigheid draagt geen
   *  conclusie). */
  const koersHerkomst = ((): string | null => {
    if (pair.kind === "same" || pair.kind === "unknown") return null;
    const agg = prov?.aggregator;
    const ecb = prov?.ecb;
    const aggZin = agg && credit ? c.rateFreshness.aggregator(credit.naam, agg.date) : null;
    const ecbZin = ecb ? ecbVersheid(ecb, c.rateFreshness) : null;
    if (pair.kind === "ecb") return ecbZin ? c.rateOrigin.ecb(ecbZin) : null;
    if (pair.kind === "aggregator") return aggZin ? c.rateOrigin.aggregator(aggZin) : null;
    // Gemengd: allebei de benen noemen. Eén van de twee weglaten zou de kruising
    // sterker of zwakker laten lijken dan hij is, en dat is precies de vermenging
    // die de twee lagen moeten voorkomen.
    return ecbZin && aggZin ? c.rateOrigin.mixed(pair.ecbLeg, ecbZin, pair.aggLeg, aggZin) : null;
  })();

  /** Het opschrift boven het scherm. Het mag niet meer "ECB-middenkoers" zeggen
   *  zodra er koersen bij staan die niet van de ECB komen — dat was tot 22
   *  augustus de eerste regel van het scherm, en met 137 dagkoersen erbij zou hij
   *  onwaar zijn geworden voor het grootste deel van de lijst. */
  const koersKop = ((): string => {
    if (source !== "live") return c.rateHeadline.offlineFallback(rate.date);
    if (!prov) return c.rateHeadline.liveNoProvenance;
    const stukken: string[] = [];
    if (prov.ecb) {
      // De bundel krijgt zijn eigen woord in de kop. "ECB-referentiekoers" is voor
      // die stand waar, maar het verzwijgt dat hij uit de app komt en weken oud
      // kan zijn — en dat is nou net wat een kop wél moet dragen.
      const woord =
        prov.ecb.status === "bundel"
          ? c.rateHeadline.ecbLayerWordBundled
          : c.rateHeadline.ecbLayerWordReference;
      stukken.push(c.rateHeadline.ecbPiece(prov.ecb.count, woord, prov.ecb.date));
    }
    if (prov.aggregator && credit) {
      stukken.push(
        c.rateHeadline.aggregatorPiece(prov.aggregator.count, credit.naam, prov.aggregator.date),
      );
    }
    // Geen enkele laag is geen lege kop maar een mededeling: dan staat er geen
    // koers in dit scherm, en dat hoort er te staan in plaats van niets.
    return stukken.length > 0 ? stukken.join(c.rateHeadline.joiner) : c.rateHeadline.noLayers;
  })();

  /** HET BEDRAG IN EURO'S, want daarin staan de prijzen van de rekeningen.
   *
   *  De koersopslag is een percentage en past zich aan elke valuta aan; wat een
   *  kaart per maand kost is een bedrag uit een Nederlands tarievendocument en
   *  staat in euro's. Die twee bij elkaar optellen mag alleen in één eenheid — zie
   *  `rankFxRoutes`, dat het bedrag daarom in euro's vraagt. Lukt de omrekening
   *  niet, dan gaat er nul in: dan rangschikt de lijst op wat een rekening kost om
   *  te openen in plaats van op een som die twee valuta's door elkaar haalt. */
  const amountEur = useMemo(() => {
    try {
      return amt * crossRate(from, "EUR", rate);
    } catch {
      return 0;
    }
  }, [amt, from, rate]);

  // THE ranking: one row per bank, over the whole catalogue plus what the vault
  // knows about his own cards — en sinds 21 augustus op wat de conversie in TOTAAL
  // kost, dus met de prijs van de rekening erin. Vandaar dat het bedrag meegaat:
  // een percentage en een maandprijs komen alleen op een bedrag bij elkaar.
  const routes = useMemo(
    () => rankFxRoutes({ accounts, facts, entries, amountEur }),
    [accounts, facts, entries, amountEur],
  );
  const auto = useMemo(() => fxRouteDefault(routes), [routes]);
  const chosen = useMemo(
    () => (pickedBank ? (routes.find((r) => r.key === pickedBank) ?? auto) : auto),
    [routes, pickedBank, auto],
  );
  /** Het beste alternatief voor de gekozen route, met de prijs van de rekening
   *  erin verrekend. Niet meer "de laagste opslag": dat was precies de vergelijking
   *  die een kaart van € 16,90 per maand als besparing van € 14 presenteerde. */
  const beats = useMemo(() => fxRouteSwitch(chosen ?? null, routes), [chosen, routes]);

  const sameCurrency = from === to;
  // No conversion means no conversion cost — that is a fact, not an assumption.
  // Otherwise the cost is the chosen route's; unknown stays unknown.
  const costPct = sameCurrency ? 0 : (chosen?.pct ?? null);
  const grossReceived = mid !== null ? amt * mid : null;
  const netReceived =
    grossReceived !== null && costPct !== null ? grossReceived * (1 - costPct / 100) : null;
  const costInFrom = costPct !== null ? (amt * costPct) / 100 : null;

  const heldBanks = useMemo(() => routes.filter((r) => r.held), [routes]);
  const heldUnknown = heldBanks.filter((r) => r.pct === null).map((r) => r.bank);

  /** Why there is no route to price this with — the actual reason, not a generic
   *  "onbekend". Getting this wrong once cost three days of wrong fixes. */
  const noRouteReason = (): string => {
    if (heldBanks.length === 0) {
      return accounts.length === 0 ? c.noRouteReason.noAccounts : c.noRouteReason.noBankOnAccounts;
    }
    return c.noRouteReason.unknownFee(heldUnknown.join(", "));
  };

  const visible = showAll ? routes : routes.filter((r, i) => i < VISIBLE_ROUTES || r.held);
  const hidden = routes.length - visible.length;

  /** Selecting an account sets the leg's currency to that account's own — the
   *  currency of the money is a property of the account, not a free choice. */
  function pickFrom(key: string) {
    setFromKey(key);
    const ccy = key ? byKey.get(key)?.currency : undefined;
    if (ccy && /^[A-Za-z]{3}$/.test(ccy)) setFrom(ccy.toUpperCase());
  }
  function pickTo(key: string) {
    setToKey(key);
    const ccy = key ? byKey.get(key)?.currency : undefined;
    if (ccy && /^[A-Za-z]{3}$/.test(ccy)) setTo(ccy.toUpperCase());
  }
  function swap() {
    setFrom(to);
    setTo(from);
    setFromKey(toKey);
    setToKey(fromKey);
  }

  const available = (a: Account | null) =>
    a === null
      ? "—"
      : a.balance === null
        ? c.transfer.unknown
        : formatCurrencyIn(locale, a.balance, a.currency || "EUR");

  /** Het opschrift van de uitgeklapte bankenlijst. Het moet een belofte zijn en
   *  geen "meer informatie" — met het aantal erin weet je meteen of het de moeite
   *  is om open te klikken. Zonder banken belooft hij iets anders, want dan zit er
   *  geen lijst achter maar een uitleg waarom die er niet is. */
  const bankenLabel =
    routes.length === 0 ? c.bankList.summaryEmpty : c.bankList.summary(routes.length);

  return (
    <>
      <div
        className="flex items-baseline justify-between gap-4 flex-wrap pb-2 mt-6 mb-4 border-b-2 border-ink first:mt-0"
        data-testid="view-head"
      >
        <h2 className="m-0 font-display text-[1.5rem] font-semibold tracking-[-0.01em] text-ink">
          {c.head.title}
        </h2>
        {/* De kop volgt de koers die er ECHT ligt. Hier stond "live ECB-middenkoers"
            als vaste tekst, en dat is de eerste regel van het scherm die onwaar is
            zodra de aanroep niet aankomt: dan rekent de tab met de meegebundelde
            momentopname van begin augustus terwijl er "live" boven staat. */}
        <span className="eyebrow flex-none">
          {koersKop}
          {c.head.eyebrowSuffix}
        </span>
      </div>

      {/* DE INDELING VAN 21 AUGUSTUS. Zijn woorden: rekenmachine links, bol rechts,
          de informatie die rechts stond naar onder de rekenmachine achter "toon
          meer", en onder de bol de legenda met het zoekveld eronder. "Keep it very
          simple."

          Wat er vóór stond: twee even zware kolommen — overzetten links, de
          bankenlijst rechts — en de bol op de volle breedte eronder. Daarmee stond
          de lijst met 73 banken naast het bedrag alsof je die eerst moest lezen,
          terwijl het antwoord (wat komt er aan, en via welke bank) al links stond.
          De lijst is de onderbouwing van dat antwoord, dus hij hoort eronder en
          opgevouwen.

          OP EEN SMAL SCHERM bestaat links en rechts niet. `grid-2` valt onder
          900 px terug op één kolom, en dan staat de rekenmachine bovenaan en de bol
          eronder. Dat is de goede volgorde en geen toeval van de bronvolgorde: de
          rekenmachine is waarmee je werkt — bedrag, van, naar, wat er aankomt — en
          de bol is één van de drie manieren om de doelvaluta te kiezen, naast het
          dropdown en het kiezen van een rekening. Wie de code van de valuta al weet
          hoeft de bol nooit te zien; wie hem niet weet scrollt één scherm. Andersom
          zou iedereen langs een bol van 420 px moeten om bij het bedrag te komen. */}
      <ModuleGrid className="grid-2" label={c.moduleLabels.grid}>
        <Module title={c.moduleLabels.transferTitle} height="tall">
          <div className="flex flex-col gap-2 relative">
            <div className="border border-line rounded bg-surface-2 p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-[0.78rem] tracking-[0.06em] uppercase text-muted">
                  {c.transfer.fromAccountLabel}
                </span>
                <select
                  className="max-w-[60%] rounded-pill border border-line bg-surface text-ink text-[0.8rem] py-[5px] px-[10px]"
                  aria-label={c.transfer.fromAccountLabel}
                  value={fromKey}
                  onChange={(e) => pickFrom(e.target.value)}
                >
                  <option value={NO_ACCOUNT}>{c.transfer.noAccountOption}</option>
                  {accounts.map((a) => (
                    <option key={a.key} value={a.key}>
                      {accountLabel(a)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between gap-3">
                <input
                  className="flex-auto min-w-0 [border:0] bg-transparent p-0 font-display text-[2rem] font-semibold text-ink focus:outline-none"
                  type="number"
                  step={0.01}
                  min={0}
                  value={amount}
                  aria-label={c.transfer.amountLabel}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <CcySelect
                  label={c.transfer.fromCurrencyLabel}
                  value={from}
                  onChange={setFrom}
                  base={rate.base}
                  groups={ccyGroups}
                />
              </div>
              <div className="flex justify-between gap-3 mt-2 text-[0.8rem] text-muted">
                <span>{c.transfer.availableLabel}</span>
                <span>{available(fromAcc)}</span>
              </div>
            </div>

            <button
              type="button"
              className="self-center w-9 h-9 -my-2 rounded-[50%] border border-line bg-surface text-muted text-[0.95rem] leading-none cursor-pointer z-[1] hover:text-ink hover:border-accent"
              aria-label={c.transfer.swapAriaLabel}
              onClick={swap}
            >
              <span aria-hidden="true">⇅</span>
            </button>

            <div className="border border-line rounded bg-surface-2 p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-[0.78rem] tracking-[0.06em] uppercase text-muted">
                  {c.transfer.toAccountLabel}
                </span>
                <select
                  className="max-w-[60%] rounded-pill border border-line bg-surface text-ink text-[0.8rem] py-[5px] px-[10px]"
                  aria-label={c.transfer.toAccountLabel}
                  value={toKey}
                  onChange={(e) => pickTo(e.target.value)}
                >
                  <option value={NO_ACCOUNT}>{c.transfer.noAccountOption}</option>
                  {accounts.map((a) => (
                    <option key={a.key} value={a.key}>
                      {accountLabel(a)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className={xferOutClass(netReceived === null)} data-testid="arrives">
                  {netReceived === null ? c.transfer.unknown : formatCurrencyIn(locale, netReceived, to)}
                </span>
                <CcySelect
                  label={c.transfer.toCurrencyLabel}
                  value={to}
                  onChange={setTo}
                  base={rate.base}
                  groups={ccyGroups}
                />
              </div>
              <div className="flex justify-between gap-3 mt-2 text-[0.8rem] text-muted">
                <span>{c.transfer.arrivesFooterLabel}</span>
                <span>{available(toAcc)}</span>
              </div>
            </div>
          </div>

          {/* WAT ER VOOR DE PLOOI BLIJFT STAAN, en waarom het geen onderbouwing is:
              dit zijn de twee antwoorden van dit scherm. Wat komt er aan (met de
              route waarmee dat gerekend is, want een bedrag zonder route is niet na
              te rekenen), en of overstappen loont. Alles wat uitlegt HOE we daaraan
              komen — de hele rangschikking, de bronnen — staat hieronder opgevouwen. */}
          <p
            className="py-3 px-4 border border-line rounded-sm bg-surface-2 leading-normal"
            style={{ marginTop: "var(--sp-4)" }}
            data-testid="uitleg"
          >
            {netReceived === null ? (
              <>
                <strong>{c.reason.arrivesUnknownLead}</strong>{" "}
                {mid === null ? (
                  c.reason.noRateForPair(from, to)
                ) : (
                  <>
                    {c.reason.marketValueNote(formatCurrencyIn(locale, grossReceived ?? 0, to))}{" "}
                    {noRouteReason()}
                  </>
                )}
              </>
            ) : sameCurrency ? (
              c.reason.sameCurrencySentence(
                formatCurrencyIn(locale, amt, from),
                formatCurrencyIn(locale, netReceived, to),
              )
            ) : (
              c.reason.conversionSentence(
                formatCurrencyIn(locale, amt, from),
                mid?.toFixed(4) ?? "",
                formatCurrencyIn(locale, grossReceived ?? 0, to),
                chosen?.bank ?? "",
                formatPercentIn(locale, costPct ?? 0),
                formatCurrencyIn(locale, costInFrom ?? 0, from),
                formatCurrencyIn(locale, netReceived, to),
              )
            )}
          </p>

          {/* DE VERPLICHTE BRONVERMELDING. Hij staat hier — vóór de plooi, altijd
              zichtbaar zodra de tweede laag in de lijst zit — en niet in de
              opgevouwen bronregel: een vermelding achter een dichte <details> is
              een vermelding die je niet ziet, en de voorwaarden vragen om een
              zichtbare. Zie AGGREGATOR_CREDIT voor de precieze eis en de datum
              waarop hij nagekeken is. */}
          {credit && (
            <p className="cell-sub" data-testid="fx-bronvermelding">
              {c.creditNotice.label}{" "}
              <a href={credit.url} target="_blank" rel="noreferrer">
                {credit.linktekst}
              </a>
              .
            </p>
          )}

          {chosen && chosen.pct !== null && !sameCurrency && (
            <>
              <p className="cell-sub" data-testid="gekozen-route">
                {chosen.mine
                  ? c.chosenRoute.yours(String(chosen.product))
                  : chosen.held
                    ? c.chosenRoute.heldElsewhere(String(chosen.product))
                    : c.chosenRoute.notHeld(String(chosen.product))}
              </p>
              {/* Wat de gekozen rekening kost om te HEBBEN. Bij een bank die hij al
                  heeft rendert dit niets: die prijs loopt toch al door en is dus
                  geen gevolg van deze conversie. Bij een bank die hij zou moeten
                  openen staat de prijs er kaal — het voordeel dat er tegenover
                  staat hoort bij de aanbeveling hieronder, niet twee keer. */}
              <Kaartkosten
                product={chosen.product ?? chosen.bank}
                cost={chosen.holdingCost}
                benefit={null}
                testId="valuta-gekozen-kosten"
              />
            </>
          )}

          {/* DE AANBEVELING, en de enige plek op dit scherm waar het woord "netto"
              mag vallen. `savingCents` is en blijft BRUTO — het verschil in
              koersopslag, want dat is wat een percentage zegt — en `net` draagt de
              drie toestanden waarin dat voordeel kan eindigen. Ze staan naast
              elkaar in plaats van samengevoegd, omdat een rekening met onbekende
              prijs geen netto HEEFT en een brutobedrag dat "netto" heet de fout is
              die deze hele ronde moest wegnemen. */}
          {beats && !sameCurrency && (
            <>
              <p
                className="py-3 px-4 border border-line rounded-sm bg-surface-2 leading-normal"
                data-testid="goedkoper"
              >
                {/* DE KOP VOLGT DE UITKOMST, en niet andersom. "Goedkoper kan"
                    boven een regel die eindigt op "je gaat er € 2,90 op achteruit"
                    is een kop die zijn eigen alinea tegenspreekt — en het is precies
                    de kop die er stond toen alleen de opslag meetelde. Drie
                    toestanden, drie koppen, uit `net.kind` en niet uit een boolean
                    van hier. */}
                <strong>
                  {beats.net.kind === "net"
                    ? c.recommendation.headingNet
                    : beats.net.kind === "no-recommendation"
                      ? c.recommendation.headingNoRecommendation
                      : c.recommendation.headingUnknown}
                </strong>{" "}
                {c.recommendation.body(
                  beats.option.bank,
                  formatPercentIn(locale, beats.option.pct ?? 0),
                  formatEuroIn(locale, beats.savingCents / 100),
                )}{" "}
                {beats.option.held ? c.recommendation.alreadyHeld : c.recommendation.notHeld}
              </p>
              <Kaartkosten
                product={beats.option.product ?? beats.option.bank}
                cost={beats.option.holdingCost}
                benefit={beats.net}
                testId="valuta-goedkoper-kosten"
              />
            </>
          )}

          {/* DE BANKENLIJST, opgevouwen. Dit was de rechterkolom.
              De klasse is een aanknopingspunt voor de test en niet voor de vorm —
              er staat geen enkele CSS-regel op — want de twee panelen hieronder
              zijn alleen uit elkaar te houden aan hun opschrift, en dat opschrift
              verandert met het aantal banken. */}
          <ToonMeer className="valuta-banken" summary={bankenLabel}>
            {routes.length === 0 ? (
              <div className="border border-dashed border-line rounded bg-surface-2 p-4">
                <p className="m-0 mb-3">{c.emptyGuide.heading}</p>
                <ul className="m-0 pl-[1.1rem] text-muted text-[0.88rem]">
                  <li className="mb-1">{c.emptyGuide.catalogueNote}</li>
                  <li className="mb-1">{c.emptyGuide.requirementsNote}</li>
                  <li className="mb-1">{c.emptyGuide.noBankNote}</li>
                </ul>
              </div>
            ) : (
              <>
                {/* WAAROM DE VOLGORDE IS WAT ZE IS, de periode waarover gerekend
                    wordt, en waartegen het verschil per rij gemeten is. Dat laatste
                    stond in de voettekst van de module die hier stond; die voettekst
                    bestaat niet meer, dus de zin is hier ingevoegd in plaats van
                    weggevallen. Zonder deze regel staat een bank met 0% opslag onder
                    een bank met 1,4% en is er niets op het scherm dat dat verklaart —
                    dezelfde regel die de kaartenlijst op Overzicht draagt, want het
                    is dezelfde rekensom. De periode hoort er hardop bij: een netto
                    bedrag zonder periode is niet na te rekenen. */}
                <p className="cell-sub">
                  {c.bankList.orderingNote(
                    formatCurrencyIn(locale, amt, from),
                    chosen ? chosen.bank : c.bankList.chosenRouteFallback,
                  )}
                </p>
                {/* Terug naar de standaardkeuze. Stond als "···"-menu in de kop van
                    de module die hier stond; die kop is weg, en een knop hoort toch
                    bij de lijst waarin je de andere keuze maakte. */}
                {pickedBank && auto && pickedBank !== auto.key && (
                  <Button style={{ marginBottom: "var(--sp-3)" }} onClick={() => setPickedBank(null)}>
                    {c.bankList.backToBest}
                  </Button>
                )}
                <ul className="travel-journeys">
                  {visible.map((r) => (
                    <RouteRow
                      key={r.key}
                      route={r}
                      chosen={chosen?.key === r.key}
                      against={chosen ?? null}
                      onPick={() => setPickedBank(r.key)}
                      locale={locale}
                      c={c}
                    />
                  ))}
                </ul>
                {hidden > 0 && (
                  <Button style={{ marginTop: "var(--sp-3)" }} onClick={() => setShowAll(true)}>
                    {hidden === 1 ? c.bankList.showMoreOne(hidden) : c.bankList.showMoreMany(hidden)}
                  </Button>
                )}
                {/* Wat de lijst wél en niet beweert. Stond achter een eigen ⓘ in de
                    modulekop; dat was een tweede uitklapper voor tekst die over deze
                    lijst gaat, dus hij staat nu onder de lijst zelf. */}
                <p>
                  <strong>{c.bankList.scopeHeading}</strong>
                  {c.bankList.scopeBody}
                </p>
                <p>{c.bankList.oneRowPerBank}</p>
                {costPct === null ? (
                  <p>{c.bankList.noRouteYet(noRouteReason())}</p>
                ) : (
                  <p>
                    <strong>{c.bankList.switchingBeatsHeading}</strong>
                    {c.bankList.switchingBeatsBody(
                      formatPercentIn(locale, costPct),
                      formatCurrencyIn(locale, costInFrom ?? 0, from),
                    )}
                  </p>
                )}
                {heldUnknown.length > 0 && (
                  <p className="cell-sub">{c.bankList.heldUnknown(heldUnknown.join(", "))}</p>
                )}
              </>
            )}
          </ToonMeer>

          {/* DE BRONREGEL, opgevouwen. Hetzelfde punt als bij de Travel Agent in
              dezelfde review: een bron hoort niet op de voorgrond, maar hij hoort
              er wel te zijn. */}
          <ToonMeer className="valuta-bronnen" summary={c.sourcesPanel.summary}>
            {/* WAAR DEZE KOERS VANDAAN KOMT, bij het bedrag en niet in de bronregel
                die hierna komt. Die bronregel vertelt waar de LIJST vandaan komt;
                dit vertelt waar de koers vandaan komt waarmee het bedrag hierboven
                gerekend is, en dat is sinds de tweede laag niet meer hetzelfde.
                Zonder deze regel staan de dollar en de dirham als even harde
                getallen naast elkaar, en dat is precies het verschil dat de
                catalogus overal bewaakt. Verhuisd hierheen (25 augustus): de
                verplichte bronvermelding moet vóór de plooi blijven, maar dit is
                geen vermelding — het is uitleg, en uitleg mag opvouwen. */}
            {koersHerkomst && (
              <p className="cell-sub" data-testid="koers-herkomst">
                {koersHerkomst}
              </p>
            )}
            {/* WAT DE KOERS IS, in beide standen, en let op wat er NIET staat.
                Er stond "offline momentopname van 2026-08-04" en dat zei niet
                waarvan het een momentopname was — terwijl het gewoon dezelfde
                ECB-middenkoers is, alleen meegebundeld (packages/core/src/fx.ts,
                nagekeken op 4 augustus). Een bron die zijn eigen herkomst niet
                noemt is geen bron.
                En er staat niet "de live koers was niet op te halen", hoe graag een
                melding ook de oorzaak noemt: `source` staat op "offline" zodra dit
                scherm opengaat en blijft daar staan tot het antwoord binnen is, dus
                deze stand dekt óók de seconde waarin de aanroep nog gewoon loopt.
                Een oorzaak die je niet uit elkaar kunt houden, mag je niet noemen.
                Een derde stand ("laden") zou dat wél kunnen; die is niet gebouwd
                omdat de overgang dan in een microtask valt en elke test die dit
                scherm monteert — twee bestanden, ruim veertig tests — daarop zou
                moeten wachten. Dat staat als open punt bij deze lane. */}
            {/* TWEE LAGEN, TWEE ALINEA'S. Ze samenvoegen tot één zin over "de
                koers" zou de indruk wekken dat er één bron is met één peildatum,
                en dat is sinds 22 augustus voor 137 van de 166 valuta onwaar.
                Elke laag noemt daarom zijn eigen aanbieder, zijn eigen datum en
                hoeveel koersen hij levert. */}
            {prov ? (
              <>
                {prov.ecb ? (
                  <p>
                    <strong>{c.sourcesPanel.layer1Heading}</strong>{" "}
                    {prov.ecb.status === "bundel"
                      ? c.sourcesPanel.layer1Bundled(prov.ecb.count, prov.ecb.date)
                      : c.sourcesPanel.layer1Reference(prov.ecb.count, prov.ecb.date)}
                    {prov.ecb.status === "geheugen" ? c.sourcesPanel.layer1MemorySuffix : ""}
                    {c.sourcesPanel.layer1Footnote}
                  </p>
                ) : (
                  <p>
                    <strong>{c.sourcesPanel.layer1Heading}</strong> {c.sourcesPanel.layer1Missing}
                  </p>
                )}
                {prov.aggregator && credit ? (
                  <p>
                    <strong>{c.sourcesPanel.layer2Heading}</strong>{" "}
                    {c.sourcesPanel.layer2Body(
                      prov.aggregator.count,
                      credit.naam,
                      prov.aggregator.date,
                      prov.aggregator.nextUpdate,
                    )}{" "}
                    <a href={credit.url} target="_blank" rel="noreferrer">
                      {credit.linktekst}
                    </a>
                    {" · "}
                    <a href={credit.voorwaarden} target="_blank" rel="noreferrer">
                      {c.sourcesPanel.termsLinkLabel}
                    </a>
                    .
                  </p>
                ) : prov.aggregator ? (
                  // DE ECHTE OORZAAK, en niet "er is geen tweede laag" — die is er
                  // wel, hij wordt geweigerd. Die twee door elkaar halen stuurt de
                  // volgende lezer naar de bron kijken terwijl het probleem in deze
                  // app zit. Er staat ook geen advies bij dat de gebruiker kan
                  // opvolgen: dit is een deploy die uit de pas loopt, en daar kan
                  // hij vanaf dit scherm niets aan doen.
                  <p>
                    <strong>{c.sourcesPanel.layer2Heading}</strong>{" "}
                    {c.sourcesPanel.layer2UnknownProvider(prov.aggregator.provider)}
                  </p>
                ) : (
                  <p>
                    <strong>{c.sourcesPanel.layer2Heading}</strong> {c.sourcesPanel.layer2Missing}
                  </p>
                )}
              </>
            ) : (
              <p>
                <strong>{c.sourcesPanel.rateHeading}</strong>{" "}
                {source === "live"
                  ? c.sourcesPanel.rateFallbackLive(rate.date)
                  : c.sourcesPanel.rateFallbackBundled(rate.date)}
              </p>
            )}
            <p>
              <strong>{c.sourcesPanel.costsHeading}</strong> {c.sourcesPanel.costsBody}
            </p>
            <p>{c.sourcesPanel.privacyNote}</p>
          </ToonMeer>
        </Module>

        {/* DE BOL, rechts. Geen `span={2}` meer: hij stond over de volle breedte
            onder de twee kolommen en is nu zelf de rechterkolom.
            De voettekst zegt met opzet geen richting ("hierboven"): op een breed
            scherm staat de rekenmachine links van de bol en op een smal scherm
            erboven, dus elke richting in die zin is de helft van de tijd onwaar. */}
        {/* Zonder voetregel, op zijn verzoek. De zin legde uit wat de bol NIET
            doet, en dat is precies het soort tekst dat hij deze ronde overal weg
            wil hebben: het scherm hoort te tonen wat er wel gebeurt. */}
        <Module title={c.moduleLabels.destinationTitle}>
          <Globe value={to} from={from} onPick={setTo} supported={currencies} />
        </Module>
      </ModuleGrid>
    </>
  );
}
