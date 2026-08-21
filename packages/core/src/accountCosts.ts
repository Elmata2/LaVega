/* WAT HET KOST OM TE HOUDEN WAT JE AL HEBT.
 *
 * Elke andere module op Optimalisatie rekent aan wat geld OPLEVERT — rente,
 * cashback, een abonnement dat je kunt opzeggen. Deze rekent aan de kant die
 * gewoon doorloopt: de vaste maand- of jaarprijs van een betaalpakket, een
 * betaalrekening of een creditcard. De zoekronde van 21 augustus 2026 vond er
 * 105, waarvan 26 een uitgesproken nul (elke studentenrekening in dit land staat
 * letterlijk op € 0,00 in het wettelijk verplichte kostendocument).
 *
 * DRIE DINGEN LIGGEN HIER VAST, en elk daarvan is elders al een keer misgegaan:
 *
 *  1. NUL EN ONBEKEND ZIJN NIET HETZELFDE, en het verschil staat in het TYPE.
 *     Een studentenrekening die zijn eigen document op "gratis" zet is een
 *     BEKENDE nul: gemeten, met bron en datum, en hij telt gewoon mee in een
 *     totaal. Een pakket waarvan we de prijs niet kennen is
 *     `{ kind: "unknown" }` — een variant zonder bedrag, dus per constructie
 *     onmogelijk als nul in een som te laten belanden. Dat is precies waarom het
 *     een unie is en geen `cents: number | null`: dat laatste nodigt uit tot
 *     `?? 0`.
 *
 *  2. ER WORDT NERGENS STIL OMGEREKEND. ING rekent per maand, ICS per jaar, en
 *     American Express noemt zelfs de Platinum per maand. Het bedrag houdt de
 *     eenheid van zijn eigen document (`amount.period`); het jaarbedrag staat
 *     ERNAAST met `perYearDerived` erbij, zodat het scherm "€ 4,00 per maand ·
 *     12 × = € 48,00 per jaar" kan zeggen in plaats van een jaarprijs te tonen
 *     die in geen enkel document staat.
 *
 *  3. EEN TOTAAL MET EEN GAT ERIN ZEGT DAT HET EEN GAT HEEFT. `AccountCostTotal`
 *     is een unie met per variant een ANDERE veldnaam, zodat een lezer die
 *     `total.perYearCents` schrijft zonder na te denken een typefout krijgt in
 *     plaats van een som waar de onbekende rekeningen stilzwijgend als nul in
 *     zitten.
 *
 * Puur, zoals alles in packages/core: geen fetch, geen klok. De peildatum die
 * telt is de datum die het BRONDOCUMENT noemt, en die reist mee in `asOf`.
 */
import type { Account } from "./model.js";
import { accountType } from "./balance.js";
import { bankNameMatches } from "./bankNl.js";
import type { CatalogRoute, CatalogValue } from "./catalog.js";
import { isCovered } from "./catalog.js";

/** De eenheid die het document zelf hanteert. Nooit omgerekend achter de rug van
 *  de lezer om; zie de kop van dit bestand. */
export type FeePeriod = "maand" | "jaar";

/** Het bedrag zoals de bron het noemt, én hetzelfde bedrag per jaar. Twee velden
 *  in plaats van één, omdat de bron er maar één van de twee noemt. */
export type FeeAmount = {
  /** In centen, in de eenheid van `period`. Een uitgesproken nul is hier 0 — en
   *  0 hebben is iets heel anders dan geen FeeAmount hebben. */
  cents: number;
  period: FeePeriod;
  /** Hetzelfde bedrag per jaar, in centen. */
  perYearCents: number;
  /** true als `perYearCents` onze rekensom is (12 ×) en niet een getal dat in het
   *  document staat. Het scherm zet dat er zichtbaar bij. */
  perYearDerived: boolean;
};

/** Hoeveel maanden één factureringsperiode duurt. Staat hier, naast het type dat
 *  de periode draagt, zodat "een jaar is twaalf maanden" nergens anders nog een
 *  keer wordt opgeschreven — en zodat een derde eenheid (per kwartaal, en die
 *  bestaat bij zakelijke pakketten) op één plek bijkomt in plaats van in elke
 *  aanroeper. */
export const FEE_PERIOD_MONTHS: Record<FeePeriod, number> = { maand: 1, jaar: 12 };

/** Wat een vaste prijs kost over een horizon van `months` maanden.
 *
 *  HIER KOMEN EENMALIG EN TERUGKEREND BIJ ELKAAR, en dat is de stille fout die
 *  deze functie bestaat om te voorkomen. "€ 14 voordeel op een overboeking van
 *  € 1.000" is ÉÉN KEER; "€ 16,99 per maand" is ELKE MAAND. Die twee van elkaar
 *  aftrekken zonder te zeggen over welke periode levert 14 − 16,99 op, en dat
 *  getal betekent niets. Dus de periode is een parameter en het antwoord draagt
 *  hem terug mee.
 *
 *  ER WORDT NOOIT GEDEELD, alleen naar boven afgerond. Een jaarprijs van € 270
 *  wordt geen € 22,50 voor een maand reizen: dat bedrag staat in geen enkel
 *  document en je kunt geen twaalfde jaar kaart kopen. Wie een kaart opent
 *  betaalt minstens één hele periode, en `flooredToOnePeriod` is er zodat het
 *  scherm dat kan zeggen in plaats van dat de lezer het moet vermoeden. Om
 *  dezelfde reden naar boven: anderhalve maand op reis zijn twee maandnota's.
 *
 *  Toen dit nog gedeeld werd, kwam een jaarkaart van € 270 op een reis van een
 *  maand uit op € 22,50 en won hij van een maandkaart van € 25 — terwijl je bij
 *  de eerste € 270 kwijt was en bij de tweede € 25. */
export type FeeOverHorizon = {
  cents: number;
  periodsCharged: number;
  /** true als de horizon korter is dan één hele factureringsperiode, en er dus
   *  een volle periode is gerekend voor minder gebruik. Dat is geen detail: het
   *  is het verschil tussen een eerlijk en een te mooi bedrag. */
  flooredToOnePeriod: boolean;
};

export function feeCostOverMonths(amount: FeeAmount, months: number): FeeOverHorizon {
  const perPeriod = FEE_PERIOD_MONTHS[amount.period];
  // Een niet-eindige, negatieve of nul-horizon is geen horizon. Die valt op de
  // ondergrens terug in plaats van een NaN of een 0 door de rekensom te sturen —
  // een kostenpost die per ongeluk nul wordt is precies wat hier niet mag.
  const horizon = Number.isFinite(months) && months > 0 ? months : 0;
  const periodsCharged = Math.max(1, Math.ceil(horizon / perPeriod));
  return {
    cents: periodsCharged * amount.cents,
    periodsCharged,
    flooredToOnePeriod: horizon < perPeriod,
  };
}

/** Het catalogusveld, in de vorm van de bestaande velden (zie catalog.ts) plus de
 *  periode die een bedrag nu eenmaal nodig heeft en een percentage niet.
 *
 *  `route` mag null zijn: coverage — de gedeelde definitie van "bruikbaar" in
 *  `isCovered` — hangt aan waarde, bron, datum en voorwaarden, niet aan de route.
 *  Een rij zonder route draagt hem als null in plaats van dat we er een verzinnen.
 */
export type AccountFeeValue = {
  value: number;
  period: FeePeriod;
  route: CatalogRoute | null;
  sourceUrl: string;
  checkedAt: string;
  conditions: string | null;
  conditionsKnown: boolean;
};

/** Zo los mogelijk getypeerd, want dit leest een JSON-artefact dat een andere
 *  lane vult: `fields` is `unknown` per veld en wordt hieronder gevalideerd.
 *  `CatalogueEntryLike` uit catalogRates.ts past hier zonder cast in. */
export type AccountFeeEntryLike = {
  id: string;
  product: string;
  issuer?: string;
  kind?: string;
  fields?: Record<string, unknown>;
};

/** Welke soort product dit is, want een creditcardbijdrage vergelijken met een
 *  pakketprijs is twee verschillende dingen naast elkaar zetten. "betaalpakket"
 *  en "betaalrekening" zijn één groep: SNS noemt zijn Basis een pakket en ASN
 *  noemt hetzelfde ding een bankrekening. */
export type FeeGroup = "betaalrekening" | "creditcard" | "betaalpas" | "overig";

/** Eén geprijsd product uit de catalogus. */
export type ProductFee = {
  productId: string;
  product: string;
  /** De uitgever zoals de catalogus hem noemt ("International Card Services
   *  B.V."), niet per se de bank op de kaart — zie `namesSameProvider`. */
  issuer: string;
  kind: string;
  group: FeeGroup;
  amount: FeeAmount;
  /** null betekent dat de bron geen voorwaarde noemt. Het betekent NIET
   *  "onbekend": dat zit in `conditionsKnown`, en zonder dat komt een rij hier
   *  überhaupt niet doorheen. */
  conditions: string | null;
  /** false als de bron zelf zegt dat je dit niet meer kunt openen. Zulke
   *  producten worden nooit aangeraden — advies dat in de toestand van de lezer
   *  niet uitvoerbaar is, is geen advies. */
  openToNewCustomers: boolean;
  /** false als het bedrag niet de prijs van DIT product op zichzelf is. Zie
   *  `PRICE_NEEDS_ANOTHER_PRODUCT`. Het blijft een echte prijs voor wie het
   *  product heeft; het is alleen nooit een besparing voor wie het niet heeft. */
  pricedOnItsOwn: boolean;
  route: CatalogRoute | null;
  sourceUrl: string;
  /** De datum die het BRONDOCUMENT noemt. */
  asOf: string;
};

const FIELD = "accountFee";

/** DE EENHEID, of niets.
 *
 *  Leest `period` ("maand"/"jaar") en anders het `unit`-veld waarin de zoeklane
 *  het opschreef ("EUR per maand"). Staan ze er allebei niet, of noemen ze
 *  allebei iets — "€ 48,00 per jaar, dus € 4,00 per maand" — dan is er geen
 *  eenheid die we kunnen verdedigen en wordt de rij geweigerd. Een bedrag zonder
 *  eenheid stilzwijgend maandelijks noemen scheelt een factor twaalf. */
function readPeriod(raw: Record<string, unknown>): FeePeriod | null {
  const parts = [raw.period, raw.unit, raw.per].filter((x): x is string => typeof x === "string");
  const s = parts.join(" ").toLowerCase();
  const month = /maand|month/.test(s);
  const year = /jaar|year|annual/.test(s);
  if (month === year) return null;
  return month ? "maand" : "jaar";
}

/** Het catalogusveld van één rij, gevalideerd, of null.
 *
 *  Dezelfde poort als `savingsBenchmarks` gebruikt: `isCovered` — een waarde, een
 *  bron, een datum én vastgestelde voorwaarden, alle vier. Een bedrag waarvan de
 *  voorwaarden nooit zijn vastgesteld kan wel kloppen, maar niemand kan zeggen
 *  voor wie, en op dit scherm wordt eraan gerekend. */
export function readAccountFee(entry: AccountFeeEntryLike): AccountFeeValue | null {
  const raw = entry.fields?.[FIELD];
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const period = readPeriod(r);
  if (period === null) return null;
  if (typeof r.value !== "number" || !Number.isFinite(r.value) || r.value < 0) return null;

  const probe: CatalogValue = {
    value: r.value,
    // Alleen om `isCovered` te kunnen aanroepen; de route zelf gaat ongewijzigd
    // (of als null) verder naar de ProductFee hieronder.
    route: "agent",
    sourceUrl: typeof r.sourceUrl === "string" ? r.sourceUrl : "",
    checkedAt: typeof r.checkedAt === "string" ? r.checkedAt : "",
    conditions: typeof r.conditions === "string" && r.conditions.trim() !== "" ? r.conditions : null,
    conditionsKnown: r.conditionsKnown === true,
  };
  if (!isCovered(probe)) return null;

  return {
    value: probe.value,
    period,
    route: typeof r.route === "string" ? (r.route as CatalogRoute) : null,
    sourceUrl: probe.sourceUrl,
    checkedAt: probe.checkedAt,
    conditions: probe.conditions,
    conditionsKnown: true,
  };
}

/** Wat het document letterlijk zegt als een product niet meer te krijgen is. ING
 *  zet zijn BasisPakket, BetaalPakket en RoyaalPakket onder het kopje "Niet meer
 *  te openen betaalpakketten" en noemt in de voorwaarden "alleen voor bestaande
 *  klanten". Dat blijft een echte prijs voor wie het pakket heeft, en het is
 *  nooit een tip voor wie het niet heeft. */
const CLOSED_TO_NEW = /niet meer te openen|niet meer aan te vragen|niet meer verkrijgbaar|gesloten voor nieuwe klanten|alleen voor bestaande klanten/i;

/** HET BEDRAG IS DE PRIJS VAN IETS ANDERS.
 *
 *  Vijf vormen in de ronde van augustus 2026, en elk ervan zou een onwaar
 *  besparingsbedrag opleveren:
 *    - "Alleen binnen het ING Max-pakket (€ 44,99 per maand)" — de ING Creditcard
 *      Max kost € 0, bovenop een pakket van € 539,88 per jaar. Als tip zou dat
 *      "€ 30,60 per jaar goedkoper" zeggen tegen iemand die er € 500 bij koopt.
 *    - "Alleen bij het Studenten Pakket" / "Alleen bij een SNS Studentenrekening"
 *      / "Alleen aan te vragen met een ASN Studentenrekening" — een kaartprijs
 *      die aan een ander product hangt. Hetzelfde geldt voor de SNS Basis
 *      Privérekening: "alleen via een erkende hulpverleningsinstantie" is geen
 *      pakket dat je zomaar kunt kiezen.
 *    - "Nul geldt alleen bij een minimale besteding van € 3.000 per
 *      lidmaatschapsjaar" (Amex Blue Card) — en haal je die niet, dan staat het
 *      bedrag dat je wél betaalt nergens. Nul-of-onbekend is geen besparing.
 *    - "Prijs geldt bij ING Go" (ING Creditcard More en Extra) — de € 2,00 is de
 *      kaartprijs náást een pakket van € 4,00 per maand, dus als los alternatief
 *      voor een andere creditcard klopt hij niet.
 *    - "Bovenop de € 3,45 per maand van Rabo Standaard" — de RaboCard zegt het
 *      met zoveel woorden, en zegt het ook in zijn NAAM: "RaboCard of Rabo
 *      GoldCard bij Rabo Standaard". Vandaar dat de productnaam meegetoetst wordt;
 *      de drie producten in deze ronde met "bij" in hun naam zijn alle drie een
 *      kaart die aan een ander product hangt.
 *
 *  Bewust NIET op "inbegrepen": bunq schrijft "3 rekeningen inbegrepen", en dat
 *  gaat over wat er in dit product zit, niet over een product dat je erbij moet
 *  kopen. En bewust niet op "alleen voor": dat is een leeftijds- of
 *  lidmaatschapsgrens ("Alleen voor rekeninghouders van 18 tot 30 jaar"), en zo'n
 *  product mag juist wél worden aangeraden — met de voorwaarde erbij. */
const PRICE_NEEDS_ANOTHER_PRODUCT =
  /\balleen (binnen|bij|via|aan te vragen met) (het|een|de)\b|\bprijs geldt bij\b|\bbovenop de\b/i;

/** Is dit bedrag de prijs van dit product op zichzelf? Zie hierboven. */
function isPricedOnItsOwn(product: string, conditions: string | null): boolean {
  if (/\bbij\b/i.test(product)) return false;
  return conditions === null || !PRICE_NEEDS_ANOTHER_PRODUCT.test(conditions);
}

function feeGroup(kind: string | undefined): FeeGroup {
  const k = (kind ?? "").toLowerCase();
  if (k === "betaalpakket" || k === "betaalrekening") return "betaalrekening";
  if (k === "creditcard") return "creditcard";
  if (k === "betaalpas") return "betaalpas";
  return "overig";
}

function amountOf(v: AccountFeeValue): FeeAmount {
  const cents = Math.round(v.value * 100);
  return {
    cents,
    period: v.period,
    perYearCents: v.period === "maand" ? cents * 12 : cents,
    perYearDerived: v.period === "maand",
  };
}

/** Elke geprijsde rij uit de catalogus, goedkoopst per jaar eerst.
 *
 *  De volgorde is op het JAARBEDRAG omdat dat de enige noemer is waarop een
 *  maandpakket en een jaarkaart naast elkaar kunnen staan; het bedrag zelf houdt
 *  zijn eigen eenheid. Gelijke bedragen houden hun catalogusvolgorde (sort is
 *  stabiel), zodat een lijst niet herschikt tussen twee renders — dat leest als
 *  ruis. */
export function accountFees(entries: readonly AccountFeeEntryLike[]): ProductFee[] {
  const out: ProductFee[] = [];
  for (const e of entries) {
    const v = readAccountFee(e);
    if (v === null) continue;
    out.push({
      productId: e.id,
      product: e.product,
      issuer: e.issuer ?? "",
      kind: e.kind ?? "",
      group: feeGroup(e.kind),
      amount: amountOf(v),
      conditions: v.conditions,
      openToNewCustomers: !(v.conditions !== null && CLOSED_TO_NEW.test(v.conditions)),
      pricedOnItsOwn: isPricedOnItsOwn(e.product, v.conditions),
      route: v.route,
      sourceUrl: v.sourceUrl,
      asOf: v.checkedAt,
    });
  }
  return out.sort((a, b) => a.amount.perYearCents - b.amount.perYearCents);
}

/* ─────────────────────────────────────────── de rekening bij het product */

function words(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** GAAT DEZE CATALOGUSRIJ OVER DE BANK VAN DEZE REKENING?
 *
 *  Twee toetsen, en de tweede is niet optioneel: de ABN AMRO Credit Card wordt
 *  uitgegeven door International Card Services, net als de SNS-, ASN-,
 *  RegioBank- en ANWB-kaarten. Alleen op de uitgever matchen laat elke
 *  co-branded kaart ongeprijsd; alleen op de productnaam matchen laat American
 *  Express liggen, want die producten heten "The American Express Gold Card" en
 *  beginnen dus met "The".
 *
 *  De productnaam wordt woord voor woord opgebouwd ("Rabo", "Rabo Standaard") en
 *  elk voorloopstuk getoetst, omdat de catalogus de pakketten "Rabo …" noemt
 *  terwijl een import de bank "Rabobank" noemt — `bankNameMatches` herkent dat
 *  paar wel, "Rabo Standaard" tegen "Rabobank" niet. Nooit een losse substring:
 *  "Trading 212" bevat "ing", en dat heeft eerder al een ING-tarief op een
 *  Trading 212-saldo geplakt. */
function namesSameProvider(fee: ProductFee, bank: string): boolean {
  if (words(bank).length === 0) return false;
  if (fee.issuer && bankNameMatches(fee.issuer, bank)) return true;
  let run = "";
  for (const w of words(fee.product)) {
    run = run === "" ? w : `${run} ${w}`;
    if (bankNameMatches(run, bank)) return true;
  }
  return false;
}

function containsSequence(hay: readonly string[], needle: readonly string[]): boolean {
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** NOEMT DE REKENING HET PRODUCT ZELF? Dan is het geen gok maar de eigenaar die
 *  het al verteld heeft — dezelfde volgorde die `matchBankBenchmark` aanhoudt.
 *
 *  Op woordniveau, niet op tekst: "ING Go" mag niet aanslaan op "ING Gouden…".
 *  De haakjes gaan eruit ("Triodos Internet Betaalrekening (18 t/m 22 jaar)"),
 *  want dat is de leeftijdstrap en niet de naam die iemand intikt — en één woord
 *  is te weinig: "Free", "Go" en "Max" komen los in een rekeningnaam voor. */
function productNamedByAccount(account: Account, fee: ProductFee): boolean {
  const needle = words(fee.product.replace(/\([^)]*\)/g, " "));
  if (needle.length < 2) return false;
  return containsSequence(words(`${account.bank} ${account.name}`), needle);
}

/** Welke rekeningen kunnen hier überhaupt een pakketprijs hebben. Een spaar- of
 *  beleggingsrekening staat niet in de kostendocumenten die deze ronde vond, en
 *  "onbekend" printen bij iets waar we niet eens naar gezocht hebben is ruis. Dat
 *  het scherm alleen naar betaalrekeningen en creditcards kijkt, zegt het er
 *  zelf bij. */
function accountGroup(a: Account): FeeGroup | null {
  const t = accountType(a);
  if (t === "Creditcard") return "creditcard";
  if (t === "Betaalrekening") return "betaalrekening";
  return null;
}

/* ─────────────────────────────────────────── wat een rekening kost */

export type UnknownCostReason =
  /** De rekening draagt geen banknaam, dus er is niets om op te zoeken. */
  | "no-bank"
  /** De catalogus kent geen enkel geprijsd product bij deze aanbieder. */
  | "provider-unknown"
  /** De aanbieder staat er wél in, maar welk van zijn producten dit is valt niet
   *  vast te stellen — en ze kosten niet allemaal hetzelfde. */
  | "product-unknown";

type KnownCost = {
  kind: "known";
  amount: FeeAmount;
  conditions: string | null;
  sourceUrl: string;
  /** De datum die de bron noemt. Bij een consensus de OUDSTE van de rijen die het
   *  eens zijn: ze zijn het eens over het bedrag, niet over hoe recent iemand
   *  gekeken heeft, en de zwakste schakel is wat de lezer moet weten. */
  asOf: string;
};

export type AccountCost =
  | (KnownCost & { matchedBy: "product-name"; fee: ProductFee })
  | (KnownCost & { matchedBy: "provider-consensus"; agreeing: ProductFee[] })
  | { kind: "unknown"; reason: UnknownCostReason };

/** Een goedkoper product, met wat het scheelt en waar het aan vastzit. */
export type CostAlternative = {
  fee: ProductFee;
  /** Verschil in JAARBEDRAG, in centen. Altijd > 0, anders is het geen tip. */
  savingPerYearCents: number;
  /** true als de bron een voorwaarde noemt. Een studentenrekening is gratis áls
   *  je student bent, en LaVega weet niet hoe oud je bent — dus het scherm zet de
   *  voorwaarde erbij en presenteert dit nooit als een gedane zaak. */
  conditional: boolean;
};

export type AccountCostRow = {
  account: Account;
  cost: AccountCost;
  /** Wat de catalogus bij deze aanbieder wél weet, in dezelfde groep. Bij een
   *  onbekende rij is dit het eerlijke antwoord: niet "geen kosten", maar "dit
   *  zijn de pakketten die er zijn en dit kosten ze". */
  candidates: ProductFee[];
  /** Goedkoper bij dezelfde aanbieder — de makkelijkste stap: een pakket omzetten
   *  is geen bank overstappen. */
  cheaperAtProvider: CostAlternative | null;
  /** Goedkoper bij een ANDERE aanbieder. */
  cheaperElsewhere: CostAlternative | null;
};

/** Het totaal, met het gat erin benoemd. Elke variant heeft bewust een andere
 *  veldnaam voor het bedrag, zodat een som met gaten niet per ongeluk als hét
 *  totaal op het scherm komt. */
export type AccountCostTotal =
  | { kind: "none" }
  | { kind: "complete"; perYearCents: number; accounts: number }
  | { kind: "incomplete"; knownPerYearCents: number; known: number; unknown: number };

export type AccountCostReport = {
  rows: AccountCostRow[];
  total: AccountCostTotal;
  /** De hele geprijsde markt zoals de catalogus hem kent, goedkoopst eerst. */
  fees: ProductFee[];
};

/** ONDER DIT BEDRAG IS HET GEEN TIP. Een euro per maand, en de reden staat in de
 *  bronnen zelf: twee van de gevonden tarieven kondigen hun eigen verhoging al
 *  aan (ICS Gold + € 1,55 per 15 september 2026, ANWB + € 1,75 per 1 november
 *  2026). Een "besparing" van € 0,65 per jaar is kleiner dan een prijsstijging
 *  die al gedateerd in de bron staat — dat is geen advies, dat is ruis met een
 *  komma erin. De rentemodule hanteert om dezelfde reden MARGIN_PCT. */
export const MIN_SAVING_PER_YEAR_CENTS = 1200;

function cheapest(pool: readonly ProductFee[], currentPerYearCents: number): CostAlternative | null {
  // `accountFees` levert al goedkoopst-eerst, dus de eerste die genoeg scheelt is
  // ook de goedkoopste die genoeg scheelt.
  for (const fee of pool) {
    const saving = currentPerYearCents - fee.amount.perYearCents;
    if (saving >= MIN_SAVING_PER_YEAR_CENTS) {
      return { fee, savingPerYearCents: saving, conditional: fee.conditions !== null };
    }
  }
  return null;
}

/** WAT JE PER JAAR BETAALT OM TE HOUDEN WAT JE HEBT, per rekening.
 *
 *  Volgorde waarin een rekening aan een prijs komt, van hard naar zacht:
 *    1. de rekening noemt het product zelf ("ING Go") — dan is het geen gok;
 *    2. anders: alle producten van die aanbieder in dezelfde groep zijn het eens
 *       over bedrag én eenheid. Minstens twee, want één product is geen
 *       consensus maar gewoon dat ene product — dezelfde regel die
 *       `issuerConsensus` hanteert, en om dezelfde reden;
 *    3. anders onbekend, mét de pakketten die er bij die bank zijn, zodat de
 *       lezer ziet waar het aan ligt en het zelf kan oplossen (de naam van een
 *       rekening is aan te passen bij Rekeningen).
 */
export function accountCosts(
  accounts: readonly Account[],
  entries: readonly AccountFeeEntryLike[],
): AccountCostReport {
  const fees = accountFees(entries);
  const rows: AccountCostRow[] = [];

  for (const account of accounts) {
    const group = accountGroup(account);
    if (group === null) continue;

    const bank = String(account.bank ?? "").trim();
    const providerFees = bank === "" ? [] : fees.filter((f) => namesSameProvider(f, bank));
    const candidates = providerFees.filter((f) => f.group === group);

    const cost = resolveCost(account, bank, providerFees, candidates);
    const row: AccountCostRow = { account, cost, candidates, cheaperAtProvider: null, cheaperElsewhere: null };

    if (cost.kind === "known") {
      // Nooit het product aanraden dat hij al heeft, en nooit een product dat
      // niet meer te openen is.
      const held = new Set(cost.matchedBy === "product-name" ? [cost.fee.productId] : cost.agreeing.map((f) => f.productId));
      const pool = fees.filter(
        (f) => f.group === group && f.openToNewCustomers && f.pricedOnItsOwn && !held.has(f.productId),
      );
      const here = pool.filter((f) => namesSameProvider(f, bank));
      const elsewhere = pool.filter((f) => !namesSameProvider(f, bank));
      row.cheaperAtProvider = cheapest(here, cost.amount.perYearCents);
      const away = cheapest(elsewhere, cost.amount.perYearCents);
      // Van bank wisselen voor hetzelfde bedrag is geen besparing, het is werk.
      // Een tweede regel die net zoveel oplevert als de eerste leest bovendien
      // als twee adviezen waar er maar één is.
      row.cheaperElsewhere =
        away !== null && row.cheaperAtProvider !== null && away.savingPerYearCents <= row.cheaperAtProvider.savingPerYearCents
          ? null
          : away;
    }

    rows.push(row);
  }

  return { rows, total: totalOf(rows), fees };
}

function resolveCost(
  account: Account,
  bank: string,
  providerFees: readonly ProductFee[],
  candidates: readonly ProductFee[],
): AccountCost {
  if (bank === "") return { kind: "unknown", reason: "no-bank" };
  if (providerFees.length === 0) return { kind: "unknown", reason: "provider-unknown" };
  if (candidates.length === 0) return { kind: "unknown", reason: "product-unknown" };

  const named = candidates.filter((f) => productNamedByAccount(account, f));
  if (named.length === 1) {
    const fee = named[0];
    return {
      kind: "known",
      matchedBy: "product-name",
      fee,
      amount: fee.amount,
      conditions: fee.conditions,
      sourceUrl: fee.sourceUrl,
      asOf: fee.asOf,
    };
  }

  // Meerdere rijen die de rekening even goed beschrijven zijn geen match maar een
  // keuze — de vier Triodos-leeftijdstrappen heten alle vier "Triodos Internet
  // Betaalrekening". Dan telt alleen nog of ze het eens zijn over het bedrag.
  const pool = named.length > 1 ? named : candidates;
  const agreeing = agreementOf(pool);
  if (agreeing !== null) {
    const oldest = agreeing.reduce((a, b) => (a.asOf <= b.asOf ? a : b));
    return {
      kind: "known",
      matchedBy: "provider-consensus",
      agreeing,
      amount: agreeing[0].amount,
      // De voorwaarden verschillen per rij; welke van de rijen het is weten we
      // juist niet, dus er wordt er geen één als DE voorwaarde gepresenteerd.
      conditions: null,
      sourceUrl: oldest.sourceUrl,
      asOf: oldest.asOf,
    };
  }
  return { kind: "unknown", reason: "product-unknown" };
}

/** De rijen als ze het allemaal eens zijn over bedrag én eenheid, anders null.
 *  Minstens twee: één product is geen consensus. */
function agreementOf(pool: readonly ProductFee[]): ProductFee[] | null {
  if (pool.length < 2) return null;
  const first = pool[0].amount;
  const same = pool.every((f) => f.amount.cents === first.cents && f.amount.period === first.period);
  return same ? [...pool] : null;
}

function totalOf(rows: readonly AccountCostRow[]): AccountCostTotal {
  let perYearCents = 0;
  let known = 0;
  let unknown = 0;
  for (const r of rows) {
    if (r.cost.kind === "known") {
      perYearCents += r.cost.amount.perYearCents;
      known++;
    } else {
      unknown++;
    }
  }
  if (known === 0) return { kind: "none" };
  if (unknown === 0) return { kind: "complete", perYearCents, accounts: known };
  return { kind: "incomplete", knownPerYearCents: perYearCents, known, unknown };
}

/** Heeft dit rapport iets te zeggen? Een rij zonder bedrag én zonder pakketten om
 *  te tonen is een leeg blok, en de eigenaar heeft expliciet gevraagd die niet te
 *  renderen. Staat hier zodat het scherm dat niet zelf hoeft uit te rekenen — en
 *  zodat een test op de vraag kan drukken. */
export function hasCostsToShow(report: AccountCostReport): boolean {
  return report.rows.some((r) => r.cost.kind === "known" || r.candidates.length > 0);
}
