import type { Locale } from "../locale.js";
import { monthShort, formatEuroIn } from "../format.js";
import type { AlertBody } from "@lavega/core";

/**
 * Every string the money screens (Rekeningen, Transacties, Forecast, and the
 * homescreen blocks built from them) render, in both languages.
 *
 * Same shape as landingCopy.ts: one type, two values, so a string added to
 * Dutch and forgotten in English is a type error instead of a blank on
 * screen. Unlike the landing page, most of what these screens say is not a
 * fixed label but a sentence built at render time from a count, a date or an
 * amount — "3 rekeningen nog zonder saldo", "hoger dan 8 van je laatste 10
 * maanden". Those live here as FUNCTIONS of already-formatted primitives
 * (a number, a pre-formatted date string, a joined list) rather than as
 * plain strings: the branching that picks which sentence applies (singular
 * vs. plural, which of three refusals) stays in the component next to the
 * data it branches on, and this module supplies the words for each branch.
 *
 * Two things this file deliberately does NOT own:
 *
 *  - The Module title/aria-label for Aandacht, Positie, BTW and Facturen.
 *    `components/ModulePicker.test.tsx` (owned by another lane, not touched
 *    here) queries `section[aria-label="Aandacht"]` etc. directly, and
 *    Module.tsx (also not owned here) sets that aria-label from the same
 *    `title` prop that renders the visible heading — the two cannot be
 *    split without editing Module.tsx. Those four titles therefore stay the
 *    literal Dutch word in both locales; everything else in those four
 *    blocks is translated.
 *  - The "why" a category was excluded as moved money — `MOVED_CATEGORIES.why`
 *    in `components/blocks/statistics.ts`, a prose sentence ("een overboeking
 *    tussen je eigen rekeningen"), not owned here. It renders in Dutch in both
 *    locales until whichever lane owns that file localises it.
 */

/** "2026-07-31" -> "31 Jul" / "31 jul" — a day-of-month label with no year,
 *  for a chart axis or a list where the year is already established.
 *  Built from format.ts's own `monthShort` so both locales share one month
 *  table; this file adds only the day-number assembly. */
export function dayLabelIn(locale: Locale, iso: string): string {
  if (!iso) return "";
  const d = Number(iso.slice(8, 10));
  const month = monthShort(locale, iso);
  return month && d ? `${d} ${month}` : iso;
}

/** "9 jun 2026" — the day label with its year, for the places where the year
 *  is NOT already established by something next to it. */
export function dayLabelYearIn(locale: Locale, iso: string): string {
  return `${dayLabelIn(locale, iso)} ${iso.slice(0, 4)}`;
}

/** "1 jun – 16 aug 2026", or "12 nov 2025 – 16 aug 2026" across a year
 *  boundary — the window a figure covers, in the reader's language. */
export function rangeLabelIn(locale: Locale, start: string, end: string): string {
  const ys = start.slice(0, 4);
  const ye = end.slice(0, 4);
  return ys === ye
    ? `${dayLabelIn(locale, start)} – ${dayLabelIn(locale, end)} ${ye}`
    : `${dayLabelIn(locale, start)} ${ys} – ${dayLabelIn(locale, end)} ${ye}`;
}

/** "dag"/"week"/"maand" as they arrive from statistics.ts (not owned here)
 *  mapped to English. Dutch passes the token straight through. */
export function unitWordIn(locale: Locale, unit: string): string {
  if (locale === "nl") return unit;
  if (unit === "dag") return "day";
  if (unit === "week") return "week";
  if (unit === "maand") return "month";
  return unit;
}

/** `unitWordIn` pluralised by count — "2 weken"/"2 weeks", "1 maand"/"1 month".
 *  A plain "+en"/"+s" suffix gets "dag" and "maand" right but not "week"
 *  ("weeken" is not a word — the correct plural drops the doubled vowel), so
 *  Dutch goes through the same small lookup `unitPluralNL` (statistics.ts)
 *  uses rather than a generic rule. */
export function unitPluralIn(locale: Locale, unit: string, n: number): string {
  if (n === 1) return unitWordIn(locale, unit);
  if (locale === "nl") {
    if (unit === "dag") return "dagen";
    if (unit === "week") return "weken";
    if (unit === "maand") return "maanden";
    return `${unit}en`;
  }
  return `${unitWordIn(locale, unit)}s`;
}

type RekeningenCopy = {
  heading: string;
  weergaveGroepAria: string;
  perBank: string;
  alleRekeningen: string;
  ja: string;
  nee: string;
  hernoem: string;
  bankInvullen: string;
  bankPlaceholder: string;
  naamPlaceholder: string;
  klaar: string;
  bankNaam: string;
  type: string;
  entiteit: string;
  gekoppeld: string;
  openstaand: string;
  saldo: string;
  saldoOnbekendPlaceholder: string;
  schuld: string;
  nogGeenTransactiesGeimporteerd: string;
  verwijder: string;
  geenRekeningen: string;
  verbergen: string;
  rekeningTonen: string;
  rekeningenTonen: string;
  samenvoegen: string;
  saldoOnbekend: string;
  dagOnbekend: string;
  tabelBank: string;
  tabelType: string;
  tabelEntiteit: string;
  tabelSaldo: string;
  tabelTransacties: string;
  bankVanLabel: (naam: string) => string;
  naamVanLabel: (naam: string) => string;
  typeVanLabel: (naam: string) => string;
  entiteitVanLabel: (naam: string) => string;
  saldoVanLabel: (naam: string) => string;
  openstaandBedragVanLabel: (naam: string) => string;
  bekijkTransactiesVan: (naam: string) => string;
  rekeningWoord: (n: number) => string;
  transactieWoord: (n: number) => string;
  rekeningenBijBankAria: (bankLabel: string) => string;
  zonderBank: string;
  vanKnownVanTotal: (known: number, total: number) => string;
  transactiesBekijken: (n: number) => string;
  deleteQuestion: (naam: string, txCount: number) => string;
  dupBannerTitle: (labelsJoined: string) => string;
  dupBannerSubBefore: string;
  dupBannerSubAfter: string;
  samenvoegenLabel: (multi: boolean, dupLabel: string) => string;
  samenvoegenQuestion: (dupLabel: string, survivorLabel: string) => string;
  standVan: (date: string) => string;
  datumOnbekend: string;
  geenSaldo: string;
  saldoAgeDatedIntro: (date: string) => string;
  saldoAgeDatedLater: (laterDate: string) => string;
  saldoAgeDatedInvite: string;
  saldoAgeUndatedLinked: string;
  saldoAgeUndatedUnlinked: string;
  saldoAgeUndatedTx: (date: string) => string;
  saldoAgeUndatedInvite: string;
  saldoAgeNoneIntro: string;
  saldoAgeNoneTx: (date: string) => string;
  saldoAgeNoneInvite: string;
  gekoppeldOp: (date: string) => string;
  koppelmomentOnbekend: string;
  linkedNoteKnown: (date: string) => string;
  linkedNoteUnknown: string;
};

type TransactiesReasonCopy = { label: string; what: string };

type TransactiesCopy = {
  heading: string;
  reason: {
    buitenland: TransactiesReasonCopy;
    onbekendeTegenpartij: TransactiesReasonCopy;
    alleenNummers: TransactiesReasonCopy;
    geenTekst: TransactiesReasonCopy;
  };
  onbekendLabel: string;
  toonAlles: string;
  toonAlleenOnbekend: string;
  laatDeAiZeLezen: string;
  laatDeAiLezenAria: string;
  batchCountSuffix: (shown: number, total: number) => string;
  aiRouteUit: string;
  geenLeesbareTekst: string;
  consentBefore: string;
  consentStrong: string;
  consentAfter: string;
  aanzettenEnCategoriseren: string;
  annuleer: string;
  bezigMetCategoriseren: string;
  voorstellenCount: (n: number) => string;
  voorstellenRest: string;
  tegenpartij: string;
  omschrijving: string;
  bedrag: string;
  categorie: string;
  slaOver: string;
  toepassen: string;
  categorieVoor: (tegenpartij: string) => string;
  gecategoriseerdNote: (n: number) => string;
  nietsToegepast: string;
  categorisatieMislukt: string;
  opslaanMislukt: string;
  aiKonGeenIndelen: string;
  entiteitLabel: string;
  alleEntiteiten: string;
  rekeningLabel: string;
  alleRekeningen: string;
  categorieLabel: string;
  alleCategorieen: string;
  zoekenLabel: string;
  zoekenPlaceholder: string;
  van: string;
  tot: string;
  transactiesCount: (n: number) => string;
  geenTransacties: string;
  tableDatum: string;
  tableTegenpartij: string;
  tableOmschrijving: string;
  tableRekening: string;
  tableBedrag: string;
  tableEntiteit: string;
  tableCategorie: string;
};

type ForecastCopy = {
  tekortSignaleringAria: string;
  shortfallSentence: (date: string, balance: string, buffer: string) => string;
  unknownSentence: string;
  insufficientSentence: string;
  noneSentence: string;
  krapstePuntBanner: (week: number, closing: string, lowerSuffix: string, buffer: string) => string;
  lowerSuffix: (lower: string) => string;
  wellRisico: (date: string, balance: string, buffer: string) => string;
  geenLopendeStromenNote: string;
  positieOnbekendAlleenStromen: string;
  onvoldoendeDataGrafiek: string;
  verwacht: string;
  gemetenBandbreedte: string;
  bufferLabel: (n: string) => string;
  krapstePuntLegend: (week: number, closing: string) => string;
  cashflowForecastAria: string;
  cashflowForecastTitle: string;
  scopeLabelAlleBedrijven: string;
  driversAria: string;
  driversTitle: string;
  verwachteInkomsten: string;
  verwachteUitgaven: string;
  geenHerkendeInkomstenstromen: string;
  geenHerkendeUitgavenstromen: string;
  gestoptNietMeegeteld: string;
  laatst: (date: string) => string;
  nogGeenLopendeStromen: string;
  positieAsOfLabel: string;
  verwachteKaspositieAria: string;
  krapsteWeekLabel: string;
  krapsteWeekDetail: (week: number, balance: string) => string;
  positieOnbekendKort: string;
  onvoldoendeHistorieVoorPrognose: string;
  weekNLabel: (n: number) => string;
  bufferReferenceLabel: string;
  coverage: {
    confidence: { none: string; low: string; medium: string; high: string };
    noEvidence: string;
    flowsOnly: (n: number) => string;
    historyWindow: (days: number, from: string, to: string) => string;
    liveStreams: (n: number) => string;
    scheduledItems: (n: number) => string;
    basedOn: (parts: string) => string;
    accountsWithoutHistory: (missing: number, total: number) => string;
    shortAccount: (days: number) => string;
    noIncidental: string;
    noBand: string;
    flatBand: string;
    endedStreams: (names: string) => string;
    overdueFlows: (n: number, amount: string) => string;
    staleImport: (date: string, days: number) => string;
  };
};

type SaldoCopy = {
  /** De kop draagt het voorbehoud zelf: "deels" alleen zegt niet WAAROM, en
   *  dat was precies de vraag die het opriep. Het aantal niet-meegetelde
   *  rekeningen staat erbij, met de reden eronder in de kaart. */
  title: (excluded: number) => string;
  rekeningenArrow: string;
  rekeningenEntiteiten: (rekeningen: number, entiteiten: number) => string;
  beschikbaarNaBtw: (amount: string) => string;
  tOvVorigeWeek: string;
  importeerOfVulSaldos: string;
  rekeningNogZonderSaldo: (n: number) => string;
  compleetElkeRekeningHeeftSaldo: string;
  vreemdeValutaConvert: (n: number, names: string) => string;
  vreemdeValutaSeparate: (n: number, names: string) => string;
  omgerekendViaEcb: string;
  positiePerDagAria: string;
  positieOpReadout: string;
  geenTransactiesOpRekeningenMetSaldo: string;
  heeftNogGeenTransacties: (label: string) => string;
  pasNDagenTransactiegeschiedenis: (days: number, min: number) => string;
  vorigeWeek: string;
  vorigeMaand: string;
  nogGeenWeekGeschiedenis: string;
  nogGeenMaandGeschiedenis: string;
};

type PositieCopy = {
  rekeningenArrow: string;
  meerSuffix: (hidden: number) => string;
  bedrijfZonderCompleetSaldo: (n: number) => string;
  vreemdeValutaConvert: (n: number, names: string) => string;
  vreemdeValutaSeparate: (n: number, names: string) => string;
  omgerekendViaEcb: string;
  alleSaldosBekend: string;
  geenRekeningenMetEntiteit: string;
  verhoudingAria: string;
  onbekend: string;
};

type StatistiekCopy = {
  title: string;
  periodeAria: string;
  weergaveAria: string;
  begindatumAria: string;
  einddatumAria: string;
  periods: { value: string; label: string }[];
  views: { value: string; label: string }[];
  nogGeenTransactiesImporteer: string;
  nogGeenTransactieMetDatum: string;
  einddatumVoorBegindatum: string;
  kiesBegindatumEnEinddatum: string;
  gegevensVanaf: (date: string) => string;
  alleenKleineUitgaven: (n: number, small: string, threshold: string, days: number) => string;
  geenUitgavenLangerePeriodeOfImport: string;
  bekijkTransactiesIn: (categorie: string) => string;
  uitgavenPerCategoriePer: (unit: string) => string;
  /** A week bucket's axis title: "Week van 4 aug" / "Week of 4 Aug". */
  weekVan: (date: string) => string;
  /** Appended to `weekVan`/a month label when the window clips the bucket:
   *  "Week van 4 aug — alleen 4 aug t/m 6 aug" / "Week of 4 Aug — only 4 Aug
   *  to 6 Aug". Shared by the week and month bucket titles in statistics.ts —
   *  both say "the full bucket, but only this much of it is in view" in the
   *  same shape. */
  alleenTM: (start: string, end: string) => string;
  weggelatenPrefix: string;
  weggelatenMaanden: (n: number) => string;
  weggelatenKlein: (n: number) => string;
  weggelatenGecapt: (n: number) => string;
  nietGetoondMaanden: (list: string) => string;
  kleinereCategorieenNietGetoond: (
    n: number,
    range: string,
    small: string,
    threshold: string,
    days: number,
  ) => string;
  nogNCategorieenBuitenGrafiek: (n: number, list: string) => string;
  tegenoverEerdereMaanden: (month: string) => string;
  welkeDagenSummary: string;
  heleMaandNaast: (n: number) => string;
  deelmaandNaast: (range: string, days: number, n: number) => string;
  kortePeriodesTellenNiet: (n: number, days: number) => string;
  nogGeenVergelijkingGeenTx: (month: string) => string;
  volledigeMaandenCount: (n: number, month: string) => string;
  nogGeenVergelijkingTeWeinig: (month: string, countPhrase: string, min: number) => string;
  position: {
    geenGegevens: string;
    teWeinigGeschiedenis: string;
    nieuweCategorie: string;
    teKortBekend: (n: number) => string;
    geenVerschilZero: (n: number) => string;
    geenVerschilGelijk: (n: number) => string;
    hogerDanAl: (n: number) => string;
    lagerDanAl: (n: number) => string;
    hogerDanN: (higher: number, n: number) => string;
    lagerDanN: (lower: number, n: number) => string;
  };
  verdelingGeenUitgaven: string;
  gegroeidGeenNietsOmTeVergelijken: string;
  steegHetHardst: (delta: string, days: number) => string;
  pctDeel: (pct: number) => string;
  nieuwDeel: string;
  /** The "Overig" bucket SpendPie synthesizes for slices past its cap — not a
   *  stored category, so it lives here rather than in CATEGORY_LABELS. */
  overigCategorieLabel: string;
  nietsGestegen: (days: number) => string;
  verschilSeriesLabel: string;
  verschilAria: (days: number) => string;
  welkePeriodeSummary: string;
  vergelekenMet: (beforeStart: string, beforeEnd: string) => string;
  geenUitgavenOmWeekpatroon: string;
  pasNDagenGeschiedenisWeekdag: (days: number, min: number) => string;
  geenWeekdagSpringtEruit: string;
  kostGemiddeldSuffix: string;
  pctMeerDanGewoneDag: (pct: number) => string;
  gemiddeldeUitgavenPerWeekdagAria: string;
  gewoneDagLabel: string;
  waaropDitGemiddeldeRust: (days: number) => string;
  gemetenOverNDagen: (days: number) => string;
  buitenDezeCijfersGehouden: (amount: string) => string;
  movedRow: (amount: string, categorie: string, why: string, inAmountSuffix: string) => string;
  movedInSuffix: (inAmount: string) => string;
  movedFooter: string;
  buitenDezeCijfersConvert: (count: number, perCurrencyList: string) => string;
  buitenDezeCijfersSeparate: (count: number, perCurrencyList: string) => string;
  vreemdeValutaOmgerekend: string;
  inkomstenInDezePeriode: string;
  uitgavenInDezePeriode: string;
  gemiddeldPer: (amount: string, unit: string) => string;
  waaroverDezeTweeGemiddeldenGaan: (units: number, unitPlural: string) => string;
  gedeeldDoor: (units: number, unitPlural: string, range: string) => string;
  restDagenTellenNiet: (days: number, unit: string) => string;
  nietPerAskedUnit: (askedUnit: string, min: number) => string;
  gemiddeldeDagFallback: string;
  adviesLangerePeriode: string;
  adviesOudereAfschriften: string;
  geenGemiddeldeGeenTransacties: (advies: string) => string;
  geenGemiddeldeTeKortAfschrift: (coveredDays: number, min: number, advies: string) => string;
};

type AandachtCopy = {
  waarschuwOnderBuffer: string;
  waarschuwingsbufferAria: string;
  bufferZeroNote: string;
  nietsGevondenOmJeOpTeWijzen: string;
  lavegaKeekNaar: (checksJoined: string) => string;
  checks: [string, string, string, string, string];
  kritiek: string;
  letOp: string;
  terInfo: string;
  toonNTerInfo: (n: number) => string;
  /** The alert-centre sentence, built from the KIND `computeAlerts` (core)
   *  returns rather than from prose it carries — core owns no locale, so the
   *  view renders the sentence here. Exhaustive `switch (b.kind)`, no
   *  `default`: a new `AlertBody` variant is a compile error in both
   *  languages, not a silent blank on screen. */
  alert: { title: (b: AlertBody) => string; detail: (b: AlertBody) => string };
};

type KaartenCopy = {
  title: string;
  rekeningenArrow: string;
  geenRekeningenGekoppeld: string;
  onbekendeBank: string;
  geenIbanBekend: string;
  opNaamVan: string;
  geenEntiteitIngesteld: string;
  saldoLabel: string;
  onbekend: string;
  cardAria: (bank: string, type: string) => string;
};

type FacturenCopy = {
  facturenArrow: string;
  vanNFacturenBedragOnbekend: (n: number) => string;
  nietsStaatOpen: (total: number) => string;
  openstaand: string;
  geenEnkeleOpenstaandeFactuurOverVervaldatum: string;
  teOntvangen: string;
  teBetalen: string;
  bedragOnbekend: string;
  sideRowCount: (n: number) => string;
  lateSentence: (total: number, parts: string) => string;
  teOntvangenAmount: (amount: string) => string;
  teBetalenAmount: (amount: string) => string;
};

type BtwCopy = {
  /** The local tax name in Dutch, its English name in English. */
  title: string;
  belastingArrow: string;
  geenBedrag: string;
  direction: { betalen: string; terugvragen: string; onbekend: string };
  shortBasis: { manual: string; sheet: string; invoices: string; proxy: string };
  bronPrefix: (basis: string) => string;
  uiterlijk: (deadline: string) => string;
  looptNogTm: (end: string) => string;
  nogNAndereOnderneming: (n: number) => string;
  regelsPer: (date: string) => string;
  entiteitPrefix: (entiteit: string) => string;
  note: {
    geenFactuurEnkele: (entiteit: string) => string;
    geenFactuurMeerdere: (entiteit: string, buiten: number) => string;
    stelselOnbekend: (entiteit: string) => string;
    btwOnbekendOpFacturen: (missing: number, total: number) => string;
    gemengdeTarieven: string;
    kasstelsel: string;
    omzetfacturenOnbekend: string;
    voorbelastingOnbekend: string;
    boekhoudingAnderePeriode: string;
    geenBanktransacties: (entiteit: string) => string;
  };
};

type BankLinkCopy = {
  zakelijk: string;
  particulier: string;
  typeRekeningAria: string;
  ofKoppelJeBankDirect: string;
  laden: string;
  koppelBankEnableBanking: string;
  geenBankenBeschikbaar: string;
  doorsturen: string;
  autoriseer: string;
  bankkoppelingError: (message: string) => string;
  alleenLezenToegang: string;
  bankGeenAutorisatiepagina: string;
};

type BetaalschemaCopy = {
  title: string;
  status: { expected: string; confirmed: string; paid: string; cancelled: string };
  cadence: {
    wekelijks: string;
    elke2Weken: string;
    maandelijks: string;
    tweemaandelijks: string;
    elkKwartaal: string;
    halfjaarlijks: string;
    jaarlijks: string;
    elkeNDagen: (days: number) => string;
  };
  xGezien: (n: number) => string;
  datumAlVerstreken: (n: number) => string;
  regelVoorspeld: (n: number) => string;
  alleRegelsIngepland: string;
  nietsIngepland: string;
  voorspeldTag: string;
  teLaatSuffix: string;
};

type RecenteTransactiesCopy = {
  title: string;
  zoekPlaceholder: string;
  zoekenAria: string;
  bekijkAlles: string;
  nogGeenTransacties: string;
  geenTransactieGevondenVoor: (query: string) => string;
  onbekendeTegenpartij: string;
  bekijkTransactiesIn: (categorie: string) => string;
};

type TopUitgavenCopy = {
  title: string;
  nogGeenUitgavenDezeMaand: string;
  nietVergelijkbaar: (month: string, prev: string) => string;
  erStaatWelUitgaven: (amount: string) => string;
  importeerBeideMaanden: string;
  maandTOvPrev: (month: string, prev: string) => string;
  aandeelEnDeltaTOv: (month: string, prev: string) => string;
  telDagenTotNuToe: (month: string, observed: number, inMonth: number) => string;
  rekeningenBuitenVergelijking: (n: number, amount: string) => string;
  bekijkTransactiesIn: (categorie: string) => string;
  nieuwDelta: string;
};

/** The five `AccountTypeKind`s from `@lavega/core` (balance.ts), rendered as
 *  words. Shared by every screen that shows an account's type — the dropdown
 *  in Rekeningen and the card badge in KaartenBlock both render through this
 *  same set of five, rather than each carrying its own copy of the same five
 *  words. */
type AccountTypesCopy = {
  current: string;
  savings: string;
  credit: string;
  investment: string;
  other: string;
};

export type MoneyCopy = {
  rekeningen: RekeningenCopy;
  accountTypes: AccountTypesCopy;
  transacties: TransactiesCopy;
  forecast: ForecastCopy;
  saldo: SaldoCopy;
  positie: PositieCopy;
  statistiek: StatistiekCopy;
  aandacht: AandachtCopy;
  kaarten: KaartenCopy;
  facturen: FacturenCopy;
  btw: BtwCopy;
  bankLink: BankLinkCopy;
  betaalschema: BetaalschemaCopy;
  recenteTransacties: RecenteTransactiesCopy;
  topUitgaven: TopUitgavenCopy;
};

const nl: MoneyCopy = {
  rekeningen: {
    heading: "Rekeningen",
    weergaveGroepAria: "Weergave",
    perBank: "Per bank",
    alleRekeningen: "Alle rekeningen",
    ja: "Ja",
    nee: "Nee",
    hernoem: "Hernoem",
    bankInvullen: "Bank invullen",
    bankPlaceholder: "Bank, bijv. ING",
    naamPlaceholder: "Naam, bijv. Oranje Spaarrekening",
    klaar: "Klaar",
    bankNaam: "Bank & naam",
    type: "Type",
    entiteit: "Entiteit",
    gekoppeld: "Gekoppeld",
    openstaand: "Openstaand",
    saldo: "Saldo",
    saldoOnbekendPlaceholder: "onbekend",
    schuld: "schuld",
    nogGeenTransactiesGeimporteerd: "Nog geen transacties geïmporteerd",
    verwijder: "Verwijder",
    geenRekeningen: "Nog geen rekeningen — importeer eerst een bestand.",
    verbergen: "Verbergen",
    rekeningTonen: "Rekening tonen",
    rekeningenTonen: "Rekeningen tonen",
    samenvoegen: "Samenvoegen",
    saldoOnbekend: "saldo onbekend",
    dagOnbekend: "dag onbekend",
    tabelBank: "Bank",
    tabelType: "Type",
    tabelEntiteit: "Entiteit",
    tabelSaldo: "Saldo",
    tabelTransacties: "Transacties",
    bankVanLabel: (naam) => `Bank van ${naam}`,
    naamVanLabel: (naam) => `Naam van ${naam}`,
    typeVanLabel: (naam) => `Type ${naam}`,
    entiteitVanLabel: (naam) => `Entiteit ${naam}`,
    saldoVanLabel: (naam) => `Saldo ${naam}`,
    openstaandBedragVanLabel: (naam) => `Openstaand bedrag ${naam}`,
    bekijkTransactiesVan: (naam) => `Bekijk transacties van ${naam}`,
    rekeningWoord: (n) => (n === 1 ? "rekening" : "rekeningen"),
    transactieWoord: (n) => (n === 1 ? "transactie" : "transacties"),
    rekeningenBijBankAria: (bankLabel) => `Rekeningen bij ${bankLabel}`,
    zonderBank: "Zonder bank",
    vanKnownVanTotal: (known, total) => `van ${known} van ${total}`,
    transactiesBekijken: (n) => `${n} ${n === 1 ? "transactie" : "transacties"} bekijken`,
    deleteQuestion: (naam, txCount) =>
      txCount === 0
        ? `${naam} verwijderen?`
        : `${naam} en ${txCount} ${txCount === 1 ? "transactie" : "transacties"} verwijderen?`,
    dupBannerTitle: (labelsJoined) => `Deze rekeningen lijken dezelfde rekening: ${labelsJoined}.`,
    dupBannerSubBefore: "LaVega houdt ",
    dupBannerSubAfter:
      " aan en verplaatst de transacties daarheen. Overlappende periodes worden samengevoegd, niet dubbel geteld.",
    samenvoegenLabel: (multi, dupLabel) => (multi ? `Samenvoegen: ${dupLabel}` : "Samenvoegen"),
    samenvoegenQuestion: (dupLabel, survivorLabel) =>
      `${dupLabel} samenvoegen met ${survivorLabel}?`,
    standVan: (date) => `stand van ${date}`,
    datumOnbekend: "datum onbekend",
    geenSaldo: "geen saldo",
    saldoAgeDatedIntro: (date) =>
      `Dit bedrag is de stand van ${date}, niet van vandaag. LaVega werkt het daarna niet zelf bij:` +
      ` een koppeling of een import haalt alleen op het moment zelf gegevens binnen, er loopt niets op de achtergrond.`,
    saldoAgeDatedLater: (laterDate) =>
      ` Er zijn transacties van ná die dag; de nieuwste is van ${laterDate}, dus dit is niet de stand van nu.`,
    saldoAgeDatedInvite: ` Je kunt het bedrag in het veld hierboven overschrijven met wat je bankapp nu laat zien; LaVega legt dan de dag van vandaag erbij vast.`,
    saldoAgeUndatedLinked:
      `Bij dit bedrag staat geen dag: de bron stuurde er geen mee, en LaVega vult er zelf geen in.` +
      ` De koppeling vernieuwt zichzelf niet — er loopt niets op de achtergrond, dus dit cijfer beweegt niet mee.` +
      ` Wanneer deze rekening binnenkwam, staat in de regel hieronder; dat is de ouderdom van de koppeling en` +
      ` niet die van dit bedrag.`,
    saldoAgeUndatedUnlinked:
      `Bij dit bedrag staat geen dag, en van deze rekening is ook geen koppelmoment vastgelegd (zie de regel hieronder).` +
      ` De koppeling vernieuwt zichzelf niet: wat hier staat is de stand van het moment waarop je autoriseerde.` +
      ` Welk moment dat was, weet LaVega niet, en daarom staat er hier geen datum.`,
    saldoAgeUndatedTx: (date) =>
      ` De nieuwste transactie die LaVega van deze rekening heeft, is van ${date} — dat zegt iets over de transacties, niet over dit bedrag.`,
    saldoAgeUndatedInvite: ` Overschrijf het bedrag in het veld hierboven met wat je bankapp nu laat zien; dan staat de dag er wel bij.`,
    saldoAgeNoneIntro: "Van deze rekening is geen saldo bekend — geen bedrag, en dus ook geen nul.",
    saldoAgeNoneTx: (date) => ` Er zijn wel transacties: de nieuwste is van ${date}.`,
    saldoAgeNoneInvite:
      " Vul het bedrag in het veld hierboven in zoals je bankapp het laat zien; LaVega legt de dag van vandaag erbij vast.",
    gekoppeldOp: (date) => `gekoppeld op ${date}`,
    koppelmomentOnbekend: "koppelmoment onbekend",
    linkedNoteKnown: (date) =>
      `Deze rekening staat sinds ${date} in LaVega — de dag van de koppeling of de import.` +
      ` Dat is iets anders dan de dag waarop het saldo hierboven gold: dit zegt hoe oud de koppeling is,` +
      ` niet hoe oud het bedrag is.`,
    linkedNoteUnknown:
      `Wanneer deze rekening in LaVega kwam, is niet vastgelegd: hij stond er al voordat LaVega het` +
      ` koppelmoment bijhield. De dag van vandaag invullen zou van een rekening van maanden geleden een` +
      ` verse koppeling maken, dus dat gebeurt niet — dit blijft onbekend. Rekeningen die je hierna` +
      ` koppelt of importeert krijgen hun moment wel.`,
  },
  accountTypes: {
    current: "Betaalrekening",
    savings: "Spaarrekening",
    credit: "Creditcard",
    investment: "Beleggingsrekening",
    other: "Overig",
  },
  transacties: {
    heading: "Transacties",
    reason: {
      buitenland: {
        label: "buitenlandse betaling",
        what: "Kaartbetalingen in het buitenland. De naam van de winkel staat er wel bij, maar staat in geen enkele regel.",
      },
      onbekendeTegenpartij: {
        label: "geen regel",
        what: "Er staat een tegenpartij in de transactie, maar geen regel en geen ingebouwde categorie past erop.",
      },
      alleenNummers: {
        label: "alleen nummers",
        what: "Na het weghalen van rekeningnummers en bedragen blijft er geen leesbare tekst over. Hier valt niets te lezen — ook niet voor de AI. Geef deze zelf een categorie.",
      },
      geenTekst: {
        label: "geen tekst",
        what: "De export gaf geen tegenpartij en geen omschrijving mee. Geef deze zelf een categorie.",
      },
    },
    onbekendLabel: "onbekend",
    toonAlles: "Toon alles",
    toonAlleenOnbekend: "Toon alleen onbekend",
    laatDeAiZeLezen: "Laat de AI ze lezen",
    laatDeAiLezenAria: "Laat de AI de onbekende transacties lezen",
    batchCountSuffix: (shown, total) =>
      shown < total ? ` (${shown} van ${total})` : ` (${shown})`,
    aiRouteUit:
      "De AI-route staat uit: op de server is geen Mistral-sleutel ingesteld. Tot die er is kun je deze transacties indelen met een eigen regel onder Regels, of ze hier per stuk een categorie geven.",
    geenLeesbareTekst:
      "Geen van deze transacties heeft tekst die de AI kan lezen — hier helpt alleen een eigen regel of een categorie die je zelf geeft.",
    consentBefore: "Alleen de ",
    consentStrong: "tegenpartij + omschrijving",
    consentAfter:
      " en de richting (in/uit) van je onbekende transacties gaan via onze server naar Mistral — nooit je bedragen, saldi, rekeningnummers of datums als apart veld, en we filteren herkenbare IBANs, bedragen en datums ook uit die tekst voordat we hem versturen. Je bekijkt en bevestigt elk voorstel voordat er iets verandert.",
    aanzettenEnCategoriseren: "Aanzetten en categoriseren",
    annuleer: "Annuleer",
    bezigMetCategoriseren: "Bezig met categoriseren…",
    voorstellenCount: (n) => `${n} voorstel${n === 1 ? "" : "len"}`,
    voorstellenRest:
      ' — pas aan of zet op "Sla over", en bevestig. Toegepaste categorieën worden ook als regel opgeslagen voor volgende imports.',
    tegenpartij: "Tegenpartij",
    omschrijving: "Omschrijving",
    bedrag: "Bedrag",
    categorie: "Categorie",
    slaOver: "Sla over",
    toepassen: "Toepassen",
    categorieVoor: (tegenpartij) => `Categorie voor ${tegenpartij}`,
    gecategoriseerdNote: (n) => `${n} ${n === 1 ? "transactie" : "transacties"} gecategoriseerd.`,
    nietsToegepast: "Niets toegepast.",
    categorisatieMislukt: "categorisatie mislukt",
    opslaanMislukt: "opslaan mislukt",
    aiKonGeenIndelen: "De AI kon geen van de onbekende transacties indelen.",
    entiteitLabel: "Entiteit",
    alleEntiteiten: "Alle entiteiten",
    rekeningLabel: "Rekening",
    alleRekeningen: "Alle rekeningen",
    categorieLabel: "Categorie",
    alleCategorieen: "Alle categorieën",
    zoekenLabel: "Zoeken",
    zoekenPlaceholder: "Tegenpartij of omschrijving",
    van: "Van",
    tot: "Tot",
    transactiesCount: (n) => `${n} transacties`,
    geenTransacties: "Geen transacties.",
    tableDatum: "Datum",
    tableTegenpartij: "Tegenpartij",
    tableOmschrijving: "Omschrijving",
    tableRekening: "Rekening",
    tableBedrag: "Bedrag",
    tableEntiteit: "Entiteit",
    tableCategorie: "Categorie",
  },
  forecast: {
    tekortSignaleringAria: "Tekort-signalering",
    shortfallSentence: (date, balance, buffer) =>
      `Tekort verwacht rond ${date} — laagste saldo ~${balance} (buffer €${buffer}).`,
    unknownSentence:
      "Positie onbekend (alleen CSV-rekeningen zonder saldo) — we tonen de verwachte stromen, geen saldo-lijn.",
    insufficientSentence: "Nog geen prognose te maken — er is niets om op te projecteren.",
    noneSentence: "Geen tekort verwacht in de komende 13 weken.",
    krapstePuntBanner: (week, closing, lowerSuffix, buffer) =>
      `Krapste punt: week ${week} — verwacht €${closing}${lowerSuffix}, boven je buffer van €${buffer}.`,
    lowerSuffix: (lower) => ` (ondergrens €${lower})`,
    wellRisico: (date, balance, buffer) =>
      `Wel een risico: binnen de gemeten bandbreedte kan het saldo rond ${date} tot ${balance} zakken — onder je buffer van €${buffer}.`,
    geenLopendeStromenNote:
      "Geen lopende terugkerende stromen herkend — de prognose leunt volledig op losse uitgaven en ingeplande posten.",
    positieOnbekendAlleenStromen: "Positie onbekend — alleen stromen.",
    onvoldoendeDataGrafiek: "Onvoldoende data voor een grafiek.",
    verwacht: "Verwacht",
    gemetenBandbreedte: "Gemeten bandbreedte",
    bufferLabel: (n) => `Buffer €${n}`,
    krapstePuntLegend: (week, closing) => `Krapste punt: week ${week} · €${closing}`,
    cashflowForecastAria: "13-weeks cashflow-forecast",
    cashflowForecastTitle: "13-weeks cashflow-forecast",
    scopeLabelAlleBedrijven: "alle bedrijven, gesaldeerd",
    driversAria: "Drivers per week",
    driversTitle: "Drivers · per week (gem.)",
    verwachteInkomsten: "Verwachte inkomsten",
    verwachteUitgaven: "Verwachte uitgaven",
    geenHerkendeInkomstenstromen: "Geen herkende inkomstenstromen.",
    geenHerkendeUitgavenstromen: "Geen herkende uitgavenstromen.",
    gestoptNietMeegeteld: "Gestopt · niet meegeteld",
    laatst: (date) => `laatst ${date}`,
    nogGeenLopendeStromen: "Nog geen lopende terugkerende stromen herkend.",
    positieAsOfLabel: "nu",
    verwachteKaspositieAria: "Verwachte kaspositie komende 13 weken",
    krapsteWeekLabel: "Krapste week:",
    krapsteWeekDetail: (week, balance) => `week ${week} — ${balance}`,
    positieOnbekendKort: "Positie onbekend — nog geen betrouwbare prognose mogelijk.",
    onvoldoendeHistorieVoorPrognose: "Onvoldoende historie voor een prognose.",
    weekNLabel: (n) => `week ${n}`,
    bufferReferenceLabel: "buffer",
    coverage: {
      confidence: {
        none: "geen prognose mogelijk",
        low: "beperkte basis",
        medium: "redelijke basis",
        high: "brede basis",
      },
      noEvidence:
        "Er is niets om op te projecteren: geen lopende terugkerende stromen, te weinig historie voor een uitgavenpatroon en geen ingeplande posten. " +
        "De lijn is je huidige saldo, doorgetrokken — geen prognose.",
      flowsOnly: (n) =>
        `Geen transactiehistorie in deze weergave — alleen ${n} ingeplande post(en) zijn meegeteld.`,
      historyWindow: (days, from, to) => `${days} dagen historie (${from} t/m ${to})`,
      liveStreams: (n) =>
        n === 1 ? "1 lopende terugkerende stroom" : `${n} lopende terugkerende stromen`,
      scheduledItems: (n) => `${n} ingeplande post(en)`,
      basedOn: (parts) => `Gebaseerd op ${parts}.`,
      accountsWithoutHistory: (missing, total) =>
        `${missing} van je ${total} rekeningen leverde geen transacties. ` +
        "Het saldo telt mee in de startpositie, maar wat daar in- en uitgaat is hier onzichtbaar.",
      shortAccount: (days) =>
        `De kortst geïmporteerde rekening heeft ${days} dagen historie — wat daarop terugkeert is nog niet te zien.`,
      noIncidental:
        "Te weinig historie voor een uitgavenpatroon: losse uitgaven buiten de herkende stromen zijn niet meegeprojecteerd.",
      noBand: "Geen bandbreedte: er is nog niets gemeten waaruit spreiding af te leiden valt.",
      flatBand:
        "Bandbreedte nul: de bedragen die we meten varieerden tot nu toe niet. Dat is een meting over het verleden, geen garantie.",
      endedStreams: (names) =>
        `Niet meegeteld, want gestopt: ${names}. Klopt dat niet, dan mist de import de laatste afschrijvingen.`,
      overdueFlows: (n, amount) =>
        `${n} ingeplande post(en) van samen ${amount} was al verlopen en staat niet in de lijn — ` +
        "we kunnen hier niet zien of je die al betaald hebt.",
      staleImport: (date, days) =>
        `De nieuwste transactie is van ${date}, ${days} dagen geleden. Alles daarna ontbreekt in deze prognose.`,
    },
  },
  saldo: {
    title: (excluded) =>
      `Totale positie${excluded > 0 ? ` — ${excluded} rekening${excluded === 1 ? "" : "en"} niet meegeteld` : ""}`,
    rekeningenArrow: "Rekeningen →",
    rekeningenEntiteiten: (rekeningen, entiteiten) =>
      `${rekeningen} rekening${rekeningen === 1 ? "" : "en"} · ${entiteiten} entiteit${entiteiten === 1 ? "" : "en"}`,
    beschikbaarNaBtw: (amount) => ` · beschikbaar na BTW-reservering: ${amount}`,
    tOvVorigeWeek: "t.o.v. vorige week",
    importeerOfVulSaldos: "Importeer een bestand of vul saldo's in.",
    rekeningNogZonderSaldo: (n) =>
      `${n} rekening${n > 1 ? "en" : ""} nog zonder saldo — niet meegeteld, vul in bij Rekeningen.`,
    compleetElkeRekeningHeeftSaldo: "Compleet: elke rekening heeft een saldo.",
    vreemdeValutaConvert: (n, names) =>
      `${n} rekening${n > 1 ? "en" : ""} in vreemde valuta${names ? ` (${names})` : ""} niet meegeteld — nog geen koers.`,
    vreemdeValutaSeparate: (n, names) =>
      `${n} rekening${n > 1 ? "en" : ""} in vreemde valuta${names ? ` (${names})` : ""} niet meegeteld — LaVega rekent nog niet om naar euro's.`,
    omgerekendViaEcb: "Omgerekend via ECB.",
    positiePerDagAria: "Totale positie per dag",
    positieOpReadout: "Positie op",
    geenTransactiesOpRekeningenMetSaldo:
      "Nog geen transacties op de rekeningen met een saldo — daaruit wordt de grafiek opgebouwd.",
    heeftNogGeenTransacties: (label) =>
      `${label} heeft nog geen transacties, dus de positie van vorige week of maand is niet af te leiden — alleen aangenomen. Importeer die rekening en de vergelijking verschijnt.`,
    pasNDagenTransactiegeschiedenis: (days, min) =>
      `Pas ${days} dag${days === 1 ? "" : "en"} transactiegeschiedenis — te weinig voor een lijn. Vanaf ${min} dagen tekent LaVega hem.`,
    vorigeWeek: "Vorige week",
    vorigeMaand: "Vorige maand",
    nogGeenWeekGeschiedenis: "Nog geen week geschiedenis",
    nogGeenMaandGeschiedenis: "Nog geen maand geschiedenis",
  },
  positie: {
    rekeningenArrow: "Rekeningen →",
    meerSuffix: (hidden) => `+${hidden} meer · `,
    bedrijfZonderCompleetSaldo: (n) => `${n} bedrijf${n === 1 ? "" : "ven"} zonder compleet saldo`,
    vreemdeValutaConvert: (n, names) =>
      `${n} bedrijf${n === 1 ? "" : "ven"} in vreemde valuta${names ? ` (${names})` : ""} — nog geen koers.`,
    vreemdeValutaSeparate: (n, names) =>
      `${n} bedrijf${n === 1 ? "" : "ven"} in vreemde valuta${names ? ` (${names})` : ""} — LaVega rekent nog niet om naar euro's`,
    omgerekendViaEcb: "Omgerekend via ECB.",
    alleSaldosBekend: "Alle saldo's bekend",
    geenRekeningenMetEntiteit:
      "Nog geen rekeningen met een entiteit — importeer eerst een bestand.",
    verhoudingAria: "Verhouding van positieve posities per bedrijf",
    onbekend: "onbekend",
  },
  statistiek: {
    title: "Statistieken",
    periodeAria: "Periode van de statistieken",
    weergaveAria: "Weergave van de statistieken",
    begindatumAria: "Begindatum",
    einddatumAria: "Einddatum",
    periods: [
      { value: "1w", label: "1 week" },
      { value: "1m", label: "1 maand" },
      { value: "3m", label: "3 maanden" },
      { value: "6m", label: "6 maanden" },
      { value: "12m", label: "12 maanden" },
      { value: "aangepast", label: "Aangepast" },
    ],
    views: [
      { value: "categorie", label: "Categorieën" },
      { value: "verdeling", label: "Verdeling" },
      { value: "gegroeid", label: "Gegroeid" },
      { value: "weekdag", label: "Weekdagen" },
    ],
    nogGeenTransactiesImporteer: "Nog geen transacties — importeer een bestand of koppel een bank.",
    nogGeenTransactieMetDatum: "Nog geen transactie met een datum om een periode uit te halen.",
    einddatumVoorBegindatum: "De einddatum ligt vóór de begindatum — draai ze om.",
    kiesBegindatumEnEinddatum: "Kies een begindatum en een einddatum.",
    gegevensVanaf: (date) => ` · gegevens vanaf ${date}`,
    alleenKleineUitgaven: (n, small, threshold, days) =>
      `Alleen kleine uitgaven in deze periode: ${n} categorie${n === 1 ? "" : "ën"}, samen ${small} — elk onder ${threshold} over deze ${days} dagen. Kies een kortere periode om ze te zien.`,
    geenUitgavenLangerePeriodeOfImport:
      "Geen uitgaven in deze periode — kies een langere periode of importeer meer transacties.",
    bekijkTransactiesIn: (categorie) => `Bekijk transacties in ${categorie}`,
    uitgavenPerCategoriePer: (unit) => `Uitgaven per categorie per ${unit}`,
    weekVan: (date) => `Week van ${date}`,
    alleenTM: (start, end) => ` — alleen ${start} t/m ${end}`,
    weggelatenPrefix: "Wat hier niet in staat: ",
    weggelatenMaanden: (n) => `${n} maand${n === 1 ? "" : "en"} zonder afschrift`,
    weggelatenKlein: (n) => `${n} kleinere categorie${n === 1 ? "" : "ën"}`,
    weggelatenGecapt: (n) => `${n} categorie${n === 1 ? "" : "ën"} buiten de grafiek`,
    nietGetoondMaanden: (list) =>
      `Niet getoond: ${list} — daar is geen afschrift van geïmporteerd. Een lege maand is geen maand zonder uitgaven.`,
    kleinereCategorieenNietGetoond: (n, range, small, threshold, days) =>
      `${n} kleinere categorie${n === 1 ? "" : "ën"} niet getoond in ${range}: samen ${small}, elk onder ${threshold} over deze ${days} dagen. Een kortere periode legt die grens lager.`,
    nogNCategorieenBuitenGrafiek: (n, list) =>
      `Nog ${n} categorie${n === 1 ? "" : "ën"} buiten de grafiek: ${list}.`,
    tegenoverEerdereMaanden: (month) => `${month} tegenover je eerdere maanden.`,
    welkeDagenSummary: "Welke dagen naast welke zijn gelegd",
    heleMaandNaast: (n) => `De hele maand, naast de ${n} volledige maanden ervoor.`,
    deelmaandNaast: (range, days, n) =>
      `Deze maand loopt nog: ${range} is ${days} dagen, en daar liggen dezelfde eerste ${days} dagen van de ${n} maanden ervoor naast.`,
    kortePeriodesTellenNiet: (n, days) =>
      ` ${n} ${n === 1 ? "maand telt" : "maanden tellen"} niet mee — korter dan ${days} dagen.`,
    nogGeenVergelijkingGeenTx: (month) =>
      `Nog geen vergelijking met je eigen maanden — er staat nog geen transactie in ${month}.`,
    volledigeMaandenCount: (n, month) =>
      n === 0
        ? `er is geen volledige maand vóór ${month}`
        : n === 1
          ? `er is 1 volledige maand vóór ${month}`
          : `er zijn ${n} volledige maanden vóór ${month}`,
    nogGeenVergelijkingTeWeinig: (month, countPhrase, min) =>
      `Nog geen vergelijking met je eigen maanden: ${countPhrase} geïmporteerd, en een plaats in je eigen geschiedenis vraagt er minstens ${min}. Oudere afschriften importeren vult dit aan.`,
    position: {
      geenGegevens: "deze maand is nog niet gemeten",
      teWeinigGeschiedenis: "te weinig eerdere maanden om in te plaatsen",
      nieuweCategorie: "nieuw — geen eerdere maand met deze categorie",
      teKortBekend: (n) =>
        `pas ${n} ${n === 1 ? "maand" : "maanden"} bekend, te weinig om in te plaatsen`,
      geenVerschilZero: (n) => `hier geen uitgaven, in je laatste ${n} maanden ook niet`,
      geenVerschilGelijk: (n) => `even hoog als in al je laatste ${n} maanden`,
      hogerDanAl: (n) => `hoger dan al je laatste ${n} maanden`,
      lagerDanAl: (n) => `lager dan al je laatste ${n} maanden`,
      hogerDanN: (higher, n) => `hoger dan ${higher} van je laatste ${n} maanden`,
      lagerDanN: (lower, n) => `lager dan ${lower} van je laatste ${n} maanden`,
    },
    verdelingGeenUitgaven: "Geen uitgaven in deze periode — kies een langere periode.",
    gegroeidGeenNietsOmTeVergelijken: "Nog niets om te vergelijken — kies een langere periode.",
    steegHetHardst: (delta, days) => `steeg het hardst: ${delta} meer dan de ${days} dagen ervoor`,
    pctDeel: (pct) => ` (${pct}%)`,
    nieuwDeel: " (nieuw)",
    overigCategorieLabel: "Overig",
    nietsGestegen: (days) => `Niets is gestegen tegenover de ${days} dagen ervoor.`,
    verschilSeriesLabel: "Verschil",
    verschilAria: (days) => `Verschil per categorie tegenover de ${days} dagen ervoor`,
    welkePeriodeSummary: "Welke periode ernaast ligt, en wat er meetelt",
    vergelekenMet: (beforeStart, beforeEnd) =>
      `Vergeleken met ${beforeStart} — ${beforeEnd}, dezelfde lengte als de gekozen periode. Alleen uitgaven.`,
    geenUitgavenOmWeekpatroon: "Nog geen uitgaven om een weekpatroon uit te halen.",
    pasNDagenGeschiedenisWeekdag: (days, min) =>
      `Pas ${days} dag${days === 1 ? "" : "en"} geschiedenis in deze periode — een weekdagpatroon vraagt minstens ${min} dagen, anders is elk gemiddelde één waarneming.`,
    geenWeekdagSpringtEruit:
      "Geen enkele weekdag springt eruit — er zijn nog geen uitgaven gemeten.",
    kostGemiddeldSuffix: " kost je gemiddeld ",
    pctMeerDanGewoneDag: (pct) => ` — ${pct}% meer dan een gewone dag`,
    gemiddeldeUitgavenPerWeekdagAria: "Gemiddelde uitgaven per weekdag",
    gewoneDagLabel: "gewone dag",
    waaropDitGemiddeldeRust: (days) => `Waarop dit gemiddelde rust: ${days} dagen`,
    gemetenOverNDagen: (days) =>
      `Gemeten over ${days} dagen — elk voorkomen van die weekdag telt mee, ook de dagen zonder transactie.`,
    buitenDezeCijfersGehouden: (amount) => `Buiten deze cijfers gehouden: ${amount}`,
    movedRow: (amount, categorie, why, inAmountSuffix) =>
      `${amount} aan ${categorie} — ${why}${inAmountSuffix}`,
    movedInSuffix: (inAmount) => ` (waarvan ${inAmount} weer terugkwam)`,
    movedFooter: " Dat is geen uitgave: het is dezelfde euro op een andere plek.",
    buitenDezeCijfersConvert: (count, perCurrencyList) =>
      `Buiten deze cijfers: ${count} transactie${count === 1 ? "" : "s"}, nog geen koers (${perCurrencyList}).`,
    buitenDezeCijfersSeparate: (count, perCurrencyList) =>
      `Buiten deze cijfers: ${count} transactie${count === 1 ? "" : "s"} in vreemde valuta (${perCurrencyList}).`,
    vreemdeValutaOmgerekend: "Vreemde valuta omgerekend via ECB-koers van de dag.",
    inkomstenInDezePeriode: "Inkomsten in deze periode",
    uitgavenInDezePeriode: "Uitgaven in deze periode",
    gemiddeldPer: (amount, unit) => `gemiddeld ${amount} per ${unit}`,
    waaroverDezeTweeGemiddeldenGaan: (units, unitPlural) =>
      `Waarover deze twee gemiddelden gaan: ${units} hele ${unitPlural}`,
    gedeeldDoor: (units, unitPlural, range) =>
      `Gedeeld door ${units} hele ${unitPlural}: ${range}. Geld dat alleen van plaats veranderde telt er niet in mee, net als in de rest van dit blok.`,
    restDagenTellenNiet: (days, unit) =>
      `${days} dag${days === 1 ? "" : "en"} aan de randen tellen niet mee — een aangebroken ${unit} is geen ${unit}. Zouden ze meetellen, dan hing dit gemiddelde ervan af of een vaste afschrijving nog net vóór het einde van de periode viel.`,
    nietPerAskedUnit: (askedUnit, min) =>
      `Niet per ${askedUnit}: deze periode bevat er geen ${min} hele. Over één ${askedUnit} middelen levert dat ${askedUnit}bedrag zelf op.`,
    gemiddeldeDagFallback: "gemiddelde dag",
    adviesLangerePeriode: "Een langere periode pakt de rest van je afschriften mee.",
    adviesOudereAfschriften: "Oudere afschriften importeren vult dit aan.",
    geenGemiddeldeGeenTransacties: (advies) =>
      `Nog geen gemiddelde: in deze periode staat geen enkele transactie. ${advies}`,
    geenGemiddeldeTeKortAfschrift: (coveredDays, min, advies) =>
      `Nog geen gemiddelde: deze periode bevat ${coveredDays} dag${
        coveredDays === 1 ? "" : "en"
      } afschrift, en middelen vraagt er minstens ${min}. ${advies}`,
  },
  aandacht: {
    waarschuwOnderBuffer: "Waarschuw onder buffer €",
    waarschuwingsbufferAria: "Waarschuwingsbuffer in euro",
    bufferZeroNote:
      "Je buffer staat op € 0, dus je hoort pas iets als je verwachte saldo onder nul zakt. Zet er een bedrag in om eerder gewaarschuwd te worden.",
    nietsGevondenOmJeOpTeWijzen: "Niets gevonden om je op te wijzen.",
    lavegaKeekNaar: (checksJoined) =>
      `LaVega keek naar: ${checksJoined}. Dat is alleen zo compleet als wat je hebt geïmporteerd — over een rekening die er niet in zit kan LaVega niets zeggen.`,
    checks: [
      "een verwacht tekort tegenover je buffer",
      "een terugkerende betaling of inkomst die uitblijft",
      "BTW- en belastingdeadlines binnen 30 dagen",
      "handmatig bijgehouden saldi die verouderd zijn",
      "rekeningen zonder saldo",
    ],
    kritiek: "Kritiek",
    letOp: "Let op",
    terInfo: "Ter info",
    toonNTerInfo: (n) => `Toon ${n} ter info`,
    alert: {
      title: (b) => {
        switch (b.kind) {
          case "shortfall":
            return "Verwacht tekort";
          case "missed-stream":
            return `Verwachte ${b.sign === 1 ? "inkomst" : "betaling"} niet gezien`;
          case "vat-due":
            return `${b.label} — betaal vóór ${b.dueDate}`;
          case "tax-prepayment-due":
            return `${b.label} — betaal vóór ${b.dueDate}`;
          case "tracking-stale":
            return `${b.label} — saldo bijwerken`;
          case "no-balance":
            return "Onbekend saldo";
        }
      },
      detail: (b) => {
        switch (b.kind) {
          case "shortfall":
            return `Rond ${b.date} zakt je saldo naar ${formatEuroIn("nl", b.balanceCents / 100)} — onder je buffer van ${formatEuroIn("nl", b.bufferCents / 100)}.`;
          case "missed-stream": {
            const noun = b.sign === 1 ? "inkomst" : "betaling";
            const prep = b.sign === 1 ? "van" : "aan";
            return `${noun[0].toUpperCase() + noun.slice(1)} ${prep} ${b.counterparty} (~${formatEuroIn("nl", b.amountCents / 100)}) werd rond ${b.expectedDate} verwacht, maar is nog niet binnen.`;
          }
          case "vat-due":
            return `Zet ${formatEuroIn("nl", b.amountCents / 100)} klaar; de BTW-aangifte + betaling moet uiterlijk ${b.dueDate} (over ${b.days} dagen).`;
          case "tax-prepayment-due":
            return `Zet ${formatEuroIn("nl", b.amountCents / 100)} klaar; deze vooruitbetaling winstbelasting moet uiterlijk ${b.dueDate} betaald zijn (over ${b.days} dagen).`;
          case "tracking-stale":
            return `Laatst bijgewerkt op ${b.updatedAt} (${b.ageDays} dagen geleden). ${b.question}`;
          case "no-balance":
            return `${b.count} rekening${b.count > 1 ? "en" : ""} zonder saldo — vul in bij Rekeningen voor een compleet beeld.`;
        }
      },
    },
  },
  kaarten: {
    title: "Kaarten",
    rekeningenArrow: "Rekeningen →",
    geenRekeningenGekoppeld:
      "Nog geen rekeningen gekoppeld — importeer een bestand of koppel een bank.",
    onbekendeBank: "Onbekende bank",
    geenIbanBekend: "geen IBAN bekend",
    opNaamVan: "Op naam van",
    geenEntiteitIngesteld: "geen entiteit ingesteld",
    saldoLabel: "Saldo",
    onbekend: "onbekend",
    cardAria: (bank, type) => `${bank} · ${type}`,
  },
  facturen: {
    facturenArrow: "Facturen →",
    vanNFacturenBedragOnbekend: (n) =>
      `Van ${n} factu${n === 1 ? "ur" : "ren"} is het bedrag niet in euro's bekend; ${n === 1 ? "die zit" : "die zitten"} niet in de bedragen hierboven.`,
    nietsStaatOpen: (total) =>
      `Niets staat open — alle ${total} factu${total === 1 ? "ur" : "ren"} die LaVega kent zijn betaald of vervallen.`,
    openstaand: "openstaand",
    geenEnkeleOpenstaandeFactuurOverVervaldatum:
      "Geen enkele openstaande factuur is over zijn vervaldatum.",
    teOntvangen: "Te ontvangen",
    teBetalen: "Te betalen",
    bedragOnbekend: "bedrag onbekend",
    sideRowCount: (n) => `${n} factu${n === 1 ? "ur" : "ren"}`,
    lateSentence: (total, parts) =>
      `${total} factu${total === 1 ? "ur is" : "ren zijn"} over de vervaldatum${parts}.`,
    teOntvangenAmount: (amount) => `${amount} te ontvangen`,
    teBetalenAmount: (amount) => `${amount} te betalen`,
  },
  btw: {
    /** The local tax name in Dutch, its English name in English. */
    title: "BTW",
    belastingArrow: "Belasting →",
    geenBedrag: "geen bedrag",
    direction: {
      betalen: "te betalen",
      terugvragen: "terug te vragen",
      onbekend: "richting onbekend",
    },
    shortBasis: {
      manual: "je eigen bedrag",
      sheet: "je boekhouding",
      invoices: "je facturen",
      proxy: "een marge-benadering uit je banktransacties",
    },
    bronPrefix: (basis) => `Bron: ${basis}. `,
    uiterlijk: (deadline) => `uiterlijk ${deadline}`,
    looptNogTm: (end) => ` · loopt nog t/m ${end}`,
    nogNAndereOnderneming: (n) =>
      ` Nog ${n} andere onderneming${n === 1 ? "" : "en"} — Belasting toont ze apart. LaVega telt ze hier niet bij elkaar op: ze kunnen een ander stelsel en een andere aangifteperiode hebben, en dan hoort er bij die som geen periode.`,
    regelsPer: (date) => ` · regels per ${date}.`,
    entiteitPrefix: (entiteit) => `${entiteit} · `,
    note: {
      geenFactuurEnkele: (entiteit) =>
        `Geen factuur van ${entiteit} in dit tijdvak — de enige die LaVega kent valt erbuiten.`,
      geenFactuurMeerdere: (entiteit, buiten) =>
        `Geen factuur van ${entiteit} in dit tijdvak; ${buiten} vallen erbuiten.`,
      stelselOnbekend: (entiteit) =>
        `Voor ${entiteit} is niet gekozen tussen factuurstelsel en kasstelsel. Bij het factuurstelsel valt de btw in de periode van de factuur, bij het kasstelsel in die van de betaling — dat scheelt echt geld, dus LaVega noemt hier geen bedrag. Het stelsel kies je bij Belasting.`,
      btwOnbekendOpFacturen: (missing, total) =>
        `Van ${missing} van de ${total} facturen in deze periode is het btw-bedrag onbekend, dus je facturen zijn hier niet de basis.`,
      gemengdeTarieven: "Gemengde tarieven: LaVega rekent hier niets uit en zet ook geen nul.",
      kasstelsel:
        "Kasstelsel: de btw valt in de periode van de betaling, niet van de factuur, dus je facturen zijn hier niet de basis.",
      omzetfacturenOnbekend:
        "In deze periode staan alleen inkoopfacturen; wat er aan btw over je omzet tegenover staat, ziet LaVega niet.",
      voorbelastingOnbekend:
        "Geen inkoopfactuur met een btw-bedrag in deze periode, dus de voorbelasting is onbekend.",
      boekhoudingAnderePeriode:
        "Je geïmporteerde boekhouding dekt deze periode niet volledig, dus LaVega gebruikt hem niet half.",
      geenBanktransacties: (entiteit) =>
        `LaVega ziet geen transacties van ${entiteit} in deze periode. Dat is geen nul: er is niets om een bedrag uit te lezen.`,
    },
  },
  bankLink: {
    zakelijk: "Zakelijk",
    particulier: "Particulier",
    typeRekeningAria: "Type rekening",
    ofKoppelJeBankDirect: "Of koppel je bank direct",
    laden: "Laden…",
    koppelBankEnableBanking: "Koppel bank (Enable Banking)",
    geenBankenBeschikbaar: "Geen banken beschikbaar.",
    doorsturen: "Doorsturen…",
    autoriseer: "Autoriseer",
    bankkoppelingError: (message) => `Bankkoppeling: ${message}`,
    alleenLezenToegang:
      "Alleen-lezen toegang via Enable Banking — je autoriseert bij je eigen bank; gegevens komen versleuteld in je eigen kluis.",
    bankGeenAutorisatiepagina: "De bank gaf geen autorisatiepagina terug.",
  },
  betaalschema: {
    title: "Betaalagenda",
    status: {
      expected: "verwacht",
      confirmed: "bevestigd",
      paid: "betaald",
      cancelled: "vervallen",
    },
    cadence: {
      wekelijks: "wekelijks",
      elke2Weken: "elke 2 weken",
      maandelijks: "maandelijks",
      tweemaandelijks: "tweemaandelijks",
      elkKwartaal: "elk kwartaal",
      halfjaarlijks: "halfjaarlijks",
      jaarlijks: "jaarlijks",
      elkeNDagen: (days) => `elke ${days} dagen`,
    },
    xGezien: (n) => `${n}× gezien`,
    datumAlVerstreken: (n) => `${n} datum${n === 1 ? "" : "s"} al verstreken. `,
    regelVoorspeld: (n) =>
      `${n} regel${n === 1 ? "" : "s"} voorspeld uit je eigen geschiedenis, niet bevestigd.`,
    alleRegelsIngepland: "Alle regels zijn ingeplande bedragen.",
    nietsIngepland:
      "Niets ingepland — hier komen je BTW-reserveringen, openstaande facturen en herkende vaste lasten te staan.",
    voorspeldTag: "voorspeld",
    teLaatSuffix: " · te laat",
  },
  recenteTransacties: {
    title: "Recente transacties",
    zoekPlaceholder: "Zoek op naam of categorie",
    zoekenAria: "Zoek in recente transacties",
    bekijkAlles: "Bekijk alles →",
    nogGeenTransacties: "Nog geen transacties.",
    geenTransactieGevondenVoor: (query) => `Geen transactie gevonden voor “${query}”.`,
    onbekendeTegenpartij: "Onbekende tegenpartij",
    bekijkTransactiesIn: (categorie) => `Bekijk transacties in ${categorie}`,
  },
  topUitgaven: {
    title: "Top uitgaven",
    nogGeenUitgavenDezeMaand: "Nog geen uitgaven deze maand.",
    nietVergelijkbaar: (month, prev) =>
      `${month} en ${prev} zijn niet vergelijkbaar: geen enkele rekening heeft gegevens in beide maanden.`,
    erStaatWelUitgaven: (amount) => ` Er staat wel ${amount} aan uitgaven in deze twee maanden.`,
    importeerBeideMaanden:
      "Importeer beide maanden van dezelfde rekeningen, dan verschijnt de vergelijking hier.",
    maandTOvPrev: (month, prev) => `${month} t.o.v. ${prev}`,
    aandeelEnDeltaTOv: (month, prev) => `${month} · aandeel & Δ t.o.v. ${prev}`,
    telDagenTotNuToe: (month, observed, inMonth) =>
      `${month} telt tot nu toe ${observed} van ${inMonth} dagen.`,
    rekeningenBuitenVergelijking: (n, amount) =>
      `${n} rekening${n === 1 ? "" : "en"} blijft buiten de vergelijking — die heeft geen gegevens in beide maanden (${amount} aan uitgaven).`,
    bekijkTransactiesIn: (categorie) => `Bekijk transacties in ${categorie}`,
    nieuwDelta: "nieuw",
  },
};

const en: MoneyCopy = {
  rekeningen: {
    heading: "Accounts",
    weergaveGroepAria: "View",
    perBank: "By bank",
    alleRekeningen: "All accounts",
    ja: "Yes",
    nee: "No",
    hernoem: "Rename",
    bankInvullen: "Add bank",
    bankPlaceholder: "Bank, e.g. ING",
    naamPlaceholder: "Name, e.g. Orange Savings Account",
    klaar: "Done",
    bankNaam: "Bank & name",
    type: "Type",
    entiteit: "Entity",
    gekoppeld: "Linked",
    openstaand: "Outstanding",
    saldo: "Balance",
    saldoOnbekendPlaceholder: "unknown",
    schuld: "debt",
    nogGeenTransactiesGeimporteerd: "No transactions imported yet",
    verwijder: "Delete",
    geenRekeningen: "No accounts yet — import a file first.",
    verbergen: "Hide",
    rekeningTonen: "Show account",
    rekeningenTonen: "Show accounts",
    samenvoegen: "Merge",
    saldoOnbekend: "balance unknown",
    dagOnbekend: "day unknown",
    tabelBank: "Bank",
    tabelType: "Type",
    tabelEntiteit: "Entity",
    tabelSaldo: "Balance",
    tabelTransacties: "Transactions",
    bankVanLabel: (naam) => `Bank of ${naam}`,
    naamVanLabel: (naam) => `Name of ${naam}`,
    typeVanLabel: (naam) => `Type of ${naam}`,
    entiteitVanLabel: (naam) => `Entity of ${naam}`,
    saldoVanLabel: (naam) => `Balance of ${naam}`,
    openstaandBedragVanLabel: (naam) => `Outstanding amount for ${naam}`,
    bekijkTransactiesVan: (naam) => `View transactions for ${naam}`,
    rekeningWoord: (n) => (n === 1 ? "account" : "accounts"),
    transactieWoord: (n) => (n === 1 ? "transaction" : "transactions"),
    rekeningenBijBankAria: (bankLabel) => `Accounts at ${bankLabel}`,
    zonderBank: "No bank",
    vanKnownVanTotal: (known, total) => `${known} of ${total} known`,
    transactiesBekijken: (n) => `View ${n} transaction${n === 1 ? "" : "s"}`,
    deleteQuestion: (naam, txCount) =>
      txCount === 0
        ? `Delete ${naam}?`
        : `Delete ${naam} and ${txCount} transaction${txCount === 1 ? "" : "s"}?`,
    dupBannerTitle: (labelsJoined) => `These accounts look like the same account: ${labelsJoined}.`,
    dupBannerSubBefore: "LaVega keeps ",
    dupBannerSubAfter:
      " and moves the transactions there. Overlapping periods are merged, not counted twice.",
    samenvoegenLabel: (multi, dupLabel) => (multi ? `Merge: ${dupLabel}` : "Merge"),
    samenvoegenQuestion: (dupLabel, survivorLabel) => `Merge ${dupLabel} with ${survivorLabel}?`,
    standVan: (date) => `balance as of ${date}`,
    datumOnbekend: "date unknown",
    geenSaldo: "no balance",
    saldoAgeDatedIntro: (date) =>
      `This amount is the balance as of ${date}, not today. LaVega does not update it afterwards by itself:` +
      ` a link or an import only fetches data at that moment, nothing runs in the background.`,
    saldoAgeDatedLater: (laterDate) =>
      ` There are transactions after that day; the newest is from ${laterDate}, so this is not the current balance.`,
    saldoAgeDatedInvite: ` You can overwrite the amount in the field above with what your banking app shows now; LaVega then records today's date with it.`,
    saldoAgeUndatedLinked:
      `This amount has no date: the source did not send one, and LaVega does not fill one in itself.` +
      ` The link does not refresh itself — nothing runs in the background, so this figure does not move with it.` +
      ` When this account was added is in the line below; that is the age of the link, not of this amount.`,
    saldoAgeUndatedUnlinked:
      `This amount has no date, and no link moment is recorded for this account either (see the line below).` +
      ` The link does not refresh itself: what is shown here is the balance from the moment you authorised it.` +
      ` LaVega does not know which moment that was, so no date is shown here.`,
    saldoAgeUndatedTx: (date) =>
      ` The newest transaction LaVega has for this account is from ${date} — that says something about the transactions, not about this amount.`,
    saldoAgeUndatedInvite: ` Overwrite the amount in the field above with what your banking app shows now; then the date will be recorded too.`,
    saldoAgeNoneIntro:
      "No balance is known for this account — no amount, and therefore no zero either.",
    saldoAgeNoneTx: (date) => ` There are transactions though: the newest is from ${date}.`,
    saldoAgeNoneInvite:
      " Fill in the amount in the field above as your banking app shows it; LaVega records today's date with it.",
    gekoppeldOp: (date) => `linked on ${date}`,
    koppelmomentOnbekend: "link date unknown",
    linkedNoteKnown: (date) =>
      `This account has been in LaVega since ${date} — the day of the link or the import.` +
      ` That is different from the day the balance above applied: this says how old the link is,` +
      ` not how old the amount is.`,
    linkedNoteUnknown:
      `When this account came into LaVega is not recorded: it was already there before LaVega started` +
      ` tracking the link moment. Filling in today's date would turn an account from months ago into a` +
      ` fresh link, so that does not happen — this stays unknown. Accounts you link or import from now` +
      ` on will get their moment recorded.`,
  },
  accountTypes: {
    current: "Current account",
    savings: "Savings account",
    credit: "Credit card",
    investment: "Investment account",
    other: "Other",
  },
  transacties: {
    heading: "Transactions",
    reason: {
      buitenland: {
        label: "foreign payment",
        what: "Card payments abroad. The merchant's name is there, but it doesn't match any rule.",
      },
      onbekendeTegenpartij: {
        label: "no rule",
        what: "The transaction has a counterparty, but no rule and no built-in category fits it.",
      },
      alleenNummers: {
        label: "numbers only",
        what: "After stripping account numbers and amounts, no readable text remains. There is nothing to read here — not even for the AI. Give this one a category yourself.",
      },
      geenTekst: {
        label: "no text",
        what: "The export did not include a counterparty or a description. Give this one a category yourself.",
      },
    },
    onbekendLabel: "Uncategorised",
    toonAlles: "Show all",
    toonAlleenOnbekend: "Show only uncategorised",
    laatDeAiZeLezen: "Have the AI read them",
    laatDeAiLezenAria: "Have the AI read the uncategorised transactions",
    batchCountSuffix: (shown, total) => (shown < total ? ` (${shown} of ${total})` : ` (${shown})`),
    aiRouteUit:
      "The AI route is switched off: no Mistral key is set on the server. Until there is one, you can sort these transactions with your own rule under Rules, or give them a category yourself, one by one.",
    geenLeesbareTekst:
      "None of these transactions has text the AI can read — only your own rule or a category you set yourself will help here.",
    consentBefore: "Only the ",
    consentStrong: "counterparty + description",
    consentAfter:
      " and the direction (in/out) of your uncategorised transactions go to Mistral through our server — never your amounts, balances, account numbers or dates as a separate field, and we also strip recognisable IBANs, amounts and dates from that text before sending it. You review and confirm every suggestion before anything changes.",
    aanzettenEnCategoriseren: "Turn on and categorise",
    annuleer: "Cancel",
    bezigMetCategoriseren: "Categorising…",
    voorstellenCount: (n) => (n === 1 ? "1 suggestion" : `${n} suggestions`),
    voorstellenRest:
      ' — adjust it or set it to "Skip", then confirm. Applied categories are also saved as a rule for future imports.',
    tegenpartij: "Counterparty",
    omschrijving: "Description",
    bedrag: "Amount",
    categorie: "Category",
    slaOver: "Skip",
    toepassen: "Apply",
    categorieVoor: (tegenpartij) => `Category for ${tegenpartij}`,
    gecategoriseerdNote: (n) => `${n} transaction${n === 1 ? "" : "s"} categorised.`,
    nietsToegepast: "Nothing applied.",
    categorisatieMislukt: "categorisation failed",
    opslaanMislukt: "saving failed",
    aiKonGeenIndelen: "The AI could not place any of the uncategorised transactions.",
    entiteitLabel: "Entity",
    alleEntiteiten: "All entities",
    rekeningLabel: "Account",
    alleRekeningen: "All accounts",
    categorieLabel: "Category",
    alleCategorieen: "All categories",
    zoekenLabel: "Search",
    zoekenPlaceholder: "Counterparty or description",
    van: "From",
    tot: "To",
    transactiesCount: (n) => `${n} transaction${n === 1 ? "" : "s"}`,
    geenTransacties: "No transactions.",
    tableDatum: "Date",
    tableTegenpartij: "Counterparty",
    tableOmschrijving: "Description",
    tableRekening: "Account",
    tableBedrag: "Amount",
    tableEntiteit: "Entity",
    tableCategorie: "Category",
  },
  forecast: {
    tekortSignaleringAria: "Shortfall signal",
    shortfallSentence: (date, balance, buffer) =>
      `Shortfall expected around ${date} — lowest balance ~${balance} (buffer €${buffer}).`,
    unknownSentence:
      "Position unknown (only CSV accounts without a balance) — we show the expected flows, not a balance line.",
    insufficientSentence: "No forecast possible yet — there is nothing to project from.",
    noneSentence: "No shortfall expected in the next 13 weeks.",
    krapstePuntBanner: (week, closing, lowerSuffix, buffer) =>
      `Tightest point: week ${week} — expected €${closing}${lowerSuffix}, above your buffer of €${buffer}.`,
    lowerSuffix: (lower) => ` (lower bound €${lower})`,
    wellRisico: (date, balance, buffer) =>
      `There is a risk though: within the measured range the balance could drop to ${balance} around ${date} — below your buffer of €${buffer}.`,
    geenLopendeStromenNote:
      "No active recurring flows recognised — the forecast rests entirely on one-off spending and scheduled items.",
    positieOnbekendAlleenStromen: "Position unknown — flows only.",
    onvoldoendeDataGrafiek: "Not enough data for a chart.",
    verwacht: "Expected",
    gemetenBandbreedte: "Measured range",
    bufferLabel: (n) => `Buffer €${n}`,
    krapstePuntLegend: (week, closing) => `Tightest point: week ${week} · €${closing}`,
    cashflowForecastAria: "13-week cashflow forecast",
    cashflowForecastTitle: "13-week cashflow forecast",
    scopeLabelAlleBedrijven: "all companies, consolidated",
    driversAria: "Drivers per week",
    driversTitle: "Drivers · per week (avg.)",
    verwachteInkomsten: "Expected income",
    verwachteUitgaven: "Expected expenses",
    geenHerkendeInkomstenstromen: "No recognised income streams.",
    geenHerkendeUitgavenstromen: "No recognised expense streams.",
    gestoptNietMeegeteld: "Stopped · not counted",
    laatst: (date) => `last ${date}`,
    nogGeenLopendeStromen: "No active recurring flows recognised yet.",
    positieAsOfLabel: "now",
    verwachteKaspositieAria: "Expected cash position over the next 13 weeks",
    krapsteWeekLabel: "Tightest week:",
    krapsteWeekDetail: (week, balance) => `week ${week} — ${balance}`,
    positieOnbekendKort: "Position unknown — no reliable forecast possible yet.",
    onvoldoendeHistorieVoorPrognose: "Not enough history for a forecast.",
    weekNLabel: (n) => `week ${n}`,
    bufferReferenceLabel: "buffer",
    coverage: {
      confidence: {
        none: "no forecast possible",
        low: "limited basis",
        medium: "reasonable basis",
        high: "broad basis",
      },
      noEvidence:
        "There is nothing to project from: no active recurring streams, not enough history for a spending pattern, and no scheduled items. " +
        "The line is your current balance, carried forward — not a forecast.",
      flowsOnly: (n) =>
        `No transaction history in this view — only ${n} scheduled item${n === 1 ? "" : "s"} ${n === 1 ? "was" : "were"} counted.`,
      historyWindow: (days, from, to) => `${days} days of history (${from} to ${to})`,
      liveStreams: (n) => (n === 1 ? "1 active recurring stream" : `${n} active recurring streams`),
      scheduledItems: (n) => (n === 1 ? "1 scheduled item" : `${n} scheduled items`),
      basedOn: (parts) => `Based on ${parts}.`,
      accountsWithoutHistory: (missing, total) =>
        `${missing} of your ${total} account${total === 1 ? "" : "s"} produced no transactions. ` +
        "The balance counts toward the starting position, but what moves in and out of it is invisible here.",
      shortAccount: (days) =>
        `Your shortest-imported account has only ${days} day${days === 1 ? "" : "s"} of history — what recurs on it isn't visible yet.`,
      noIncidental:
        "Not enough history for a spending pattern: one-off spending outside the recognised streams isn't projected.",
      noBand: "No range: nothing has been measured yet to derive a spread from.",
      flatBand:
        "Range of zero: the amounts we measure haven't varied so far. That's a measurement of the past, not a guarantee.",
      endedStreams: (names) =>
        `Not counted, because they stopped: ${names}. If that doesn't look right, the import is missing the most recent debits.`,
      overdueFlows: (n, amount) =>
        n === 1
          ? `1 scheduled item totalling ${amount} was already overdue and isn't shown in the line — ` +
            "we can't tell from here whether it's already been paid."
          : `${n} scheduled items totalling ${amount} were already overdue and aren't shown in the line — ` +
            "we can't tell from here whether they've already been paid.",
      staleImport: (date, days) =>
        `The newest transaction is from ${date}, ${days} day${days === 1 ? "" : "s"} ago. Everything after that is missing from this forecast.`,
    },
  },
  saldo: {
    title: (excluded) =>
      `Total position${excluded > 0 ? ` — ${excluded} account${excluded === 1 ? "" : "s"} not counted` : ""}`,
    rekeningenArrow: "Accounts →",
    rekeningenEntiteiten: (rekeningen, entiteiten) =>
      `${rekeningen} account${rekeningen === 1 ? "" : "s"} · ${entiteiten} entit${entiteiten === 1 ? "y" : "ies"}`,
    beschikbaarNaBtw: (amount) => ` · available after VAT (BTW) set-aside: ${amount}`,
    tOvVorigeWeek: "vs. last week",
    importeerOfVulSaldos: "Import a file or fill in balances.",
    rekeningNogZonderSaldo: (n) =>
      `${n} account${n > 1 ? "s" : ""} still without a balance — not counted, fill it in under Accounts.`,
    compleetElkeRekeningHeeftSaldo: "Complete: every account has a balance.",
    vreemdeValutaConvert: (n, names) =>
      `${n} account${n > 1 ? "s" : ""} in a foreign currency${names ? ` (${names})` : ""} not counted — no rate yet.`,
    vreemdeValutaSeparate: (n, names) =>
      `${n} account${n > 1 ? "s" : ""} in a foreign currency${names ? ` (${names})` : ""} not counted — LaVega does not yet convert to euros.`,
    omgerekendViaEcb: "Converted via the ECB.",
    positiePerDagAria: "Total position per day",
    positieOpReadout: "Position on",
    geenTransactiesOpRekeningenMetSaldo:
      "No transactions yet on the accounts with a balance — the chart is built from those.",
    heeftNogGeenTransacties: (label) =>
      `${label} has no transactions yet, so last week's or last month's position cannot be derived — only assumed. Import that account and the comparison will appear.`,
    pasNDagenTransactiegeschiedenis: (days, min) =>
      `Only ${days} day${days === 1 ? "" : "s"} of transaction history — too little for a line. From ${min} days LaVega draws it.`,
    vorigeWeek: "Last week",
    vorigeMaand: "Last month",
    nogGeenWeekGeschiedenis: "No week of history yet",
    nogGeenMaandGeschiedenis: "No month of history yet",
  },
  positie: {
    rekeningenArrow: "Accounts →",
    meerSuffix: (hidden) => `+${hidden} more · `,
    bedrijfZonderCompleetSaldo: (n) =>
      `${n} compan${n === 1 ? "y" : "ies"} without a complete balance`,
    vreemdeValutaConvert: (n, names) =>
      `${n} compan${n === 1 ? "y" : "ies"} in a foreign currency${names ? ` (${names})` : ""} — no rate yet.`,
    vreemdeValutaSeparate: (n, names) =>
      `${n} compan${n === 1 ? "y" : "ies"} in a foreign currency${names ? ` (${names})` : ""} — LaVega does not yet convert to euros`,
    omgerekendViaEcb: "Converted via the ECB.",
    alleSaldosBekend: "All balances known",
    geenRekeningenMetEntiteit: "No accounts with an entity yet — import a file first.",
    verhoudingAria: "Proportion of positive positions per company",
    onbekend: "unknown",
  },
  statistiek: {
    title: "Statistics",
    periodeAria: "Statistics period",
    weergaveAria: "Statistics view",
    begindatumAria: "Start date",
    einddatumAria: "End date",
    periods: [
      { value: "1w", label: "1 week" },
      { value: "1m", label: "1 month" },
      { value: "3m", label: "3 months" },
      { value: "6m", label: "6 months" },
      { value: "12m", label: "12 months" },
      { value: "aangepast", label: "Custom" },
    ],
    views: [
      { value: "categorie", label: "Categories" },
      { value: "verdeling", label: "Breakdown" },
      { value: "gegroeid", label: "Growth" },
      { value: "weekdag", label: "Weekdays" },
    ],
    nogGeenTransactiesImporteer: "No transactions yet — import a file or link a bank.",
    nogGeenTransactieMetDatum: "No transaction with a date yet to derive a period from.",
    einddatumVoorBegindatum: "The end date is before the start date — swap them.",
    kiesBegindatumEnEinddatum: "Choose a start date and an end date.",
    gegevensVanaf: (date) => ` · data from ${date}`,
    alleenKleineUitgaven: (n, small, threshold, days) =>
      `Only small spending in this period: ${n} categor${n === 1 ? "y" : "ies"}, together ${small} — each under ${threshold} over these ${days} days. Choose a shorter period to see them.`,
    geenUitgavenLangerePeriodeOfImport:
      "No spending in this period — choose a longer period or import more transactions.",
    bekijkTransactiesIn: (categorie) => `View transactions in ${categorie}`,
    uitgavenPerCategoriePer: (unit) => `Spending per category per ${unit}`,
    weekVan: (date) => `Week of ${date}`,
    alleenTM: (start, end) => ` — only ${start} to ${end}`,
    weggelatenPrefix: "Not shown here: ",
    weggelatenMaanden: (n) => `${n} month${n === 1 ? "" : "s"} without a statement`,
    weggelatenKlein: (n) => `${n} smaller categor${n === 1 ? "y" : "ies"}`,
    weggelatenGecapt: (n) => `${n} categor${n === 1 ? "y" : "ies"} outside the chart`,
    nietGetoondMaanden: (list) =>
      `Not shown: ${list} — no statement was imported for them. An empty month is not a month without spending.`,
    kleinereCategorieenNietGetoond: (n, range, small, threshold, days) =>
      `${n} smaller categor${n === 1 ? "y" : "ies"} not shown in ${range}: together ${small}, each under ${threshold} over these ${days} days. A shorter period sets that limit lower.`,
    nogNCategorieenBuitenGrafiek: (n, list) =>
      `${n} more categor${n === 1 ? "y" : "ies"} outside the chart: ${list}.`,
    tegenoverEerdereMaanden: (month) => `${month} against your earlier months.`,
    welkeDagenSummary: "Which days were compared with which",
    heleMaandNaast: (n) => `The whole month, against the ${n} full months before it.`,
    deelmaandNaast: (range, days, n) =>
      `This month is still running: ${range} is ${days} days, compared with the same first ${days} days of the ${n} months before it.`,
    kortePeriodesTellenNiet: (n, days) =>
      ` ${n} month${n === 1 ? "" : "s"} ${n === 1 ? "doesn't" : "don't"} count — shorter than ${days} days.`,
    nogGeenVergelijkingGeenTx: (month) =>
      `No comparison with your own months yet — there is no transaction yet in ${month}.`,
    volledigeMaandenCount: (n, month) =>
      n === 0
        ? `there is no full month before ${month}`
        : n === 1
          ? `there is 1 full month before ${month}`
          : `there are ${n} full months before ${month}`,
    nogGeenVergelijkingTeWeinig: (month, countPhrase, min) =>
      `No comparison with your own months yet: ${countPhrase} imported, and a place in your own history needs at least ${min}. Importing older statements fills this in.`,
    position: {
      geenGegevens: "this month hasn't been measured yet",
      teWeinigGeschiedenis: "too few earlier months to place it",
      nieuweCategorie: "new — no earlier month with this category",
      teKortBekend: (n) => `only ${n} month${n === 1 ? "" : "s"} known, too few to place it`,
      geenVerschilZero: (n) => `no spending here, and none in your last ${n} months either`,
      geenVerschilGelijk: (n) => `the same as in all your last ${n} months`,
      hogerDanAl: (n) => `higher than all your last ${n} months`,
      lagerDanAl: (n) => `lower than all your last ${n} months`,
      hogerDanN: (higher, n) => `higher than ${higher} of your last ${n} months`,
      lagerDanN: (lower, n) => `lower than ${lower} of your last ${n} months`,
    },
    verdelingGeenUitgaven: "No spending in this period — choose a longer period.",
    gegroeidGeenNietsOmTeVergelijken: "Nothing to compare yet — choose a longer period.",
    steegHetHardst: (delta, days) => `rose the most: ${delta} more than the ${days} days before it`,
    pctDeel: (pct) => ` (${pct}%)`,
    nieuwDeel: " (new)",
    overigCategorieLabel: "Other",
    nietsGestegen: (days) => `Nothing has gone up compared with the ${days} days before it.`,
    verschilSeriesLabel: "Difference",
    verschilAria: (days) => `Difference per category compared with the ${days} days before it`,
    welkePeriodeSummary: "Which period it's compared with, and what counts",
    vergelekenMet: (beforeStart, beforeEnd) =>
      `Compared with ${beforeStart} — ${beforeEnd}, the same length as the chosen period. Spending only.`,
    geenUitgavenOmWeekpatroon: "No spending yet to draw a weekly pattern from.",
    pasNDagenGeschiedenisWeekdag: (days, min) =>
      `Only ${days} day${days === 1 ? "" : "s"} of history in this period — a weekday pattern needs at least ${min} days, otherwise every average is a single observation.`,
    geenWeekdagSpringtEruit: "No weekday stands out — no spending has been measured yet.",
    kostGemiddeldSuffix: " costs you an average of ",
    pctMeerDanGewoneDag: (pct) => ` — ${pct}% more than a normal day`,
    gemiddeldeUitgavenPerWeekdagAria: "Average spending per weekday",
    gewoneDagLabel: "normal day",
    waaropDitGemiddeldeRust: (days) => `What this average is based on: ${days} days`,
    gemetenOverNDagen: (days) =>
      `Measured over ${days} days — every occurrence of that weekday counts, including days without a transaction.`,
    buitenDezeCijfersGehouden: (amount) => `Kept out of these figures: ${amount}`,
    movedRow: (amount, categorie, why, inAmountSuffix) =>
      `${amount} in ${categorie} — ${why}${inAmountSuffix}`,
    movedInSuffix: (inAmount) => ` (of which ${inAmount} came back)`,
    movedFooter: " That is not spending: it is the same euro in a different place.",
    buitenDezeCijfersConvert: (count, perCurrencyList) =>
      `Outside these figures: ${count} transaction${count === 1 ? "" : "s"}, no rate yet (${perCurrencyList}).`,
    buitenDezeCijfersSeparate: (count, perCurrencyList) =>
      `Outside these figures: ${count} transaction${count === 1 ? "" : "s"} in a foreign currency (${perCurrencyList}).`,
    vreemdeValutaOmgerekend: "Foreign currency converted via the ECB rate of the day.",
    inkomstenInDezePeriode: "Income in this period",
    uitgavenInDezePeriode: "Expenses in this period",
    gemiddeldPer: (amount, unit) => `average ${amount} per ${unit}`,
    waaroverDezeTweeGemiddeldenGaan: (units, unitPlural) =>
      `What these two averages are based on: ${units} whole ${unitPlural}`,
    gedeeldDoor: (units, unitPlural, range) =>
      `Divided by ${units} whole ${unitPlural}: ${range}. Money that only changed place doesn't count, just like in the rest of this block.`,
    restDagenTellenNiet: (days, unit) =>
      `${days} day${days === 1 ? "" : "s"} at the edges don't count — a partial ${unit} is not a whole ${unit}. If they did count, this average would depend on whether a fixed payment fell just before the end of the period.`,
    nietPerAskedUnit: (askedUnit, min) =>
      `Not per ${askedUnit}: this period doesn't contain ${min} whole ones. Averaging over a single ${askedUnit} just gives you that ${askedUnit}'s own amount.`,
    gemiddeldeDagFallback: "average day",
    adviesLangerePeriode: "A longer period picks up the rest of your statements.",
    adviesOudereAfschriften: "Importing older statements fills this in.",
    geenGemiddeldeGeenTransacties: (advies) =>
      `No average yet: this period has no transaction at all. ${advies}`,
    geenGemiddeldeTeKortAfschrift: (coveredDays, min, advies) =>
      `No average yet: this period has ${coveredDays} day${
        coveredDays === 1 ? "" : "s"
      } of statement, and averaging needs at least ${min}. ${advies}`,
  },
  aandacht: {
    waarschuwOnderBuffer: "Warn below buffer €",
    waarschuwingsbufferAria: "Warning buffer in euros",
    bufferZeroNote:
      "Your buffer is set to €0, so you will only hear something once your expected balance drops below zero. Set an amount to be warned earlier.",
    nietsGevondenOmJeOpTeWijzen: "Nothing found that needs your attention.",
    lavegaKeekNaar: (checksJoined) =>
      `LaVega checked: ${checksJoined}. That is only as complete as what you have imported — LaVega can't say anything about an account that isn't in it.`,
    checks: [
      "an expected shortfall against your buffer",
      "a recurring payment or income that hasn't arrived",
      "VAT (BTW) and tax deadlines within 30 days",
      "manually tracked balances that are out of date",
      "accounts without a balance",
    ],
    kritiek: "Critical",
    letOp: "Attention",
    terInfo: "Info",
    toonNTerInfo: (n) => `Show ${n} for info`,
    alert: {
      title: (b) => {
        switch (b.kind) {
          case "shortfall":
            return "Expected shortfall";
          case "missed-stream":
            return `Expected ${b.sign === 1 ? "income" : "payment"} not seen`;
          case "vat-due":
            return `${b.label} — pay before ${b.dueDate}`;
          case "tax-prepayment-due":
            return `${b.label} — pay before ${b.dueDate}`;
          case "tracking-stale":
            return `${b.label} — update balance`;
          case "no-balance":
            return "Unknown balance";
        }
      },
      detail: (b) => {
        switch (b.kind) {
          case "shortfall":
            return `Around ${b.date} your balance drops to ${formatEuroIn("en", b.balanceCents / 100)} — below your buffer of ${formatEuroIn("en", b.bufferCents / 100)}.`;
          case "missed-stream": {
            const noun = b.sign === 1 ? "Income" : "Payment";
            const prep = b.sign === 1 ? "from" : "to";
            return `${noun} ${prep} ${b.counterparty} (~${formatEuroIn("en", b.amountCents / 100)}) was expected around ${b.expectedDate}, but hasn't arrived yet.`;
          }
          case "vat-due":
            return `Set aside ${formatEuroIn("en", b.amountCents / 100)}; the VAT return and payment are due by ${b.dueDate} (in ${b.days} day${b.days === 1 ? "" : "s"}).`;
          case "tax-prepayment-due":
            return `Set aside ${formatEuroIn("en", b.amountCents / 100)}; this corporate tax prepayment must be paid by ${b.dueDate} (in ${b.days} day${b.days === 1 ? "" : "s"}).`;
          case "tracking-stale":
            return `Last updated on ${b.updatedAt} (${b.ageDays} day${b.ageDays === 1 ? "" : "s"} ago). ${b.question}`;
          case "no-balance":
            return `${b.count} account${b.count > 1 ? "s" : ""} without a balance — fill it in under Accounts for a complete picture.`;
        }
      },
    },
  },
  kaarten: {
    title: "Cards",
    rekeningenArrow: "Accounts →",
    geenRekeningenGekoppeld: "No accounts linked yet — import a file or link a bank.",
    onbekendeBank: "Unknown bank",
    geenIbanBekend: "no IBAN known",
    opNaamVan: "In the name of",
    geenEntiteitIngesteld: "no entity set",
    saldoLabel: "Balance",
    onbekend: "unknown",
    cardAria: (bank, type) => `${bank} · ${type}`,
  },
  facturen: {
    facturenArrow: "Invoices →",
    vanNFacturenBedragOnbekend: (n) =>
      `For ${n} invoice${n === 1 ? "" : "s"} the amount in euros is unknown; ${n === 1 ? "it isn't" : "they aren't"} included in the amounts above.`,
    nietsStaatOpen: (total) =>
      `Nothing is outstanding — all ${total} invoice${total === 1 ? "" : "s"} LaVega knows about are paid or expired.`,
    openstaand: "outstanding",
    geenEnkeleOpenstaandeFactuurOverVervaldatum: "No outstanding invoice is past its due date.",
    teOntvangen: "Receivable",
    teBetalen: "Payable",
    bedragOnbekend: "amount unknown",
    sideRowCount: (n) => `${n} invoice${n === 1 ? "" : "s"}`,
    lateSentence: (total, parts) =>
      `${total} invoice${total === 1 ? " is" : "s are"} past due date${parts}.`,
    teOntvangenAmount: (amount) => `${amount} receivable`,
    teBetalenAmount: (amount) => `${amount} payable`,
  },
  btw: {
    title: "VAT",
    belastingArrow: "Tax →",
    geenBedrag: "no amount",
    direction: { betalen: "payable", terugvragen: "reclaimable", onbekend: "direction unknown" },
    shortBasis: {
      manual: "your own amount",
      sheet: "your bookkeeping",
      invoices: "your invoices",
      proxy: "a margin estimate from your bank transactions",
    },
    bronPrefix: (basis) => `Source: ${basis}. `,
    uiterlijk: (deadline) => `by ${deadline}`,
    looptNogTm: (end) => ` · still running through ${end}`,
    nogNAndereOnderneming: (n) =>
      ` ${n} more compan${n === 1 ? "y" : "ies"} — Tax shows them separately. LaVega does not add them together here: they can have a different scheme and a different filing period, and a sum like that would not belong to any one period.`,
    regelsPer: (date) => ` · rules as of ${date}.`,
    entiteitPrefix: (entiteit) => `${entiteit} · `,
    note: {
      geenFactuurEnkele: (entiteit) =>
        `No invoice from ${entiteit} in this period — the only one LaVega knows falls outside it.`,
      geenFactuurMeerdere: (entiteit, buiten) =>
        `No invoice from ${entiteit} in this period; ${buiten} fall outside it.`,
      stelselOnbekend: (entiteit) =>
        `No choice has been made for ${entiteit} between invoice-based and cash-based accounting. Under invoice-based accounting the VAT falls in the period of the invoice, under cash-based in the period of the payment — that really does change the amount, so LaVega does not name a figure here. You choose the scheme under Tax.`,
      btwOnbekendOpFacturen: (missing, total) =>
        `For ${missing} of the ${total} invoices in this period the VAT amount is unknown, so your invoices are not the basis here.`,
      gemengdeTarieven:
        "Mixed rates: LaVega does not calculate anything here, and does not set a zero either.",
      kasstelsel:
        "Cash-based accounting: the VAT falls in the period of the payment, not the invoice, so your invoices are not the basis here.",
      omzetfacturenOnbekend:
        "This period only has purchase invoices; LaVega cannot see the VAT on your revenue.",
      voorbelastingOnbekend:
        "No purchase invoice with a VAT amount in this period, so the input VAT is unknown.",
      boekhoudingAnderePeriode:
        "Your imported bookkeeping does not fully cover this period, so LaVega does not use it partially.",
      geenBanktransacties: (entiteit) =>
        `LaVega sees no transactions from ${entiteit} in this period. That is not a zero: there is nothing to read a figure from.`,
    },
  },
  bankLink: {
    zakelijk: "Business",
    particulier: "Personal",
    typeRekeningAria: "Account type",
    ofKoppelJeBankDirect: "Or link your bank directly",
    laden: "Loading…",
    koppelBankEnableBanking: "Link bank (Enable Banking)",
    geenBankenBeschikbaar: "No banks available.",
    doorsturen: "Redirecting…",
    autoriseer: "Authorise",
    bankkoppelingError: (message) => `Bank link: ${message}`,
    alleenLezenToegang:
      "Read-only access via Enable Banking — you authorise with your own bank; data arrives encrypted in your own vault.",
    bankGeenAutorisatiepagina: "The bank did not return an authorisation page.",
  },
  betaalschema: {
    title: "Payment schedule",
    status: { expected: "expected", confirmed: "confirmed", paid: "paid", cancelled: "cancelled" },
    cadence: {
      wekelijks: "weekly",
      elke2Weken: "every 2 weeks",
      maandelijks: "monthly",
      tweemaandelijks: "every two months",
      elkKwartaal: "quarterly",
      halfjaarlijks: "every six months",
      jaarlijks: "yearly",
      elkeNDagen: (days) => `every ${days} days`,
    },
    xGezien: (n) => `${n}× seen`,
    datumAlVerstreken: (n) => `${n} date${n === 1 ? "" : "s"} already passed. `,
    regelVoorspeld: (n) =>
      `${n} row${n === 1 ? "" : "s"} predicted from your own history, not confirmed.`,
    alleRegelsIngepland: "All rows are scheduled amounts.",
    nietsIngepland:
      "Nothing scheduled yet — your VAT (BTW) set-asides, outstanding invoices and recognised fixed costs will show up here.",
    voorspeldTag: "predicted",
    teLaatSuffix: " · overdue",
  },
  recenteTransacties: {
    title: "Recent transactions",
    zoekPlaceholder: "Search by name or category",
    zoekenAria: "Search recent transactions",
    bekijkAlles: "View all →",
    nogGeenTransacties: "No transactions yet.",
    geenTransactieGevondenVoor: (query) => `No transaction found for “${query}”.`,
    onbekendeTegenpartij: "Unknown counterparty",
    bekijkTransactiesIn: (categorie) => `View transactions in ${categorie}`,
  },
  topUitgaven: {
    title: "Top spending",
    nogGeenUitgavenDezeMaand: "No spending yet this month.",
    nietVergelijkbaar: (month, prev) =>
      `${month} and ${prev} cannot be compared: no account has data in both months.`,
    erStaatWelUitgaven: (amount) =>
      ` There is, however, ${amount} of spending in these two months.`,
    importeerBeideMaanden:
      "Import both months for the same accounts, and the comparison will appear here.",
    maandTOvPrev: (month, prev) => `${month} vs. ${prev}`,
    aandeelEnDeltaTOv: (month, prev) => `${month} · share & Δ vs. ${prev}`,
    telDagenTotNuToe: (month, observed, inMonth) =>
      `${month} counts ${observed} of ${inMonth} days so far.`,
    rekeningenBuitenVergelijking: (n, amount) =>
      `${n} account${n === 1 ? "" : "s"} ${n === 1 ? "stays" : "stay"} outside the comparison — ${n === 1 ? "it has" : "they have"} no data in both months (${amount} of spending).`,
    bekijkTransactiesIn: (categorie) => `View transactions in ${categorie}`,
    nieuwDelta: "new",
  },
};

export const moneyCopy: Record<Locale, MoneyCopy> = { nl, en };

/** Display labels for the fixed CATEGORY_OPTIONS taxonomy in @lavega/core
 *  (categorize.ts) — see that file's own comment on why these exact Dutch
 *  strings cannot change: Tx.category/Rule.category store them verbatim, the
 *  rules engine matches on them, and the AI-categorize contract
 *  (apps/server/.../categorize.md) both returns and validates against them.
 *  This table is DISPLAY ONLY. `nl` is byte-identical to the key on purpose,
 *  so a stored value and its Dutch label can never drift apart by a typo
 *  here. A category outside this table (a hand-edited import, data from
 *  before a taxonomy change) is shown as typed rather than blanked. */
export const CATEGORY_LABELS: Record<string, { nl: string; en: string }> = {
  Boodschappen: { nl: "Boodschappen", en: "Groceries" },
  "Eten & drinken": { nl: "Eten & drinken", en: "Eating out" },
  Transport: { nl: "Transport", en: "Transport" },
  Reizen: { nl: "Reizen", en: "Travel" },
  "Wonen & energie": { nl: "Wonen & energie", en: "Housing & energy" },
  Abonnementen: { nl: "Abonnementen", en: "Subscriptions" },
  Verzekeringen: { nl: "Verzekeringen", en: "Insurance" },
  Gezondheid: { nl: "Gezondheid", en: "Health" },
  "Kleding & winkelen": { nl: "Kleding & winkelen", en: "Clothing & shopping" },
  "Online shopping": { nl: "Online shopping", en: "Online shopping" },
  Elektronica: { nl: "Elektronica", en: "Electronics" },
  Entertainment: { nl: "Entertainment", en: "Entertainment" },
  "Huis & tuin": { nl: "Huis & tuin", en: "Home & garden" },
  Huisdieren: { nl: "Huisdieren", en: "Pets" },
  "Goede doelen": { nl: "Goede doelen", en: "Charity" },
  Bankkosten: { nl: "Bankkosten", en: "Bank fees" },
  "Belastingen & overheid": { nl: "Belastingen & overheid", en: "Taxes & government" },
  Geldopname: { nl: "Geldopname", en: "Cash withdrawal" },
  "Sparen & beleggen": { nl: "Sparen & beleggen", en: "Savings & investing" },
  Overboekingen: { nl: "Overboekingen", en: "Transfers" },
  "Tussen personen": { nl: "Tussen personen", en: "Between people" },
  "Creditcard afbetaald": { nl: "Creditcard afbetaald", en: "Credit card payment" },
  "Automatische incasso": { nl: "Automatische incasso", en: "Direct debit" },
  "Eigen overboeking": { nl: "Eigen overboeking", en: "Own transfer" },
  Inkomen: { nl: "Inkomen", en: "Income" },
};

/** The Dutch stored category (or the "onbekend" categorize() returns for a
 *  row nothing placed — never itself a stored value, see recategorize's
 *  contract in categorize.ts) as the reader's language. Falls back to the
 *  input unchanged for anything outside the table, so a legacy or
 *  hand-edited value is shown as typed rather than blanked. */
export function categoryLabel(locale: Locale, category: string): string {
  if (category === "onbekend") return moneyCopy[locale].transacties.onbekendLabel;
  return CATEGORY_LABELS[category]?.[locale] ?? category;
}
