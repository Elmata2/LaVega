import type { AdvisorProfile, WorkKind } from "@lavega/core";
import type { Locale } from "../locale.js";

/**
 * Every word the profile intake shows, in both languages. One shape, two
 * values: a string added to Dutch and forgotten in English is a type error.
 * Sentences with amounts are functions of already formatted strings.
 *
 * Legal line (spec section 6): calculations on the user's own numbers and
 * general explanation only. Nothing here names a product, a provider, an
 * amount to invest or a split. `ADVICE_LANGUAGE` runs over all of it in
 * `views/Intake.test.tsx`.
 */
export type IntakeQuestionCopy = {
  prompt: (money: (euros: number) => string) => string;
  options: Record<string, string>;
};

/** Every profile section the page lists; a new section in the core profile is a
 *  type error here until it has a label, and in `views/AboutYou.tsx` until it
 *  has a row builder. `removed` and `intake` are bookkeeping, not facts. */
export type ProfileSection = Exclude<keyof AdvisorProfile, "removed" | "intake">;

export type AboutYouCopy = {
  ariaLabel: string;
  title: string;
  intro: string;
  corruptNotice: string;
  saveFailed: string;
  empty: { title: string; body: string; start: string };
  columns: {
    field: string;
    value: string;
    source: string;
    date: string;
    actions: string;
  };
  sources: { derived: string; confirmed: string; stated: string };
  sectionLabels: Record<ProfileSection, string>;
  edit: string;
  remove: string;
  save: string;
  cancel: string;
  /** Aria label for a row's action: "Edit income, Acme" style. */
  actionFor: (action: string, field: string, detail: string) => string;
  derivedRemoveNote: string;
  redo: string;
  perMonth: (amount: string) => string;
  values: {
    household: { alone: string; together: string };
    noChildren: string;
    childYears: (years: string) => string;
    regular: string;
    irregular: string;
    housing: { rent: string; mortgage: string; other: string };
    debtBalance: (amount: string) => string;
    goalBy: (amount: string, date: string) => string;
    months: (n: string) => string;
    tolerance: (n: number) => string;
    toleranceUnknown: string;
    knowledge: (correct: number, of: number) => string;
    experience: { beginner: string; some: string; experienced: string };
    range: (low: string, high: string) => string;
    incomeRange: string;
    spendRange: string;
    workKinds: Record<WorkKind, string>;
    otherCard: string;
    otherDebitCard: string;
    noCards: string;
  };
  editors: {
    euros: string;
    months: string;
    childYears: string;
    childYearsHint: string;
    worries: string;
    low: string;
    high: string;
    choice: string;
  };
  capacity: {
    label: string;
    computed: string;
    note: string;
    value: (n: number) => string;
    unknown: string;
  };
  profielCard: { title: string; body: string; open: string };
};

export type IntakeCopy = {
  corruptNotice: string;
  loading: string;
  loadError: string;
  retry: string;
  payoff: {
    title: string;
    headline: (amount: string) => string;
    range: (low: string, high: string) => string;
    partial: (n: number) => string;
    stated: string;
    showCalc: string;
    monthLine: (month: string, incoming: string, outgoing: string, net: string) => string;
    middleNote: string;
    rulesNote: string;
    statedCalc: (incLow: string, incHigh: string, spLow: string, spHigh: string) => string;
    foreignExcluded: (n: number) => string;
    none: { noData: string; noFullMonth: string };
    /** Accounts whose data stops months from counting, one line per reason. */
    blocking: { stale: (name: string) => string; short: (name: string, since: string) => string };
    /** Stands in for an account that has neither a name nor a bank. */
    anAccount: string;
    continue: string;
  };
  /** The two cards on the home screen. */
  home: {
    invite: {
      title: string;
      intro: string;
      start: string;
      resume: string;
      resumed: string;
      riskDue: string;
    };
    room: {
      title: string;
      open: string;
      importLink: string;
    };
  };
  block3: {
    risk: {
      items: Record<string, IntakeQuestionCopy>;
    };
    knowledge: {
      invested: { prompt: string; yes: string; no: string };
    };
    result: {
      title: string;
      tolerance: (n: number) => string;
      capacity: (n: number) => string;
      toleranceUnknown: string;
      capacityUnknown: string;
      disagree: string;
      agree: string;
    };
  };
  aboutYou: AboutYouCopy;
};

export const intakeCopy: Record<Locale, IntakeCopy> = {
  nl: {
    corruptNotice:
      "Je eerder opgeslagen profiel was niet meer te lezen. We beginnen opnieuw; het oude blijft als reservekopie bewaard.",
    loading: "Je gegevens worden geladen…",
    loadError: "Je profiel kon niet uit de kluis worden gelezen.",
    retry: "Opnieuw proberen",
    payoff: {
      title: "Je ruimte per maand",
      headline: (a) => `Ongeveer ${a} per maand`,
      range: (l, h) => `Tussen ${l} en ${h}`,
      partial: (n) =>
        `Er waren minder dan drie volledige maanden; berekend over ${n}. We extrapoleren niet.`,
      stated: "Berekend uit de bandbreedtes die je zelf opgaf.",
      showCalc: "Toon de berekening",
      monthLine: (m, i, o, n) => `${m}: ontvangen ${i}, uitgegeven ${o}, over ${n}`,
      middleNote:
        "Het hoofdbedrag is de middelste maand; de bandbreedte loopt van de laagste tot de hoogste maand.",
      rulesNote:
        "Geld dat tussen je eigen rekeningen schuift telt niet mee. Aflossingen tellen als uitgave. Eenmalige bedragen tellen mee zoals ze vielen.",
      statedCalc: (il, ih, sl, sh) =>
        `Inkomen ${il} tot ${ih} min uitgaven ${sl} tot ${sh}: laagste uitkomst is laagste inkomen min hoogste uitgaven, hoogste uitkomst het omgekeerde.`,
      foreignExcluded: (n) => `${n} transactie(s) in vreemde valuta zijn niet meegeteld.`,
      none: {
        noData: "We hebben nog te weinig gegevens om je ruimte te berekenen.",
        noFullMonth: "We hebben nog geen volledige maand aan gegevens om je ruimte te berekenen.",
      },
      blocking: {
        stale: (name) =>
          `${name} heeft geen recente transacties, dus deze maanden kunnen niet meetellen. Synchroniseer of importeer de rekening om dit op te lossen.`,
        short: (name, since) =>
          `${name} heeft pas gegevens vanaf ${since}; je ruimte gebruikt minder maanden tot er drie volle zijn.`,
      },
      anAccount: "Een rekening",
      continue: "Verder",
    },
    home: {
      invite: {
        title: "Vertel LaVega over je situatie",
        intro:
          "Beantwoord een paar vragen en LaVega rekent met jouw cijfers. Alles blijft in je eigen kluis en je kunt het later aanpassen.",
        start: "Begin",
        resume: "Ga verder",
        resumed: "Je bent gestart; ga verder waar je bleef.",
        riskDue:
          "Het is tijd om je antwoorden over risico nog eens langs te lopen; je andere antwoorden blijven staan.",
      },
      room: {
        title: "Je ruimte per maand",
        open: "Pas je antwoorden aan",
        importLink: "Naar importeren en koppelen",
      },
    },
    block3: {
      risk: {
        items: {
          "loss-20": {
            prompt: (m) =>
              `Je belegging van ${m(10000)} is na een jaar ${m(8000)} waard. Wat doe je?`,
            options: {
              "sell-all": "Alles verkopen",
              "sell-half": "Een deel verkopen",
              "do-nothing": "Niets doen en afwachten",
              "buy-more": "Er meer bij kopen",
            },
          },
          "gain-vs-loss": {
            prompt: () => "Welke uitkomst past het best bij geld dat je tien jaar niet nodig hebt?",
            options: {
              "no-loss-small-gain": "Geen verlies mogelijk, kleine winst",
              "small-loss-medium-gain":
                "Hooguit een klein verlies, een gemiddelde winst als het meezit",
              "medium-loss-big-gain": "Een gemiddeld verlies kan, een grote winst als het meezit",
              "big-loss-huge-gain": "Een groot verlies kan, een zeer grote winst als het meezit",
            },
          },
          sleep: {
            prompt: () => "Je beleggingen dalen 20 procent. Hoe vaak ligt je daar wakker van?",
            options: {
              "worry-often": "Vaak",
              "worry-sometimes": "Soms",
              "rarely-worry": "Zelden",
              "never-worry": "Nooit",
            },
          },
          "friend-crash": {
            prompt: () => "De markt zakt hard in en een vriend haalt alles weg. Wat doe jij?",
            options: {
              "cash-out": "Ook alles weghalen",
              "wait-and-see": "Afwachten",
              "stay-invested": "Blijven zitten",
              "invest-more": "Extra inleggen",
            },
          },
          "horizon-attitude": {
            prompt: () => "Wanneer heb je het geld nodig dat je zou beleggen?",
            options: {
              "need-it-soon": "Binnen enkele jaren",
              "some-years": "Over een paar jaar",
              "long-term": "Pas over lange tijd",
              "decades-no-need": "Over tientallen jaren of nooit",
            },
          },
        },
      },
      knowledge: {
        invested: {
          prompt: "Heb je al eens belegd, bijvoorbeeld in aandelen, fondsen of crypto?",
          yes: "Ja",
          no: "Nee",
        },
      },
      result: {
        title: "Jouw cijfers naast je antwoorden",
        tolerance: (n) => `Wat je aangeeft te verdragen: ${n} van 5`,
        capacity: (n) => `Draagkracht uit je cijfers (schaal 1 tot 5): ${n}`,
        toleranceUnknown: "Beantwoord minstens vier risicovragen om dit te zien.",
        capacityUnknown: "Er zijn nog te weinig gegevens om dit uit te rekenen.",
        disagree:
          "Deze twee liggen twee punten of meer uit elkaar. Dat laten we zien en we lossen het niet voor je op.",
        agree: "Deze twee liggen dicht bij elkaar.",
      },
    },
    aboutYou: {
      ariaLabel: "Wat LaVega over je weet",
      title: "Wat LaVega over je weet",
      intro:
        "Dit staat er in je eigen kluis. Per feit zie je waar het vandaan komt en wanneer het is vastgelegd. Je kunt alles aanpassen of weghalen.",
      corruptNotice: "Je opgeslagen profiel is niet te lezen. Er is niets aangepast of verwijderd.",
      saveFailed: "Dit is niet opgeslagen. Probeer het opnieuw.",
      empty: {
        title: "Er is nog niets vastgelegd",
        body: "LaVega weet nog niets over je. Met de intake leg je in een paar minuten vast wat nodig is voor een rustig overzicht.",
        start: "Start de intake",
      },
      columns: {
        field: "Onderdeel",
        value: "Waarde",
        source: "Bron",
        date: "Datum",
        actions: "Acties",
      },
      sources: {
        derived: "Afgeleid uit je gegevens",
        confirmed: "Door jou bevestigd",
        stated: "Door jou opgegeven",
      },
      sectionLabels: {
        household: "Huishouden",
        children: "Kinderen",
        incomeStreams: "Inkomen",
        housing: "Wonen",
        fixedCosts: "Vaste lasten",
        debts: "Schulden",
        savings: "Spaargeld",
        goals: "Doelen",
        buffer: "Buffer",
        risk: "Risicohouding",
        knowledge: "Kennis",
        experience: "Ervaring",
        worries: "Zorgen",
        statedRanges: "Opgegeven bedragen",
        work: "Werk",
        statedCards: "Creditcards",
        statedDebitCards: "Betaalpassen",
      },
      edit: "Wijzig",
      remove: "Verwijder",
      save: "Opslaan",
      cancel: "Annuleren",
      actionFor: (action, field, detail) =>
        detail ? `${action}: ${field}, ${detail}` : `${action}: ${field}`,
      derivedRemoveNote:
        "Verwijderd en niet opnieuw voorgesteld zolang de onderliggende gegevens gelijk blijven.",
      redo: "Beantwoord opnieuw",
      perMonth: (a) => `${a} per maand`,
      values: {
        household: { alone: "Alleen", together: "Samen" },
        noChildren: "Geen kinderen",
        childYears: (y) => `Geboortejaren ${y}`,
        regular: "regelmatig",
        irregular: "onregelmatig",
        housing: { rent: "Huur", mortgage: "Hypotheek", other: "Overig wonen" },
        debtBalance: (a) => `openstaand ${a}`,
        goalBy: (a, d) => `${a} vóór ${d}`,
        months: (n) => `${n} maanden`,
        tolerance: (n) => `${n} van 5`,
        toleranceUnknown: "Nog te weinig antwoorden voor een score",
        knowledge: (c, of) => `${c} van ${of} goed`,
        experience: {
          beginner: "Beginner",
          some: "Enige ervaring",
          experienced: "Ervaren",
        },
        range: (l, h) => `tussen ${l} en ${h} per maand`,
        incomeRange: "Netto inkomen",
        spendRange: "Uitgaven",
        workKinds: {
          employed: "Loondienst",
          freelance: "Freelance / zzp",
          business: "Eigen bedrijf",
          student: "Student",
          jobseeking: "Werkzoekend",
          retired: "Met pensioen",
          other: "Anders",
        },
        otherCard: "Een andere kaart",
        otherDebitCard: "Een andere pas",
        noCards: "Geen creditcard",
      },
      editors: {
        euros: "Bedrag in euro",
        months: "Aantal maanden",
        childYears: "Geboortejaren",
        childYearsHint: "Gescheiden door komma's, bijvoorbeeld 2015, 2018",
        worries: "Wat je bezighoudt",
        low: "Van (euro)",
        high: "Tot (euro)",
        choice: "Keuze",
      },
      capacity: {
        label: "Draagkracht",
        computed: "Berekend",
        note: "Wordt telkens uit je gegevens uitgerekend en nooit opgeslagen. Je kunt het niet aanpassen, wel de cijfers erachter.",
        value: (n) => `${n} van 5`,
        unknown: "Nog te weinig gegevens om dit uit te rekenen",
      },
      profielCard: {
        title: "Wat LaVega over je weet",
        body: "Bekijk elk feit dat is vastgelegd, waar het vandaan komt, en pas het aan of haal het weg.",
        open: "Bekijk wat LaVega weet",
      },
    },
  },
  en: {
    corruptNotice:
      "Your previously saved profile could no longer be read. We start fresh; the old one is kept as a backup copy.",
    loading: "Loading your data…",
    loadError: "Your profile could not be read from the vault.",
    retry: "Try again",
    payoff: {
      title: "Your room each month",
      headline: (a) => `About ${a} a month`,
      range: (l, h) => `Between ${l} and ${h}`,
      partial: (n) =>
        `Fewer than three full months were available; worked out over ${n}. We do not extrapolate.`,
      stated: "Worked out from the ranges you gave.",
      showCalc: "Show the calculation",
      monthLine: (m, i, o, n) => `${m}: received ${i}, spent ${o}, left ${n}`,
      middleNote:
        "The headline is the middle month; the range runs from the lowest to the highest month.",
      rulesNote:
        "Money moving between your own accounts is left out. Loan and debt payments count as spending. One-off amounts count as they fell.",
      statedCalc: (il, ih, sl, sh) =>
        `Income ${il} to ${ih} minus spending ${sl} to ${sh}: the low end is the lowest income minus the highest spending, the high end the reverse.`,
      foreignExcluded: (n) => `${n} transaction(s) in a foreign currency were not counted.`,
      none: {
        noData: "We do not have enough data yet to work out your room.",
        noFullMonth: "We do not have a full month of data yet to work out your room.",
      },
      blocking: {
        stale: (name) =>
          `${name} has no recent transactions, so these months can't be counted. Sync or import it to fix this.`,
        short: (name, since) =>
          `${name} only has data since ${since}; the room uses fewer months until there are three full ones.`,
      },
      anAccount: "An account",
      continue: "Continue",
    },
    home: {
      invite: {
        title: "Tell LaVega about your situation",
        intro:
          "Answer a few questions and LaVega works with your own numbers. Everything stays in your own vault and you can change it later.",
        start: "Start",
        resume: "Continue",
        resumed: "You have started; pick up where you stopped.",
        riskDue:
          "It is time to look at your answers about risk again; your other answers stay as they are.",
      },
      room: {
        title: "Your room each month",
        open: "Change your answers",
        importLink: "Go to import and linking",
      },
    },
    block3: {
      risk: {
        items: {
          "loss-20": {
            prompt: (m) =>
              `Your investment of ${m(10000)} is worth ${m(8000)} after a year. What do you do?`,
            options: {
              "sell-all": "Get out completely",
              "sell-half": "Get out partly",
              "do-nothing": "Do nothing and wait",
              "buy-more": "Put more in",
            },
          },
          "gain-vs-loss": {
            prompt: () => "Which outcome suits money you will not need for ten years?",
            options: {
              "no-loss-small-gain": "No loss possible, a small gain",
              "small-loss-medium-gain": "At worst a small loss, a medium gain if things go well",
              "medium-loss-big-gain": "A medium loss is possible, a big gain if things go well",
              "big-loss-huge-gain": "A big loss is possible, a very big gain if things go well",
            },
          },
          sleep: {
            prompt: () => "Your investments fall 20 percent. How often does that keep you awake?",
            options: {
              "worry-often": "Often",
              "worry-sometimes": "Sometimes",
              "rarely-worry": "Rarely",
              "never-worry": "Never",
            },
          },
          "friend-crash": {
            prompt: () =>
              "The market drops sharply and a friend pulls everything out. What do you do?",
            options: {
              "cash-out": "Pull everything out too",
              "wait-and-see": "Wait and see",
              "stay-invested": "Stay put",
              "invest-more": "Put in extra",
            },
          },
          "horizon-attitude": {
            prompt: () => "When will you need the money you would invest?",
            options: {
              "need-it-soon": "Within a few years",
              "some-years": "In a few years",
              "long-term": "Only after a long time",
              "decades-no-need": "In decades, or never",
            },
          },
        },
      },
      knowledge: {
        invested: {
          prompt: "Have you invested before, for example in shares, funds or crypto?",
          yes: "Yes",
          no: "No",
        },
      },
      result: {
        title: "Your numbers next to your answers",
        tolerance: (n) => `What you say you can bear: ${n} of 5`,
        capacity: (n) => `Capacity from your figures (scale 1 to 5): ${n}`,
        toleranceUnknown: "Answer at least four risk questions to see this.",
        capacityUnknown: "There is not enough data yet to work this out.",
        disagree:
          "These two are two points or more apart. We show it and do not settle it for you.",
        agree: "These two are close together.",
      },
    },
    aboutYou: {
      ariaLabel: "What LaVega knows about you",
      title: "What LaVega knows about you",
      intro:
        "This is what sits in your own vault. For each fact you see where it came from and when it was recorded. You can change or remove any of it.",
      corruptNotice: "Your stored profile cannot be read. Nothing was changed or removed.",
      saveFailed: "This was not saved. Try again.",
      empty: {
        title: "Nothing is recorded yet",
        body: "LaVega does not know anything about you yet. The intake takes a few minutes and records what a calm overview needs.",
        start: "Start the intake",
      },
      columns: {
        field: "Item",
        value: "Value",
        source: "Source",
        date: "Date",
        actions: "Actions",
      },
      sources: {
        derived: "Worked out from your data",
        confirmed: "Confirmed by you",
        stated: "Stated by you",
      },
      sectionLabels: {
        household: "Household",
        children: "Children",
        incomeStreams: "Income",
        housing: "Housing",
        fixedCosts: "Fixed costs",
        debts: "Debts",
        savings: "Savings",
        goals: "Goals",
        buffer: "Buffer",
        risk: "Risk tolerance",
        knowledge: "Knowledge",
        experience: "Experience",
        worries: "Worries",
        statedRanges: "Amounts you gave",
        work: "Work",
        statedCards: "Credit cards",
        statedDebitCards: "Debit cards",
      },
      edit: "Edit",
      remove: "Remove",
      save: "Save",
      cancel: "Cancel",
      actionFor: (action, field, detail) =>
        detail ? `${action}: ${field}, ${detail}` : `${action}: ${field}`,
      derivedRemoveNote: "Removed, and not proposed again while the data behind it stays the same.",
      redo: "Redo these questions",
      perMonth: (a) => `${a} a month`,
      values: {
        household: { alone: "On my own", together: "Together" },
        noChildren: "No children",
        childYears: (y) => `Born ${y}`,
        regular: "regular",
        irregular: "irregular",
        housing: { rent: "Rent", mortgage: "Mortgage", other: "Other housing" },
        debtBalance: (a) => `${a} outstanding`,
        goalBy: (a, d) => `${a} by ${d}`,
        months: (n) => `${n} months`,
        tolerance: (n) => `${n} of 5`,
        toleranceUnknown: "Not enough answers for a score yet",
        knowledge: (c, of) => `${c} of ${of} correct`,
        experience: {
          beginner: "Beginner",
          some: "Some experience",
          experienced: "Experienced",
        },
        range: (l, h) => `between ${l} and ${h} a month`,
        incomeRange: "Net income",
        spendRange: "Spending",
        workKinds: {
          employed: "Employed",
          freelance: "Freelance / self-employed",
          business: "Own business",
          student: "Student",
          jobseeking: "Job seeking",
          retired: "Retired",
          other: "Other",
        },
        otherCard: "Another card",
        otherDebitCard: "Another card",
        noCards: "No credit card",
      },
      editors: {
        euros: "Amount in euros",
        months: "Number of months",
        childYears: "Birth years",
        childYearsHint: "Separated by commas, for example 2015, 2018",
        worries: "What is on your mind",
        low: "From (euros)",
        high: "To (euros)",
        choice: "Choice",
      },
      capacity: {
        label: "Capacity",
        computed: "Computed",
        note: "Worked out from your data each time and never stored. You cannot edit it, only the numbers behind it.",
        value: (n) => `${n} of 5`,
        unknown: "Not enough data yet to work this out",
      },
      profielCard: {
        title: "What LaVega knows about you",
        body: "See every fact on record and where it came from, then change it or remove it.",
        open: "See what LaVega knows",
      },
    },
  },
};
