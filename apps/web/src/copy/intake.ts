import type { AdvisorProfile } from "@lavega/core";
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
  ariaLabel: string;
  title: string;
  legalLine: string;
  corruptNotice: string;
  loading: string;
  loadError: string;
  retry: string;
  saveFailed: string;
  stages: { step0: string; block1: string; block2: string; block3: string; done: string };
  progress: (n: number, of: number, label: string) => string;
  common: {
    confirm: string;
    correct: string;
    notMine: string;
    save: string;
    cancel: string;
    add: string;
    remove: string;
    continue: string;
    change: string;
    optional: string;
    from: string;
    to: string;
    yes: string;
    no: string;
    perMonth: string;
    euros: string;
  };
  step0: {
    title: string;
    intro: string;
    tradeNote: string;
    settingsTitle: string;
    language: string;
    country: string;
    countryHint: string;
    regionPlaceholder: string;
    firstName: string;
    lastName: string;
    nameNote: string;
    languages: { code: Locale; label: string }[];
    existing: (accounts: number, txs: number) => string;
    useExisting: string;
    skipTitle: string;
    skipBody: string;
    skipButton: string;
  };
  block1: {
    title: string;
    intro: string;
    weThink: string;
    evidence: (n: number) => string;
    accountsEvidence: (n: number) => string;
    evidenceMore: (n: number) => string;
    accountEvidence: (name: string) => string;
    status: { confirmed: string; stated: string; rejected: string };
    noData: string;
    thinData: (days: number) => string;
    amountLabel: string;
    sections: {
      income: string;
      housing: string;
      fixed: string;
      debts: string;
      savings: string;
      children: string;
    };
    sentences: {
      incomeRegular: (label: string, amount: string) => string;
      incomeIrregular: (label: string, amount: string) => string;
      housing: (kind: string, counterparty: string, amount: string) => string;
      housingKinds: { huur: string; hypotheek: string; wonen: string };
      fixedStream: (label: string, amount: string) => string;
      fixedSubscription: (label: string, amount: string) => string;
      debtStream: (lender: string, amount: string) => string;
      debtCard: (lender: string, balance: string) => string;
      savings: (amount: string) => string;
      savingsExcluded: (n: number) => string;
    };
    child: {
      kinderbijslag: string;
      childcare: string;
      question: string;
      yesNote: string;
      noNote: string;
    };
    stated: {
      incomeTitle: string;
      incomeQuestion: string;
      spendTitle: string;
      spendQuestion: string;
      housingTitle: string;
      housingQuestion: string;
      housingKinds: { rent: string; mortgage: string; other: string };
      savingsTitle: string;
      savingsQuestion: string;
      rangeError: string;
      amountError: string;
      saved: (summary: string) => string;
      range: (low: string, high: string) => string;
    };
    continueToRoom: string;
  };
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
      resumeStep: { step0: string; block1: string; block2: string; block3: string };
      riskDue: string;
    };
    room: {
      title: string;
      open: string;
      importLink: string;
    };
  };
  block2: {
    title: string;
    intro: string;
    household: { title: string; alone: string; together: string; partnerIncome: string };
    children: {
      title: string;
      intro: string;
      saidYes: string;
      birthYear: string;
      add: string;
      item: (year: number) => string;
      none: string;
    };
    goals: {
      title: string;
      intro: string;
      purpose: string;
      kind: string;
      kinds: { general: string; child: string };
      child: string;
      target: string;
      date: string;
      priority: string;
      priorities: { flexible: string; important: string; must: string };
      planned: string;
      add: string;
      empty: string;
      item: (purpose: string, amount: string, date: string, priority: string) => string;
      error: string;
    };
    debts: {
      title: string;
      intro: string;
      lender: string;
      monthly: string;
      balance: string;
      rate: string;
      add: string;
      empty: string;
      item: (lender: string, monthly: string) => string;
      error: string;
    };
    buffer: {
      title: string;
      intro: string;
      option: (months: number) => string;
      unset: string;
    };
  };
  block3: {
    title: string;
    intro: string;
    risk: {
      title: string;
      intro: string;
      scaleNote: string;
      items: Record<string, IntakeQuestionCopy>;
    };
    knowledge: {
      title: string;
      intro: string;
      items: Record<string, IntakeQuestionCopy>;
      invested: { prompt: string; yes: string; no: string };
    };
    worries: { title: string; prompt: string; hint: string };
    result: {
      title: string;
      tolerance: (n: number) => string;
      capacity: (n: number) => string;
      toleranceUnknown: string;
      capacityUnknown: string;
      disagree: string;
      agree: string;
    };
    finish: string;
    needMore: string;
  };
  done: { title: string; body: string; toOverview: string };
  aboutYou: AboutYouCopy;
};

export const intakeCopy: Record<Locale, IntakeCopy> = {
  nl: {
    ariaLabel: "Je financieel profiel",
    title: "Je financiële beeld",
    legalLine:
      "LaVega geeft informatie en rekent met jouw eigen cijfers. Het is geen financieel advies.",
    corruptNotice:
      "Je eerder opgeslagen profiel was niet meer te lezen. We beginnen opnieuw; het oude blijft als reservekopie bewaard.",
    loading: "Je gegevens worden geladen…",
    loadError: "Je profiel kon niet uit de kluis worden gelezen.",
    retry: "Opnieuw proberen",
    saveFailed: "Opslaan lukte niet. Probeer het opnieuw.",
    stages: {
      step0: "Je gegevens",
      block1: "Wat we vonden",
      block2: "Wat je ons vertelt",
      block3: "Risico en kennis",
      done: "Klaar",
    },
    progress: (n, of, label) => `Stap ${n} van ${of}: ${label}`,
    common: {
      confirm: "Klopt",
      correct: "Aanpassen",
      notMine: "Niet van mij",
      save: "Opslaan",
      cancel: "Annuleren",
      add: "Toevoegen",
      remove: "Verwijderen",
      continue: "Verder",
      change: "Wijzigen",
      optional: "optioneel",
      from: "Van",
      to: "tot",
      yes: "Ja",
      no: "Nee",
      perMonth: "per maand",
      euros: "in euro's",
    },
    step0: {
      title: "Begin met je gegevens",
      intro:
        "Koppel een bank of upload een afschrift, dan hoef je straks vooral te bevestigen in plaats van te typen. Je kunt ook zonder gegevens verder.",
      tradeNote:
        "Zonder gegevens vragen we je om bedragen als bandbreedte, bijvoorbeeld tussen 2.500 en 3.000 euro per maand.",
      settingsTitle: "Taal en land",
      language: "Taal",
      country: "Land",
      countryHint: "Bepaalt welke landspecifieke regels LaVega gebruikt.",
      regionPlaceholder: "optioneel",
      firstName: "Voornaam (optioneel)",
      lastName: "Achternaam (optioneel)",
      nameNote:
        "LaVega gebruikt je naam om overboekingen tussen je eigen rekeningen te herkennen. Hij blijft in deze browser en gaat niet naar de kluis of een model.",
      languages: [
        { code: "nl", label: "Nederlands" },
        { code: "en", label: "English" },
      ],
      existing: (a, t) => `Er staan al ${a} rekeningen en ${t} transacties in je kluis.`,
      useExisting: "Met deze gegevens verder",
      skipTitle: "Verder zonder gegevens",
      skipBody: "Je geeft zelf bandbreedtes op. Je kunt later nog een bank koppelen.",
      skipButton: "Verder zonder gegevens",
    },
    block1: {
      title: "Wat we in je gegevens vonden",
      intro: "Controleer elke kaart. Wat je niet bevestigt, behandelen we als een gok.",
      weThink: "Wij denken:",
      evidence: (n) => `Gebaseerd op ${n} transacties`,
      accountsEvidence: (n) => `Gebaseerd op ${n} rekeningsaldo(s)`,
      evidenceMore: (n) => `en nog ${n} andere`,
      accountEvidence: (name) => `Saldo van rekening ${name}`,
      status: {
        confirmed: "Bevestigd",
        stated: "Door jou aangepast",
        rejected: "Gemarkeerd als niet van jou",
      },
      noData: "Je hebt geen gegevens gekoppeld, dus we vragen het je zelf.",
      thinData: (days) =>
        `We hebben ongeveer twee maanden geschiedenis nodig om dit uit je gegevens te lezen; er zijn er nu ${days} dagen. Vul het daarom zelf in.`,
      amountLabel: "Bedrag per maand in euro's",
      sections: {
        income: "Inkomen",
        housing: "Wonen",
        fixed: "Vaste lasten en abonnementen",
        debts: "Schulden",
        savings: "Sparen",
        children: "Kinderen",
      },
      sentences: {
        incomeRegular: (l, a) => `Je ontvangt ongeveer ${a} per maand van ${l}.`,
        incomeIrregular: (l, a) =>
          `${l} betaalt je gemiddeld ${a} per maand, maar niet op een vast ritme.`,
        housing: (k, c, a) => `Je betaalt ${a} per maand voor ${k} aan ${c}.`,
        housingKinds: { huur: "huur", hypotheek: "je hypotheek", wonen: "wonen" },
        fixedStream: (l, a) => `${l} kost je ongeveer ${a} per maand.`,
        fixedSubscription: (l, a) => `Je abonnement ${l} kost ongeveer ${a} per maand.`,
        debtStream: (l, a) => `Je betaalt ${l} ongeveer ${a} per maand af.`,
        debtCard: (l, b) => `Op je creditcard ${l} staat een schuld van ${b}.`,
        savings: (a) => `Op je spaarrekeningen staat samen ${a}.`,
        savingsExcluded: (n) => `${n} spaarrekening(en) in vreemde valuta tellen we niet mee.`,
      },
      child: {
        kinderbijslag: "We zagen betalingen van kinderbijslag.",
        childcare: "We zagen betalingen aan kinderopvang.",
        question: "Heb je kinderen?",
        yesNote: "Aantal en geboortejaren vraag je hierna.",
        noNote: "Genoteerd: geen kinderen.",
      },
      stated: {
        incomeTitle: "Je inkomen",
        incomeQuestion: "Hoeveel houd je ongeveer netto over per maand, alles bij elkaar?",
        spendTitle: "Je uitgaven",
        spendQuestion: "Hoeveel geef je ongeveer uit per maand, alles inbegrepen?",
        housingTitle: "Je woning",
        housingQuestion: "Huur of koop je, en wat kost het per maand?",
        housingKinds: { rent: "Huur", mortgage: "Hypotheek", other: "Anders" },
        savingsTitle: "Je spaargeld",
        savingsQuestion: "Hoeveel staat er ongeveer op je spaarrekeningen?",
        rangeError:
          "Vul een laagste en een hoogste bedrag in; het eerste is niet hoger dan het tweede.",
        amountError: "Vul een bedrag van nul of meer in.",
        saved: (s) => `Opgeslagen: ${s}`,
        range: (l, h) => `tussen ${l} en ${h}`,
      },
      continueToRoom: "Toon mijn ruimte",
    },
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
        resumeStep: {
          step0: "Je was gestart met het aanleveren van je gegevens.",
          block1: "Je gegevens zijn binnen; er staan nog voorstellen die je kunt bevestigen.",
          block2: "Je ruimte staat. De vragen over je situatie zijn nog open.",
          block3: "Alleen de laatste vragen zijn nog open.",
        },
        riskDue:
          "Het is tijd om je antwoorden over risico nog eens langs te lopen; je andere antwoorden blijven staan.",
      },
      room: {
        title: "Je ruimte per maand",
        open: "Pas je antwoorden aan",
        importLink: "Naar importeren en koppelen",
      },
    },
    block2: {
      title: "Wat gegevens niet laten zien",
      intro: "Een paar vragen over je situatie. Elk antwoord wordt direct opgeslagen.",
      household: {
        title: "Huishouden",
        alone: "Ik woon alleen",
        together: "Ik woon samen",
        partnerIncome: "Het inkomen van mijn partner hoort bij mijn cijfers",
      },
      children: {
        title: "Kinderen",
        intro: "Aantal en geboortejaar per kind. Namen hebben we niet nodig.",
        saidYes: "Je gaf eerder aan dat je kinderen hebt.",
        birthYear: "Geboortejaar",
        add: "Kind toevoegen",
        item: (y) => `Kind, geboren in ${y}`,
        none: "Nog geen kinderen genoteerd.",
      },
      goals: {
        title: "Doelen",
        intro:
          "Elk doel is een eigen potje: waarvoor, hoeveel, wanneer en wat er gebeurt als het niet lukt.",
        purpose: "Waarvoor",
        kind: "Soort",
        kinds: { general: "Algemeen", child: "Voor een kind" },
        child: "Kind",
        target: "Streefbedrag in euro's",
        date: "Streefdatum",
        priority: "Als het niet lukt",
        priorities: {
          flexible: "Flexibel, het mag opschuiven",
          important: "Belangrijk",
          must: "Onmisbaar",
        },
        planned: "Geplande inleg per maand (optioneel)",
        add: "Doel toevoegen",
        empty: "Nog geen doelen.",
        item: (p, a, d, pr) => `${p}: ${a} voor ${d} (${pr})`,
        error:
          "Vul waarvoor, een bedrag boven nul en een datum in; kies bij een kinddoel een kind.",
      },
      debts: {
        title: "Schulden buiten je gekoppelde rekeningen",
        intro:
          "Een studieschuld die we niet zien, een hypotheek bij een andere bank, een privélening.",
        lender: "Bij wie",
        monthly: "Aflossing per maand in euro's",
        balance: "Openstaand bedrag in euro's (optioneel)",
        rate: "Rente in procenten (optioneel)",
        add: "Schuld toevoegen",
        empty: "Geen extra schulden genoteerd.",
        item: (l, m) => `${l}: ${m} per maand`,
        error: "Vul bij wie en een aflossing van nul of meer in.",
      },
      buffer: {
        title: "Buffer",
        intro: "Hoeveel maanden vaste lasten wil je als buffer achter de hand hebben?",
        option: (m) => `${m} maanden`,
        unset: "Kies een aantal",
      },
    },
    block3: {
      title: "Risico en kennis",
      intro: "Vragen over hoe je zou handelen en wat je al weet. Er zijn geen foute antwoorden.",
      risk: {
        title: "Hoe ga je met verlies om",
        intro: "Kies bij elke vraag wat het dichtst bij je past.",
        scaleNote:
          "Eigen conceptvragen van LaVega, nog niet afgestemd op een gepubliceerde schaal.",
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
        title: "Wat weet je al",
        intro: "Drie korte vragen.",
        items: {
          interest: {
            prompt: (m) =>
              `Je hebt ${m(100)} op een spaarrekening met 2 procent rente per jaar. Hoeveel heb je na 5 jaar?`,
            options: {
              "more-than-102": `Meer dan 102 euro`,
              "exactly-102": "Precies 102 euro",
              "less-than-102": "Minder dan 102 euro",
            },
          },
          inflation: {
            prompt: () =>
              "Je spaarrente is 1 procent per jaar en de inflatie 2 procent. Wat kun je na een jaar met dat geld kopen?",
            options: {
              "buy-less": "Minder dan nu",
              "buy-same": "Hetzelfde als nu",
              "buy-more": "Meer dan nu",
            },
          },
          diversification: {
            prompt: () =>
              "Je spreidt je geld over veel verschillende beleggingen in plaats van over één bedrijf. Wat verandert er voor het risico?",
            options: {
              "lower-risk": "Het risico wordt lager",
              "higher-risk": "Het risico wordt hoger",
              "no-difference": "Er verandert niets",
            },
          },
        },
        invested: {
          prompt: "Heb je al eens belegd, bijvoorbeeld in aandelen, fondsen of crypto?",
          yes: "Ja",
          no: "Nee",
        },
      },
      worries: {
        title: "Waar maak je je zorgen over",
        prompt: "Wat zit je op dit moment het meest dwars met geld?",
        hint: "Optioneel. Blijft in je kluis staan zoals je het schrijft.",
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
      finish: "Afronden",
      needMore: "Beantwoord de kennisvragen en of je al eerder belegde om af te ronden.",
    },
    done: {
      title: "Je profiel staat",
      body: "Je kunt alles later nog aanpassen. Wat LaVega van je weet, blijft in je eigen kluis.",
      toOverview: "Naar het overzicht",
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
    ariaLabel: "Your financial profile",
    title: "Your financial picture",
    legalLine:
      "LaVega gives information and works with your own numbers. It is not financial advice.",
    corruptNotice:
      "Your previously saved profile could no longer be read. We start fresh; the old one is kept as a backup copy.",
    loading: "Loading your data…",
    loadError: "Your profile could not be read from the vault.",
    retry: "Try again",
    saveFailed: "Saving did not work. Try again.",
    stages: {
      step0: "Your data",
      block1: "What we found",
      block2: "What you tell us",
      block3: "Risk and knowledge",
      done: "Done",
    },
    progress: (n, of, label) => `Step ${n} of ${of}: ${label}`,
    common: {
      confirm: "Confirm",
      correct: "Correct",
      notMine: "Not mine",
      save: "Save",
      cancel: "Cancel",
      add: "Add",
      remove: "Remove",
      continue: "Continue",
      change: "Change",
      optional: "optional",
      from: "From",
      to: "to",
      yes: "Yes",
      no: "No",
      perMonth: "per month",
      euros: "in euros",
    },
    step0: {
      title: "Start with your data",
      intro:
        "Connect a bank or upload a statement and you mostly confirm instead of type. You can also continue without data.",
      tradeNote:
        "Without data we ask for amounts as a range, for example between 2,500 and 3,000 euros a month.",
      settingsTitle: "Language and country",
      language: "Language",
      country: "Country",
      countryHint: "Decides which country-specific rules LaVega uses.",
      regionPlaceholder: "optional",
      firstName: "First name (optional)",
      lastName: "Last name (optional)",
      nameNote:
        "LaVega uses your name to recognise transfers between your own accounts. It stays in this browser and never goes to the vault or a model.",
      languages: [
        { code: "nl", label: "Nederlands" },
        { code: "en", label: "English" },
      ],
      existing: (a, t) => `Your vault already holds ${a} accounts and ${t} transactions.`,
      useExisting: "Continue with this data",
      skipTitle: "Continue without data",
      skipBody: "You give ranges yourself. You can connect a bank later.",
      skipButton: "Continue without data",
    },
    block1: {
      title: "What we found in your data",
      intro: "Check each card. What you do not confirm is treated as a guess.",
      weThink: "We think:",
      evidence: (n) => `Based on ${n} transactions`,
      accountsEvidence: (n) => `Based on ${n} account balance(s)`,
      evidenceMore: (n) => `and ${n} more`,
      accountEvidence: (name) => `Balance of account ${name}`,
      status: {
        confirmed: "Confirmed",
        stated: "Corrected by you",
        rejected: "Marked as not yours",
      },
      noData: "You have not linked any data, so we ask you directly.",
      thinData: (days) =>
        `We need about two months of history to read this from your data; there are ${days} days so far. Please fill it in yourself.`,
      amountLabel: "Amount per month in euros",
      sections: {
        income: "Income",
        housing: "Home",
        fixed: "Fixed costs and subscriptions",
        debts: "Debts",
        savings: "Savings",
        children: "Children",
      },
      sentences: {
        incomeRegular: (l, a) => `You receive about ${a} a month from ${l}.`,
        incomeIrregular: (l, a) =>
          `${l} pays you about ${a} a month on average, but not on a fixed rhythm.`,
        housing: (k, c, a) => `You pay ${a} a month for ${k} to ${c}.`,
        housingKinds: { huur: "rent", hypotheek: "your mortgage", wonen: "housing" },
        fixedStream: (l, a) => `${l} costs you about ${a} a month.`,
        fixedSubscription: (l, a) => `Your subscription ${l} costs about ${a} a month.`,
        debtStream: (l, a) => `You repay ${l} about ${a} a month.`,
        debtCard: (l, b) => `Your credit card ${l} carries a balance of ${b}.`,
        savings: (a) => `Your savings accounts add up to ${a}.`,
        savingsExcluded: (n) => `${n} savings account(s) in a foreign currency are not counted.`,
      },
      child: {
        kinderbijslag: "We saw child benefit payments.",
        childcare: "We saw payments to childcare.",
        question: "Do you have children?",
        yesNote: "You give the number and birth years next.",
        noNote: "Noted: no children.",
      },
      stated: {
        incomeTitle: "Your income",
        incomeQuestion: "Roughly how much do you take home each month, in total?",
        spendTitle: "Your spending",
        spendQuestion: "Roughly how much do you spend each month, everything included?",
        housingTitle: "Your home",
        housingQuestion: "Do you rent or own, and what does it cost each month?",
        housingKinds: { rent: "Rent", mortgage: "Mortgage", other: "Other" },
        savingsTitle: "Your savings",
        savingsQuestion: "Roughly how much sits in your savings accounts?",
        rangeError: "Enter a lowest and a highest amount; the first is not above the second.",
        amountError: "Enter an amount of zero or more.",
        saved: (s) => `Saved: ${s}`,
        range: (l, h) => `between ${l} and ${h}`,
      },
      continueToRoom: "Show my room",
    },
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
        resumeStep: {
          step0: "You started on providing your data.",
          block1: "Your data is in; there are proposals left for you to confirm.",
          block2: "Your room is worked out. The questions about your situation are still open.",
          block3: "Only the last questions are still open.",
        },
        riskDue:
          "It is time to look at your answers about risk again; your other answers stay as they are.",
      },
      room: {
        title: "Your room each month",
        open: "Change your answers",
        importLink: "Go to import and linking",
      },
    },
    block2: {
      title: "What data cannot show",
      intro: "A few questions about your situation. Each answer is saved straight away.",
      household: {
        title: "Household",
        alone: "I live alone",
        together: "I live with a partner",
        partnerIncome: "My partner's income belongs in my numbers",
      },
      children: {
        title: "Children",
        intro: "The number and birth year of each child. We do not need names.",
        saidYes: "You said earlier that you have children.",
        birthYear: "Birth year",
        add: "Add child",
        item: (y) => `Child, born in ${y}`,
        none: "No children noted yet.",
      },
      goals: {
        title: "Goals",
        intro:
          "Each goal is its own bucket: what for, how much, by when, and what happens if it is missed.",
        purpose: "What it is for",
        kind: "Kind",
        kinds: { general: "General", child: "For a child" },
        child: "Child",
        target: "Target amount in euros",
        date: "Target date",
        priority: "If it is missed",
        priorities: {
          flexible: "Flexible, it can slip",
          important: "Important",
          must: "Essential",
        },
        planned: "Planned monthly amount (optional)",
        add: "Add goal",
        empty: "No goals yet.",
        item: (p, a, d, pr) => `${p}: ${a} by ${d} (${pr})`,
        error:
          "Fill in what it is for, an amount above zero and a date; pick a child for a child goal.",
      },
      debts: {
        title: "Debts outside your linked accounts",
        intro: "A student loan we cannot see, a mortgage at another bank, a private loan.",
        lender: "Owed to",
        monthly: "Repayment per month in euros",
        balance: "Amount outstanding in euros (optional)",
        rate: "Interest rate in percent (optional)",
        add: "Add debt",
        empty: "No extra debts noted.",
        item: (l, m) => `${l}: ${m} a month`,
        error: "Fill in who it is owed to and a repayment of zero or more.",
      },
      buffer: {
        title: "Buffer",
        intro: "How many months of fixed costs do you want to keep as a buffer?",
        option: (m) => `${m} months`,
        unset: "Pick a number",
      },
    },
    block3: {
      title: "Risk and knowledge",
      intro: "Questions about how you would act and what you already know. No answer is wrong.",
      risk: {
        title: "How you handle a loss",
        intro: "For each question, pick what is closest to you.",
        scaleNote: "LaVega's own draft questions, not yet matched to a published scale.",
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
        title: "What you already know",
        intro: "Three short questions.",
        items: {
          interest: {
            prompt: (m) =>
              `You have ${m(100)} in a savings account at 2 percent interest a year. How much do you have after 5 years?`,
            options: {
              "more-than-102": "More than 102 euros",
              "exactly-102": "Exactly 102 euros",
              "less-than-102": "Less than 102 euros",
            },
          },
          inflation: {
            prompt: () =>
              "Your savings rate is 1 percent a year and inflation is 2 percent. After a year, what will that money be able to pay for compared with today?",
            options: {
              "buy-less": "Less than today",
              "buy-same": "The same as today",
              "buy-more": "More than today",
            },
          },
          diversification: {
            prompt: () =>
              "You spread your money over many different investments instead of one company. What changes for the risk?",
            options: {
              "lower-risk": "The risk is lower",
              "higher-risk": "The risk is higher",
              "no-difference": "Nothing changes",
            },
          },
        },
        invested: {
          prompt: "Have you invested before, for example in shares, funds or crypto?",
          yes: "Yes",
          no: "No",
        },
      },
      worries: {
        title: "What worries you",
        prompt: "What worries you most about money right now?",
        hint: "Optional. Stays in your vault exactly as you write it.",
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
      finish: "Finish",
      needMore: "Answer the knowledge questions and whether you have invested before to finish.",
    },
    done: {
      title: "Your profile is in place",
      body: "You can change anything later. What LaVega knows about you stays in your own vault.",
      toOverview: "To the overview",
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
