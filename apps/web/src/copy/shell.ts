import type { Locale } from "../locale.js";
import type { View } from "../App.js";
import type { ModuleId, WidgetId } from "../components/moduleRegistry.js";
import type { SignInFailure } from "../authClient.js";
import type { ImportProblem } from "@lavega/core";
import type { ShellNotice } from "../shellNotice.js";

/**
 * Every word the vault app's chrome shows, in both languages: TopBar, NavBar,
 * VaultGate, Overzicht, Import, Profiel and ModulePicker — the files this
 * copy module belongs to.
 *
 * One shape, two values, so a string added to Dutch and forgotten in English
 * is a type error rather than a blank on the screen. The English is not a
 * literal translation: it reads as though written for an English speaker,
 * while keeping the Dutch/legal terms (BTW, zzp, DGA, IBAN, SEPA, iDEAL) that
 * do not translate.
 *
 * `nav.moduleLabels` exists so NavBar's own tab text can switch language
 * without touching `moduleRegistry.tsx`'s `MODULES`/`WIDGETS`; `modulePicker`
 * does the same for `ModulePicker.tsx`'s Add-widget panel, which no longer
 * reads `label`/`what`/`note` off `MODULES`/`WIDGETS` directly. Those two
 * arrays keep their own Dutch `label`/`what`/`note` fields untouched — other,
 * not-owned-here call sites (aria-labels on the widget blocks themselves,
 * `ModulePicker.test.tsx`'s Dutch-default assertions) still read them — this
 * module only supplies the words ModulePicker itself renders, keyed by
 * `ModuleId`/`WidgetId` so a module added to the registry without a matching
 * entry here is a type error rather than a blank row.
 */
export type ShellCopy = {
  /** The Persoonlijk/Zakelijk (personal/business) entity scope — shared by
   *  TopBar's switch and Profiel's per-entity classifier, the two places that
   *  render the same two words. */
  scope: { personal: string; business: string };
  /** De uitleg onder een leeg scherm: de helft waar je in staat heeft geen
   *  rekeningen. Opgeknipt omdat de schakelaarnaam vet staat en er een link
   *  achteraan komt. */
  emptyScope: { before: string; after: string; linkLabel: string };
  topBar: {
    viewTitles: Record<View, string>;
    scopeGroupLabel: string;
    addWidget: string;
  };
  nav: {
    ariaLabel: string;
    investing: string;
    profile: string;
    moduleLabels: Record<ModuleId, string>;
  };
  modulePicker: {
    homeNote: string;
    moduleSwitchLabel: (label: string) => string;
    widgetSwitchLabel: (label: string) => string;
    modules: Record<ModuleId, string>;
    widgets: Record<WidgetId, { label: string; what: string; note?: string }>;
  };
  vaultGate: {
    loading: string;
    dataLossWarning: string;
    passwordLabel: string;
    repeatPasswordLabel: string;
    mismatch: string;
    passwordProblem: {
      tooShort: (min: number) => string;
      lowVariation: string;
    };
    understood: string;
    unlock: {
      title: string;
      wrongPassword: string;
      submit: string;
    };
    setup: {
      title: string;
      submit: string;
      haveBackupQuestion: string;
      restoreFromBackup: string;
    };
    restoreOnSetup: {
      title: string;
      intro: string;
      fileLabel: string;
      submit: string;
      restoreError: string;
      back: string;
    };
    migrate: {
      intro: string;
      title: string;
      submitIdle: string;
      submitBusy: string;
      done: {
        title: string;
        body: string;
        warning: string;
        backupNow: string;
        later: string;
      };
      /** De kluis liet zich niet teruglezen; de plaintext is bewaard. */
      verifyFailed: string;
      /** Iets anders ging mis. `detail` is de onvertaalde tekst van de
       *  uitzondering — die verzinnen we hier niet opnieuw. */
      failed: (detail: string) => string;
    };
  };
  /** De eenmalige instelstap na een verse kluis. */
  onboarding: {
    ariaLabel: string;
    title: string;
    intro: string;
    languageLabel: string;
    firstNameLabel: string;
    lastNameLabel: string;
    nameNote: string;
    countryLabel: string;
    countryHint: string;
    regionPlaceholder: string;
    scopeLabel: string;
    scopeHint: string;
    submit: string;
    skip: string;
  };
  overzicht: { gridLabel: string };
  import: {
    ariaLabel: string;
    heading: string;
    entityLabel: string;
    fileInputAriaLabel: string;
    /** Wat er mis was met het bestand, uit core's `ImportProblem`. Een
     *  exhaustive switch en geen Record, omdat twee kinds een eigen feit
     *  dragen dat in de zin hoort. */
    problem: (p: ImportProblem) => string;
  };
  /** De meldingsbalk bovenin, uit `shellNotice.ts`. */
  notice: (n: ShellNotice) => string;
  profiel: {
    languageSwitch: { cardLabel: string; nl: string; en: string; ariaLabel: string };
    account: {
      ariaLabel: string;
      heading: string;
      unconfigured: string;
      signedOutIntro: string;
      emailLabel: string;
      passwordLabel: string;
      signIn: string;
      signOut: string;
      /** Waarom het inloggen niet doorging, per kind uit `authClient`. */
      signInError: Record<SignInFailure, string>;
    };
    head: {
      ariaLabel: string;
      noName: string;
      note: string;
      firstName: string;
      lastName: string;
    };
    modules: {
      ariaLabel: string;
      heading: string;
      countSuffix: string;
      description: string;
    };
    widgets: {
      ariaLabel: string;
      heading: string;
      of: string;
      on: string;
      description: string;
    };
    scopeSection: {
      ariaLabel: string;
      heading: string;
      unitSingular: string;
      unitPlural: string;
      description: string;
      noAccounts: string;
      accountSingular: string;
      accountPlural: string;
      unclassifiedPrefix: string;
      nameReadsAsPrefix: string;
      groupAriaLabelSuffix: string;
    };
    countryRegion: {
      ariaLabel: string;
      heading: string;
      purpose: string;
      neverInferred: string;
      countryLabel: string;
      chooseOrType: string;
      optional: string;
      knownListNotePrefix: string;
      knownListNoteSuffix: string;
      noListNotePrefix: string;
      noListNoteSuffix: string;
    };
    fx: {
      ariaLabel: string;
      heading: string;
      convertLabel: string;
      description: string;
    };
    lock: {
      ariaLabel: string;
      heading: string;
      description: string;
      button: string;
    };
    cashback: {
      ariaLabel: string;
      heading: string;
      cardSingular: string;
      cardPlural: string;
      intro: string;
      privacyNote: string;
      zeroNoteBefore: string;
      zeroNoteBold: string;
      zeroNoteAfter: string;
      assumptionLabel: string;
      assumptionOnStatus: string;
      assumptionOffStatus: string;
      loadProblemPrefix: string;
      loadProblemSuffix: string;
      loading: string;
      empty: string;
      dueSuffix: string;
      namesSuffixPrefix: string;
      namesSuffixSuffix: string;
      cashbackInputAriaLabelPrefix: string;
      save: string;
      clearCorrection: string;
      emptyPercentPrefix: string;
      emptyPercentSuffix: string;
      saveFailedPrefix: string;
      clearFailedPrefix: string;
      savedPrefix: string;
    };
  };
};

const nl: ShellCopy = {
  scope: { personal: "Persoonlijk", business: "Zakelijk" },
  emptyScope: {
    before: "Geen rekeningen staan als ",
    after: " ingesteld — daarom is dit scherm leeg. Zet dat per rekening bij ",
    linkLabel: "Rekeningen",
  },
  topBar: {
    viewTitles: {
      overview: "Overzicht",
      transactions: "Transacties",
      accounts: "Rekeningen",
      rules: "Regels",
      forecast: "Forecast",
      optimalisatie: "Optimalisatie",
      valuta: "Valuta",
      belasting: "Belasting",
      facturen: "Facturen",
      punten: "Punten",
      koppelingen: "Koppelingen",
      backup: "Back-up",
      profiel: "Profiel",
    },
    scopeGroupLabel: "Persoonlijk of zakelijk",
    addWidget: "Widget toevoegen",
  },
  nav: {
    ariaLabel: "Weergaven",
    investing: "Investing",
    profile: "Profiel",
    moduleLabels: {
      overview: "Overzicht",
      accounts: "Rekeningen",
      transactions: "Transacties",
      forecast: "Forecast",
      optimalisatie: "Optimalisatie",
      valuta: "Valuta",
      punten: "Punten",
      belasting: "Belasting",
      facturen: "Facturen",
    },
  },
  modulePicker: {
    homeNote: "Je startpagina — staat altijd in de navigatie.",
    moduleSwitchLabel: (label) => `${label} in de navigatie`,
    widgetSwitchLabel: (label) => `${label} op je overzicht`,
    modules: {
      overview: "Je startpagina: totaalpositie, cashflow, aandachtspunten en statistieken.",
      accounts: "Al je rekeningen en kaarten, per bank en per bedrijf, met hun saldo.",
      transactions:
        "Al je transacties in één lijst, met filters op periode, rekening en categorie.",
      forecast: "Wat er de komende 30, 60 en 90 dagen binnenkomt en uitgaat.",
      optimalisatie: "Abonnementen die je kunt opzeggen en spaarrentes die meer opleveren.",
      valuta: "De beste route om geld om te wisselen, met de live ECB-koers.",
      punten: "Je spaarpunten en airmiles op één plek, met de regels van elk programma.",
      belasting: "Btw opzijzetten per bedrijf, met de eerstvolgende aangiftedatum.",
      facturen: "Facturen die nog open staan, en wanneer ze binnen zouden moeten komen.",
    },
    widgets: {
      aandacht: {
        label: "Aandacht",
        what: "Een brede balk bovenaan met wat er misgaat: tekorten, gemiste betalingen, deadlines.",
      },
      positie: {
        label: "Positie",
        what: "Een kleine kaart met de verdeling van je geld over je bedrijven.",
      },
      betaalagenda: {
        label: "Betaalagenda",
        what: "Wat er als eerste af moet: geplande bedragen en herkende vaste lasten, met hun datum.",
        note: "Deze stond al op je overzicht — hier zet je hem uit.",
      },
      "facturen-open": {
        label: "Facturen",
        what: "Hoeveel facturen er open staan, voor welk bedrag, en wat er over de vervaldatum heen is.",
        note: "Staat standaard uit — zet hem aan als je hem op je overzicht wilt.",
      },
      "btw-stand": {
        label: "BTW",
        what: "Wat je deze aangifteperiode te betalen of terug te vragen hebt, en tot wanneer je hebt.",
        note: "Deze kaart staat standaard op je overzicht — hier zet je hem uit.",
      },
    },
  },
  vaultGate: {
    loading: "Laden…",
    dataLossWarning:
      'Wachtwoord kwijt = data kwijt — geen herstel. Er is geen "wachtwoord vergeten"-optie.',
    passwordLabel: "Wachtwoord",
    repeatPasswordLabel: "Herhaal wachtwoord",
    mismatch: "Wachtwoorden komen niet overeen.",
    passwordProblem: {
      tooShort: (min) =>
        `Gebruik minstens ${min} tekens — je kluis-back-up kan offline onbeperkt geraden worden.`,
      lowVariation:
        "Te weinig variatie — gebruik meer verschillende tekens, bijvoorbeeld een zin van een paar woorden.",
    },
    understood: "Ik begrijp dit",
    unlock: {
      title: "Kluis ontgrendelen",
      wrongPassword: "Onjuist wachtwoord.",
      submit: "Ontgrendelen",
    },
    setup: {
      title: "Kluis instellen",
      submit: "Kluis aanmaken",
      haveBackupQuestion: "Heb je al een back-up?",
      restoreFromBackup: "Herstel uit back-up",
    },
    restoreOnSetup: {
      title: "Herstel uit back-up",
      intro: "Kies je back-upbestand (.lavega) en vul het bijbehorende wachtwoord in.",
      fileLabel: "Back-upbestand",
      submit: "Herstellen",
      restoreError: "Onjuist wachtwoord of ongeldig back-upbestand.",
      back: "Terug",
    },
    migrate: {
      intro: "Je bestaande data wordt versleuteld en verplaatst naar de kluis.",
      title: "Bestaande data versleutelen",
      submitIdle: "Versleutelen & doorgaan",
      submitBusy: "Bezig met versleutelen…",
      done: {
        title: "Migratie geslaagd",
        body: "Je bestaande data is versleuteld opgeslagen in de kluis.",
        warning:
          "Maak nu meteen een back-up. Bij een vergeten wachtwoord is je data zonder back-up onherstelbaar verloren.",
        backupNow: "Maak nu een back-up",
        later: "Later, naar de app",
      },
      verifyFailed:
        "De kluis liet zich niet teruglezen, dus je onversleutelde data is bewaard gebleven. Er is niets verwijderd — probeer het opnieuw.",
      failed: (detail) => `Versleutelen mislukt: ${detail}`,
    },
  },
  onboarding: {
    ariaLabel: "Eerste instellingen",
    title: "Even instellen",
    intro:
      "Vier vragen, en LaVega rekent meteen met de juiste regels. Je kunt alles later wijzigen bij Profiel.",
    languageLabel: "Taal",
    firstNameLabel: "Voornaam",
    lastNameLabel: "Achternaam",
    nameNote:
      "Je naam blijft in deze browser — niet in de kluis, niet in een back-up, en hij wordt nooit naar een model gestuurd.",
    countryLabel: "Land",
    countryHint:
      "Bepaalt welke belastingregels LaVega gebruikt. Voor een land zonder regels rekent LaVega geen belasting uit en zegt dat erbij.",
    regionPlaceholder: "optioneel",
    scopeLabel: "Waar open je op?",
    scopeHint:
      "De schakelaar bovenin toont één helft van je geld. Dit is de helft waar de app op start; je kunt altijd wisselen.",
    submit: "Klaar",
    skip: "Overslaan",
  },
  overzicht: { gridLabel: "Overzicht" },
  import: {
    ariaLabel: "Importeren",
    heading: "Importeren",
    entityLabel: "Entiteit",
    fileInputAriaLabel: "Kies een bankbestand om te importeren",
    problem: (p) => {
      switch (p.kind) {
        case "camt-not-supported":
          return "CAMT.053 wordt nog niet ondersteund.";
        case "spreadsheet-not-supported":
          return `Dit is een Excel-bestand (.${p.format}). LaVega leest CSV, MT940 en .STA — sla het in Excel op via Bestand → Opslaan als → CSV, of download het afschrift bij je bank als CSV.`;
        case "recognised-but-empty":
          return `Formaat herkend (${p.source}), maar er stonden geen transacties in.`;
        case "unrecognised":
          return "Onbekend of leeg bestand — geen transacties herkend.";
      }
    },
  },
  notice: (n) => {
    switch (n.kind) {
      case "import-problem":
        return nl.import.problem(n.problem);
      case "bank-link-failed":
        return `Bankkoppeling mislukt: ${n.detail}`;
      case "bank-linked":
        return `Bank gekoppeld: ${n.accounts} rekening${n.accounts === 1 ? "" : "en"}${n.aspsp ? ` via ${n.aspsp}` : ""}, ${n.txs} transactie${n.txs === 1 ? "" : "s"}.`;
      case "import-failed":
        return `Importeren mislukt: ${n.detail}`;
      case "terms-lookup-failed":
        return `Voorwaarden opzoeken mislukt: ${n.detail}`;
      case "bank-consent-expired":
        return `De toestemming voor ${n.aspsp} is verlopen — koppel de bank opnieuw om weer bij te werken.`;
      case "bank-nothing-to-refresh":
        return "Er is nog geen bankkoppeling om te verversen.";
    }
  },
  profiel: {
    languageSwitch: {
      cardLabel: "Taal / Language",
      nl: "Nederlands",
      en: "English",
      ariaLabel: "Taal / Language",
    },
    account: {
      ariaLabel: "Account",
      heading: "Account",
      unconfigured:
        "Deze installatie heeft geen serveraccount ingesteld, dus alles blijft lokaal in deze browser.",
      signedOutIntro: "Log in op de geconfigureerde LaVega-server om de bankkoppeling te testen.",
      emailLabel: "E-mailadres",
      passwordLabel: "Wachtwoord",
      signIn: "Inloggen",
      signOut: "Uitloggen",
      signInError: {
        "wrong-credentials": "Onjuist e-mailadres of wachtwoord.",
        unreachable: "Inloggen lukte niet. Probeer het later opnieuw.",
      },
    },
    head: {
      ariaLabel: "Profiel",
      noName: "Nog geen naam ingevuld",
      note: "Alleen voor dit scherm. Je naam blijft in deze browser — niet in de kluis, niet in een back-up, en hij wordt nooit meegestuurd naar een model.",
      firstName: "Voornaam",
      lastName: "Achternaam",
    },
    modules: {
      ariaLabel: "Modules",
      heading: "Modules",
      countSuffix: "in je navigatie",
      description:
        "Zet aan wat jij gebruikt. Wat aan staat verschijnt in de balk bovenin; wat uit staat verdwijnt daaruit — je gegevens blijven staan en je kunt het hier altijd weer aanzetten.",
    },
    widgets: {
      ariaLabel: "Widgets",
      heading: "Widgets op je overzicht",
      of: "van",
      on: "aan",
      description:
        "Deze twee kaarten staan uit tot je ze hier aanzet. Wat uit staat verschijnt niet op je startpagina — je gegevens blijven staan en je kunt het hier altijd weer aanzetten.",
    },
    scopeSection: {
      ariaLabel: "Persoonlijk of zakelijk",
      heading: "Persoonlijk of zakelijk",
      unitSingular: "eenheid",
      unitPlural: "eenheden",
      description:
        "De schakelaar bovenin toont één helft van je geld. Hier bepaal je zelf welke helft een bedrijf of rekening bij hoort. Wat je niet indeelt telt als persoonlijk — LaVega gokt dat nooit voor je.",
      noAccounts: "Nog geen rekeningen. Importeer er één, dan verschijnt hij hier.",
      accountSingular: "rekening",
      accountPlural: "rekeningen",
      unclassifiedPrefix: " · niet ingedeeld, telt als ",
      nameReadsAsPrefix: " · de naam leest als ",
      groupAriaLabelSuffix: "persoonlijk of zakelijk",
    },
    countryRegion: {
      ariaLabel: "Land en regio",
      heading: "Land en regio",
      purpose:
        "Bepaalt welke belastingregels LaVega gebruikt en in welke markt het de voorwaarden van je kaarten opzoekt. De belastingmodules zijn op dit moment alleen voor Nederland uitgewerkt.",
      neverInferred:
        "Je vult dit zelf in. LaVega leidt nooit af waar je bent — geen locatie, geen IP, geen tijdzone.",
      countryLabel: "Land",
      chooseOrType: "Kies of typ",
      optional: "Optioneel",
      knownListNotePrefix: "LaVega kent de lijst voor ",
      knownListNoteSuffix: "; je mag ook zelf iets intypen.",
      noListNotePrefix: "Voor ",
      noListNoteSuffix:
        " heeft LaVega geen geverifieerde regiolijst — typ hem zelf, of laat hem leeg.",
    },
    fx: {
      ariaLabel: "Vreemde valuta",
      heading: "Vreemde valuta",
      convertLabel: "Vreemde valuta omrekenen naar euro",
      description:
        "Rekeningen en transacties in een andere valuta dan euro tellen mee in de totalen, omgerekend via de ECB-koers van de dag. Zet dit uit om ze zoals voorheen apart te houden.",
    },
    lock: {
      ariaLabel: "Vergrendelen",
      heading: "Vergrendelen",
      description:
        "Sluit de kluis en wist alles uit het geheugen van deze browser. Je hebt je wachtwoord nodig om weer binnen te komen.",
      button: "Vergrendel",
    },
    cashback: {
      ariaLabel: "Cashback corrigeren",
      heading: "Cashback corrigeren",
      cardSingular: "kaart",
      cardPlural: "kaarten",
      intro:
        "Bij een gewone Nederlandse betaalpas of grootbankcreditcard neemt LaVega aan dat er geen cashback is. Dat is een aanname van ons en geen zin uit een document, dus je kunt hem hier terugdraaien: vul het percentage in dat jouw kaart echt geeft. Wat jij invult gaat vóór alles wat LaVega zelf vindt, ook na een volgende zoekopdracht.",
      privacyNote:
        "Er gaat niets naar een server. Je correctie blijft in je eigen kluis, op dit apparaat.",
      zeroNoteBefore: "Weet je zeker dat een kaart niets teruggeeft? Vul dan ",
      zeroNoteBold: "0",
      zeroNoteAfter:
        " in. Dat is geen aanname meer maar jouw eigen vaststelling, en die blijft staan ook als je de aanname hieronder uitzet.",
      assumptionLabel: "Neem aan dat een gewone kaart geen cashback geeft",
      assumptionOnStatus:
        "Staat aan. Zet hem uit om te zien wat er overblijft als LaVega alleen toont wat het echt gelezen heeft — dan staat er bij deze kaarten weer “onbekend”.",
      assumptionOffStatus:
        "Staat uit. Bij kaarten zonder gelezen cijfer staat nu “onbekend” in plaats van nul, en de vergelijking op Optimalisatie kan daar geen bedrag bij noemen.",
      loadProblemPrefix: "LaVega kon je rekeningen niet uit de kluis lezen: ",
      loadProblemSuffix: ". Zonder die lijst is er niets om te corrigeren.",
      loading: "Bezig met lezen uit je kluis…",
      empty:
        "Nog geen betaalrekening of creditcard in je kluis. Importeer er één, dan verschijnt hij hier.",
      dueSuffix: " · een jaar of langer niet nagekeken",
      namesSuffixPrefix: " · geldt voor ",
      namesSuffixSuffix: " rekeningen",
      cashbackInputAriaLabelPrefix: "Cashback",
      save: "Opslaan",
      clearCorrection: "Wis mijn correctie",
      emptyPercentPrefix: "Vul eerst een percentage in bij ",
      emptyPercentSuffix: ".",
      saveFailedPrefix: "Opslaan in de kluis lukte niet: ",
      clearFailedPrefix: "Wissen lukte niet: ",
      savedPrefix: "Opgeslagen voor ",
    },
  },
};

const en: ShellCopy = {
  scope: { personal: "Personal", business: "Business" },
  emptyScope: {
    before: "No accounts are set as ",
    after: " — that's why this screen is empty. Set it per account under ",
    linkLabel: "Accounts",
  },
  topBar: {
    viewTitles: {
      overview: "Overview",
      transactions: "Transactions",
      accounts: "Accounts",
      rules: "Rules",
      forecast: "Forecast",
      optimalisatie: "Optimise",
      valuta: "Currency",
      belasting: "Tax",
      facturen: "Invoices",
      punten: "Points",
      koppelingen: "Connections",
      backup: "Backup",
      profiel: "Profile",
    },
    scopeGroupLabel: "Personal or business",
    addWidget: "Add widget",
  },
  nav: {
    ariaLabel: "Views",
    investing: "Investing",
    profile: "Profile",
    moduleLabels: {
      overview: "Overview",
      accounts: "Accounts",
      transactions: "Transactions",
      forecast: "Forecast",
      optimalisatie: "Optimise",
      valuta: "Currency",
      punten: "Points",
      belasting: "Tax",
      facturen: "Invoices",
    },
  },
  modulePicker: {
    homeNote: "Your homepage — always in the navigation.",
    moduleSwitchLabel: (label) => `${label} in the navigation`,
    widgetSwitchLabel: (label) => `${label} on your overview`,
    modules: {
      overview: "Your homepage: total position, cash flow, things to watch, and statistics.",
      accounts: "All your accounts and cards, by bank and by company, with their balance.",
      transactions:
        "All your transactions in one list, with filters for period, account and category.",
      forecast: "What's coming in and going out over the next 30, 60 and 90 days.",
      optimalisatie: "Subscriptions you can cancel and savings rates that pay more.",
      valuta: "The best route to exchange money, with the live ECB rate.",
      punten: "Your reward points and air miles in one place, with each program's rules.",
      belasting: "Setting aside VAT per company, with the next filing deadline.",
      facturen: "Invoices still outstanding, and when they should come in.",
    },
    widgets: {
      aandacht: {
        label: "Attention",
        what: "A wide bar at the top with what needs attention: shortfalls, missed payments, deadlines.",
      },
      positie: {
        label: "Position",
        what: "A small card with how your money is split across your companies.",
      },
      betaalagenda: {
        label: "Payment schedule",
        what: "What's due first: planned amounts and recognised fixed costs, with their date.",
        note: "This was already on your overview — here you switch it off.",
      },
      "facturen-open": {
        label: "Invoices",
        what: "How many invoices are outstanding, for what amount, and what's overdue.",
        note: "Off by default — switch it on if you want it on your overview.",
      },
      "btw-stand": {
        label: "VAT",
        what: "What you owe or can reclaim this filing period, and by when.",
        note: "This card is on your overview by default — here you switch it off.",
      },
    },
  },
  vaultGate: {
    loading: "Loading…",
    dataLossWarning:
      'Lose the password, lose the data — there is no recovery. There is no "forgot password" option.',
    passwordLabel: "Password",
    repeatPasswordLabel: "Repeat password",
    mismatch: "Passwords don't match.",
    passwordProblem: {
      tooShort: (min) =>
        `Use at least ${min} characters — your vault backup can be guessed offline without limit.`,
      lowVariation:
        "Too little variation — use more different characters, for example a short phrase of a few words.",
    },
    understood: "I understand",
    unlock: {
      title: "Unlock vault",
      wrongPassword: "Wrong password.",
      submit: "Unlock",
    },
    setup: {
      title: "Set up vault",
      submit: "Create vault",
      haveBackupQuestion: "Already have a backup?",
      restoreFromBackup: "Restore from backup",
    },
    restoreOnSetup: {
      title: "Restore from backup",
      intro: "Choose your backup file (.lavega) and enter its password.",
      fileLabel: "Backup file",
      submit: "Restore",
      restoreError: "Wrong password or an invalid backup file.",
      back: "Back",
    },
    migrate: {
      intro: "Your existing data will be encrypted and moved into the vault.",
      title: "Encrypt existing data",
      submitIdle: "Encrypt & continue",
      submitBusy: "Encrypting…",
      done: {
        title: "Migration complete",
        body: "Your existing data is now encrypted and stored in the vault.",
        warning:
          "Make a backup right now. If you forget your password, data with no backup is gone for good.",
        backupNow: "Make a backup now",
        later: "Later, go to the app",
      },
      verifyFailed:
        "The vault would not read back, so your unencrypted data has been kept. Nothing was deleted — please try again.",
      failed: (detail) => `Encrypting failed: ${detail}`,
    },
  },
  onboarding: {
    ariaLabel: "First settings",
    title: "Let's set up",
    intro:
      "Four questions, and LaVega works with the right rules straight away. You can change all of it later under Profile.",
    languageLabel: "Language",
    firstNameLabel: "First name",
    lastNameLabel: "Last name",
    nameNote:
      "Your name stays in this browser — never in the vault, never in a backup, and never sent to a model.",
    countryLabel: "Country",
    countryHint:
      "Decides which tax rules LaVega uses. For a country it has no rules for, LaVega works out no tax and says so.",
    regionPlaceholder: "optional",
    scopeLabel: "Which half do you open on?",
    scopeHint:
      "The switch at the top shows one half of your money. This is the half the app starts on; you can always flip it.",
    submit: "Done",
    skip: "Skip",
  },
  overzicht: { gridLabel: "Overview" },
  import: {
    ariaLabel: "Import",
    heading: "Import",
    entityLabel: "Entity",
    fileInputAriaLabel: "Choose a bank file to import",
    problem: (p) => {
      switch (p.kind) {
        case "camt-not-supported":
          return "CAMT.053 isn't supported yet.";
        case "spreadsheet-not-supported":
          return `This is an Excel file (.${p.format}). LaVega reads CSV, MT940 and .STA — save it from Excel with File → Save As → CSV, or download the statement from your bank as CSV.`;
        case "recognised-but-empty":
          return `Format recognised (${p.source}), but it held no transactions.`;
        case "unrecognised":
          return "Unrecognised or empty file — no transactions found.";
      }
    },
  },
  notice: (n) => {
    switch (n.kind) {
      case "import-problem":
        return en.import.problem(n.problem);
      case "bank-link-failed":
        return `Bank connection failed: ${n.detail}`;
      case "bank-linked":
        return `Bank connected: ${n.accounts} account${n.accounts === 1 ? "" : "s"}${n.aspsp ? ` via ${n.aspsp}` : ""}, ${n.txs} transaction${n.txs === 1 ? "" : "s"}.`;
      case "import-failed":
        return `Import failed: ${n.detail}`;
      case "terms-lookup-failed":
        return `Looking up the terms failed: ${n.detail}`;
      case "bank-consent-expired":
        return `Your consent for ${n.aspsp} has expired — reconnect the bank to keep it up to date.`;
      case "bank-nothing-to-refresh":
        return "There's no bank connection to refresh yet.";
    }
  },
  profiel: {
    languageSwitch: {
      cardLabel: "Taal / Language",
      nl: "Nederlands",
      en: "English",
      ariaLabel: "Taal / Language",
    },
    account: {
      ariaLabel: "Account",
      heading: "Account",
      unconfigured:
        "This installation has no server account configured, so everything stays local to this browser.",
      signedOutIntro: "Sign in to the configured LaVega server to test the bank connection.",
      emailLabel: "Email address",
      passwordLabel: "Password",
      signIn: "Sign in",
      signOut: "Sign out",
      signInError: {
        "wrong-credentials": "Wrong email address or password.",
        unreachable: "Signing in didn't work. Please try again later.",
      },
    },
    head: {
      ariaLabel: "Profile",
      noName: "No name entered yet",
      note: "For this screen only. Your name stays in this browser — never in the vault, never in a backup, and never sent to a model.",
      firstName: "First name",
      lastName: "Last name",
    },
    modules: {
      ariaLabel: "Modules",
      heading: "Modules",
      countSuffix: "in your navigation",
      description:
        "Turn on what you use. What's on appears in the bar at the top; what's off disappears from it — your data stays put, and you can always switch it back on here.",
    },
    widgets: {
      ariaLabel: "Widgets",
      heading: "Widgets on your overview",
      of: "of",
      on: "on",
      description:
        "These two cards stay off until you switch them on here. What's off doesn't appear on your homepage — your data stays put, and you can always switch it back on here.",
    },
    scopeSection: {
      ariaLabel: "Personal or business",
      heading: "Personal or business",
      unitSingular: "unit",
      unitPlural: "units",
      description:
        "The switch at the top shows one half of your money. Here you decide which half a company or account belongs to. Anything you don't classify counts as personal — LaVega never guesses on your behalf.",
      noAccounts: "No accounts yet. Import one and it will show up here.",
      accountSingular: "account",
      accountPlural: "accounts",
      unclassifiedPrefix: " · unclassified, counts as ",
      nameReadsAsPrefix: " · the name reads as ",
      groupAriaLabelSuffix: "personal or business",
    },
    countryRegion: {
      ariaLabel: "Country and region",
      heading: "Country and region",
      purpose:
        "Determines which tax rules LaVega uses, and which market it looks up your card terms in. The tax modules are currently only built out for the Netherlands.",
      neverInferred:
        "You fill this in yourself. LaVega never infers where you are — no location, no IP, no time zone.",
      countryLabel: "Country",
      chooseOrType: "Choose or type",
      optional: "Optional",
      knownListNotePrefix: "LaVega has the list for ",
      knownListNoteSuffix: "; you're welcome to type your own too.",
      noListNotePrefix: "LaVega doesn't have a verified region list for ",
      noListNoteSuffix: " — type your own, or leave it blank.",
    },
    fx: {
      ariaLabel: "Foreign currency",
      heading: "Foreign currency",
      convertLabel: "Convert foreign currency to euros",
      description:
        "Accounts and transactions in a currency other than euros count toward the totals, converted at the day's ECB rate. Turn this off to keep them separate, as before.",
    },
    lock: {
      ariaLabel: "Lock",
      heading: "Lock",
      description:
        "Closes the vault and clears everything from this browser's memory. You'll need your password to get back in.",
      button: "Lock",
    },
    cashback: {
      ariaLabel: "Correct cashback",
      heading: "Correct cashback",
      cardSingular: "card",
      cardPlural: "cards",
      intro:
        "For an ordinary Dutch debit card or high-street credit card, LaVega assumes there's no cashback. That's an assumption of ours, not a line from a document, so you can override it here: enter the percentage your card actually pays. What you enter takes priority over anything LaVega finds on its own, even after a later lookup.",
      privacyNote:
        "Nothing is sent to a server. Your correction stays in your own vault, on this device.",
      zeroNoteBefore: "Sure a card pays nothing back? Then enter ",
      zeroNoteBold: "0",
      zeroNoteAfter:
        ". That's no longer an assumption but your own finding, and it stays in place even if you turn off the assumption below.",
      assumptionLabel: "Assume an ordinary card pays no cashback",
      assumptionOnStatus:
        "On. Turn it off to see what's left once LaVega only shows what it has actually read — these cards will then show “unknown” again.",
      assumptionOffStatus:
        "Off. Cards with no figure on record now show “unknown” instead of zero, and the comparison on Optimise can't put a number to them.",
      loadProblemPrefix: "LaVega couldn't read your accounts from the vault: ",
      loadProblemSuffix: ". Without that list, there's nothing to correct.",
      loading: "Reading from your vault…",
      empty: "No debit or credit card in your vault yet. Import one and it will show up here.",
      dueSuffix: " · not checked for a year or more",
      namesSuffixPrefix: " · applies to ",
      namesSuffixSuffix: " accounts",
      cashbackInputAriaLabelPrefix: "Cashback",
      save: "Save",
      clearCorrection: "Clear my correction",
      emptyPercentPrefix: "Enter a percentage for ",
      emptyPercentSuffix: " first.",
      saveFailedPrefix: "Saving to the vault didn't work: ",
      clearFailedPrefix: "Clearing didn't work: ",
      savedPrefix: "Saved for ",
    },
  },
};

export const shellCopy: Record<Locale, ShellCopy> = { nl, en };
