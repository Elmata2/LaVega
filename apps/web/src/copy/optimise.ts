import type { Locale } from "../locale.js";
import type { HeldCashbackDescription } from "@lavega/core";
import type {
  CrossScopeEvidence,
  CrossScopeKind,
  EntityScope,
  NoAssumptionReason,
  StoreNote,
  TravelCaveat,
  WithdrawalComponent,
} from "@lavega/core";
import { formatEuroIn, localeTag } from "../format.js";

/**
 * Copy for the Optimalisatie screen (apps/web/src/views/Optimalisatie.tsx).
 *
 * This view is far more dynamic than the landing page: most user-facing text
 * is a sentence built from a fixed template plus numbers/dates/percentages
 * the view already formats (via `euro`/`pct`/`formatEuro`/`monthLabelNL` today,
 * `formatEuroIn`/`formatCurrencyIn`/`monthLabel`/`formatDate` after the
 * bilingual pass). So every template below takes its variable parts as
 * ALREADY-FORMATTED STRINGS (or plain counts for pluralisation) — this module
 * does no currency/date formatting itself and needs no imports. The view
 * keeps the job of calling the formatter and picking which branch applies;
 * this module only owns the words around the numbers.
 *
 * Two kinds of entries:
 *   - a plain string: static chrome (headings, table headers, buttons, badges).
 *   - a function: a sentence with blanks, named after its parameters.
 *
 * `nl` is byte-identical to what is on screen today. `en` is a natural
 * rewrite for the same reader, not a literal translation.
 *
 * A handful of sentences wrap one figure in `<strong>` on screen. Those
 * entries return a `Segment[]` instead of a `string` — the view renders it
 * with a small `renderSegments` helper — so the emphasis survives without
 * this module reaching for JSX itself.
 */

export type Segment = string | { bold: string };

export type OptimalisatieCopy = {
  header: {
    title: string;
    eyebrow: string;
    /** Accessible name for the `ModuleGrid` region — the same word as the nav's screen label. */
    gridLabel: string;
  };

  kpis: {
    subscriptions: { label: string; eyebrow: (amount: string, unit: string, unknownCount: number) => string };
    priceIncreases: { label: string; eyebrow: string };
    overlaps: { label: string; eyebrow: string };
    interest: { label: string; eyebrowNoNet: string; eyebrowWithNet: string };
  };

  /** Small pieces reused across two or more modules. */
  common: {
    perUnit: (unit: "maand" | "jaar") => string;
    dash: string;
    assumedBadge: string;
    altKindLabel: Record<"prepaid" | "crypto", string>;
    subscriptionWord: (n: number) => string;
    accountWord: (n: number) => string;
    cardWord: (n: number) => string;
    rateWord: (n: number) => string;
    /** An account balance the source doesn't state — not a zero. */
    unknownBalance: string;
    /** The gain word in `productCost.noRecommendation.body`, per module. */
    moreInterestWord: string;
    moreCashbackWord: string;
    moreCashbackThisMonthWord: string;
    /** The cost word in the same sentence, per product noun. */
    accountCostWord: string;
    cardCostWord: string;
    /** Why LaVega won't assume zero cashback for this product. Shared with the
     *  travel block (`TravelCopy`), which answers the same question about a
     *  card he might open — one wording, so the two screens can't disagree. */
    noAssumptionReason: Record<NoAssumptionReason, string>;
  };

  subscriptions: {
    title: string;
    periodAriaLabel: string;
    periods: { eigen: string; maand: string; jaar: string };
    periodLabelFallback: string;

    footerEmpty: string;
    footerWithSubs: (p: {
      count: number;
      total: string;
      unit: string;
      unknownCount: number;
      noChanges: boolean;
    }) => string;

    coverage: {
      noHistory: string;
      withHistory: (p: { days: number; first: string; last: string; cadences: string }) => Segment[];
      cadencesFallback: string;
      hiddenSuffix: (hiddenList: string) => string;
      hiddenCadenceItem: (cadence: string, days: number) => string;
    };

    empty: {
      heading: string;
      intro: string;
      noOutflows: string;
      withOutflows: (p: {
        outflows: number;
        merchants: number;
        repeated: number;
        dateRange: string;
      }) => Segment[];
      dateRange: (first: string, last: string) => string;
      rulesIntro: string;
      rules: [string, string, string, string];
      talliesSummary: (count: number) => string;
      talliesTableHeaders: [string, string, string, string, string, string, string];
      noNameFallback: string;
      gapDaysSuffix: (days: number) => string;
      includedYes: string;
      excludedTransferOrPerson: string;
      excludedNoName: string;
      reasonFallback: string;
      talliesFootnote: string;
      housingExcludedOne: string;
      housingExcludedMany: (count: number) => string;
      housingExcludedTail: string;
      missingAccountNote: string;
      demoDisclosureSummary: string;
      demoBadge: string;
      demoTableHeaders: [string, string, string, string];
      /** The "Functie"/"Category" cell for each of the four worked-example rows (Netflix, Spotify, Adobe Creative Cloud, Odido). */
      demoCategories: [string, string, string, string];
      demoNoChange: string;
    };

    increaseSentence: (p: {
      name: string;
      fromAmount: string;
      toAmount: string;
      changePct: number;
      unit: string;
      extra?: { amount: string; sum?: string };
      cadence?: string;
    }) => string;

    overlapSentence: (p: {
      count: number;
      functionName: string;
      names: string;
      total: string;
      unit: string;
      cancelAmount?: string;
    }) => string;

    tableHeaders: (periodLabel: string) => [string, string, string, string, string, string];
    unrekenbaarCell: string;

    /** Het ritme in woorden. `elkeNDagen` is de terugval die een onbekend ritme
     *  noemt in plaats van het te verzwijgen. */
    cadence: {
      maandelijks: string;
      tweemaandelijks: string;
      perKwartaal: string;
      halfjaarlijks: string;
      jaarlijks: string;
      elkeNDagen: (days: number) => string;
    };

    convertedPanel: {
      summary: (converted: number, total: number) => string;
      explanation: (unit: string) => string;
      item: (p: { name: string; lastAmount: string; cadence: string; sum: string; result: string; unit: string }) => string;
    };
  };

  interest: {
    title: string;
    footerNone: string;
    footerWithBest: (p: {
      bank: string;
      keptLabel: string;
      promo?: { bank: string; pct: string };
      sourceLabel: string;
      asOf: string;
    }) => string;

    leadSentence: (p: { amount: string; showNetSuffix: boolean }) => Segment[];
    toonMeerSummary: string;
    suggestionSentence: (p: {
      balance: string;
      accountLabel: string;
      ratePct: string;
      bestBank: string;
      bestKeptLabel: string;
      diffPct: string;
      extra: string;
    }) => string;

    empty: {
      heading: string;
      explanation: string;
      noSaldoItem: (count: number) => string;
      noRateItem: (count: number) => string;
      bestKnown: (p: { keptPct: string; bank: string; marginPct: string }) => string;
      noRatesKnown: string;
    };

    promo: {
      badge: string;
      headline: (p: { bank: string; pct: string }) => string;
      tailUnknownAfter: string;
      tailKeptAfter: (kept: string) => string;
      tailNotePrefix: (note: string) => string;
      extraPerMonth: (amount: string, bank: string) => string;
    };

    tableHeaders: { rekening: string; saldo: string; rentePct: string; bron: string; mogelijkPerJaar: (vsKept?: string) => string };
    rateCellAriaLabel: (accountName: string) => string;
    rateCellUnknownPlaceholder: string;

    sourceLabels: Record<"manual" | "detected" | "benchmark" | "assumed" | "unknown", string>;
    /** How the public rate benchmark itself was fetched (`RatesResult["source"]`) — distinct from `sourceLabels`, which is per-account. */
    ratesSourceLabels: Record<"live" | "cache" | "bundled", string>;
    benchmarkSourceNote: (p: { bank: string; product: string; pct: string; asOf: string }) => string;
    assumedZeroNote: (p: { bank: string; pct: string; product: string; asOf: string }) => string;
    assumedZeroQuestion: string;

    benchmarkDetails: {
      summary: (p: { count: number; sourceLabel: string; asOf: string }) => string;
      tableHeaders: [string, string, string, string];
      capitalAtRiskTooltip: string;
      capitalAtRiskFootnote: string;
      unknownKept: string;
      sameAsHeadline: string;
      noPromo: string;
      /** Het actietarief in de badge. De Nederlandse tak citeert de zin uit de
       *  voorwaarden van de bank; de Engelse bouwt hem op uit de structuur,
       *  precies zoals de hoofdzin dat al deed — een geciteerde Nederlandse
       *  bijzin midden in een Engels scherm is geen citaat meer maar ruis. */
      promoThen: (standardPct: string) => string;
      promoPlain: string;
      explanation: (p: { sourceLabel: string; asOf: string }) => string;
      refreshButton: string;
      refreshingButton: string;
      refreshNote: string;
      offlineNote: string;
    };
  };

  cashback: {
    title: string;
    footer: string;

    /** Appended after `productCost.unknownCost.footnote` for the cashback card
     *  whose own cost is unknown, pointing at the Kosten module. */
    unknownTail: string;

    routingSentence: (p: { toBank: string; fromBank: string; toPct: string; fromPct: string; approximate: boolean; amount: string }) => {
      main: Segment[];
      tail: string;
    };

    answerLine: (p: {
      product: string;
      bank?: string;
      pct: string;
      ownPct: string;
      assumed: boolean;
      altKind?: string;
      extra: string;
    }) => string;

    conditions: { summary: string; sourceLine: (url: string, asOf: string) => string };

    emptyReasons: {
      noAccounts: string;
      cannotAssume: string;
      tooLittleHistory: (minDays: number) => string;
      noCatalogueCards: string;
      alreadyBest: string;
    };

    openGapsSentence: (products: string) => string;
    openGapsCallToAction: { searchLink: string; profileLink: string };

    onderbouwing: {
      toonMeerSummary: string;
      ownCardLabel: string;
      bestCardLabel: string;
      bestCardMeta: (product: string, asOf: string) => string;
      perMonthSuffix: string;
      assumedNote: (p: {
        bankOrProduct: string;
        checkedNote: string;
        dueForReview: boolean;
      }) => string;
      assumedCheckedNote: (issuerFamily: string, date: string) => string;
      assumedNeverCheckedNote: (issuerFamily: string) => string;
      diffLabel: string;
      diffSub: string;
      diffAmount: (perMonth: string, perYear: string) => string;
      baseSentence: (p: { upperBound: boolean; amount: string; days: number }) => string;
      explanation: string;
      upperBoundNote: string;
    };

    routingBasis: {
      heading: string;
      sentence: (p: { toBank: string; fromBank: string; upperBound: boolean; amount: string; measuredDays?: number }) => string;
      approxNote: string;
    };

    lastMonthCompare: {
      heading: (month: string) => string;
      summaryTail: (spent: string, diff: string, bank: string) => string;
      spentLabel: string;
      ownCardLabel: (pct: string) => string;
      bestCardLabel: (product: string, pct: string) => string;
      footnote: string;
    };

    noOrdinaryCard: (count: number) => string;

    perCardSourceHeading: (count: number) => string;

    otherOffers: {
      headingWithUpgrade: string;
      headingWithoutUpgrade: string;
      subtitle: string;
      itemMeta: (asOf: string) => string;
    };

    /** Renders `describeHeldCashback`'s `HeldCashbackDescription` — core stopped
     *  building this sentence itself (assumedCashback.ts) so it could stop
     *  hardcoding "nl-NL" and Dutch words for a screen that is now bilingual. */
    heldCashback: {
      measuredByUser: (pct: string, date: string) => string;
      measuredByAgent: (pct: string, date: string) => string;
      assumptionOff: string;
      assumedNoCashback: string;
      unknown: (reason: string) => string;
    };
  };

  costs: {
    title: string;
    footer: string;

    totalComplete: (amount: string, accountCount: number) => string;
    totalIncomplete: (p: { known: number; total: number; amount: string; unknown: number }) => string;
    totalNone: string;

    freeAccountWithConditions: (label: string, conditions: string) => string;
    freeAccountNoConditions: (label: string) => string;

    unknownAccountLead: (bank: string, accountName: string) => string;
    unknownReasons: {
      noBank: string;
      providerUnknown: (bank: string) => string;
      noCandidates: (bank: string) => string;
      unclearProduct: (bank: string) => string;
    };

    freeAtBank: {
      heading: (bank: string) => string;
      item: (product: string, feeLabel: string, conditions: string) => string;
      defaultConditionNote: string;
      matchHint: string;
      sourceSummary: (count: number) => string;
      sourceItem: (product: string, host: string, asOf: string) => string;
    };

    tips: {
      sentence: (p: { label: string; heldLabel: string; currentFee: string; altProduct: string; altFee: string; saving: string }) => string;
      atProviderLabel: string;
      elsewhereLabel: string;
      conditionalNote: (conditions: string) => string;
      noConditionNote: string;
    };

    detailsToonMeer: {
      summary: string;
      tableHeaders: [string, string, string, string];
      unknownCost: string;
      notInTotal: string;
      sameFeeNote: (count: number) => string;
      conditionLabel: string;
      candidatesHeading: (count: number, bank: string) => string;
      matchHint: string;
      noSource: string;
      sourcesHeading: string;
      sourceLine: (bank: string, url: string, asOf: string) => string;
      altSourceLine: (product: string, url: string, asOf: string) => string;
    };
  };

  /** The shared "Productkosten" component — used by Rente, Cashback and the
   *  last-full-month Cashback comparison, always with a `noun` ("kaart" /
   *  "rekening") that names what the price belongs to. */
  productCost: {
    unknownCost: {
      heading: (noun: string) => string;
      reasonNeedsAnotherProduct: (noun: string) => string;
      reasonNoSource: string;
      footnote: string;
    };
    costLine: {
      heading: (noun: string) => string;
      sumNote: (amount: string) => string;
    };
    netLine: {
      heading: string;
      subtitle: string;
      alsoMonthlyPrefix: (perMonth: string) => string;
    };
    noRecommendation: {
      heading: string;
      body: (gross: string, per: string, gainWord: string, cost: string, costWord: string) => string;
      noGain: string;
      loss: (per: string, loss: string) => string;
      footer: (noun: string) => string;
    };
    spanWords: {
      recurring: (period: string) => string;
      oneOffYear: (n: number) => string;
      oneOffMonth: (n: number) => string;
    };
  };
};

const optimalisatieCopy_nl: OptimalisatieCopy = {
  header: {
    title: "Wat je geld laat liggen",
    eyebrow: "abonnementen & rente",
    gridLabel: "Optimalisatie",
  },

  kpis: {
    subscriptions: {
      label: "Abonnementen",
      eyebrow: (amount, unit, unknownCount) =>
        `${amount} ${unit}${unknownCount > 0 ? ` · ${unknownCount} zonder ritme niet meegeteld` : ""}`,
    },
    priceIncreases: { label: "Prijsstijgingen", eyebrow: "herkend" },
    overlaps: { label: "Dubbele functies", eyebrow: "overlap" },
    interest: {
      label: "Rente laten liggen",
      eyebrowNoNet: "per jaar",
      eyebrowWithNet: "per jaar, vóór rekeningkosten",
    },
  },

  common: {
    perUnit: (unit) => `per ${unit}`,
    dash: "—",
    assumedBadge: "aangenomen",
    altKindLabel: { prepaid: "prepaidkaart", crypto: "cryptokaart" },
    subscriptionWord: (n) => (n === 1 ? "abonnement" : "abonnementen"),
    accountWord: (n) => (n === 1 ? "rekening" : "rekeningen"),
    cardWord: (n) => (n === 1 ? "kaart" : "kaarten"),
    rateWord: (n) => (n === 1 ? "tarief" : "tarieven"),
    unknownBalance: "onbekend",
    moreInterestWord: "meer rente",
    moreCashbackWord: "meer cashback",
    moreCashbackThisMonthWord: "meer cashback in die maand",
    accountCostWord: "rekeningkosten",
    cardCostWord: "kaartkosten",
    noAssumptionReason: {
      verkoopargument:
        "Bij prepaid- en cryptokaarten is cashback juist het verkoopargument, dus daar mag LaVega geen nul aannemen.",
      beloningsuitgever:
        "Deze uitgever verkoopt zijn kaarten op wat je ermee verdient, dus wat je terugkrijgt verschilt per kaart en staat hier niet vast.",
      "geen-betaalproduct":
        "Bij dit soort rekening hoort geen kaart, dus er valt geen cashback op te geven.",
      "uitgever-buiten-de-aanname":
        "Deze aanbieder verkoopt betaalde niveaus met extraatjes, dus nul aannemen zou een gok zijn.",
      "soort-onbekend":
        "LaVega weet niet wat voor product dit is, en zonder dat is er niets om op te steunen.",
    },
  },

  subscriptions: {
    title: "Abonnementen",
    periodAriaLabel: "Eenheid van de abonnementsbedragen",
    periods: { eigen: "Zoals afgeschreven", maand: "Per maand", jaar: "Per jaar" },
    periodLabelFallback: "Bedrag",

    footerEmpty: "Herkend uit je eigen transacties — er wordt niets bijverzonnen.",
    footerWithSubs: ({ count, total, unit, unknownCount, noChanges }) =>
      `${count} ${count === 1 ? "abonnement" : "abonnementen"} · samen ${total} ${unit}` +
      (unknownCount > 0
        ? ` · ${unknownCount} ${unknownCount === 1 ? "abonnement zit" : "abonnementen zitten"} hier niet in: ritme niet om te rekenen`
        : "") +
      "." +
      (noChanges ? " Geen prijsstijging en geen dubbele dienst gezien." : ""),

    coverage: {
      noHistory: "Nog geen uitgaande transacties, dus nog geen ritme om te herkennen.",
      withHistory: ({ days, first, last, cadences }) => [
        "LaVega kijkt over ",
        { bold: `${days}` },
        ` dagen afschrift (${first} – ${last}). Daarin is `,
        { bold: cadences },
        " herkenbaar.",
      ],
      cadencesFallback: "geen enkel ritme",
      hiddenSuffix: (hiddenList) =>
        ` Nog niet: ${hiddenList}. Een abonnement met zo'n ritme staat hier dus niet omdat de geschiedenis nog niet ver genoeg terugloopt — niet omdat het er niet is.`,
      hiddenCadenceItem: (cadence, days) => `${cadence} (vanaf ${days} dagen)`,
    },

    empty: {
      heading: "Nog geen abonnement herkend.",
      intro: "Dat is een meting, geen leeg scherm:",
      noOutflows: " er staan nog geen uitgaande transacties in LaVega.",
      withOutflows: ({ outflows, merchants, repeated, dateRange }) => [
        " LaVega zag ",
        { bold: `${outflows}` },
        ` uitgaande transacties${dateRange}, verdeeld over `,
        { bold: `${merchants}` },
        " ontvangers. Daarvan betaalde je er ",
        { bold: `${repeated}` },
        " minstens twee keer — en geen daarvan voldeed aan het patroon.",
      ],
      dateRange: (first, last) => ` tussen ${first} en ${last}`,
      rulesIntro: "Wat LaVega een abonnement noemt:",
      rules: [
        "minstens drie betalingen als het maandelijks is, twee als het per kwartaal, halfjaar of jaar gaat;",
        "een vast ritme: ongeveer maandelijks, per kwartaal of jaarlijks;",
        "een bedrag dat mag stijgen (dat is juist het signaal) maar niet wild springt;",
        "geen eigen overboeking of kaartafrekening.",
      ],
      talliesSummary: (count) => `Wat LaVega per ontvanger zag (${count} ontvangers, meest abonnement-achtige eerst)`,
      talliesTableHeaders: ["Ontvanger", "Keer", "Totaal", "Ritme", "Spreiding", "Meegenomen?", "Waarom niet"],
      noNameFallback: "(geen naam)",
      gapDaysSuffix: (days) => `${days} dg`,
      includedYes: "ja",
      excludedTransferOrPerson: "nee — gelezen als overboeking of persoon",
      excludedNoName: "nee — geen naam op de regel",
      reasonFallback: "—",
      talliesFootnote:
        "Een ritme rond 30, 61, 91, 182 of 365 dagen is bruikbaar; een spreiding boven 0,35 betekent dat het bedrag te wild springt. Staat je abonnement hier met een goed ritme en een lage spreiding en tóch niet in de lijst hierboven, dan is dat een fout van ons — stuur die regel door.",
      housingExcludedOne: "Eén terugkerende ontvanger staat hier niet bij",
      housingExcludedMany: (count) => `${count} terugkerende ontvangers staan hier niet bij`,
      housingExcludedTail: ": die zijn als vaste woonlast gelezen (huur, hypotheek, VvE), en die horen niet op dit scherm.",
      missingAccountNote:
        "Meestal ontbreekt de rekening waar ze vanaf gaan: importeer je creditcard of privérekening, dan verschijnen ze hier — inclusief prijsstijgingen en dubbele diensten.",
      demoDisclosureSummary: "Bekijk hoe dit eruitziet met gevulde data",
      demoBadge: "Voorbeeld — niet jouw data, en nergens opgeslagen",
      demoTableHeaders: ["Dienst", "Functie", "Per maand", "Verandering"],
      demoCategories: ["Videostreaming", "Muziekstreaming", "Software", "Telecom"],
      demoNoChange: "—",
    },

    increaseSentence: ({ name, fromAmount, toAmount, changePct, unit, extra, cadence }) =>
      `${name} ging van ${fromAmount} naar ${toAmount} (+${changePct}%) ` +
      (extra
        ? `— dat is ${extra.amount} ${unit} extra${extra.sum ? ` (${extra.sum})` : ""}.`
        : `— ${cadence} afgeschreven, dus wat dat ${unit} scheelt valt hier niet uit te rekenen.`),

    overlapSentence: ({ count, functionName, names, total, unit, cancelAmount }) =>
      `${count} × ${functionName}: ${names} — samen ${total} ${unit}.` +
      (cancelAmount ? ` Eén opzeggen scheelt tot ${cancelAmount} ${unit}.` : ""),

    tableHeaders: (periodLabel) => ["Dienst", "Functie", periodLabel, "Op je afschrift", "Verandering", "Laatst"],
    unrekenbaarCell: "niet om te rekenen",

    cadence: {
      maandelijks: "maandelijks",
      tweemaandelijks: "tweemaandelijks",
      perKwartaal: "per kwartaal",
      halfjaarlijks: "halfjaarlijks",
      jaarlijks: "jaarlijks",
      elkeNDagen: (days) => `elke ${days} dagen`,
    },

    convertedPanel: {
      summary: (converted, total) => `${converted} van de ${total} bedragen ${converted === 1 ? "is" : "zijn"} omgerekend uit een ander ritme`,
      explanation: (unit) =>
        `Een abonnement houdt de eenheid van zijn eigen afschrijving; wat je hierboven ziet is die afschrijving ${unit} gerekend. Naar jaar wordt alleen vermenigvuldigd, dus dat bedrag is exact. Naar maand wordt gedeeld, en dan bestaat het bedrag in de kolom op geen enkel afschrift.`,
      item: ({ name, lastAmount, cadence, sum, result, unit }) => `${name}: ${lastAmount} ${cadence} → ${sum} = ${result} ${unit}`,
    },
  },

  interest: {
    title: "Rente",
    footerNone: "Geen vergelijkingsrente beschikbaar.",
    footerWithBest: ({ bank, keptLabel, promo, sourceLabel, asOf }) =>
      `Beste rente die je houdt: ${bank} ${keptLabel}` +
      (promo ? ` · hoogste actietarief nu: ${promo.bank} ${promo.pct}` : "") +
      ` · ${sourceLabel}, peildatum ${asOf}.`,
    leadSentence: ({ amount, showNetSuffix }) => [
      "Verplaatsen levert je ",
      { bold: amount },
      ` per jaar op${showNetSuffix ? ", vóór wat die rekening zelf kost" : ""}.`,
    ],
    toonMeerSummary: "Per rekening, en wat de nieuwe rekening zelf kost",
    suggestionSentence: ({ balance, accountLabel, ratePct, bestBank, bestKeptLabel, diffPct, extra }) =>
      `Je houdt ${balance} aan bij ${accountLabel} tegen ${ratePct}; ${bestBank} betaalt ${bestKeptLabel}, ook als een actie afloopt — dat verschil van ${diffPct} is ${extra} per jaar.`,

    empty: {
      heading: "Nog geen rentewinst berekend.",
      explanation:
        "Per rekening heeft LaVega een saldo én een rente % nodig; een van beide onbekend betekent geen bedrag, geen aanname.",
      noSaldoItem: (count) => `${count} rekening${count > 1 ? "en" : ""} zonder saldo — vul dat in bij Rekeningen.`,
      noRateItem: (count) => `${count} rekening${count > 1 ? "en" : ""} zonder rente — zet de Rente % hieronder.`,
      bestKnown: ({ keptPct, bank, marginPct }) =>
        `Beste rente die LaVega kan aantonen: ${keptPct} bij ${bank}. Elke rekening hier haalt dat al, of het verschil is kleiner dan ${marginPct} per jaar.`,
      noRatesKnown:
        "LaVega kent nog geen spaarrente om tegen te vergelijken — zonder die andere kant is er geen bedrag, alleen een percentage.",
    },

    promo: {
      badge: "🎁 nu te krijgen",
      headline: ({ bank, pct }) => `${bank} geeft vandaag ${pct}`,
      tailUnknownAfter: " Wat je daarna houdt staat niet in de bron, dus daar rekent LaVega niet mee.",
      tailKeptAfter: (kept) => ` Daarna houd je ${kept}.`,
      tailNotePrefix: (note) => ` — ${note}`,
      extraPerMonth: (amount, bank) => ` Zolang de actie loopt is dat ${amount} per maand extra bovenop ${bank}.`,
    },

    tableHeaders: {
      rekening: "Rekening",
      saldo: "Saldo",
      rentePct: "Rente %",
      bron: "Bron",
      mogelijkPerJaar: (vsKept) => `Mogelijk/jr${vsKept ? ` vs ${vsKept} die je houdt` : ""}`,
    },
    rateCellAriaLabel: (accountName) => `Rente ${accountName}`,
    rateCellUnknownPlaceholder: "—",

    sourceLabels: {
      manual: "handmatig",
      detected: "geschat uit rente",
      benchmark: "geschat via banktarief",
      assumed: "aangenomen 0%",
      unknown: "onbekend",
    },
    ratesSourceLabels: {
      live: "🟢 live opgehaald",
      cache: "uit cache",
      bundled: "offline momentopname",
    },
    benchmarkSourceNote: ({ bank, product, pct, asOf }) => `${bank} ${product} · ${pct} · peildatum ${asOf}`,
    assumedZeroNote: ({ bank, pct, product, asOf }) =>
      `${bank} betaalt ${pct} op ${product} (peildatum ${asOf}). Is dit die rekening? Zet dan het percentage hiernaast — wat jij invult gaat boven elke schatting.`,
    assumedZeroQuestion: "Is dit die rekening?",

    benchmarkDetails: {
      summary: ({ count, sourceLabel, asOf }) => `Vergelijkingsrentes (${count} banken) · ${sourceLabel} · peildatum ${asOf}`,
      tableHeaders: ["Bank", "Rente nu", "Wat je houdt", "Actie"],
      capitalAtRiskTooltip:
        "Geen spaarrekening: dit is een geldmarktfonds. Je kunt geld verliezen, het rendement is na kosten en opnemen duurt tot twee werkdagen. Niet gedekt door het depositogarantiestelsel.",
      capitalAtRiskFootnote:
        "* Geen spaarrekening maar een geldmarktfonds — je kunt geld verliezen, het rendement is na kosten en opnemen duurt tot twee werkdagen. Niet gedekt door het depositogarantiestelsel, en daarom nooit onze aanbeveling.",
      unknownKept: "onbekend",
      sameAsHeadline: "—",
      noPromo: "—",
      promoThen: (standardPct) => `Actietarief, daarna ${standardPct}`,
      promoPlain: "Actietarief",
      explanation: ({ sourceLabel, asOf }) =>
        `"Rente nu" is inclusief actietarieven (vaak alleen voor nieuwe klanten); "wat je houdt" is het tarief ná de actie — daarop wordt vergeleken. Staat daar "onbekend", dan zegt de bron niet wat er na de actie overblijft en doet die rekening niet mee in de vergelijking; het actietarief zie je wel. Bron: ${sourceLabel} via geld.nl (peildatum ${asOf}).`,
      refreshButton: "ververs rentes",
      refreshingButton: "verversen…",
      refreshNote: "Alleen publieke rentes worden opgehaald — je eigen saldi/rentes blijven lokaal.",
      offlineNote: "Voor live tarieven: start de rente-service (pnpm dev:server).",
    },
  },

  cashback: {
    title: "Cashback",
    footer: "Percentages gelden op wat je uitgeeft, niet op je saldo.",
    unknownTail: "Bij de kaarten die de catalogus wél prijst, staat dat bedrag onder “Kosten”.",

    routingSentence: ({ toBank, fromBank, toPct, fromPct, approximate, amount }) => ({
      main: ["Betaal met ", { bold: toBank }, ` in plaats van ${fromBank} — ${toPct} tegen ${fromPct}.`],
      tail: `${approximate ? "tot " : ""}${amount} per jaar`,
    }),

    answerLine: ({ product, bank, pct, ownPct, assumed, altKind, extra }) =>
      `${product}${bank ? ` bij ${bank}` : ""} geeft ${pct} terug op wat je uitgeeft, tegen ${ownPct} op je beste eigen kaart` +
      (assumed ? " aangenomen" : "") +
      (altKind ? ` ${altKind}` : "") +
      ` — ${extra} per jaar meer, vóór kaartkosten.`,

    conditions: {
      summary: "Aan dit tarief hangen voorwaarden — lees ze voordat je hierop rekent",
      sourceLine: (url, asOf) => `Bron: ${url} · peildatum ${asOf}`,
    },

    emptyReasons: {
      noAccounts: "Nog geen betaalrekening of creditcard in beeld — er is dus nog niets om mee te vergelijken.",
      cannotAssume:
        "Wat dit jou zou opleveren weet LaVega nog niet: bij deze kaarten mag er geen nul worden aangenomen, en zonder die helft is er geen verschil te berekenen. Onder “Waar deze cijfers vandaan komen” staat het per kaart.",
      tooLittleHistory: (minDays) =>
        `LaVega kent de cashback van je kaarten, maar heeft nog te weinig afschrift om te zien wat je ermee uitgeeft (minimaal ${minDays} dagen). Zonder die basis is er een percentage, maar geen bedrag.`,
      noCatalogueCards: "Geen enkele kaart in de catalogus heeft een aantoonbaar cashbackpercentage — er is dus niets om je eigen kaart tegen af te zetten.",
      alreadyBest: "Je beste kaart nu doet het even goed of beter — er is niets te winnen.",
    },

    openGapsSentence: (products) =>
      `Cashback onbekend voor ${products}, en aannemen mag hier niet. Twee manieren om dat te sluiten: kies een bestemming in het reisblok op Overzicht en klik Zoek voorwaarden, of vul het percentage zelf in bij Profiel → Cashback corrigeren.`,
    openGapsCallToAction: { searchLink: "Zoek voorwaarden", profileLink: "Profiel → Cashback corrigeren" },

    onderbouwing: {
      toonMeerSummary: "Waar deze cijfers vandaan komen, en wat er niet in zit",
      ownCardLabel: "Op je beste eigen kaart",
      bestCardLabel: "Op de beste kaart die we kunnen aantonen",
      bestCardMeta: (product, asOf) => `(${product}, peildatum ${asOf})`,
      perMonthSuffix: " per maand",
      assumedNote: ({ bankOrProduct, checkedNote, dueForReview }) =>
        `Aangenomen: geen cashback — niet gevonden in de voorwaarden van dit product. Een gewone Nederlandse betaalpas of grootbankcreditcard geeft geen cashback, dus LaVega vult hier nul in in plaats van je met “onbekend” te laten zitten — maar het blijft een aanname van ons en geen zin uit een document van ${bankOrProduct}. ${checkedNote}${dueForReview ? " Dat is een jaar of langer geleden, dus deze aanname is toe aan een nieuwe blik." : ""} Klopt het niet? Zet het juiste percentage bij Profiel → Cashback corrigeren; wat jij invult gaat vóór alles wat LaVega zelf vindt.`,
      assumedCheckedNote: (issuerFamily, date) => `De voorwaarden van ${issuerFamily} zijn voor het laatst gelezen op ${date}.`,
      assumedNeverCheckedNote: (issuerFamily) => `Van ${issuerFamily} heeft LaVega geen enkel gelezen document met een datum erbij.`,
      diffLabel: "Verschil",
      diffSub: " — wat dezelfde uitgaven daar extra opleveren, vóór kaartkosten",
      diffAmount: (perMonth, perYear) => `${perMonth} per maand · ${perYear} per jaar`,
      baseSentence: ({ upperBound, amount, days }) =>
        `Gerekend over ${upperBound ? "maximaal " : ""}${amount} aan kaartuitgaven gemiddeld per maand, gemeten over ${days} dagen afschrift.`,
      explanation:
        "Beide regels hierboven zijn dezelfde uitgaven op een andere kaart — een vergelijking van tarieven, niet wat er vandaag op je rekening komt. Het verschil is daarom minstens dit: wat nu op een kaart met minder cashback staat, levert nog meer op.",
      upperBoundNote:
        ' Je bank zegt er niet bij of een afschrijving een kaartbetaling of een incasso was, dus huur en incasso\'s zitten nog in die basis — vandaar "maximaal".',
    },

    routingBasis: {
      heading: "Waarover die overstap gerekend is",
      sentence: ({ toBank, fromBank, upperBound, amount, measuredDays }) =>
        `${toBank} in plaats van ${fromBank}: gerekend over ${upperBound ? "maximaal " : ""}${amount} aan uitgaven per jaar${measuredDays !== undefined ? `, gemeten over ${measuredDays} dagen afschrift` : ""}.`,
      approxNote: " Je bank zegt er niet bij of een afschrijving een kaartbetaling of een incasso was — huur en incasso's zitten er dus nog in.",
    },

    lastMonthCompare: {
      heading: (month) => `Vorige volle maand (${month})`,
      summaryTail: (spent, diff, bank) => ` — ${spent} uitgegeven, ${diff} meer cashback op ${bank}`,
      spentLabel: "Wat je die maand uitgaf",
      ownCardLabel: (pct) => `Wat je eigen kaart daarop teruggaf — ${pct}`,
      bestCardLabel: (product, pct) => `Wat ${product} had teruggegeven — ${pct}`,
      footnote:
        "Dit is de laatste maand die je import van begin tot eind dekt. Eén maand is één steekproef, dus de aanbeveling vooraan staat op het maandgemiddelde en niet op deze maand — dit getal is de controle die je tegen je eigen herinnering kunt houden.",
    },

    noOrdinaryCard: (count) =>
      `Geen gewone bankkaart in de catalogus heeft een aantoonbaar cashbackpercentage — alle ${count} die we kunnen onderbouwen zijn prepaid- of cryptokaarten. Dat is wat de bronnen zeggen, niet een keuze van LaVega.`,

    perCardSourceHeading: (count) => `Waar het percentage van elk van je ${count === 1 ? "kaart" : "kaarten"} vandaan komt`,

    otherOffers: {
      headingWithUpgrade: "Andere kaarten die we kunnen aantonen",
      headingWithoutUpgrade: "Kaarten die we kunnen aantonen",
      subtitle: "— niet alleen de jouwe",
      itemMeta: (asOf) => `(peildatum ${asOf})`,
    },

    /** `pct` arrives pre-formatted (via `formatPercentIn`, already carrying its
     *  own "%") — same reason as everywhere else in this module: no currency or
     *  number formatting happens in here. */
    heldCashback: {
      measuredByUser: (pct, date) => `${pct}, door jou ingesteld op ${date}`,
      measuredByAgent: (pct, date) => `${pct}, gevonden door de reisagent op ${date}`,
      assumptionOff:
        "onbekend — je hebt de aanname “geen cashback” uitgezet bij Profiel → Cashback corrigeren.",
      assumedNoCashback: "aangenomen: geen cashback — niet gevonden in de voorwaarden van dit product",
      unknown: (reason) => `onbekend — ${reason}`,
    },
  },

  costs: {
    title: "Kosten",
    footer:
      "Bedragen uit de kostendocumenten van de aanbieders zelf, met de datum die dat document noemt. Alleen betaalrekeningen en creditcards; nergens is tussen maand en jaar omgerekend.",

    totalComplete: (amount, accountCount) =>
      `Je betaalt ${amount} per jaar om deze ${accountCount} ${accountCount === 1 ? "rekening" : "rekeningen"} aan te houden.`,
    totalIncomplete: ({ known, total, amount, unknown }) =>
      `Van ${known} van je ${total} rekeningen staat het tarief vast: samen ${amount} per jaar. De andere ${unknown} ${unknown === 1 ? "rekening telt" : "rekeningen tellen"} niet als nul mee, dus dit bedrag is een ondergrens.`,
    totalNone: "Van geen van deze rekeningen staat het tarief vast, dus er is geen totaal. Wat de catalogus bij deze banken wél weet, staat in de plooi hieronder.",

    freeAccountWithConditions: (label, conditions) => `${label} — Gratis, mits: ${conditions}`,
    freeAccountNoConditions: (label) => `${label} — Gratis. De bron noemt hierbij geen voorwaarde.`,

    unknownAccountLead: (bank, accountName) => `${bank} — ${accountName}: kosten onbekend, en dat is geen nul.`,
    unknownReasons: {
      noBank: "Deze rekening draagt geen banknaam, dus er valt niets op te zoeken.",
      providerUnknown: (bank) => `LaVega kent geen tarief van ${bank}.`,
      noCandidates: (bank) => `Bij ${bank} kent LaVega geen tarief voor dit soort rekening.`,
      unclearProduct: (bank) => `LaVega kent de tarieven van ${bank}, maar niet welk van deze producten dit is.`,
    },

    freeAtBank: {
      heading: (bank) => `Gratis bij ${bank}:`,
      item: (product, feeLabel, conditions) => `${product} — ${feeLabel}. ${conditions}`,
      defaultConditionNote: "De bron noemt hierbij geen voorwaarde.",
      matchHint: "Is dit jouw rekening? Zet die naam bij Rekeningen in het veld Naam, dan rekent LaVega er met € 0,00 voor.",
      sourceSummary: (count) => `Waar ${count === 1 ? "deze prijs" : "deze prijzen"} vandaan ${count === 1 ? "komt" : "komen"}`,
      sourceItem: (product, host, asOf) => `${product}: ${host}, peildatum ${asOf}`,
    },

    tips: {
      sentence: ({ label, heldLabel, currentFee, altProduct, altFee, saving }) =>
        `${label} — je betaalt ${currentFee} voor ${heldLabel}; ${altProduct} kost ${altFee}. Dat scheelt ${saving} per jaar.`,
      atProviderLabel: "Bij dezelfde aanbieder",
      elsewhereLabel: "Bij een andere aanbieder",
      conditionalNote: (conditions) => `Voorwaarde volgens de bron: ${conditions}`,
      noConditionNote: "De bron noemt hierbij geen voorwaarde.",
    },

    detailsToonMeer: {
      summary: "Per rekening: het tarief, de bron en de peildatum",
      tableHeaders: ["Rekening", "Kosten", "Per jaar", "Bron"],
      unknownCost: "onbekend",
      notInTotal: "niet in het totaal",
      sameFeeNote: (count) => `${count} producten bij deze bank, alle even duur`,
      conditionLabel: "Voorwaarde:",
      candidatesHeading: (count, bank) => `${count} ${count === 1 ? "tarief" : "tarieven"} bij ${bank}:`,
      matchHint: "Weet je welk het is? Zet die naam bij Rekeningen in het veld Naam — dan rekent LaVega met dat tarief.",
      noSource: "geen bron",
      sourcesHeading: "Waar deze bedragen vandaan komen",
      sourceLine: (bank, url, asOf) => `${bank}: ${url} (peildatum ${asOf})`,
      altSourceLine: (product, url, asOf) => `${product}: ${url} (peildatum ${asOf})`,
    },
  },

  productCost: {
    unknownCost: {
      heading: (noun) => `Wat deze ${noun} zelf kost, weten we niet.`,
      reasonNeedsAnotherProduct: (noun) => `De prijs die onze bron noemt geldt bovenop een ander product, dus wat deze ${noun} los kost staat er niet.`,
      reasonNoSource: "Geen van onze bronnen noemt een maand- of jaarprijs voor dit product.",
      footnote: "Dat is geen nul, en het gaat van het bedrag hierboven af — daarom staat er bruto en geen ander woord.",
    },
    costLine: {
      heading: (noun) => `Wat de ${noun} zelf kost`,
      sumNote: (amount) => `(12 × ${amount})`,
    },
    netLine: {
      heading: "Netto",
      subtitle: "— wat er overblijft als die kosten eraf zijn",
      alsoMonthlyPrefix: (perMonth) => `${perMonth} per maand · `,
    },
    noRecommendation: {
      heading: "Geen aanbeveling.",
      body: (gross, per, gainWord, cost, costWord) => `${gross} ${per} ${gainWord} tegen ${cost} ${per} ${costWord}:`,
      noGain: "dat levert niets op.",
      loss: (per, loss) => `je gaat er ${loss} ${per} op achteruit.`,
      footer: (noun) => `Overstappen kost werk en levert hier niets op, dus LaVega raadt deze ${noun} niet aan — de cijfers staan er zodat je het kunt nakijken.`,
    },
    spanWords: {
      recurring: (period) => `per ${period}`,
      oneOffYear: (n) => `over ${n} jaar`,
      oneOffMonth: (n) => `over ${n} ${n === 1 ? "maand" : "maanden"}`,
    },
  },
};

const optimalisatieCopy_en: OptimalisatieCopy = {
  header: {
    title: "Money you're leaving on the table",
    eyebrow: "subscriptions & interest",
    gridLabel: "Optimise",
  },

  kpis: {
    subscriptions: {
      label: "Subscriptions",
      eyebrow: (amount, unit, unknownCount) =>
        `${amount} ${unit}${unknownCount > 0 ? ` · ${unknownCount} without a fixed cadence not included` : ""}`,
    },
    priceIncreases: { label: "Price increases", eyebrow: "detected" },
    overlaps: { label: "Overlapping subscriptions", eyebrow: "overlap" },
    interest: {
      label: "Interest left on the table",
      eyebrowNoNet: "per year",
      eyebrowWithNet: "per year, before account costs",
    },
  },

  common: {
    perUnit: (unit) => (unit === "maand" ? "per month" : "per year"),
    dash: "—",
    assumedBadge: "assumed",
    altKindLabel: { prepaid: "prepaid card", crypto: "crypto card" },
    subscriptionWord: (n) => (n === 1 ? "subscription" : "subscriptions"),
    accountWord: (n) => (n === 1 ? "account" : "accounts"),
    cardWord: (n) => (n === 1 ? "card" : "cards"),
    rateWord: (n) => (n === 1 ? "rate" : "rates"),
    unknownBalance: "unknown",
    moreInterestWord: "more interest",
    moreCashbackWord: "more cashback",
    moreCashbackThisMonthWord: "more cashback that month",
    accountCostWord: "account fees",
    cardCostWord: "card fees",
    noAssumptionReason: {
      verkoopargument:
        "For prepaid and crypto cards cashback is the whole selling point, so LaVega can't assume zero there.",
      beloningsuitgever:
        "This issuer sells its cards on what you earn with them, so what you get back differs per card and isn't fixed here.",
      "geen-betaalproduct": "This kind of account has no card attached, so there's no cashback to state.",
      "uitgever-buiten-de-aanname":
        "This provider sells paid tiers with perks, so assuming zero would be a guess.",
      "soort-onbekend": "LaVega doesn't know what kind of product this is, and without that there's nothing to go on.",
    },
  },

  subscriptions: {
    title: "Subscriptions",
    periodAriaLabel: "Unit for the subscription amounts",
    periods: { eigen: "As charged", maand: "Per month", jaar: "Per year" },
    periodLabelFallback: "Amount",

    footerEmpty: "Detected from your own transactions — nothing here is made up.",
    footerWithSubs: ({ count, total, unit, unknownCount, noChanges }) =>
      `${count} ${count === 1 ? "subscription" : "subscriptions"} · totalling ${total} ${unit}` +
      (unknownCount > 0
        ? ` · ${unknownCount} ${unknownCount === 1 ? "subscription isn't" : "subscriptions aren't"} included: no fixed cadence to convert`
        : "") +
      "." +
      (noChanges ? " No price increase and no overlapping service found." : ""),

    coverage: {
      noHistory: "No outgoing transactions yet, so no cadence to recognise yet.",
      withHistory: ({ days, first, last, cadences }) => [
        "LaVega looks over ",
        { bold: `${days}` },
        ` days of statements (${first} – ${last}). In that window, `,
        { bold: cadences },
        " can be recognised.",
      ],
      cadencesFallback: "no cadence at all",
      hiddenSuffix: (hiddenList) =>
        ` Not yet: ${hiddenList}. A subscription on one of these cadences isn't shown here because the history doesn't reach back far enough — not because it doesn't exist.`,
      hiddenCadenceItem: (cadence, days) => `${cadence} (from ${days} days)`,
    },

    empty: {
      heading: "No subscription recognised yet.",
      intro: "That's a measurement, not an empty screen:",
      noOutflows: " there are no outgoing transactions in LaVega yet.",
      withOutflows: ({ outflows, merchants, repeated, dateRange }) => [
        " LaVega saw ",
        { bold: `${outflows}` },
        ` outgoing transactions${dateRange}, spread across `,
        { bold: `${merchants}` },
        " recipients. You paid ",
        { bold: `${repeated}` },
        " of them at least twice — and none of them matched the pattern.",
      ],
      dateRange: (first, last) => ` between ${first} and ${last}`,
      rulesIntro: "What LaVega calls a subscription:",
      rules: [
        "at least three payments if it's monthly, two if it's quarterly, half-yearly or yearly;",
        "a fixed cadence: roughly monthly, quarterly or yearly;",
        "an amount that may rise (that's actually the signal) but doesn't jump around wildly;",
        "not your own transfer or a card settlement.",
      ],
      talliesSummary: (count) => `What LaVega saw per recipient (${count} recipients, most subscription-like first)`,
      talliesTableHeaders: ["Recipient", "Times", "Total", "Cadence", "Spread", "Counted?", "Why not"],
      noNameFallback: "(no name)",
      gapDaysSuffix: (days) => `${days} d`,
      includedYes: "yes",
      excludedTransferOrPerson: "no — read as a transfer or a person",
      excludedNoName: "no — no name on the line",
      reasonFallback: "—",
      talliesFootnote:
        "A cadence around 30, 61, 91, 182 or 365 days is usable; a spread above 0.35 means the amount jumps around too much. If your subscription is here with a good cadence and a low spread and still isn't in the list above, that's a bug on our end — send us that line.",
      housingExcludedOne: "One recurring recipient isn't shown here",
      housingExcludedMany: (count) => `${count} recurring recipients aren't shown here`,
      housingExcludedTail: ": those were read as fixed housing costs (rent, mortgage, service charge), and those don't belong on this screen.",
      missingAccountNote:
        "Usually the account they're charged from is missing: import your credit card or personal account and they'll show up here — price increases and overlapping services included.",
      demoDisclosureSummary: "See what this looks like with data in it",
      demoBadge: "Example — not your data, and never stored",
      demoTableHeaders: ["Service", "Category", "Per month", "Change"],
      demoCategories: ["Video streaming", "Music streaming", "Software", "Telecom"],
      demoNoChange: "—",
    },

    increaseSentence: ({ name, fromAmount, toAmount, changePct, unit, extra, cadence }) =>
      `${name} went from ${fromAmount} to ${toAmount} (+${changePct}%) ` +
      (extra
        ? `— that's ${extra.amount} ${unit} extra${extra.sum ? ` (${extra.sum})` : ""}.`
        : `— charged ${cadence}, so what that costs ${unit} can't be worked out here.`),

    overlapSentence: ({ count, functionName, names, total, unit, cancelAmount }) =>
      `${count} × ${functionName}: ${names} — ${total} ${unit} combined.` +
      (cancelAmount ? ` Cancelling one saves up to ${cancelAmount} ${unit}.` : ""),

    tableHeaders: (periodLabel) => ["Service", "Category", periodLabel, "On your statement", "Change", "Last"],
    unrekenbaarCell: "can't be converted",

    cadence: {
      maandelijks: "monthly",
      tweemaandelijks: "every two months",
      perKwartaal: "quarterly",
      halfjaarlijks: "every six months",
      jaarlijks: "annually",
      elkeNDagen: (days) => `every ${days} days`,
    },

    convertedPanel: {
      summary: (converted, total) => `${converted} of ${total} amounts ${converted === 1 ? "is" : "are"} converted from a different cadence`,
      explanation: (unit) =>
        `A subscription keeps the unit of its own charge; what you see above is that charge converted ${unit}. Converting to a year only multiplies, so that amount is exact. Converting to a month divides, and then the amount in the column doesn't appear on any statement.`,
      item: ({ name, lastAmount, cadence, sum, result, unit }) => `${name}: ${lastAmount} ${cadence} → ${sum} = ${result} ${unit}`,
    },
  },

  interest: {
    title: "Interest",
    footerNone: "No comparison rate available.",
    footerWithBest: ({ bank, keptLabel, promo, sourceLabel, asOf }) =>
      `Best rate you're keeping: ${bank} ${keptLabel}` +
      (promo ? ` · highest promo rate now: ${promo.bank} ${promo.pct}` : "") +
      ` · ${sourceLabel}, as of ${asOf}.`,
    leadSentence: ({ amount, showNetSuffix }) => [
      "Moving your money earns you ",
      { bold: amount },
      ` per year${showNetSuffix ? ", before what that account itself costs" : ""}.`,
    ],
    toonMeerSummary: "Per account, and what the new account itself costs",
    suggestionSentence: ({ balance, accountLabel, ratePct, bestBank, bestKeptLabel, diffPct, extra }) =>
      `You're keeping ${balance} at ${accountLabel} at ${ratePct}; ${bestBank} pays ${bestKeptLabel}, even after a promo ends — that ${diffPct} difference is ${extra} per year.`,

    empty: {
      heading: "No interest gain calculated yet.",
      explanation:
        "For each account LaVega needs a balance and an interest rate; either one missing means no amount, no assumption.",
      noSaldoItem: (count) => `${count} account${count > 1 ? "s" : ""} with no balance — fill that in under Accounts.`,
      noRateItem: (count) => `${count} account${count > 1 ? "s" : ""} with no interest rate — set the rate below.`,
      bestKnown: ({ keptPct, bank, marginPct }) =>
        `Best rate LaVega can prove: ${keptPct} at ${bank}. Every account here already matches it, or the difference is smaller than ${marginPct} per year.`,
      noRatesKnown: "LaVega doesn't have a savings rate to compare against yet — without that other side there's no amount, only a percentage.",
    },

    promo: {
      badge: "🎁 available now",
      headline: ({ bank, pct }) => `${bank} is offering ${pct} today`,
      tailUnknownAfter: " What you keep afterwards isn't stated by the source, so LaVega doesn't factor it in.",
      tailKeptAfter: (kept) => ` Afterwards you keep ${kept}.`,
      tailNotePrefix: (note) => ` — ${note}`,
      extraPerMonth: (amount, bank) => ` While the promo runs, that's ${amount} extra per month on top of ${bank}.`,
    },

    tableHeaders: {
      rekening: "Account",
      saldo: "Balance",
      rentePct: "Rate %",
      bron: "Source",
      mogelijkPerJaar: (vsKept) => `Possible/yr${vsKept ? ` vs ${vsKept} you keep` : ""}`,
    },
    rateCellAriaLabel: (accountName) => `Interest rate ${accountName}`,
    rateCellUnknownPlaceholder: "—",

    sourceLabels: {
      manual: "manual",
      detected: "estimated from interest",
      benchmark: "estimated from the bank's rate",
      assumed: "assumed 0%",
      unknown: "unknown",
    },
    ratesSourceLabels: {
      live: "🟢 fetched live",
      cache: "from cache",
      bundled: "offline snapshot",
    },
    benchmarkSourceNote: ({ bank, product, pct, asOf }) => `${bank} ${product} · ${pct} · as of ${asOf}`,
    assumedZeroNote: ({ bank, pct, product, asOf }) =>
      `${bank} pays ${pct} on ${product} (as of ${asOf}). Is this that account? Then set the percentage next to it — whatever you enter beats every estimate.`,
    assumedZeroQuestion: "Is this that account?",

    benchmarkDetails: {
      summary: ({ count, sourceLabel, asOf }) => `Comparison rates (${count} banks) · ${sourceLabel} · as of ${asOf}`,
      tableHeaders: ["Bank", "Rate now", "What you keep", "Promo"],
      capitalAtRiskTooltip:
        "Not a savings account: this is a money-market fund. You can lose capital, the return is net of fees, and withdrawing takes up to two business days. Not covered by the deposit guarantee scheme.",
      capitalAtRiskFootnote:
        "* Not a savings account but a money-market fund — you can lose capital, the return is net of fees, and withdrawing takes up to two business days. Not covered by the deposit guarantee scheme, and therefore never our recommendation.",
      unknownKept: "unknown",
      sameAsHeadline: "—",
      noPromo: "—",
      promoThen: (standardPct) => `Promo rate, then ${standardPct}`,
      promoPlain: "Promo rate",
      explanation: ({ sourceLabel, asOf }) =>
        `"Rate now" includes promo rates (often for new customers only); "what you keep" is the rate after the promo ends — that's what the comparison uses. Where it says "unknown", the source doesn't say what remains after the promo, so that account isn't included in the comparison; you still see the promo rate. Source: ${sourceLabel} via geld.nl (as of ${asOf}).`,
      refreshButton: "refresh rates",
      refreshingButton: "refreshing…",
      refreshNote: "Only public rates are fetched — your own balances and rates stay local.",
      offlineNote: "For live rates: start the rates service (pnpm dev:server).",
    },
  },

  cashback: {
    title: "Cashback",
    footer: "Percentages apply to what you spend, not to your balance.",
    unknownTail: "For cards the catalogue does price, that amount is listed under “Costs”.",

    routingSentence: ({ toBank, fromBank, toPct, fromPct, approximate, amount }) => ({
      main: ["Pay with ", { bold: toBank }, ` instead of ${fromBank} — ${toPct} versus ${fromPct}.`],
      tail: `${approximate ? "up to " : ""}${amount} per year`,
    }),

    answerLine: ({ product, bank, pct, ownPct, assumed, altKind, extra }) =>
      `${product}${bank ? ` at ${bank}` : ""} gives ${pct} back on what you spend, against ${ownPct} on your best own card` +
      (assumed ? " assumed" : "") +
      (altKind ? ` ${altKind}` : "") +
      ` — ${extra} more per year, before card costs.`,

    conditions: {
      summary: "This rate comes with conditions — read them before you count on it",
      sourceLine: (url, asOf) => `Source: ${url} · as of ${asOf}`,
    },

    emptyReasons: {
      noAccounts: "No current account or credit card in view yet — so there's nothing to compare against.",
      cannotAssume:
        "LaVega doesn't yet know what this would earn you: for these cards a zero can't be assumed, and without that half there's no difference to calculate. Under “Where these figures come from” it's listed per card.",
      tooLittleHistory: (minDays) =>
        `LaVega knows the cashback rate of your cards, but doesn't have enough statement history yet to see what you spend on them (at least ${minDays} days). Without that base there's a percentage, but no amount.`,
      noCatalogueCards: "No card in the catalogue has a provable cashback percentage — so there's nothing to compare your own card against.",
      alreadyBest: "Your best card today does just as well or better — there's nothing to gain.",
    },

    openGapsSentence: (products) =>
      `Cashback unknown for ${products}, and it can't be assumed here. Two ways to close that: pick a destination in the travel block on Overview and click Look up terms, or enter the percentage yourself under Profile → Correct cashback.`,
    openGapsCallToAction: { searchLink: "Look up terms", profileLink: "Profile → Correct cashback" },

    onderbouwing: {
      toonMeerSummary: "Where these figures come from, and what isn't included",
      ownCardLabel: "On your best own card",
      bestCardLabel: "On the best card we can prove",
      bestCardMeta: (product, asOf) => `(${product}, as of ${asOf})`,
      perMonthSuffix: " per month",
      assumedNote: ({ bankOrProduct, checkedNote, dueForReview }) =>
        `Assumed: no cashback — not found in this product's terms. An ordinary Dutch debit card or big-bank credit card pays no cashback, so LaVega fills in zero here rather than leaving you with "unknown" — but it stays an assumption of ours, not a line from a document from ${bankOrProduct}. ${checkedNote}${dueForReview ? " That was a year or more ago, so this assumption is due another look." : ""} Not right? Set the correct percentage under Profile → Correct cashback; whatever you enter overrides anything LaVega finds itself.`,
      assumedCheckedNote: (issuerFamily, date) => `The terms for ${issuerFamily} were last read on ${date}.`,
      assumedNeverCheckedNote: (issuerFamily) => `LaVega has no dated document on file for ${issuerFamily} at all.`,
      diffLabel: "Difference",
      diffSub: " — what the same spending would earn extra there, before card costs",
      diffAmount: (perMonth, perYear) => `${perMonth} per month · ${perYear} per year`,
      baseSentence: ({ upperBound, amount, days }) =>
        `Calculated over ${upperBound ? "at most " : ""}${amount} of card spending on average per month, measured over ${days} days of statements.`,
      explanation:
        "Both lines above are the same spending on a different card — a comparison of rates, not what actually lands on your account today. So the difference is at least this much: whatever currently sits on a card with less cashback earns even more.",
      upperBoundNote:
        ' Your bank doesn\'t say whether a charge was a card payment or a direct debit, so rent and direct debits are still in that base — hence "at most".',
    },

    routingBasis: {
      heading: "What that switch is calculated over",
      sentence: ({ toBank, fromBank, upperBound, amount, measuredDays }) =>
        `${toBank} instead of ${fromBank}: calculated over ${upperBound ? "at most " : ""}${amount} of spending per year${measuredDays !== undefined ? `, measured over ${measuredDays} days of statements` : ""}.`,
      approxNote: " Your bank doesn't say whether a charge was a card payment or a direct debit — so rent and direct debits are still included.",
    },

    lastMonthCompare: {
      heading: (month) => `Last full month (${month})`,
      summaryTail: (spent, diff, bank) => ` — ${spent} spent, ${diff} more cashback on ${bank}`,
      spentLabel: "What you spent that month",
      ownCardLabel: (pct) => `What your own card gave back on it — ${pct}`,
      bestCardLabel: (product, pct) => `What ${product} would have given back — ${pct}`,
      footnote:
        "This is the last month your import covers from start to finish. One month is one sample, so the recommendation up top is based on the monthly average, not this month — this figure is the check you can hold against your own memory.",
    },

    noOrdinaryCard: (count) =>
      `No ordinary bank card in the catalogue has a provable cashback percentage — all ${count} we can back up are prepaid or crypto cards. That's what the sources say, not a choice LaVega made.`,

    perCardSourceHeading: (count) => `Where the percentage for each of your ${count === 1 ? "card" : "cards"} comes from`,

    otherOffers: {
      headingWithUpgrade: "Other cards we can prove",
      headingWithoutUpgrade: "Cards we can prove",
      subtitle: "— not just yours",
      itemMeta: (asOf) => `(as of ${asOf})`,
    },

    heldCashback: {
      measuredByUser: (pct, date) => `${pct}, set by you on ${date}`,
      measuredByAgent: (pct, date) => `${pct}, found by the travel agent on ${date}`,
      assumptionOff:
        "unknown — you've turned off the “no cashback” assumption under Profile → Correct cashback.",
      assumedNoCashback: "assumed: no cashback — not found in this product's terms",
      unknown: (reason) => `unknown — ${reason}`,
    },
  },

  costs: {
    title: "Costs",
    footer:
      "Amounts from the providers' own fee documents, with the date that document states. Current accounts and credit cards only; nothing here is converted between month and year.",

    totalComplete: (amount, accountCount) =>
      `You pay ${amount} per year to keep ${accountCount} ${accountCount === 1 ? "account" : "accounts"} open.`,
    totalIncomplete: ({ known, total, amount, unknown }) =>
      `${known} of your ${total} accounts have a known fee: ${amount} per year combined. The other ${unknown} ${unknown === 1 ? "account isn't" : "accounts aren't"} counted as zero, so this amount is a floor.`,
    totalNone: "None of these accounts have a known fee, so there's no total. What the catalogue does know about these banks is in the panel below.",

    freeAccountWithConditions: (label, conditions) => `${label} — Free, provided: ${conditions}`,
    freeAccountNoConditions: (label) => `${label} — Free. The source doesn't state a condition here.`,

    unknownAccountLead: (bank, accountName) => `${bank} — ${accountName}: fee unknown, and that's not a zero.`,
    unknownReasons: {
      noBank: "This account has no bank name, so there's nothing to look up.",
      providerUnknown: (bank) => `LaVega doesn't know a fee for ${bank}.`,
      noCandidates: (bank) => `LaVega doesn't know a fee for this kind of account at ${bank}.`,
      unclearProduct: (bank) => `LaVega knows ${bank}'s fees, but not which of these products this is.`,
    },

    freeAtBank: {
      heading: (bank) => `Free at ${bank}:`,
      item: (product, feeLabel, conditions) => `${product} — ${feeLabel}. ${conditions}`,
      defaultConditionNote: "The source doesn't state a condition here.",
      matchHint: "Is this your account? Set that name under Accounts in the Name field, and LaVega will use €0.00 for it.",
      sourceSummary: (count) => `Where ${count === 1 ? "this price" : "these prices"} ${count === 1 ? "comes" : "come"} from`,
      sourceItem: (product, host, asOf) => `${product}: ${host}, as of ${asOf}`,
    },

    tips: {
      sentence: ({ label, heldLabel, currentFee, altProduct, altFee, saving }) =>
        `${label} — you pay ${currentFee} for ${heldLabel}; ${altProduct} costs ${altFee}. That saves ${saving} per year.`,
      atProviderLabel: "At the same provider",
      elsewhereLabel: "At a different provider",
      conditionalNote: (conditions) => `Condition per the source: ${conditions}`,
      noConditionNote: "The source doesn't state a condition here.",
    },

    detailsToonMeer: {
      summary: "Per account: the fee, the source and the date",
      tableHeaders: ["Account", "Fee", "Per year", "Source"],
      unknownCost: "unknown",
      notInTotal: "not in the total",
      sameFeeNote: (count) => `${count} products at this bank, all the same price`,
      conditionLabel: "Condition:",
      candidatesHeading: (count, bank) => `${count} ${count === 1 ? "fee" : "fees"} at ${bank}:`,
      matchHint: "Know which one it is? Set that name under Accounts in the Name field — LaVega will use that fee.",
      noSource: "no source",
      sourcesHeading: "Where these amounts come from",
      sourceLine: (bank, url, asOf) => `${bank}: ${url} (as of ${asOf})`,
      altSourceLine: (product, url, asOf) => `${product}: ${url} (as of ${asOf})`,
    },
  },

  productCost: {
    unknownCost: {
      heading: (noun) => `We don't know what this ${noun} itself costs.`,
      reasonNeedsAnotherProduct: (noun) => `The price our source states applies on top of another product, so what this ${noun} costs on its own isn't stated.`,
      reasonNoSource: "None of our sources state a monthly or yearly price for this product.",
      footnote: "That's not a zero, and it comes off the amount above — that's why it says gross and no other word.",
    },
    costLine: {
      heading: (noun) => `What the ${noun} itself costs`,
      sumNote: (amount) => `(12 × ${amount})`,
    },
    netLine: {
      heading: "Net",
      subtitle: "— what's left once those costs come off",
      alsoMonthlyPrefix: (perMonth) => `${perMonth} per month · `,
    },
    noRecommendation: {
      heading: "No recommendation.",
      body: (gross, per, gainWord, cost, costWord) => `${gross} ${per} ${gainWord} against ${cost} ${per} ${costWord}:`,
      noGain: "that earns nothing.",
      loss: (per, loss) => `you'd be ${loss} ${per} worse off.`,
      footer: (noun) => `Switching takes effort and earns nothing here, so LaVega doesn't recommend this ${noun} — the figures are there so you can check them yourself.`,
    },
    spanWords: {
      // `period` is the internal FeePeriod code ("maand" | "jaar"), not English
      // prose — it must be switched, not spliced, or every euro figure on this
      // screen reads "per jaar" in the English UI.
      recurring: (period) => (period === "maand" ? "per month" : "per year"),
      oneOffYear: (n) => `over ${n} year${n === 1 ? "" : "s"}`,
      oneOffMonth: (n) => `over ${n} month${n === 1 ? "" : "s"}`,
    },
  },
};

/**
 * Copy for Valuta.tsx (`view`) and the Globe component it embeds (`globe`).
 * Every entry that needs a runtime value is a function returning a full
 * sentence or paragraph (one function per rendered variant), rather than
 * fragmented into word-level pieces — the source composes long, carefully
 * worded sentences and splitting them further would make it easy to
 * recombine pieces into a sentence nobody wrote.
 */
export type ValutaCopy = {
  view: {
    head: {
      title: string;
      /** Appended after the live/offline rate headline, e.g. `${headline}${eyebrowSuffix}`. */
      eyebrowSuffix: string;
    };
    moduleLabels: {
      grid: string;
      transferTitle: string;
      destinationTitle: string;
    };
    kindLabel: {
      prepaid: string;
      crypto: string;
      beleggingsrekening: string;
    };
    transfer: {
      fromAccountLabel: string;
      toAccountLabel: string;
      noAccountOption: string;
      amountLabel: string;
      fromCurrencyLabel: string;
      toCurrencyLabel: string;
      swapAriaLabel: string;
      availableLabel: string;
      arrivesFooterLabel: string;
      /** Shared "unknown" used for both an unknown balance and an unknown arriving amount. */
      unknown: string;
    };
    ccySelect: {
      ecbGroupLabel: (count: number) => string;
      aggregatorGroupLabel: (provider: string, count: number) => string;
    };
    routeRow: {
      heldBadge: string;
      notHeldBadge: string;
      costUnknown: string;
      sourceNote: (asOf: string) => string;
      /** Renders `rankFxRoutes`'s `FxWhy` kind. `pct` arguments arrive
       *  pre-formatted (`formatPercentIn`) — this module does no number
       *  formatting of its own, same rule as everywhere else here. */
      why: {
        termsUnknownHeld: string;
        noRate: string;
        mineOnly: (pct: string, product: string) => string;
        mineCheaperElsewhere: (pct: string, product: string, cheaperProduct: string, cheaperPct: string) => string;
        uniformHeld: (pct: string, collapsed: number, bank: string) => string;
        uniformNotHeld: (pct: string, collapsed: number, bank: string) => string;
        heldUncertain: (pct: string, product: string) => string;
        notHeld: (pct: string, product: string) => string;
      };
    };
    delta: {
      evenExpensive: string;
      sameSurcharge: string;
      lessInTotal: (money: string) => string;
      moreInTotal: (money: string) => string;
      lessSurcharge: (money: string) => string;
      moreSurcharge: (money: string) => string;
    };
    rateFreshness: {
      live: (date: string) => string;
      memory: (date: string) => string;
      bundled: (date: string) => string;
      /** The aggregator leg's own freshness phrase, e.g. "the daily rate list from {provider}, {date}". */
      aggregator: (provider: string, date: string) => string;
    };
    rateHeadline: {
      offlineFallback: (date: string) => string;
      liveNoProvenance: string;
      ecbLayerWordBundled: string;
      ecbLayerWordReference: string;
      ecbPiece: (count: number, layerWord: string, date: string) => string;
      aggregatorPiece: (count: number, provider: string, date: string) => string;
      joiner: string;
      noLayers: string;
    };
    rateOrigin: {
      ecb: (freshness: string) => string;
      aggregator: (freshness: string) => string;
      mixed: (ecbLeg: string, ecbFreshness: string, aggLeg: string, aggFreshness: string) => string;
    };
    noRouteReason: {
      noAccounts: string;
      noBankOnAccounts: string;
      unknownFee: (banks: string) => string;
    };
    reason: {
      arrivesUnknownLead: string;
      noRateForPair: (from: string, to: string) => string;
      marketValueNote: (amount: string) => string;
      sameCurrencySentence: (amount: string, netAmount: string) => string;
      conversionSentence: (
        amount: string,
        mid: string,
        gross: string,
        bank: string,
        pct: string,
        costInFrom: string,
        netAmount: string,
      ) => string;
    };
    creditNotice: {
      label: string;
    };
    chosenRoute: {
      yours: (product: string) => string;
      heldElsewhere: (product: string) => string;
      notHeld: (product: string) => string;
    };
    recommendation: {
      headingNet: string;
      headingNoRecommendation: string;
      headingUnknown: string;
      body: (bank: string, pct: string, saving: string) => string;
      alreadyHeld: string;
      notHeld: string;
    };
    emptyGuide: {
      heading: string;
      catalogueNote: string;
      requirementsNote: string;
      noBankNote: string;
    };
    bankList: {
      summaryEmpty: string;
      summary: (count: number) => string;
      orderingNote: (amount: string, bank: string) => string;
      /** Bank-name fallback for `orderingNote` before a route is chosen. */
      chosenRouteFallback: string;
      backToBest: string;
      showMoreOne: (hidden: number) => string;
      showMoreMany: (hidden: number) => string;
      scopeHeading: string;
      scopeBody: string;
      oneRowPerBank: string;
      noRouteYet: (reason: string) => string;
      switchingBeatsHeading: string;
      switchingBeatsBody: (pct: string, amount: string) => string;
      heldUnknown: (banks: string) => string;
    };
    sourcesPanel: {
      summary: string;
      layer1Heading: string;
      layer1Bundled: (count: number, date: string) => string;
      layer1Reference: (count: number, date: string) => string;
      layer1MemorySuffix: string;
      layer1Footnote: string;
      layer1Missing: string;
      layer2Heading: string;
      layer2Body: (count: number, provider: string, date: string, nextUpdate: string | null) => string;
      layer2UnknownProvider: (provider: string) => string;
      layer2Missing: string;
      termsLinkLabel: string;
      rateHeading: string;
      rateFallbackLive: (date: string) => string;
      /** The rate service could not be reached. Distinct from the bundled line:
       *  one says these are older rates, the other says we do not know. */
      rateUnreachable: (date: string) => string;
      rateFallbackBundled: (date: string) => string;
      costsHeading: string;
      costsBody: string;
      privacyNote: string;
    };
  };
  globe: {
    legend: {
      euro: string;
      rate: string;
      noRate: string;
      noTender: string;
      selected: string;
    };
    readoutEmpty: string;
    canvasAriaLabel: string;
    miss: {
      off: string;
      beyond: (south: string, north: string) => string;
      sea: string;
      stillSelected: (label: string) => string;
    };
    noSelection: (value: string) => string;
    effectEuro: {
      leadSuffix: string;
      sameCurrency: string;
      differentCurrency: (from: string) => string;
    };
    effectSet: {
      body: (code: string) => string;
    };
    effectNoRate: {
      leadSuffix: string;
      body: (currency: string) => string;
      unchanged: (value: string) => string;
    };
    effectNoTender: {
      leadSuffix: string;
      body: string;
      footer: (value: string) => string;
    };
    effectChoice: {
      leadSuffix: string;
      prompt: string;
      noRateSuffix: string;
      picked: (code: string) => string;
      pickedNoRate: (currency: string, value: string) => string;
    };
    effectUnknown: {
      leadSuffix: string;
      body: string;
      unchanged: (value: string) => string;
    };
    offMap: {
      noFocus: string;
      pinOnly: string;
    };
    search: {
      label: string;
      placeholder: string;
      resultsAriaLabel: string;
      emptyResults: string;
      pinOnlySuffix: string;
      pinUnknownSuffix: string;
    };
    source: {
      summary: string;
      body: (fetchedAt: string, south: string, north: string) => string;
    };
    latitude: {
      south: string;
      north: string;
    };
    moneyLine: {
      noTender: string;
      unknown: string;
    };
  };
};

const valutaCopy_nl: ValutaCopy = {
  view: {
    head: {
      title: `Geld overzetten`,
      eyebrowSuffix: ` · koersopslag per bank uit de catalogus`,
    },
    moduleLabels: {
      grid: `Valuta`,
      transferTitle: `Overzetten`,
      destinationTitle: `Bestemming`,
    },
    kindLabel: {
      prepaid: `prepaidkaart`,
      crypto: `cryptokaart`,
      beleggingsrekening: `beleggingsrekening`,
    },
    transfer: {
      fromAccountLabel: `Van rekening`,
      toAccountLabel: `Naar rekening`,
      noAccountOption: `geen rekening gekozen`,
      amountLabel: `Bedrag`,
      fromCurrencyLabel: `Van valuta`,
      toCurrencyLabel: `Naar valuta`,
      swapAriaLabel: `Wissel van en naar`,
      availableLabel: `Beschikbaar`,
      arrivesFooterLabel: `Komt aan na kosten · beschikbaar`,
      unknown: `onbekend`,
    },
    ccySelect: {
      ecbGroupLabel: (count) => `ECB-referentiekoers (${count})`,
      aggregatorGroupLabel: (provider, count) => `Dagkoers via ${provider} (${count})`,
    },
    routeRow: {
      heldBadge: `van jou`,
      notHeldBadge: `niet van jou`,
      costUnknown: `kosten onbekend`,
      sourceNote: (asOf) => `(bron: ${asOf})`,
      why: {
        termsUnknownHeld: `Voorwaarden van deze bank nog onbekend — en onbekend is geen 0%.`,
        noRate: `Geen tarief dat LaVega kan onderbouwen.`,
        mineOnly: (pct, product) => `${pct} koersopslag op ${product}.`,
        mineCheaperElsewhere: (pct, product, cheaperProduct, cheaperPct) =>
          `${pct} koersopslag op ${product} — bij dezelfde bank rekent ${cheaperProduct} ${cheaperPct}.`,
        uniformHeld: (pct, collapsed, bank) =>
          `${pct} koersopslag — hetzelfde bij alle ${collapsed} ${bank}-producten die LaVega kent.`,
        uniformNotHeld: (pct, collapsed, bank) =>
          `${pct} koersopslag — hetzelfde bij alle ${collapsed} ${bank}-producten die LaVega kent. Deze bank heb je niet.`,
        heldUncertain: (pct, product) =>
          `${pct} koersopslag op ${product} — of jouw pakket bij deze bank hetzelfde rekent, weet LaVega niet.`,
        notHeld: (pct, product) => `${pct} koersopslag op ${product} — deze bank heb je niet.`,
      },
    },
    delta: {
      evenExpensive: `even duur`,
      sameSurcharge: `dezelfde opslag`,
      lessInTotal: (money) => `${money} minder in totaal`,
      moreInTotal: (money) => `${money} meer in totaal`,
      lessSurcharge: (money) => `${money} minder aan opslag`,
      moreSurcharge: (money) => `${money} meer aan opslag`,
    },
    rateFreshness: {
      live: (date) => `ECB-referentiekoers van ${date}`,
      memory: (date) => `ECB-referentiekoers van ${date}, de laatste die de server binnenkreeg`,
      bundled: (date) => `de meegebundelde ECB-referentiekoers van ${date}`,
      aggregator: (provider, date) => `de dagkoerslijst van ${provider} van ${date}`,
    },
    rateHeadline: {
      offlineFallback: (date) => `ECB-middenkoers van ${date} uit de app`,
      liveNoProvenance: `live ECB-middenkoers`,
      ecbLayerWordBundled: `meegebundelde ECB-koersen`,
      ecbLayerWordReference: `ECB-referentiekoersen`,
      ecbPiece: (count, layerWord, date) => `${count} ${layerWord} van ${date}`,
      aggregatorPiece: (count, provider, date) => `${count} dagkoersen via ${provider} van ${date}`,
      joiner: ` en `,
      noLayers: `geen koerslijst in dit scherm`,
    },
    rateOrigin: {
      ecb: (freshness) => `Gerekend met ${freshness}.`,
      aggregator: (freshness) =>
        `Gerekend met ${freshness}. Dat is een samengestelde dagkoers en geen referentiekoers van een centrale bank.`,
      mixed: (ecbLeg, ecbFreshness, aggLeg, aggFreshness) =>
        `Gekruist via de euro: ${ecbLeg} komt uit ${ecbFreshness}, ${aggLeg} uit ${aggFreshness}. De uitkomst is zo hard als dat tweede been.`,
    },
    noRouteReason: {
      noAccounts: `Er staat nog geen rekening in LaVega, dus er is geen bank om via te wisselen.`,
      noBankOnAccounts: `Geen van je rekeningen hangt aan een bank die LaVega kan opzoeken — vul de bank in bij Rekeningen.`,
      unknownFee: (banks) => `Van ${banks} kent LaVega de koersopslag niet, en een onbekend tarief is geen 0%.`,
    },
    reason: {
      arrivesUnknownLead: `Wat er aankomt is onbekend.`,
      noRateForPair: (from, to) => `LaVega heeft geen koers voor ${from} → ${to}.`,
      marketValueNote: (amount) =>
        `Tegen de middenkoers is dit ${amount} waard, maar dat is de marktwaarde en niet het bedrag dat aankomt.`,
      sameCurrencySentence: (amount, netAmount) =>
        `Je zet ${amount} over, zonder omwisseling. Er komt ${netAmount} aan.`,
      conversionSentence: (amount, mid, gross, bank, pct, costInFrom, netAmount) =>
        `Je zet ${amount} over, tegen middenkoers ${mid} is dat ${gross}. Via ${bank} kost dat ${pct} (${costInFrom}), dus er komt ${netAmount} aan.`,
    },
    creditNotice: {
      label: `Koersen buiten de ECB-lijst:`,
    },
    chosenRoute: {
      yours: (product) => `Gerekend met ${product}, het product dat je hier hebt.`,
      heldElsewhere: (product) => `Gerekend met ${product} — controleer of dat jouw pakket is.`,
      notHeld: (product) => `Gerekend met ${product} — deze bank heb je nog niet.`,
    },
    recommendation: {
      headingNet: `Goedkoper kan.`,
      headingNoRecommendation: `Lagere opslag, maar niet goedkoper.`,
      headingUnknown: `Lagere opslag — of dat goedkoper uitpakt, weet LaVega niet.`,
      body: (bank, pct, saving) =>
        `${bank} rekent ${pct} — dat is ${saving} minder aan koersopslag op dit bedrag.`,
      alreadyHeld: `Die bank heb je al; kies hem in de lijst.`,
      notHeld: `Die bank heb je niet — je zou er eerst rekening bij moeten openen.`,
    },
    emptyGuide: {
      heading: `Nog geen bank om te rangschikken.`,
      catalogueNote: `De catalogus levert de tarieven; die zit in de app en wordt niet opgehaald.`,
      requirementsNote: `Een tarief telt alleen mee met waarde, bron, datum én voorwaarden — anders wordt het geweigerd.`,
      noBankNote: `Rekeningen zonder bank kunnen niet opgezocht worden; vul de bank in bij Rekeningen.`,
    },
    bankList: {
      summaryEmpty: `Waarom er nog geen bank te rangschikken is`,
      summary: (count) => `Alle ${count} banken, goedkoopste eerst`,
      orderingNote: (amount, bank) =>
        `De volgorde is wat deze conversie je bij die bank kost: de koersopslag op ${amount} plus wat de rekening kost om te openen. Dat laatste telt voor minstens één hele factureringsperiode — een maand, of een jaar bij een jaarproduct — want je kunt geen rekening voor een dag openen. Een bank die je al hebt kost je niets extra: die prijs loopt toch al. Staat er “kaartkosten onbekend”, dan zit alleen de opslag in het bedrag; dat is een ondergrens, geen bewijs dat de rekening gratis is. Het verschil achter elke bank is gerekend tegen ${bank}.`,
      chosenRouteFallback: `de gekozen route`,
      backToBest: `Terug naar beste`,
      showMoreOne: (hidden) => `Nog ${hidden} bank tonen`,
      showMoreMany: (hidden) => `Nog ${hidden} banken tonen`,
      scopeHeading: `De lijst gaat over alle banken die LaVega kan onderbouwen`,
      scopeBody: ` — niet alleen die van jou. Standaard rekent LaVega met de goedkoopste route die je vandaag echt kunt gebruiken; een bank die je niet hebt staat erbij, met het verschil in euro's, maar wordt nooit stilzwijgend gekozen.`,
      oneRowPerBank: `Eén regel per bank: bij overzetten maakt het product niet uit, dus dezelfde bank staat niet driemaal in de lijst. Welk product achter het tarief zit, staat er wel bij — "ING 0%" geldt alleen voor de Platinumcard.`,
      noRouteYet: (reason) => `${reason} Zolang dat zo is, kan LaVega niet zeggen wat er aankomt. Een onbekend tarief is geen 0%.`,
      switchingBeatsHeading: `Waar overstappen je zou verslaan:`,
      switchingBeatsBody: (pct, amount) =>
        ` je huidige keuze kost ${pct}. Elke bank die minder rekent, houdt op dit bedrag meer dan ${amount} voor je over — aan koersopslag. Wat die rekening kost om te openen gaat daar nog vanaf, en dat is precies waarom de volgorde niet op het percentage gaat.`,
      heldUnknown: (banks) => `Zonder bekend tarief, dus onderaan: ${banks}.`,
    },
    sourcesPanel: {
      summary: `Waar de koers en de tarieven vandaan komen`,
      layer1Heading: `Koers, laag 1:`,
      layer1Bundled: (count, date) =>
        `${count} koersen uit de meegebundelde ECB-momentopname van ${date}, want er kwam geen live ECB-lijst binnen`,
      layer1Reference: (count, date) => `${count} ECB-referentiekoersen van ${date} via Frankfurter`,
      layer1MemorySuffix: ` — dat is de laatste lijst die de server binnenkreeg; de poging van zojuist mislukte`,
      layer1Footnote: `. De ECB publiceert die op een vast tijdstip volgens een methode die je kunt nalezen.`,
      layer1Missing: `er staat op dit moment geen ECB-lijst in dit scherm. Alle koersen hieronder komen uit laag 2.`,
      layer2Heading: `Koers, laag 2:`,
      layer2Body: (count, provider, date, nextUpdate) =>
        `${count} koersen van ${provider}, peildatum ${date}${nextUpdate ? `, volgende ronde ${nextUpdate}` : ``}. Dit zijn samengestelde dagkoersen: de aanbieder voegt ze samen uit bronnen die hij niet noemt en ververst één keer per dag. Ze vullen alleen de valuta's die de ECB niet publiceert — een ECB-koers wordt er nooit door overschreven. Valt deze bron weg, dan zijn die valuta's weer "geen koers"; er blijft geen oude waarde staan.`,
      layer2UnknownProvider: (provider) =>
        `de server levert koersen van een aanbieder (${provider}) die dit scherm niet kent. Die koersen mogen alleen getoond worden met de bronvermelding die de aanbieder voorschrijft, en die staat hier niet — dus worden ze niet gebruikt. De lijst is daardoor beperkt tot wat de ECB publiceert; voor de valuta's daarbuiten heeft LaVega nu geen koers.`,
      layer2Missing: `er staat geen tweede laag in dit scherm, dus de lijst is beperkt tot wat de ECB publiceert. Voor de valuta's daarbuiten heeft LaVega nu geen koers — dat is iets anders dan een koers van nul.`,
      termsLinkLabel: `voorwaarden`,
      rateHeading: `Koers:`,
      rateFallbackLive: (date) => `live ECB-middenkoers via Frankfurter, peildatum ${date}.`,
      rateUnreachable: (date) =>
        `de koersendienst was niet bereikbaar, dus dit zijn de meegeleverde koersen van ${date}. Ververs later voor de dagkoers.`,
      rateFallbackBundled: (date) =>
        `de meegebundelde ECB-middenkoers van ${date}, want er staat nu geen live koers in dit scherm.`,
      costsHeading: `Kosten:`,
      costsBody: `de koersopslag zoals de bank die zelf in haar tarievenoverzicht noemt. Elke regel draagt de bron en de datum die dat document noemt.`,
      privacyNote: `Er wordt niets over je rekeningen verstuurd om die koers of die tarieven op te halen.`,
    },
  },
  globe: {
    legend: {
      euro: `euro — niets te wisselen`,
      rate: `LaVega heeft een koers`,
      noRate: `geen koers bij LaVega`,
      noTender: `geen wettig betaalmiddel`,
      selected: `gekozen`,
    },
    readoutEmpty: `Draai de bol en wijs een land aan, of kies er een uit de lijst eronder.`,
    canvasAriaLabel: `Wereldbol met de bestemmingen. Slepen of de pijltjestoetsen draaien de bol; klikken kiest het land eronder. Elk land is ook te kiezen in de landenlijst onder aan dit blok.`,
    miss: {
      off: `Dat punt ligt naast de bol, dus er is daar geen land.`,
      beyond: (south, north) =>
        `Dat punt ligt buiten de band waarover onze gebundelde grenzen iets zeggen: die loopt van ${south} tot ${north}. Wat daarbuiten ligt kan LaVega niet zeggen — het staat niet in de tabel.`,
      sea: `Daar ligt geen land in onze grenzen: zee, of een land dat op deze schaal geen eigen vlak heeft. Die laatste staan wel in de lijst.`,
      stillSelected: (label) => ` Er is niets veranderd; ${label} blijft gekozen.`,
    },
    noSelection: (value) =>
      `Kies een land op de bol of uit de lijst om de doelvaluta te zetten. De berekening staat nu op ${value}.`,
    effectEuro: {
      leadSuffix: `— euro`,
      sameCurrency: `Daar betaal je met euro's, net als hier. Er valt niets om te wisselen: er is geen omwisseling, en dus ook geen tarief om te vergelijken.`,
      differentCurrency: (from) =>
        `Daar betaal je met euro's. Je zet ${from} over, dus dit is wél een omwisseling. De doelvaluta staat nu op EUR.`,
    },
    effectSet: {
      body: (code) =>
        `De doelvaluta staat nu op ${code}. LaVega heeft daar een koers van, dus de rekenmachine rekent er verder mee.`,
    },
    effectNoRate: {
      leadSuffix: `— geen koers`,
      body: (currency) =>
        `Daar betaal je met ${currency}. Van die valuta heeft LaVega geen koers, dus wat er aankomt kan LaVega niet uitrekenen.`,
      unchanged: (value) => `De doelvaluta is niet veranderd; die staat nog op ${value}.`,
    },
    effectNoTender: {
      leadSuffix: `— geen wettig betaalmiddel`,
      body: `Daar is geen munt: de gebundelde bron noemt er geen wettig betaalmiddel. Dat is iets anders dan een koers die LaVega mist — er is niets om een koers van te hebben, en dus ook niets om te wisselen. Waarmee er op een onderzoeksstation dan wél wordt afgerekend, staat niet in deze tabel.`,
      footer: (value) =>
        `De doelvaluta is niet veranderd; die staat nog op ${value}. Er is hier geen tarief om te tonen — ook geen nul.`,
    },
    effectChoice: {
      leadSuffix: `— meer dan één valuta`,
      prompt: `Daar wordt met meer dan één valuta betaald. LaVega kiest er geen voor je, want dat verandert het antwoord. Welke bedoel je?`,
      noRateSuffix: ` — geen koers`,
      picked: (code) => `De doelvaluta staat nu op ${code}.`,
      pickedNoRate: (currency, value) =>
        `Van ${currency} heeft LaVega geen koers, dus de doelvaluta blijft op ${value} staan. Dat is een leemte bij ons en het is geen nul.`,
    },
    effectUnknown: {
      leadSuffix: `— valuta onbekend`,
      body: `De gebundelde bron noemt voor dit land geen valuta, dus LaVega weet niet waarin je daar betaalt. Dat is wat wij niet weten; het betekent niet dat er geen kosten zijn.`,
      unchanged: (value) => `De doelvaluta is niet veranderd; die staat nog op ${value}.`,
    },
    offMap: {
      noFocus: `Waar dit land ligt weet LaVega niet: de gebundelde bron heeft er vlak noch punt voor. De bol is daarom niet gedraaid, en aanwijzen op de bol kan hier ook niet. Wat er hierboven over de valuta staat, staat daar los van en blijft gelden.`,
      pinOnly: `Dit land wordt op deze schaal niet getekend. De bol staat op de plek waar de bron het neerzet; de speld is het enige wat je er ziet.`,
    },
    search: {
      label: `Zoek of kies een land`,
      placeholder: `Nederland, Japan, Singapore…`,
      resultsAriaLabel: `Landen`,
      emptyResults: `Geen land met die naam of code in de gebundelde lijst.`,
      pinOnlySuffix: ` · geen vlak, wel een plek`,
      pinUnknownSuffix: ` · geen vlak, plek onbekend`,
    },
    source: {
      summary: `Waar de grenzen en valuta's vandaan komen`,
      body: (fetchedAt, south, north) =>
        `Grenzen en valuta's zijn meegebundeld (Natural Earth, CLDR), opgehaald op ${fetchedAt}. Er wordt niets opgehaald terwijl je aan de bol draait. De grenzen lopen van ${south} tot ${north}: Antarctica staat erop, boven de noordpunt van Groenland staat er niets meer in de tabel. Dat laatste is een gat in onze data en geen uitspraak over wat daar ligt.`,
    },
    latitude: {
      south: `zuiderbreedte`,
      north: `noorderbreedte`,
    },
    moneyLine: {
      noTender: `geen betaalmiddel`,
      unknown: `valuta onbekend`,
    },
  },
};

const valutaCopy_en: ValutaCopy = {
  view: {
    head: {
      title: `Transfer money`,
      eyebrowSuffix: ` · rate markup per bank from the catalogue`,
    },
    moduleLabels: {
      grid: `Currency`,
      transferTitle: `Transfer`,
      destinationTitle: `Destination`,
    },
    kindLabel: {
      prepaid: `prepaid card`,
      crypto: `crypto card`,
      beleggingsrekening: `investment account`,
    },
    transfer: {
      fromAccountLabel: `From account`,
      toAccountLabel: `To account`,
      noAccountOption: `no account chosen`,
      amountLabel: `Amount`,
      fromCurrencyLabel: `From currency`,
      toCurrencyLabel: `To currency`,
      swapAriaLabel: `Swap from and to`,
      availableLabel: `Available`,
      arrivesFooterLabel: `Arrives after fees · available`,
      unknown: `unknown`,
    },
    ccySelect: {
      ecbGroupLabel: (count) => `ECB reference rate (${count})`,
      aggregatorGroupLabel: (provider, count) => `Daily rate via ${provider} (${count})`,
    },
    routeRow: {
      heldBadge: `yours`,
      notHeldBadge: `not yours`,
      costUnknown: `cost unknown`,
      sourceNote: (asOf) => `(source: ${asOf})`,
      why: {
        termsUnknownHeld: `This bank's terms are still unknown — and unknown is not 0%.`,
        noRate: `No rate LaVega can back up.`,
        mineOnly: (pct, product) => `${pct} rate markup on ${product}.`,
        mineCheaperElsewhere: (pct, product, cheaperProduct, cheaperPct) =>
          `${pct} rate markup on ${product} — at the same bank, ${cheaperProduct} charges ${cheaperPct}.`,
        uniformHeld: (pct, collapsed, bank) =>
          `${pct} rate markup — the same across all ${collapsed} ${bank} products LaVega knows.`,
        uniformNotHeld: (pct, collapsed, bank) =>
          `${pct} rate markup — the same across all ${collapsed} ${bank} products LaVega knows. You don't hold this bank.`,
        heldUncertain: (pct, product) =>
          `${pct} rate markup on ${product} — whether your package at this bank charges the same, LaVega doesn't know.`,
        notHeld: (pct, product) => `${pct} rate markup on ${product} — you don't hold this bank.`,
      },
    },
    delta: {
      evenExpensive: `same cost`,
      sameSurcharge: `same markup`,
      lessInTotal: (money) => `${money} less in total`,
      moreInTotal: (money) => `${money} more in total`,
      lessSurcharge: (money) => `${money} less markup`,
      moreSurcharge: (money) => `${money} more markup`,
    },
    rateFreshness: {
      live: (date) => `ECB reference rate from ${date}`,
      memory: (date) => `ECB reference rate from ${date}, the last one the server received`,
      bundled: (date) => `the bundled ECB reference rate from ${date}`,
      aggregator: (provider, date) => `${provider}’s daily rate list from ${date}`,
    },
    rateHeadline: {
      offlineFallback: (date) => `ECB mid-rate from ${date}, bundled with the app`,
      liveNoProvenance: `live ECB mid-rate`,
      ecbLayerWordBundled: `bundled ECB rates`,
      ecbLayerWordReference: `ECB reference rates`,
      ecbPiece: (count, layerWord, date) => `${count} ${layerWord} from ${date}`,
      aggregatorPiece: (count, provider, date) => `${count} daily rates via ${provider} from ${date}`,
      joiner: ` and `,
      noLayers: `no rate list in this screen`,
    },
    rateOrigin: {
      ecb: (freshness) => `Calculated with ${freshness}.`,
      aggregator: (freshness) =>
        `Calculated with ${freshness}. That is a composite daily rate, not a central-bank reference rate.`,
      mixed: (ecbLeg, ecbFreshness, aggLeg, aggFreshness) =>
        `Crossed via the euro: ${ecbLeg} comes from ${ecbFreshness}, ${aggLeg} from ${aggFreshness}. The result is only as reliable as that second leg.`,
    },
    noRouteReason: {
      noAccounts: `There is no account in LaVega yet, so there is no bank to convert through.`,
      noBankOnAccounts: `None of your accounts is linked to a bank LaVega can look up — add the bank under Accounts.`,
      unknownFee: (banks) => `LaVega does not know the rate markup for ${banks}, and an unknown fee is not 0%.`,
    },
    reason: {
      arrivesUnknownLead: `What arrives is unknown.`,
      noRateForPair: (from, to) => `LaVega has no rate for ${from} → ${to}.`,
      marketValueNote: (amount) =>
        `At the mid-market rate that is worth ${amount}, but that is the market value, not the amount that arrives.`,
      sameCurrencySentence: (amount, netAmount) =>
        `You are transferring ${amount}, with no conversion. ${netAmount} arrives.`,
      conversionSentence: (amount, mid, gross, bank, pct, costInFrom, netAmount) =>
        `You are transferring ${amount}, at the mid-market rate ${mid} that is ${gross}. Via ${bank} that costs ${pct} (${costInFrom}), so ${netAmount} arrives.`,
    },
    creditNotice: {
      label: `Rates outside the ECB list:`,
    },
    chosenRoute: {
      yours: (product) => `Calculated with ${product}, the product you hold here.`,
      heldElsewhere: (product) => `Calculated with ${product} — check that it is your package.`,
      notHeld: (product) => `Calculated with ${product} — you do not have this bank yet.`,
    },
    recommendation: {
      headingNet: `You could pay less.`,
      headingNoRecommendation: `Lower markup, but not cheaper overall.`,
      headingUnknown: `Lower markup — whether that comes out cheaper, LaVega does not know.`,
      body: (bank, pct, saving) =>
        `${bank} charges ${pct} — that is ${saving} less in rate markup on this amount.`,
      alreadyHeld: `You already have this bank; pick it in the list.`,
      notHeld: `You do not have this bank yet — you would first need to open an account there.`,
    },
    emptyGuide: {
      heading: `No bank to rank yet.`,
      catalogueNote: `The catalogue supplies the rates; it ships with the app and is never fetched.`,
      requirementsNote: `A rate only counts with a value, a source, a date and terms — otherwise it is rejected.`,
      noBankNote: `Accounts without a bank cannot be looked up; add the bank under Accounts.`,
    },
    bankList: {
      summaryEmpty: `Why there is no bank to rank yet`,
      summary: (count) => `All ${count} banks, cheapest first`,
      orderingNote: (amount, bank) =>
        `The order is what this conversion costs you at that bank: the rate markup on ${amount} plus what the account costs to open. The latter counts for at least one full billing period — a month, or a year for an annual product — because you cannot open an account for a single day. A bank you already hold costs you nothing extra: that price runs regardless. Where it says "card fees unknown", only the markup is in the amount; that is a floor, not proof the account is free. The difference behind each bank is measured against ${bank}.`,
      chosenRouteFallback: `the chosen route`,
      backToBest: `Back to the best option`,
      showMoreOne: (hidden) => `Show ${hidden} more bank`,
      showMoreMany: (hidden) => `Show ${hidden} more banks`,
      scopeHeading: `This list covers every bank LaVega can back up`,
      scopeBody: ` — not just the ones you hold. By default LaVega calculates with the cheapest route you can actually use today; a bank you do not hold is listed too, with the difference in euros, but is never chosen silently.`,
      oneRowPerBank: `One row per bank: when transferring, the product does not matter, so the same bank does not appear three times in the list. The product behind the rate is still shown — "ING 0%" only applies to the Platinum card.`,
      noRouteYet: (reason) => `${reason} As long as that is the case, LaVega cannot say what arrives. An unknown fee is not 0%.`,
      switchingBeatsHeading: `What switching would save you:`,
      switchingBeatsBody: (pct, amount) =>
        ` your current choice costs ${pct}. Every bank that charges less leaves you more than ${amount} on this amount — in rate markup. What the account costs to open still comes off that, which is exactly why the order is not based on the percentage alone.`,
      heldUnknown: (banks) => `No known rate, so listed at the bottom: ${banks}.`,
    },
    sourcesPanel: {
      summary: `Where the rate and the fees come from`,
      layer1Heading: `Rate, layer 1:`,
      layer1Bundled: (count, date) =>
        `${count} rates from the bundled ECB snapshot of ${date}, because no live ECB list came in`,
      layer1Reference: (count, date) => `${count} ECB reference rates from ${date} via Frankfurter`,
      layer1MemorySuffix: ` — that is the last list the server received; the attempt just now failed`,
      layer1Footnote: `. The ECB publishes these at a fixed time, using a method you can look up.`,
      layer1Missing: `there is no ECB list in this screen right now. All rates below come from layer 2.`,
      layer2Heading: `Rate, layer 2:`,
      layer2Body: (count, provider, date, nextUpdate) =>
        `${count} rates from ${provider}, as of ${date}${nextUpdate ? `, next update ${nextUpdate}` : ``}. These are composite daily rates: the provider combines them from sources it does not name and refreshes once a day. They only fill the currencies the ECB does not publish — an ECB rate is never overridden by them. If this source drops out, those currencies go back to "no rate"; no stale value is left standing.`,
      layer2UnknownProvider: (provider) =>
        `the server is supplying rates from a provider (${provider}) this screen does not recognise. Those rates may only be shown with the attribution the provider requires, and that is not set up here — so they are not used. The list is therefore limited to what the ECB publishes; for currencies outside that, LaVega currently has no rate.`,
      layer2Missing: `there is no second layer in this screen, so the list is limited to what the ECB publishes. For currencies outside that, LaVega currently has no rate — that is different from a rate of zero.`,
      termsLinkLabel: `terms`,
      rateHeading: `Rate:`,
      rateFallbackLive: (date) => `live ECB mid-rate via Frankfurter, as of ${date}.`,
      rateUnreachable: (date) =>
        `the rate service could not be reached, so these are the bundled rates from ${date}. Refresh later for today's rate.`,
      rateFallbackBundled: (date) =>
        `the bundled ECB mid-rate from ${date}, because there is no live rate in this screen right now.`,
      costsHeading: `Fees:`,
      costsBody: `the rate markup as the bank itself states it in its own fee schedule. Every line carries the source and the date that document names.`,
      privacyNote: `Nothing about your accounts is sent anywhere to fetch that rate or those fees.`,
    },
  },
  globe: {
    legend: {
      euro: `euro — nothing to convert`,
      rate: `LaVega has a rate`,
      noRate: `no rate at LaVega`,
      noTender: `no legal tender`,
      selected: `selected`,
    },
    readoutEmpty: `Spin the globe and point to a country, or pick one from the list below.`,
    canvasAriaLabel: `World globe with destinations. Drag or use the arrow keys to spin the globe; clicking selects the country underneath. Every country can also be chosen from the country list below this block.`,
    miss: {
      off: `That point is beside the globe, so there is no country there.`,
      beyond: (south, north) =>
        `That point is outside the band our bundled borders cover: it runs from ${south} to ${north}. LaVega cannot say what is beyond that — it is not in the table.`,
      sea: `There is no country there within our borders: sea, or a country too small on this scale to have its own shape. The latter are still in the list.`,
      stillSelected: (label) => ` Nothing changed; ${label} is still selected.`,
    },
    noSelection: (value) =>
      `Pick a country on the globe or from the list to set the target currency. The calculation is currently using ${value}.`,
    effectEuro: {
      leadSuffix: `— euro`,
      sameCurrency: `They pay in euros there, just like here. There is nothing to convert: there is no exchange, and so no fee to compare either.`,
      differentCurrency: (from) =>
        `They pay in euros there. You are transferring ${from}, so this is in fact a conversion. The target currency is now set to EUR.`,
    },
    effectSet: {
      body: (code) =>
        `The target currency is now set to ${code}. LaVega has a rate for it, so the calculator keeps using it.`,
    },
    effectNoRate: {
      leadSuffix: `— no rate`,
      body: (currency) =>
        `They pay in ${currency} there. LaVega has no rate for that currency, so it cannot work out what arrives.`,
      unchanged: (value) => `The target currency has not changed; it is still set to ${value}.`,
    },
    effectNoTender: {
      leadSuffix: `— no legal tender`,
      body: `There is no currency there: the bundled source names no legal tender for it. That is different from a rate LaVega is missing — there is nothing to have a rate for, and so nothing to convert. What is actually used to pay at a research station there is not in this table.`,
      footer: (value) =>
        `The target currency has not changed; it is still set to ${value}. There is no fee to show here — not even zero.`,
    },
    effectChoice: {
      leadSuffix: `— more than one currency`,
      prompt: `More than one currency is used to pay there. LaVega will not pick one for you, because that would change the answer. Which did you mean?`,
      noRateSuffix: ` — no rate`,
      picked: (code) => `The target currency is now set to ${code}.`,
      pickedNoRate: (currency, value) =>
        `LaVega has no rate for ${currency}, so the target currency stays at ${value}. That is a gap on our side, and it is not zero.`,
    },
    effectUnknown: {
      leadSuffix: `— currency unknown`,
      body: `The bundled source names no currency for this country, so LaVega does not know what you would pay in there. That is what we do not know; it does not mean there are no costs.`,
      unchanged: (value) => `The target currency has not changed; it is still set to ${value}.`,
    },
    offMap: {
      noFocus: `LaVega does not know where this country is: the bundled source has neither a shape nor a point for it. So the globe has not turned, and pointing on the globe does not work for it either. What is shown above about the currency is unaffected and still applies.`,
      pinOnly: `This country is not drawn at this scale. The globe sits where the source places it; the pin is the only thing you will see there.`,
    },
    search: {
      label: `Search or pick a country`,
      placeholder: `Netherlands, Japan, Singapore…`,
      resultsAriaLabel: `Countries`,
      emptyResults: `No country with that name or code in the bundled list.`,
      pinOnlySuffix: ` · no shape, has a pin`,
      pinUnknownSuffix: ` · no shape, location unknown`,
    },
    source: {
      summary: `Where the borders and currencies come from`,
      body: (fetchedAt, south, north) =>
        `Borders and currencies are bundled (Natural Earth, CLDR), fetched on ${fetchedAt}. Nothing is fetched while you spin the globe. The borders run from ${south} to ${north}: Antarctica is on it, and above the northern tip of Greenland the table has nothing more. That is a gap in our data, not a statement about what is there.`,
    },
    latitude: {
      south: `S`,
      north: `N`,
    },
    moneyLine: {
      noTender: `no tender`,
      unknown: `currency unknown`,
    },
  },
};

/**
 * Copy for the Punten (points/rewards) screen — apps/web/src/views/Punten.tsx.
 *
 * Deliberately NOT included: the ING Punten programme facts (earn rules,
 * packages, the "geen geldwaarde" quote, sources) defined as `ING_PUNTEN` in
 * Punten.tsx. Those are sourced, dated quotes from ING's own terms, not UI
 * chrome — auto-translating a legal quote changes what it asserts. Only the
 * surrounding chrome ("Toon de regels", "Pakket:", "Bron:", the "Zo spaar je
 * X." lead) is covered here, under `card`.
 */
export type PuntenCopy = {
  header: {
    title: string;
    ariaLabel: string;
    /** "3 saldi" / "1 saldo" (NL pluralisation baked in). */
    countLabel: (count: number) => string;
    /** " · 2 te bevestigen", appended only when count > 0. */
    attentionSuffix: (count: number) => string;
  };
  empty: {
    lead: string;
    steps: [string, string, string];
  };
  card: {
    /** Fallback category for a programme the owner typed himself. */
    ownProgramCategory: string;
    stateLabel: { fresh: string; due: string; overdue: string; snoozed: string };
    unitCashback: string;
    unitPoints: string;
    /** "Stand van {date} — {ageText}" */
    asOfTemplate: (date: string, ageText: string) => string;
    ageToday: string;
    ageDaysAgo: (days: number) => string;
    ageFreshTemplate: (age: string, dueDate: string) => string;
    ageSnoozedTemplate: (age: string, resumeDate: string) => string;
    ageOverdueTemplate: (age: string, daysOverdue: number) => string;
    ageDueTemplate: (age: string) => string;
    worthEur: string;
    worthStatedNone: (source: string, validFrom: string, quote: string) => string;
    worthUnknown: string;
    /** "Zo spaar je {program}." — the collapsed-details lead line. */
    factsLead: (program: string) => string;
    factsShowRules: string;
    factsPackageLabel: string;
    factsSourceLabel: string;
    askPlaceholderEur: string;
    askPlaceholderPoints: string;
    askSave: string;
    askCancel: string;
    updateBalance: string;
    notNow: string;
    remindMeLabel: string;
    /** aria-label "Herinnering {program}" on the interval <select>. */
    reminderAriaLabel: (program: string) => string;
    intervalMonthly: string;
    intervalQuarterly: string;
    intervalHalfYearly: string;
    intervalYearly: string;
    remove: string;
  };
  removedBanner: {
    /** " is verwijderd — ", appended after the bold programme name. */
    removedSuffix: string;
    cashbackUnit: string;
    pointsUnit: string;
    /** "van {date}. Dat getal stond alleen hier." */
    dateOnlySuffix: (date: string) => string;
    undo: string;
  };
  addForm: {
    heading: string;
    overwriteHint: string;
    programLabel: string;
    programPlaceholder: string;
    cashbackLabel: string;
    pointsLabel: string;
    amountPlaceholderEur: string;
    amountPlaceholderPoints: string;
    seenOnLabel: string;
    updatedAtAriaLabel: string;
    ingHintBefore: string;
    /** Kept as the literal programme-list option name in both locales. */
    ingHintBold: string;
    ingHintAfter: string;
    /** " staat al in de lijst: ", appended after the bold programme name. */
    existingOverwriteSuffix: string;
    /** "van {date}. Overschrijven zet jouw nieuwe getal daarvoor in de plaats — …" */
    existingOverwriteDateSuffix: (date: string) => string;
    submitOverwrite: string;
    submitSave: string;
    errorNoNumber: string;
    errorNoProgram: string;
    errorNoDate: string;
    errorAskNoNumber: string;
  };
};

const puntenCopy_nl: PuntenCopy = {
  header: {
    title: "Punten",
    ariaLabel: "Punten",
    countLabel: (count) => `${count} ${count === 1 ? "saldo" : "saldi"}`,
    attentionSuffix: (count) => ` · ${count} te bevestigen`,
  },
  empty: {
    lead: "Nog geen punten- of cashback-saldi.",
    steps: [
      "Zoek het saldo op in de app of de mail van het programma zelf.",
      "Voeg het hieronder toe met de datum waarop je het zag.",
      "LaVega vraagt je daarna elk kwartaal om het te bevestigen — dat interval kun je per programma aanpassen.",
    ],
  },
  card: {
    ownProgramCategory: "eigen programma",
    stateLabel: { fresh: "actueel", due: "bevestigen", overdue: "verouderd", snoozed: "later" },
    unitCashback: "cashback",
    unitPoints: "punten",
    asOfTemplate: (date, ageText) => `Stand van ${date} — ${ageText}`,
    ageToday: "vandaag ingevoerd",
    ageDaysAgo: (days) => `${days} ${days === 1 ? "dag" : "dagen"} geleden ingevoerd`,
    ageFreshTemplate: (age, dueDate) => `${age}. LaVega vraagt hier vanaf ${dueDate} weer naar.`,
    ageSnoozedTemplate: (age, resumeDate) =>
      `${age}. Je vroeg om later — LaVega vraagt weer vanaf ${resumeDate}.`,
    ageOverdueTemplate: (age, daysOverdue) =>
      `${age}, ${daysOverdue} ${daysOverdue === 1 ? "dag" : "dagen"} over de afgesproken termijn.`,
    ageDueTemplate: (age) => `${age}. Tijd om te bevestigen.`,
    worthEur:
      "Waarde: dit bedrag zelf — dit programma keert uit in euro's, er zit geen omrekening tussen.",
    worthStatedNone: (source, validFrom, quote) =>
      `In geld: niets. ${source} (geldig vanaf ${validFrom}): “${quote}” Wat één punt aan korting oplevert, is niet gepubliceerd: dat is onbekend en niet nul.`,
    worthUnknown: "Waarde: niet vast te stellen zonder te weten waarvoor je ze inwisselt.",
    factsLead: (program) => `Zo spaar je ${program}.`,
    factsShowRules: "Toon de regels",
    factsPackageLabel: "Pakket: ",
    factsSourceLabel: "Bron: ",
    askPlaceholderEur: "bijv. 42",
    askPlaceholderPoints: "bijv. 245000",
    askSave: "Opslaan",
    askCancel: "Annuleer",
    updateBalance: "Saldo bijwerken",
    notNow: "Niet nu",
    remindMeLabel: "Vraag me",
    reminderAriaLabel: (program) => `Herinnering ${program}`,
    intervalMonthly: "elke maand",
    intervalQuarterly: "elk kwartaal",
    intervalHalfYearly: "elk half jaar",
    intervalYearly: "elk jaar",
    remove: "Verwijder",
  },
  removedBanner: {
    removedSuffix: " is verwijderd — ",
    cashbackUnit: "cashback",
    pointsUnit: "punten",
    dateOnlySuffix: (date) => `van ${date}. Dat getal stond alleen hier.`,
    undo: "Zet terug",
  },
  addForm: {
    heading: "Saldo toevoegen",
    overwriteHint: "of een bestaand programma overschrijven",
    programLabel: "Programma",
    programPlaceholder: "bijv. Marriott Bonvoy",
    cashbackLabel: "Cashback in hele euro's",
    pointsLabel: "Punten",
    amountPlaceholderEur: "bijv. 42",
    amountPlaceholderPoints: "bijv. 245000",
    seenOnLabel: "Gezien op",
    updatedAtAriaLabel: "Bijgewerkt op",
    ingHintBefore: "Spaar je ING Punten? Kies dan ",
    ingHintBold: "ING Punten",
    ingHintAfter:
      " in het veld hierboven — daar staan de verdienregels van ING bij. Wat “ING” zelf bijhoudt, weet LaVega niet.",
    existingOverwriteSuffix: " staat al in de lijst: ",
    existingOverwriteDateSuffix: (date) =>
      `van ${date}. Overschrijven zet jouw nieuwe getal daarvoor in de plaats — dat oude saldo is er dan niet meer. Je herinnering blijft wel staan. Wil je een ander programma toevoegen, verander dan eerst het veld hierboven.`,
    submitOverwrite: "Overschrijven",
    submitSave: "Opslaan",
    errorNoNumber:
      "Ik kon hier geen getal in vinden — vul alleen het saldo in, bijvoorbeeld 245000 of 245k.",
    errorNoProgram:
      "Bij welk programma hoort dit saldo? Kies of typ een programma — anders weet ik niet waar dit getal thuishoort.",
    errorNoDate: "Vul de datum in waarop je dit saldo zag.",
    errorAskNoNumber: "Ik kon daar geen enkel getal in vinden — stuur alleen het saldo.",
  },
};

const puntenCopy_en: PuntenCopy = {
  header: {
    title: "Points",
    ariaLabel: "Points",
    countLabel: (count) => `${count} ${count === 1 ? "balance" : "balances"}`,
    attentionSuffix: (count) => ` · ${count} to confirm`,
  },
  empty: {
    lead: "No points or cashback balances yet.",
    steps: [
      "Look up the balance in the programme's own app or email.",
      "Add it below with the date you saw it.",
      "LaVega will then ask you to confirm it every quarter — you can change that interval per programme.",
    ],
  },
  card: {
    ownProgramCategory: "own programme",
    stateLabel: { fresh: "current", due: "confirm", overdue: "out of date", snoozed: "later" },
    unitCashback: "cashback",
    unitPoints: "points",
    asOfTemplate: (date, ageText) => `As of ${date} — ${ageText}`,
    ageToday: "entered today",
    ageDaysAgo: (days) => `entered ${days} day${days === 1 ? "" : "s"} ago`,
    ageFreshTemplate: (age, dueDate) => `${age}. LaVega will ask again from ${dueDate}.`,
    ageSnoozedTemplate: (age, resumeDate) =>
      `${age}. You asked to be reminded later — LaVega will ask again from ${resumeDate}.`,
    ageOverdueTemplate: (age, daysOverdue) =>
      `${age}, ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} past the agreed interval.`,
    ageDueTemplate: (age) => `${age}. Time to confirm it.`,
    worthEur:
      "Value: this amount itself — this programme pays out in euros, with no conversion in between.",
    worthStatedNone: (source, validFrom, quote) =>
      `In cash: nothing. ${source} (in effect from ${validFrom}): “${quote}” What one point is worth as a discount is not published: that's unknown, not zero.`,
    worthUnknown: "Value: not possible to say without knowing what you'd redeem them for.",
    factsLead: (program) => `How you earn ${program}.`,
    factsShowRules: "Show the rules",
    factsPackageLabel: "Package: ",
    factsSourceLabel: "Source: ",
    askPlaceholderEur: "e.g. 42",
    askPlaceholderPoints: "e.g. 245000",
    askSave: "Save",
    askCancel: "Cancel",
    updateBalance: "Update balance",
    notNow: "Not now",
    remindMeLabel: "Ask me",
    reminderAriaLabel: (program) => `Reminder ${program}`,
    intervalMonthly: "every month",
    intervalQuarterly: "every quarter",
    intervalHalfYearly: "every six months",
    intervalYearly: "every year",
    remove: "Remove",
  },
  removedBanner: {
    removedSuffix: " has been removed — ",
    cashbackUnit: "cashback",
    pointsUnit: "points",
    dateOnlySuffix: (date) => `from ${date}. That figure only ever lived here.`,
    undo: "Undo",
  },
  addForm: {
    heading: "Add a balance",
    overwriteHint: "or overwrite an existing programme",
    programLabel: "Programme",
    programPlaceholder: "e.g. Marriott Bonvoy",
    cashbackLabel: "Cashback in whole euros",
    pointsLabel: "Points",
    amountPlaceholderEur: "e.g. 42",
    amountPlaceholderPoints: "e.g. 245000",
    seenOnLabel: "Seen on",
    updatedAtAriaLabel: "Updated on",
    ingHintBefore: "Saving up ING Punten? Choose ",
    ingHintBold: "ING Punten",
    ingHintAfter:
      " in the field above — that's where ING's earning rules are listed. What plain “ING” tracks on its own, LaVega doesn't know.",
    existingOverwriteSuffix: " is already on the list: ",
    existingOverwriteDateSuffix: (date) =>
      `from ${date}. Overwriting puts your new figure in its place — the old balance will be gone. Your reminder setting stays as it is. To add a different programme instead, change the field above first.`,
    submitOverwrite: "Overwrite",
    submitSave: "Save",
    errorNoNumber:
      "I couldn't find a number in that — enter just the balance, for example 245000 or 245k.",
    errorNoProgram:
      "Which programme is this balance for? Choose or type a programme — otherwise I don't know where this figure belongs.",
    errorNoDate: "Enter the date you saw this balance.",
    errorAskNoNumber: "I couldn't find any number in that — send just the balance.",
  },
};

/**
 * Copy for the `grens` slice, extracted from apps/web/src/views/Grens.tsx.
 * Most entries are sentence-generating functions with pluralization and
 * conditional branches (zero-of-N states, matched vs. unmatched legs, known
 * vs. unknown amounts), so this slice keeps the same function shapes, one
 * full implementation per locale, rather than flattening into plain strings.
 *
 * Currency formatting is done INSIDE each locale's functions via
 * `formatEuroIn(locale, …)`, replacing the view's local `euro()` helper
 * (which wrapped the Dutch-only `formatEuro`). Date strings are passed
 * through unchanged in both locales.
 */

const listNl = (items: readonly string[]): string => {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} en ${items[items.length - 1]}`;
};

const listEn = (items: readonly string[]): string => {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};

export type GrensCopy = {
  header: {
    title: string;
  };
  /** Hoe een kant van de grens heet als er geen ondernemingsnaam bij hoort.
   *  Stond als `ENTITY_SCOPE_LABELS` in core (Privé/Zakelijk) en kwam daarmee
   *  in het Nederlands op een Engels scherm. Let op het register: dit scherm
   *  zegt "Privé", de schakelaar bovenin zegt "Persoonlijk"; die twee mogen
   *  binnen één scherm niet door elkaar lopen, dus dit is een eigen entry en
   *  geen verwijzing naar `shellCopy.scope`. */
  sideFallback: Record<EntityScope, string>;
  emptyStates: {
    geenZakelijkeEntiteit: (a: {
      unclassified: readonly string[];
      personal: readonly string[];
    }) => string[];
    geenPersoonlijkeEntiteit: (a: { business: readonly string[] }) => string[];
    geenTransacties: (a: {
      business: readonly string[];
      personal: readonly string[];
      from: string;
      to: string;
    }) => string[];
    nietsGekruist: (a: { from: string; to: string; obsFrom: string; obsTo: string }) => string[];
  };
  coverage: (a: { unknownCounterAccount: number; ownNameKnown: boolean }) => string[];
  provenance: (a: {
    from: string;
    to: string;
    obsFrom: string;
    obsTo: string;
    pairWindowDays: number;
  }) => string[];
  stream: {
    heading: (a: {
      fromLabel: string;
      toLabel: string;
      count: number;
      totalCents: number;
      matchedCents: number;
      unmatchedCents: number;
      knownCents: number;
      unknownCents: number;
    }) => string[];
    answer: (a: {
      kind: CrossScopeKind;
      source: "user" | "agent";
      at: string | null;
      count: number;
      firstDate: string;
      lastDate: string;
    }) => string[];
    question: (a: {
      fromLabel: string;
      toLabel: string;
      unknownCents: number;
      unknownCount: number;
      lastDate: string;
    }) => string[];
  };
  crossing: {
    twoLegs: (a: {
      amountCents: number;
      date: string;
      fromLabel: string;
      toLabel: string;
      uitLabel: string;
      uitDate: string;
      uitCents: number;
      inLabel: string;
      inDate: string;
      inCents: number;
    }) => string[];
    oneLeg: (a: {
      amountCents: number;
      date: string;
      fromLabel: string;
      toLabel: string;
      evidence: CrossScopeEvidence;
      uitgaand: boolean;
    }) => string[];
    moreRows: (a: { hidden: number; shown: number; count: number }) => string[];
  };
  excluded: (a: {
    noAccount: number;
    noEntity: number;
    currencyMismatch: number;
    mirrorSuppressed: number;
  }) => string[];
  betweenBusiness: (a: { business: readonly string[] }) => string[];
  byproduct: {
    heading: string;
    summary: (a: { rows: number }) => string[];
    row: (a: {
      label: string;
      personalCount: number;
      personalCents: number;
      businessCount: number;
      businessCents: number;
      firstDate: string;
      lastDate: string;
    }) => string[];
  };
  answerForm: {
    explanation: (a: { streams: number }) => string[];
    savedNote: (a: { saved: number }) => string[];
    reviewButtonLabel: (count: number) => string;
    toonMeerSummary: string;
    ariaWhatWas: (label: string) => string;
    /** Separator between the first and last date of a stream's measured window, e.g. "12-03-2026 t/m 20-07-2026". */
    dateRangeSeparator: string;
    table: {
      stream: string;
      measured: string;
      whatWasThis: string;
      notYetAnswered: string;
      salaris: string;
      dividend: string;
      dontKnow: string;
      save: string;
      cancel: string;
    };
  };
  footer: string[];
  labels: {
    kind: Record<CrossScopeKind, string>;
    source: Record<"user" | "agent", string>;
    evidenceReason: Record<CrossScopeEvidence, string>;
  };
};

const grensCopy_nl: GrensCopy = {
  header: { title: "Privé en zakelijk" },
  sideFallback: { personal: "Privé", business: "Zakelijk" },

  emptyStates: {
    geenZakelijkeEntiteit(a) {
      const out = [
        "Je hebt nog geen onderneming als zakelijk gemarkeerd, dus er is geen grens om te meten. Dat is iets anders dan nul overboekingen: er valt hier nog niets te vergelijken.",
        "Onder Profiel → “Persoonlijk of zakelijk” bepaal je zelf welke onderneming een bedrijf is; wat je niet indeelt, telt als privé.",
      ];
      if (a.unclassified.length > 0) {
        out.push(
          `LaVega ziet nu ${a.unclassified.length} onderneming${a.unclassified.length === 1 ? "" : "en"} waarvan dat nog niet gezegd is: ${listNl(a.unclassified)}.`,
        );
      } else if (a.personal.length > 0) {
        out.push(
          `LaVega ziet nu alleen ondernemingen die als privé zijn gemarkeerd: ${listNl(a.personal)}.`,
        );
      } else {
        out.push("Er staat nog geen onderneming in je vault; die komen er met je eerste import bij.");
      }
      return out;
    },
    geenPersoonlijkeEntiteit(a) {
      return [
        `Elke onderneming in je vault is als zakelijk gemarkeerd (${listNl(a.business)}), dus er is geen privékant om naartoe over te steken.`,
        "Ook dat is geen nul: er is geen overkant om te meten. Welke onderneming wat is, staat onder Profiel → “Persoonlijk of zakelijk”.",
      ];
    },
    geenTransacties(a) {
      return [
        `${listNl(a.business)} ${a.business.length === 1 ? "is" : "zijn"} als zakelijk gemarkeerd en ${listNl(a.personal)} als privé, maar van ${a.from} t/m ${a.to} staat er geen transactie in je vault die LaVega op een van die ondernemingen kan plaatsen.`,
        "Dat is geen nul — er is niets om te meten.",
      ];
    },
    nietsGekruist(a) {
      return [
        `Van ${a.from} t/m ${a.to} vond LaVega geen overboeking die de grens tussen zakelijk en privé oversteekt.`,
        `Dit is wél gemeten: LaVega heeft de transacties van ${a.obsFrom} t/m ${a.obsTo} aan beide kanten van de grens gelezen.`,
      ];
    },
  },

  coverage(a) {
    const out = [
      "LaVega herkent een overboeking naar jezelf aan één van drie dingen: de tegenboeking staat in je vault, er staat een andere rekening van jezelf op de regel, of er staat je eigen naam op. Een afschrijving met geen van die drie telt hier niet mee — dan is er geen bewijs dat het geld naar jou ging in plaats van naar iemand anders.",
    ];
    if (a.unknownCounterAccount > 0) {
      out.push(
        `Op ${a.unknownCounterAccount} afschrijving${a.unknownCounterAccount === 1 ? "" : "en"} van een zakelijke rekening staat een rekeningnummer dat in geen enkele rekening van je vault voorkomt. Van wie die rekening is, ziet LaVega niet, dus ${a.unknownCounterAccount === 1 ? "die rij telt" : "die rijen tellen"} hier niet mee. Een rekening die je zelf importeert, herkent LaVega wél.`,
      );
    }
    if (!a.ownNameKnown) {
      out.push(
        "Je eigen naam staat niet in je profiel. Een afschrijving waar alleen jouw naam op staat en geen rekening uit je vault, herkent LaVega daardoor niet als kruising; onder Profiel staat het veld waar die naam vandaan komt.",
      );
    }
    return out;
  },

  provenance(a) {
    return [
      `Gemeten in je transacties van ${a.from} t/m ${a.to}; de eerste rij die LaVega daarin zag is van ${a.obsFrom}, de laatste van ${a.obsTo}.`,
      `Een overboeking is aan twee kanten gemeten als beide rekeningen in je vault staan, de bedragen op de cent gelijk zijn en de bijschrijving 0 tot ${a.pairWindowDays} dagen na de afschrijving valt. Wat maar één kant heeft, staat er apart bij, met de reden waarom die rij op de lijst staat.`,
    ];
  },

  stream: {
    heading(a) {
      const euro = (c: number) => formatEuroIn("nl", c / 100);
      const out = [
        `${euro(a.totalCents)} ging van ${a.fromLabel} naar ${a.toLabel}, in ${a.count} overboeking${a.count === 1 ? "" : "en"}.`,
      ];
      if (a.unmatchedCents === 0) out.push("Van al deze overboekingen staan beide kanten in je vault.");
      else if (a.matchedCents === 0)
        out.push(
          "Van geen van deze overboekingen staat de tegenboeking in je vault; elke rij is aan één kant gemeten.",
        );
      else
        out.push(
          `Van ${euro(a.matchedCents)} staan beide kanten in je vault; van ${euro(a.unmatchedCents)} maar één kant.`,
        );

      if (a.unknownCents === 0) out.push("Je hebt zelf gezegd wat deze overboekingen waren.");
      else if (a.knownCents === 0)
        out.push("LaVega weet van geen van deze overboekingen wat het was.");
      else
        out.push(
          `Van ${euro(a.knownCents)} heb je zelf gezegd wat het was; van ${euro(a.unknownCents)} weet LaVega niet wat het was.`,
        );
      return out;
    },
    answer(a) {
      return [
        `${grensCopy_nl.labels.source[a.source]} deze stroom “${grensCopy_nl.labels.kind[a.kind]}”${a.at ? ` op ${a.at}` : ""}. Dat antwoord staat bij alle ${a.count} overboeking${a.count === 1 ? "" : "en"} van deze stroom, van ${a.firstDate} t/m ${a.lastDate}.`,
      ];
    },
    question(a) {
      const euro = (c: number) => formatEuroIn("nl", c / 100);
      return [
        `${euro(a.unknownCents)} · ${a.unknownCount} overboeking${a.unknownCount === 1 ? "" : "en"}, de laatste op ${a.lastDate} · ${a.fromLabel} → ${a.toLabel}. LaVega ziet niet wat deze overboekingen waren. Wat was dit?`,
      ];
    },
  },

  crossing: {
    twoLegs(a) {
      const euro = (c: number) => formatEuroIn("nl", c / 100);
      return [
        `${euro(a.amountCents)} · ${a.date} · ${a.fromLabel} → ${a.toLabel}. Beide kanten staan in je vault: er ging ${euro(Math.abs(a.uitCents))} van ${a.uitLabel} af op ${a.uitDate}, en er kwam ${euro(Math.abs(a.inCents))} op ${a.inLabel} binnen op ${a.inDate}.`,
      ];
    },
    oneLeg(a) {
      const euro = (c: number) => formatEuroIn("nl", c / 100);
      return [
        `${euro(a.amountCents)} · ${a.date} · ${a.fromLabel} → ${a.toLabel}. LaVega ziet geen tegenboeking in je vault: een rekening die je niet geïmporteerd hebt, laat er geen achter. ${grensCopy_nl.labels.evidenceReason[a.evidence]} Eén kant is dus gemeten, en dit bedrag telt één keer mee in het totaal hierboven. ${a.uitgaand ? "Waar kwam dit terecht?" : "Waar kwam dit vandaan?"}`,
      ];
    },
    moreRows(a) {
      return [
        `De lijst toont de ${a.shown} grootste van ${a.count}; de andere ${a.hidden} staan er niet bij, maar tellen wel mee in het totaal hierboven.`,
      ];
    },
  },

  excluded(a) {
    const out: string[] = [];
    if (a.noAccount > 0) {
      out.push(
        `${a.noAccount} transactie${a.noAccount === 1 ? "" : "s"} in dit venster ${a.noAccount === 1 ? "staat" : "staan"} op een rekening die niet in je vault staat. Die hoort bij geen enkele onderneming en telt hier dus niet mee.`,
      );
    }
    if (a.noEntity > 0) {
      out.push(
        `${a.noEntity} transactie${a.noEntity === 1 ? "" : "s"} ${a.noEntity === 1 ? "staat" : "staan"} op een rekening waar nog geen onderneming bij ingevuld is. Zolang dat veld leeg is, kan LaVega niet zeggen aan welke kant van de grens die rekening hoort, en “privé” invullen zou een aanname zijn.`,
      );
    }
    if (a.currencyMismatch > 0) {
      out.push(
        `Bij ${a.currencyMismatch} afschrijving${a.currencyMismatch === 1 ? "" : "en"} stond aan de andere kant van de grens hetzelfde bedrag in een andere valuta. LaVega koppelt die niet: daarvoor zou het een wisselkoers invullen die het niet gemeten heeft. Een echte omwisseling heeft aan twee kanten een verschillend bedrag en valt hier helemaal buiten, dus dit aantal is een ondergrens.`,
      );
    }
    if (a.mirrorSuppressed > 0) {
      out.push(
        `${a.mirrorSuppressed} rij${a.mirrorSuppressed === 1 ? "" : "en"} telt LaVega één keer in plaats van twee: aan beide kanten van de grens stond hetzelfde bedrag in dezelfde richting, te ver uit elkaar om als één overboeking gekoppeld te worden. Dubbel tellen is de fout die je niet ziet; te weinig tellen is de fout die hier staat.`,
      );
    }
    if (out.length === 0)
      out.push("Elke transactie in dit venster stond op een rekening die bij een onderneming hoort.");
    return out;
  },

  betweenBusiness(a) {
    return [
      `Overboekingen tussen ${listNl(a.business)} staan hier niet: die zijn allemaal als zakelijk gemarkeerd, dus ze steken de grens niet over.`,
    ];
  },

  byproduct: {
    heading: "Zakelijke kosten van een privérekening",
    summary(a) {
      if (a.rows === 0)
        return [
          "Geen enkele tegenpartij komt in dit venster op zowel een privérekening als een zakelijke rekening voor.",
        ];
      return [
        `${a.rows} tegenpartij${a.rows === 1 ? "" : "en"} ${a.rows === 1 ? "komt" : "komen"} in dit venster op zowel een privérekening als een zakelijke rekening voor. Dat is één naam op twee rekeningen — gemeten, en het zegt niets over aftrekbaarheid.`,
        "Een bank, een telefoonmaatschappij of een verzekeraar staat daar met recht tussen. LaVega filtert die niet weg: een uitzonderingenlijst is hoe een meting stilletjes een mening wordt.",
      ];
    },
    row(a) {
      const euro = (c: number) => formatEuroIn("nl", c / 100);
      return [
        `${a.label}: ${a.personalCount} betaling${a.personalCount === 1 ? "" : "en"} van ${a.personalCount === 1 ? "" : "samen "}${euro(a.personalCents)} vanaf een privérekening en ${a.businessCount} van ${a.businessCount === 1 ? "" : "samen "}${euro(a.businessCents)} vanaf een zakelijke rekening, tussen ${a.firstDate} en ${a.lastDate}. Horen die privébetalingen bij je onderneming?`,
      ];
    },
  },

  answerForm: {
    explanation(a) {
      return [
        `${a.streams} stroom${a.streams === 1 ? "" : "en"} zonder antwoord. Per stroom één vraag, niet per overboeking.`,
        "Je antwoord wordt in je versleutelde vault bewaard en gaat nergens heen: het verandert geen enkel bedrag hierboven, LaVega zet het ernaast. Laat “nog niet beantwoord” staan bij wat je nu niet weet — “weet ik niet” is ook een antwoord, en daarna wordt er niet meer naar gevraagd.",
      ];
    },
    savedNote(a) {
      if (a.saved === 0) return ["Niets bewaard: er stond nog geen antwoord ingevuld."];
      return [
        `${a.saved} stroom${a.saved === 1 ? "" : "en"} beantwoord en in je vault bewaard. De gemeten bedragen hierboven zijn er niet door veranderd.`,
      ];
    },
    reviewButtonLabel: (count) => `Beantwoord ${count} stroom${count === 1 ? "" : "en"}`,
    toonMeerSummary: "Hoe dit gemeten is",
    ariaWhatWas: (label) => `Wat was ${label}`,
    dateRangeSeparator: "t/m",
    table: {
      stream: "Stroom",
      measured: "Gemeten",
      whatWasThis: "Wat was dit?",
      notYetAnswered: "nog niet beantwoord",
      salaris: "Salaris",
      dividend: "Dividend",
      dontKnow: "Weet ik niet",
      save: "Bewaar antwoorden",
      cancel: "Annuleer",
    },
  },

  footer: [
    "Deze module meet wat er tussen je ondernemingen en je privérekeningen bewoog, in centen en op datum. Ze rekent geen belasting uit en trekt geen conclusie over wat een overboeking betekent — wat LaVega hier niet berekent, staat in “Niet berekend” hieronder.",
  ],

  labels: {
    kind: { salaris: "salaris", dividend: "dividend", onbekend: "weet ik niet" },
    source: { user: "Jij noemde", agent: "Een agent noemde" },
    evidenceReason: {
      "twee-benen": "Beide kanten staan in je vault.",
      "eigen-rekening-genoemd":
        "Deze rij staat er toch bij omdat er een andere rekening van jezelf op staat, aan de andere kant van de grens.",
      "eigen-naam-genoemd":
        "Deze rij staat er toch bij omdat er je eigen naam op staat, zoals je die zelf in je profiel hebt ingevuld.",
    },
  },
};

const grensCopy_en: GrensCopy = {
  header: { title: "Personal and business" },
  sideFallback: { personal: "Private", business: "Business" },

  emptyStates: {
    geenZakelijkeEntiteit(a) {
      const out = [
        "You haven't marked any entity as business yet, so there's no boundary to measure. That's different from zero transfers — there's nothing here to compare yet.",
        "Under Profile → “Personal or business” you decide which entity is a company; anything you don't classify counts as personal.",
      ];
      if (a.unclassified.length > 0) {
        out.push(
          `LaVega currently sees ${a.unclassified.length} entit${a.unclassified.length === 1 ? "y" : "ies"} you haven't classified yet: ${listEn(a.unclassified)}.`,
        );
      } else if (a.personal.length > 0) {
        out.push(`LaVega currently sees only entities marked as personal: ${listEn(a.personal)}.`);
      } else {
        out.push("There's no entity in your vault yet; those will appear with your first import.");
      }
      return out;
    },
    geenPersoonlijkeEntiteit(a) {
      return [
        `Every entity in your vault is marked as business (${listEn(a.business)}), so there's no personal side to cross into.`,
        "That's not a zero either: there's simply no other side to measure. Which entity is which lives under Profile → “Personal or business”.",
      ];
    },
    geenTransacties(a) {
      return [
        `${listEn(a.business)} ${a.business.length === 1 ? "is" : "are"} marked as business and ${listEn(a.personal)} as personal, but from ${a.from} through ${a.to} there's no transaction in your vault that LaVega can place on any of those entities.`,
        "That's not a zero — there's nothing to measure.",
      ];
    },
    nietsGekruist(a) {
      return [
        `From ${a.from} through ${a.to}, LaVega found no transfer crossing the boundary between business and personal.`,
        `This was still measured: LaVega read the transactions from ${a.obsFrom} through ${a.obsTo} on both sides of the boundary.`,
      ];
    },
  },

  coverage(a) {
    const out = [
      "LaVega recognizes a transfer to you by one of three things: the matching entry is in your vault, another account of yours appears on the row, or your own name appears on it. A debit with none of those three doesn't count here — there's no evidence the money went to you rather than someone else.",
    ];
    if (a.unknownCounterAccount > 0) {
      out.push(
        `${a.unknownCounterAccount} debit${a.unknownCounterAccount === 1 ? "" : "s"} from a business account ${a.unknownCounterAccount === 1 ? "shows" : "show"} an account number that doesn't match any account in your vault. LaVega can't see whose account that is, so ${a.unknownCounterAccount === 1 ? "that row doesn't" : "those rows don't"} count here. An account you import yourself, LaVega does recognize.`,
      );
    }
    if (!a.ownNameKnown) {
      out.push(
        "Your own name isn't set in your profile. A debit carrying only your name, with no account from your vault, isn't recognized by LaVega as a crossing because of that; the field where that name comes from is under Profile.",
      );
    }
    return out;
  },

  provenance(a) {
    return [
      `Measured across your transactions from ${a.from} through ${a.to}; the first row LaVega saw there is dated ${a.obsFrom}, the last ${a.obsTo}.`,
      `A transfer is measured on both sides when both accounts are in your vault, the amounts match to the cent, and the credit lands 0 to ${a.pairWindowDays} days after the debit. Anything with only one side is listed separately, with the reason it's on the list.`,
    ];
  },

  stream: {
    heading(a) {
      const euro = (c: number) => formatEuroIn("en", c / 100);
      const out = [
        `${euro(a.totalCents)} moved from ${a.fromLabel} to ${a.toLabel}, across ${a.count} transfer${a.count === 1 ? "" : "s"}.`,
      ];
      if (a.unmatchedCents === 0) out.push("Both sides of every one of these transfers are in your vault.");
      else if (a.matchedCents === 0)
        out.push(
          "None of these transfers has its matching entry in your vault; each row is measured on one side only.",
        );
      else
        out.push(
          `${euro(a.matchedCents)} has both sides in your vault; ${euro(a.unmatchedCents)} has only one side.`,
        );

      if (a.unknownCents === 0) out.push("You've told LaVega what these transfers were.");
      else if (a.knownCents === 0) out.push("LaVega doesn't know what any of these transfers were.");
      else
        out.push(
          `${euro(a.knownCents)} is something you've told LaVega about; LaVega doesn't know what the remaining ${euro(a.unknownCents)} was.`,
        );
      return out;
    },
    answer(a) {
      return [
        `${grensCopy_en.labels.source[a.source]} this stream “${grensCopy_en.labels.kind[a.kind]}”${a.at ? ` on ${a.at}` : ""}. That answer applies to all ${a.count} transfer${a.count === 1 ? "" : "s"} in this stream, from ${a.firstDate} through ${a.lastDate}.`,
      ];
    },
    question(a) {
      const euro = (c: number) => formatEuroIn("en", c / 100);
      return [
        `${euro(a.unknownCents)} · ${a.unknownCount} transfer${a.unknownCount === 1 ? "" : "s"}, the latest on ${a.lastDate} · ${a.fromLabel} → ${a.toLabel}. LaVega can't tell what these transfers were. What was this?`,
      ];
    },
  },

  crossing: {
    twoLegs(a) {
      const euro = (c: number) => formatEuroIn("en", c / 100);
      return [
        `${euro(a.amountCents)} · ${a.date} · ${a.fromLabel} → ${a.toLabel}. Both sides are in your vault: ${euro(Math.abs(a.uitCents))} left ${a.uitLabel} on ${a.uitDate}, and ${euro(Math.abs(a.inCents))} arrived in ${a.inLabel} on ${a.inDate}.`,
      ];
    },
    oneLeg(a) {
      const euro = (c: number) => formatEuroIn("en", c / 100);
      return [
        `${euro(a.amountCents)} · ${a.date} · ${a.fromLabel} → ${a.toLabel}. LaVega sees no matching entry in your vault: an account you haven't imported leaves none behind. ${grensCopy_en.labels.evidenceReason[a.evidence]} So only one side is measured, and this amount counts once in the total above. ${a.uitgaand ? "Where did this end up?" : "Where did this come from?"}`,
      ];
    },
    moreRows(a) {
      return [
        `The list shows the ${a.shown} largest of ${a.count}; the other ${a.hidden} aren't listed, but they do count in the total above.`,
      ];
    },
  },

  excluded(a) {
    const out: string[] = [];
    if (a.noAccount > 0) {
      out.push(
        `${a.noAccount} transaction${a.noAccount === 1 ? "" : "s"} in this window ${a.noAccount === 1 ? "sits" : "sit"} on an account that isn't in your vault. It belongs to no entity, so it doesn't count here.`,
      );
    }
    if (a.noEntity > 0) {
      out.push(
        `${a.noEntity} transaction${a.noEntity === 1 ? "" : "s"} ${a.noEntity === 1 ? "sits" : "sit"} on an account with no entity filled in yet. While that field is empty, LaVega can't say which side of the boundary that account is on, and filling in “personal” would be an assumption.`,
      );
    }
    if (a.currencyMismatch > 0) {
      out.push(
        `For ${a.currencyMismatch} debit${a.currencyMismatch === 1 ? "" : "s"}, the other side of the boundary showed the same amount in a different currency. LaVega doesn't link those: that would mean filling in an exchange rate it never measured. A genuine conversion has a different amount on each side and falls outside this measurement entirely, so this count is a lower bound.`,
      );
    }
    if (a.mirrorSuppressed > 0) {
      out.push(
        `LaVega counts ${a.mirrorSuppressed} row${a.mirrorSuppressed === 1 ? "" : "s"} once instead of twice: both sides of the boundary showed the same amount in the same direction, too far apart in time to link as one transfer. Double-counting is the mistake you don't see; undercounting is the one here.`,
      );
    }
    if (out.length === 0)
      out.push("Every transaction in this window sat on an account that belongs to an entity.");
    return out;
  },

  betweenBusiness(a) {
    return [
      `Transfers between ${listEn(a.business)} aren't shown here: they're all marked as business, so they don't cross the boundary.`,
    ];
  },

  byproduct: {
    heading: "Business costs paid from a personal account",
    summary(a) {
      if (a.rows === 0)
        return [
          "No counterparty in this window appears on both a personal account and a business account.",
        ];
      return [
        `${a.rows} counterpart${a.rows === 1 ? "y" : "ies"} in this window ${a.rows === 1 ? "appears" : "appear"} on both a personal account and a business account. That's one name on two accounts — measured, and it says nothing about deductibility.`,
        "A bank, a phone company or an insurer belongs on that list for good reason. LaVega doesn't filter those out: an exceptions list is how a measurement quietly turns into an opinion.",
      ];
    },
    row(a) {
      const euro = (c: number) => formatEuroIn("en", c / 100);
      return [
        `${a.label}: ${a.personalCount} payment${a.personalCount === 1 ? "" : "s"} totaling ${euro(a.personalCents)} from a personal account and ${a.businessCount} totaling ${euro(a.businessCents)} from a business account, between ${a.firstDate} and ${a.lastDate}. Do those personal payments belong to your business?`,
      ];
    },
  },

  answerForm: {
    explanation(a) {
      return [
        `${a.streams} stream${a.streams === 1 ? "" : "s"} with no answer yet. One question per stream, not per transfer.`,
        "Your answer is stored in your encrypted vault and goes nowhere else: it doesn't change a single amount above, LaVega just adds it alongside. Leave “not yet answered” for anything you don't know right now — “not sure” is a valid answer too, and after that you won't be asked again.",
      ];
    },
    savedNote(a) {
      if (a.saved === 0) return ["Nothing saved: no answer had been filled in yet."];
      return [
        `${a.saved} stream${a.saved === 1 ? "" : "s"} answered and saved to your vault. The measured amounts above haven't changed.`,
      ];
    },
    reviewButtonLabel: (count) => `Answer ${count} stream${count === 1 ? "" : "s"}`,
    toonMeerSummary: "How this was measured",
    ariaWhatWas: (label) => `What was ${label}`,
    dateRangeSeparator: "to",
    table: {
      stream: "Stream",
      measured: "Measured",
      whatWasThis: "What was this?",
      notYetAnswered: "not yet answered",
      salaris: "Salary",
      dividend: "Dividend",
      dontKnow: "Not sure",
      save: "Save answers",
      cancel: "Cancel",
    },
  },

  footer: [
    "This module measures what moved between your entities and your personal accounts, to the cent and by date. It doesn't calculate tax and draws no conclusion about what a transfer means — what LaVega doesn't calculate here is listed under “Not calculated” below.",
  ],

  labels: {
    kind: { salaris: "salary", dividend: "dividend", onbekend: "not sure" },
    source: { user: "You called", agent: "An agent called" },
    evidenceReason: {
      "twee-benen": "Both sides are in your vault.",
      "eigen-rekening-genoemd":
        "This row is included anyway because another account of yours appears on the other side of the boundary.",
      "eigen-naam-genoemd":
        "This row is included anyway because your own name appears on it, the way you entered it in your profile.",
    },
  },
};

/** Destination options for the travel country <select> in TravelBlock.tsx; shared verbatim by both locales. */
const TRAVEL_COUNTRIES = [
  { code: "US", nl: "Verenigde Staten", en: "United States" },
  { code: "GB", nl: "Verenigd Koninkrijk", en: "United Kingdom" },
  { code: "CH", nl: "Zwitserland", en: "Switzerland" },
  { code: "JP", nl: "Japan", en: "Japan" },
  { code: "TH", nl: "Thailand", en: "Thailand" },
  { code: "TR", nl: "Turkije", en: "Turkey" },
  { code: "SE", nl: "Zweden", en: "Sweden" },
  { code: "DK", nl: "Denemarken", en: "Denmark" },
  { code: "NO", nl: "Noorwegen", en: "Norway" },
  { code: "PL", nl: "Polen", en: "Poland" },
  { code: "CA", nl: "Canada", en: "Canada" },
  { code: "AU", nl: "Australië", en: "Australia" },
  { code: "AE", nl: "Verenigde Arabische Emiraten", en: "United Arab Emirates" },
  { code: "MA", nl: "Marokko", en: "Morocco" },
  { code: "ID", nl: "Indonesië", en: "Indonesia" },
  { code: "ES", nl: "Spanje", en: "Spain" },
  { code: "DE", nl: "Duitsland", en: "Germany" },
  { code: "FR", nl: "Frankrijk", en: "France" },
  { code: "IT", nl: "Italië", en: "Italy" },
] as const;

/**
 * Draft copy slice for TravelBlock.tsx.
 *
 * Placeholders are written as `{name}` and are plain text — this module holds
 * strings only, no interpolation logic. The caller does the substitution
 * (and, where the original wraps a fragment in `<strong>` or `<code>`, the
 * caller re-applies that styling; this module stores the words, not the
 * markup). Numbers, dates and currency amounts that get interpolated are NOT
 * pre-formatted here.
 *
 * A few short strings recur byte-for-byte across sections (an "unknown"
 * value, "n.v.t.", the "Let op:" caveat label, "Nog geen kaarten of
 * betaalrekeningen bekend." empty state) and are declared once in `common`
 * rather than duplicated per section.
 */
export type TravelCopy = {
  controls: {
    /** "Ik reis vanuit {country} naar" — the destination-picker eyebrow. */
    from: string;
    /** The unselected <option> in the destination <select>. */
    countryPlaceholder: string;
    /** "je betaalt daar in {currency}" */
    payingIn: string;
  };
  /** Shown before a destination is picked. */
  empty: string;
  badge: {
    /** The chip marking a product he does not hold. */
    notYours: string;
  };
  common: {
    /** A missing figure — never rendered as free/zero. */
    unknown: string;
    /** A leg that does not exist on a given route. */
    notApplicable: string;
    /** Prefix for a caveat/warning line, several sections reuse it. */
    caveatLabel: string;
    /** Shared empty state: no cards or payment accounts known yet. */
    noAccountsKnown: string;
    /** The word `productOf` (core) appends to a bank name to build a product's
     *  identity ("ING betaalpas") — that string stays Dutch, it's a business
     *  key, but `SpendOption.productKind` carries the same fact for display. */
    productKindWord: Record<"betaalpas" | "creditcard", string>;
    /** "Daar betaal je in euro's — omwisselen is niet nodig." One string for
     *  THREE kinds' "eur" variant (`PayHeadline`, `JourneyHeadline`,
     *  `ConvertStepNote`) — see the comment at `JourneyHeadline` in travel.ts.
     *  `WithdrawalHeadline`'s "eur" is about PINNEN, not betalen, and is its
     *  own separate sentence (`withdrawHeadline.eur`). */
    euroNoExchangeNeeded: string;
    /** `FeePeriod` ("maand"/"jaar") said as "per maand"/"per jaar". */
    periodWord: (period: "maand" | "jaar") => string;
    /** How many periods a one-off benefit's horizon spans, e.g. "1 maand",
     *  "3 maanden", "2 jaar" — no "over" prefix, callers add that themselves. */
    horizonWords: (n: number, costPeriod: "maand" | "jaar") => string;
    /** Wraps horizonWords. Was a hardcoded Dutch " over " in the view. */
    overHorizon: (words: string) => string;
  };
  /** Renders `SpendOption.why` / `Journey.why` — core stopped composing these
   *  sentences (and picking a language) once this block had to run in English
   *  too. `Journey`'s "direct" case wraps a `spendWhy` sentence: it IS the
   *  spend option's own reasoning, said as "pay directly: {that}". */
  spendWhy: {
    known: (fxFeePct: string, cashbackPct: string | null, pointsPerEuro: number | null) => string;
    unknown: string;
  };
  journeyWhy: {
    direct: (spend: string) => string;
    directUnknown: string;
    via: (free: boolean, convertPct: string, cashbackPct: string | null) => string;
    viaUnknownConvert: string;
    viaUnknownTransfer: string;
  };
  /** Renders `PayHeadline`'s "catalogue-card" variant — the one sentence the
   *  block leads with when the recommendation is a card he does not hold. */
  payHeadline: {
    /** " dat kost je niets op € 1.000" — note the exact original had no space
     *  before "€1.000" is a DIFFERENT sentence (`journeyHeadline.costFree`);
     *  this one keeps the space, byte-for-byte as `payHeadline` wrote it. */
    costFree: string;
    /** " {amount} op € 1.000" */
    costAmount: (amount: string) => string;
    /** ", {amount} minder dan met je eigen {ownProduct}" */
    versusOwn: (amount: string, ownProduct: string) => string;
    /** "Betaal met {product}:{cost}{versus}. Die heb je nog niet — die moet je
     *  eerst openen.{holdingCostTail}" */
    catalogueCard: (product: string, cost: string, versus: string, holdingCostTail: string) => string;
  };
  /** Renders `JourneyHeadline` — the answer's fallback when it is one of his
   *  own routes rather than a catalogue card. */
  journeyHeadline: {
    /** "Betaal direct met {provider}." */
    direct: (provider: string) => string;
    /** "Zet je reisbudget van {fundedFrom} naar {via}{via method suffix} en
     *  betaal daar." */
    via: (fundedFrom: string, viaProduct: string, method: string | null) => string;
    /** " Dat kost je niets op €1.000." — NO space before "€1.000", exactly as
     *  `journeyHeadline` originally wrote it; a different string from
     *  `payHeadline.costFree`, which does have the space. */
    costFree: string;
    /** " Dat kost {amount} op € 1.000." */
    costAmount: (amount: string) => string;
    noRoute: string;
  };
  /** Renders `VersusNote`, the runner-up clause `journeyHeadline` appends. */
  versusNote: {
    /** " Dat is {amount} goedkoper dan direct met {provider}." */
    cheaperDirect: (amount: string, provider: string) => string;
    /** " Dat is {amount} goedkoper dan via {via}." */
    cheaperVia: (amount: string, via: string) => string;
  };
  /** Renders `HoldingCostClause` — the card-cost tail `payHeadline` and
   *  `withdrawHeadline`'s "not-held" both append to their own sentence. Each
   *  entry keeps ITS leading space, same convention as the type it renders. */
  holdingCostClause: {
    unknownBundled: (product: string) => string;
    unknownNoSource: (product: string) => string;
    freeToHold: (product: string, amount: string) => string;
    periodBilledYearly: string;
    periodAtLeastOneMonth: string;
    periodMonths: (n: number) => string;
    netPositive: (product: string, price: string, period: string, amount: string) => string;
    netNegative: (product: string, price: string, period: string, amount: string) => string;
  };
  /** Renders `BareHoldingCostClause`, the simpler tail used when there is no
   *  benefit to net the price against. */
  bareHoldingCostClause: {
    unknownBundled: (product: string) => string;
    unknownNoSource: (product: string) => string;
    free: (product: string) => string;
    priced: (product: string, amount: string, period: string) => string;
  };
  /** Renders `NetBenefitDescription` (netBenefit.ts) — used only via
   *  `holdingCostClause`'s "recurring-benefit" branch on this screen. */
  netBenefitDescription: {
    unknownBundled: string;
    unknownNoSource: string;
    /** "{gross} voordeel. Maar {why} — dat is geen nul, en het gaat hiervan af." */
    grossOnly: (gross: string, why: string) => string;
    extraCosts: string;
    costsForProduct: string;
    /** "{gross} voordeel{per} min {cost} {kosten}{over}: {net} netto{per}.{floor}" */
    net: (gross: string, per: string, cost: string, kosten: string, over: string, net: string, floor: string) => string;
    /** "Geen aanbeveling: {gross} voordeel{per} tegen {cost} {kosten}{over} — dat levert niets op.{floor}" */
    noRecommendationZero: (gross: string, per: string, cost: string, kosten: string, over: string, floor: string) => string;
    /** "Geen aanbeveling: {gross} voordeel{per} tegen {cost} {kosten}{over}, dus {worse}{per} achteruit.{floor}" */
    noRecommendationNegative: (
      gross: string,
      per: string,
      cost: string,
      kosten: string,
      over: string,
      worse: string,
      floor: string,
    ) => string;
  };
  /** Renders `ConvertStepNote`. */
  convertStep: {
    noTerms: string;
    /** "Je betaalt het voordeligst vanaf {provider}." */
    payDirectly: (provider: string) => string;
    /** "Zet je reisbudget van {from} naar {to} via {method} — dat is gratis —
     *  en betaal daar." */
    moveFundsFree: (from: string, to: string, method: string) => string;
    /** "Zet je reisbudget van {from} naar {to} en betaal daar." */
    moveFundsPlain: (from: string, to: string) => string;
  };
  /** Renders `WithdrawalHeadline` — the "Pinnen:" line's own answer, and the
   *  nested `MissingCashNote`/`SmallWithdrawalPenalty`/`OwnWithdrawalComparison`
   *  it carries. A DIFFERENT "eur" sentence from `common.euroNoExchangeNeeded`:
   *  this screen is about withdrawing, not paying. */
  withdrawHeadline: {
    eur: string;
    noAccounts: string;
    /** "Van geen enkele kaart weten we wat geld pinnen in het buitenland kost
     *  — dat is een aparte prijs, meestal hoger dan betalen.{missing}" */
    noKnownPrice: (missing: string) => string;
    /** "{amount} voor {reference}{pctSuffix}" */
    priceLine: (amount: string, reference: string, pctSuffix: string) => string;
    /** "Het voordeligst pin je met {product}: {price}.{small}{missing}" */
    held: (product: string, price: string, small: string, missing: string) => string;
    /** "Het voordeligst pin je met {product}: {price}. Die heb je nog niet.{own}{holdingTail}{small}{missing}" */
    notHeld: (
      product: string,
      price: string,
      own: string,
      holdingTail: string,
      small: string,
      missing: string,
    ) => string;
    ownUnknown: string;
    /** " Van jouw kaarten is {ownProduct} de goedkoopste die we kunnen aantonen: {amount}{extra}." */
    ownKnown: (ownProduct: string, amount: string, extra: string) => string;
    /** ", dus {amount} duurder" */
    ownExtraCost: (amount: string) => string;
    /** " Er zit bij {provider} een vast bedrag per opname bij, dus {amount}
     *  pinnen kost je {pct} — neem in één keer meer op." */
    smallPenalty: (provider: string, amount: string, pct: string) => string;
    missingCashSingular: (names: string) => string;
    missingCashPlural: (names: string) => string;
  };
  /** Renders `WithdrawalFeeUnknownReason` — why one of his cards' withdrawal
   *  price is unknown, used both by `CashSection`'s per-row reason and (via
   *  `withdrawHeadline`) nowhere else; core keeps its OWN Dutch-only fallback
   *  for the codepath that never reaches this screen (see travel.ts). */
  withdrawalFeeUnknownReason: {
    silent: string;
    crossReference: string;
    conditional: string;
    mentionedNoRate: string;
    ambiguous: (provider: string, candidates: string) => string;
    notInCatalogue: string;
  };
  factCorrection: {
    /** "{label} aanpassen" — link that opens the inline editor. */
    adjust: string;
    /** aria-label on the input: "{label} van {provider}" */
    fieldAriaLabel: string;
    save: string;
    cancel: string;
    /** Label passed into FactCorrection for a direct route: "wisselkosten ({pct})" */
    fxFeeLabel: string;
    /** Label passed into FactCorrection for a routed transfer: "omwisselkosten ({pct})" */
    convertFeeLabel: string;
  };
  /** The `Kaartkosten` (card cost) block under a recommendation. */
  cardCost: {
    unknownHeading: string;
    /** Reason: the source's price is bundled with another product. */
    unknownReasonBundled: string;
    /** Reason: the source simply does not state this card's own price. */
    unknownReasonNoSource: string;
    unknownNotZero: string;
    /** Appended only when there is a benefit to caveat as gross. */
    unknownGrossHint: string;
    /** "Kaartkosten: {price} — de bron zegt dat {product} niets kost om aan te houden." */
    free: string;
    /** "Kaartkosten: {price}." — no benefit to compare the price against. */
    priceOnly: string;
    /** "Kaartkosten: {price} — gerekend {span}" (no total add-on). */
    calculated: string;
    /** ": {total}" — appended only when the total differs from the price. */
    calculatedTotalSuffix: string;
    netLabel: string;
    /** "{gross} voordeel min {cost} kaartkosten." */
    netBreakdown: string;
    noRecommendationLabel: string;
    /** "{gross} voordeel tegen {cost} kaartkosten" */
    noRecommendationBody: string;
    noGain: string;
    /** "je gaat er {amount} op achteruit." */
    worseOff: string;
    floorYear: string;
    floorMonth: string;
    /** Recurring cost: "per {period}" (period comes from product data). */
    spanRecurring: string;
    /** One-off cost, yearly product: "over {n} jaar" */
    spanOneOffYearOne: string;
    spanOneOffYearMany: string;
    spanOneOffMonthOne: string;
    /** "over {n} maanden" */
    spanOneOffMonthMany: string;
  };
  /** The three legs of a route (Overzetten/Wisselen/Betalen). */
  legs: {
    transfer: string;
    exchange: string;
    pay: string;
    directTransferDetail: string;
    directExchangeDetail: string;
    /** Fallback when a journey has no named funding account. */
    defaultFundingSource: string;
    /** " via {method}" */
    viaMethodSuffix: string;
    /** "bij {via}" */
    atProvider: string;
    /** "{amount} terug" — a negative leg cost (cashback). */
    cashback: string;
  };
  journeys: {
    /** "Direct betalen met {provider}" */
    directTitle: string;
    /** "Via {via}" */
    viaTitle: string;
    /** " (vanaf {source})" */
    fundedFromSuffix: string;
    /** "Niet elke stap van deze route is bekend ({why}) — daarom staat er geen bedrag. Onbekend is niet gratis." */
    unknownReason: string;
    /** All-EUR destination: no route needed. */
    noRouteEuro: string;
  };
  /** The `TermsNotice` panel and the headline it can replace. */
  terms: {
    /** Heading of the routes list in the fold-out; also referenced from `fillInHint`. */
    routesHeading: string;
    /** 'bij "{heading}" hieronder' */
    fillInHint: string;
    searchingButton: string;
    causeNoProducts: string;
    causeSearching: string;
    causeNoKey: string;
    causeNeverSearched: string;
    causeSearchedEmpty: string;
    noProductsBody: string;
    /** "Van {count} kaart kennen we de wisselkosten nog niet ({names}). ..." */
    unknownCardsOne: string;
    /** Same sentence, plural noun. */
    unknownCardsMany: string;
    /** "Nog niet elke route is te beprijzen: {list}. Die routes staan zonder bedrag." */
    unpriced: string;
    allPriced: string;
    /** "Cijfers laatst gecontroleerd op {date}." */
    lastChecked: string;
    /** "Zoek voorwaarden ({count})" — reused for the known-gaps and never-searched states. */
    searchWithCount: string;
    refresh: string;
    /** "Nog onbekend: {names}." */
    unknownList: string;
    noKeyBody: string;
    noKeyRecheck: string;
    /** "LaVega zoekt de voorwaarden op van {names}" */
    searchingBody: string;
    /** " — {found} van {total} gevonden" */
    searchingFoundSuffix: string;
    searchingTail: string;
    gaveUp: string;
    searchAgain: string;
    /** "Deze zijn nog nooit opgezocht: {names}. Eén klik en LaVega haalt de tarieven van de aanbieders zelf op." */
    neverSearchedBody: string;
    /** "We hebben gezocht, maar voor {names} kwam er geen bruikbaar tarief terug. ..." */
    searchedEmptyBody: string;
    searchAgainPlain: string;
  };
  cash: {
    title: string;
    /** "Pinnen is een aparte prijs, en bijna altijd hoger dan betalen. Bedragen gelden op één opname van {amount}." */
    intro: string;
    /** "Het goedkoopste opnametarief dat we kunnen aantonen is {product}: {cost} per {amount}" */
    advice: string;
    /** "{provider}: er zit een vast bedrag per opname bij, dus {amount} pinnen kost {pctSmall} in plaats van {pctNormal}. Neem in één keer meer op." */
    smallWithdrawalNote: string;
    /** "{provider} — {caveat}" (paired with `common.caveatLabel`). */
    caveat: string;
    /** "{provider}: {reason}" — a card whose fee we do not know at all. */
    feeUnknownReason: string;
  };
  offers: {
    title: string;
    intro1: string;
    /** "De volgorde is wat een kaart je op deze reis kost: ... over {months} maand. ..." */
    intro2One: string;
    /** Same sentence, plural noun. */
    intro2Many: string;
    /** "{pct} wisselkosten" */
    feeLine: string;
    /** "{pct} cashback" */
    cashbackSuffix: string;
    /** "{amount} op {reference}" — the standalone cost-on-spend figure next to each offer's name. */
    amountOnReference: string;
    /** "pinnen {amount} per {reference}" */
    withdrawalSuffix: string;
    withdrawalUnknown: string;
    /** Appended after a card's own cashback disclaimer text. */
    cashbackNoteSuffix: string;
    /** "Nog {count} kaarten in de catalogus met een onderbouwd tarief, allemaal duurder dan deze." */
    remainingCount: string;
  };
  /** How stale a looked-up figure is. */
  figureAge: {
    /** "opgezocht {date}" — fallback when the day count cannot be computed. */
    fallback: string;
    today: string;
    yesterday: string;
    /** "{n} dagen geleden opgezocht" */
    daysAgo: string;
    /** "{n} weken geleden gecontroleerd" */
    weeksAgo: string;
    /** "{n} maanden geleden gecontroleerd" */
    monthsAgo: string;
  };
  /** The always-visible summary above the fold. */
  winner: {
    pinnenLabel: string;
    foldLabelGap: string;
    foldLabelFull: string;
  };
  /** The reasoning inside the fold-out. */
  detail: {
    /** "{product} staat in de catalogus, niet bij je rekeningen" */
    switchSource: string;
    /** " · tarief {age}" */
    switchAgeSuffix: string;
    todayLabel: string;
    /** "met wat je nu hebt betaal je het voordeligst met {product} — {cost} op {reference}." */
    todayBody: string;
    notRecommendedLabel: string;
    /** "{product} heeft een lagere opslag ({offerPct} tegen {ownPct}), maar kost {fee} om aan te houden: {gross} lagere opslag tegen {cost} kaartkosten {span}, dus {comparison} {ownProduct}." */
    notRecommendedBody: string;
    evenAsExpensive: string;
    /** "{amount} duurder dan" */
    moreExpensiveThan: string;
    /** "Alle bedragen gelden op {reference} die je daar uitgeeft. LaVega verplaatst zelf niets — dit is een stap die jij zet." */
    referenceNote: string;
    /** "{count} rekening zonder bank — die kunnen we niet opzoeken. Vul de bank in bij Rekeningen, of zet het type op Spaarrekening als het spaargeld is." */
    unidentifiedOne: string;
    /** Same sentence, plural noun. */
    unidentifiedMany: string;
  };
  /** The three Bewaren / Wisselen / Betalen panels. */
  steps: {
    store: string;
    exchange: string;
    pay: string;
    /** "Scheelt {amount} per jaar." */
    storeSavings: string;
    exchangeNoCard: string;
    /** "{n} punt/€" */
    pointsPerEuro: string;
    userSetFee: string;
  };
  /** Destination options for the country <select>; identical across locales. */
  countries: typeof TRAVEL_COUNTRIES;
  /** De opnameprijs in woorden. Stond als `describeWithdrawalFee` in core en
   *  was daarmee altijd Nederlands op een scherm dat ook Engels kan zijn — de
   *  kop van die functie noemde zichzelf al "de ene nog-Nederlandse string die
   *  WEL het scherm haalt". Core levert nu alleen nog de componenten. */
  withdrawalFee: (components: readonly WithdrawalComponent[]) => string;
  /** Het voorbehoud bij een tarief. `quoted` is de tekst van de aanbieder en
   *  gaat er ongewijzigd doorheen; de andere twee zijn onze eigen zin. */
  caveat: (c: TravelCaveat) => string;
  /** Waar het geld het best staat. */
  storeNote: (n: StoreNote) => string;
};

const travelCopy_nl: TravelCopy = {
  controls: {
    from: "Ik reis vanuit {country} naar",
    countryPlaceholder: "— kies een land —",
    payingIn: "je betaalt daar in {currency}",
  },
  empty: "Kies een land en LaVega zegt waar je je geld het best bewaart, wisselt en uitgeeft.",
  badge: {
    notYours: "nog niet van jou",
  },
  common: {
    unknown: "onbekend",
    notApplicable: "n.v.t.",
    caveatLabel: "Let op:",
    noAccountsKnown: "Nog geen kaarten of betaalrekeningen bekend.",
    productKindWord: { betaalpas: "betaalpas", creditcard: "creditcard" },
    euroNoExchangeNeeded: "Daar betaal je in euro's — omwisselen is niet nodig.",
    periodWord: (period) => (period === "maand" ? "per maand" : "per jaar"),
    overHorizon: (words) => ` over ${words}`,
    horizonWords: (n, costPeriod) =>
      costPeriod === "jaar" ? `${n} jaar` : `${n} ${n === 1 ? "maand" : "maanden"}`,
  },
  spendWhy: {
    known: (fxFeePct, cashbackPct, pointsPerEuro) =>
      `${fxFeePct} wisselkosten${cashbackPct ? ` − ${cashbackPct} cashback` : ""}${pointsPerEuro ? ` + ${pointsPerEuro} punt${pointsPerEuro === 1 ? "" : "en"} per euro` : ""}`,
    unknown: "voorwaarden nog onbekend",
  },
  journeyWhy: {
    direct: (spend) => `direct betalen: ${spend}`,
    directUnknown: "voorwaarden nog onbekend",
    via: (free, convertPct, cashbackPct) =>
      `overzetten${free ? " via iDEAL (gratis)" : ""} en daar wisselen: ${convertPct} wisselkosten${cashbackPct ? ` − ${cashbackPct} cashback` : ""}`,
    viaUnknownConvert: "wisselkosten nog onbekend",
    viaUnknownTransfer: "overboekkosten nog onbekend",
  },
  payHeadline: {
    costFree: " dat kost je niets op € 1.000",
    costAmount: (amount) => ` ${amount} op € 1.000`,
    versusOwn: (amount, ownProduct) => `, ${amount} minder dan met je eigen ${ownProduct}`,
    catalogueCard: (product, cost, versus, holdingCostTail) =>
      `Betaal met ${product}:${cost}${versus}. Die heb je nog niet — die moet je eerst openen.${holdingCostTail}`,
  },
  journeyHeadline: {
    direct: (provider) => `Betaal direct met ${provider}.`,
    via: (fundedFrom, viaProduct, method) =>
      `Zet je reisbudget van ${fundedFrom} naar ${viaProduct}${method ? ` via ${method} (gratis)` : ""} en betaal daar.`,
    costFree: " Dat kost je niets op €1.000.",
    costAmount: (amount) => ` Dat kost ${amount} op € 1.000.`,
    noRoute: "Nog geen route met bekende voorwaarden — ververs eerst de voorwaarden.",
  },
  versusNote: {
    cheaperDirect: (amount, provider) => ` Dat is ${amount} goedkoper dan direct met ${provider}.`,
    cheaperVia: (amount, via) => ` Dat is ${amount} goedkoper dan via ${via}.`,
  },
  holdingCostClause: {
    unknownBundled: (product) =>
      ` Wat ${product} los kost weten we niet: de prijs die onze bron noemt geldt bovenop een ander product — dat is geen nul, en het gaat van dat bedrag af.`,
    unknownNoSource: (product) =>
      ` Wat ${product} zelf kost, staat niet in onze bronnen — dat is geen nul, en het gaat van dat bedrag af.`,
    freeToHold: (product, amount) => ` ${product} kost zelf niets om aan te houden, dus je houdt ${amount} over.`,
    periodBilledYearly: "en wordt per jaar afgerekend",
    periodAtLeastOneMonth: "en dat betaal je minstens één maand",
    periodMonths: (n) => `en dat betaal je ${n} maanden`,
    netPositive: (product, price, period, amount) =>
      ` ${product} kost zelf ${price} ${period}, dus je houdt ${amount} over.`,
    netNegative: (product, price, period, amount) =>
      ` ${product} kost zelf ${price} ${period}, dus je gaat er ${amount} op achteruit.`,
  },
  bareHoldingCostClause: {
    unknownBundled: (product) =>
      ` Wat ${product} los kost weten we niet: de prijs die onze bron noemt geldt bovenop een ander product — dat is geen nul.`,
    unknownNoSource: (product) => ` Wat ${product} zelf kost, staat niet in onze bronnen — dat is geen nul.`,
    free: (product) => ` ${product} kost zelf niets om aan te houden.`,
    priced: (product, amount, period) =>
      ` ${product} kost zelf ${amount} ${period}, en dat loopt door zolang je hem houdt.`,
  },
  netBenefitDescription: {
    unknownBundled: "de prijs die de bron noemt geldt bovenop een ander product, dus wat dit los kost weten we niet",
    unknownNoSource: "wat dit product kost, staat niet in onze bronnen",
    grossOnly: (gross, why) => `${gross} voordeel. Maar ${why} — dat is geen nul, en het gaat hiervan af.`,
    extraCosts: "extra kosten",
    costsForProduct: "kosten voor het product",
    net: (gross, per, cost, kosten, over, net, floor) =>
      `${gross} voordeel${per} min ${cost} ${kosten}${over}: ${net} netto${per}.${floor}`,
    noRecommendationZero: (gross, per, cost, kosten, over, floor) =>
      `Geen aanbeveling: ${gross} voordeel${per} tegen ${cost} ${kosten}${over} — dat levert niets op.${floor}`,
    noRecommendationNegative: (gross, per, cost, kosten, over, worse, floor) =>
      `Geen aanbeveling: ${gross} voordeel${per} tegen ${cost} ${kosten}${over}, dus ${worse}${per} achteruit.${floor}`,
  },
  convertStep: {
    noTerms: "Nog geen kaart met bekende voorwaarden — ververs eerst de voorwaarden.",
    payDirectly: (provider) => `Je betaalt het voordeligst vanaf ${provider}.`,
    moveFundsFree: (from, to, method) =>
      `Zet je reisbudget van ${from} naar ${to} via ${method} — dat is gratis — en betaal daar.`,
    moveFundsPlain: (from, to) => `Zet je reisbudget van ${from} naar ${to} en betaal daar.`,
  },
  withdrawHeadline: {
    eur: "Daar pin je in euro's, dus de opslagen voor vreemde valuta gelden niet. Wat je eigen bank in euroland voor een opname rekent, staat niet in onze bronnen.",
    noAccounts: "Nog geen kaart of betaalrekening om mee te pinnen.",
    noKnownPrice: (missing) =>
      `Van geen enkele kaart weten we wat geld pinnen in het buitenland kost — dat is een aparte prijs, meestal hoger dan betalen.${missing}`,
    priceLine: (amount, reference, pctSuffix) => `${amount} voor ${reference}${pctSuffix}`,
    held: (product, price, small, missing) => `Het voordeligst pin je met ${product}: ${price}.${small}${missing}`,
    notHeld: (product, price, own, holdingTail, small, missing) =>
      `Het voordeligst pin je met ${product}: ${price}. Die heb je nog niet.${own}${holdingTail}${small}${missing}`,
    ownUnknown: " Van je eigen kaarten kennen we geen opnametarief.",
    ownKnown: (ownProduct, amount, extra) =>
      ` Van jouw kaarten is ${ownProduct} de goedkoopste die we kunnen aantonen: ${amount}${extra}.`,
    ownExtraCost: (amount) => `, dus ${amount} duurder`,
    smallPenalty: (provider, amount, pct) =>
      ` Er zit bij ${provider} een vast bedrag per opname bij, dus ${amount} pinnen kost je ${pct} — neem in één keer meer op.`,
    missingCashSingular: (names) => ` Van ${names} zegt onze bron niets over opnemen — dat is geen nul, dat is een gat.`,
    missingCashPlural: (names) => ` Van ${names} zeggen onze bronnen niets over opnemen — dat is geen nul, dat is een gat.`,
  },
  withdrawalFeeUnknownReason: {
    silent: "De bron zegt niets over geld opnemen.",
    crossReference: "De bron verwijst voor opnemen naar een aparte regel of artikel en noemt het tarief daar niet.",
    conditional:
      "Het opnametarief hangt aan een vrijstelling, staffel of voorwaarde die de bron niet in één bedrag uitdrukt.",
    mentionedNoRate: "De bron noemt opnemen wel, maar zonder tarief.",
    ambiguous: (provider, candidates) =>
      `De catalogus kent meer dan één ${provider} (${candidates}) en die rekenen niet hetzelfde. Zeg welke je hebt, of vul de wisselkosten in — dan weten we het.`,
    notInCatalogue: "Dit product staat nog niet in de catalogus, dus we weten niet wat opnemen kost.",
  },
  factCorrection: {
    adjust: "{label} aanpassen",
    fieldAriaLabel: "{label} van {provider}",
    save: "Bewaar",
    cancel: "Annuleer",
    fxFeeLabel: "wisselkosten ({pct})",
    convertFeeLabel: "omwisselkosten ({pct})",
  },
  cardCost: {
    unknownHeading: "Kaartkosten: onbekend",
    unknownReasonBundled:
      "de prijs die onze bron noemt geldt bovenop een ander product, dus wat {product} los kost weten we niet",
    unknownReasonNoSource: "wat {product} zelf kost, staat niet in onze bronnen",
    unknownNotZero: "Dat is geen nul.",
    unknownGrossHint:
      " Het bedrag hierboven is dus bruto: wat deze kaart kost, gaat er nog af.",
    free: "Kaartkosten: {price} — de bron zegt dat {product} niets kost om aan te houden.",
    priceOnly: "Kaartkosten: {price}.",
    calculated: "Kaartkosten: {price} — gerekend {span}",
    calculatedTotalSuffix: ": {total}",
    netLabel: "Netto:",
    netBreakdown: "{gross} voordeel min {cost} kaartkosten.",
    noRecommendationLabel: "Geen aanbeveling:",
    noRecommendationBody: "{gross} voordeel tegen {cost} kaartkosten",
    noGain: "— dat levert niets op.",
    worseOff: "— je gaat er {amount} op achteruit.",
    floorYear:
      " Dit product wordt per jaar afgerekend, dus een kortere reis maakt het niet goedkoper.",
    floorMonth: " Minder dan één maand kun je niet afnemen, dus daar rekenen we mee.",
    spanRecurring: "per {period}",
    spanOneOffYearOne: "over 1 jaar",
    spanOneOffYearMany: "over {n} jaar",
    spanOneOffMonthOne: "over 1 maand",
    spanOneOffMonthMany: "over {n} maanden",
  },
  legs: {
    transfer: "Overzetten",
    exchange: "Wisselen",
    pay: "Betalen",
    directTransferDetail: "niet nodig — je betaalt direct",
    directExchangeDetail: "de kaart wisselt bij betaling",
    defaultFundingSource: "je betaalrekening",
    viaMethodSuffix: " via {method}",
    atProvider: "bij {via}",
    cashback: "{amount} terug",
  },
  journeys: {
    directTitle: "Direct betalen met {provider}",
    viaTitle: "Via {via}",
    fundedFromSuffix: " (vanaf {source})",
    unknownReason:
      "Niet elke stap van deze route is bekend ({why}) — daarom staat er geen bedrag. Onbekend is niet gratis.",
    noRouteEuro: "Geen route nodig — daar reken je gewoon in euro's af.",
  },
  terms: {
    routesHeading: "Alle routes",
    fillInHint: "bij “{heading}” hieronder",
    searchingButton: "Bezig met zoeken…",
    causeNoProducts:
      "Nog geen betaalpas of creditcard met een bank erbij — er valt nog niets te vergelijken.",
    causeSearching: "LaVega zoekt de voorwaarden nu op — dat duurt een minuut of twee.",
    causeNoKey: "LaVega kan de voorwaarden hier niet opzoeken: deze server heeft geen AI-sleutel.",
    causeNeverSearched: "De voorwaarden van je kaarten zijn nog niet opgezocht.",
    causeSearchedEmpty: "Opgezocht, maar er kwam geen bruikbaar tarief terug.",
    noProductsBody:
      "Vul bij Rekeningen de bank in bij je betaalrekeningen en creditcards. Zonder bank weten we niet welk product het is, en dus ook niet welke voorwaarden erbij horen.",
    unknownCardsOne:
      "Van {count} kaart kennen we de wisselkosten nog niet ({names}). Die staan onderaan zonder bedrag — onbekend is niet gratis, dus ze doen niet mee in de rangschikking.",
    unknownCardsMany:
      "Van {count} kaarten kennen we de wisselkosten nog niet ({names}). Die staan onderaan zonder bedrag — onbekend is niet gratis, dus ze doen niet mee in de rangschikking.",
    unpriced: "Nog niet elke route is te beprijzen: {list}. Die routes staan zonder bedrag.",
    allPriced: "Alle routes zijn beprijsd.",
    lastChecked: "Cijfers laatst gecontroleerd op {date}.",
    searchWithCount: "Zoek voorwaarden ({count})",
    refresh: "Ververs voorwaarden",
    unknownList: "Nog onbekend: {names}.",
    noKeyBody:
      "Deze server heeft geen AI-sleutel (MISTRAL_API_KEY) ingesteld, dus opzoeken kan hier niet — verversen zou niets doen. Zet die sleutel in de serveromgeving, of vul de percentages zelf in {hint}. Wat jij invult wordt nooit door een agent overschreven.",
    noKeyRecheck: "Sleutel net ingesteld? Opnieuw controleren",
    searchingBody: "LaVega zoekt de voorwaarden op van {names}",
    searchingFoundSuffix: " — {found} van {total} gevonden",
    searchingTail: ". Dat duurt een minuut of twee; dit scherm werkt zichzelf bij.",
    gaveUp:
      "Er kwam niets meer binnen. Probeer het opnieuw, of vul de percentages zelf in {hint} — wat jij invult wordt nooit overschreven.",
    searchAgain: "Nu opnieuw kijken",
    neverSearchedBody:
      "Deze zijn nog nooit opgezocht: {names}. Eén klik en LaVega haalt de tarieven van de aanbieders zelf op.",
    searchedEmptyBody:
      "We hebben gezocht, maar voor {names} kwam er geen bruikbaar tarief terug. Vul de wisselkosten zelf in {hint} — jouw invoer blijft staan en wordt nooit overschreven. Zoeken kan opnieuw; de server haalt sommige tarieven op de achtergrond op.",
    searchAgainPlain: "Opnieuw zoeken",
  },
  cash: {
    title: "Geld pinnen",
    intro:
      "Pinnen is een aparte prijs, en bijna altijd hoger dan betalen. Bedragen gelden op één opname van {amount}.",
    advice: "Het goedkoopste opnametarief dat we kunnen aantonen is {product}: {cost} per {amount}",
    smallWithdrawalNote:
      "{provider}: er zit een vast bedrag per opname bij, dus {amount} pinnen kost {pctSmall} in plaats van {pctNormal}. Neem in één keer meer op.",
    caveat: "{provider} — {caveat}",
    feeUnknownReason: "{provider}: {reason}",
  },
  offers: {
    title: "Wat je zou kunnen openen",
    intro1:
      "Kaarten uit de catalogus, geen kaarten van jou — voor zover wij kunnen zien heb je ze niet, en betalen doe je vandaag met wat er onder “Betalen” staat. Eén kaart per aanbieder: de voordeligste waarvan we de bron en de datum hebben.",
    intro2One:
      "De volgorde is wat een kaart je op deze reis kost: de opslag op {reference} plus wat de kaart zelf kost over {months} maand. Staat er “kaartkosten onbekend”, dan zit alleen de opslag in dat bedrag — dat is een ondergrens, geen bewijs dat de kaart gratis is.",
    intro2Many:
      "De volgorde is wat een kaart je op deze reis kost: de opslag op {reference} plus wat de kaart zelf kost over {months} maanden. Staat er “kaartkosten onbekend”, dan zit alleen de opslag in dat bedrag — dat is een ondergrens, geen bewijs dat de kaart gratis is.",
    feeLine: "{pct} wisselkosten",
    cashbackSuffix: "{pct} cashback",
    amountOnReference: "{amount} op {reference}",
    withdrawalSuffix: "pinnen {amount} per {reference}",
    withdrawalUnknown: "pinnen onbekend",
    cashbackNoteSuffix: " Daarom rekenen we die niet mee.",
    remainingCount:
      "Nog {count} kaarten in de catalogus met een onderbouwd tarief, allemaal duurder dan deze.",
  },
  figureAge: {
    fallback: "opgezocht {date}",
    today: "vandaag opgezocht",
    yesterday: "gisteren opgezocht",
    daysAgo: "{n} dagen geleden opgezocht",
    weeksAgo: "{n} weken geleden gecontroleerd",
    monthsAgo: "{n} maanden geleden gecontroleerd",
  },
  winner: {
    pinnenLabel: "Pinnen:",
    foldLabelGap: "Wat er ontbreekt, en wat je eraan kunt doen",
    foldLabelFull: "Alle routes, de bronnen en de voorwaarden",
  },
  detail: {
    switchSource: "{product} staat in de catalogus, niet bij je rekeningen",
    switchAgeSuffix: " · tarief {age}",
    todayLabel: "Vandaag:",
    todayBody: "met wat je nu hebt betaal je het voordeligst met {product} — {cost} op {reference}.",
    notRecommendedLabel: "Niet aangeraden:",
    notRecommendedBody:
      "{product} heeft een lagere opslag ({offerPct} tegen {ownPct}), maar kost {fee} om aan te houden: {gross} lagere opslag tegen {cost} kaartkosten {span}, dus {comparison} {ownProduct}.",
    evenAsExpensive: "even duur als",
    moreExpensiveThan: "{amount} duurder dan",
    referenceNote:
      "Alle bedragen gelden op {reference} die je daar uitgeeft. LaVega verplaatst zelf niets — dit is een stap die jij zet.",
    unidentifiedOne:
      "{count} rekening zonder bank — die kunnen we niet opzoeken. Vul de bank in bij Rekeningen, of zet het type op Spaarrekening als het spaargeld is.",
    unidentifiedMany:
      "{count} rekeningen zonder bank — die kunnen we niet opzoeken. Vul de bank in bij Rekeningen, of zet het type op Spaarrekening als het spaargeld is.",
  },
  steps: {
    store: "Bewaren",
    exchange: "Wisselen",
    pay: "Betalen",
    storeSavings: "Scheelt {amount} per jaar.",
    exchangeNoCard: "Nog geen kaart met bekende voorwaarden — zie de reden boven aan dit blok.",
    pointsPerEuro: "{n} punt/€",
    userSetFee: "door jou ingesteld",
  },
  countries: TRAVEL_COUNTRIES,
  caveat: (c) => {
    switch (c.kind) {
      case "capped":
        return `Dit tarief geldt maar tot een grens: ${c.cap}.`;
      case "limited":
        return "Dit tarief geldt maar binnen een limiet of pakket — lees de voorwaarden voordat je overstapt.";
      case "quoted":
        return c.text;
    }
  },
  storeNote: (n) =>
    n.kind === "already-best"
      ? "Je spaargeld staat al op de beste plek die we kennen."
      : `Je laat rente liggen op ${n.account}${n.best ? ` — ${n.best.bank} geeft ${formatPercentIn("nl", n.best.ratePct / 100)}` : ""}.`,
  withdrawalFee: (components) =>
    components
      .map((c) =>
        c.kind === "fixed"
          ? `${formatEuroIn("nl", c.eur)} per opname`
          : c.minEur === null
            ? `${formatPercentIn("nl", c.pct / 100)} over het opgenomen bedrag`
            : `${formatPercentIn("nl", c.pct / 100)} over het opgenomen bedrag, minimaal ${formatEuroIn("nl", c.minEur)}`,
      )
      .join(" + "),
};

const travelCopy_en: TravelCopy = {
  controls: {
    from: "Travelling from {country} to",
    countryPlaceholder: "— choose a country —",
    payingIn: "you'll pay there in {currency}",
  },
  empty: "Pick a country and LaVega will say where to keep, exchange and spend your money.",
  badge: {
    notYours: "not yours yet",
  },
  common: {
    unknown: "unknown",
    notApplicable: "n/a",
    caveatLabel: "Note:",
    noAccountsKnown: "No cards or payment accounts known yet.",
    productKindWord: { betaalpas: "debit card", creditcard: "credit card" },
    euroNoExchangeNeeded: "You pay in euros there — no exchange needed.",
    periodWord: (period) => (period === "maand" ? "per month" : "per year"),
    overHorizon: (words) => ` over ${words}`,
    horizonWords: (n, costPeriod) =>
      costPeriod === "jaar" ? `${n} ${n === 1 ? "year" : "years"}` : `${n} ${n === 1 ? "month" : "months"}`,
  },
  spendWhy: {
    known: (fxFeePct, cashbackPct, pointsPerEuro) =>
      `${fxFeePct} exchange fee${cashbackPct ? ` − ${cashbackPct} cashback` : ""}${pointsPerEuro ? ` + ${pointsPerEuro} point${pointsPerEuro === 1 ? "" : "s"} per euro` : ""}`,
    unknown: "terms still unknown",
  },
  journeyWhy: {
    direct: (spend) => `pay directly: ${spend}`,
    directUnknown: "terms still unknown",
    via: (free, convertPct, cashbackPct) =>
      `transfer${free ? " via iDEAL (free)" : ""} and exchange there: ${convertPct} exchange fee${cashbackPct ? ` − ${cashbackPct} cashback` : ""}`,
    viaUnknownConvert: "exchange fee still unknown",
    viaUnknownTransfer: "transfer fee still unknown",
  },
  payHeadline: {
    costFree: " that costs you nothing on €1,000",
    costAmount: (amount) => ` ${amount} on €1,000`,
    versusOwn: (amount, ownProduct) => `, ${amount} less than with your own ${ownProduct}`,
    catalogueCard: (product, cost, versus, holdingCostTail) =>
      `Pay with ${product}:${cost}${versus}. You don't have that yet — you'd need to open it first.${holdingCostTail}`,
  },
  journeyHeadline: {
    direct: (provider) => `Pay directly with ${provider}.`,
    via: (fundedFrom, viaProduct, method) =>
      `Move your travel budget from ${fundedFrom} to ${viaProduct}${method ? ` via ${method} (free)` : ""} and pay there.`,
    costFree: " That costs you nothing on €1,000.",
    costAmount: (amount) => ` That costs ${amount} on €1,000.`,
    noRoute: "No route with known terms yet — refresh the terms first.",
  },
  versusNote: {
    cheaperDirect: (amount, provider) => ` That's ${amount} cheaper than paying directly with ${provider}.`,
    cheaperVia: (amount, via) => ` That's ${amount} cheaper than via ${via}.`,
  },
  holdingCostClause: {
    unknownBundled: (product) =>
      ` We don't know what ${product} costs on its own: the price our source quotes applies on top of another product — that isn't zero, and it comes off this amount.`,
    unknownNoSource: (product) =>
      ` What ${product} itself costs isn't in our sources — that isn't zero, and it comes off this amount.`,
    freeToHold: (product, amount) => ` ${product} itself costs nothing to hold, so you keep ${amount}.`,
    periodBilledYearly: "and it's billed annually",
    periodAtLeastOneMonth: "and you pay that for at least one month",
    periodMonths: (n) => `and you pay that for ${n} months`,
    netPositive: (product, price, period, amount) =>
      ` ${product} itself costs ${price} ${period}, so you keep ${amount}.`,
    netNegative: (product, price, period, amount) =>
      ` ${product} itself costs ${price} ${period}, so you end up ${amount} worse off.`,
  },
  bareHoldingCostClause: {
    unknownBundled: (product) =>
      ` We don't know what ${product} costs on its own: the price our source quotes applies on top of another product — that isn't zero.`,
    unknownNoSource: (product) => ` What ${product} itself costs isn't in our sources — that isn't zero.`,
    free: (product) => ` ${product} itself costs nothing to hold.`,
    priced: (product, amount, period) =>
      ` ${product} itself costs ${amount} ${period}, and that continues for as long as you hold it.`,
  },
  netBenefitDescription: {
    unknownBundled: "the price our source quotes applies on top of another product, so we don't know what this costs on its own",
    unknownNoSource: "what this product costs isn't in our sources",
    grossOnly: (gross, why) => `${gross} benefit. But ${why} — that isn't zero, and it comes off this.`,
    extraCosts: "extra cost",
    costsForProduct: "cost of the product",
    net: (gross, per, cost, kosten, over, net, floor) =>
      `${gross} benefit${per} minus ${cost} ${kosten}${over}: ${net} net${per}.${floor}`,
    noRecommendationZero: (gross, per, cost, kosten, over, floor) =>
      `No recommendation: ${gross} benefit${per} against ${cost} ${kosten}${over} — that comes to nothing.${floor}`,
    noRecommendationNegative: (gross, per, cost, kosten, over, worse, floor) =>
      `No recommendation: ${gross} benefit${per} against ${cost} ${kosten}${over}, which leaves you ${worse}${per} worse off.${floor}`,
  },
  convertStep: {
    noTerms: "No card with known terms yet — refresh the terms first.",
    payDirectly: (provider) => `You pay cheapest from ${provider}.`,
    moveFundsFree: (from, to, method) =>
      `Move your travel budget from ${from} to ${to} via ${method} — that's free — and pay there.`,
    moveFundsPlain: (from, to) => `Move your travel budget from ${from} to ${to} and pay there.`,
  },
  withdrawHeadline: {
    eur: "You withdraw in euros there, so foreign-currency surcharges don't apply. What your own bank charges for a withdrawal in the eurozone isn't in our sources.",
    noAccounts: "No card or payment account to withdraw with yet.",
    noKnownPrice: (missing) =>
      `We don't know what withdrawing cash abroad costs for any of your cards — that's a separate price, almost always higher than paying.${missing}`,
    priceLine: (amount, reference, pctSuffix) => `${amount} for ${reference}${pctSuffix}`,
    held: (product, price, small, missing) =>
      `The cheapest way to withdraw is with ${product}: ${price}.${small}${missing}`,
    notHeld: (product, price, own, holdingTail, small, missing) =>
      `The cheapest way to withdraw is with ${product}: ${price}. You don't have that yet.${own}${holdingTail}${small}${missing}`,
    ownUnknown: " We don't know a withdrawal rate for any of your own cards.",
    ownKnown: (ownProduct, amount, extra) =>
      ` Of your own cards, ${ownProduct} is the cheapest we can prove: ${amount}${extra}.`,
    ownExtraCost: (amount) => `, so ${amount} more`,
    smallPenalty: (provider, amount, pct) =>
      ` ${provider} charges a flat fee per withdrawal, so taking out ${amount} costs you ${pct} — withdraw more at once.`,
    missingCashSingular: (names) => ` Our source says nothing about withdrawing for ${names} — that isn't zero, that's a gap.`,
    missingCashPlural: (names) => ` Our sources say nothing about withdrawing for ${names} — that isn't zero, that's a gap.`,
  },
  withdrawalFeeUnknownReason: {
    silent: "Our source says nothing about withdrawing cash.",
    crossReference: "Our source points to a separate rule or article for withdrawals and doesn't state the rate there.",
    conditional:
      "The withdrawal rate depends on an allowance, tier or condition our source doesn't express as one figure.",
    mentionedNoRate: "Our source mentions withdrawing, but without a rate.",
    ambiguous: (provider, candidates) =>
      `The catalogue has more than one ${provider} (${candidates}), and they don't charge the same. Tell us which one you have, or enter the exchange fee yourself — then we'll know.`,
    notInCatalogue: "This product isn't in the catalogue yet, so we don't know what withdrawing costs.",
  },
  factCorrection: {
    adjust: "Edit {label}",
    fieldAriaLabel: "{label} for {provider}",
    save: "Save",
    cancel: "Cancel",
    fxFeeLabel: "exchange fee ({pct})",
    convertFeeLabel: "conversion fee ({pct})",
  },
  cardCost: {
    unknownHeading: "Card cost: unknown",
    unknownReasonBundled:
      "the price our source quotes applies on top of another product, so we don't know what {product} costs on its own",
    unknownReasonNoSource: "what {product} itself costs isn't in our sources",
    unknownNotZero: "That isn't zero.",
    unknownGrossHint: " So the amount above is gross: this card's cost still comes off it.",
    free: "Card cost: {price} — the source says {product} costs nothing to hold.",
    priceOnly: "Card cost: {price}.",
    calculated: "Card cost: {price} — calculated {span}",
    calculatedTotalSuffix: ": {total}",
    netLabel: "Net:",
    netBreakdown: "{gross} benefit minus {cost} card cost.",
    noRecommendationLabel: "No recommendation:",
    noRecommendationBody: "{gross} benefit against {cost} card cost",
    noGain: "— that comes to nothing.",
    worseOff: "— you'd end up {amount} worse off.",
    floorYear: " This product is billed annually, so a shorter trip doesn't make it cheaper.",
    floorMonth: " You can't take out less than one month of this, so that's what we count.",
    spanRecurring: "per {period}",
    spanOneOffYearOne: "over 1 year",
    spanOneOffYearMany: "over {n} years",
    spanOneOffMonthOne: "over 1 month",
    spanOneOffMonthMany: "over {n} months",
  },
  legs: {
    transfer: "Transfer",
    exchange: "Exchange",
    pay: "Pay",
    directTransferDetail: "not needed — you pay directly",
    directExchangeDetail: "the card converts at the point of payment",
    defaultFundingSource: "your payment account",
    viaMethodSuffix: " via {method}",
    atProvider: "at {via}",
    cashback: "{amount} back",
  },
  journeys: {
    directTitle: "Pay directly with {provider}",
    viaTitle: "Via {via}",
    fundedFromSuffix: " (from {source})",
    unknownReason:
      "Not every step of this route is known yet ({why}) — that's why there's no amount. Unknown isn't free.",
    noRouteEuro: "No route needed — you simply pay in euros there.",
  },
  terms: {
    routesHeading: "All routes",
    fillInHint: "under “{heading}” below",
    searchingButton: "Searching…",
    causeNoProducts: "No card or payment account with a bank set yet — there's nothing to compare.",
    causeSearching: "LaVega is looking up the terms now — that takes a minute or two.",
    causeNoKey: "LaVega can't look up terms here: this server has no AI key.",
    causeNeverSearched: "Your cards' terms haven't been looked up yet.",
    causeSearchedEmpty: "Looked it up, but no usable rate came back.",
    noProductsBody:
      "Add the bank under Accounts for your payment accounts and credit cards. Without a bank we don't know which product it is, and so not which terms apply either.",
    unknownCardsOne:
      "We don't know the exchange fee yet for {count} card ({names}). It's listed at the bottom with no amount — unknown isn't free, so it isn't ranked.",
    unknownCardsMany:
      "We don't know the exchange fee yet for {count} cards ({names}). They're listed at the bottom with no amount — unknown isn't free, so they aren't ranked.",
    unpriced: "Not every route can be priced yet: {list}. Those routes show no amount.",
    allPriced: "Every route is priced.",
    lastChecked: "Figures last checked on {date}.",
    searchWithCount: "Look up terms ({count})",
    refresh: "Refresh terms",
    unknownList: "Still unknown: {names}.",
    noKeyBody:
      "This server has no AI key (MISTRAL_API_KEY) set, so a lookup can't run here — refreshing would do nothing. Set that key in the server environment, or enter the percentages yourself {hint}. Whatever you enter is never overwritten by an agent.",
    noKeyRecheck: "Just set the key? Check again",
    searchingBody: "LaVega is looking up terms for {names}",
    searchingFoundSuffix: " — {found} of {total} found",
    searchingTail: ". That takes a minute or two; this screen updates itself.",
    gaveUp:
      "Nothing more came back. Try again, or enter the percentages yourself {hint} — whatever you enter is never overwritten.",
    searchAgain: "Check again now",
    neverSearchedBody:
      "These have never been looked up: {names}. One click and LaVega fetches the providers' own rates.",
    searchedEmptyBody:
      "We searched, but no usable rate came back for {names}. Enter the exchange fees yourself {hint} — your entry stays and is never overwritten. You can search again; the server fetches some rates in the background.",
    searchAgainPlain: "Search again",
  },
  cash: {
    title: "Withdrawing cash",
    intro:
      "Withdrawing is priced separately, and almost always costs more than paying. Amounts are for one withdrawal of {amount}.",
    advice: "The cheapest withdrawal rate we can prove is {product}: {cost} per {amount}",
    smallWithdrawalNote:
      "{provider}: there's a flat fee per withdrawal, so taking out {amount} costs {pctSmall} instead of {pctNormal}. Withdraw more at once.",
    caveat: "{provider} — {caveat}",
    feeUnknownReason: "{provider}: {reason}",
  },
  offers: {
    title: "What you could open",
    intro1:
      "Cards from the catalogue, not cards you hold — as far as we can tell you don't have them, and today you pay with whatever is listed under “Pay”. One card per provider: the cheapest one we have both a source and a date for.",
    intro2One:
      "The order is what a card costs you on this trip: the fee on {reference} plus what the card itself costs over {months} month. Where it says “card cost unknown”, only the fee is in that amount — that's a floor, not proof the card is free.",
    intro2Many:
      "The order is what a card costs you on this trip: the fee on {reference} plus what the card itself costs over {months} months. Where it says “card cost unknown”, only the fee is in that amount — that's a floor, not proof the card is free.",
    feeLine: "{pct} exchange fee",
    cashbackSuffix: "{pct} cashback",
    amountOnReference: "{amount} on {reference}",
    withdrawalSuffix: "withdrawing {amount} per {reference}",
    withdrawalUnknown: "withdrawal fee unknown",
    cashbackNoteSuffix: " So we don't count it.",
    remainingCount: "{count} more cards in the catalogue with a sourced rate, all pricier than this one.",
  },
  figureAge: {
    fallback: "looked up {date}",
    today: "looked up today",
    yesterday: "looked up yesterday",
    daysAgo: "looked up {n} days ago",
    weeksAgo: "checked {n} weeks ago",
    monthsAgo: "checked {n} months ago",
  },
  winner: {
    pinnenLabel: "Withdrawing:",
    foldLabelGap: "What's missing, and what you can do about it",
    foldLabelFull: "All routes, sources and terms",
  },
  detail: {
    switchSource: "{product} is from the catalogue, not one of your accounts",
    switchAgeSuffix: " · rate {age}",
    todayLabel: "Today:",
    todayBody: "with what you already hold, {product} is cheapest — {cost} on {reference}.",
    notRecommendedLabel: "Not recommended:",
    notRecommendedBody:
      "{product} has a lower fee ({offerPct} against {ownPct}), but costs {fee} to hold: {gross} lower fee against {cost} card cost {span}, so {comparison} {ownProduct}.",
    evenAsExpensive: "the same cost as",
    moreExpensiveThan: "{amount} more than",
    referenceNote:
      "All amounts are for {reference} spent there. LaVega never moves anything itself — that step is yours to take.",
    unidentifiedOne:
      "{count} account has no bank set — we can't look it up. Add the bank under Accounts, or set its type to Savings account if it holds savings.",
    unidentifiedMany:
      "{count} accounts have no bank set — we can't look them up. Add the bank under Accounts, or set the type to Savings account if it holds savings.",
  },
  steps: {
    store: "Keep",
    exchange: "Exchange",
    pay: "Pay",
    storeSavings: "Saves {amount} a year.",
    exchangeNoCard: "No card with known terms yet — see the reason at the top of this block.",
    pointsPerEuro: "{n} point/€",
    userSetFee: "set by you",
  },
  countries: TRAVEL_COUNTRIES,
  caveat: (c) => {
    switch (c.kind) {
      case "capped":
        return `This rate only holds up to a limit: ${c.cap}.`;
      case "limited":
        return "This rate only holds within a limit or a package — read the terms before you switch.";
      case "quoted":
        return c.text;
    }
  },
  storeNote: (n) =>
    n.kind === "already-best"
      ? "Your savings are already in the best place we know of."
      : `You're leaving interest on the table at ${n.account}${n.best ? ` — ${n.best.bank} pays ${formatPercentIn("en", n.best.ratePct / 100)}` : ""}.`,
  withdrawalFee: (components) =>
    components
      .map((c) =>
        c.kind === "fixed"
          ? `${formatEuroIn("en", c.eur)} per withdrawal`
          : c.minEur === null
            ? `${formatPercentIn("en", c.pct / 100)} of the amount withdrawn`
            : `${formatPercentIn("en", c.pct / 100)} of the amount withdrawn, minimum ${formatEuroIn("en", c.minEur)}`,
      )
      .join(" + "),
};

export type OptimiseCopy = {
  optimalisatie: OptimalisatieCopy;
  valuta: ValutaCopy;
  punten: PuntenCopy;
  grens: GrensCopy;
  travel: TravelCopy;
};

const nl: OptimiseCopy = {
  optimalisatie: optimalisatieCopy_nl,
  valuta: valutaCopy_nl,
  punten: puntenCopy_nl,
  grens: grensCopy_nl,
  travel: travelCopy_nl,
};

const en: OptimiseCopy = {
  optimalisatie: optimalisatieCopy_en,
  valuta: valutaCopy_en,
  punten: puntenCopy_en,
  grens: grensCopy_en,
  travel: travelCopy_en,
};

export const optimiseCopy: Record<Locale, OptimiseCopy> = { nl, en };

export function formatPercentIn(locale: Locale, p: number): string {
  return `${p.toLocaleString(localeTag(locale), { maximumFractionDigits: 2 })}%`;
}

/** The one place a `HeldCashbackDescription` becomes a sentence. Optimalisatie
 *  and Profiel both describe the same fact and must not narrate it differently,
 *  so it lives with the copy rather than in either view. Exhaustive by switch,
 *  so a new kind in assumedCashback.ts fails the build here instead of
 *  rendering nothing — the same shape as `holdSentence` in Facturen.tsx. */
export function heldCashbackSentence(d: HeldCashbackDescription, locale: Locale): string {
  const hc = optimiseCopy[locale].optimalisatie.cashback.heldCashback;
  const noAssumptionReason = optimiseCopy[locale].optimalisatie.common.noAssumptionReason;
  switch (d.kind) {
    case "measured": {
      const pct = formatPercentIn(locale, d.pct);
      return d.source === "user" ? hc.measuredByUser(pct, d.updatedAt) : hc.measuredByAgent(pct, d.updatedAt);
    }
    case "assumption-off":
      return hc.assumptionOff;
    case "assumed-no-cashback":
      return hc.assumedNoCashback;
    case "unknown":
      return hc.unknown(noAssumptionReason[d.reason]);
  }
}
