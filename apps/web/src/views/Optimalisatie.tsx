import { Fragment, useEffect, useMemo, useState } from "react";
import type {
  Account,
  Tx,
  AccountRate,
  CatalogueEntryLike,
  FeeAmount,
  LearnedFact,
  NetBasis,
  NetBenefit,
  OwnAccounts,
  RateBenchmark,
  Rule,
  Subscription,
} from "@lavega/core";
import {
  merchantTallies,
  accountCosts,
  accountLabel,
  accountReturns,
  assumptionDueForReview,
  cashbackPctOf,
  CATALOGUE_KINDS_FOR,
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
import { formatEuroIn, monthLabel } from "../format.js";
import { useAppLocale } from "../appLocale.js";
import {
  optimiseCopy,
  formatPercentIn,
  type Segment,
  heldCashbackSentence,
} from "../copy/optimise.js";
import type { Locale } from "../locale.js";
import Module, { ModulePeriod } from "../components/Module";
import ModuleGrid from "../components/ModuleGrid";
import ToonMeer from "../components/ToonMeer";
import Badge from "../components/ui/Badge.js";
import CardLink from "../components/ui/CardLink.js";
import SaldoInput from "../components/ui/SaldoInput.js";
import { Table, TableWrap, Th, Td } from "../components/ui/Table.js";
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
  import.meta.env.VITE_RATES_URL ??
  (import.meta.env.DEV ? "http://localhost:8787/api/rates" : undefined);

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

const euro = (locale: Locale, cents: number) => formatEuroIn(locale, cents / 100);
const pct = (locale: Locale, p: number) => formatPercentIn(locale, p);

const renderSegments = (segments: Segment[]) =>
  segments.map((s, i) => (
    <Fragment key={i}>{typeof s === "string" ? s : <strong>{s.bold}</strong>}</Fragment>
  ));

/** What a rate is worth to someone who stays. A teaser whose standing rate the
 *  source never gave says "onbekend"/"unknown" — not the teaser, and not 0%. */
const keptLabel = (locale: Locale, r: RateBenchmark) => {
  const kept = keptRate(r);
  return kept === null
    ? optimiseCopy[locale].optimalisatie.interest.benchmarkDetails.unknownKept
    : pct(locale, kept);
};

/** The promo badge in the benchmark table.
 *
 *  `promoNote` is a clause QUOTED from the bank's own Dutch terms, so it is
 *  shown only to a Dutch reader — the same rule the headline sentence already
 *  applies a few hundred lines up, and for the same reason. An English reader
 *  gets the fact rebuilt from the structured rate, which is what the quote was
 *  evidence for in the first place. `null` means there is no promo at all. */
export const promoBadgeLabel = (locale: Locale, r: RateBenchmark): string | null => {
  const bd = optimiseCopy[locale].optimalisatie.interest.benchmarkDetails;
  const quoted = r.promoNote?.trim();
  if (locale === "nl") return quoted ? quoted : r.promo ? bd.promoPlain : null;
  if (!quoted && !r.promo) return null;
  return r.standardRatePct === undefined
    ? bd.promoPlain
    : bd.promoThen(pct(locale, r.standardRatePct));
};

/** A worked example of the subscriptions table. Explicitly NOT his data: it is
 *  rendered behind a disclosure, labelled, and never saved anywhere. Seeding
 *  rows into the vault to make the block look full would put numbers he cannot
 *  trust next to numbers he can. */
const EXAMPLE_SUBS = [
  { name: "Netflix", monthly: 1599, last: 1599, change: 0.14 },
  { name: "Spotify", monthly: 1199, last: 1199, change: 0.09 },
  { name: "Adobe Creative Cloud", monthly: 6899, last: 6899, change: 0 },
  { name: "Odido", monthly: 3500, last: 3500, change: -0.05 },
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

// Labels used to live here as Dutch strings; `copy/optimise.ts`'s
// `subscriptions.periods` owns them now, so this is just the order.
export const SUB_PERIODS: SubPeriod[] = ["eigen", "maand", "jaar"];

/** Hoeveel MAANDEN één afschrijving beslaat, per ritme dat de detector kent
 *  (CADENCE_BANDS in core). Kalendermaanden, geen dagen: een maandabonnement
 *  wordt twaalf keer per jaar afgeschreven en niet 365/30 = 12,17 keer. Op die
 *  dagbenadering ging het mis — zie de kop hierboven.
 *
 *  Het spiegelt `FEE_PERIOD_MONTHS` in accountCosts, en om dezelfde reden: "een
 *  jaar is twaalf maanden" hoort op één plek te staan, zodat een zesde ritme er
 *  hier bijkomt en niet in elke aanroeper. */
export const CADENCE_MONTHS: Readonly<Record<number, number>> = {
  30: 1,
  61: 2,
  91: 3,
  182: 6,
  365: 12,
};

/** Het ritme in woorden, met een terugval die het ritme noemt in plaats van het
 *  te verzwijgen. Op moduleniveau zodat de tabel, de zinnen en de tests hem
 *  delen.
 *
 *  De namen komen uit `copy/optimise` en niet uit core: een ritme is een getal
 *  in dagen, hoe het heet is een zin en die hoort aan deze kant van de grens. */
export const cadenceName = (days: number, locale: Locale): string => {
  const c = optimiseCopy[locale].optimalisatie.subscriptions.cadence;
  if (days === 30) return c.maandelijks;
  if (days === 61) return c.tweemaandelijks;
  if (days === 91) return c.perKwartaal;
  if (days === 182) return c.halfjaarlijks;
  if (days === 365) return c.jaarlijks;
  return c.elkeNDagen(days);
};

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
export function amountInPeriod(
  cents: number,
  cadenceDays: number,
  period: SubPeriod,
  locale: Locale = "nl",
): SubAmount {
  if (period === "eigen") return { kind: "bedrag", cents, derived: false, sum: null };
  const months = CADENCE_MONTHS[cadenceDays];
  if (months === undefined) return { kind: "onbekend-ritme", cadenceDays };
  if (period === "jaar") {
    const times = 12 / months;
    return {
      kind: "bedrag",
      cents: cents * times,
      derived: times !== 1,
      sum: times === 1 ? null : `${times} × ${euro(locale, cents)}`,
    };
  }
  return {
    kind: "bedrag",
    cents: Math.round(cents / months),
    derived: months !== 1,
    sum: months === 1 ? null : `${euro(locale, cents)} ÷ ${months}`,
  };
}

/** Wat één abonnement in de gekozen eenheid kost. Altijd vanaf het AFGESCHREVEN
 *  bedrag (`lastAmountCents`) en nooit vanaf `monthlyCents` — dat laatste is
 *  zelf al een omrekening, en rekenen met een omrekening is hoe de jaarkolom
 *  € 1,68 kwijtraakte. */
export function subAmountIn(
  sub: Subscription,
  period: SubPeriod,
  locale: Locale = "nl",
): SubAmount {
  return amountInPeriod(sub.lastAmountCents, sub.cadenceDays, period, locale);
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
function altKindLabel(locale: Locale, kind: string): string | undefined {
  return (optimiseCopy[locale].optimalisatie.common.altKindLabel as Record<string, string>)[kind];
}

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
const feeLabel = (locale: Locale, a: FeeAmount) =>
  `${euro(locale, a.cents)} ${optimiseCopy[locale].optimalisatie.common.perUnit(a.period)}`;

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
function spanWords(basis: NetBasis, locale: Locale): string {
  const sw = optimiseCopy[locale].optimalisatie.productCost.spanWords;
  if (basis.kind === "recurring") return sw.recurring(basis.period);
  const n = basis.periodsCharged;
  return basis.costPeriod === "jaar" ? sw.oneOffYear(n) : sw.oneOffMonth(n);
}

/** "kaart" of "rekening" (het ding), en welke opbrengst tegenover de kosten
 *  staat — een KIND per product/module in plaats van vrije tekst, zodat een
 *  nieuwe aanroeper geen Nederlands woord meer kan doorgeven waar de andere
 *  taal een vertaalde zin verwacht. Dit verving `noun`/`gainWord`/`costWord`
 *  als losse string-props, die letterlijk waren gespleten in een al-vertaalde
 *  template (`productCost.costLine.heading`, `.noRecommendation.body`). */
type ProductNoun = "account" | "card";
type GainKind = "interest" | "cashback" | "cashback-month";

function Productkosten({
  net,
  id,
  product,
  gain,
  unknownTail,
  locale,
}: {
  net: NetBenefit;
  /** Voorvoegsel voor de testids: "cashback" → cashback-kosten / -netto / -geen. */
  id: string;
  product: ProductNoun;
  gain: GainKind;
  /** Eén zin extra bij onbekende kosten, als er iets nuttigs bij te zeggen valt
   *  — bijvoorbeeld waar de prijzen die we WEL kennen te vinden zijn. */
  unknownTail?: string;
  locale: Locale;
}) {
  const oc = optimiseCopy[locale].optimalisatie;
  const pc = oc.productCost;
  const common = oc.common;
  const noun = product === "account" ? common.accountWord(1) : common.cardWord(1);
  const costWord = product === "account" ? common.accountCostWord : common.cardCostWord;
  const gainWord =
    gain === "interest"
      ? common.moreInterestWord
      : gain === "cashback"
        ? common.moreCashbackWord
        : common.moreCashbackThisMonthWord;
  // KOSTEN ONBEKEND. Het woord "netto" komt hier NIET voor, en dat is de hele
  // reden dat deze tak apart staat: er is geen netto zolang de ene helft
  // ontbreekt. Wel wordt gezegd dat het bedrag hierboven bruto is — anders leest
  // een onbekende prijs als nul, en dat is precies de fout.
  if (net.kind === "gross-cost-unknown") {
    return (
      <p className="cell-sub" data-testid={`${id}-kosten`}>
        <strong>{pc.unknownCost.heading(noun)}</strong>{" "}
        {net.cost.reason === "needs-another-product"
          ? pc.unknownCost.reasonNeedsAnotherProduct(noun)
          : pc.unknownCost.reasonNoSource}{" "}
        {pc.unknownCost.footnote}
        {unknownTail ? ` ${unknownTail}` : ""}
      </p>
    );
  }

  const per = spanWords(net.basis, locale);
  // Een jaarbedrag ook per maand tonen, want dat is de eenheid waarin hij zijn
  // eigen afschrift leest. Alleen bij een jaar: "€ 5,00 per maand · € 0,42 per
  // maand" zou een deling zijn die nergens op slaat.
  const alsoMonthly = net.basis.kind === "recurring" && net.basis.period === "jaar";
  return (
    <>
      <div className="position-row" data-testid={`${id}-kosten`}>
        <span>
          <strong>{pc.costLine.heading(noun)}</strong> — {feeLabel(locale, net.cost.amount)}
          {/* De rekensom alleen als er iets te rekenen valt. "12 × € 0,00" is waar
              en is ruis; een uitgesproken nul is al een compleet antwoord. */}
          {net.cost.amount.perYearDerived && net.cost.amount.cents > 0 && (
            <span className="cell-sub">
              {" "}
              {pc.costLine.sumNote(euro(locale, net.cost.amount.cents))}
            </span>
          )}
        </span>
        <span className={net.costCents > 0 ? "text-warn" : undefined}>
          {euro(locale, net.costCents)} {per}
        </span>
      </div>
      {net.kind === "net" ? (
        <div className="position-row" data-testid={`${id}-netto`}>
          <span>
            <strong>{pc.netLine.heading}</strong> — {pc.netLine.subtitle}
          </span>
          <span className="text-pos">
            {alsoMonthly
              ? pc.netLine.alsoMonthlyPrefix(euro(locale, Math.round(net.netCents / 12)))
              : ""}
            {euro(locale, net.netCents)} {per}
          </span>
        </div>
      ) : (
        /* GEEN AANBEVELING, en zichtbaar waarom niet. Zijn beslissing, en de reden
           dat het bedrag erbij staat: hij moet kunnen zien dat iets afvalt omdat
           het te duur is, in plaats van het zelf te moeten uitrekenen. */
        <p
          className="py-[var(--sp-3)] px-[var(--sp-4)] border border-line rounded-sm bg-surface-2 leading-[1.5]"
          data-testid={`${id}-geen`}
        >
          <strong>{pc.noRecommendation.heading}</strong>{" "}
          {pc.noRecommendation.body(
            euro(locale, net.grossCents),
            per,
            gainWord,
            euro(locale, net.costCents),
            costWord,
          )}{" "}
          {net.netCents === 0
            ? pc.noRecommendation.noGain
            : pc.noRecommendation.loss(per, euro(locale, -net.netCents))}{" "}
          {pc.noRecommendation.footer(noun)}
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
function RateCell({
  ar,
  busy,
  onCommit,
  locale,
}: {
  ar: AccountRate;
  busy: boolean;
  onCommit: (key: string, value: string) => void;
  locale: Locale;
}) {
  const c = optimiseCopy[locale].optimalisatie;
  const initial = ar.source === "manual" && ar.ratePct !== null ? String(ar.ratePct) : "";
  const [draft, setDraft] = useState(initial);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setDraft(initial);
  }
  return (
    <SaldoInput
      inputMode="decimal"
      placeholder={ar.ratePct === null ? c.interest.rateCellUnknownPlaceholder : `${ar.ratePct}`}
      aria-label={c.interest.rateCellAriaLabel(ar.account.name)}
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

export default function Optimalisatie({
  txs,
  accounts,
  rules,
  own,
  asOf,
  busy,
  facts,
  entries = CATALOGUE_ENTRIES,
  initialRates,
  onRateCommit,
}: OptimalisatieProps) {
  const [locale] = useAppLocale();
  const c = optimiseCopy[locale].optimalisatie;
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
  const subPeriodLabel = c.subscriptions.periods[subPeriod] ?? c.subscriptions.periodLabelFallback;
  const [
    subTableDienstH,
    subTableFunctieH,
    ,
    subTableAfschriftH,
    subTableVeranderingH,
    subTableLaatstH,
  ] = c.subscriptions.tableHeaders(subPeriodLabel);
  /* Hoeveel rijen er in DEZE stand een rekensom onder zich hebben staan. Dat
     getal hoort in het label van de opgevouwen regel: wie hem dichtlaat moet
     nog steeds weten dat er is omgerekend. */
  const omgerekend = useMemo(
    () =>
      subRows.filter((x) => {
        const a = subAmountIn(x, subPeriod);
        return a.kind === "bedrag" && a.derived;
      }).length,
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
  const provider = useMemo(
    () => createRatesProvider({ url: RATES_URL, catalogueRates: CATALOGUE_RATES }),
    [],
  );
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
    /* The note is scraped from the bank's own Dutch terms, so it is quoted only
     * to a Dutch reader. An English reader gets the same facts rebuilt from the
     * structured rate instead of a Dutch clause mid-sentence. The `daarna` test
     * below is likewise Dutch-only by nature: it asks whether the quoted note
     * already states the post-promo rate, and only a Dutch note ever does. */
    const note = locale === "nl" ? (interest.bestPromo.promoNote?.trim() ?? "") : "";
    const stop = note.endsWith(".") ? "" : ".";
    const kept = keptRate(interest.bestPromo);
    const promo = c.interest.promo;
    const notePrefix = note ? promo.tailNotePrefix(note + stop) : ".";
    if (kept === null) return notePrefix + promo.tailUnknownAfter;
    if (note && /daarna/i.test(note)) return promo.tailNotePrefix(note + stop);
    return notePrefix + promo.tailKeptAfter(keptLabel(locale, interest.bestPromo));
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
          fact:
            r.cashbackPct !== null && fact
              ? { pct: r.cashbackPct, source: fact.source, updatedAt: fact.updatedAt }
              : null,
          assumptionOn,
          // De peildatum komt van de catalogusrijen van DEZE bank in DIT soort
          // product. Zijn eigen kaart heeft geen rij, dus zonder deze omweg heet
          // elke aanname over zijn eigen kaarten voor altijd "nog nooit
          // nagekeken" en zegt de jaarlijkse herzieningsmelding niets meer.
          lastCheckedAt: lastTermsCheckedForIssuer(
            entries,
            r.account.bank ?? "",
            CATALOGUE_KINDS_FOR[kind],
          ),
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
  const alleTallies = useMemo(() => merchantTallies(txs).filter((t) => t.charges > 1), [txs]);
  const tallies = useMemo(
    () => alleTallies.filter((t) => t.excluded !== "woonlast"),
    [alleTallies],
  );
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
    const open = new Set(
      heldCashback.filter((h) => cashbackPctOf(h.k) === null).map((h) => h.product),
    );
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
  const monthlyBaseCents =
    measured.length > 0 && yearlySpendCents > 0 ? Math.round(yearlySpendCents / 12) : null;
  const baseObservedDays =
    measured.length > 0 ? Math.max(...measured.map((r) => r.spend.observedDays)) : 0;
  const baseIsUpperBound = measured.some((r) => r.spend.kind === "upper-bound");
  const lastFull = useMemo(
    () =>
      lastFullMonthSpend(
        measured.map((r) => r.account.key),
        txs,
        rules,
        own,
        asOf,
      ),
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
      cashbackOffers.every(
        (o) =>
          altKindLabel(locale, entries.find((e) => e.id === o.productId)?.kind ?? "") !== undefined,
      ),
    [cashbackOffers, entries, locale],
  );
  /* NEVER A EURO FIGURE WITH A HALF MISSING. `cashbackSwitchGain` already
     refuses when his own rate is unknown; the base is the other half, and it is
     checked here so the message below can name WHICH half is missing. */
  const cashbackUpgrade = useMemo(
    () =>
      monthlyBaseCents === null
        ? null
        : cashbackSwitchGain(bestHeldCashback, bestOffer, yearlySpendCents),
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
      <div className="flex items-baseline justify-between gap-[var(--sp-4)] flex-wrap pb-[var(--sp-2)] mt-[var(--sp-5)] mb-[var(--sp-4)] border-b-2 border-b-ink first:mt-0">
        <h2 className="m-0 font-display text-[1.5rem] font-semibold tracking-[-0.01em] text-ink">
          {c.header.title}
        </h2>
        <span className="eyebrow flex-none">{c.header.eyebrow}</span>
      </div>

      <div className="kpi-row">
        <div className="kpi highlight">
          <div className="kpi-label">{c.kpis.subscriptions.label}</div>
          <div className="kpi-value">{subs.length}</div>
          {/* Volgt de schakelaar, want "/mnd" laten staan naast een tabel in
              jaarbedragen is een scherm dat het met zichzelf oneens is. De
              eenheid staat er voluit bij en niet als afkorting: dit is de tegel
              die hij als eerste leest. */}
          <div className="eyebrow">
            {c.kpis.subscriptions.eyebrow(
              euro(locale, subTotal.cents),
              c.common.perUnit(subTotal.unit),
              subTotal.onbekend,
            )}
          </div>
        </div>
        {/* Only when there is something to report. A tile reading 0 is a module
            telling you it has nothing to say, and it costs a column to say it —
            "don't render an empty one". The CHECK is still reported, in one
            clause in the Abonnementen footer, so an absent tile cannot read as
            an absent check. */}
        {increases.length > 0 && (
          <div className="kpi">
            <div className="kpi-label">{c.kpis.priceIncreases.label}</div>
            <div className="kpi-value text-warn">{increases.length}</div>
            <div className="eyebrow">{c.kpis.priceIncreases.eyebrow}</div>
          </div>
        )}
        {overlaps.length > 0 && (
          <div className="kpi">
            <div className="kpi-label">{c.kpis.overlaps.label}</div>
            <div className="kpi-value text-warn">{overlaps.length}</div>
            <div className="eyebrow">{c.kpis.overlaps.eyebrow}</div>
          </div>
        )}
        <div className="kpi">
          <div className="kpi-label">{c.kpis.interest.label}</div>
          <div
            className={`kpi-value ${interest.totalExtraPerYearCents > 0 ? "text-warn" : "text-pos"}`}
          >
            {euro(locale, interest.totalExtraPerYearCents)}
          </div>
          {/* Dit getal is RENTE en alleen rente. Zodra er een overstap achter zit
              kan de nieuwe rekening zelf geld kosten, en dan is dit een brutobedrag
              — dat hoort in de tegel te staan en niet alleen in de module eronder.
              Zonder overstap is er niets om vóór te zijn. */}
          <div className="eyebrow">
            {interest.net === null ? c.kpis.interest.eyebrowNoNet : c.kpis.interest.eyebrowWithNet}
          </div>
        </div>
      </div>

      <ModuleGrid
        className="grid-2 grid-cols-2 [@media(max-width:900px)]:grid-cols-1"
        label={c.header.gridLabel}
      >
        {/* ── Abonnementen: de grote helft ──────────────────────────────── */}
        <Module
          title={c.subscriptions.title}
          height="tall"
          period={
            subs.length > 0 ? (
              <ModulePeriod
                value={subPeriod}
                options={SUB_PERIODS.map((value) => ({
                  value,
                  label: c.subscriptions.periods[value],
                }))}
                onChange={(v) => setSubPeriod(v as SubPeriod)}
                label={c.subscriptions.periodAriaLabel}
              />
            ) : undefined
          }
          footer={
            subs.length > 0 ? (
              <span>
                {/* Eén eenheid en niet meer twee. Hier stond "samen X per maand,
                    Y per jaar", waarbij Y werd berekend als X × 12 — en X was
                    bij een jaarabonnement zelf al een deling, dus Y miste het
                    bedrag dat werkelijk is afgeschreven. Nu noemt de voet de
                    eenheid die hij heeft gekozen, gerekend vanaf de
                    afschrijvingen. */}
                {c.subscriptions.footerWithSubs({
                  count: subs.length,
                  total: euro(locale, subTotal.cents),
                  unit: c.common.perUnit(subTotal.unit),
                  unknownCount: subTotal.onbekend,
                  noChanges: increases.length === 0 && overlaps.length === 0,
                })}
              </span>
            ) : (
              <span>{c.subscriptions.footerEmpty}</span>
            )
          }
        >
          {/* What the history can and cannot show, before anything is counted.
              A quarterly charge needs one full gap before there is a pattern at
              all, so with a short import "niets gevonden" and "kon niets vinden"
              are different answers — and only core knows which one this is. */}
          <p className="py-[var(--sp-3)] px-[var(--sp-4)] border border-line rounded-sm bg-surface-2 leading-[1.5]">
            {coverage.historyDays === 0 ? (
              c.subscriptions.coverage.noHistory
            ) : (
              <>
                {renderSegments(
                  c.subscriptions.coverage.withHistory({
                    days: coverage.historyDays,
                    first: coverage.firstDate,
                    last: coverage.lastDate,
                    cadences:
                      coverage.visibleCadences.map((d) => cadenceName(d, locale)).join(", ") ||
                      c.subscriptions.coverage.cadencesFallback,
                  }),
                )}
                {coverage.hiddenCadences.length > 0 &&
                  c.subscriptions.coverage.hiddenSuffix(
                    coverage.hiddenCadences
                      .map((h) =>
                        c.subscriptions.coverage.hiddenCadenceItem(
                          cadenceName(h.cadenceDays, locale),
                          h.needsDays,
                        ),
                      )
                      .join(", "),
                  )}
              </>
            )}
          </p>

          {subs.length === 0 ? (
            <div className="border border-dashed border-line rounded-[var(--r)] bg-surface-2 p-[var(--sp-4)]">
              <p className="m-0 mb-[var(--sp-3)] last:mb-0">
                <strong>{c.subscriptions.empty.heading}</strong> {c.subscriptions.empty.intro}
                {seen.outflows === 0
                  ? c.subscriptions.empty.noOutflows
                  : renderSegments(
                      c.subscriptions.empty.withOutflows({
                        outflows: seen.outflows,
                        merchants: seen.merchants,
                        repeated: seen.repeated,
                        dateRange:
                          seen.first && seen.last
                            ? c.subscriptions.empty.dateRange(seen.first, seen.last)
                            : "",
                      }),
                    )}
              </p>
              <p className="cell-sub m-0 mb-[var(--sp-3)] last:mb-0">
                {c.subscriptions.empty.rulesIntro}
              </p>
              <ul className="m-0 mb-[var(--sp-3)] pl-[1.1rem] text-muted text-[0.88rem] last:mb-0">
                {/* DRIE EN NIET TWEE, en dat is een correctie. Hier stond "minstens
                    twee betalingen" terwijl de maandband minstens DRIE afschrijvingen
                    eist (CADENCE_BANDS in subscriptions.ts: minOcc 3 voor 30 dagen,
                    2 voor kwartaal, halfjaar en jaar). Wie twee maandbedragen zag
                    staan en dit las, zocht de fout op de verkeerde plek. */}
                {c.subscriptions.empty.rules.map((rule) => (
                  <li className="mb-[var(--sp-1)]" key={rule}>
                    {rule}
                  </li>
                ))}
              </ul>

              {/* WAT DE DETECTOR ZELF ZAG, per ontvanger. De regels hierboven zijn een
                  samenvatting; dit is de meting. Aanleiding: hij las "85 ontvangers
                  minstens twee keer betaald, nul abonnementen" en kon niets met dat
                  getal — en het was ook op een ANDERE grondslag geteld dan de
                  detector gebruikt (ruwe tegenpartijtekst tegenover merchantKey na
                  uitsluitingen). Deze tabel deelt de grondslag met de detector, dus
                  wat hier staat is wat hij zag. */}
              {tallies.length > 0 && (
                <ToonMeer summary={c.subscriptions.empty.talliesSummary(tallies.length)}>
                  <TableWrap>
                    <Table cards>
                      <thead>
                        <tr>
                          {c.subscriptions.empty.talliesTableHeaders.map((h, i) => (
                            <Th key={h} numeric={i >= 1 && i <= 4}>
                              {h}
                            </Th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tallies.map((t) => (
                          <tr key={`${t.merchant}-${t.label}`}>
                            <Td>{t.label || c.subscriptions.empty.noNameFallback}</Td>
                            <Td numeric>{t.charges}</Td>
                            <Td numeric>{euro(locale, t.totalCents / 100)}</Td>
                            <Td numeric>
                              {t.medianGapDays === null
                                ? c.subscriptions.empty.reasonFallback
                                : c.subscriptions.empty.gapDaysSuffix(t.medianGapDays)}
                            </Td>
                            <Td numeric>
                              {t.amountCv === null
                                ? c.subscriptions.empty.reasonFallback
                                : t.amountCv.toFixed(2)}
                            </Td>
                            <Td>
                              {t.excluded === null
                                ? c.subscriptions.empty.includedYes
                                : t.excluded === "overboeking-of-persoon"
                                  ? c.subscriptions.empty.excludedTransferOrPerson
                                  : c.subscriptions.empty.excludedNoName}
                            </Td>
                            {/* WAAROM NIET, in de eigen woorden van de detector, niet
                                in een samenvatting ernaast. `t.reason` is al leeg (null)
                                voor de twee andere gevallen — een uitgesloten regel legt de
                                "Meegenomen?"-cel al uit, en een regel die wél een abonnement
                                werd heeft niets te verklaren — dus deze cel toont precies
                                één ding: de poort die een geaccepteerde naam alsnog tegenhield. */}
                            <Td>{t.reason ?? c.subscriptions.empty.reasonFallback}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </TableWrap>
                  <p className="cell-sub">
                    {c.subscriptions.empty.talliesFootnote}
                    {woonlastenWeggelaten > 0 && (
                      <>
                        {" "}
                        {woonlastenWeggelaten === 1
                          ? c.subscriptions.empty.housingExcludedOne
                          : c.subscriptions.empty.housingExcludedMany(woonlastenWeggelaten)}
                        {c.subscriptions.empty.housingExcludedTail}
                      </>
                    )}
                  </p>
                </ToonMeer>
              )}
              <p className="cell-sub m-0 mb-[var(--sp-3)] last:mb-0">
                {c.subscriptions.empty.missingAccountNote}
              </p>
              <details className="mt-[var(--sp-3)] p-[var(--sp-3)] border border-dashed border-line rounded-sm">
                <summary className="cursor-pointer text-muted text-[0.85rem]">
                  {c.subscriptions.empty.demoDisclosureSummary}
                </summary>
                <Badge className="inline-block mt-[var(--sp-3)] mb-[var(--sp-2)]">
                  {c.subscriptions.empty.demoBadge}
                </Badge>
                <TableWrap>
                  <Table cards className="opacity-75">
                    <thead>
                      <tr>
                        <Th>{c.subscriptions.empty.demoTableHeaders[0]}</Th>
                        <Th>{c.subscriptions.empty.demoTableHeaders[1]}</Th>
                        <Th numeric>{c.subscriptions.empty.demoTableHeaders[2]}</Th>
                        <Th numeric>{c.subscriptions.empty.demoTableHeaders[3]}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {EXAMPLE_SUBS.map((s, i) => (
                        <tr key={s.name}>
                          <Td
                            data-label={c.subscriptions.empty.demoTableHeaders[0]}
                            style={{ fontWeight: 600 }}
                          >
                            {s.name}
                          </Td>
                          <Td data-label={c.subscriptions.empty.demoTableHeaders[1]}>
                            <Badge>{c.subscriptions.empty.demoCategories[i]}</Badge>
                          </Td>
                          <Td numeric data-label={c.subscriptions.empty.demoTableHeaders[2]}>
                            {euro(locale, s.monthly)}
                          </Td>
                          <Td
                            numeric
                            className={
                              s.change > 0 ? "text-neg" : s.change < 0 ? "text-pos" : undefined
                            }
                            data-label={c.subscriptions.empty.demoTableHeaders[3]}
                          >
                            {s.change === 0
                              ? c.subscriptions.empty.demoNoChange
                              : `${s.change > 0 ? "+" : ""}${Math.round(s.change * 100)}%`}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              </details>
            </div>
          ) : (
            <>
              {increases.length > 0 || overlaps.length > 0 ? (
                <div className="flex flex-col gap-[var(--sp-3)] mb-[var(--sp-4)]">
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
                    const extra = amountInPeriod(
                      p.toCents - p.fromCents,
                      p.sub.cadenceDays,
                      subTotal.unit,
                      locale,
                    );
                    return (
                      <p
                        key={`inc-${p.sub.key}`}
                        data-testid="subscription-change"
                        className="py-[var(--sp-3)] px-[var(--sp-4)] border border-line rounded-sm bg-surface-2 leading-[1.5]"
                      >
                        {c.subscriptions.increaseSentence(
                          extra.kind === "bedrag"
                            ? {
                                name: p.sub.name,
                                fromAmount: euro(locale, p.fromCents),
                                toAmount: euro(locale, p.toCents),
                                changePct: Math.round(p.changePct * 100),
                                unit: c.common.perUnit(subTotal.unit),
                                extra: {
                                  amount: euro(locale, extra.cents),
                                  sum: extra.sum ?? undefined,
                                },
                              }
                            : {
                                name: p.sub.name,
                                fromAmount: euro(locale, p.fromCents),
                                toAmount: euro(locale, p.toCents),
                                changePct: Math.round(p.changePct * 100),
                                unit: c.common.perUnit(subTotal.unit),
                                cadence: cadenceName(p.sub.cadenceDays, locale),
                              },
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
                    const opzegbaar = subAmountIn(grootste, subTotal.unit, locale);
                    return (
                      <p
                        key={`ov-${o.function}`}
                        data-testid="subscription-change"
                        className="py-[var(--sp-3)] px-[var(--sp-4)] border border-line rounded-sm bg-surface-2 leading-[1.5]"
                      >
                        {c.subscriptions.overlapSentence({
                          count: o.subs.length,
                          functionName: o.function,
                          names: o.subs.map((s) => s.name).join(" + "),
                          total: euro(locale, samen.cents),
                          unit: c.common.perUnit(samen.unit),
                          cancelAmount:
                            opzegbaar.kind === "bedrag" ? euro(locale, opzegbaar.cents) : undefined,
                        })}
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
              <TableWrap>
                <Table cards>
                  <thead>
                    <tr>
                      <Th>{subTableDienstH}</Th>
                      <Th>{subTableFunctieH}</Th>
                      <Th numeric>{subPeriodLabel}</Th>
                      <Th numeric>{subTableAfschriftH}</Th>
                      <Th numeric>{subTableVeranderingH}</Th>
                      <Th>{subTableLaatstH}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {subRows.map((s) => {
                      const bedrag = subAmountIn(s, subPeriod, locale);
                      return (
                        <tr key={s.key}>
                          <Td data-label={subTableDienstH} style={{ fontWeight: 600 }}>
                            {s.name}
                          </Td>
                          <Td data-label={subTableFunctieH}>
                            <Badge>{s.function}</Badge>
                          </Td>
                          <Td numeric data-label={subPeriodLabel}>
                            {bedrag.kind === "bedrag" ? (
                              <>
                                {euro(locale, bedrag.cents)}
                                {bedrag.sum && <div className="cell-sub">{bedrag.sum}</div>}
                              </>
                            ) : (
                              /* Geen streepje: een em dash naast euro's leest als
                                 nul. Zelfde keuze als bij een onbekende
                                 rekeningprijs in de kostentabel. */
                              <span className="cell-sub">{c.subscriptions.unrekenbaarCell}</span>
                            )}
                          </Td>
                          <Td numeric data-label={subTableAfschriftH}>
                            {euro(locale, s.lastAmountCents)}
                            <div className="cell-sub">{cadenceName(s.cadenceDays, locale)}</div>
                          </Td>
                          <Td
                            numeric
                            data-label={subTableVeranderingH}
                            className={
                              s.changePct > 0
                                ? "text-neg"
                                : s.changePct < 0
                                  ? "text-pos"
                                  : undefined
                            }
                          >
                            {s.changePct === 0
                              ? c.common.dash
                              : `${s.changePct > 0 ? "+" : ""}${Math.round(s.changePct * 100)}%`}
                          </Td>
                          <Td className="cell-sub" data-label={subTableLaatstH}>
                            {s.lastDate}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>
              {/* WAT ER IS OMGEREKEND, geteld in het label en per rij uitgeschreven
                  in het paneel. De telling hoort vooraan en niet erin: wie de regel
                  dichtlaat moet nog steeds weten dát er onder deze bedragen een
                  deling zit. Staat er niets omgerekend — de stand "zoals
                  afgeschreven", of alleen maandabonnementen op "per maand" — dan
                  staat er ook geen regel die iets belooft wat het paneel niet
                  levert. */}
              {omgerekend > 0 && omgerekendUnit !== null && (
                <ToonMeer
                  summary={c.subscriptions.convertedPanel.summary(omgerekend, subRows.length)}
                >
                  <p className="cell-sub">
                    {c.subscriptions.convertedPanel.explanation(c.common.perUnit(omgerekendUnit))}
                  </p>
                  <ul>
                    {subRows.map((s) => {
                      const bedrag = subAmountIn(s, subPeriod, locale);
                      if (bedrag.kind !== "bedrag" || !bedrag.derived) return null;
                      return (
                        <li key={`om-${s.key}`} className="cell-sub">
                          {c.subscriptions.convertedPanel.item({
                            name: s.name,
                            lastAmount: euro(locale, s.lastAmountCents),
                            cadence: cadenceName(s.cadenceDays, locale),
                            sum: bedrag.sum ?? "",
                            result: euro(locale, bedrag.cents),
                            unit: c.common.perUnit(omgerekendUnit),
                          })}
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
          title={c.interest.title}
          height="tall"
          footer={
            interest.best ? (
              <span>
                {c.interest.footerWithBest({
                  bank: interest.best.bank,
                  keptLabel: keptLabel(locale, interest.best),
                  promo: interest.bestPromo
                    ? {
                        bank: interest.bestPromo.bank,
                        pct: pct(locale, interest.bestPromo.ratePct),
                      }
                    : undefined,
                  sourceLabel: c.interest.ratesSourceLabels[rates.source],
                  asOf: rates.asOf,
                })}
              </span>
            ) : (
              <span>{c.interest.footerNone}</span>
            )
          }
        >
          {interest.suggestions.length > 0 && interest.best ? (
            <>
              {/* BRUTO, en dat staat er nu bij. Zonder dat woord las deze regel als
                  wat je erop overhoudt, terwijl de rekening waar je heen gaat zelf
                  ook geld kan kosten: € 50 rente meer op een pakket van € 4,50 per
                  maand is € 4,00 achteruit. De aftrek staat onderaan dit blok. */}
              <p className="m-0 mb-[var(--sp-3)] font-display text-[1.25rem] text-ink">
                {renderSegments(
                  c.interest.leadSentence({
                    amount: euro(locale, interest.totalExtraPerYearCents),
                    showNetSuffix: interest.net !== null,
                  }),
                )}
              </p>
              {/* HET "VÓÓR WAT DIE REKENING ZELF KOST" STAAT AL IN DE KOP HIERBOVEN,
                  en blijft dus zichtbaar ook al vouwt de rest op — de waarschuwing
                  dat dit een brutobedrag is, is geen "notitie" maar deel van het
                  antwoord zelf. Wat hieronder opvouwt is de ONDERBOUWING per
                  rekening plus de exacte nettoberekening: dezelfde tabel verderop
                  toont Rekening/Saldo/Rente %/Bron/Mogelijk per jaar, dus dit is
                  uitleg naast een tabel en geen tweede plek waar hetzelfde cijfer
                  voor het eerst staat. */}
              <ToonMeer summary={c.interest.toonMeerSummary}>
                <div className="flex flex-col gap-[var(--sp-3)]">
                  {interest.suggestions.map((s) => (
                    <p
                      key={`sug-${s.account.key}`}
                      className="py-[var(--sp-3)] px-[var(--sp-4)] border border-line rounded-sm bg-surface-2 leading-[1.5]"
                    >
                      {c.interest.suggestionSentence({
                        balance: euro(locale, s.balanceCents),
                        accountLabel: accountLabel(s.account),
                        ratePct: pct(locale, s.ratePct),
                        bestBank: interest.best!.bank,
                        bestKeptLabel: keptLabel(locale, interest.best!),
                        diffPct: pct(locale, Math.round((keptBest! - s.ratePct) * 100) / 100),
                        extra: euro(locale, s.extraPerYearCents),
                      })}
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
                      product="account"
                      gain="interest"
                      locale={locale}
                    />
                  )}
                </div>
              </ToonMeer>
            </>
          ) : (
            <div className="border border-dashed border-line rounded-[var(--r)] bg-surface-2 p-[var(--sp-4)]">
              <p className="m-0 mb-[var(--sp-3)] last:mb-0">
                <strong>{c.interest.empty.heading}</strong> {c.interest.empty.explanation}
              </p>
              <ul className="m-0 mb-[var(--sp-3)] pl-[1.1rem] text-muted text-[0.88rem] last:mb-0">
                {noSaldo > 0 && (
                  <li className="mb-[var(--sp-1)]">{c.interest.empty.noSaldoItem(noSaldo)}</li>
                )}
                {unknownRate > 0 && (
                  <li className="mb-[var(--sp-1)]">{c.interest.empty.noRateItem(unknownRate)}</li>
                )}
                {/* "Al op de beste plek" was a CONCLUSION drawn from an absence
                    of suggestions, and an absence has two causes: nothing to gain,
                    or nothing computed. He hit the second and was told the first.
                    So say which, with the numbers, and never claim a comparison
                    that was not made. */}
                {noSaldo === 0 &&
                  unknownRate === 0 &&
                  (interest.best && keptBest !== null ? (
                    <li className="mb-[var(--sp-1)]">
                      {c.interest.empty.bestKnown({
                        keptPct: pct(locale, keptBest),
                        bank: interest.best.bank,
                        marginPct: pct(locale, MARGIN_PCT),
                      })}
                    </li>
                  ) : (
                    <li className="mb-[var(--sp-1)]">{c.interest.empty.noRatesKnown}</li>
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
            <p className="py-[var(--sp-3)] px-[var(--sp-4)] border border-line rounded-sm bg-surface-2 leading-[1.5] mt-[var(--sp-3)]">
              <Badge>{c.interest.promo.badge}</Badge>{" "}
              {c.interest.promo.headline({
                bank: interest.bestPromo.bank,
                pct: pct(locale, interest.bestPromo.ratePct),
              })}
              {promoTail}
              {interest.promoExtraPerMonthCents > 0 &&
                interest.best &&
                c.interest.promo.extraPerMonth(
                  euro(locale, interest.promoExtraPerMonthCents),
                  interest.best.bank,
                )}
            </p>
          )}

          <TableWrap style={{ marginTop: "var(--sp-4)" }}>
            <Table cards>
              <thead>
                <tr>
                  <Th>{c.interest.tableHeaders.rekening}</Th>
                  <Th numeric>{c.interest.tableHeaders.saldo}</Th>
                  <Th numeric>{c.interest.tableHeaders.rentePct}</Th>
                  <Th>{c.interest.tableHeaders.bron}</Th>
                  <Th numeric>
                    {c.interest.tableHeaders.mogelijkPerJaar(
                      keptBest !== null ? pct(locale, keptBest) : undefined,
                    )}
                  </Th>
                </tr>
              </thead>
              <tbody>
                {interest.accountRates.map((ar) => {
                  // Against what he KEEPS at the winner, the same figure
                  // analyzeInterest priced the year on. This column used to use the
                  // headline, so the table and the sentence above it could disagree
                  // by a teaser's worth of euros.
                  const gain =
                    keptBest !== null &&
                    ar.ratePct !== null &&
                    ar.balanceCents > 0 &&
                    keptBest - ar.ratePct > 0.1
                      ? Math.round((ar.balanceCents * (keptBest - ar.ratePct)) / 100)
                      : 0;
                  // The row of the catalogue/benchmark table that answers for THIS
                  // account's own bank — the same call resolveAccountRate makes, so
                  // the screen names the tariff the number actually came from.
                  const bankRow = matchBankBenchmark(ar.account.bank, rates.rates, ar.account.name);
                  const bankKept = bankRow === null ? null : keptRate(bankRow);
                  return (
                    <tr key={ar.account.key}>
                      <Td data-label={c.interest.tableHeaders.rekening}>
                        <div style={{ fontWeight: 600 }}>{ar.account.bank || ar.account.name}</div>
                        <div className="cell-sub">{ar.account.name}</div>
                      </Td>
                      <Td numeric data-label={c.interest.tableHeaders.saldo}>
                        {ar.account.balance === null
                          ? c.common.unknownBalance
                          : euro(locale, ar.balanceCents)}
                      </Td>
                      <Td numeric data-label={c.interest.tableHeaders.rentePct}>
                        <RateCell ar={ar} busy={busy} onCommit={onRateCommit} locale={locale} />
                      </Td>
                      <Td className="cell-sub" data-label={c.interest.tableHeaders.bron}>
                        {c.interest.sourceLabels[ar.source]}
                        {/* Name the tariff, its bank and its date. "Geschat via
                            banktarief" asks to be believed; this can be checked. */}
                        {ar.source === "benchmark" && bankRow && bankKept !== null && (
                          <div className="cell-sub">
                            {c.interest.benchmarkSourceNote({
                              bank: bankRow.bank,
                              product: bankRow.product,
                              pct: pct(locale, bankKept),
                              asOf: bankRow.asOf ?? rates.asOf,
                            })}
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
                              {c.interest.assumedZeroNote({
                                bank: bankRow.bank,
                                pct: pct(locale, bankKept),
                                product: bankRow.product,
                                asOf: bankRow.asOf ?? rates.asOf,
                              })}
                            </div>
                          )}
                      </Td>
                      <Td numeric data-label={c.interest.tableHeaders.mogelijkPerJaar()}>
                        {gain > 0 ? (
                          <span className="text-warn">+{euro(locale, gain)}</span>
                        ) : (
                          c.common.dash
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>

          <details className="rates-benchmark">
            <summary className="eyebrow">
              {c.interest.benchmarkDetails.summary({
                count: rates.rates.length,
                sourceLabel: c.interest.ratesSourceLabels[rates.source],
                asOf: rates.asOf,
              })}
            </summary>
            <TableWrap>
              <Table cards>
                <thead>
                  <tr>
                    {c.interest.benchmarkDetails.tableHeaders.map((h, i) => (
                      <Th key={h} numeric={i === 1 || i === 2}>
                        {h}
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rates.rates.map((r) => (
                    <tr key={`${r.bank}-${r.product}`}>
                      <Td data-label={c.interest.benchmarkDetails.tableHeaders[0]}>
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
                          {r.capitalAtRisk ? (
                            <span
                              title={c.interest.benchmarkDetails.capitalAtRiskTooltip}
                              style={{ color: "var(--warn, #b26a00)" }}
                            >
                              {" "}
                              *
                            </span>
                          ) : null}
                        </div>
                        <div className="cell-sub">{r.product}</div>
                      </Td>
                      <Td
                        numeric
                        className="text-pos"
                        data-label={c.interest.benchmarkDetails.tableHeaders[1]}
                      >
                        {pct(locale, r.ratePct)}
                      </Td>
                      {/* A teaser whose standing rate the source never states is
                          "onbekend" here, and it is left out of the ranking
                          entirely — Trade Republic's own catalogue conditions read
                          "NOT THE STANDING RATE — do not serve 3% bare". An em
                          dash would have read as "nothing changes afterwards". */}
                      <Td
                        numeric
                        className="cell-sub"
                        data-label={c.interest.benchmarkDetails.tableHeaders[2]}
                      >
                        {keptRate(r) === null
                          ? c.interest.benchmarkDetails.unknownKept
                          : keptRate(r) === r.ratePct
                            ? c.interest.benchmarkDetails.sameAsHeadline
                            : keptLabel(locale, r)}
                      </Td>
                      <Td data-label={c.interest.benchmarkDetails.tableHeaders[3]}>
                        {promoBadgeLabel(locale, r) !== null ? (
                          <Badge>🎁 {promoBadgeLabel(locale, r)}</Badge>
                        ) : (
                          <span className="cell-sub">{c.interest.benchmarkDetails.noPromo}</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {rates.rates.some((r) => r.capitalAtRisk) ? (
                <p className="cell-sub" style={{ marginTop: ".5rem" }}>
                  {c.interest.benchmarkDetails.capitalAtRiskFootnote}
                </p>
              ) : null}
            </TableWrap>
            <p className="eyebrow">
              {c.interest.benchmarkDetails.explanation({
                sourceLabel: c.interest.ratesSourceLabels[rates.source],
                asOf: rates.asOf,
              })}{" "}
              <CardLink onClick={() => void refreshRates()} disabled={refreshing}>
                {refreshing
                  ? c.interest.benchmarkDetails.refreshingButton
                  : c.interest.benchmarkDetails.refreshButton}
              </CardLink>
              . {c.interest.benchmarkDetails.refreshNote}{" "}
              {rates.source !== "live" && c.interest.benchmarkDetails.offlineNote}
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
        <Module span={2} title={c.cashback.title} footer={<span>{c.cashback.footer}</span>}>
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
            <div className="flex flex-col gap-[var(--sp-3)]">
              {routing.map((a) => {
                const routed = c.cashback.routingSentence({
                  toBank: a.to.bank,
                  fromBank: a.from.bank,
                  toPct: pct(locale, a.toPct),
                  fromPct: pct(locale, a.fromPct),
                  approximate: a.approximate,
                  amount: euro(locale, a.gainPerYearCents),
                });
                return (
                  <div className="position-row" key={a.from.key + a.to.key}>
                    <span>{renderSegments(routed.main)}</span>
                    <span className="text-pos">{routed.tail}</span>
                  </div>
                );
              })}
            </div>
          )}

          {cashbackUpgrade &&
          cashbackNet &&
          monthlyBaseCents !== null &&
          bestHeldCashback !== null ? (
            <div
              className={`flex flex-col gap-[var(--sp-3)]${routing.length > 0 ? " mt-[var(--sp-4)]" : ""}`}
            >
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
              <p
                className="m-0 mb-[var(--sp-3)] font-display text-[1.25rem] text-ink"
                data-testid="cashback-antwoord"
              >
                {c.cashback.answerLine({
                  product: cashbackUpgrade.best.product,
                  bank: cashbackUpgrade.best.bank || undefined,
                  pct: pct(locale, cashbackUpgrade.best.cashbackPct),
                  ownPct: pct(locale, bestHeldCashback),
                  assumed: bestHeld?.k.tier === "aangenomen",
                  altKind: altKindLabel(locale, bestOfferKind),
                  extra: euro(locale, cashbackUpgrade.extraPerYearCents),
                })}
              </p>

              {/* WAT DE KAART ZELF KOST, in de drie toestanden die er echt zijn.
                  Dezelfde component en dezelfde zinnen als de Rente-module
                  hierboven en als het reisblok — één gat, één verhaal. */}
              <Productkosten
                net={cashbackNet}
                id="cashback"
                product="card"
                gain="cashback"
                unknownTail={c.cashback.unknownTail}
                locale={locale}
              />

              {/* THE GATE, IF THERE IS ONE, IN FULL. A 5% card behind a staking
                  tier is not a 5% card for him, so the euro figure above cannot
                  stand without its conditions. It was truncated at first, and
                  that was worse than not showing it: the Obsidian text names its
                  tier gate near the END, so the clamp cut off the only part that
                  mattered. Volledige tekst, opgevouwen — en het label zegt zelf
                  dát er voorwaarden zijn, zodat dicht niet hetzelfde is als weg. */}
              {cashbackUpgrade.best.conditions && (
                <ToonMeer summary={c.cashback.conditions.summary}>
                  <p style={{ margin: 0 }}>{cashbackUpgrade.best.conditions}</p>
                  <p className="cell-sub" style={{ margin: ".35rem 0 0" }}>
                    {c.cashback.conditions.sourceLine(
                      cashbackUpgrade.best.sourceUrl,
                      cashbackUpgrade.best.asOf,
                    )}
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
            <p
              className="block-empty"
              style={{ marginTop: routing.length > 0 ? "var(--sp-4)" : undefined }}
            >
              {spendable.length === 0
                ? c.cashback.emptyReasons.noAccounts
                : bestHeldCashback === null
                  ? /* WAAROM DE AANNAME HIER NIET GELDT, en niet alleen dat er iets
                       ontbreekt. Deze tak haalt het sinds review 4 alleen nog bij
                       kaarten die buiten de aanname vallen — een prepaidkaart, een
                       Amex, een neobank — of als hij de aanname zelf heeft
                       uitgezet. De lijst in de plooi noemt per kaart welke van die
                       redenen het is. */
                    c.cashback.emptyReasons.cannotAssume
                  : monthlyBaseCents === null
                    ? c.cashback.emptyReasons.tooLittleHistory(MIN_SPEND_DAYS)
                    : cashbackOffers.length === 0
                      ? c.cashback.emptyReasons.noCatalogueCards
                      : c.cashback.emptyReasons.alreadyBest}
            </p>
          )}

          {/* DE OPENSTAANDE VRAAG STAAT VOORAAN, en stond eerst onderaan de
              module. Het is geen uitleg maar een weigering: over deze kaarten
              mag niets worden ingevuld, dus het bedrag hierboven gaat niet over
              hen. Wie dat opvouwt laat een afwezigheid een conclusie dragen. */}
          {openCashbackGaps.length > 0 && (
            <p
              className="cell-sub"
              data-testid="cashback-open"
              style={{ marginTop: "var(--sp-3)" }}
            >
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
              {c.cashback.openGapsSentence(openCashbackGaps.map((g) => g.product).join(", "))}
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
            <ToonMeer summary={c.cashback.onderbouwing.toonMeerSummary}>
              {cashbackUpgrade && monthlyBaseCents !== null && bestHeldCashback !== null && (
                <div className="flex flex-col gap-[var(--sp-3)]">
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
                      <strong>{c.cashback.onderbouwing.ownCardLabel}</strong> —{" "}
                      {pct(locale, bestHeldCashback)}
                      {/* DE HARDHEID STAAT OP DEZELFDE REGEL ALS HET GETAL, niet in
                          een voetnoot en niet in een comment. Dit is de hele
                          voorzorg: een aangenomen nul die er precies zo uitziet als
                          een gemeten nul is de valse nul waar dit project al een keer
                          op stukliep. Hij staat daarom óók op de antwoordregel
                          vooraan — dit cijfer mag nergens kaal voorkomen. */}
                      {bestHeld?.k.tier === "aangenomen" && (
                        <>
                          {" "}
                          <Badge>{c.common.assumedBadge}</Badge>
                        </>
                      )}
                    </span>
                    <span>
                      {euro(locale, Math.round((monthlyBaseCents * bestHeldCashback) / 100))}
                      {c.cashback.onderbouwing.perMonthSuffix}
                    </span>
                  </div>
                  {bestHeld?.k.tier === "aangenomen" && (
                    <p className="cell-sub" data-testid="cashback-aanname">
                      {c.cashback.onderbouwing.assumedNote({
                        bankOrProduct: bestHeld.account.bank || bestHeld.product,
                        checkedNote: bestHeld.k.lastCheckedAt
                          ? c.cashback.onderbouwing.assumedCheckedNote(
                              bestHeld.k.issuerFamily,
                              bestHeld.k.lastCheckedAt,
                            )
                          : c.cashback.onderbouwing.assumedNeverCheckedNote(
                              bestHeld.k.issuerFamily,
                            ),
                        dueForReview: assumptionDueForReview(bestHeld.k.lastCheckedAt, asOf),
                      })}
                    </p>
                  )}
                  <div className="position-row" data-testid="cashback-beste">
                    <span>
                      <strong>{c.cashback.onderbouwing.bestCardLabel}</strong> —{" "}
                      {pct(locale, cashbackUpgrade.best.cashbackPct)} bij{" "}
                      {cashbackUpgrade.best.bank || cashbackUpgrade.best.product}{" "}
                      <span className="cell-sub">
                        {c.cashback.onderbouwing.bestCardMeta(
                          cashbackUpgrade.best.product,
                          cashbackUpgrade.best.asOf,
                        )}
                      </span>
                      {altKindLabel(locale, bestOfferKind) ? (
                        <>
                          {" "}
                          <Badge>{altKindLabel(locale, bestOfferKind)}</Badge>
                        </>
                      ) : null}
                    </span>
                    <span>
                      {euro(
                        locale,
                        Math.round((monthlyBaseCents * cashbackUpgrade.best.cashbackPct) / 100),
                      )}
                      {c.cashback.onderbouwing.perMonthSuffix}
                    </span>
                  </div>
                  {/* HET VERSCHIL IS BRUTO, en dat staat er nu bij. Zonder dat woord
                      las deze regel als wat je erop overhoudt, terwijl de kaart zelf
                      ook geld kost: 2% tegen 1,5% levert € 163,92 per jaar op, en een
                      kaart van € 16,90 per maand kost € 202,80. De aftrek staat
                      vooraan, bij het antwoord; hier staat waar dat brutobedrag
                      vandaan komt. */}
                  <div className="position-row" data-testid="cashback-verschil">
                    <span>
                      <strong>{c.cashback.onderbouwing.diffLabel}</strong>
                      {c.cashback.onderbouwing.diffSub}
                    </span>
                    <span className="text-pos">
                      {c.cashback.onderbouwing.diffAmount(
                        euro(locale, Math.round(cashbackUpgrade.extraPerYearCents / 12)),
                        euro(locale, cashbackUpgrade.extraPerYearCents),
                      )}
                    </span>
                  </div>
                  {/* The base, and how it was measured, so the figure can be redone
                      against the same afschrift instead of taken on trust.
                      MISMATCH: copy/optimise.ts's onderbouwing.baseSentence flattens
                      this into one string, dropping the <strong> around "gemiddeld
                      per maand" — untested, but kept as a comment for the file
                      owner rather than silently losing the emphasis. */}
                  <p className="cell-sub" data-testid="cashback-basis">
                    {c.cashback.onderbouwing.baseSentence({
                      upperBound: baseIsUpperBound,
                      amount: euro(locale, monthlyBaseCents),
                      days: baseObservedDays,
                    })}
                  </p>
                  <p className="cell-sub">
                    {c.cashback.onderbouwing.explanation}
                    {baseIsUpperBound && c.cashback.onderbouwing.upperBoundNote}
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
                    <strong>{c.cashback.routingBasis.heading}</strong>
                  </p>
                  {routing.map((a) => {
                    const base = spendOf.get(a.from.key);
                    return (
                      <p className="cell-sub" key={`basis-${a.from.key}${a.to.key}`}>
                        {c.cashback.routingBasis.sentence({
                          toBank: a.to.bank,
                          fromBank: a.from.bank,
                          upperBound: a.approximate,
                          amount: euro(locale, a.baseCents),
                          measuredDays: base ? base.observedDays : undefined,
                        })}
                        {a.approximate && c.cashback.routingBasis.approxNote}
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
                <div
                  className="flex flex-col gap-[var(--sp-3)] mt-[var(--sp-3)]"
                  data-testid="cashback-vorige-maand"
                >
                  <p style={{ margin: 0 }}>
                    <strong>
                      {c.cashback.lastMonthCompare.heading(monthLabel(locale, lastMonthCompare.ym))}
                    </strong>
                    {c.cashback.lastMonthCompare.summaryTail(
                      euro(locale, lastMonthCompare.spentCents),
                      euro(locale, lastMonthCompare.bestCents - lastMonthCompare.ownCents),
                      cashbackUpgrade.best.bank || cashbackUpgrade.best.product,
                    )}
                  </p>
                  <div className="position-row">
                    <span>{c.cashback.lastMonthCompare.spentLabel}</span>
                    <span>{euro(locale, lastMonthCompare.spentCents)}</span>
                  </div>
                  <div className="position-row">
                    <span>
                      {c.cashback.lastMonthCompare.ownCardLabel(pct(locale, bestHeldCashback))}
                      {bestHeld?.k.tier === "aangenomen" && (
                        <>
                          {" "}
                          <Badge>{c.common.assumedBadge}</Badge>
                        </>
                      )}
                    </span>
                    <span>{euro(locale, lastMonthCompare.ownCents)}</span>
                  </div>
                  <div className="position-row">
                    <span>
                      {c.cashback.lastMonthCompare.bestCardLabel(
                        cashbackUpgrade.best.product,
                        pct(locale, cashbackUpgrade.best.cashbackPct),
                      )}
                    </span>
                    <span>{euro(locale, lastMonthCompare.bestCents)}</span>
                  </div>
                  {/* Dezelfde component, dezelfde zinnen en dezelfde rekenwijze
                      als het jaarblok vooraan. Het verschil zit alleen in de
                      BASIS: hier staat een eenmalige opbrengst tegen een prijs
                      die doorloopt, dus rekent `netBenefit` een hele
                      factureringsperiode en zegt `spanWords` erbij welke. */}
                  <Productkosten
                    net={lastMonthCompare.net}
                    id="cashback-maand"
                    product="card"
                    gain="cashback-month"
                    locale={locale}
                  />
                  <p className="cell-sub">{c.cashback.lastMonthCompare.footnote}</p>
                </div>
              )}

              {/* DE UITLEG OVER DE CATALOGUS. Dat de winnende kaart geen gewone
                  bankkaart is, staat als merkteken op de antwoordregel vooraan;
                  dit is de zin eromheen — wat de bronnen wél en niet dekken. */}
              {allOffersAlt && (
                <p className="cell-sub">{c.cashback.noOrdinaryCard(cashbackOffers.length)}</p>
              )}

              {/* ── WAT WE VAN ELKE EIGEN KAART WETEN, en hoe hard ─────────────
                  Het STAAT er, per kaart, met het woord "aangenomen" voluit — dat
                  is de prijs van een aanname: hij mag, mits hij overal te vinden
                  is. */}
              {heldCashback.length > 0 && (
                <div data-testid="cashback-kaarten" style={{ marginTop: "var(--sp-3)" }}>
                  <p style={{ margin: 0 }}>
                    <strong>{c.cashback.perCardSourceHeading(heldCashback.length)}</strong>
                  </p>
                  <ul className="cell-sub" style={{ margin: ".35rem 0 0", paddingLeft: "1.1rem" }}>
                    {heldCashback.map((h) => (
                      <li key={h.account.key}>
                        {/* Eén zin, uit core. De vier takken stonden hier ooit als
                            vier stukjes JSX, en Profiel zei bijna dezelfde vier
                            dingen net iets anders — zie `describeHeldCashback`. */}
                        <strong>{h.product}</strong> —{" "}
                        {heldCashbackSentence(describeHeldCashback(h.k), locale)}
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
                    <strong>
                      {cashbackUpgrade
                        ? c.cashback.otherOffers.headingWithUpgrade
                        : c.cashback.otherOffers.headingWithoutUpgrade}
                    </strong>{" "}
                    <span className="cell-sub">{c.cashback.otherOffers.subtitle}</span>
                  </p>
                  <ul className="cell-sub" style={{ margin: ".35rem 0 0", paddingLeft: "1.1rem" }}>
                    {otherOffers.map((o) => (
                      <li key={o.productId}>
                        <strong>{pct(locale, o.cashbackPct)}</strong> —{" "}
                        {o.bank ? `${o.bank} · ` : ""}
                        {o.product}{" "}
                        <span style={{ opacity: 0.7 }}>
                          {c.cashback.otherOffers.itemMeta(o.asOf)}
                        </span>
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
          <Module span={2} title={c.costs.title} footer={<span>{c.costs.footer}</span>}>
            {/* HET ANTWOORD: wat het je per jaar kost om te houden wat je hebt.
                Core levert drie varianten en dit zijn ze alle drie — een som met
                onbekende rekeningen erin is geen totaal, en zonder één bekend
                tarief is er niets om op te tellen. De tweede en de derde zijn
                WEIGERINGEN en dus zelf de uitkomst: ze staan vooraan en vouwen
                nooit op. */}
            {costs.total.kind === "complete" && (
              <p
                className="m-0 mb-[var(--sp-3)] font-display text-[1.25rem] text-ink"
                data-testid="kosten-totaal"
              >
                {c.costs.totalComplete(
                  euro(locale, costs.total.perYearCents),
                  costs.total.accounts,
                )}
              </p>
            )}
            {costs.total.kind === "incomplete" && (
              <p
                className="m-0 mb-[var(--sp-3)] font-display text-[1.25rem] text-ink"
                data-testid="kosten-totaal"
              >
                {c.costs.totalIncomplete({
                  known: costs.total.known,
                  total: costs.total.known + costs.total.unknown,
                  amount: euro(locale, costs.total.knownPerYearCents),
                  unknown: costs.total.unknown,
                })}
              </p>
            )}
            {costs.total.kind === "none" && (
              <p
                className="py-[var(--sp-3)] px-[var(--sp-4)] border border-line rounded-sm bg-surface-2 leading-[1.5]"
                data-testid="kosten-totaal"
              >
                {c.costs.totalNone}
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
              const cost = row.cost;
              if (cost.kind !== "known" || cost.amount.cents !== 0) return null;
              const bank = row.account.bank || row.account.name;
              /* De naam van het PRODUCT als we het herkend hebben ("ING Student"),
                 en anders bank plus rekeningnaam. Niet allebei achter elkaar: dat
                 gaf "ING ING Student", en een dubbele banknaam leest als twee
                 rekeningen. */
              const label =
                cost.matchedBy === "product-name"
                  ? cost.fee.product
                  : `${bank} — ${row.account.name}`;
              return (
                <p
                  className="py-[var(--sp-3)] px-[var(--sp-4)] border border-line rounded-sm bg-surface-2 leading-[1.5]"
                  data-testid={`kosten-gratis-${row.account.key}`}
                  key={`gratis-${row.account.key}`}
                >
                  {cost.conditions
                    ? c.costs.freeAccountWithConditions(label, cost.conditions)
                    : c.costs.freeAccountNoConditions(label)}
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
              const cost = row.cost;
              if (cost.kind === "known") return null;
              const bank = row.account.bank || row.account.name;
              const free = row.candidates.filter((f) => f.amount.cents === 0);
              return (
                <div key={`onbekend-${row.account.key}`}>
                  <p
                    className="py-[var(--sp-3)] px-[var(--sp-4)] border border-line rounded-sm bg-surface-2 leading-[1.5]"
                    data-testid={`kosten-onbekend-${row.account.key}`}
                  >
                    {c.costs.unknownAccountLead(bank, row.account.name)}{" "}
                    {cost.reason === "no-bank"
                      ? c.costs.unknownReasons.noBank
                      : cost.reason === "provider-unknown"
                        ? c.costs.unknownReasons.providerUnknown(bank)
                        : row.candidates.length === 0
                          ? c.costs.unknownReasons.noCandidates(bank)
                          : c.costs.unknownReasons.unclearProduct(bank)}
                  </p>
                  {free.length > 0 && (
                    <div className="cell-sub" data-testid={`gratis-bij-${row.account.key}`}>
                      <strong>{c.costs.freeAtBank.heading(bank)}</strong>
                      <ul style={{ margin: ".2rem 0 0", paddingLeft: "1.1rem" }}>
                        {free.map((f) => (
                          <li key={f.productId}>
                            {c.costs.freeAtBank.item(
                              f.product,
                              feeLabel(locale, f.amount),
                              f.conditions ?? c.costs.freeAtBank.defaultConditionNote,
                            )}
                          </li>
                        ))}
                      </ul>
                      <p style={{ margin: ".2rem 0 0" }}>{c.costs.freeAtBank.matchHint}</p>
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
                        summary={c.costs.freeAtBank.sourceSummary(free.length)}
                      >
                        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                          {free.map((f) => (
                            <li key={`bron-${f.productId}`}>
                              {c.costs.freeAtBank.sourceItem(
                                f.product,
                                sourceHost(f.sourceUrl),
                                f.asOf,
                              )}
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
              <div className="flex flex-col gap-[var(--sp-3)] mt-[var(--sp-4)]">
                {costTips.map((row) => {
                  const cost = row.cost;
                  if (cost.kind !== "known") return null;
                  const held =
                    cost.matchedBy === "product-name"
                      ? cost.fee.product
                      : accountLabel(row.account);
                  const alts = [
                    { label: c.costs.tips.atProviderLabel, alt: row.cheaperAtProvider },
                    { label: c.costs.tips.elsewhereLabel, alt: row.cheaperElsewhere },
                  ];
                  return alts.map(({ label, alt }) =>
                    alt === null ? null : (
                      <div key={`${row.account.key}-${alt.fee.productId}`}>
                        <p className="py-[var(--sp-3)] px-[var(--sp-4)] border border-line rounded-sm bg-surface-2 leading-[1.5]">
                          {c.costs.tips.sentence({
                            label,
                            heldLabel: held,
                            currentFee: feeLabel(locale, cost.amount),
                            altProduct: alt.fee.product,
                            altFee: feeLabel(locale, alt.fee.amount),
                            saving: euro(locale, alt.savingPerYearCents),
                          })}
                        </p>
                        <p className="cell-sub">
                          {alt.conditional
                            ? c.costs.tips.conditionalNote(alt.fee.conditions ?? "")
                            : c.costs.tips.noConditionNote}
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
            <ToonMeer summary={c.costs.detailsToonMeer.summary}>
              <TableWrap>
                <Table cards>
                  <thead>
                    <tr>
                      {c.costs.detailsToonMeer.tableHeaders.map((h, i) => (
                        <Th key={h} numeric={i === 1 || i === 2}>
                          {h}
                        </Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {costRows.map((row) => {
                      const cost = row.cost;
                      const bank = row.account.bank || row.account.name;
                      const [rekeningH, kostenH, perJaarH, bronH] =
                        c.costs.detailsToonMeer.tableHeaders;
                      return (
                        <tr key={row.account.key}>
                          <Td data-label={rekeningH}>
                            <div style={{ fontWeight: 600 }}>{bank}</div>
                            <div className="cell-sub">{row.account.name}</div>
                          </Td>
                          <Td numeric data-label={kostenH}>
                            {cost.kind === "known"
                              ? feeLabel(locale, cost.amount)
                              : c.costs.detailsToonMeer.unknownCost}
                          </Td>
                          {/* "niet in het totaal" in plaats van een streepje: een em
                              dash naast euro's leest als nul, en dit is het enige
                              veld waar de lezer kan zien wat er met een onbekende
                              gebeurt. */}
                          <Td numeric data-label={perJaarH}>
                            {cost.kind === "known" ? (
                              <>
                                {euro(locale, cost.amount.perYearCents)}
                                {cost.amount.perYearDerived && (
                                  <div className="cell-sub">
                                    12 × {euro(locale, cost.amount.cents)}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span className="cell-sub">{c.costs.detailsToonMeer.notInTotal}</span>
                            )}
                          </Td>
                          <Td data-label={bronH} className="cell-sub">
                            {cost.kind === "known" ? (
                              <>
                                <div>
                                  {cost.matchedBy === "product-name"
                                    ? cost.fee.product
                                    : c.costs.detailsToonMeer.sameFeeNote(cost.agreeing.length)}
                                </div>
                                <div>
                                  {sourceHost(cost.sourceUrl)} · peildatum {cost.asOf}
                                </div>
                                {/* Bij een bedrag dat geld KOST is de prijs het
                                    nieuws en de voorwaarde de onderbouwing, dus die
                                    mag hier staan. Bij een nul niet: die staat
                                    vooraan, mét zijn eis — zie het blok bovenaan
                                    deze module. */}
                                {cost.conditions && cost.amount.cents > 0 && (
                                  <div>
                                    <strong>{c.costs.detailsToonMeer.conditionLabel}</strong>{" "}
                                    {cost.conditions}
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
                                      {c.costs.detailsToonMeer.candidatesHeading(
                                        row.candidates.length,
                                        bank,
                                      )}
                                    </div>
                                    <ul style={{ margin: ".35rem 0 0", paddingLeft: "1.1rem" }}>
                                      {row.candidates.map((f) => (
                                        <li key={f.productId}>
                                          {f.product} — {feeLabel(locale, f.amount)}{" "}
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
                                      {c.costs.detailsToonMeer.matchHint}
                                    </div>
                                  </>
                                ) : (
                                  <span>{c.costs.detailsToonMeer.noSource}</span>
                                )}
                              </>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>

              {/* De volledige vindplaats van elk bedrag dat vooraan meetelt, plus
                  die van elke goedkopere optie die hierboven is aangeraden. Eén
                  lijst en niet drie plekken: de herkomst van een cijfer hoort bij
                  de herkomst van de andere cijfers te staan. */}
              {(costSources.length > 0 || costTips.length > 0) && (
                <div style={{ marginTop: "var(--sp-3)" }}>
                  <p style={{ margin: 0 }}>
                    <strong>{c.costs.detailsToonMeer.sourcesHeading}</strong>
                  </p>
                  <ul className="cell-sub" style={{ margin: ".35rem 0 0", paddingLeft: "1.1rem" }}>
                    {costSources.map((row) => {
                      const cost = row.cost;
                      if (cost.kind !== "known") return null;
                      return (
                        <li key={row.account.key}>
                          {c.costs.detailsToonMeer.sourceLine(
                            row.account.bank || row.account.name,
                            cost.sourceUrl,
                            cost.asOf,
                          )}
                        </li>
                      );
                    })}
                    {costTips.map((row) =>
                      [row.cheaperAtProvider, row.cheaperElsewhere].map((alt) =>
                        alt === null ? null : (
                          <li key={`alt-${row.account.key}-${alt.fee.productId}`}>
                            {c.costs.detailsToonMeer.altSourceLine(
                              alt.fee.product,
                              alt.fee.sourceUrl,
                              alt.fee.asOf,
                            )}
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
