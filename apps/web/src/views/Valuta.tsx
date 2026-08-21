import { useEffect, useMemo, useState } from "react";
import type { Account, CatalogueEntryLike, FxRate, FxRouteDelta, FxRouteOption, LearnedFact } from "@lavega/core";
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
import { formatEuro } from "../format";
import catalogue from "../../../../docs/catalog/catalog.json";
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
 */

const CATALOGUE_FX: readonly CatalogueEntryLike[] =
  (catalogue as { entries?: CatalogueEntryLike[] }).entries ?? [];

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

function fmt(n: number, ccy: string): string {
  try {
    return new Intl.NumberFormat("nl-NL", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(n);
  } catch {
    // A currency code Intl doesn't know: still show the number, never a blank.
    return `${n.toLocaleString("nl-NL", { maximumFractionDigits: 2 })} ${ccy}`;
  }
}

const pctText = (p: number) => `${p.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}%`;

/** What to call a product class that is NOT a bank card. The cheapest figures in
 *  the catalogue belong to prepaid and crypto cards; they are ranked on the same
 *  evidence as the rest, and the row says what they are so the ranking does not
 *  quietly pass one off as a bank account. */
const KIND_LABEL: Record<string, string> = {
  prepaid: "prepaidkaart",
  crypto: "cryptokaart",
  beleggingsrekening: "beleggingsrekening",
};

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
function deltaWords(delta: FxRouteDelta): string | null {
  if (delta.kind === "unknown") return null;
  const money = formatEuro(Math.abs(delta.cents) / 100);
  if (delta.kind === "net") {
    return delta.cents === 0 ? "even duur" : `${money} ${delta.cents < 0 ? "minder" : "meer"} in totaal`;
  }
  return delta.cents === 0 ? "dezelfde opslag" : `${money} ${delta.cents < 0 ? "minder" : "meer"} aan opslag`;
}

/** One bank, once. Selectable, because the whole point is that he can overrule
 *  the default — and priced against the route currently chosen, in money. */
function RouteRow({
  route,
  chosen,
  against,
  onPick,
}: {
  route: FxRouteOption;
  chosen: boolean;
  against: FxRouteOption | null;
  onPick: () => void;
}) {
  // Geen bedrag als argument: beide rijen zijn door dezelfde `rankFxRoutes`-aanroep
  // op hetzelfde bedrag geprijsd. Zou het verschil hier op een ander bedrag
  // uitgerekend worden, dan kan een rij lager staan met een lager bedrag ernaast —
  // en dat leest als een fout in de app in plaats van als een rangschikking.
  const diff = chosen ? null : deltaWords(fxRouteDelta(route, against));
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
            <span className="badge">{route.held ? "van jou" : "niet van jou"}</span>
            {route.kind && KIND_LABEL[route.kind] ? (
              <>
                {" "}
                <span className="badge">{KIND_LABEL[route.kind]}</span>
              </>
            ) : null}
          </span>
          <span className="travel-journey-cost">
            {route.pct === null ? "kosten onbekend" : pctText(route.pct)}
            {diff ? ` · ${diff}` : ""}
          </span>
        </div>
        <p className="cell-sub" style={{ margin: 0 }}>
          {route.why}
          {route.asOf ? ` (bron: ${route.asOf})` : ""}
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
  const [rate, setRate] = useState<FxRate>(FX_RATE_FALLBACK);
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
          setRate(parsed);
          setSource("live");
        }
      })
      .catch(() => {/* keep fallback */});
    return () => { ok = false; };
  }, []);

  const currencies = useMemo(
    () => [rate.base, ...Object.keys(rate.rates)].filter((v, i, a) => a.indexOf(v) === i).sort(),
    [rate],
  );

  const byKey = useMemo(() => new Map(accounts.map((a) => [a.key, a])), [accounts]);
  const fromAcc = fromKey ? byKey.get(fromKey) ?? null : null;
  const toAcc = toKey ? byKey.get(toKey) ?? null : null;

  const amt = Number(amount.replace(",", ".")) || 0;

  const mid = useMemo(() => {
    try {
      return crossRate(from, to, rate);
    } catch {
      return null;
    }
  }, [from, to, rate]);

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
    () => (pickedBank ? routes.find((r) => r.key === pickedBank) ?? auto : auto),
    [routes, pickedBank, auto],
  );
  /** Het beste alternatief voor de gekozen route, met de prijs van de rekening
   *  erin verrekend. Niet meer "de laagste opslag": dat was precies de vergelijking
   *  die een kaart van € 16,90 per maand als besparing van € 14 presenteerde. */
  const beats = useMemo(() => fxRouteSwitch(chosen ?? null, routes), [chosen, routes]);

  const sameCurrency = from === to;
  // No conversion means no conversion cost — that is a fact, not an assumption.
  // Otherwise the cost is the chosen route's; unknown stays unknown.
  const costPct = sameCurrency ? 0 : chosen?.pct ?? null;
  const grossReceived = mid !== null ? amt * mid : null;
  const netReceived = grossReceived !== null && costPct !== null ? grossReceived * (1 - costPct / 100) : null;
  const costInFrom = costPct !== null ? (amt * costPct) / 100 : null;

  const heldBanks = useMemo(() => routes.filter((r) => r.held), [routes]);
  const heldUnknown = heldBanks.filter((r) => r.pct === null).map((r) => r.bank);

  /** Why there is no route to price this with — the actual reason, not a generic
   *  "onbekend". Getting this wrong once cost three days of wrong fixes. */
  const noRouteReason = (): string => {
    if (heldBanks.length === 0) {
      return accounts.length === 0
        ? "Er staat nog geen rekening in LaVega, dus er is geen bank om via te wisselen."
        : "Geen van je rekeningen hangt aan een bank die LaVega kan opzoeken — vul de bank in bij Rekeningen.";
    }
    return `Van ${heldUnknown.join(", ")} kent LaVega de koersopslag niet, en een onbekend tarief is geen 0%.`;
  };

  const visible = showAll ? routes : routes.filter((r, i) => i < VISIBLE_ROUTES || r.held);
  const hidden = routes.length - visible.length;

  /** Selecting an account sets the leg's currency to that account's own — the
   *  currency of the money is a property of the account, not a free choice. */
  function pickFrom(key: string) {
    setFromKey(key);
    const c = key ? byKey.get(key)?.currency : undefined;
    if (c && /^[A-Za-z]{3}$/.test(c)) setFrom(c.toUpperCase());
  }
  function pickTo(key: string) {
    setToKey(key);
    const c = key ? byKey.get(key)?.currency : undefined;
    if (c && /^[A-Za-z]{3}$/.test(c)) setTo(c.toUpperCase());
  }
  function swap() {
    setFrom(to);
    setTo(from);
    setFromKey(toKey);
    setToKey(fromKey);
  }

  const available = (a: Account | null) =>
    a === null ? "—" : a.balance === null ? "onbekend" : fmt(a.balance, a.currency || "EUR");

  /** Het opschrift van de uitgeklapte bankenlijst. Het moet een belofte zijn en
   *  geen "meer informatie" — met het aantal erin weet je meteen of het de moeite
   *  is om open te klikken. Zonder banken belooft hij iets anders, want dan zit er
   *  geen lijst achter maar een uitleg waarom die er niet is. */
  const bankenLabel =
    routes.length === 0
      ? "Waarom er nog geen bank te rangschikken is"
      : `Alle ${routes.length} banken, goedkoopste eerst`;

  return (
    <>
      <div className="view-head">
        <h2>Geld overzetten</h2>
        {/* De kop volgt de koers die er ECHT ligt. Hier stond "live ECB-middenkoers"
            als vaste tekst, en dat is de eerste regel van het scherm die onwaar is
            zodra de aanroep niet aankomt: dan rekent de tab met de meegebundelde
            momentopname van begin augustus terwijl er "live" boven staat. */}
        <span className="eyebrow">
          {source === "live" ? "live ECB-middenkoers" : `ECB-middenkoers van ${rate.date} uit de app`} · koersopslag
          per bank uit de catalogus
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
      <ModuleGrid className="grid-2" label="Valuta">
        <Module title="Overzetten" height="tall">
          <div className="xfer">
            <div className="xfer-leg">
              <div className="xfer-leg-head">
                <span className="xfer-leg-label">Van rekening</span>
                <select className="xfer-account" aria-label="Van rekening" value={fromKey} onChange={(e) => pickFrom(e.target.value)}>
                  <option value={NO_ACCOUNT}>geen rekening gekozen</option>
                  {accounts.map((a) => (
                    <option key={a.key} value={a.key}>{accountLabel(a)}</option>
                  ))}
                </select>
              </div>
              <div className="xfer-amount-row">
                <input
                  className="xfer-amount"
                  type="number"
                  step={0.01}
                  min={0}
                  value={amount}
                  aria-label="Bedrag"
                  onChange={(e) => setAmount(e.target.value)}
                />
                <select className="xfer-ccy" aria-label="Van valuta" value={from} onChange={(e) => setFrom(e.target.value)}>
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="xfer-foot">
                <span>Beschikbaar</span>
                <span>{available(fromAcc)}</span>
              </div>
            </div>

            <button type="button" className="xfer-swap" aria-label="Wissel van en naar" onClick={swap}>
              <span aria-hidden="true">⇅</span>
            </button>

            <div className="xfer-leg">
              <div className="xfer-leg-head">
                <span className="xfer-leg-label">Naar rekening</span>
                <select className="xfer-account" aria-label="Naar rekening" value={toKey} onChange={(e) => pickTo(e.target.value)}>
                  <option value={NO_ACCOUNT}>geen rekening gekozen</option>
                  {accounts.map((a) => (
                    <option key={a.key} value={a.key}>{accountLabel(a)}</option>
                  ))}
                </select>
              </div>
              <div className="xfer-amount-row">
                <span className={`xfer-out${netReceived === null ? " xfer-out-unknown" : ""}`} data-testid="arrives">
                  {netReceived === null ? "onbekend" : fmt(netReceived, to)}
                </span>
                <select className="xfer-ccy" aria-label="Naar valuta" value={to} onChange={(e) => setTo(e.target.value)}>
                  {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="xfer-foot">
                <span>Komt aan na kosten · beschikbaar</span>
                <span>{available(toAcc)}</span>
              </div>
            </div>
          </div>

          {/* WAT ER VOOR DE PLOOI BLIJFT STAAN, en waarom het geen onderbouwing is:
              dit zijn de twee antwoorden van dit scherm. Wat komt er aan (met de
              route waarmee dat gerekend is, want een bedrag zonder route is niet na
              te rekenen), en of overstappen loont. Alles wat uitlegt HOE we daaraan
              komen — de hele rangschikking, de bronnen — staat hieronder opgevouwen. */}
          <p className="reason" style={{ marginTop: "var(--sp-4)" }} data-testid="uitleg">
            {netReceived === null ? (
              <>
                <strong>Wat er aankomt is onbekend.</strong>{" "}
                {mid === null
                  ? `LaVega heeft geen koers voor ${from} → ${to}.`
                  : (
                    <>
                      Tegen de middenkoers is dit {fmt(grossReceived ?? 0, to)} waard, maar dat is de marktwaarde
                      en niet het bedrag dat aankomt. {noRouteReason()}
                    </>
                  )}
              </>
            ) : (
              <>
                Je zet <span className="reason-figure">{fmt(amt, from)}</span> over,{" "}
                {sameCurrency ? (
                  <>zonder omwisseling. Er komt <span className="reason-figure">{fmt(netReceived, to)}</span> aan.</>
                ) : (
                  <>
                    tegen middenkoers {mid?.toFixed(4)} is dat {fmt(grossReceived ?? 0, to)}. Via{" "}
                    <strong>{chosen?.bank}</strong> kost dat {pctText(costPct ?? 0)} ({fmt(costInFrom ?? 0, from)}),
                    dus er komt <span className="reason-figure">{fmt(netReceived, to)}</span> aan.
                  </>
                )}
              </>
            )}
          </p>

          {chosen && chosen.pct !== null && !sameCurrency && (
            <>
              <p className="cell-sub" data-testid="gekozen-route">
                {chosen.mine
                  ? `Gerekend met ${chosen.product}, het product dat je hier hebt.`
                  : `Gerekend met ${chosen.product}${chosen.held ? " — controleer of dat jouw pakket is" : " — deze bank heb je nog niet"}.`}
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
              <p className="reason" data-testid="goedkoper">
                {/* DE KOP VOLGT DE UITKOMST, en niet andersom. "Goedkoper kan"
                    boven een regel die eindigt op "je gaat er € 2,90 op achteruit"
                    is een kop die zijn eigen alinea tegenspreekt — en het is precies
                    de kop die er stond toen alleen de opslag meetelde. Drie
                    toestanden, drie koppen, uit `net.kind` en niet uit een boolean
                    van hier. */}
                <strong>
                  {beats.net.kind === "net"
                    ? "Goedkoper kan."
                    : beats.net.kind === "no-recommendation"
                      ? "Lagere opslag, maar niet goedkoper."
                      : "Lagere opslag — of dat goedkoper uitpakt, weet LaVega niet."}
                </strong>{" "}
                {beats.option.bank} rekent {pctText(beats.option.pct ?? 0)} — dat is{" "}
                {formatEuro(beats.savingCents / 100)} minder aan koersopslag op dit bedrag.{" "}
                {beats.option.held
                  ? "Die bank heb je al; kies hem in de lijst."
                  : "Die bank heb je niet — je zou er eerst rekening bij moeten openen."}
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
              <div className="empty-guide">
                <p>Nog geen bank om te rangschikken.</p>
                <ul>
                  <li>De catalogus levert de tarieven; die zit in de app en wordt niet opgehaald.</li>
                  <li>Een tarief telt alleen mee met waarde, bron, datum én voorwaarden — anders wordt het geweigerd.</li>
                  <li>Rekeningen zonder bank kunnen niet opgezocht worden; vul de bank in bij Rekeningen.</li>
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
                  De volgorde is wat deze conversie je bij die bank kost: de koersopslag op {fmt(amt, from)} plus wat
                  de rekening kost om te openen. Dat laatste telt voor minstens één hele factureringsperiode — een
                  maand, of een jaar bij een jaarproduct — want je kunt geen rekening voor een dag openen. Een bank
                  die je al hebt kost je niets extra: die prijs loopt toch al. Staat er “kaartkosten onbekend”, dan
                  zit alleen de opslag in het bedrag; dat is een ondergrens, geen bewijs dat de rekening gratis is.
                  Het verschil achter elke bank is gerekend tegen {chosen ? chosen.bank : "de gekozen route"}.
                </p>
                {/* Terug naar de standaardkeuze. Stond als "···"-menu in de kop van
                    de module die hier stond; die kop is weg, en een knop hoort toch
                    bij de lijst waarin je de andere keuze maakte. */}
                {pickedBank && auto && pickedBank !== auto.key && (
                  <button type="button" className="btn" style={{ marginBottom: "var(--sp-3)" }} onClick={() => setPickedBank(null)}>
                    Terug naar beste
                  </button>
                )}
                <ul className="travel-journeys">
                  {visible.map((r) => (
                    <RouteRow
                      key={r.key}
                      route={r}
                      chosen={chosen?.key === r.key}
                      against={chosen ?? null}
                      onPick={() => setPickedBank(r.key)}
                    />
                  ))}
                </ul>
                {hidden > 0 && (
                  <button type="button" className="btn" style={{ marginTop: "var(--sp-3)" }} onClick={() => setShowAll(true)}>
                    Nog {hidden} {hidden === 1 ? "bank" : "banken"} tonen
                  </button>
                )}
                {/* Wat de lijst wél en niet beweert. Stond achter een eigen ⓘ in de
                    modulekop; dat was een tweede uitklapper voor tekst die over deze
                    lijst gaat, dus hij staat nu onder de lijst zelf. */}
                <p>
                  <strong>De lijst gaat over alle banken die LaVega kan onderbouwen</strong> — niet alleen die van
                  jou. Standaard rekent LaVega met de goedkoopste route die je vandaag echt kunt gebruiken; een bank
                  die je niet hebt staat erbij, met het verschil in euro's, maar wordt nooit stilzwijgend gekozen.
                </p>
                <p>
                  Eén regel per bank: bij overzetten maakt het product niet uit, dus dezelfde bank staat niet
                  driemaal in de lijst. Welk product achter het tarief zit, staat er wel bij — "ING 0%" geldt alleen
                  voor de Platinumcard.
                </p>
                {costPct === null ? (
                  <p>{noRouteReason()} Zolang dat zo is, kan LaVega niet zeggen wat er aankomt. Een onbekend tarief is geen 0%.</p>
                ) : (
                  <p>
                    <strong>Waar overstappen je zou verslaan:</strong> je huidige keuze kost {pctText(costPct)}.
                    Elke bank die minder rekent, houdt op dit bedrag meer dan {fmt(costInFrom ?? 0, from)} voor je
                    over — aan koersopslag. Wat die rekening kost om te openen gaat daar nog vanaf, en dat is
                    precies waarom de volgorde niet op het percentage gaat.
                  </p>
                )}
                {heldUnknown.length > 0 && (
                  <p className="cell-sub">
                    Zonder bekend tarief, dus onderaan: {heldUnknown.join(", ")}.
                  </p>
                )}
              </>
            )}
          </ToonMeer>

          {/* DE BRONREGEL, opgevouwen. Hetzelfde punt als bij de Travel Agent in
              dezelfde review: een bron hoort niet op de voorgrond, maar hij hoort
              er wel te zijn. */}
          <ToonMeer className="valuta-bronnen" summary="Waar de koers en de tarieven vandaan komen">
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
            <p>
              <strong>Koers:</strong>{" "}
              {source === "live"
                ? `live ECB-middenkoers via Frankfurter, peildatum ${rate.date}`
                : `de meegebundelde ECB-middenkoers van ${rate.date}, want er staat nu geen live koers in dit scherm`}
              .
            </p>
            <p>
              <strong>Kosten:</strong> de koersopslag zoals de bank die zelf in haar tarievenoverzicht noemt.
              Elke regel draagt de bron en de datum die dat document noemt.
            </p>
            <p>Er wordt niets over je rekeningen verstuurd om die koers of die tarieven op te halen.</p>
          </ToonMeer>
        </Module>

        {/* DE BOL, rechts. Geen `span={2}` meer: hij stond over de volle breedte
            onder de twee kolommen en is nu zelf de rechterkolom.
            De voettekst zegt met opzet geen richting ("hierboven"): op een breed
            scherm staat de rekenmachine links van de bol en op een smal scherm
            erboven, dus elke richting in die zin is de helft van de tijd onwaar. */}
        <Module
          title="Waar ga je heen?"
          footer={<span>De bol zet alleen de doelvaluta in de rekenmachine — er komt geen tweede berekening bij.</span>}
        >
          <Globe value={to} from={from} onPick={setTo} supported={currencies} />
        </Module>
      </ModuleGrid>
    </>
  );
}
