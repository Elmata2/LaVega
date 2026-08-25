import { useEffect, useMemo, useState } from "react";
import type { Account, Tx, AccountRate, CatalogueEntryLike, FeeAmount, LearnedFact, NetBasis, NetBenefit, OwnAccounts, RateBenchmark, Rule, Subscription } from "@lavega/core";
import {
  merchantTallies,
  accountCosts,
  accountLabel,
  accountReturns,
  assumptionDueForReview,
  cashbackPctOf,
  CATALOGUE_KINDS_FOR,
  describeCashback,
  describeHeldCashback,
  factEntry,
  hasCostsToShow,
  heldCashbackOf,
  isSpendable,
  lastTermsCheckedForIssuer,
  optimiseReturns,
  productOf,
  TRAVEL_AGENT,
  MIN_SPEND_DAYS,
  detectSubscriptions,
  subscriptionPriceIncreases,
  subscriptionOverlaps,
  subscriptionCoverage,
  analyzeInterest,
  keptRate,
  MARGIN_PCT,
  matchBankBenchmark,
  accountType,
  CADENCE_LABEL_NL,
  NL_SAVINGS_RATES,
  RATES_AS_OF,
  cashbackSwitchGain,
  marketCashbackOptions,
  categorize,
  holdingCostOfProduct,
  netBenefit,
  productFeesById,
} from "@lavega/core";
import { createRatesProvider, type RatesResult } from "@lavega/adapters";
import { CATALOGUE_RATES, CATALOGUE_ENTRIES } from "../catalogue-rates";
import { getCashbackAssumptionEnabled } from "../settings";
import { formatEuro, monthLabelNL } from "../format";
import Module, { ModulePeriod } from "../components/Module";
import ModuleGrid from "../components/ModuleGrid";
import ToonMeer from "../components/ToonMeer";
import "../styles/views.css";

/* Optimalisatie — rebalanced (UI review, 2026-08-16).
 *
 * Two changes, both his words:
 *   1. "the reasoning must be explicit and end in a number" — every interest
 *      suggestion is now one sentence that names the account, its rate, the
 *      bank that pays more, and the euros per year that follow from it.
 *   2. subscriptions much larger, the savings-rate part smaller and the two
 *      roughly equal in weight — hence the two-column grid instead of a short
 *      subscriptions card above a rate card with three tables.
 *
 * The thin/empty subscriptions state is INFORMATIVE, not seeded: it counts what
 * LaVega actually saw in his own transactions and explains the pattern it looks
 * for. The worked example is behind a disclosure and labelled as an example; it
 * is never written to the vault.
 *
 * APP REVIEW 2 (20 August) — three removals and one reshape, all his call:
 *   - woonlasten is GONE. The derivation was right; the tile was not acted on,
 *     and this screen is about subscriptions and rates.
 *   - the prijsstijging and dubbele-functie tiles render only when they have a
 *     number to report. "Don't render an empty one." The check is still stated,
 *     in one clause in the Abonnementen footer, so an absent tile cannot read as
 *     an absent check.
 *   - Cashback now has the Rente module's three beats: what your own best card
 *     would return, what the best card we can PROVE returns, and the difference
 *     in euros on a base he recognises. See `monthlyBaseCents` for why the base
 *     is the monthly average and not last month. */

// Where to fetch the public rate benchmark. Set VITE_RATES_URL to your rates
// service; in dev it defaults to the local Hono server (run `pnpm dev:server`).
// Unset in prod => no fetch, offline snapshot. Only public data is requested.
const RATES_URL: string | undefined =
  import.meta.env.VITE_RATES_URL ?? (import.meta.env.DEV ? "http://localhost:8787/api/rates" : undefined);

const RATES_SOURCE_LABEL: Record<RatesResult["source"], string> = {
  live: "🟢 live opgehaald",
  cache: "uit cache",
  bundled: "offline momentopname",
};

type OptimalisatieProps = {
  txs: Tx[];
  accounts: Account[];
  /** Categorisation inputs. The cashback base counts SPENDING, so it has to
   *  exclude his own transfers — a sweep to savings is not consumption — and
   *  that needs the same rules and own-account set every other categorised view
   *  uses. Core's `accountReturns` takes them for the same reason. */
  rules: Rule[];
  own: OwnAccounts;
  asOf: string;
  busy: boolean;
  /** What the agents have learned, for the cashback figures. Keyed by
   *  productOf(), the same key the travel agent uses. */
  facts: readonly LearnedFact[];
  /** The product catalogue, for the market-wide cashback ranking. Injectable so
   *  a test can state its own market instead of asserting against whatever the
   *  catalogue happened to hold that morning; the bundled one is the default and
   *  App.tsx passes nothing. */
  entries?: readonly CatalogueEntryLike[];
  /** De vergelijkingsrentes waar het scherm mee BEGINT, injecteerbaar om dezelfde
   *  reden als `entries`: een test moet zijn eigen markt kunnen stellen in plaats
   *  van te beweren tegen wat de ingebakken tabel die ochtend toevallig bevatte.
   *  Hier is er nog een reden bij, en die is bindend: alleen catalogusrentes
   *  dragen een `productId`, en dus alleen zij kunnen aan een PRIJS gekoppeld
   *  worden — en die komen in de app pas binnen via het effect hieronder, dat een
   *  statische render niet draait. Zonder dit haakje was de nettoberekening van de
   *  rentemodule op dit scherm niet te testen. App.tsx geeft niets mee. */
  initialRates?: readonly RateBenchmark[];
  onRateCommit: (key: string, value: string) => void;
};

const euro = (cents: number) => formatEuro(cents / 100);
const pct = (p: number) => `${p.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}%`;

/** What a rate is worth to someone who stays. A teaser whose standing rate the
 *  source never gave says "onbekend" — not the teaser, and not 0%. */
const keptLabel = (r: RateBenchmark) => {
  const kept = keptRate(r);
  return kept === null ? "onbekend" : pct(kept);
};

const SOURCE_LABEL: Record<AccountRate["source"], string> = {
  manual: "handmatig",
  detected: "geschat uit rente",
  benchmark: "geschat via banktarief",
  assumed: "aangenomen 0%",
  unknown: "onbekend",
};

/** A worked example of the subscriptions table. Explicitly NOT his data: it is
 *  rendered behind a disclosure, labelled, and never saved anywhere. Seeding
 *  rows into the vault to make the block look full would put numbers he cannot
 *  trust next to numbers he can. */
const EXAMPLE_SUBS = [
  { name: "Netflix", fn: "Videostreaming", monthly: 1599, last: 1599, change: 0.14 },
  { name: "Spotify", fn: "Muziekstreaming", monthly: 1199, last: 1199, change: 0.09 },
  { name: "Adobe Creative Cloud", fn: "Software", monthly: 6899, last: 6899, change: 0 },
  { name: "Odido", fn: "Telecom", monthly: 3500, last: 3500, change: -0.05 },
] as const;

/* ── DE PERIODESCHAKELAAR OP ABONNEMENTEN ─────────────────────────────────
 *
 * Hier stond overal "per maand" als vaste eenheid, en die vaste eenheid verborg
 * TWEE STILLE OMREKENINGEN die allebei fout waren. Gemeten, niet beredeneerd:
 *
 *  1. DE JAARKOLOM WAS `monthlyCents * 12`, en `monthlyCents` is bij een
 *     jaarabonnement zelf al een deling: core rekent `bedrag × 30 / ritme`. Een
 *     abonnement van € 120,00 per jaar kwam daardoor uit op € 9,86 per maand en
 *     op € 118,32 per jaar — terwijl het bedrag dat op zijn afschrift staat
 *     € 120,00 is. Een kolom die "per jaar" heet en het jaarbedrag mist met
 *     € 1,68, terwijl het jaarbedrag het énige is dat werkelijk is afgeschreven.
 *  2. DE PRIJSSTIJGINGSZIN REKENDE ELK VERSCHIL × 12. `fromCents`/`toCents` zijn
 *     de afgeschreven bedragen in hun eigen ritme, dus een verhoging van € 10,00
 *     op een JAARabonnement werd gemeld als "€ 120,00 per jaar extra". Twaalf
 *     keer te veel, op de regel die hem juist moet laten opzeggen.
 *
 * Allebei dezelfde fout: rekenen met een getal dat al een omrekening wás. Dus
 * geldt hier de regel die `accountCosts` in packages/core al aanhoudt met
 * `period` en `perYearDerived` — ER WORDT NERGENS STIL OMGEREKEND:
 *
 *   - er wordt altijd gerekend vanaf `lastAmountCents`, het bedrag dat ÍS
 *     afgeschreven, en nooit vanaf een afgeleide;
 *   - is de getoonde eenheid niet die van de afschrijving, dan draagt de cel de
 *     som zichtbaar mee ("12 × € 9,99", "€ 120,00 ÷ 12") — precies zoals de
 *     kostentabel verderop `perYearDerived` toont;
 *   - en de eenheid van de afschrijving verdwijnt NOOIT achter de schakelaar:
 *     de kolom "Op je afschrift" staat er in elke stand, met het ritme erbij.
 *
 * DE DRIE STANDEN, en waarom er geen vierde is. "Per kwartaal" is overwogen en
 * afgewezen: maand en jaar zijn de eenheden die de rest van deze app draagt
 * (`FeePeriod` in accountCosts is letterlijk `"maand" | "jaar"`), en een vierde
 * eenheid toevoegen die nergens anders bestaat maakt van elke vergelijking met
 * de kosten- en rentemodules weer een omrekening. */

export type SubPeriod = "eigen" | "maand" | "jaar";

export const SUB_PERIODS: { value: SubPeriod; label: string }[] = [
  { value: "eigen", label: "Zoals afgeschreven" },
  { value: "maand", label: "Per maand" },
  { value: "jaar", label: "Per jaar" },
];

/** Hoeveel MAANDEN één afschrijving beslaat, per ritme dat de detector kent
 *  (CADENCE_BANDS in core). Kalendermaanden, geen dagen: een maandabonnement
 *  wordt twaalf keer per jaar afgeschreven en niet 365/30 = 12,17 keer. Op die
 *  dagbenadering ging het mis — zie de kop hierboven.
 *
 *  Het spiegelt `FEE_PERIOD_MONTHS` in accountCosts, en om dezelfde reden: "een
 *  jaar is twaalf maanden" hoort op één plek te staan, zodat een zesde ritme er
 *  hier bijkomt en niet in elke aanroeper. */
export const CADENCE_MONTHS: Readonly<Record<number, number>> = { 30: 1, 61: 2, 91: 3, 182: 6, 365: 12 };

/** Het ritme in woorden, met een terugval die het ritme noemt in plaats van het
 *  te verzwijgen. Op moduleniveau zodat de tabel, de zinnen en de tests hem
 *  delen. */
export const cadenceName = (days: number) => CADENCE_LABEL_NL[days] ?? `elke ${days} dagen`;

/** Een bedrag in de gevraagde eenheid — of de mededeling dat het niet kan.
 *
 *  Een unie en geen `cents: number | null`, om dezelfde reden als
 *  `AccountCostTotal` in packages/core: dat laatste nodigt uit tot `?? 0`, en
 *  een abonnement waarvan we het ritme niet kennen mag nooit als € 0,00 in een
 *  som of in een kolom belanden. */
export type SubAmount =
  | {
      kind: "bedrag";
      /** In centen, in de gevraagde eenheid. */
      cents: number;
      /** true als `cents` ONZE rekensom is en niet het bedrag dat is afgeschreven. */
      derived: boolean;
      /** Die rekensom in woorden ("12 × € 9,99"), of null als er niets is
       *  omgerekend. Hier gemaakt en niet in de JSX, zodat beide takken zonder
       *  render te controleren zijn. */
      sum: string | null;
    }
  | {
      /** Het ritme zit niet in CADENCE_MONTHS, dus omrekenen zou raden zijn. */
      kind: "onbekend-ritme";
      cadenceDays: number;
    };

/** Reken `cents`, afgeschreven op ritme `cadenceDays`, om naar `period`.
 *
 *  Naar JAAR wordt alleen VERMENIGVULDIGD (12/1, 12/2, 12/3, 12/6, 12/12 zijn
 *  allemaal hele getallen), dus dat bedrag is exact. Naar MAAND wordt gedeeld en
 *  dus afgerond, en precies daarom draagt die cel `derived` en de som: € 120,00
 *  per jaar is € 10,00 per maand, maar dat tientje staat op geen enkel
 *  afschrift. */
export function amountInPeriod(cents: number, cadenceDays: number, period: SubPeriod): SubAmount {
  if (period === "eigen") return { kind: "bedrag", cents, derived: false, sum: null };
  const months = CADENCE_MONTHS[cadenceDays];
  if (months === undefined) return { kind: "onbekend-ritme", cadenceDays };
  if (period === "jaar") {
    const times = 12 / months;
    return { kind: "bedrag", cents: cents * times, derived: times !== 1, sum: times === 1 ? null : `${times} × ${euro(cents)}` };
  }
  return {
    kind: "bedrag",
    cents: Math.round(cents / months),
    derived: months !== 1,
    sum: months === 1 ? null : `${euro(cents)} ÷ ${months}`,
  };
}

/** Wat één abonnement in de gekozen eenheid kost. Altijd vanaf het AFGESCHREVEN
 *  bedrag (`lastAmountCents`) en nooit vanaf `monthlyCents` — dat laatste is
 *  zelf al een omrekening, en rekenen met een omrekening is hoe de jaarkolom
 *  € 1,68 kwijtraakte. */
export function subAmountIn(sub: Subscription, period: SubPeriod): SubAmount {
  return amountInPeriod(sub.lastAmountCents, sub.cadenceDays, period);
}

export type SubTotal = {
  cents: number;
  /** De eenheid waarin het totaal staat, en die de zin eromheen moet noemen. */
  unit: "maand" | "jaar";
  /** Abonnementen die NIET in dit totaal zitten omdat hun ritme niet om te
   *  rekenen was. Geteld en niet stil als nul meegeteld — een totaal met een gat
   *  erin hoort te zeggen dat het een gat heeft. */
  onbekend: number;
};

/** Het totaal van een lijst, in één eenheid.
 *
 *  "Zoals afgeschreven" valt hier terug op het JAARBEDRAG, en dat is geen
 *  slordigheid maar de enige mogelijkheid: een totaal heeft een gedeelde noemer
 *  nodig, en een maandbedrag bij een jaarbedrag optellen levert een getal op dat
 *  niets betekent. Dezelfde afweging die `accountFees` maakt als het op het
 *  jaarbedrag sorteert. De zin eromheen noemt `unit`, dus de lezer ziet welke
 *  noemer het geworden is. */
export function subsTotalIn(subs: readonly Subscription[], period: SubPeriod): SubTotal {
  const unit = period === "maand" ? "maand" : "jaar";
  let cents = 0;
  let onbekend = 0;
  for (const s of subs) {
    const a = subAmountIn(s, unit);
    if (a.kind !== "bedrag") {
      onbekend++;
      continue;
    }
    cents += a.cents;
  }
  return { cents, unit, onbekend };
}

/** "per maand" / "per jaar", voor in een lopende zin. */
export const perUnit = (unit: "maand" | "jaar") => `per ${unit}`;

/** Money moved between his own accounts is not spending. Same string core's
 *  `annualSpendCents` excludes, and for the same reason: a €50k sweep to savings
 *  is not €50k of consumption, so it must not sit in a cashback base either. */
const OWN_TRANSFER = "Eigen overboeking";

/** Calendar arithmetic on the ISO string, so nothing here reads a clock or a
 *  timezone. `shiftMonth("2025-01", 2) === "2024-11"`. */
function shiftMonth(ym: string, back: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) - back;
  return `${String(Math.floor(t / 12)).padStart(4, "0")}-${String((t % 12) + 1).padStart(2, "0")}`;
}

function lastDayOf(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const len = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return `${ym}-${String(len).padStart(2, "0")}`;
}

/** WHAT HE SPENT IN THE LAST MONTH THE IMPORT COVERS END TO END.
 *
 *  Not "the last month with data": a statement export made on the 15th holds
 *  half a month, and half a month printed as "last month" understates what he
 *  spends while looking precise doing it. So walk back until a month is covered
 *  from its first day to its last, and stop at the month the import starts in —
 *  everything before that is only worse.
 *
 *  Returns null when no month is covered in full, which is a legitimate answer
 *  and prints as nothing at all rather than as a zero. */
function lastFullMonthSpend(
  keys: readonly string[],
  txs: Tx[],
  rules: Rule[],
  own: OwnAccounts,
  asOf: string,
): { ym: string; cents: number } | null {
  const set = new Set(keys);
  const mine = txs.filter((t) => set.has(t.accountKey) && t.date <= asOf);
  if (mine.length === 0) return null;
  const dates = mine.map((t) => t.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];

  for (let back = 0; back < 24; back++) {
    const ym = shiftMonth(last.slice(0, 7), back);
    const start = `${ym}-01`;
    const end = lastDayOf(ym);
    if (first > start) break; // the import begins inside this month
    if (last < end || end > asOf) continue; // the month is not finished yet
    let cents = 0;
    for (const t of mine) {
      if (t.amount >= 0) continue;
      if (t.date < start || t.date > end) continue;
      if (categorize(t, rules, own) === OWN_TRANSFER) continue;
      cents += Math.round(-t.amount * 100);
    }
    return { ym, cents };
  }
  return null;
}

/** What a product IS, not only what it pays. Every covered cashback figure in
 *  the catalogue today belongs to a prepaid or a crypto card, so a ranking that
 *  printed a bank's name and a percentage would quietly pass one off as an
 *  ordinary bank card. Valuta labels the same two kinds for the same reason. */
const ALT_KIND_LABEL: Record<string, string> = { prepaid: "prepaidkaart", crypto: "cryptokaart" };

/* ── WAT WE VAN ZIJN EIGEN KAARTEN WETEN, en hoe hard ──────────────────────
 *
 * App review 4, punt 22. Zijn woorden: "for most cards — ING, ABN, most normal
 * ones — they don't have cashback… if there's no case then it's zero." Terecht,
 * en de module bleef juist bij die kaarten op "onbekend" hangen.
 *
 * DE UITVOERING IS EEN ZICHTBARE TIER EN GEEN STILLE NUL, en die woont in
 * packages/core/src/assumedCashback.ts: `HeldCashback` draagt de vier toestanden,
 * `heldCashbackOf` de volgorde waarin ze elkaar verslaan, `describeHeldCashback`
 * de zin die erbij hoort. Dat stond eerst hier, tot de feedbackmodule in Profiel
 * dezelfde vraag moest beantwoorden en er twee versies van dezelfde beslissing
 * naast elkaar stonden. Wat dit scherm er nog aan toevoegt is één ding: het kiest
 * de BESTE eigen kaart, en houdt de hardheid aan dat getal vast — zie `bestHeld`.
 */

/* ── Vaste rekeningkosten: de kant die doorloopt ───────────────────────────
 *
 * De andere drie modules rekenen aan wat geld OPLEVERT. Deze rekent aan wat het
 * kost om te houden wat je al hebt — de maand- of jaarprijs van een pakket of
 * een kaart. Core doet het rekenwerk (`accountCosts`); dit scherm print het, en
 * houdt zich aan dezelfde twee regels:
 *   - een bedrag houdt de eenheid van zijn eigen document. ING rekent per maand,
 *     ICS per jaar; het jaarbedrag staat er zichtbaar naast met "12 ×" erbij, in
 *     plaats van dat er een jaarprijs verschijnt die nergens gedrukt staat.
 *   - onbekend is geen nul. Een rekening zonder tarief staat in de tabel met
 *     "niet in het totaal" in de jaarkolom, zodat de som en het scherm hetzelfde
 *     verhaal vertellen.
 */

/** Het bedrag zoals de bron het noemt: "€ 4,00 per maand", "€ 42,95 per jaar". */
const feeLabel = (a: FeeAmount) => `${euro(a.cents)} per ${a.period}`;

/* ── WAT HET PRODUCT ZELF KOST, in de drie toestanden die er echt zijn ───────
 *
 * De rentemodule rekende alleen aan de OPBRENGST: een hoger percentage, dus
 * zoveel euro per jaar, en geen woord over wat die nieuwe rekening kost. De helft
 * die je niet ziet is degene die je pakt — een kaart die € 16,90 per maand kost
 * en € 13,66 oplevert is achteruit. `netBenefit` doet de aftrek in core; dit blok
 * print hem.
 *
 * ÉÉN COMPONENT VOOR BEIDE MODULES, en dat is de hele reden dat hij bestaat.
 * Cashback had deze drie toestanden al, rente had er nul, en de makkelijke weg
 * was ze bij rente over te schrijven. Dan staan er twee teksten over hetzelfde
 * gat en zeggen ze op een dag iets anders. Het reisblok spreekt dezelfde taal
 * (zie `Kaartkosten` in TravelBlock.tsx): eerst de prijs, dan wat er overblijft,
 * en in de derde tak valt het woord "netto" niet.
 *
 * WAAROM HIJ NIET UIT TravelBlock KOMT: die versie zet "Kaartkosten:" hard in de
 * kop en is om één kaart heen geschreven, terwijl het hier ook over een
 * spaarrekening gaat. De ZINNEN zijn er letterlijk uit overgenomen, want de twee
 * schermen mogen niet twee verschillende dingen beweren over hetzelfde gat.
 *
 * ALLEEN TERUGKEREND, en dat is geen weglating. Op dit scherm staat een
 * terugkerende opbrengst (cashback per maand, rente per jaar) tegenover een
 * terugkerende prijs, dus ze gaan schoon van elkaar af. De eenmalige vorm — een
 * winst van één reis tegen een prijs die doorloopt — heeft een horizon nodig en
 * hoort bij het reisblok. Komt er hier ooit toch een eenmalige benefit langs,
 * dan zegt `spanWords` over hoeveel periodes gerekend is in plaats van te doen
 * alsof er niets aan de hand is.
 */

/** Over welke periode er gerekend is, in woorden. Dezelfde woorden als core's
 *  `describeNetBenefit` en als het reisblok, zodat een lezer die beide schermen
 *  ziet niet twee rekenwijzen hoeft te vergelijken. */
function spanWords(basis: NetBasis): string {
  if (basis.kind === "recurring") return `per ${basis.period}`;
  const n = basis.periodsCharged;
  return basis.costPeriod === "jaar" ? `over ${n} jaar` : `over ${n} ${n === 1 ? "maand" : "maanden"}`;
}

function Productkosten({ net, id, noun, gainWord, costWord, unknownTail }: {
  net: NetBenefit;
  /** Voorvoegsel voor de testids: "cashback" → cashback-kosten / -netto / -geen. */
  id: string;
  /** "kaart" of "rekening" — het ding waar de prijs bij hoort. */
  noun: string;
  /** Wat de opbrengst ís, in de zin die zegt waarom het geen aanbeveling is:
   *  "meer cashback", "meer rente". */
  gainWord: string;
  /** Hoe de kosten heten in diezelfde zin: "kaartkosten", "rekeningkosten". */
  costWord: string;
  /** Eén zin extra bij onbekende kosten, als er iets nuttigs bij te zeggen valt
   *  — bijvoorbeeld waar de prijzen die we WEL kennen te vinden zijn. */
  unknownTail?: string;
}) {
  // KOSTEN ONBEKEND. Het woord "netto" komt hier NIET voor, en dat is de hele
  // reden dat deze tak apart staat: er is geen netto zolang de ene helft
  // ontbreekt. Wel wordt gezegd dat het bedrag hierboven bruto is — anders leest
  // een onbekende prijs als nul, en dat is precies de fout.
  if (net.kind === "gross-cost-unknown") {
    return (
      <p className="cell-sub" data-testid={`${id}-kosten`}>
        <strong>Wat deze {noun} zelf kost, weten we niet.</strong>{" "}
        {net.cost.reason === "needs-another-product"
          ? `De prijs die onze bron noemt geldt bovenop een ander product, dus wat deze ${noun} los kost staat er niet.`
          : "Geen van onze bronnen noemt een maand- of jaarprijs voor dit product."}{" "}
        Dat is geen nul, en het gaat van het bedrag hierboven af — daarom staat er bruto en geen ander woord.
        {unknownTail ? ` ${unknownTail}` : ""}
      </p>
    );
  }

  const per = spanWords(net.basis);
  // Een jaarbedrag ook per maand tonen, want dat is de eenheid waarin hij zijn
  // eigen afschrift leest. Alleen bij een jaar: "€ 5,00 per maand · € 0,42 per
  // maand" zou een deling zijn die nergens op slaat.
  const alsoMonthly = net.basis.kind === "recurring" && net.basis.period === "jaar";
  return (
    <>
      <div className="position-row" data-testid={`${id}-kosten`}>
        <span>
          <strong>Wat de {noun} zelf kost</strong> — {feeLabel(net.cost.amount)}
          {/* De rekensom alleen als er iets te rekenen valt. "12 × € 0,00" is waar
              en is ruis; een uitgesproken nul is al een compleet antwoord. */}
          {net.cost.amount.perYearDerived && net.cost.amount.cents > 0 && (
            <span className="cell-sub"> (12 × {euro(net.cost.amount.cents)})</span>
          )}
        </span>
        <span className={net.costCents > 0 ? "text-warn" : undefined}>
          {euro(net.costCents)} {per}
        </span>
      </div>
      {net.kind === "net" ? (
        <div className="position-row" data-testid={`${id}-netto`}>
          <span>
            <strong>Netto</strong> — wat er overblijft als die kosten eraf zijn
          </span>
          <span className="text-pos">
            {alsoMonthly ? `${euro(Math.round(net.netCents / 12))} per maand · ` : ""}
            {euro(net.netCents)} {per}
          </span>
        </div>
      ) : (
        /* GEEN AANBEVELING, en zichtbaar waarom niet. Zijn beslissing, en de reden
           dat het bedrag erbij staat: hij moet kunnen zien dat iets afvalt omdat
           het te duur is, in plaats van het zelf te moeten uitrekenen. */
        <p className="reason" data-testid={`${id}-geen`}>
          <strong>Geen aanbeveling.</strong> {euro(net.grossCents)} {per} {gainWord} tegen{" "}
          {euro(net.costCents)} {per} {costWord}:{" "}
          {net.netCents === 0 ? (
            "dat levert niets op."
          ) : (
            <>
              je gaat er <span className="reason-figure text-warn">{euro(-net.netCents)}</span> {per} op achteruit.
            </>
          )}{" "}
          Overstappen kost werk en levert hier niets op, dus LaVega raadt deze {noun} niet aan — de cijfers staan er
          zodat je het kunt nakijken.
        </p>
      )}
    </>
  );
}

/** De bron in één woord. De volledige URL staat onder de tabel, zodat de kolom
 *  leesbaar blijft zonder dat de vindplaats verdwijnt. */
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Editable rente-% cell. Holds a free-form draft while typing (so "1," etc.
 *  don't fight a number input) and commits on blur; blank clears the override
 *  back to auto (detected/assumed). */
function RateCell({ ar, busy, onCommit }: { ar: AccountRate; busy: boolean; onCommit: (key: string, value: string) => void }) {
  const initial = ar.source === "manual" && ar.ratePct !== null ? String(ar.ratePct) : "";
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  return (
    <input
      className="saldo-input"
      inputMode="decimal"
      placeholder={ar.ratePct === null ? "—" : `${ar.ratePct}`}
      aria-label={`Rente ${ar.account.name}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(ar.account.key, draft)}
      disabled={busy}
    />
  );
}

/** What LaVega actually saw in the outflows, so an empty subscriptions list is
 *  a measurement rather than a shrug. Nothing here is stored; it is counted off
 *  the transactions already on screen. */
function outflowFacts(txs: Tx[]) {
  const byMerchant = new Map<string, number>();
  let outflows = 0;
  let first = "";
  let last = "";
  for (const t of txs) {
    if (t.date && (first === "" || t.date < first)) first = t.date;
    if (t.date && t.date > last) last = t.date;
    if (t.amount >= 0) continue;
    outflows++;
    const key = t.counterparty.trim().toLowerCase();
    byMerchant.set(key, (byMerchant.get(key) ?? 0) + 1);
  }
  let repeated = 0;
  for (const n of byMerchant.values()) if (n >= 2) repeated++;
  return { outflows, merchants: byMerchant.size, repeated, first, last };
}

export default function Optimalisatie({ txs, accounts, rules, own, asOf, busy, facts, entries = CATALOGUE_ENTRIES, initialRates, onRateCommit }: OptimalisatieProps) {
  const subs = useMemo(() => detectSubscriptions(txs), [txs]);
  const increases = useMemo(() => subscriptionPriceIncreases(subs), [subs]);
  const overlaps = useMemo(() => subscriptionOverlaps(subs), [subs]);

  /* De eenheid waarin de abonnementen worden getoond. "Per maand" is de stand
     waarin dit scherm altijd stond, dus dat blijft de opening — de schakelaar
     voegt keuze toe en verplaatst niemand. Zie de kop bij SUB_PERIODS voor wat
     er wel en niet mag verschuiven als hij wisselt. */
  const [subPeriod, setSubPeriod] = useState<SubPeriod>("maand");

  /* Gesorteerd op het MAANDBEDRAG, in élke stand. Twee redenen om dat vast te
     zetten in plaats van op de getoonde eenheid te sorteren: per maand en per
     jaar geven exact dezelfde volgorde (het jaarbedrag is twaalf keer het
     maandbedrag, voor elke rij), en op "zoals afgeschreven" sorteren zou de
     lijst herschikken zodra hij wisselt — dat leest als ruis waar hij een
     eenheid verwachtte te zien veranderen.
     Kern's eigen volgorde staat op `monthlyCents`, en dat is de dagbenadering
     die hierboven is afgeschaft; op de duurdere-per-jaar-maar-lagere-monthlyCents
     rij zou de lijst dus niet meer aflopend lezen in de cijfers die ernaast
     staan. `key` breekt gelijke bedragen, net als in core, zodat er niets
     verspringt tussen twee renders. */
  const subRows = useMemo(() => {
    const perMaand = (x: Subscription) => {
      const a = subAmountIn(x, "maand");
      // -1 is een sorteerplek en geen bedrag: een onbekend ritme zakt naar
      // onderen in plaats van als nul tussen de echte bedragen te gaan staan.
      return a.kind === "bedrag" ? a.cents : -1;
    };
    return [...subs].sort((a, b) => perMaand(b) - perMaand(a) || a.key.localeCompare(b.key));
  }, [subs]);

  const subTotal = useMemo(() => subsTotalIn(subs, subPeriod), [subs, subPeriod]);
  /* Eén keer opgezocht, want dit label staat op TWEE plekken: in de kolomkop én
     in `data-label`. Op een smal scherm klapt de tabel om in kaarten en is
     `data-label` het énige dat de cel nog benoemt (base.css, `.table-cards
     td::before`) — daar "Bedrag" neerzetten laat de eenheid op mobiel alsnog
     achter de schakelaar verdwijnen, en dat is precies wat hier niet mag. */
  const subPeriodLabel = SUB_PERIODS.find((x) => x.value === subPeriod)?.label ?? "Bedrag";
  /* Hoeveel rijen er in DEZE stand een rekensom onder zich hebben staan. Dat
     getal hoort in het label van de opgevouwen regel: wie hem dichtlaat moet
     nog steeds weten dat er is omgerekend. */
  const omgerekend = useMemo(
    () => subRows.filter((x) => { const a = subAmountIn(x, subPeriod); return a.kind === "bedrag" && a.derived; }).length,
    [subRows, subPeriod],
  );
  /* De eenheid waarin die rekensommen staan, of null in de stand waarin er per
     definitie niets is omgerekend. Expliciet null en geen terugval op "maand":
     een stand als "maand" lezen omdat het toevallig niet uitmaakt is precies het
     soort stille aanname dat hier verderop al een keer € 1,68 heeft gekost. */
  const omgerekendUnit: "maand" | "jaar" | null = subPeriod === "eigen" ? null : subPeriod;
  const seen = useMemo(() => outflowFacts(txs), [txs]);

  // Why a subscription can be MISSING. His Simeo is the case: a charge that
  // repeats every three months cannot be recognised in two months of statements,
  // no matter how the detector is tuned. Core measures which cadences the data
  // can carry at all (`subscriptionCoverage`) — this view only says it out loud,
  // so an empty list is a stated limit rather than a shrug.
  const coverage = useMemo(() => subscriptionCoverage(txs), [txs]);

  // WOONLASTEN REMOVED 20 Aug (app review 2). The derivation was right — core's
  // `resolveHousingCost` read the rent off his own transactions — and it still
  // belongs somewhere; it does not belong on the screen about subscriptions and
  // interest, where it was a fifth tile he never acted on. `resolveHousingCost`
  // stays in core, unused here on purpose.

  // Fetch the public rate benchmark (live -> cache -> bundled). Starts from the
  // bundled snapshot so the tab renders instantly, then upgrades to live/cache.
  const provider = useMemo(() => createRatesProvider({ url: RATES_URL, catalogueRates: CATALOGUE_RATES }), []);
  const [rates, setRates] = useState<RatesResult>({
    rates: [...(initialRates ?? NL_SAVINGS_RATES)],
    asOf: RATES_AS_OF,
    source: "bundled",
  });
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    let alive = true;
    provider.getRates().then((r) => alive && setRates(r));
    return () => {
      alive = false;
    };
  }, [provider]);
  async function refreshRates() {
    setRefreshing(true);
    try {
      setRates(await provider.getRates());
    } finally {
      setRefreshing(false);
    }
  }

  /* DE GEPRIJSDE CATALOGUS, één keer opgebouwd en door alle drie de modules
     gedeeld. `productFeesById` is dezelfde matcher die het reisblok gebruikt: hij
     koppelt de KAARTrij aan de PAKKETrij waar de prijs op staat (n26-metal-betaalpas
     draagt de 0% opslag, n26-metal de € 16,90 per maand). Op gelijk id matchen —
     wat dit scherm deed — miste precies die veertien paren, en dan zei het scherm
     "kosten onbekend" over een bedrag dat één rij verderop in de catalogus staat.
     Eén matcher en geen tweede kopie: twee kopieën lopen op een dag uit elkaar. */
  const fees = useMemo(() => productFeesById(entries), [entries]);

  // `fees` gaat mee naar core: de rente-aanbeveling wijst naar een REKENING, en
  // die kan zelf geld kosten. Zonder deze kaart komt `interest.net` terug als
  // "kosten onbekend" — zichtbaar, en niet als een stille nul.
  const interest = useMemo(
    () => analyzeInterest(accounts, txs, rates.rates, asOf, undefined, fees),
    [accounts, txs, rates, asOf, fees],
  );
  // The rate the winner still pays once its action ends: what every euro figure on
  // this screen is measured against. Never null while `best` exists — bestRate only
  // ranks rows whose kept rate is known.
  const keptBest = interest.best === null ? null : keptRate(interest.best);

  // The rest of the promo sentence. Written out here rather than inline because
  // the source's own note usually already says what happens afterwards ("Actierente
  // 6 mnd, daarna 2,10%") — repeating it produced "daarna 2,10%. Daarna houd je
  // 2,1%.", which reads like a machine talking to itself. And when the source never
  // says, the sentence has to say THAT, not fall silent.
  const promoTail = (() => {
    if (!interest.bestPromo) return "";
    const note = interest.bestPromo.promoNote?.trim() ?? "";
    const stop = note.endsWith(".") ? "" : ".";
    const kept = keptRate(interest.bestPromo);
    if (kept === null) {
      return `${note ? ` — ${note}${stop}` : "."} Wat je daarna houdt staat niet in de bron, dus daar rekent LaVega niet mee.`;
    }
    if (/daarna/i.test(note)) return ` — ${note}${stop}`;
    return `${note ? ` — ${note}${stop}` : "."} Daarna houd je ${keptLabel(interest.bestPromo)}.`;
  })();
  // Why a suggestion might be empty: accounts missing a saldo (CSV imports) or a
  // known rente — surfaced in the guidance so the €0 isn't a dead end.
  const noSaldo = interest.accountRates.filter((a) => a.account.balance === null).length;
  const unknownRate = interest.accountRates.filter((a) => a.ratePct === null).length;

  // Two rates on two bases, from the accounts he already holds. Core owns the
  // whole derivation; this view only prints it.
  const returns = useMemo(
    () => accountReturns(accounts, txs, rules, own, facts, rates.rates, asOf),
    [accounts, txs, rules, own, facts, rates, asOf],
  );
  const { actions, gaps } = useMemo(() => optimiseReturns(returns), [returns]);
  const routing = actions.filter((a) => a.kind === "route-spending");
  /* Core vraagt naar ELKE ontbrekende cashbackPct — het weet niets van de
     aanname, en dat hoort ook zo: `optimiseReturns` rangschikt en stelt vragen,
     het beslist niet wat een afwezigheid betekent. De filter staat hieronder bij
     `openCashbackGaps`, zodra bekend is over welke producten nog een echte vraag
     openstaat. Zonder die filter zou het scherm om een opzoeking vragen voor een
     kaart waarvan het net zelf heeft opgeschreven dat het antwoord nul is. */
  const cashbackGaps = gaps.filter((g) => g.missing === "cashbackPct");
  // Why the module can be empty, in the order the reasons actually apply. "Je
  // betaalt al met de beste kaart" is only true when there IS a card and there
  // IS measured spending; printed over an empty vault it is advice that cannot
  // be true in the state it appears in.
  const spendable = returns.filter((r) => isSpendable(r.account));

  /* ── DE AANNAME, ÉÉN KEER GELEZEN ──────────────────────────────────────────
     Een voorkeur, dus localStorage en geen kluisgegeven; met lege deps zodat één
     render niet halverwege van antwoord verandert. De schakelaar staat in Profiel
     en dit scherm wordt bij tabwissel opnieuw opgebouwd, dus een omzetting is
     meteen te zien. */
  const assumptionOn = useMemo(() => getCashbackAssumptionEnabled(), []);

  /* WAT WE VAN ELKE EIGEN KAART WETEN, met de hardheid erbij (review 4, punt 22).
     Dit vervangt de oude `r.cashbackPct !== null`-filter, en dat is precies de
     wijziging: een gewone ING-betaalpas kwam daar niet doorheen, terwijl het
     antwoord op de vraag "hoeveel cashback?" bij die kaart gewoon nul is. Wat er
     NIET verandert: de nul draagt overal zijn label mee — zie `HeldCashback`. */
  const heldCashback = useMemo(
    () =>
      spendable.map((r) => {
        const product = productOf(r.account);
        const fact = factEntry(facts, TRAVEL_AGENT, product, "cashbackPct");
        // Een gesteld cijfer wint altijd van een aanname, of het nu van hem komt
        // of van de reisagent. Dat is dezelfde rangorde als `upsertFacts`, en het
        // is ook de reden dat de feedbackmodule in Profiel werkt: één correctie
        // daar zet deze regel om.
        const kind = accountType(r.account) === "Creditcard" ? "creditcard" : "betaalpas";
        const k = heldCashbackOf({
          issuer: r.account.bank ?? "",
          kind,
          productName: product,
          fact: r.cashbackPct !== null && fact ? { pct: r.cashbackPct, source: fact.source, updatedAt: fact.updatedAt } : null,
          assumptionOn,
          // De peildatum komt van de catalogusrijen van DEZE bank in DIT soort
          // product. Zijn eigen kaart heeft geen rij, dus zonder deze omweg heet
          // elke aanname over zijn eigen kaarten voor altijd "nog nooit
          // nagekeken" en zegt de jaarlijkse herzieningsmelding niets meer.
          lastCheckedAt: lastTermsCheckedForIssuer(entries, r.account.bank ?? "", CATALOGUE_KINDS_FOR[kind]),
        });
        return { account: r.account, product, spend: r.spend, k };
      }),
    [spendable, facts, assumptionOn, entries],
  );

  /* Kaarten waarop een vergelijking mag rusten: gemeten of aangenomen. De
     uitgaven van een kaart waarvan we het percentage niet kennen horen NIET in de
     basis, want dan zou een bedrag worden vermenigvuldigd met een getal dat er
     niet is. */
  /* De meting achter de lege staat. Alleen ontvangers met meer dan één
     afschrijving, want een eenmalige aankoop zegt niets over een ritme — en
     afgekapt op vijftien, want een tabel van 85 regels is geen diagnose maar een
     tweede probleem. Ze staan op totaalbedrag gesorteerd, dus wat eraf valt is
     het kleingeld. */
  /* ALLE terugkerende ontvangers, niet de eerste vijftien. De afkapping was een
     tweede fout bovenop de sortering: hij las boven de tabel dat er 98 ontvangers
     twee keer betaald waren en in het label dat er 15 waren — twee getallen over
     dezelfde vraag. En wie een specifiek abonnement zoekt heeft niets aan een
     top-N: die staat er dan juist niet bij. De tabel zit achter een plooi en
     scrollt, dus lengte kost hier niets. */
  const alleTallies = useMemo(
    () => merchantTallies(txs).filter((t) => t.charges > 1),
    [txs],
  );
  const tallies = useMemo(() => alleTallies.filter((t) => t.excluded !== "woonlast"), [alleTallies]);
  /* WOONLASTEN BLIJVEN VAN DIT SCHERM AF, en dat is niet mijn keuze maar de
     zijne: het Woonlasten-blok is op zijn verzoek uit Optimalisatie verdwenen
     (review 2), en er staat een test op dat de huur hier niet meer opduikt. Die
     test ving mijn eerste versie, waarin de tabel zijn woningstichting weer
     terugbracht — en waarin de reden bovendien naar dat verwijderde blok wees,
     een plek die niet meer bestaat.

     Ze worden geteld en niet verzwegen: een diagnose die stil rijen weglaat is
     precies het soort halve waarheid dat dit scherm moet bestrijden. */
  const woonlastenWeggelaten = useMemo(
    () => alleTallies.filter((t) => t.excluded === "woonlast").length,
    [alleTallies],
  );

  const rankable = heldCashback.filter((h) => cashbackPctOf(h.k) !== null);
  /* WHAT HE COULD OPEN, not only what he holds. Valuta ranks every bank and the
     travel agent already offers alternatives; this module was the last one asking
     "which of YOUR accounts is best", which is a fair question and not the one
     that finds the four percent he described — Trading 212 at 1,5% cashback and
     3,5% savings against an ING at 0% and 1,5%. */
  const cashbackOffers = useMemo(() => marketCashbackOptions(entries), [entries]);
  /* DE BESTE EIGEN KAART, MET ZIJN HARDHEID ERAAN VAST. Niet los een getal, want
     dan is de nul op het scherm niet meer van een gemeten nul te onderscheiden en
     is de hele voorzorg weg.

     GELIJKSPEL GAAT NAAR HET GEMETEN CIJFER. Twee kaarten op 0% waarvan er één
     een bron heeft en één een aanname: dan hoort de bron op het scherm. Het
     bedrag is hetzelfde; het verhaal erachter niet. */
  const bestHeld = useMemo(() => {
    let best: (typeof heldCashback)[number] | null = null;
    let bestPct = -1;
    for (const h of heldCashback) {
      const p = cashbackPctOf(h.k);
      if (p === null) continue;
      const harder = p === bestPct && h.k.tier === "gemeten" && best?.k.tier !== "gemeten";
      if (best === null || p > bestPct || harder) {
        best = h;
        bestPct = p;
      }
    }
    return best;
  }, [heldCashback]);
  const bestHeldCashback = bestHeld === null ? null : cashbackPctOf(bestHeld.k);
  /* De vragen die ECHT nog openstaan: alleen de producten waarover we niets
     mogen invullen. Een aangenomen nul is geen open vraag meer, en er blijven om
     een opzoeking vragen zou advies zijn dat niets kan veranderen. */
  const openCashbackGaps = useMemo(() => {
    const open = new Set(heldCashback.filter((h) => cashbackPctOf(h.k) === null).map((h) => h.product));
    return cashbackGaps.filter((g) => open.has(g.product));
  }, [heldCashback, cashbackGaps]);
  const yearlySpendCents = useMemo(
    () => rankable.reduce((sum, h) => sum + (h.spend?.perYearCents ?? 0), 0),
    [rankable],
  );
  const measured = rankable.filter((h) => h.spend.perYearCents !== null);

  /* THE SPEND BASE — the one decision in this module, and he left it open:
     "use average expenditure per month, or average expenditures of last month".
     IT IS THE MONTHLY AVERAGE, for three reasons and one of them is decisive.
       1. Core already guards it: `annualSpendCents` refuses a window under
          MIN_SPEND_DAYS, refuses an account silent for more than 90 days, and
          flags a window under half a year as extrapolated. A single month
          carries none of those guards.
       2. A card is a year-long decision. One month is one sample, and the month
          with a holiday in it would recommend a card the other eleven don't.
       3. Decisive: the last month in an import is almost always PARTIAL, because
          the export was made mid-month. A half month priced as a full one
          understates the gain and looks precise doing it.
     Last month is still shown — he asked for it and it is the number he can
     check against his own memory — but as the last month the import covers in
     FULL, next to the average, never as the base of the claim. */
  const monthlyBaseCents = measured.length > 0 && yearlySpendCents > 0 ? Math.round(yearlySpendCents / 12) : null;
  const baseObservedDays = measured.length > 0 ? Math.max(...measured.map((r) => r.spend.observedDays)) : 0;
  const baseIsUpperBound = measured.some((r) => r.spend.kind === "upper-bound");
  const lastFull = useMemo(
    () => lastFullMonthSpend(measured.map((r) => r.account.key), txs, rules, own, asOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [measured.map((r) => r.account.key).join("|"), txs, rules, own, asOf],
  );

  const bestOffer = cashbackOffers[0];
  const bestOfferKind = useMemo(() => {
    if (!bestOffer) return "";
    return entries.find((e) => e.id === bestOffer.productId)?.kind ?? "";
  }, [bestOffer, entries]);
  /* Every proven cashback figure belongs to a prepaid or crypto card, which is a
     fact about the CATALOGUE and has to be said out loud — otherwise the module
     reads as "here is the best bank card", which is not what it found. */
  const allOffersAlt = useMemo(
    () =>
      cashbackOffers.length > 0 &&
      cashbackOffers.every((o) => ALT_KIND_LABEL[entries.find((e) => e.id === o.productId)?.kind ?? ""] !== undefined),
    [cashbackOffers, entries],
  );
  /* NEVER A EURO FIGURE WITH A HALF MISSING. `cashbackSwitchGain` already
     refuses when his own rate is unknown; the base is the other half, and it is
     checked here so the message below can name WHICH half is missing. */
  const cashbackUpgrade = useMemo(
    () => (monthlyBaseCents === null ? null : cashbackSwitchGain(bestHeldCashback, bestOffer, yearlySpendCents)),
    [bestHeldCashback, bestOffer, yearlySpendCents, monthlyBaseCents],
  );
  /** The field minus the card the comparison already named. */
  const otherOffers = cashbackUpgrade ? cashbackOffers.slice(1, 5) : cashbackOffers.slice(0, 5);
  // How the base was measured, so the figure can be checked against the same
  // afschrift it was read from rather than taken on trust.
  const spendOf = useMemo(() => new Map(returns.map((r) => [r.account.key, r.spend])), [returns]);

  /* ZIT ER IETS ACHTER DE PLOOI? Een <ToonMeer> die op een leeg paneel uitkomt is
     erger dan geen plooi: het label belooft iets ("waar deze cijfers vandaan
     komen") en dan is er niets. Vandaar deze vraag vooraf in plaats van vier
     losse `&&`-takken die samen ook leeg kunnen uitpakken.
     De vergelijking telt alleen mee als hij ook echt te tonen is — dezelfde drie
     voorwaarden als de antwoordregel, want de plooi bevat zíjn onderbouwing. */
  const cashbackOnderbouwing =
    routing.length > 0 ||
    heldCashback.length > 0 ||
    otherOffers.length > 0 ||
    (cashbackUpgrade !== null && monthlyBaseCents !== null && bestHeldCashback !== null);

  /* De vaste kosten van de rekeningen zelf. `hasCostsToShow` beslist of het blok
     er komt: zonder een enkel tarief én zonder een enkel pakket om te tonen is
     dit een leeg blok, en die worden hier niet gerenderd. */
  const costs = useMemo(() => accountCosts(accounts, entries), [accounts, entries]);
  const costRows = costs.rows;
  const costTips = costRows.filter((r) => r.cheaperAtProvider || r.cheaperElsewhere);
  const costSources = costRows.filter((r) => r.cost.kind === "known");

  /* ── WAT DE AANGERADEN CASHBACKKAART ZELF KOST ────────────────────────────
   *
   * De cashbackmodule rekende alleen aan de OPBRENGST: 2% tegen 1,5% op wat hij
   * uitgeeft, en dan een bedrag per jaar. De helft die je niet ziet is degene die
   * je pakt — een kaart die € 5 per maand kost en € 3 oplevert is achteruit, en
   * dat stond hier nergens. `netBenefit` doet de aftrek.
   *
   * HIER IS GEEN HORIZON NODIG, en dat is geen slordigheid maar het verschil met
   * het reisblok. Cashback is TERUGKEREND (elke maand opnieuw) en de kaartprijs
   * ook, dus opbrengst en kosten staan al in dezelfde eenheid en gaan schoon van
   * elkaar af. Bij een reis is het voordeel eenmalig en de prijs terugkerend, en
   * dan moet er een periode bij — vandaar dat travel.ts wél een horizon meegeeft.
   * `netBenefit` rekent de eenheid naar de GROFSTE van de twee (hier het jaar) en
   * nooit naar de fijnste: van een jaarprijs een maandprijs maken is een bedrag
   * verzinnen dat in geen enkel document staat.
   *
   * DE MATCH LOOPT VIA `productFeesById` EN NIET OP GELIJK ID. Hij matchte hier
   * eerst alleen op een rij met dezelfde id, en dat was de veilige kant maar niet
   * de goede: staat de prijs van een kaart op de rij van het PAKKET waarin ze zit
   * (N26 Metal, alle bunq- en Revolut-plannen), dan vonden we hem niet en bleef
   * het "onbekend" — terwijl het bedrag één rij verderop in dezelfde catalogus
   * staat en het reisblok het wél las. Twee schermen die hetzelfde beweren over
   * dezelfde catalogus en het niet eens zijn. De matcher is daarom uit travel.ts
   * naar accountCosts.ts verhuisd en wordt hier gebruikt in plaats van nagebouwd. */
  const cashbackNet = useMemo(() => {
    if (cashbackUpgrade === null) return null;
    // De prijs van de kaart die de vergelijking hierboven NOEMT, en niet die van
    // de eerste rij van de ranglijst: dat zijn vandaag dezelfde kaart, maar als
    // dat ooit uit elkaar loopt hoort de prijs bij de kaart in de zin te staan en
    // niet bij een andere.
    const fee = fees.get(cashbackUpgrade.best.productId) ?? null;
    return netBenefit({
      benefit: { kind: "recurring", cents: cashbackUpgrade.extraPerYearCents, period: "jaar" },
      cost: holdingCostOfProduct(fee),
    });
  }, [cashbackUpgrade, fees]);

  /* ── ÉÉN ECHTE MAAND, ZIJN DRIE VRAGEN (review 4, punt 23) ─────────────────
   *
   * "Cashback vergelijken met vorige maand. Voorbeeld juli: wat gaf je uit, wat
   * had je met cashback bespaard, en wat kost die kaart." Drie vragen, en het
   * blok geeft ze in die volgorde.
   *
   * WAAROM DIT NAAST HET GEMIDDELDE STAAT EN HET NIET VERVANGT: één maand is één
   * steekproef, en de laatste maand van een export is bijna altijd een halve
   * maand (zie `monthlyBaseCents`). Daarom is dit de laatste maand die de import
   * VOLLEDIG dekt, en blijft het gemiddelde de basis van de aanbeveling. Dit is
   * de controle: een getal dat hij tegen zijn eigen herinnering kan houden.
   *
   * DE OPBRENGST IS HIER EENMALIG EN DE KAARTPRIJS NIET, en dat is het verschil
   * met het blok hierboven. Vandaar `one-off` met een horizon van één maand:
   * `netBenefit` rekent dan een HELE factureringsperiode, want je kunt geen
   * twaalfde jaarkaart kopen — wie een kaart opent voor één maand betaalt die
   * maand volledig, en bij een jaarkaart het hele jaar. Dat staat er zichtbaar
   * bij via `spanWords`, zodat het bedrag na te rekenen is.
   *
   * GEEN TWEEDE REKENWIJZE: dezelfde `productFeesById`, dezelfde
   * `holdingCostOfProduct`, dezelfde `netBenefit` en dezelfde `Productkosten` als
   * het jaarblok hierboven. Twee rekenwijzen over hetzelfde gat zeggen op een dag
   * iets anders. */
  const lastMonthCompare = useMemo(() => {
    if (lastFull === null || cashbackUpgrade === null || bestHeldCashback === null) return null;
    const ownCents = Math.round((lastFull.cents * bestHeldCashback) / 100);
    const bestCents = Math.round((lastFull.cents * cashbackUpgrade.best.cashbackPct) / 100);
    return {
      ym: lastFull.ym,
      spentCents: lastFull.cents,
      ownCents,
      bestCents,
      net: netBenefit({
        benefit: { kind: "one-off", cents: bestCents - ownCents },
        cost: holdingCostOfProduct(fees.get(cashbackUpgrade.best.productId) ?? null),
        horizonMonths: 1,
      }),
    };
  }, [lastFull, cashbackUpgrade, bestHeldCashback, fees]);

  return (
    <>
      <div className="view-head">
        <h2>Wat je geld laat liggen</h2>
        <span className="eyebrow">abonnementen &amp; rente</span>
      </div>

      <div className="kpi-row">
        <div className="kpi highlight">
          <div className="kpi-label">Abonnementen</div>
          <div className="kpi-value">{subs.length}</div>
          {/* Volgt de schakelaar, want "/mnd" laten staan naast een tabel in
              jaarbedragen is een scherm dat het met zichzelf oneens is. De
              eenheid staat er voluit bij en niet als afkorting: dit is de tegel
              die hij als eerste leest. */}
          <div className="eyebrow">
            {euro(subTotal.cents)} {perUnit(subTotal.unit)}
            {subTotal.onbekend > 0 && ` · ${subTotal.onbekend} zonder ritme niet meegeteld`}
          </div>
        </div>
        {/* Only when there is something to report. A tile reading 0 is a module
            telling you it has nothing to say, and it costs a column to say it —
            "don't render an empty one". The CHECK is still reported, in one
            clause in the Abonnementen footer, so an absent tile cannot read as
            an absent check. */}
        {increases.length > 0 && (
          <div className="kpi">
            <div className="kpi-label">Prijsstijgingen</div>
            <div className="kpi-value text-warn">{increases.length}</div>
            <div className="eyebrow">herkend</div>
          </div>
        )}
        {overlaps.length > 0 && (
          <div className="kpi">
            <div className="kpi-label">Dubbele functies</div>
            <div className="kpi-value text-warn">{overlaps.length}</div>
            <div className="eyebrow">overlap</div>
          </div>
        )}
        <div className="kpi">
          <div className="kpi-label">Rente laten liggen</div>
          <div className={`kpi-value ${interest.totalExtraPerYearCents > 0 ? "text-warn" : "text-pos"}`}>
            {euro(interest.totalExtraPerYearCents)}
          </div>
          {/* Dit getal is RENTE en alleen rente. Zodra er een overstap achter zit
              kan de nieuwe rekening zelf geld kosten, en dan is dit een brutobedrag
              — dat hoort in de tegel te staan en niet alleen in de module eronder.
              Zonder overstap is er niets om vóór te zijn. */}
          <div className="eyebrow">{interest.net === null ? "per jaar" : "per jaar, vóór rekeningkosten"}</div>
        </div>
      </div>

      <ModuleGrid className="grid-2" label="Optimalisatie">
        {/* ── Abonnementen: de grote helft ──────────────────────────────── */}
        <Module
          title="Abonnementen"
          height="tall"
          period={
            subs.length > 0 ? (
              <ModulePeriod
                value={subPeriod}
                options={SUB_PERIODS}
                onChange={(v) => setSubPeriod(v as SubPeriod)}
                label="Eenheid van de abonnementsbedragen"
              />
            ) : undefined
          }
          footer={
            subs.length > 0 ? (
              <span>
                {subs.length} {subs.length === 1 ? "abonnement" : "abonnementen"} · samen {euro(subTotal.cents)}{" "}
                {perUnit(subTotal.unit)}
                {/* Eén eenheid en niet meer twee. Hier stond "samen X per maand,
                    Y per jaar", waarbij Y werd berekend als X × 12 — en X was
                    bij een jaarabonnement zelf al een deling, dus Y miste het
                    bedrag dat werkelijk is afgeschreven. Nu noemt de voet de
                    eenheid die hij heeft gekozen, gerekend vanaf de
                    afschrijvingen. */}
                {subTotal.onbekend > 0 &&
                  ` · ${subTotal.onbekend} ${subTotal.onbekend === 1 ? "abonnement zit" : "abonnementen zitten"} hier niet in: ritme niet om te rekenen`}
                {"."}
                {increases.length === 0 && overlaps.length === 0 && " Geen prijsstijging en geen dubbele dienst gezien."}
              </span>
            ) : (
              <span>Herkend uit je eigen transacties — er wordt niets bijverzonnen.</span>
            )
          }
        >
          {/* What the history can and cannot show, before anything is counted.
              A quarterly charge needs one full gap before there is a pattern at
              all, so with a short import "niets gevonden" and "kon niets vinden"
              are different answers — and only core knows which one this is. */}
          <p className="reason">
            {coverage.historyDays === 0 ? (
              "Nog geen uitgaande transacties, dus nog geen ritme om te herkennen."
            ) : (
              <>
                LaVega kijkt over <strong>{coverage.historyDays}</strong> dagen afschrift (
                {coverage.firstDate} – {coverage.lastDate}). Daarin is{" "}
                <strong>{coverage.visibleCadences.map(cadenceName).join(", ") || "geen enkel ritme"}</strong>{" "}
                herkenbaar.
                {coverage.hiddenCadences.length > 0 && (
                  <>
                    {" "}Nog niet:{" "}
                    {coverage.hiddenCadences
                      .map((h) => `${cadenceName(h.cadenceDays)} (vanaf ${h.needsDays} dagen)`)
                      .join(", ")}
                    . Een abonnement met zo'n ritme staat hier dus niet omdat de geschiedenis nog niet ver
                    genoeg terugloopt — niet omdat het er niet is.
                  </>
                )}
              </>
            )}
          </p>

          {subs.length === 0 ? (
            <div className="empty-guide">
              <p>
                <strong>Nog geen abonnement herkend.</strong> Dat is een meting, geen leeg scherm:
                {seen.outflows === 0 ? (
                  " er staan nog geen uitgaande transacties in LaVega."
                ) : (
                  <>
                    {" "}LaVega zag <strong>{seen.outflows}</strong> uitgaande transacties
                    {seen.first && seen.last ? ` tussen ${seen.first} en ${seen.last}` : ""}, verdeeld over{" "}
                    <strong>{seen.merchants}</strong> ontvangers. Daarvan betaalde je er{" "}
                    <strong>{seen.repeated}</strong> minstens twee keer — en geen daarvan voldeed aan het patroon.
                  </>
                )}
              </p>
              <p className="cell-sub">Wat LaVega een abonnement noemt:</p>
              <ul>
                {/* DRIE EN NIET TWEE, en dat is een correctie. Hier stond "minstens
                    twee betalingen" terwijl de maandband minstens DRIE afschrijvingen
                    eist (CADENCE_BANDS in subscriptions.ts: minOcc 3 voor 30 dagen,
                    2 voor kwartaal, halfjaar en jaar). Wie twee maandbedragen zag
                    staan en dit las, zocht de fout op de verkeerde plek. */}
                <li>
                  minstens drie betalingen als het maandelijks is, twee als het per kwartaal,
                  halfjaar of jaar gaat;
                </li>
                <li>een vast ritme: ongeveer maandelijks, per kwartaal of jaarlijks;</li>
                <li>een bedrag dat mag stijgen (dat is juist het signaal) maar niet wild springt;</li>
                <li>geen eigen overboeking of kaartafrekening.</li>
              </ul>

              {/* WAT DE DETECTOR ZELF ZAG, per ontvanger. De regels hierboven zijn een
                  samenvatting; dit is de meting. Aanleiding: hij las "85 ontvangers
                  minstens twee keer betaald, nul abonnementen" en kon niets met dat
                  getal — en het was ook op een ANDERE grondslag geteld dan de
                  detector gebruikt (ruwe tegenpartijtekst tegenover merchantKey na
                  uitsluitingen). Deze tabel deelt de grondslag met de detector, dus
                  wat hier staat is wat hij zag. */}
              {tallies.length > 0 && (
                <ToonMeer summary={`Wat LaVega per ontvanger zag (${tallies.length} ontvangers, meest abonnement-achtige eerst)`}>
                  <div className="table-wrap table-cards">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Ontvanger</th>
                          <th className="num">Keer</th>
                          <th className="num">Totaal</th>
                          <th className="num">Ritme</th>
                          <th className="num">Spreiding</th>
                          <th>Meegenomen?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tallies.map((t) => (
                          <tr key={`${t.merchant}-${t.label}`}>
                            <td>{t.label || "(geen naam)"}</td>
                            <td className="num">{t.charges}</td>
                            <td className="num">{formatEuro(t.totalCents / 100)}</td>
                            <td className="num">
                              {t.medianGapDays === null ? "—" : `${t.medianGapDays} dg`}
                            </td>
                            <td className="num">{t.amountCv === null ? "—" : t.amountCv.toFixed(2)}</td>
                            <td>
                              {t.excluded === null
                                ? "ja"
                                : t.excluded === "overboeking-of-persoon"
                                  ? "nee — gelezen als overboeking of persoon"
                                  : "nee — geen naam op de regel"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="cell-sub">
                    Een ritme rond 30, 61, 91, 182 of 365 dagen is bruikbaar; een spreiding boven 0,35
                    betekent dat het bedrag te wild springt. Staat je abonnement hier met een goed ritme
                    en een lage spreiding en tóch niet in de lijst hierboven, dan is dat een fout van ons
                    — stuur die regel door.
                    {woonlastenWeggelaten > 0 && (
                      <>
                        {" "}
                        {woonlastenWeggelaten === 1
                          ? "Eén terugkerende ontvanger staat hier niet bij"
                          : `${woonlastenWeggelaten} terugkerende ontvangers staan hier niet bij`}
                        : die zijn als vaste woonlast gelezen (huur, hypotheek, VvE), en die horen niet op dit
                        scherm.
                      </>
                    )}
                  </p>
                </ToonMeer>
              )}
              <p className="cell-sub">
                Meestal ontbreekt de rekening waar ze vanaf gaan: importeer je creditcard of privérekening,
                dan verschijnen ze hier — inclusief prijsstijgingen en dubbele diensten.
              </p>
              <details className="demo-preview">
                <summary>Bekijk hoe dit eruitziet met gevulde data</summary>
                <p className="badge demo-flag">Voorbeeld — niet jouw data, en nergens opgeslagen</p>
                <div className="table-wrap table-cards">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Dienst</th>
                        <th>Functie</th>
                        <th className="num">Per maand</th>
                        <th className="num">Verandering</th>
                      </tr>
                    </thead>
                    <tbody>
                      {EXAMPLE_SUBS.map((s) => (
                        <tr key={s.name}>
                          <td data-label="Dienst" style={{ fontWeight: 600 }}>{s.name}</td>
                          <td data-label="Functie"><span className="badge">{s.fn}</span></td>
                          <td className="num" data-label="Per maand">{euro(s.monthly)}</td>
                          <td className={`num ${s.change > 0 ? "text-neg" : s.change < 0 ? "text-pos" : ""}`} data-label="Verandering">
                            {s.change === 0 ? "—" : `${s.change > 0 ? "+" : ""}${Math.round(s.change * 100)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          ) : (
            <>
              {increases.length > 0 || overlaps.length > 0 ? (
                <div className="reason-list" style={{ marginBottom: "var(--sp-4)" }}>
                  {/* HET VERSCHIL WORDT NIET MEER × 12 GEREKEND. `fromCents` en
                      `toCents` zijn de afgeschreven bedragen in het ritme van dát
                      abonnement, dus × 12 maakte van een verhoging van € 10,00 op
                      een JAARabonnement "€ 120,00 per jaar extra" — twaalf keer te
                      veel, op precies de regel die hem moet laten opzeggen. Nu
                      gaat het verschil door dezelfde omrekening als de tabel, en
                      staat de eenheid erbij.
                      Deze zinnen volgen de eenheid van het TOTAAL en niet de stand
                      "zoals afgeschreven": ze tellen op en vergelijken, en daar
                      heb je een gedeelde noemer voor nodig. */}
                  {increases.map((p) => {
                    const extra = amountInPeriod(p.toCents - p.fromCents, p.sub.cadenceDays, subTotal.unit);
                    return (
                      <p key={`inc-${p.sub.key}`} className="reason">
                        <strong>{p.sub.name}</strong> ging van {euro(p.fromCents)} naar {euro(p.toCents)} (+
                        {Math.round(p.changePct * 100)}%){" "}
                        {extra.kind === "bedrag" ? (
                          <>
                            — dat is <span className="reason-figure text-warn">{euro(extra.cents)}</span>{" "}
                            {perUnit(subTotal.unit)} extra
                            {extra.sum && <> ({extra.sum})</>}.
                          </>
                        ) : (
                          <>
                            — per {cadenceName(p.sub.cadenceDays)} afgeschreven, dus wat dat {perUnit(subTotal.unit)}{" "}
                            scheelt valt hier niet uit te rekenen.
                          </>
                        )}
                      </p>
                    );
                  })}
                  {overlaps.map((o) => {
                    const samen = subsTotalIn(o.subs, subTotal.unit);
                    const grootste = o.subs.reduce((best, x) => {
                      const a = subAmountIn(x, subTotal.unit);
                      const b = subAmountIn(best, subTotal.unit);
                      const av = a.kind === "bedrag" ? a.cents : -1;
                      const bv = b.kind === "bedrag" ? b.cents : -1;
                      return av > bv ? x : best;
                    }, o.subs[0]);
                    const opzegbaar = subAmountIn(grootste, subTotal.unit);
                    return (
                      <p key={`ov-${o.function}`} className="reason">
                        {o.subs.length} × <strong>{o.function}</strong>: {o.subs.map((s) => s.name).join(" + ")} — samen{" "}
                        {euro(samen.cents)} {perUnit(samen.unit)}.
                        {opzegbaar.kind === "bedrag" && (
                          <>
                            {" "}Eén opzeggen scheelt tot{" "}
                            <span className="reason-figure text-warn">{euro(opzegbaar.cents)}</span>{" "}
                            {perUnit(subTotal.unit)}.
                          </>
                        )}
                      </p>
                    );
                  })}
                </div>
              ) : null}
              {/* TWEE KOLOMMEN WAAR ER DRIE STONDEN, en de tweede is de reden
                  dat deze schakelaar mag bestaan.
                    - de eerste is het bedrag in de eenheid die HIJ koos, met de
                      rekensom eronder zodra het onze deling of vermenigvuldiging
                      is (dezelfde vorm als `perYearDerived` in de kostentabel
                      verderop);
                    - de tweede is "Op je afschrift", en die staat er in ELKE
                      stand: het bedrag zoals het is afgeschreven, met het ritme
                      erbij. De eenheid van de afschrijving mag niet achter een
                      schakelaar verdwijnen, want dat is precies wat "Per maand"
                      als vaste kolomkop deed met zijn jaarabonnementen.
                  De oude kolommen "Per maand" en "Per jaar" stonden er samen, en
                  de tweede was de eerste × 12 — een jaarbedrag dat in geen enkel
                  afschrift staat. */}
              <div className="table-wrap table-cards">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Dienst</th>
                      <th>Functie</th>
                      <th className="num">{subPeriodLabel}</th>
                      <th className="num">Op je afschrift</th>
                      <th className="num">Verandering</th>
                      <th>Laatst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subRows.map((s) => {
                      const bedrag = subAmountIn(s, subPeriod);
                      return (
                        <tr key={s.key}>
                          <td data-label="Dienst" style={{ fontWeight: 600 }}>{s.name}</td>
                          <td data-label="Functie">
                            <span className="badge">{s.function}</span>
                          </td>
                          <td className="num" data-label={subPeriodLabel}>
                            {bedrag.kind === "bedrag" ? (
                              <>
                                {euro(bedrag.cents)}
                                {bedrag.sum && <div className="cell-sub">{bedrag.sum}</div>}
                              </>
                            ) : (
                              /* Geen streepje: een em dash naast euro's leest als
                                 nul. Zelfde keuze als bij een onbekende
                                 rekeningprijs in de kostentabel. */
                              <span className="cell-sub">niet om te rekenen</span>
                            )}
                          </td>
                          <td className="num" data-label="Op je afschrift">
                            {euro(s.lastAmountCents)}
                            <div className="cell-sub">{cadenceName(s.cadenceDays)}</div>
                          </td>
                          <td data-label="Verandering" className={`num ${s.changePct > 0 ? "text-neg" : s.changePct < 0 ? "text-pos" : ""}`}>
                            {s.changePct === 0 ? "—" : `${s.changePct > 0 ? "+" : ""}${Math.round(s.changePct * 100)}%`}
                          </td>
                          <td className="cell-sub" data-label="Laatst">{s.lastDate}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* WAT ER IS OMGEREKEND, geteld in het label en per rij uitgeschreven
                  in het paneel. De telling hoort vooraan en niet erin: wie de regel
                  dichtlaat moet nog steeds weten dát er onder deze bedragen een
                  deling zit. Staat er niets omgerekend — de stand "zoals
                  afgeschreven", of alleen maandabonnementen op "per maand" — dan
                  staat er ook geen regel die iets belooft wat het paneel niet
                  levert. */}
              {omgerekend > 0 && omgerekendUnit !== null && (
                <ToonMeer
                  summary={`${omgerekend} van de ${subRows.length} bedragen ${
                    omgerekend === 1 ? "is" : "zijn"
                  } omgerekend uit een ander ritme`}
                >
                  <p className="cell-sub">
                    Een abonnement houdt de eenheid van zijn eigen afschrijving; wat je hierboven ziet is die
                    afschrijving {perUnit(omgerekendUnit)} gerekend. Naar jaar wordt
                    alleen vermenigvuldigd, dus dat bedrag is exact. Naar maand wordt gedeeld, en dan bestaat het
                    bedrag in de kolom op geen enkel afschrift.
                  </p>
                  <ul>
                    {subRows.map((s) => {
                      const bedrag = subAmountIn(s, subPeriod);
                      if (bedrag.kind !== "bedrag" || !bedrag.derived) return null;
                      return (
                        <li key={`om-${s.key}`} className="cell-sub">
                          <strong>{s.name}</strong>: {euro(s.lastAmountCents)} {cadenceName(s.cadenceDays)} →{" "}
                          {bedrag.sum} = {euro(bedrag.cents)} {perUnit(omgerekendUnit)}
                        </li>
                      );
                    })}
                  </ul>
                </ToonMeer>
              )}
            </>
          )}
        </Module>

        {/* ── Rente: de kleinere helft, maar met de redenering uitgeschreven ── */}
        <Module
          title="Rente"
          height="tall"
          footer={
            interest.best ? (
              <span>
                Beste rente die je houdt: {interest.best.bank} {keptLabel(interest.best)}
                {interest.bestPromo ? (
                  <>
                    {" "}· hoogste actietarief nu: {interest.bestPromo.bank} {pct(interest.bestPromo.ratePct)}
                  </>
                ) : null}{" "}
                · {RATES_SOURCE_LABEL[rates.source]}, peildatum {rates.asOf}.
              </span>
            ) : (
              <span>Geen vergelijkingsrente beschikbaar.</span>
            )
          }
        >
          {interest.suggestions.length > 0 && interest.best ? (
            <>
              {/* BRUTO, en dat staat er nu bij. Zonder dat woord las deze regel als
                  wat je erop overhoudt, terwijl de rekening waar je heen gaat zelf
                  ook geld kan kosten: € 50 rente meer op een pakket van € 4,50 per
                  maand is € 4,00 achteruit. De aftrek staat onderaan dit blok. */}
              <p className="reason-lead">
                Verplaatsen levert je <strong>{euro(interest.totalExtraPerYearCents)}</strong> per jaar op
                {interest.net === null ? "" : ", vóór wat die rekening zelf kost"}.
              </p>
              <div className="reason-list">
                {interest.suggestions.map((s) => (
                  <p key={`sug-${s.account.key}`} className="reason">
                    Je houdt <strong>{euro(s.balanceCents)}</strong> aan bij {accountLabel(s.account)} tegen{" "}
                    {pct(s.ratePct)}; {interest.best!.bank} betaalt {keptLabel(interest.best!)}, ook als een actie
                    afloopt — dat verschil van {pct(Math.round((keptBest! - s.ratePct) * 100) / 100)} is{" "}
                    <span className="reason-figure text-warn">{euro(s.extraPerYearCents)}</span> per jaar.
                  </p>
                ))}
                {/* WAT DIE REKENING ZELF KOST. Op het TOTAAL en niet per suggestie:
                    het advies is één rekening openen en daar alles heen brengen,
                    dus die pakketprijs betaal je één keer. Per rij aftrekken zou hem
                    bij drie rekeningen drie keer in rekening brengen. Core rekent
                    het uit (`analyzeInterest`); hier wordt het alleen geprint, in
                    dezelfde component en met dezelfde woorden als bij Cashback en in
                    het reisblok. Is er niets te verrekenen, dan komt hier ook geen
                    leeg blok — `interest.net` is dan null. */}
                {interest.net !== null && (
                  <Productkosten
                    net={interest.net}
                    id="rente"
                    noun="rekening"
                    gainWord="meer rente"
                    costWord="rekeningkosten"
                  />
                )}
              </div>
            </>
          ) : (
            <div className="empty-guide">
              <p>
                <strong>Nog geen rentewinst berekend.</strong> Per rekening heeft LaVega een <em>saldo</em> én een{" "}
                <em>rente %</em> nodig; een van beide onbekend betekent geen bedrag, geen aanname.
              </p>
              <ul>
                {noSaldo > 0 && <li>{noSaldo} rekening{noSaldo > 1 ? "en" : ""} zonder saldo — vul dat in bij Rekeningen.</li>}
                {unknownRate > 0 && <li>{unknownRate} rekening{unknownRate > 1 ? "en" : ""} zonder rente — zet de Rente % hieronder.</li>}
                {/* "Al op de beste plek" was a CONCLUSION drawn from an absence
                    of suggestions, and an absence has two causes: nothing to gain,
                    or nothing computed. He hit the second and was told the first.
                    So say which, with the numbers, and never claim a comparison
                    that was not made. */}
                {noSaldo === 0 && unknownRate === 0 &&
                  (interest.best && keptBest !== null ? (
                    <li>
                      Beste rente die LaVega kan aantonen: {pct(keptBest)} bij {interest.best.bank}. Elke
                      rekening hier haalt dat al, of het verschil is kleiner dan{" "}
                      {pct(MARGIN_PCT)} per jaar.
                    </li>
                  ) : (
                    <li>
                      LaVega kent nog geen spaarrente om tegen te vergelijken — zonder die andere kant
                      is er geen bedrag, alleen een percentage.
                    </li>
                  ))}
              </ul>
            </div>
          )}

          {/* WHAT YOU COULD GET NOW, next to what you keep — never instead of it.
              Ranking on the actierente sends a saver somewhere worse in month
              seven; hiding it, which is what yesterday's fix did, drops real money
              on the floor: "if they can use the promo for a month it's still a
              month of 3,01% over the 2,5%". So both, each with its own period
              attached, and the euro figure below is per MONTH because that is the
              only unit an action is honestly priced in. */}
          {interest.bestPromo && (
            <p className="reason" style={{ marginTop: "var(--sp-3)" }}>
              <span className="badge">🎁 nu te krijgen</span>{" "}
              <strong>{interest.bestPromo.bank}</strong> geeft vandaag{" "}
              <strong>{pct(interest.bestPromo.ratePct)}</strong>
              {promoTail}
              {interest.promoExtraPerMonthCents > 0 && interest.best && (
                <>
                  {" "}Zolang de actie loopt is dat{" "}
                  <span className="reason-figure text-pos">{euro(interest.promoExtraPerMonthCents)}</span> per maand
                  extra bovenop {interest.best.bank}.
                </>
              )}
            </p>
          )}

          <div className="table-wrap table-cards" style={{ marginTop: "var(--sp-4)" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Rekening</th>
                  <th className="num">Saldo</th>
                  <th className="num">Rente %</th>
                  <th>Bron</th>
                  <th className="num">
                    Mogelijk/jr{keptBest !== null ? ` vs ${pct(keptBest)} die je houdt` : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {interest.accountRates.map((ar) => {
                  // Against what he KEEPS at the winner, the same figure
                  // analyzeInterest priced the year on. This column used to use the
                  // headline, so the table and the sentence above it could disagree
                  // by a teaser's worth of euros.
                  const gain =
                    keptBest !== null && ar.ratePct !== null && ar.balanceCents > 0 && keptBest - ar.ratePct > 0.1
                      ? Math.round((ar.balanceCents * (keptBest - ar.ratePct)) / 100)
                      : 0;
                  // The row of the catalogue/benchmark table that answers for THIS
                  // account's own bank — the same call resolveAccountRate makes, so
                  // the screen names the tariff the number actually came from.
                  const bankRow = matchBankBenchmark(ar.account.bank, rates.rates, ar.account.name);
                  const bankKept = bankRow === null ? null : keptRate(bankRow);
                  return (
                    <tr key={ar.account.key}>
                      <td data-label="Rekening">
                        <div style={{ fontWeight: 600 }}>{ar.account.bank || ar.account.name}</div>
                        <div className="cell-sub">{ar.account.name}</div>
                      </td>
                      <td className="num" data-label="Saldo">{ar.account.balance === null ? "onbekend" : euro(ar.balanceCents)}</td>
                      <td className="num" data-label="Rente %">
                        <RateCell ar={ar} busy={busy} onCommit={onRateCommit} />
                      </td>
                      <td className="cell-sub" data-label="Bron">
                        {SOURCE_LABEL[ar.source]}
                        {/* Name the tariff, its bank and its date. "Geschat via
                            banktarief" asks to be believed; this can be checked. */}
                        {ar.source === "benchmark" && bankRow && bankKept !== null && (
                          <div className="cell-sub">
                            {bankRow.bank} {bankRow.product} · {pct(bankKept)} · peildatum {bankRow.asOf ?? rates.asOf}
                          </div>
                        )}
                        {/* HIS "that ING is 0% that's bullshit". A CSV import names
                            the account after its IBAN, so nothing in it reads as
                            savings and the type heuristic calls it a
                            betaalrekening — 0% before any rate is looked up. It may
                            be right; only he knows which of two ING IBANs is the
                            Oranje Spaarrekening. So the row states what the bank
                            does pay, and asks once, instead of printing a
                            measurement it never made. */}
                        {ar.source === "assumed" &&
                          accountType(ar.account) === "Betaalrekening" &&
                          bankRow &&
                          bankKept !== null &&
                          bankKept > 0.1 && (
                            <div className="cell-sub">
                              {bankRow.bank} betaalt {pct(bankKept)} op {bankRow.product} (peildatum{" "}
                              {bankRow.asOf ?? rates.asOf}). <strong>Is dit die rekening?</strong> Zet dan het
                              percentage hiernaast — wat jij invult gaat boven elke schatting.
                            </div>
                          )}
                      </td>
                      <td className="num" data-label="Mogelijk/jr">{gain > 0 ? <span className="text-warn">+{euro(gain)}</span> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <details className="rates-benchmark">
            <summary className="eyebrow">
              Vergelijkingsrentes ({rates.rates.length} banken) · {RATES_SOURCE_LABEL[rates.source]} · peildatum {rates.asOf}
            </summary>
            <div className="table-wrap table-cards">
              <table className="table">
                <thead>
                  <tr>
                    <th>Bank</th>
                    <th className="num">Rente nu</th>
                    <th className="num">Wat je houdt</th>
                    <th>Actie</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.rates.map((r) => (
                    <tr key={`${r.bank}-${r.product}`}>
                      <td data-label="Bank">
                        <div style={{ fontWeight: 600 }}>
                          {r.bank}
                          {/* THE ASTERISK. Wise Rente and N26's flexible cash fund
                              are money-market funds, not deposits: they can lose
                              capital, the rate is net of a management fee, and the
                              money takes up to two days to arrive. They are shown
                              because they are real options, and marked because a
                              saver comparing them to a guaranteed account is not
                              comparing like with like. They are also kept out of
                              the ranking entirely — see bestRate. */}
                          {r.capitalAtRisk ? <span title="Geen spaarrekening: dit is een geldmarktfonds. Je kunt geld verliezen, het rendement is na kosten en opnemen duurt tot twee werkdagen. Niet gedekt door het depositogarantiestelsel." style={{ color: "var(--warn, #b26a00)" }}> *</span> : null}
                        </div>
                        <div className="cell-sub">{r.product}</div>
                      </td>
                      <td className="num text-pos" data-label="Rente nu">{pct(r.ratePct)}</td>
                      {/* A teaser whose standing rate the source never states is
                          "onbekend" here, and it is left out of the ranking
                          entirely — Trade Republic's own catalogue conditions read
                          "NOT THE STANDING RATE — do not serve 3% bare". An em
                          dash would have read as "nothing changes afterwards". */}
                      <td className="num cell-sub" data-label="Wat je houdt">
                        {keptRate(r) === null ? "onbekend" : keptRate(r) === r.ratePct ? "—" : keptLabel(r)}
                      </td>
                      <td data-label="Actie">{r.promoNote ? <span className="badge">🎁 {r.promoNote}</span> : <span className="cell-sub">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rates.rates.some((r) => r.capitalAtRisk) ? (
                <p className="cell-sub" style={{ marginTop: ".5rem" }}>
                  * Geen spaarrekening maar een geldmarktfonds — je kunt geld verliezen, het rendement
                  is na kosten en opnemen duurt tot twee werkdagen. Niet gedekt door het
                  depositogarantiestelsel, en daarom nooit onze aanbeveling.
                </p>
              ) : null}
            </div>
            <p className="eyebrow">
              "Rente nu" is inclusief actietarieven (vaak alleen voor nieuwe klanten); "wat je houdt" is het tarief
              ná de actie — daarop wordt vergeleken. Staat daar "onbekend", dan zegt de bron niet wat er na de actie
              overblijft en doet die rekening niet mee in de vergelijking; het actietarief zie je wel. Bron: {RATES_SOURCE_LABEL[rates.source]} via geld.nl (peildatum {rates.asOf}).{" "}
              <button type="button" className="card-link" onClick={() => void refreshRates()} disabled={refreshing}>
                {refreshing ? "verversen…" : "ververs rentes"}
              </button>
              . Alleen publieke rentes worden opgehaald — je eigen saldi/rentes blijven lokaal.{" "}
              {rates.source !== "live" && "Voor live tarieven: start de rente-service (pnpm dev:server)."}
            </p>
          </details>
        </Module>

        {/* ── Cashback: het antwoord vooraan, de onderbouwing in één plooi ─── *
            De drie beats uit review 2 staan er nog — wat je eigen kaart zou
            teruggeven, wat de beste kaart die we kunnen AANTONEN teruggeeft, en
            het verschil. Ze staan alleen niet meer als eerste. Zijn opdracht van
            22 augustus is "meer top down", en dat is deze ronde bij Statistieken
            en het reisblok precies zo gedaan: vooraan het ANTWOORD, alle
            onderbouwing achter het gedeelde <ToonMeer>. Zie
            components/ToonMeer.tsx voor de gebruiksaanwijzing, en TravelBlock.tsx
            voor de taal — twee schermen die hetzelfde zeggen in andere woorden
            zijn samen erger dan één druk scherm.

            WAT VOORAAN BLIJFT, en waarom juist dit:
             · DE OVERSTAP TUSSEN ZIJN EIGEN KAARTEN. Een wissel die hij vandaag
               kan maken is een antwoord; de meting eronder ("gerekend over …
               dagen afschrift") is onderbouwing en vouwt op.
             · DE NETTOREGEL. Wat de beste kaart oplevert MET de kaartprijs erin
               verrekend is de zin waar deze module om bestaat, dus
               `Productkosten` staat vooraan — in al zijn drie takken.
             · DE WEIGERING, en dat is de val waar deze ronde expliciet voor
               gewaarschuwd is. "Wat deze kaart zelf kost, weten we niet" is geen
               uitleg maar de UITKOMST, en het is vandaag de echte toestand: van
               geen enkele kaart met een aantoonbare cashback noemt een bron een
               maand- of jaarprijs. Vouw je die zin weg, dan lijkt de module leeg
               terwijl er iets te zeggen valt — en dan lijkt hij stuk.
             · DE VOORWAARDEN bij dat tarief, want een 5%-kaart achter een
               stakingdrempel is voor hem geen 5%-kaart. De TEKST mag opgevouwen
               (het is een lang citaat), maar het LABEL van die plooi zegt zelf al
               dát er voorwaarden zijn. Het is met opzet een tweede, kleine plooi
               naast de grote: dit begrenst het antwoord en hoort dus bij het
               antwoord te staan, niet bij de bewijslast eronder.
             · DE OPENSTAANDE VRAAG ("cashback onbekend voor …"). Ook een
               weigering; die verhuist naar boven in plaats van onderaan de module
               te blijven hangen.
            Al het andere gaat de plooi in: de bron en de peildatum van elk cijfer,
            de uitleg over de catalogus, de opsomming van alle kandidaten en de zin
            over wat er niet is meegerekend. */}
        <Module
          span={2}
          title="Cashback"
          footer={<span>Percentages gelden op wat je uitgeeft, niet op je saldo.</span>}
        >
          {/* First, the cards he ALREADY holds — a switch he can make today
              beats one that needs an application.

              EN DAAROM STAAN HIER GEEN KAARTKOSTEN. Beide kaarten zijn van hem,
              dus beide maandprijzen lopen door of hij overstapt of niet: voor
              DEZE keuze zijn ze nul. Dat is dezelfde regel die core's
              `marginalHoldingCost` in het reisblok toepast, en hier is er niets
              te tonen in plaats van een nul om uit te leggen. Wat die rekeningen
              wél kosten staat in de module "Kosten".

              ALLEEN DE REGEL ZELF, sinds de top-downronde: waar die euro's over
              gerekend zijn staat in de plooi onderaan, bij de rest van de meting. */}
          {routing.length > 0 && (
            <div className="reason-list">
              {routing.map((a) => (
                <div className="position-row" key={a.from.key + a.to.key}>
                  <span>
                    Betaal met <strong>{a.to.bank}</strong> in plaats van {a.from.bank} — {pct(a.toPct)} tegen{" "}
                    {pct(a.fromPct)}.
                  </span>
                  <span className="text-pos">
                    {a.approximate ? "tot " : ""}
                    {euro(a.gainPerYearCents)} per jaar
                  </span>
                </div>
              ))}
            </div>
          )}

          {cashbackUpgrade && cashbackNet && monthlyBaseCents !== null && bestHeldCashback !== null ? (
            <div className="reason-list" style={{ marginTop: routing.length > 0 ? "var(--sp-4)" : undefined }}>
              {/* HET ANTWOORD, IN ÉÉN REGEL. Welke kaart, tegen welke van hem, en
                  hoeveel dat bruto scheelt — daarna doet `Productkosten` er de
                  kaartprijs vanaf. In die volgorde, want de aftrek is niet te
                  volgen zonder het bedrag waarvan wordt afgetrokken.

                  DE TWEE MERKTEKENS GAAN MEE NAAR VOREN en blijven niet bij hun
                  rij in de plooi achter, en dat is geen opmaak maar de voorzorg
                  waar dit project al een keer op struikelde:
                   · "aangenomen" — de nul aan ZIJN kant kan een gemeten nul zijn
                     of een aanname van ons. Zonder dat woord draagt deze zin een
                     conclusie op een afwezigheid.
                   · "prepaidkaart"/"cryptokaart" — de kaart die wint is vandaag
                     nooit een gewone bankkaart. Zonder dat woord leest de regel
                     als "dit is de beste bankkaart", en dat is niet wat er
                     gevonden is. Het is dezelfde splitsing als in het reisblok:
                     een HERKEND kenmerk staat vooraan, de vrije brontekst
                     eromheen vouwt op. */}
              <p className="reason-lead" data-testid="cashback-antwoord">
                <strong>{cashbackUpgrade.best.product}</strong>
                {cashbackUpgrade.best.bank ? ` bij ${cashbackUpgrade.best.bank}` : ""} geeft{" "}
                {pct(cashbackUpgrade.best.cashbackPct)} terug op wat je uitgeeft, tegen{" "}
                {pct(bestHeldCashback)} op je beste eigen kaart
                {bestHeld?.k.tier === "aangenomen" && <> <span className="badge">aangenomen</span></>}
                {ALT_KIND_LABEL[bestOfferKind] ? <> <span className="badge">{ALT_KIND_LABEL[bestOfferKind]}</span></> : null}{" "}
                — <strong>{euro(cashbackUpgrade.extraPerYearCents)}</strong> per jaar meer, vóór kaartkosten.
              </p>

              {/* WAT DE KAART ZELF KOST, in de drie toestanden die er echt zijn.
                  Dezelfde component en dezelfde zinnen als de Rente-module
                  hierboven en als het reisblok — één gat, één verhaal. */}
              <Productkosten
                net={cashbackNet}
                id="cashback"
                noun="kaart"
                gainWord="meer cashback"
                costWord="kaartkosten"
                unknownTail="Bij de kaarten die de catalogus wél prijst, staat dat bedrag onder “Kosten”."
              />

              {/* THE GATE, IF THERE IS ONE, IN FULL. A 5% card behind a staking
                  tier is not a 5% card for him, so the euro figure above cannot
                  stand without its conditions. It was truncated at first, and
                  that was worse than not showing it: the Obsidian text names its
                  tier gate near the END, so the clamp cut off the only part that
                  mattered. Volledige tekst, opgevouwen — en het label zegt zelf
                  dát er voorwaarden zijn, zodat dicht niet hetzelfde is als weg. */}
              {cashbackUpgrade.best.conditions && (
                <ToonMeer summary="Aan dit tarief hangen voorwaarden — lees ze voordat je hierop rekent">
                  <p style={{ margin: 0 }}>{cashbackUpgrade.best.conditions}</p>
                  <p className="cell-sub" style={{ margin: ".35rem 0 0" }}>
                    Bron: {cashbackUpgrade.best.sourceUrl} · peildatum {cashbackUpgrade.best.asOf}
                  </p>
                </ToonMeer>
              )}
            </div>
          ) : (
            /* WHY THERE IS NO FIGURE, in the order the reasons actually apply.
               Each names the half that is missing; none of them concludes that
               he is already in the best place, because an absence of a
               comparison is not a comparison. Dit is een weigering en dus de
               uitkomst zelf — hij staat vooraan en vouwt nooit op. */
            <p className="block-empty" style={{ marginTop: routing.length > 0 ? "var(--sp-4)" : undefined }}>
              {spendable.length === 0
                ? "Nog geen betaalrekening of creditcard in beeld — er is dus nog niets om mee te vergelijken."
                : bestHeldCashback === null
                  ? /* WAAROM DE AANNAME HIER NIET GELDT, en niet alleen dat er iets
                       ontbreekt. Deze tak haalt het sinds review 4 alleen nog bij
                       kaarten die buiten de aanname vallen — een prepaidkaart, een
                       Amex, een neobank — of als hij de aanname zelf heeft
                       uitgezet. De lijst in de plooi noemt per kaart welke van die
                       redenen het is. */
                    "Wat dit jou zou opleveren weet LaVega nog niet: bij deze kaarten mag er geen nul worden aangenomen, en zonder die helft is er geen verschil te berekenen. Onder “Waar deze cijfers vandaan komen” staat het per kaart."
                  : monthlyBaseCents === null
                    ? `LaVega kent de cashback van je kaarten, maar heeft nog te weinig afschrift om te zien wat je ermee uitgeeft (minimaal ${MIN_SPEND_DAYS} dagen). Zonder die basis is er een percentage, maar geen bedrag.`
                    : cashbackOffers.length === 0
                      ? "Geen enkele kaart in de catalogus heeft een aantoonbaar cashbackpercentage — er is dus niets om je eigen kaart tegen af te zetten."
                      : "Je beste kaart nu doet het even goed of beter — er is niets te winnen."}
            </p>
          )}

          {/* DE OPENSTAANDE VRAAG STAAT VOORAAN, en stond eerst onderaan de
              module. Het is geen uitleg maar een weigering: over deze kaarten
              mag niets worden ingevuld, dus het bedrag hierboven gaat niet over
              hen. Wie dat opvouwt laat een afwezigheid een conclusie dragen. */}
          {openCashbackGaps.length > 0 && (
            <p className="cell-sub" data-testid="cashback-open" style={{ marginTop: "var(--sp-3)" }}>
              {/* Name a way to close the gap that EXISTS. Sinds review 4 zijn er
                  TWEE die bestaan, en de tweede is nieuw: het percentage is nu
                  ook zelf in te vullen, bij Profiel → Cashback corrigeren. Dat
                  veld bestond niet toen deze zin geschreven werd — daarom vroeg
                  hij alleen om de reisagent, die een bestemming nodig heeft
                  voordat hij iets opzoekt. Wat jij invult is een LearnedFact met
                  bron "user", en die verslaat elke agent.

                  De opsomming gaat over `openCashbackGaps` en niet over alle
                  gaten: over een kaart waarvan LaVega net zelf heeft opgeschreven
                  dat het antwoord nul is, staat hier geen vraag meer. */}
              Cashback onbekend voor {openCashbackGaps.map((g) => g.product).join(", ")}, en aannemen mag hier
              niet. Twee manieren om dat te sluiten: kies een bestemming in het reisblok op Overzicht en klik{" "}
              <strong>Zoek voorwaarden</strong>, of vul het percentage zelf in bij{" "}
              <strong>Profiel → Cashback corrigeren</strong>.
            </p>
          )}

          {/* ── DE ONDERBOUWING, IN ÉÉN PLOOI ───────────────────────────────
              Eén plooi voor de hele module en niet één per onderdeel: vier
              driehoekjes onder elkaar is geen rustiger scherm maar hetzelfde
              scherm met vier knoppen erbij. Het label is een BELOFTE en geen
              "meer informatie" — een label dat niets belooft is een label waar
              niemand op klikt, en dan is de onderbouwing niet opgevouwen maar
              zoek (zie ToonMeer.tsx).

              De plooi komt er alleen als er iets in zit; een plooi die op een
              leeg paneel uitkomt is erger dan geen plooi. */}
          {cashbackOnderbouwing && (
            <ToonMeer summary="Waar deze cijfers vandaan komen, en wat er niet in zit">
              {cashbackUpgrade && monthlyBaseCents !== null && bestHeldCashback !== null && (
                <div className="reason-list">
                  {/* BOTH ROWS ARE THE SAME EUROS ON A DIFFERENT CARD. Deliberately
                      NOT "wat je nu terugkrijgt": his best own rate is 1,5% but his
                      spending sits on the 0% pas, so the first row is what that card
                      WOULD return on this base — a rate comparison, not a statement
                      about what lands on his account. Labelling it as income he
                      already gets would be a number he can check and find wrong.

                      DAT DE PERCENTAGES HIERBOVEN OOK AL STAAN is geen slordigheid:
                      wat de plooi toevoegt is het BEDRAG per kant, en een paneel dat
                      alleen te lezen is met de zin erboven ernaast is geen
                      onderbouwing maar een restant. */}
                  <div className="position-row" data-testid="cashback-nu">
                    <span>
                      <strong>Op je beste eigen kaart</strong> — {pct(bestHeldCashback)}
                      {/* DE HARDHEID STAAT OP DEZELFDE REGEL ALS HET GETAL, niet in
                          een voetnoot en niet in een comment. Dit is de hele
                          voorzorg: een aangenomen nul die er precies zo uitziet als
                          een gemeten nul is de valse nul waar dit project al een keer
                          op stukliep. Hij staat daarom óók op de antwoordregel
                          vooraan — dit cijfer mag nergens kaal voorkomen. */}
                      {bestHeld?.k.tier === "aangenomen" && <> <span className="badge">aangenomen</span></>}
                    </span>
                    <span>{euro(Math.round((monthlyBaseCents * bestHeldCashback) / 100))} per maand</span>
                  </div>
                  {bestHeld?.k.tier === "aangenomen" && (
                    <p className="cell-sub" data-testid="cashback-aanname">
                      <strong>{describeCashback(bestHeld.k)}.</strong> Een gewone Nederlandse betaalpas of
                      grootbankcreditcard geeft geen cashback, dus LaVega vult hier nul in in plaats van je met
                      “onbekend” te laten zitten — maar het blijft een aanname van ons en geen zin uit een document
                      van {bestHeld.account.bank || bestHeld.product}.{" "}
                      {bestHeld.k.lastCheckedAt
                        ? `De voorwaarden van ${bestHeld.k.issuerFamily} zijn voor het laatst gelezen op ${bestHeld.k.lastCheckedAt}.`
                        : `Van ${bestHeld.k.issuerFamily} heeft LaVega geen enkel gelezen document met een datum erbij.`}
                      {assumptionDueForReview(bestHeld.k.lastCheckedAt, asOf) &&
                        " Dat is een jaar of langer geleden, dus deze aanname is toe aan een nieuwe blik."}{" "}
                      Klopt het niet? Zet het juiste percentage bij <strong>Profiel → Cashback corrigeren</strong>; wat
                      jij invult gaat vóór alles wat LaVega zelf vindt.
                    </p>
                  )}
                  <div className="position-row" data-testid="cashback-beste">
                    <span>
                      <strong>Op de beste kaart die we kunnen aantonen</strong> —{" "}
                      {pct(cashbackUpgrade.best.cashbackPct)} bij {cashbackUpgrade.best.bank || cashbackUpgrade.best.product}{" "}
                      <span className="cell-sub">({cashbackUpgrade.best.product}, peildatum {cashbackUpgrade.best.asOf})</span>
                      {ALT_KIND_LABEL[bestOfferKind] ? <> <span className="badge">{ALT_KIND_LABEL[bestOfferKind]}</span></> : null}
                    </span>
                    <span>{euro(Math.round((monthlyBaseCents * cashbackUpgrade.best.cashbackPct) / 100))} per maand</span>
                  </div>
                  {/* HET VERSCHIL IS BRUTO, en dat staat er nu bij. Zonder dat woord
                      las deze regel als wat je erop overhoudt, terwijl de kaart zelf
                      ook geld kost: 2% tegen 1,5% levert € 163,92 per jaar op, en een
                      kaart van € 16,90 per maand kost € 202,80. De aftrek staat
                      vooraan, bij het antwoord; hier staat waar dat brutobedrag
                      vandaan komt. */}
                  <div className="position-row" data-testid="cashback-verschil">
                    <span>
                      <strong>Verschil</strong> — wat dezelfde uitgaven daar extra opleveren, vóór kaartkosten
                    </span>
                    <span className="text-pos">
                      {euro(Math.round(cashbackUpgrade.extraPerYearCents / 12))} per maand ·{" "}
                      {euro(cashbackUpgrade.extraPerYearCents)} per jaar
                    </span>
                  </div>
                  {/* The base, and how it was measured, so the figure can be redone
                      against the same afschrift instead of taken on trust. */}
                  <p className="cell-sub" data-testid="cashback-basis">
                    Gerekend over {baseIsUpperBound ? "maximaal " : ""}
                    {euro(monthlyBaseCents)} aan kaartuitgaven <strong>gemiddeld per maand</strong>, gemeten over{" "}
                    {baseObservedDays} dagen afschrift.
                  </p>
                  <p className="cell-sub">
                    Beide regels hierboven zijn dezelfde uitgaven op een andere kaart — een vergelijking van tarieven,
                    niet wat er vandaag op je rekening komt. Het verschil is daarom minstens dit: wat nu op een kaart
                    met minder cashback staat, levert nog meer op.
                    {baseIsUpperBound &&
                      " Je bank zegt er niet bij of een afschrijving een kaartbetaling of een incasso was, dus huur en incasso's zitten nog in die basis — vandaar \"maximaal\"."}
                  </p>
                </div>
              )}

              {/* Waar de euro's van de overstap tussen zijn EIGEN kaarten over
                  gerekend zijn. "tot" is geen slag om de arm om de slag om de arm:
                  op een betaalrekening zitten huur en incasso's nog in de basis,
                  dus het bedrag is het meeste dat het kan zijn — en de zin die dat
                  zegt hoort bij de meting, niet bij het antwoord. */}
              {routing.length > 0 && (
                <div style={{ marginTop: "var(--sp-3)" }}>
                  <p style={{ margin: 0 }}>
                    <strong>Waarover die overstap gerekend is</strong>
                  </p>
                  {routing.map((a) => {
                    const base = spendOf.get(a.from.key);
                    return (
                      <p className="cell-sub" key={`basis-${a.from.key}${a.to.key}`}>
                        {a.to.bank} in plaats van {a.from.bank}: gerekend over {a.approximate ? "maximaal " : ""}
                        {euro(a.baseCents)} aan uitgaven per jaar
                        {base ? `, gemeten over ${base.observedDays} dagen afschrift` : ""}.
                        {a.approximate &&
                          " Je bank zegt er niet bij of een afschrijving een kaartbetaling of een incasso was — huur en incasso's zitten er dus nog in."}
                      </p>
                    );
                  })}
                </div>
              )}

              {/* ── ÉÉN ECHTE MAAND, met zijn drie vragen erin (punt 23) ────────
                  Dit stond zelf in een <details> en is nu gewoon een blok in de
                  plooi: een driehoekje ín een driehoekje is twee klikken naar
                  hetzelfde antwoord. */}
              {lastMonthCompare && cashbackUpgrade && bestHeldCashback !== null && (
                <div className="reason-list" data-testid="cashback-vorige-maand" style={{ marginTop: "var(--sp-3)" }}>
                  <p style={{ margin: 0 }}>
                    <strong>Vorige volle maand ({monthLabelNL(lastMonthCompare.ym)})</strong> —{" "}
                    {euro(lastMonthCompare.spentCents)} uitgegeven,{" "}
                    {euro(lastMonthCompare.bestCents - lastMonthCompare.ownCents)} meer cashback op{" "}
                    {cashbackUpgrade.best.bank || cashbackUpgrade.best.product}
                  </p>
                  <div className="position-row">
                    <span>Wat je die maand uitgaf</span>
                    <span>{euro(lastMonthCompare.spentCents)}</span>
                  </div>
                  <div className="position-row">
                    <span>
                      Wat je eigen kaart daarop teruggaf — {pct(bestHeldCashback)}
                      {bestHeld?.k.tier === "aangenomen" && <> <span className="badge">aangenomen</span></>}
                    </span>
                    <span>{euro(lastMonthCompare.ownCents)}</span>
                  </div>
                  <div className="position-row">
                    <span>
                      Wat {cashbackUpgrade.best.product} had teruggegeven — {pct(cashbackUpgrade.best.cashbackPct)}
                    </span>
                    <span>{euro(lastMonthCompare.bestCents)}</span>
                  </div>
                  {/* Dezelfde component, dezelfde zinnen en dezelfde rekenwijze
                      als het jaarblok vooraan. Het verschil zit alleen in de
                      BASIS: hier staat een eenmalige opbrengst tegen een prijs
                      die doorloopt, dus rekent `netBenefit` een hele
                      factureringsperiode en zegt `spanWords` erbij welke. */}
                  <Productkosten
                    net={lastMonthCompare.net}
                    id="cashback-maand"
                    noun="kaart"
                    gainWord="meer cashback in die maand"
                    costWord="kaartkosten"
                  />
                  <p className="cell-sub">
                    Dit is de laatste maand die je import van begin tot eind dekt. Eén maand is één steekproef, dus
                    de aanbeveling vooraan staat op het maandgemiddelde en niet op deze maand — dit getal is de
                    controle die je tegen je eigen herinnering kunt houden.
                  </p>
                </div>
              )}

              {/* DE UITLEG OVER DE CATALOGUS. Dat de winnende kaart geen gewone
                  bankkaart is, staat als merkteken op de antwoordregel vooraan;
                  dit is de zin eromheen — wat de bronnen wél en niet dekken. */}
              {allOffersAlt && (
                <p className="cell-sub">
                  <strong>Geen gewone bankkaart</strong> in de catalogus heeft een aantoonbaar cashbackpercentage —
                  alle {cashbackOffers.length} die we kunnen onderbouwen zijn prepaid- of cryptokaarten. Dat is wat de
                  bronnen zeggen, niet een keuze van LaVega.
                </p>
              )}

              {/* ── WAT WE VAN ELKE EIGEN KAART WETEN, en hoe hard ─────────────
                  Het STAAT er, per kaart, met het woord "aangenomen" voluit — dat
                  is de prijs van een aanname: hij mag, mits hij overal te vinden
                  is. */}
              {heldCashback.length > 0 && (
                <div data-testid="cashback-kaarten" style={{ marginTop: "var(--sp-3)" }}>
                  <p style={{ margin: 0 }}>
                    <strong>
                      Waar het percentage van elk van je {heldCashback.length === 1 ? "kaart" : "kaarten"} vandaan komt
                    </strong>
                  </p>
                  <ul className="cell-sub" style={{ margin: ".35rem 0 0", paddingLeft: "1.1rem" }}>
                    {heldCashback.map((h) => (
                      <li key={h.account.key}>
                        {/* Eén zin, uit core. De vier takken stonden hier ooit als
                            vier stukjes JSX, en Profiel zei bijna dezelfde vier
                            dingen net iets anders — zie `describeHeldCashback`. */}
                        <strong>{h.product}</strong> — {describeHeldCashback(h.k)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* The rest of the field, without repeating the card named above — four
                  Crypto.com tiers under a Crypto.com headline was the module talking
                  to itself. */}
              {otherOffers.length > 0 && (
                <div style={{ marginTop: "var(--sp-3)" }}>
                  <p style={{ margin: 0 }}>
                    <strong>{cashbackUpgrade ? "Andere kaarten" : "Kaarten"} die we kunnen aantonen</strong>{" "}
                    <span className="cell-sub">— niet alleen de jouwe</span>
                  </p>
                  <ul className="cell-sub" style={{ margin: ".35rem 0 0", paddingLeft: "1.1rem" }}>
                    {otherOffers.map((o) => (
                      <li key={o.productId}>
                        <strong>{pct(o.cashbackPct)}</strong> — {o.bank ? `${o.bank} · ` : ""}{o.product}{" "}
                        <span style={{ opacity: 0.7 }}>(peildatum {o.asOf})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </ToonMeer>
          )}
        </Module>

        {/* ── Wat je rekeningen kosten ────────────────────────────────────── *
            De enige module hier die geld ZIET WEGGAAN in plaats van blijven
            liggen. Hij komt er alleen als er iets te zeggen is: geen enkel
            tarief én geen enkel pakket om te tonen is een leeg blok, en die
            worden niet gerenderd. */}
        {hasCostsToShow(costs) && (
          <Module
            span={2}
            title="Kosten"
            footer={
              <span>
                Bedragen uit de kostendocumenten van de aanbieders zelf, met de datum die dat document noemt.
                Alleen betaalrekeningen en creditcards; nergens is tussen maand en jaar omgerekend.
              </span>
            }
          >
            {/* HET ANTWOORD: wat het je per jaar kost om te houden wat je hebt.
                Core levert drie varianten en dit zijn ze alle drie — een som met
                onbekende rekeningen erin is geen totaal, en zonder één bekend
                tarief is er niets om op te tellen. De tweede en de derde zijn
                WEIGERINGEN en dus zelf de uitkomst: ze staan vooraan en vouwen
                nooit op. */}
            {costs.total.kind === "complete" && (
              <p className="reason-lead" data-testid="kosten-totaal">
                Je betaalt <strong>{euro(costs.total.perYearCents)}</strong> per jaar om deze{" "}
                {costs.total.accounts} {costs.total.accounts === 1 ? "rekening" : "rekeningen"} aan te houden.
              </p>
            )}
            {costs.total.kind === "incomplete" && (
              <p className="reason-lead" data-testid="kosten-totaal">
                Van {costs.total.known} van je {costs.total.known + costs.total.unknown} rekeningen staat het
                tarief vast: samen <strong>{euro(costs.total.knownPerYearCents)}</strong> per jaar. De andere{" "}
                {costs.total.unknown} {costs.total.unknown === 1 ? "rekening telt" : "rekeningen tellen"} niet
                als nul mee, dus dit bedrag is een ondergrens.
              </p>
            )}
            {costs.total.kind === "none" && (
              <p className="reason" data-testid="kosten-totaal">
                Van geen van deze rekeningen staat het tarief vast, dus er is geen totaal. Wat de catalogus bij
                deze banken wél weet, staat in de plooi hieronder.
              </p>
            )}

            {/* ── DE UITGESPROKEN NULLEN, VOORAAN EN MET HUN EIS ───────────────
                De keerzijde van "onbekend is nooit nul": zegt het kostendocument
                letterlijk € 0,00, dan is dat een gemeten feit en dus een ANTWOORD.
                Het stond in de bronkolom van de tabel; nu de tabel de plooi in
                gaat, zou het meevouwen — en review 4, punt 24 was juist dat dit
                vindbaar moet zijn zonder te zoeken ("ING is bij hem een
                studentenrekening — hij betaalt niets").

                EN NOOIT ZONDER DE EIS. Elke studentenrekening in dit land staat op
                € 0,00 in het wettelijk verplichte kostendocument, mét een
                leeftijds- of studievoorwaarde ernaast; die twee horen bij elkaar,
                anders klopt de melding over twee jaar niet meer. Bij een bedrag
                dat wél geld kost blijft de voorwaarde in de tabel staan — daar is
                de prijs het nieuws en de voorwaarde de onderbouwing. */}
            {costRows.map((row) => {
              const c = row.cost;
              if (c.kind !== "known" || c.amount.cents !== 0) return null;
              const bank = row.account.bank || row.account.name;
              /* De naam van het PRODUCT als we het herkend hebben ("ING Student"),
                 en anders bank plus rekeningnaam. Niet allebei achter elkaar: dat
                 gaf "ING ING Student", en een dubbele banknaam leest als twee
                 rekeningen. */
              const label = c.matchedBy === "product-name" ? c.fee.product : `${bank} — ${row.account.name}`;
              return (
                <p className="reason" data-testid={`kosten-gratis-${row.account.key}`} key={`gratis-${row.account.key}`}>
                  <strong>{label}</strong> —{" "}
                  {c.conditions ? (
                    <>
                      <strong>Gratis, mits:</strong> {c.conditions}
                    </>
                  ) : (
                    <>
                      <strong>Gratis.</strong> De bron noemt hierbij geen voorwaarde.
                    </>
                  )}
                </p>
              );
            })}

            {/* ── WAT WE NIET WETEN, MET DE ECHTE OORZAAK ──────────────────────
                Een weigering is geen uitleg maar de uitkomst zelf, dus die staat
                vooraan. Drie oorzaken, drie zinnen, en de derde hangt aan wat er
                te tonen is: bij Trading 212 kent de catalogus alleen een
                kaarttarief en niets voor een betaalrekening, en "we weten niet
                welk product dit is" boven een lege lijst is een melding die zijn
                eigen oorzaak niet noemt.

                DE GRATIS KANDIDATEN KOMEN MEE NAAR VOREN, om dezelfde reden als
                hierboven: bij een onherkende ING-rekening is "ING Student kost
                € 0,00" het enige harde dat we hebben, en dat achter een driehoekje
                zetten is precies wat punt 24 verbood. De rest van de pakketlijst
                blijft wel in de plooi — dat is een catalogus, geen antwoord. */}
            {costRows.map((row) => {
              const c = row.cost;
              if (c.kind === "known") return null;
              const bank = row.account.bank || row.account.name;
              const free = row.candidates.filter((f) => f.amount.cents === 0);
              return (
                <div key={`onbekend-${row.account.key}`}>
                  <p className="reason" data-testid={`kosten-onbekend-${row.account.key}`}>
                    <strong>{bank} — {row.account.name}</strong>: kosten onbekend, en dat is geen nul.{" "}
                    {c.reason === "no-bank"
                      ? "Deze rekening draagt geen banknaam, dus er valt niets op te zoeken."
                      : c.reason === "provider-unknown"
                        ? `LaVega kent geen tarief van ${bank}.`
                        : row.candidates.length === 0
                          ? `Bij ${bank} kent LaVega geen tarief voor dit soort rekening.`
                          : `LaVega kent de tarieven van ${bank}, maar niet welk van deze producten dit is.`}
                  </p>
                  {free.length > 0 && (
                    <div className="cell-sub" data-testid={`gratis-bij-${row.account.key}`}>
                      <strong>Gratis bij {bank}:</strong>
                      <ul style={{ margin: ".2rem 0 0", paddingLeft: "1.1rem" }}>
                        {free.map((f) => (
                          <li key={f.productId}>
                            {f.product} — {feeLabel(f.amount)}.{" "}
                            {f.conditions ?? "De bron noemt hierbij geen voorwaarde."}
                          </li>
                        ))}
                      </ul>
                      <p style={{ margin: ".2rem 0 0" }}>
                        Is dit jouw rekening? Zet die naam bij Rekeningen in het veld <strong>Naam</strong>, dan
                        rekent LaVega er met € 0,00 voor.
                      </p>
                      {/* BRON EN PEILDATUM ACHTER DE PLOOI, op zijn verzoek van 22
                          augustus. Ze stonden per regel achter het bedrag, en dat
                          maakte van een lijstje van drie een muur.

                          WAT VOORAAN BLIJFT is het bedrag EN de voorwaarde, en dat
                          is geen halve maatregel: een studentenrekening is gratis
                          áls je student bent, en zonder die eis is "gratis" een
                          advies dat in zijn eigen toestand niet hoeft te werken.
                          De herkomst mag een klik verderop; de eis niet. */}
                      <ToonMeer
                        variant="regel"
                        summary={`Waar ${free.length === 1 ? "deze prijs" : "deze prijzen"} vandaan ${free.length === 1 ? "komt" : "komen"}`}
                      >
                        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                          {free.map((f) => (
                            <li key={`bron-${f.productId}`}>
                              {f.product}: {sourceHost(f.sourceUrl)}, peildatum {f.asOf}
                            </li>
                          ))}
                        </ul>
                      </ToonMeer>
                    </div>
                  )}
                </div>
              );
            })}

            {/* WAAR HET LOONT — en nooit zonder de voorwaarde. Een
                studentenrekening is gratis áls je student bent; LaVega weet niet
                hoe oud je bent, dus het bedrag komt er met de zin uit de bron
                naast te staan en niet als een gedane zaak. Pakketten die de bron
                zelf "niet meer te openen" noemt komen hier per constructie niet
                in voor.

                DIT VOUWT NIET OP: het is een bedrag per jaar dat hij kan pakken,
                dus een antwoord. Alleen de vindplaats van dat bedrag — host en
                peildatum — verhuist naar de bronnenlijst in de plooi, waar de
                rest van de herkomst ook staat. */}
            {costTips.length > 0 && (
              <div className="reason-list" style={{ marginTop: "var(--sp-4)" }}>
                {costTips.map((row) => {
                  const c = row.cost;
                  if (c.kind !== "known") return null;
                  const held = c.matchedBy === "product-name" ? c.fee.product : accountLabel(row.account);
                  const alts = [
                    { label: "Bij dezelfde aanbieder", alt: row.cheaperAtProvider },
                    { label: "Bij een andere aanbieder", alt: row.cheaperElsewhere },
                  ];
                  return alts.map(({ label, alt }) =>
                    alt === null ? null : (
                      <div key={`${row.account.key}-${alt.fee.productId}`}>
                        <p className="reason">
                          <strong>{label}</strong> — je betaalt {feeLabel(c.amount)} voor {held};{" "}
                          {alt.fee.product} kost {feeLabel(alt.fee.amount)}. Dat scheelt{" "}
                          <span className="reason-figure text-pos">{euro(alt.savingPerYearCents)}</span> per
                          jaar.
                        </p>
                        <p className="cell-sub">
                          {alt.conditional
                            ? `Voorwaarde volgens de bron: ${alt.fee.conditions}`
                            : "De bron noemt hierbij geen voorwaarde."}
                        </p>
                      </div>
                    ),
                  );
                })}
              </div>
            )}

            {/* ── DE ONDERBOUWING, IN ÉÉN PLOOI ─────────────────────────────────
                De tabel is per rekening het rekenwerk achter het totaal vooraan:
                welk tarief, in welke eenheid, uit welk document en van welke
                datum. Precies wat volgens de opdracht van 22 augustus achter de
                plooi hoort — samen met de opsomming van alle pakketten die er bij
                een bank te kiezen zijn.

                WAT ER NIET IN ZIT, en dat is met opzet: geen enkele weigering en
                geen enkele uitgesproken nul. Die staan hierboven, want een
                afwezigheid die je wegvouwt lijkt een leeg scherm, en een gratis
                rekening die je wegvouwt heeft hij nooit gezien. */}
            <ToonMeer summary="Per rekening: het tarief, de bron en de peildatum">
              <div className="table-wrap table-cards">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Rekening</th>
                      <th className="num">Kosten</th>
                      <th className="num">Per jaar</th>
                      <th>Bron</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costRows.map((row) => {
                      const c = row.cost;
                      const bank = row.account.bank || row.account.name;
                      return (
                        <tr key={row.account.key}>
                          <td data-label="Rekening">
                            <div style={{ fontWeight: 600 }}>{bank}</div>
                            <div className="cell-sub">{row.account.name}</div>
                          </td>
                          <td className="num" data-label="Kosten">
                            {c.kind === "known" ? feeLabel(c.amount) : "onbekend"}
                          </td>
                          {/* "niet in het totaal" in plaats van een streepje: een em
                              dash naast euro's leest als nul, en dit is het enige
                              veld waar de lezer kan zien wat er met een onbekende
                              gebeurt. */}
                          <td className="num" data-label="Per jaar">
                            {c.kind === "known" ? (
                              <>
                                {euro(c.amount.perYearCents)}
                                {c.amount.perYearDerived && (
                                  <div className="cell-sub">12 × {euro(c.amount.cents)}</div>
                                )}
                              </>
                            ) : (
                              <span className="cell-sub">niet in het totaal</span>
                            )}
                          </td>
                          <td data-label="Bron" className="cell-sub">
                            {c.kind === "known" ? (
                              <>
                                <div>
                                  {c.matchedBy === "product-name"
                                    ? c.fee.product
                                    : `${c.agreeing.length} producten bij deze bank, alle even duur`}
                                </div>
                                <div>
                                  {sourceHost(c.sourceUrl)} · peildatum {c.asOf}
                                </div>
                                {/* Bij een bedrag dat geld KOST is de prijs het
                                    nieuws en de voorwaarde de onderbouwing, dus die
                                    mag hier staan. Bij een nul niet: die staat
                                    vooraan, mét zijn eis — zie het blok bovenaan
                                    deze module. */}
                                {c.conditions && c.amount.cents > 0 && (
                                  <div>
                                    <strong>Voorwaarde:</strong> {c.conditions}
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                {/* De oorzaak staat vooraan, bij de weigering. Hier
                                    staat alleen wat er nog te KIEZEN valt: de
                                    pakketten die deze bank heeft, en de enige stap
                                    die dit echt oplost — de naam van een rekening
                                    bepaalt of LaVega het pakket herkent, en die naam
                                    is bij Rekeningen aan te passen. Is er niets te
                                    kiezen, dan staat er ook geen advies dat in deze
                                    toestand niet kan werken. */}
                                {row.candidates.length > 0 ? (
                                  <>
                                    <div>
                                      {row.candidates.length}{" "}
                                      {row.candidates.length === 1 ? "tarief" : "tarieven"} bij {bank}:
                                    </div>
                                    <ul style={{ margin: ".35rem 0 0", paddingLeft: "1.1rem" }}>
                                      {row.candidates.map((f) => (
                                        <li key={f.productId}>
                                          {f.product} — {feeLabel(f.amount)}{" "}
                                          <span style={{ opacity: 0.7 }}>
                                            ({sourceHost(f.sourceUrl)}, peildatum {f.asOf})
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                    {/* Geen voorbeeldnaam erbij: de lijst staat er al
                                        boven, en het goedkoopste pakket als
                                        voorbeeld noemen is een duwtje richting een
                                        naam die niet klopt. */}
                                    <div style={{ marginTop: ".35rem" }}>
                                      Weet je welk het is? Zet die naam bij Rekeningen in het veld{" "}
                                      <strong>Naam</strong> — dan rekent LaVega met dat tarief.
                                    </div>
                                  </>
                                ) : (
                                  <span>geen bron</span>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* De volledige vindplaats van elk bedrag dat vooraan meetelt, plus
                  die van elke goedkopere optie die hierboven is aangeraden. Eén
                  lijst en niet drie plekken: de herkomst van een cijfer hoort bij
                  de herkomst van de andere cijfers te staan. */}
              {(costSources.length > 0 || costTips.length > 0) && (
                <div style={{ marginTop: "var(--sp-3)" }}>
                  <p style={{ margin: 0 }}>
                    <strong>Waar deze bedragen vandaan komen</strong>
                  </p>
                  <ul className="cell-sub" style={{ margin: ".35rem 0 0", paddingLeft: "1.1rem" }}>
                    {costSources.map((row) => {
                      const c = row.cost;
                      if (c.kind !== "known") return null;
                      return (
                        <li key={row.account.key}>
                          {row.account.bank || row.account.name}: {c.sourceUrl} (peildatum {c.asOf})
                        </li>
                      );
                    })}
                    {costTips.map((row) =>
                      [row.cheaperAtProvider, row.cheaperElsewhere].map((alt) =>
                        alt === null ? null : (
                          <li key={`alt-${row.account.key}-${alt.fee.productId}`}>
                            {alt.fee.product}: {alt.fee.sourceUrl} (peildatum {alt.fee.asOf})
                          </li>
                        ),
                      ),
                    )}
                  </ul>
                </div>
              )}
            </ToonMeer>
          </Module>
        )}
      </ModuleGrid>
    </>
  );
}
