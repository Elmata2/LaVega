import { useEffect, useMemo, useState } from "react";
import type { Account, Tx, AccountRate, CatalogueEntryLike, FeeAmount, LearnedFact, NetBasis, NetBenefit, OwnAccounts, RateBenchmark, Rule } from "@lavega/core";
import {
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
import Module from "../components/Module";
import ModuleGrid from "../components/ModuleGrid";
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
  const totalMonthlyCents = useMemo(() => subs.reduce((s, x) => s + x.monthlyCents, 0), [subs]);
  const seen = useMemo(() => outflowFacts(txs), [txs]);

  // Why a subscription can be MISSING. His Simeo is the case: a charge that
  // repeats every three months cannot be recognised in two months of statements,
  // no matter how the detector is tuned. Core measures which cadences the data
  // can carry at all (`subscriptionCoverage`) — this view only says it out loud,
  // so an empty list is a stated limit rather than a shrug.
  const coverage = useMemo(() => subscriptionCoverage(txs), [txs]);
  const cadenceName = (days: number) => CADENCE_LABEL_NL[days] ?? `elke ${days} dagen`;

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
          <div className="eyebrow">{euro(totalMonthlyCents)}/mnd</div>
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
          footer={
            subs.length > 0 ? (
              <span>
                {subs.length} {subs.length === 1 ? "abonnement" : "abonnementen"} · samen {euro(totalMonthlyCents)} per
                maand, {euro(totalMonthlyCents * 12)} per jaar.
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
                <li>minstens twee betalingen aan dezelfde ontvanger;</li>
                <li>een vast ritme: ongeveer maandelijks, per kwartaal of jaarlijks;</li>
                <li>een bedrag dat mag stijgen (dat is juist het signaal) maar niet wild springt;</li>
                <li>geen eigen overboeking of kaartafrekening.</li>
              </ul>
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
                  {increases.map((p) => (
                    <p key={`inc-${p.sub.key}`} className="reason">
                      <strong>{p.sub.name}</strong> ging van {euro(p.fromCents)} naar {euro(p.toCents)} (+
                      {Math.round(p.changePct * 100)}%) — dat is{" "}
                      <span className="reason-figure text-warn">{euro((p.toCents - p.fromCents) * 12)}</span> per jaar
                      extra.
                    </p>
                  ))}
                  {overlaps.map((o) => (
                    <p key={`ov-${o.function}`} className="reason">
                      {o.subs.length} × <strong>{o.function}</strong>: {o.subs.map((s) => s.name).join(" + ")} — samen{" "}
                      {euro(o.monthlyCents)}/mnd. Eén opzeggen scheelt tot{" "}
                      <span className="reason-figure text-warn">
                        {euro(Math.max(...o.subs.map((s) => s.monthlyCents)) * 12)}
                      </span>{" "}
                      per jaar.
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="table-wrap table-cards">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Dienst</th>
                      <th>Functie</th>
                      <th className="num">Per maand</th>
                      <th className="num">Per jaar</th>
                      <th className="num">Verandering</th>
                      <th>Laatst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subs.map((s) => (
                      <tr key={s.key}>
                        <td data-label="Dienst" style={{ fontWeight: 600 }}>{s.name}</td>
                        <td data-label="Functie">
                          <span className="badge">{s.function}</span>
                        </td>
                        <td className="num" data-label="Per maand">{euro(s.monthlyCents)}</td>
                        <td className="num" data-label="Per jaar">{euro(s.monthlyCents * 12)}</td>
                        <td data-label="Verandering" className={`num ${s.changePct > 0 ? "text-neg" : s.changePct < 0 ? "text-pos" : ""}`}>
                          {s.changePct === 0 ? "—" : `${s.changePct > 0 ? "+" : ""}${Math.round(s.changePct * 100)}%`}
                        </td>
                        <td className="cell-sub" data-label="Laatst">{s.lastDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

        {/* ── Cashback: de rentemodule's vorm, op wat je uitgeeft ─────────── *
            Three beats, the same three the Rente module has: what you get now,
            what the best one we can PROVE gives, and the difference in euros on
            a base he recognises. His ask: "this could be cashback that you do
            not have ... what you would basically get back if you had used that
            card. Give the user a bit more fuel." */}
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
              wél kosten staat in de module "Wat je rekeningen kosten". */}
          {routing.map((a) => {
            const base = spendOf.get(a.from.key);
            return (
              <div className="reason-list" key={a.from.key + a.to.key}>
                <div className="position-row">
                  <span>
                    Betaal met <strong>{a.to.bank}</strong> in plaats van {a.from.bank} — {pct(a.toPct)} tegen{" "}
                    {pct(a.fromPct)}.
                  </span>
                  <span className="text-pos">
                    {a.approximate ? "tot " : ""}
                    {euro(a.gainPerYearCents)} per jaar
                  </span>
                </div>
                {/* Where the euros come from. "tot" is not a hedge for its own
                    sake: on a betaalrekening the base still has rent and
                    incasso's inside it, so the figure is the most it could be
                    and the sentence has to say why. */}
                <p className="cell-sub">
                  Gerekend over {a.approximate ? "maximaal " : ""}
                  {euro(a.baseCents)} aan uitgaven per jaar
                  {base ? `, gemeten over ${base.observedDays} dagen afschrift` : ""}.
                  {a.approximate &&
                    " Je bank zegt er niet bij of een afschrijving een kaartbetaling of een incasso was — huur en incasso's zitten er dus nog in."}
                </p>
              </div>
            );
          })}

          {cashbackUpgrade && cashbackNet && monthlyBaseCents !== null && bestHeldCashback !== null ? (
            <div className="reason-list" style={{ marginTop: routing.length > 0 ? "var(--sp-4)" : undefined }}>
              {/* BOTH ROWS ARE THE SAME EUROS ON A DIFFERENT CARD. Deliberately
                  NOT "wat je nu terugkrijgt": his best own rate is 1,5% but his
                  spending sits on the 0% pas, so the first row is what that card
                  WOULD return on this base — a rate comparison, not a statement
                  about what lands on his account. Labelling it as income he
                  already gets would be a number he can check and find wrong. */}
              <div className="position-row" data-testid="cashback-nu">
                <span>
                  <strong>Op je beste eigen kaart</strong> — {pct(bestHeldCashback)}
                  {/* DE HARDHEID STAAT OP DEZELFDE REGEL ALS HET GETAL, niet in
                      een voetnoot en niet in een comment. Dit is de hele
                      voorzorg: een aangenomen nul die er precies zo uitziet als
                      een gemeten nul is de valse nul waar dit project al een keer
                      op stukliep. */}
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
                  kaart van € 16,90 per maand kost € 202,80. De aftrek staat in de
                  twee regels hieronder, in deze volgorde: bruto, kosten, netto. */}
              <div className="position-row" data-testid="cashback-verschil">
                <span>
                  <strong>Verschil</strong> — wat dezelfde uitgaven daar extra opleveren, vóór kaartkosten
                </span>
                <span className="text-pos">
                  {euro(Math.round(cashbackUpgrade.extraPerYearCents / 12))} per maand ·{" "}
                  {euro(cashbackUpgrade.extraPerYearCents)} per jaar
                </span>
              </div>

              {/* WAT DE KAART ZELF KOST, in de drie toestanden die er echt zijn.
                  Dezelfde component en dezelfde zinnen als de Rente-module
                  hieronder en als het reisblok — één gat, één verhaal. */}
              <Productkosten
                net={cashbackNet}
                id="cashback"
                noun="kaart"
                gainWord="meer cashback"
                costWord="kaartkosten"
                unknownTail="Bij de kaarten die de catalogus wél prijst, staat dat bedrag onder “Wat je rekeningen kosten”."
              />
              {/* The base, and how it was measured, so the figure can be redone
                  against the same afschrift instead of taken on trust. Two
                  paragraphs: the number first, then what it does and does not
                  claim — one block held all of it and read as fine print. */}
              <p className="cell-sub" data-testid="cashback-basis">
                Gerekend over {baseIsUpperBound ? "maximaal " : ""}
                {euro(monthlyBaseCents)} aan kaartuitgaven <strong>gemiddeld per maand</strong>, gemeten over{" "}
                {baseObservedDays} dagen afschrift.
              </p>

              {/* ── ÉÉN ECHTE MAAND, met zijn drie vragen erin (punt 23) ────────
                  Samenvatting in de kop, onderbouwing eronder — dat is het thema
                  van deze hele review: "the usual should be just the graphs and
                  the numbers, and all the text below it should be a show more."
                  Zijn antwoord staat dus al in de samenvattingsregel; wie het wil
                  nakijken klapt hem open. */}
              {lastMonthCompare && (
                <details className="cell-sub" data-testid="cashback-vorige-maand">
                  <summary>
                    <strong>Vorige volle maand ({monthLabelNL(lastMonthCompare.ym)})</strong> —{" "}
                    {euro(lastMonthCompare.spentCents)} uitgegeven,{" "}
                    {euro(lastMonthCompare.bestCents - lastMonthCompare.ownCents)} meer cashback op{" "}
                    {cashbackUpgrade.best.bank || cashbackUpgrade.best.product}
                  </summary>
                  <div className="reason-list" style={{ marginTop: ".35rem" }}>
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
                        als het jaarblok hierboven. Het verschil zit alleen in de
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
                  </div>
                  <p style={{ margin: ".35rem 0 0" }}>
                    Dit is de laatste maand die je import van begin tot eind dekt. Eén maand is één steekproef, dus
                    de aanbeveling hierboven staat op het maandgemiddelde en niet op deze maand — dit getal is de
                    controle die je tegen je eigen herinnering kunt houden.
                  </p>
                </details>
              )}
              <p className="cell-sub">
                Beide regels hierboven zijn dezelfde uitgaven op een andere kaart — een vergelijking van tarieven, niet
                wat er vandaag op je rekening komt. Het verschil is daarom minstens dit: wat nu op een kaart met minder
                cashback staat, levert nog meer op.
                {baseIsUpperBound &&
                  " Je bank zegt er niet bij of een afschrijving een kaartbetaling of een incasso was, dus huur en incasso's zitten nog in die basis — vandaar \"maximaal\"."}
              </p>
              {/* THE GATE, IF THERE IS ONE, IN FULL. A 5% card behind a staking
                  tier is not a 5% card for him, so the euro figure above cannot
                  stand without its conditions. It was truncated at first, and
                  that was worse than not showing it: the Obsidian text names its
                  tier gate near the END, so the clamp cut off the only part that
                  mattered. Full text, collapsed — nothing hidden, nothing
                  shouted. */}
              {cashbackUpgrade.best.conditions && (
                <details className="cell-sub">
                  <summary>Aan dit tarief hangen voorwaarden — lees ze voordat je hierop rekent.</summary>
                  <p style={{ margin: ".35rem 0 0" }}>{cashbackUpgrade.best.conditions}</p>
                  <p style={{ margin: ".35rem 0 0" }}>Bron: {cashbackUpgrade.best.sourceUrl}</p>
                </details>
              )}
              {allOffersAlt && (
                <p className="cell-sub">
                  <strong>Geen gewone bankkaart</strong> in de catalogus heeft een aantoonbaar cashbackpercentage —
                  alle {cashbackOffers.length} die we kunnen onderbouwen zijn prepaid- of cryptokaarten. Dat is wat de
                  bronnen zeggen, niet een keuze van LaVega.
                </p>
              )}
            </div>
          ) : (
            /* WHY THERE IS NO FIGURE, in the order the reasons actually apply.
               Each names the half that is missing; none of them concludes that
               he is already in the best place, because an absence of a
               comparison is not a comparison. */
            <p className="block-empty" style={{ marginTop: routing.length > 0 ? "var(--sp-4)" : undefined }}>
              {spendable.length === 0
                ? "Nog geen betaalrekening of creditcard in beeld — er is dus nog niets om mee te vergelijken."
                : bestHeldCashback === null
                  ? /* WAAROM DE AANNAME HIER NIET GELDT, en niet alleen dat er iets
                       ontbreekt. Deze tak haalt het sinds review 4 alleen nog bij
                       kaarten die buiten de aanname vallen — een prepaidkaart, een
                       Amex, een neobank — of als hij de aanname zelf heeft
                       uitgezet. De lijst eronder noemt per kaart welke van die
                       redenen het is. */
                    "Wat dit jou zou opleveren weet LaVega nog niet: bij deze kaarten mag er geen nul worden aangenomen, en zonder die helft is er geen verschil te berekenen. Hieronder staat per kaart waarom."
                  : monthlyBaseCents === null
                    ? `LaVega kent de cashback van je kaarten, maar heeft nog te weinig afschrift om te zien wat je ermee uitgeeft (minimaal ${MIN_SPEND_DAYS} dagen). Zonder die basis is er een percentage, maar geen bedrag.`
                    : cashbackOffers.length === 0
                      ? "Geen enkele kaart in de catalogus heeft een aantoonbaar cashbackpercentage — er is dus niets om je eigen kaart tegen af te zetten."
                      : "Je beste kaart nu doet het even goed of beter — er is niets te winnen."}
            </p>
          )}

          {/* ── WAT WE VAN ELKE EIGEN KAART WETEN, en hoe hard ─────────────────
              Achter "toon meer", want de samenvatting hierboven is het antwoord
              en dit is de onderbouwing (review 4, het thema van de hele ronde).
              Maar het STAAT er, per kaart, met het woord "aangenomen" voluit —
              dat is de prijs van een aanname: hij mag, mits hij overal te vinden
              is. */}
          {heldCashback.length > 0 && (
            <details className="cell-sub" data-testid="cashback-kaarten" style={{ marginTop: ".75rem" }}>
              <summary>Waar het percentage van elk van je {heldCashback.length === 1 ? "kaart" : "kaarten"} vandaan komt</summary>
              <ul style={{ margin: ".35rem 0 0", paddingLeft: "1.1rem" }}>
                {heldCashback.map((h) => (
                  <li key={h.account.key}>
                    {/* Eén zin, uit core. De vier takken stonden hier ooit als
                        vier stukjes JSX, en Profiel zei bijna dezelfde vier
                        dingen net iets anders — zie `describeHeldCashback`. */}
                    <strong>{h.product}</strong> — {describeHeldCashback(h.k)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* The rest of the field, without repeating the card named above — four
              Crypto.com tiers under a Crypto.com headline was the module talking
              to itself. */}
          {otherOffers.length > 0 && (
            <div className="opt-row" style={{ marginTop: ".75rem" }}>
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

          {openCashbackGaps.length > 0 && (
            <p className="cell-sub" data-testid="cashback-open">
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
            {/* HET TOTAAL, MET HET GAT ERIN BENOEMD. Core levert drie varianten en
                dit zijn ze alle drie: een som met onbekende rekeningen erin is
                geen totaal, en zonder één bekend tarief is er niets om op te
                tellen. */}
            {costs.total.kind === "complete" && (
              <p className="reason-lead">
                Je betaalt <strong>{euro(costs.total.perYearCents)}</strong> per jaar om deze{" "}
                {costs.total.accounts} {costs.total.accounts === 1 ? "rekening" : "rekeningen"} aan te houden.
              </p>
            )}
            {costs.total.kind === "incomplete" && (
              <p className="reason-lead">
                Van {costs.total.known} van je {costs.total.known + costs.total.unknown} rekeningen staat het
                tarief vast: samen <strong>{euro(costs.total.knownPerYearCents)}</strong> per jaar. De andere{" "}
                {costs.total.unknown} {costs.total.unknown === 1 ? "rekening telt" : "rekeningen tellen"} niet
                als nul mee, dus dit bedrag is een ondergrens.
              </p>
            )}
            {costs.total.kind === "none" && (
              <p className="reason">
                Van geen van deze rekeningen staat het tarief vast, dus er is geen totaal. Wat de catalogus bij
                deze banken wél weet, staat hieronder.
              </p>
            )}

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
                              {/* EEN NUL DRAAGT ZIJN EIS IN DE OPEN LUCHT (review 4,
                                  punt 24). Zijn ING is een studentenrekening en die
                                  is gratis — maar "€ 0,00 per maand" met de
                                  leeftijdseis achter een dichtgeklapte
                                  "voorwaarden" is een gratis-melding zonder de eis
                                  erbij, en dat is misleidend zodra hij dertig
                                  wordt. Elke studentenrekening in dit land staat
                                  letterlijk op € 0,00 in het wettelijk verplichte
                                  kostendocument, mét een leeftijds- of
                                  studievoorwaarde ernaast; die twee horen bij
                                  elkaar. Bij een bedrag dat wél geld kost blijft de
                                  voorwaarde opgevouwen — daar is de prijs het
                                  nieuws en de voorwaarde de onderbouwing. */}
                              {c.conditions &&
                                (c.amount.cents === 0 ? (
                                  <div data-testid={`kosten-gratis-${row.account.key}`}>
                                    <strong>Gratis, mits:</strong> {c.conditions}
                                  </div>
                                ) : (
                                  <details>
                                    <summary>voorwaarden</summary>
                                    <p style={{ margin: ".35rem 0 0" }}>{c.conditions}</p>
                                  </details>
                                ))}
                            </>
                          ) : (
                            <>
                              <div>
                                {/* Drie oorzaken, drie zinnen. De derde hangt aan
                                    wat er te tonen is: bij Trading 212 kent de
                                    catalogus alleen een kaarttarief en niets voor
                                    een betaalrekening, en "we weten niet welk
                                    product dit is" boven een lege lijst is een
                                    melding die zijn eigen oorzaak niet noemt. */}
                                {c.reason === "no-bank"
                                  ? "Deze rekening draagt geen banknaam, dus er valt niets op te zoeken."
                                  : c.reason === "provider-unknown"
                                    ? `LaVega kent geen tarief van ${bank}.`
                                    : row.candidates.length === 0
                                      ? `Bij ${bank} kent LaVega geen tarief voor dit soort rekening.`
                                      : `LaVega kent de tarieven van ${bank}, maar niet welk van deze producten dit is.`}
                              </div>
                              {/* ── DE GRATIS PRODUCTEN, VOORAAN EN MET HUN EIS ────
                                  Review 4, punt 24: "ING is bij hem een
                                  studentenrekening — hij betaalt niets. Dat moet
                                  vindbaar zijn." Vindbaar betekent niet "staat in
                                  de lijst van negen ING-pakketten achter een
                                  dichtgeklapt driehoekje"; het betekent dat je het
                                  ziet zonder te zoeken. Dus komt de nul naar
                                  voren.

                                  EN NOOIT ZONDER DE EIS. Elke studentenrekening in
                                  dit land staat op € 0,00 in het wettelijk
                                  verplichte kostendocument, met een leeftijds- of
                                  studievoorwaarde erbij ("Alleen voor
                                  rekeninghouders van 18 tot 30 jaar"). Zonder die
                                  zin is dit een gratis-melding die over twee jaar
                                  niet meer klopt en die LaVega hem nooit heeft
                                  verteld. Noemt de bron geen voorwaarde, dan staat
                                  DAT er — een leeg veld zou als "geldt voor
                                  iedereen" lezen. */}
                              {row.candidates.some((f) => f.amount.cents === 0) && (
                                <div data-testid={`gratis-bij-${row.account.key}`} style={{ marginTop: ".35rem" }}>
                                  <strong>Gratis bij {bank}:</strong>
                                  <ul style={{ margin: ".2rem 0 0", paddingLeft: "1.1rem" }}>
                                    {row.candidates
                                      .filter((f) => f.amount.cents === 0)
                                      .map((f) => (
                                        <li key={f.productId}>
                                          {f.product} — {feeLabel(f.amount)}.{" "}
                                          {f.conditions ?? "De bron noemt hierbij geen voorwaarde."}{" "}
                                          <span style={{ opacity: 0.7 }}>
                                            ({sourceHost(f.sourceUrl)}, peildatum {f.asOf})
                                          </span>
                                        </li>
                                      ))}
                                  </ul>
                                  <p style={{ margin: ".2rem 0 0" }}>
                                    Is dit jouw rekening? Zet die naam bij Rekeningen in het veld <strong>Naam</strong>,
                                    dan rekent LaVega er met € 0,00 voor.
                                  </p>
                                </div>
                              )}
                              {/* Wat er WEL is, en de enige stap die dit echt
                                  oplost: de naam van een rekening bepaalt of
                                  LaVega het pakket herkent, en die naam is bij
                                  Rekeningen aan te passen. Dat staat er alleen
                                  als er ook pakketten zijn om uit te kiezen —
                                  anders is het advies dat in deze toestand niet
                                  kan werken. */}
                              {row.candidates.length > 0 && (
                                <details>
                                  <summary>
                                    {row.candidates.length}{" "}
                                    {row.candidates.length === 1 ? "tarief" : "tarieven"} bij {bank}
                                  </summary>
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
                                  <p style={{ margin: ".35rem 0 0" }}>
                                    Weet je welk het is? Zet die naam bij Rekeningen in het veld{" "}
                                    <strong>Naam</strong> — dan rekent LaVega met dat tarief.
                                  </p>
                                </details>
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

            {/* WAAR HET LOONT — en nooit zonder de voorwaarde. Een
                studentenrekening is gratis áls je student bent; LaVega weet niet
                hoe oud je bent, dus het bedrag komt er met de zin uit de bron
                naast te staan en niet als een gedane zaak. Pakketten die de bron
                zelf "niet meer te openen" noemt komen hier per constructie niet
                in voor. */}
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
                            : "De bron noemt hierbij geen voorwaarde."}{" "}
                          ({sourceHost(alt.fee.sourceUrl)}, peildatum {alt.fee.asOf})
                        </p>
                      </div>
                    ),
                  );
                })}
              </div>
            )}

            {costSources.length > 0 && (
              <details className="rates-benchmark">
                <summary className="eyebrow">Waar deze bedragen vandaan komen</summary>
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
                </ul>
              </details>
            )}
          </Module>
        )}
      </ModuleGrid>
    </>
  );
}
