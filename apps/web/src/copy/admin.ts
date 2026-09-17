import type { Locale } from "../locale.js";
import type { InvoiceGap, SenderCheckDetail } from "../n8n.js";
// TaxSheetField is imported from core rather than locally redeclared, unlike
// VatNote/VatBasis/etc., because it is a closed vocabulary already defined
// once as TAX_SHEET_FIELDS in packages/core/src/agentFacts.ts — duplicating
// its six literal values here would drift silently if that list ever changes.
import type { TaxSheetField } from "@lavega/core";

/** SPF, DKIM and DMARC are called that in every language, so the parenthetical
 *  is built once rather than twice. */
const checkDetail = (c: SenderCheckDetail | null): string =>
  c ? ` (SPF ${c.spf}, DKIM ${c.dkim}, DMARC ${c.dmarc})` : "";

/* The Dutch wording is what the validation returned before it stopped carrying
 * prose, kept byte for byte. */
const nlGaps: Record<InvoiceGap, string> = {
  counterparty: "Vul een relatie in.",
  "issue-date": "Vul een factuurdatum in.",
  "due-date": "Vul een vervaldatum in — n8n vond er geen.",
  amount: "Vul een geldig bedrag in.",
  currency: "Vul de valuta in — n8n las er geen, en LaVega gokt geen euro's.",
  vat: "Btw-bedrag klopt niet.",
};

const enGaps: Record<InvoiceGap, string> = {
  counterparty: "Fill in a counterparty.",
  "issue-date": "Fill in an invoice date.",
  "due-date": "Fill in a due date — n8n found none.",
  amount: "Fill in a valid amount.",
  currency: "Fill in the currency — n8n read none, and LaVega does not assume euros.",
  vat: "That VAT amount isn't right.",
};

/** One inline run of text, optionally with the emphasis a caller renders as
 *  <em>/<strong>/<code>. Copy owns WHERE the emphasis falls, split at author
 *  time, so a reworded sentence can never silently lose it — the view renders
 *  spans positionally and never searches copy text for a substring. */
export type CopySpan = { text: string; mark?: "em" | "strong" | "code" };

/**
 * Every user-visible string in the admin screens (Facturen, Belasting,
 * Regels, Backup, Koppelingen), in Dutch and English.
 *
 * One nested type per screen, grouped by section the way landingCopy.ts
 * groups hero/device/faq, assembled under one `AdminCopy` and one
 * `Record<Locale, AdminCopy>` so a string added to Dutch and forgotten in
 * English is a type error rather than a blank on screen. Dutch values are
 * byte-identical to what was on screen before this module existed.
 */

type FacturenCopy = {
  head: { title: string; eyebrow: string };

  forms: {
    /** aria-label on the ModuleGrid wrapping all three "ways in". */
    sectionLabel: string;

    auto: {
      moduleTitle: string;
      /** "LaVega fetches ... every {minutes} minutes ..." */
      pullIntro: (minutes: number) => string;
      /** The eligibility explanation; wording depends on how many entities exist. */
      gateNote: (entityCount: number) => string;
      fetchButton: string;
      connectionsButton: string;
      pendingWarning: (n: number) => string;
    };

    drop: {
      moduleTitle: string;
      dropzoneAriaLabel: string;
      dropzoneTitle: string;
      dropzoneSub: string;
      fileInputAriaLabel: string;
      aiCheckboxAriaLabel: string;
      aiCheckboxLabel: string;
      aiHint: string;
    };

    manual: {
      moduleTitle: string;
      footer: string;
      entityLabel: string;
      entityAriaLabel: string;
      directionLabel: string;
      directionAriaLabel: string;
      counterpartyLabel: string;
      counterpartyAriaLabel: string;
      invoiceNumberLabel: string;
      invoiceNumberAriaLabel: string;
      issueDateLabel: string;
      issueDateAriaLabel: string;
      dueDateLabel: string;
      dueDateAriaLabel: string;
      amountLabel: string;
      amountAriaLabel: string;
      vatLabel: string;
      vatHint: string;
      vatAriaLabel: string;
      vatPlaceholder: string;
      currencyLabel: string;
      currencyAriaLabel: string;
      currencyPlaceholder: string;
      aiDraftBadge: string;
      addButton: string;
      discardDraftButton: string;
    };
  };

  /** Shared <option> labels for Invoice["direction"] — same enum, same two
   *  labels, rendered both in the manual form and in each n8n queue row. */
  /* `unset` is the option shown when neither party on the document matched one
   * of his own accounts or entities. It is a real state, not a placeholder:
   * until 17 Sep the extractor guessed "out" here and booked sales invoices as
   * costs. See invoiceParty.ts. */
  directionOptions: { out: string; in: string; unset: string };

  /** handleAdd()'s five refusal messages, in the order they're checked. */
  manualErrors: {
    missingCounterparty: string;
    missingDirection: string;
    missingIssueDate: string;
    missingDueDate: string;
    missingAmount: string;
    invalidCurrency: string;
  };

  /** Every string routed through setN8nNote — the fetch/confirm/reject/undo/
   *  dismiss status line rendered once, under "1 · Automatisch". */
  n8nNotices: {
    vaultNotLinked: string;
    fetching: string;
    notConfigured: string;
    unauthorized: (status: number) => string;
    httpError: (status: number) => string;
    network: string;
    unreadable: string;
    emptyQueue: string;
    nothingNew: string;
    fetched: (n: number) => string;
    autoBooked: (n: number) => string;
    alreadyStoredOne: string;
    alreadyStoredMany: (n: number) => string;
    waiting: (n: number) => string;
    duplicatesSkipped: (n: number) => string;
    dropped: (n: number) => string;
    noticesWaiting: (n: number) => string;
    confirmedDuplicate: (counterparty: string) => string;
    confirmedNew: (counterparty: string) => string;
    rejected: string;
    undone: string;
    noticeDismissed: string;
  };

  /** Every string routed through setImportNote (drag/drop CSV/UBL import,
   *  the PDF-without-AI-opt-in refusal, and the manual-entry duplicate). */
  importNotices: {
    duplicateManualEntry: string;
    noneRecognized: string;
    imported: (added: number, total: number) => string;
    noneNew: string;
    pdfNeedsAi: (filename: string) => string;
  };

  /** Every string routed through setAiNote (handleExtractPdf). */
  aiExtraction: {
    reading: string;
    extractFailedStatus: (status: number) => string;
    extractFailed: string;
    confidencePart: (pct: number) => string;
    /** amount is an already-formatted string (formatEuroIn), not a number. */
    vatPart: (formattedAmount: string) => string;
    noCurrencyPart: string;
    draftReady: (confidencePart: string, vatPart: string, noCurrencyPart: string) => string;
  };

  /** The "Te bevestigen" confirm-first n8n queue. */
  queue: {
    sectionAriaLabel: string;
    heading: string;
    eyebrow: (n: number) => string;
    /** Bold lead-in of the "only copy" warning. */
    warningLead: string;
    warningBody: (n: number) => string;
    mailSourcePrefix: string;
    /** Wraps a hold sentence, or an error string from core. */
    waitReason: (reason: string) => string;
    /** One per AutoBookHold kind. The engine in n8n.ts decides WHY a row waits;
     *  these say it. `incomplete` still embeds a Dutch string from core. */
    holds: {
      senderForwarded: (checks: SenderCheckDetail | null) => string;
      senderFailed: (checks: SenderCheckDetail | null) => string;
      senderUnchecked: string;
      entityAmbiguous: string;
      incomplete: (gap: InvoiceGap) => string;
      /** What each gap is, on its own, for the inline row error. */
      gaps: Record<InvoiceGap, string>;
      overCeiling: (ceilingCents: number) => string;
    };
    entityLabel: string;
    entityAriaLabel: string;
    directionLabel: string;
    directionAriaLabel: string;
    counterpartyLabel: string;
    counterpartyAriaLabel: string;
    invoiceNumberLabel: string;
    invoiceNumberAriaLabel: string;
    issueDateLabel: string;
    issueDateAriaLabel: string;
    dueDateLabel: string;
    dueDateAriaLabel: string;
    amountLabel: string;
    amountAriaLabel: string;
    currencyLabel: string;
    currencyAriaLabel: string;
    currencyPlaceholder: string;
    vatLabel: string;
    vatAriaLabel: string;
    vatPlaceholder: string;
    confirmButton: string;
    rejectButton: string;
    missingDueDateNote: string;
    missingCurrencyNote: string;
    missingVatNote: string;
  };

  /** "Zelf ophalen" — mail that was about an invoice but wasn't bookable. */
  notices: {
    /** One per N8nNotice["kind"]. Lived in n8n.ts as a Dutch-only record, which
     *  rendered Dutch straight onto the English screen. */
    kindLabels: { notification: string; reminder: string; "no-amount": string; unreadable: string };
    sectionAriaLabel: string;
    heading: string;
    eyebrow: (n: number) => string;
    introLead: string;
    /** The bold "geen bedrag" / "no amount" span in the middle of the intro. */
    introStrong: string;
    introTail: string;
    noSubjectFallback: string;
    openInGmail: string;
    noLinkFallback: string;
    doneButton: string;
  };

  /** "Openstaand en geboekt" — the invoice table. */
  list: {
    heading: string;
    /** Trailing space preserved to match the {" "} before the net-amount span. */
    eyebrowCount: (n: number) => string;
    sectionAriaLabel: string;
    empty: string;
    columns: {
      counterparty: string;
      company: string;
      direction: string;
      amount: string;
      dueDate: string;
      status: string;
    };
    directionBadge: { in: string; out: string };
    autoBadge: string;
    autoBadgeTitle: string;
    statusLabels: { expected: string; paid: string; cancelled: string };
    undoButton: string;
    markPaidButton: string;
    cancelButton: string;
    noActions: string;
  };
};

type Frequency = "monthly" | "quarterly" | "yearly";
type VatBasis = "manual" | "sheet" | "invoices" | "proxy";
type VatDirection = "betalen" | "terugvragen" | "onbekend";
type VatNote =
  | "gemengde-tarieven"
  | "stelsel-onbekend"
  | "kasstelsel"
  | "btw-onbekend-op-facturen"
  | "omzetfacturen-onbekend"
  | "voorbelasting-onbekend"
  | "boekhouding-andere-periode"
  | "geen-banktransacties";

export type BelastingCopy = {
  header: {
    /** "Belasting" — composed by the caller as `${title} · ${countryLabel}`. */
    title: string;
    /** "regels per" — composed by the caller as `${rulesAsOfPrefix} ${pack.rulesAsOf}`. */
    rulesAsOfPrefix: string;
    /** ToonMeer summary text next to the title. */
    caveatsSummary: string;
    /** The tax system in force, chosen here rather than inferred silently. */
    taxSystemLabel: string;
    taxSystemHint: string;
    /** Shown when the profile's country has no pack. Naming the country matters:
     *  the alternative is a screen that looks authoritative about a law it has
     *  never read. */
    unsupportedCountry: (country: string) => string;
    /** Shown instead of the whole screen when there are no entities at all. */
    entitiesEmpty: string;
    /** "1 belasting" / "2 belastingen" depending on whether the country pack has a profit-tax module. */
    taxCount: (n: 1 | 2) => string;
    /** aria-label on the <ModuleGrid> region wrapping the whole screen ("Belastingen"). */
    gridLabel: string;
    /** "Nederland"/"Duitsland" in nl, the English country names in en —
     *  replaces the raw (Dutch-only) `pack.label` the view used to render
     *  unlocalized as the page heading and inside the VAT footer sentence.
     *  Keyed by country rather than derived from taxpacks/*.ts because that
     *  package's `types.ts`/`index.ts` are owned by other work in flight and
     *  cannot be changed to make core return a locale-aware value; the NL
     *  side is guarded against drifting from taxpacks/nl.ts and de.ts by an
     *  equality assertion in belasting-ui.test.tsx. */
    countryLabel: { NL: string; DE: string };
    /** Localized copy of taxpacks/{nl,de}.ts's `pack.caveats`, for the same
     *  reason and under the same drift guard as `countryLabel` above. */
    caveatsByCountry: { NL: readonly string[]; DE: readonly string[] };
    /** Localized copy of `pack.profitTax.what` and `.rateBasis`. Only DE has a
     *  profit tax — taxpacks/nl.ts sets `profitTax: null` — so there is one
     *  entry, not a country map with a dead half. Same drift guard as above.
     *
     *  `pack.profitTax.label`/`settlementLabel` deliberately stay on the pack
     *  and are NOT mirrored here: "Vorauszahlung" and "Nachzahlung" are what
     *  the German tax authority calls these things, and translating a statutory
     *  term would be a worse answer in every language. */
    profitTaxDE: { what: string; rateBasis: string };
  };

  vat: {
    frequencyLabels: Record<Frequency, string>;
    /** What the figure was built from, in the reader's words. */
    basisLabels: Record<VatBasis, string>;
    /** Which way the money goes. */
    directionLabels: Record<VatDirection, string>;

    /** The module footer. `ratesList` is the already-formatted "21% / 9% / 0%" string. */
    footer: (p: { countryLabel: string; ratesList: string }) => string;
    /** Shown instead of a figure when the position is not known. */
    noAmount: string;

    /** The always-visible summary line: period, direction, deadline, stand-or-closed. */
    periodSummary: (p: {
      periodLabel: string;
      directionLabel: string;
      deadline: string;
      loopt: boolean;
      asOf: string;
    }) => string;

    /** Summary heading for the "where this figure comes from" details block. */
    detailsSummary: string;
    /** First line inside that details block: is the period still running or closed. */
    periodStatus: (p: {
      periodLabel: string;
      periodEnd: string;
      asOf: string;
      loopt: boolean;
    }) => string;

    /** "Bron: {basisLabel} · regels per {rulesAsOf}." */
    sourceLine: (p: { basisLabel: string; rulesAsOf: string }) => string;
    /** Appended directly after sourceLine when both charged and paid are known.
     *  Already carries its own leading space — do not add another. */
    sourceAmounts: (p: { chargedEuro: string; paidEuro: string }) => string;

    coverageLine: (p: { withVat: number; total: number }) => string;

    /** Full sentence covering how many invoices fall outside the period, the
     *  nearest one if any, and whether the period itself had zero invoices. */
    outsidePeriod: (p: { outside: number; nearestOutside: string | null; total: number }) => string;

    refundNotInForecast: string;
    /** "Met '<save button label>' staat dit bedrag op {deadline} in je forecast…" */
    willReserve: (deadline: string) => string;

    /** The eight VatNote branches. `missing` is `total - withVat`, precomputed by the caller. */
    notes: Record<VatNote, (p: { total: number; missing: number }) => string>;

    fields: {
      frequencyLabel: string;
      stelselLabel: string;
      stelselUnset: string;
      stelselFactuur: string;
      stelselKas: string;
      ratePctLabel: string;
      manualAmountLabel: string;
      manualAmountPlaceholder: string;
      mixedRatesLabel: string;
      sheetLabel: string;
    };

    /** What this tax is called to THIS reader. Dutch keeps the local name the
     *  authority uses (BTW, USt); English says VAT, which is what both are.
     *  Read from the copy rather than pack.vat.label, which is core data and
     *  correctly Dutch. */
    taxLabel: Record<"NL" | "DE", string>;
    /** aria-labels for the VAT field controls. `vatLabel` is pack.vat.label ("BTW"/"USt"), core data. */
    ariaLabels: {
      frequency: (vatLabel: string, entity: string) => string;
      stelsel: (entity: string) => string;
      ratePct: (vatLabel: string, entity: string) => string;
      manualAmount: (vatLabel: string, entity: string) => string;
      mixedRates: (entity: string) => string;
      sheetImport: (entity: string) => string;
    };

    /** Localized names for the six bookkeeping-sheet fields, in
     *  TAX_SHEET_FIELDS order — renders a TaxSheetProblem's "missing-columns"
     *  field list (packages/core/src/taxSheet.ts). */
    sheetFieldLabels: Record<TaxSheetField, string>;
    /** The two `TaxSheetProblem` kinds `readBookkeepingSheet` can report. */
    sheetProblem: {
      /** `fields` is already the joined, localized field-name list. */
      missingColumns: (fields: string) => string;
      undatedRows: (count: number) => string;
    };
    /** The line under the file picker once a bookkeeping CSV has been read. */
    sheetStatus: (p: {
      fileName: string;
      rowCount: number;
      isBasis: boolean;
      periodLabel: string;
      problemsText: string;
    }) => string;
  };

  profitTax: {
    /** Shown instead of a figure when there is nothing to prepay. */
    noAmount: string;
    estimateBadge: string;
    /** "Zodra het {authority} een bedrag oplegt…" — pass authorityDE or authorityOther. */
    nothingToReserve: (authority: string) => string;
    authorityDE: string;
    authorityOther: string;
    fields: {
      ratePctLabel: string;
      imposedAmountLabel: string;
      imposedAmountPlaceholder: string;
    };
    ariaLabels: {
      ratePct: (entity: string) => string;
      imposedAmount: (entity: string) => string;
    };
  };

  actions: {
    saveButton: string;
    savedNothing: string;
    savedSome: (count: number) => string;
  };
};

type RegelsCopy = {
  section: {
    /** aria-label on the <section> wrapping this screen. */
    ariaLabel: string;
    /** Visible <h2> heading. */
    heading: string;
  };
  intro: {
    /** First explainer paragraph: how automatic (built-in) categorization works. */
    autoCategorization: string;
    /** Second explainer paragraph: how a rule matches and which one wins.
     *  Segmented around the three emphasized words so the renderer can wrap
     *  them in <em>/<strong> directly instead of storing markup in a string. */
    matchingRules: {
      beforeMatchWord: string;
      matchWord: string;
      beforeFirstWord: string;
      firstWord: string;
      beforeUnknownWord: string;
      unknownWord: string;
      afterUnknownWord: string;
    };
  };
  form: {
    /** Label text for the match-text input. */
    matchLabel: string;
    /** Label text for the category input. */
    categoryLabel: string;
    /** Placeholder inside the category input (list-backed, free text allowed). */
    categoryPlaceholder: string;
    /** "Add rule" button text. */
    addButton: string;
  };
  /** Warning shown under the form when the typed category isn't in CATEGORY_OPTIONS. */
  newCategoryWarning: (typedCategory: string) => string;
  table: {
    /** Column header over the match column. */
    matchHeader: string;
    /** Column header over the category column. */
    categoryHeader: string;
    /** Per-row delete button text. */
    deleteButton: string;
    /** Shown instead of the table when there are no rules yet. */
    emptyState: string;
    /** Footnote under the table, shown only when there is more than one rule:
     *  explains the list is alphabetical for reading but match order (creation
     *  order) decides which rule wins. */
    sortNote: string;
  };
};

type BackupCopy = {
  title: string;
  ariaLabel: string;
  common: {
    busy: string;
  };
  download: {
    title: string;
    description: string;
    button: string;
  };
  server: {
    title: string;
    signedOut: string;
    noBackupYet: string;
    lastBackup: (date: string) => string;
    encryptionNote: string;
    backupNowButton: string;
    conflict: {
      message: (date: string) => string;
      overwriteButton: string;
    };
    success: string;
    errors: {
      locked: string;
      saveFailed: string;
    };
    restoreFromServer: {
      prompt: string;
      button: string;
    };
    erase: {
      button: string;
      warning: string;
      confirmButton: string;
      cancelButton: string;
      success: (rows: number, tables: number) => string;
      errorGeneric: string;
    };
  };
  restore: {
    title: string;
    warning: string;
    fileLabel: string;
    passwordLabel: string;
    confirmLabel: string;
    error: string;
    success: string;
    submitButton: string;
  };
};

type KoppelingenCopy = {
  forwardAddress: {
    /** <h2> */
    heading: string;
    /** .eyebrow under the heading */
    eyebrow: string;
    /** visible <label> text for the address input */
    addressLabel: string;
    addressPlaceholder: string;
    addressAriaLabel: string;
    /** shown when onBlur rejects the typed value; previous address kept */
    invalidError: string;
    /** shown only while no address exists yet; ends right before generateButton */
    emptyIntroPrefix: string;
    /** the inline button that calls ensureInvoiceForwardAddress() */
    generateButton: string;
    /** the "." that follows the button with no space */
    emptyIntroSuffix: string;
  };
  n8nLink: {
    /** <h2> */
    heading: string;
    /** .eyebrow text; a trailing space precedes the explain-eye icon */
    eyebrow: string;
    /** the cell-sub paragraph above the form, naming Production URL / Header Auth */
    intro: readonly CopySpan[];
    /** the eye-icon aria-label/title is "{explain.prefix} {subject}" */
    explain: {
      prefix: string;
      linkSubject: string;
      urlSubject: string;
      tokenSubject: string;
    };
    /** the three expandable InfoNote bodies, one per explain-eye */
    info: {
      /** array of paragraphs, each an array of spans */
      link: readonly (readonly CopySpan[])[];
      url: readonly CopySpan[];
      token: readonly CopySpan[];
    };
    form: {
      urlLabel: string;
      urlPlaceholder: string;
      urlAriaLabel: string;
      tokenLabel: string;
      tokenPlaceholder: string;
      tokenAriaLabel: string;
      /** visible text next to the "show token" checkbox */
      showTokenLabel: string;
      showTokenAriaLabel: string;
      saveButton: string;
      clearButton: string;
    };
    /** shown when the URL field is non-empty but doesn't start with http(s):// */
    urlWarning: string;
  };
  /** the transient <p className="cell-sub">{note}</p> messages from setNote() */
  status: {
    vaultReadFailed: string;
    notLinkedOnSave: string;
    saveFailed: string;
    savedComplete: string;
    savedIncomplete: string;
    notLinkedOnClear: string;
    clearFailed: string;
    cleared: string;
  };
};

export type AdminCopy = {
  facturen: FacturenCopy;
  belasting: BelastingCopy;
  regels: RegelsCopy;
  backup: BackupCopy;
  koppelingen: KoppelingenCopy;
};

const nlFacturen: FacturenCopy = {
  head: {
    title: "Drie manieren om een factuur binnen te krijgen",
    eyebrow: "alleen een geverifieerde afzender boekt zichzelf",
  },

  forms: {
    sectionLabel: "Facturen invoeren",

    auto: {
      moduleTitle: "1 · Automatisch",
      pullIntro: (minutes) =>
        `LaVega haalt de wachtrij van je eigen n8n op zodra dit scherm opent, en daarna elke ${minutes} minuten zolang je hier bent. De knop hieronder is voor een directe hercontrole.`,
      gateNote: (entityCount) => {
        const oneEntity = entityCount === 1 ? ", je hebt één onderneming" : "";
        const manyEntities =
          entityCount > 1
            ? " Je hebt meer dan één onderneming, dus kiest LaVega de BV nooit voor je: die keuze vraagt hij één keer, en tot die tijd boekt er hier niets automatisch."
            : "";
        return `Een factuur boekt zichzelf alleen als er niets meer te beslissen valt: de mail kwam via je doorstuuradres binnen én door de SPF/DKIM-controle${oneEntity}, en de factuur is compleet. Die krijgt het label “automatisch” en is met één klik terug te draaien. Al het andere wacht op jou, met de reden erbij — een niet-geverifieerde afzender boekt hier niets.${manyEntities}`;
      },
      fetchButton: "Ophalen uit n8n",
      connectionsButton: "Koppelingen instellen",
      pendingWarning: (n) =>
        `${n} ${n === 1 ? "regel wacht" : "regels wachten"} op je beslissing — zie hieronder.`,
    },

    drop: {
      moduleTitle: "2 · Slepen",
      dropzoneAriaLabel: "Factuurbestand hierheen slepen",
      dropzoneTitle: "Sleep een factuur hierheen",
      dropzoneSub: "PDF, CSV-export of UBL/EN-16931 XML. Of klik om te kiezen.",
      fileInputAriaLabel: "Factuurbestand kiezen",
      aiCheckboxAriaLabel: "AI-facturen lezen",
      aiCheckboxLabel: "AI-facturen lezen (PDF → Mistral)",
      aiHint:
        "Alleen met deze schakelaar aan gaat een PDF via onze server naar Mistral — dat ene document, en je bevestigt zelf voor het meetelt.",
    },

    manual: {
      moduleTitle: "3 · Handmatig",
      footer:
        "Een verwachte factuur verschijnt op de vervaldatum in Overzicht en Forecast en gaat zelf op “betaald” zodra een passende banktransactie binnenkomt.",
      entityLabel: "Entiteit",
      entityAriaLabel: "Entiteit",
      directionLabel: "Richting",
      directionAriaLabel: "Richting",
      counterpartyLabel: "Relatie",
      counterpartyAriaLabel: "Relatie",
      invoiceNumberLabel: "Factuurnr.",
      invoiceNumberAriaLabel: "Factuurnummer",
      issueDateLabel: "Factuurdatum",
      issueDateAriaLabel: "Factuurdatum",
      dueDateLabel: "Vervaldatum",
      dueDateAriaLabel: "Vervaldatum",
      amountLabel: "Bedrag",
      amountAriaLabel: "Bedrag",
      vatLabel: "Btw",
      vatHint: "(leeg = onbekend)",
      vatAriaLabel: "Btw",
      vatPlaceholder: "onbekend",
      currencyLabel: "Valuta",
      currencyAriaLabel: "Valuta",
      currencyPlaceholder: "onbekend",
      aiDraftBadge: "AI-concept",
      addButton: "Toevoegen",
      discardDraftButton: "Verwijder AI-concept",
    },
  },

  directionOptions: {
    out: "Uitgaand (inkoop)",
    in: "Inkomend (verkoop)",
    unset: "— kies zelf —",
  },

  manualErrors: {
    missingCounterparty: "Vul een relatie in.",
    missingDirection:
      "Kies of dit een inkoop- of verkoopfactuur is. LaVega kon het niet van de factuur aflezen.",
    missingIssueDate: "Vul een factuurdatum in.",
    missingDueDate: "Vul een vervaldatum in.",
    missingAmount: "Vul een geldig bedrag in — zonder bedrag wordt er niets geboekt.",
    invalidCurrency: "Vul de valuta in (3 letters) — LaVega gokt geen euro's.",
  },

  n8nNotices: {
    vaultNotLinked: "De kluis is nog niet gekoppeld aan dit scherm. Er is niets opgehaald.",
    fetching: "Bezig met ophalen…",
    notConfigured:
      "Nog niet ingesteld: vul eerst de webhook-URL en het token in onder Koppelingen. Er is niets opgehaald.",
    unauthorized: (status) =>
      `n8n weigerde het token (${status}). Er is niets opgehaald; de wachtrij in n8n staat er nog, want de workflow is niet eens gestart. Controleer het token onder Koppelingen.`,
    httpError: (status) =>
      `n8n antwoordde met status ${status}. Er is niets opgehaald. Staat de workflow aan?`,
    network:
      "Geen antwoord van n8n. Staat er in n8n óók geen uitvoering, dan is dit vrijwel zeker de CORS-controle: LaVega stuurt een tokenheader mee, dus de browser vraagt eerst toestemming met een OPTIONS-verzoek — en dat verzoek laat in n8n geen spoor na als de webhook deze pagina niet toestaat. Zet in de Webhook-node bij Allowed Origins (CORS) het adres van deze pagina, of * om het uit te proberen. Wil je eerst weten of de URL überhaupt leeft, plak hem dan met het token in een terminal met curl: dat verzoek gaat buiten de browser om en heeft dus geen CORS nodig. Hier is niets binnengekomen.",
    unreadable:
      "Het antwoord van n8n was niet te lezen. Er is niets overgenomen — en omdat de wachtrij bij het ophalen geleegd wordt, kan die rij verloren zijn. Kijk in n8n.",
    emptyQueue:
      "De wachtrij in n8n was leeg. Er is niets opgehaald — dat is geen bevestiging dat er facturen zijn.",
    nothingNew: "Niets nieuws: alles wat n8n stuurde was hier al afgehandeld.",
    fetched: (n) =>
      `${n} ${n === 1 ? "factuur" : "facturen"} opgehaald. n8n heeft de wachtrij hiermee geleegd.`,
    autoBooked: (n) =>
      `${n} daarvan ${n === 1 ? "is" : "zijn"} automatisch geboekt: de afzender kwam door de SPF/DKIM-controle en er stond alles in wat nodig is. Ze staan hieronder met “automatisch” erbij en zijn met één klik terug te draaien.`,
    alreadyStoredOne: "Eén ervan stond al in LaVega en is niet dubbel geboekt.",
    alreadyStoredMany: (n) => `${n} ervan stonden al in LaVega en zijn niet dubbel geboekt.`,
    waiting: (n) =>
      `${n} ${n === 1 ? "regel wacht" : "regels wachten"} op jou — bij elke regel staat waarom.`,
    duplicatesSkipped: (n) =>
      `${n} regel(s) kende LaVega al (zelfde messageId) en worden niet opnieuw aangeboden.`,
    dropped: (n) =>
      `${n} regel(s) misten een messageId of een bedrag en zijn niet overgenomen — die staan niet in LaVega en niet meer in n8n.`,
    noticesWaiting: (n) =>
      `${n} ${n === 1 ? "mail wacht" : "mails wachten"} onder “Zelf ophalen”: daar zat geen factuur in die LaVega kon boeken.`,
    confirmedDuplicate: (counterparty) =>
      `Deze factuur (${counterparty}) stond al in LaVega — regel afgevinkt, niets dubbel geboekt.`,
    confirmedNew: (counterparty) => `Factuur van ${counterparty} toegevoegd als verwacht.`,
    rejected: "Regel verworpen. Er is niets geboekt, en hij wordt niet opnieuw aangeboden.",
    undone:
      "Automatische boeking teruggedraaid: de factuur staat op geannuleerd en telt niet meer mee in de prognose.",
    noticeDismissed: "Melding afgevinkt. Er is niets geboekt.",
  },

  importNotices: {
    duplicateManualEntry: "Deze factuur staat er al.",
    noneRecognized: "Geen facturen herkend in dit bestand.",
    imported: (added, total) =>
      `${added} van ${total} facturen geïmporteerd${added !== total ? " (rest was al aanwezig)" : ""}.`,
    noneNew: "Geen nieuwe facturen (allemaal al aanwezig).",
    pdfNeedsAi: (filename) =>
      `"${filename}" is een PDF. Die kan alleen door de AI-lezer gelezen worden — zet hieronder "AI-facturen lezen" aan, of voer de factuur handmatig in. Er is niets verstuurd.`,
  },

  aiExtraction: {
    reading: "Bezig met lezen…",
    extractFailedStatus: (status) => `AI-extractie mislukt (${status}).`,
    extractFailed: "AI-extractie mislukt. Probeer het opnieuw.",
    confidencePart: (pct) => ` (AI-inschatting zekerheid ${pct}%)`,
    vatPart: (formattedAmount) => `, incl. btw ${formattedAmount}`,
    noCurrencyPart: " De valuta stond er niet in — vul hem zelf in.",
    draftReady: (confidencePart, vatPart, noCurrencyPart) =>
      `AI-concept — controleer elk veld en bevestig${confidencePart}${vatPart}.${noCurrencyPart}`,
  },

  queue: {
    sectionAriaLabel: "Te bevestigen facturen",
    heading: "Te bevestigen",
    eyebrow: (n) => `uit n8n · ${n}`,
    warningLead: "Let op — dit is de enige kopie.",
    warningBody: (n) =>
      ` n8n leegt zijn wachtrij op het moment dat hij antwoordt: nog eens ophalen levert deze ${n} ${n === 1 ? "regel" : "regels"} niet terug. Ook herladen of vergrendelen wist ze. Bevestig of verwerp ze nu.`,
    mailSourcePrefix: "Uit de mail:",
    waitReason: (reason) => `Wacht op jou: ${reason}`,
    holds: {
      senderForwarded: (c) =>
        `De afzender kwam niet door de SPF-controle${checkDetail(c)}, maar DKIM klopt wél — dat patroon hoort bij een DOORGESTUURDE mail en niet bij een nagemaakte afzender. Waarschijnlijk je eigen doorstuurregel. LaVega boekt hem toch niet zelf: dat de mail onderweg niet is veranderd, zegt niets over wie hem doorstuurde. Controleer de regel en bevestig hem zelf.`,
      senderFailed: (c) =>
        `De afzender kwam niet door de SPF/DKIM-controle${checkDetail(c)}. Dat kan een slordig ingesteld domein zijn óf een nagemaakte afzender — daarom boekt LaVega deze niet zelf. Controleer de regel en bevestig hem zelf.`,
      senderUnchecked:
        "Bij deze mail is geen afzendercontrole gedaan — hij kwam niet via het doorstuuradres binnen. Geen controle is geen goedkeuring, dus deze wacht op jou.",
      entityAmbiguous:
        "Je hebt meer dan één onderneming en de factuur zegt niet voor welke hij is. LaVega gokt geen entiteit — kies hem en bevestig.",
      incomplete: (gap) => `${nlGaps[gap]} Zolang dat ontbreekt boekt LaVega niets automatisch.`,
      gaps: nlGaps,
      overCeiling: (cents) =>
        `Boven € ${(cents / 100).toLocaleString("nl-NL")} boekt LaVega niets zelf, ook niet van een geverifieerde afzender. Deze wacht op jou.`,
    },
    entityLabel: "Entiteit",
    entityAriaLabel: "Entiteit (n8n)",
    directionLabel: "Richting",
    directionAriaLabel: "Richting (n8n)",
    counterpartyLabel: "Relatie",
    counterpartyAriaLabel: "Relatie (n8n)",
    invoiceNumberLabel: "Factuurnr.",
    invoiceNumberAriaLabel: "Factuurnummer (n8n)",
    issueDateLabel: "Factuurdatum",
    issueDateAriaLabel: "Factuurdatum (n8n)",
    dueDateLabel: "Vervaldatum",
    dueDateAriaLabel: "Vervaldatum (n8n)",
    amountLabel: "Bedrag",
    amountAriaLabel: "Bedrag (n8n)",
    currencyLabel: "Valuta",
    currencyAriaLabel: "Valuta (n8n)",
    currencyPlaceholder: "onbekend",
    vatLabel: "Btw",
    vatAriaLabel: "Btw (n8n)",
    vatPlaceholder: "onbekend",
    confirmButton: "Bevestigen",
    rejectButton: "Verwerpen",
    missingDueDateNote:
      "Geen vervaldatum gevonden — vul hem zelf in. LaVega verzint er geen betaaltermijn bij.",
    missingCurrencyNote:
      "Geen valuta gevonden — vul hem zelf in. LaVega boekt niets in euro's omdat de factuur toevallig geen valuta noemde.",
    missingVatNote: "Btw stond niet in de factuur; leeg blijft “onbekend”, niet € 0,00.",
  },

  notices: {
    kindLabels: {
      notification: "Staat klaar bij de leverancier",
      reminder: "Herinnering of aanmaning",
      "no-amount": "Factuur zonder leesbaar bedrag",
      unreadable: "Niets leesbaars in deze mail",
    },
    sectionAriaLabel: "Zelf ophalen",
    heading: "Zelf ophalen",
    eyebrow: (n) => `uit n8n · ${n}`,
    introLead:
      "Deze mails gingen over een factuur, maar er zat er geen in die LaVega kan boeken. Er staat met opzet",
    introStrong: "geen bedrag",
    introTail:
      "bij: dit is een lijstje om zelf af te werken, geen boeking in wording. Haal de factuur op en sleep hem hierboven naar binnen.",
    noSubjectFallback: "(geen onderwerp)",
    openInGmail: "Open in Gmail",
    noLinkFallback: "n8n gaf geen link mee; zoek de mail op het onderwerp.",
    doneButton: "Gedaan",
  },

  list: {
    heading: "Openstaand en geboekt",
    eyebrowCount: (n) => `${n} openstaande ${n === 1 ? "factuur" : "facturen"} · netto verwacht `,
    sectionAriaLabel: "Facturen",
    empty: "Nog geen facturen.",
    columns: {
      counterparty: "Relatie",
      company: "Onderneming",
      direction: "Richting",
      amount: "Bedrag",
      dueDate: "Vervaldatum",
      status: "Status",
    },
    directionBadge: { in: "AR · inkomend", out: "AP · uitgaand" },
    autoBadge: "automatisch",
    autoBadgeTitle:
      "Deze factuur is zonder klik geboekt: de afzender kwam door de SPF/DKIM-controle en de factuur was compleet.",
    statusLabels: { expected: "verwacht", paid: "betaald", cancelled: "geannuleerd" },
    undoButton: "Terugdraaien",
    markPaidButton: "markeer betaald",
    cancelButton: "annuleer",
    noActions: "—",
  },
};

const nlBelasting: BelastingCopy = {
  header: {
    title: "Belasting",
    rulesAsOfPrefix: "regels per",
    caveatsSummary: "Wat LaVega hier niet berekent",
    taxSystemLabel: "Belastingstelsel",
    taxSystemHint: "Bepaalt welke regels dit scherm toepast. Staat los van je land in Profiel.",
    unsupportedCountry: (country) =>
      `LaVega heeft nog geen belastingregels voor ${country}. Wat hieronder staat is afgeleid van de Nederlandse regels, niet van die van ${country} — kies hierboven zelf een stelsel of lees dit scherm als niet van toepassing.`,
    entitiesEmpty: "Nog geen entiteiten — importeer eerst rekeningen.",
    taxCount: (n) => (n === 2 ? "2 belastingen" : "1 belasting"),
    gridLabel: "Belastingen",
    countryLabel: { NL: "Nederland", DE: "Duitsland" },
    caveatsByCountry: {
      NL: [
        "Een btw-aangifte bevat correcties die LaVega niet ziet: privégebruik, de jaarlijkse correctie in Q4, de KOR en de margeregeling. Het bedrag hier is daardoor structureel te laag, in Q4 het meest.",
        "De voorlopige aanslag vennootschapsbelasting wordt door de Belastingdienst opgelegd en in maandtermijnen geïnd — LaVega schat die niet, zet hem als handmatige reservering.",
        "Indicatieve momentopname; controleer bij de Belastingdienst.",
        "LaVega meet overboekingen tussen je ondernemingen en privé, maar rekent niets uit over de excessief-lenen-regeling: daarvoor is nodig wat je in totaal van je onderneming geleend hebt, en dat staat niet in je vault. Een lening die er al stond voordat je je eerste afschrift importeerde, heeft LaVega nooit gezien.",
        "Een pensioen in eigen beheer rekent LaVega niet uit: de opgebouwde aanspraak en de afspraak eronder staan niet in je transacties.",
        "Terbeschikkingstelling van een pand, een auto of een ander goed aan je eigen onderneming rekent LaVega niet: het ziet de betaling, niet de afspraak eronder.",
        "LaVega leest je bankrekeningen en je facturen. Wat er in je loonaangifte of in je boekhouding staat, ziet het niet — ook een boekhoudbestand dat je hier importeert blijft één bestand in dit tabblad en is geen administratie. Elk bedrag hier is dus gemeten aan wat er in je vault staat, niet aan wat er is aangegeven.",
      ],
      DE: [
        "Het tarief is indicatief (rechtsvorm en Hebesatz verschillen per gemeente) — vul het bedrag van de Vorauszahlungsbescheid in zodra je die hebt.",
        "Dauerfristverlängerung (een maand uitstel voor de USt-Voranmeldung) is niet meegerekend.",
        "Indicatieve momentopname; controleer bij het Finanzamt.",
        "LaVega leest je bankrekeningen en je facturen. Wat er in je aangiftes of in je boekhouding staat, ziet het niet — ook een boekhoudbestand dat je hier importeert blijft één bestand in dit tabblad en is geen administratie.",
      ],
    },
    profitTaxDE: {
      what: "Duitsland laat winstbelasting vooruitbetalen op vier vaste data. Wat de vooruitbetalingen niet dekken, komt als Nachzahlung kort na afloop van het jaar — dat is het bedrag waar ondernemers op stuklopen.",
      rateBasis:
        "15% KSt + 5,5% Soli daarover + Gewerbesteuer bij Hebesatz 400% ≈ 29,8% — afgerond op 30%.",
    },
  },

  vat: {
    frequencyLabels: {
      monthly: "Maandelijks",
      quarterly: "Per kwartaal",
      yearly: "Jaarlijks",
    },
    basisLabels: {
      manual: "het bedrag dat je zelf invulde",
      sheet: "je eigen boekhouding",
      invoices: "je facturen (factuurstelsel)",
      proxy: "een marge-benadering uit je banktransacties",
    },
    directionLabels: {
      betalen: "te betalen",
      terugvragen: "terug te vragen",
      onbekend: "nog niet te bepalen",
    },

    footer: ({ countryLabel, ratesList }) =>
      `Tarieven in ${countryLabel}: ${ratesList}. Elk bedrag komt uit één bron — je eigen bedrag, je boekhouding, je facturen of een marge-benadering (netto ≈ marge × tarief ⁄ (100 + tarief)) — en die bronnen worden nooit bij elkaar opgeteld. Geen van de vier is een aangifte.`,
    noAmount: "geen bedrag",

    periodSummary: ({ periodLabel, directionLabel, deadline, loopt, asOf }) =>
      `${periodLabel} · ${directionLabel} · uiterlijk ${deadline} · ${loopt ? `stand tot ${asOf}` : "afgesloten"}`,

    detailsSummary: "Waar dit cijfer vandaan komt",
    periodStatus: ({ periodLabel, periodEnd, asOf, loopt }) =>
      loopt
        ? `${periodLabel} loopt nog t/m ${periodEnd} — dit is de stand tot ${asOf}, niet de aangifte.`
        : `${periodLabel} is afgesloten (t/m ${periodEnd}).`,

    sourceLine: ({ basisLabel, rulesAsOf }) => `Bron: ${basisLabel} · regels per ${rulesAsOf}.`,
    sourceAmounts: ({ chargedEuro, paidEuro }) =>
      ` Btw over omzet ${chargedEuro}, voorbelasting ${paidEuro}.`,

    coverageLine: ({ withVat, total }) =>
      `Btw-bedrag bekend op ${withVat} van de ${total} facturen in deze periode.`,

    outsidePeriod: ({ outside, nearestOutside, total }) => {
      const head =
        outside === 1
          ? "Er staat 1 factuur van deze onderneming buiten dit tijdvak"
          : `Er staan ${outside} facturen van deze onderneming buiten dit tijdvak`;
      const nearest = nearestOutside ? `, de dichtstbijzijnde van ${nearestOutside}` : "";
      const tail =
        total === 0
          ? "In dit tijdvak staat er geen enkele, dus hier valt niets uit je facturen af te leiden."
          : "Die telt hier dus niet mee.";
      return `${head}${nearest}. ${tail}`;
    },

    refundNotInForecast:
      "Dit bedrag staat niet als inkomende betaling in je forecast: LaVega weet niet wanneer de Belastingdienst uitbetaalt.",
    willReserve: (deadline) =>
      `Met “Bereken & bewaar” staat dit bedrag op ${deadline} in je forecast en gaat het van je beschikbare saldo af.`,

    notes: {
      "gemengde-tarieven": () =>
        "Gemengde tarieven: LaVega rekent hier niets uit en zet ook geen nul. Vul het bedrag zelf in, of importeer je boekhouding.",
      "stelsel-onbekend": ({ total }) =>
        `Er ${total === 1 ? "staat 1 factuur" : `staan ${total} facturen`} in deze periode. LaVega gebruikt die nog niet, omdat niet bekend is welk stelsel voor deze onderneming geldt: de btw valt bij het factuurstelsel in de periode van de factuur en bij het kasstelsel in die van de betaling. Factuurstelsel of kasstelsel?`,
      kasstelsel: () =>
        "Kasstelsel: de btw valt in de periode van de betaling, niet van de factuur. LaVega leidt het bedrag daarom niet uit je facturen af.",
      "btw-onbekend-op-facturen": ({ missing, total }) =>
        `Van ${missing} van de ${total} facturen in deze periode is het btw-bedrag onbekend, dus je facturen zijn hier niet de basis. Onbekend is geen nul.`,
      "omzetfacturen-onbekend": () =>
        "In deze periode staan alleen inkoopfacturen. Wat er aan btw over je omzet tegenover staat, ziet LaVega niet — en dat vult het niet met een nul.",
      "voorbelasting-onbekend": () =>
        "Geen inkoopfactuur met een btw-bedrag in deze periode, dus de voorbelasting is onbekend. Onbekend is geen nul, dus je facturen zijn hier niet de basis.",
      "boekhouding-andere-periode": () =>
        "Je geïmporteerde boekhouding dekt deze periode niet volledig of noemt de twee btw-kolommen niet, dus LaVega gebruikt hem niet half.",
      "geen-banktransacties": () =>
        "LaVega ziet geen transacties van deze onderneming in deze periode. Dat is geen nul: er is niets om een bedrag uit te lezen.",
    },

    fields: {
      frequencyLabel: "Frequentie",
      stelselLabel: "Stelsel",
      stelselUnset: "nog niet ingevuld",
      stelselFactuur: "Factuurstelsel",
      stelselKas: "Kasstelsel",
      ratePctLabel: "Tarief %",
      manualAmountLabel: "Handmatig €",
      manualAmountPlaceholder: "auto",
      mixedRatesLabel: "Gemengde tarieven",
      sheetLabel: "Boekhouding (CSV)",
    },

    taxLabel: { NL: "BTW", DE: "USt" },
    ariaLabels: {
      frequency: (vatLabel, entity) => `${vatLabel}-frequentie ${entity}`,
      stelsel: (entity) => `Stelsel ${entity}`,
      ratePct: (vatLabel, entity) => `${vatLabel}-tarief ${entity}`,
      manualAmount: (vatLabel, entity) => `Handmatig ${vatLabel}-bedrag ${entity}`,
      mixedRates: (entity) => `Gemengde tarieven ${entity}`,
      sheetImport: (entity) => `Boekhouding importeren ${entity}`,
    },

    sheetFieldLabels: {
      period: "Periode",
      revenue: "Omzet",
      expenses: "Kosten",
      profit: "Winst",
      vatCharged: "Btw over omzet",
      vatPaid: "Btw over kosten (voorbelasting)",
    },
    sheetProblem: {
      missingColumns: (fields) => `geen kolom gekoppeld voor: ${fields}`,
      undatedRows: (count) => `${count} regel(s) zonder leesbare periode — die tellen niet mee`,
    },

    sheetStatus: ({ fileName, rowCount, isBasis, periodLabel, problemsText }) =>
      `${fileName}: ${rowCount} regel(s) gelezen` +
      (isBasis
        ? ` — de btw van ${periodLabel} komt hieruit.`
        : ` — nog niet de basis voor ${periodLabel}.`) +
      (problemsText ? ` ${problemsText}.` : "") +
      " Deze import blijft in dit tabblad; LaVega bewaart je boekhouding niet buiten de versleutelde vault.",
  },

  profitTax: {
    noAmount: "—",
    estimateBadge: "schatting",
    nothingToReserve: (authority) =>
      `Nog niets te reserveren: LaVega ziet dit jaar geen winst in de banktransacties van deze entiteit, en verzint er geen. Zodra het ${authority} een bedrag oplegt, vul je dat hieronder in.`,
    authorityDE: "Finanzamt",
    authorityOther: "de fiscus",
    fields: {
      ratePctLabel: "Tarief %",
      imposedAmountLabel: "Opgelegd bedrag €",
      imposedAmountPlaceholder: "nog geen aanslag",
    },
    ariaLabels: {
      ratePct: (entity) => `Winstbelastingtarief ${entity}`,
      imposedAmount: (entity) => `Opgelegde winstbelasting ${entity}`,
    },
  },

  actions: {
    saveButton: "Bereken & bewaar",
    savedNothing:
      "Bewaard. Er is niets te reserveren met de huidige gegevens — geen bedrag is dus ook geen nul in je forecast.",
    savedSome: (count) =>
      `Bewaard. ${count} reservering${count === 1 ? "" : "en"} staan nu in je forecast en zijn van je beschikbare saldo afgetrokken.`,
  },
};

const nlRegels: RegelsCopy = {
  section: {
    ariaLabel: "Regels",
    heading: "Regels",
  },
  intro: {
    autoCategorization:
      "LaVega categoriseert transacties automatisch met een ingebouwde Nederlandse lijst (Albert Heijn → Boodschappen, NS → Transport, Netflix → Entertainment, enz.). Je eigen regels hieronder gaan vóór die automatische categorieën.",
    matchingRules: {
      beforeMatchWord: "Een regel matcht als de ",
      matchWord: "match",
      beforeFirstWord: "-tekst ergens in de tegenpartij of de omschrijving voorkomt, en de ",
      firstWord: "eerste",
      beforeUnknownWord:
        ' regel die past wint — een korte match als "spar" raakt dus ook "sparen". Zie je een transactie als ',
      unknownWord: "onbekend",
      afterUnknownWord:
        " staan bij Transacties? Daar staat er ook bij wáárom, en dat is meestal de tekst waar je hier een regel op maakt.",
    },
  },
  form: {
    matchLabel: "Match",
    categoryLabel: "Categorie",
    categoryPlaceholder: "Kies of typ een categorie",
    addButton: "Toevoegen",
  },
  newCategoryWarning: (typedCategory: string) =>
    `"${typedCategory}" staat niet in de lijst. Dat mag, maar het wordt dan een aparte categorie in élk overzicht — ook als je een bestaande bedoelde met een andere spelling.`,
  table: {
    matchHeader: "Match",
    categoryHeader: "Categorie",
    deleteButton: "Verwijderen",
    emptyState: "Nog geen regels.",
    sortNote:
      "Op alfabet gesorteerd om te lezen. Kan één transactie op twee regels passen, dan wint de regel die je het eerst hebt gemaakt — niet de bovenste in deze lijst.",
  },
};

const nlBackup: BackupCopy = {
  title: "Back-up",
  ariaLabel: "Back-up",
  common: {
    busy: "Bezig…",
  },
  download: {
    title: "Download",
    description:
      "Download een versleutelde back-up. Bewaar 'm veilig; je hebt je wachtwoord nodig om 'm te herstellen.",
    button: "Download back-up",
  },
  server: {
    title: "Back-up op de server",
    signedOut:
      "Log in om je versleutelde kluis ook op de server te bewaren, bij Account hierboven. Handig voor een tweede apparaat.",
    noBackupYet: "Nog geen back-up op de server.",
    lastBackup: (date) => `Laatste back-up: ${date}.`,
    encryptionNote: "De server bewaart alleen versleutelde bytes en kan je gegevens niet lezen.",
    backupNowButton: "Nu back-uppen",
    conflict: {
      message: (date) =>
        `Een ander apparaat heeft op ${date} een nieuwere back-up opgeslagen. Overschrijven verwijdert die.`,
      overwriteButton: "Toch overschrijven",
    },
    success: "Back-up opgeslagen.",
    errors: {
      locked: "Ontgrendel de kluis voordat je een back-up maakt.",
      saveFailed: "Back-up opslaan mislukt.",
    },
    restoreFromServer: {
      prompt: "Herstellen van de server? Download 'm eerst en gebruik het formulier hieronder.",
      button: "Haal back-up van server",
    },
    erase: {
      button: "Servergegevens verwijderen",
      warning:
        "Dit verwijdert alles wat de server over je bewaart: de versleutelde back-up, bankkoppelingen en brokerkluizen, koersgeschiedenis, AI-runs en je instellingen. De lokale kluis in deze browser blijft staan.",
      confirmButton: "Ja, verwijder",
      cancelButton: "Annuleer",
      success: (rows, tables) => `Verwijderd: ${rows} rijen over ${tables} tabellen.`,
      errorGeneric: "Verwijderen mislukt.",
    },
  },
  restore: {
    title: "Herstel uit back-up",
    warning: "Dit vervangt je huidige data in deze kluis.",
    fileLabel: "Back-upbestand",
    passwordLabel: "Wachtwoord",
    confirmLabel: "Ik snap dat dit mijn huidige data in deze kluis vervangt",
    error: "Onjuist wachtwoord of ongeldig back-upbestand.",
    success: "Herstel geslaagd.",
    submitButton: "Herstellen",
  },
};

const nlKoppelingen: KoppelingenCopy = {
  forwardAddress: {
    heading: "Doorstuuradres voor facturen",
    eyebrow: "stuur een factuur hiernaartoe en hij komt in de wachtrij",
    addressLabel: "Adres",
    addressPlaceholder: "invoices@lavega.dev",
    addressAriaLabel: "Doorstuuradres",
    invalidError: "Dat is geen e-mailadres. Niets opgeslagen — het vorige adres staat er nog.",
    emptyIntroPrefix: "Nog geen adres. Typ het adres dat je in Cloudflare hebt aangemaakt, of ",
    generateButton: "laat LaVega er een maken",
    emptyIntroSuffix: ".",
  },
  n8nLink: {
    heading: "Koppeling met n8n",
    eyebrow: "voor de facturenwachtrij ",
    intro: [
      { text: "Plak hier de " },
      { text: "Production URL", mark: "em" },
      { text: " van de webhook-node in jouw n8n en het token dat je daar bij " },
      { text: "Header Auth", mark: "em" },
      { text: " hebt gezet. Facturen gebruikt die twee om de wachtrij op te halen." },
    ],
    explain: {
      prefix: "Uitleg bij",
      linkSubject: "deze koppeling",
      urlSubject: "de webhook-URL",
      tokenSubject: "het token",
    },
    info: {
      link: [
        [
          {
            text: "Je eigen n8n leest je mailbox, laat Mistral bepalen of er een factuur in zit, en houdt die vast in een wachtrij. LaVega haalt die rij rechtstreeks op: ",
          },
          { text: "jouw mailbox → jouw n8n → jouw browser", mark: "strong" },
          { text: ". De LaVega-server komt er niet aan te pas en ziet dus nooit een factuurbedrag." },
        ],
        [
          { text: "Opzetten doe je één keer, in n8n zelf: importeer " },
          { text: "docs/n8n/lavega-invoices.json", mark: "code" },
          {
            text: ", zet een Header Auth-credential op de webhook-node, activeer de workflow, en plak de Production URL en dat token hieronder. Beide staan versleuteld in je kluis, net als een broker-koppeling — dus reizen ze mee in een back-up en zijn ze alleen te lezen terwijl de kluis ontgrendeld is.",
          },
        ],
        [
          { text: "Er is met opzet geen testknop.", mark: "strong" },
          {
            text: " De webhook leegt de wachtrij zodra hij antwoordt: één lezer, één keer — een “test” zou dus echte facturen opgebruiken. Ophalen gebeurt in Facturen, waar je elke regel te zien krijgt en zelf bevestigt.",
          },
        ],
      ],
      url: [
        {
          text: "Het adres waarop jouw n8n luistert. In n8n staat hij op de Webhook-node onder ",
        },
        { text: "Production URL", mark: "em" },
        {
          text: " — niet de Test URL, die werkt alleen zolang je in n8n op “Listen” hebt geklikt. Hij begint met http:// of https://.",
        },
      ],
      token: [
        {
          text: "Een wachtwoord dat je zelf verzint, zodat alleen jouw browser die wachtrij mag leegmaken. Maak er een met ",
        },
        { text: "openssl rand -hex 24", mark: "code" },
        { text: " en zet dezelfde waarde in n8n bij " },
        { text: "Header Auth", mark: "em" },
        { text: ", headernaam " },
        { text: "x-lavega-token", mark: "code" },
        { text: ". Hij blijft in deze browser en gaat nooit naar de LaVega-server." },
      ],
    },
    form: {
      urlLabel: "Webhook-URL (n8n, Production URL)",
      urlPlaceholder: "https://jouw-n8n/webhook/lavega-facturen",
      urlAriaLabel: "n8n webhook-URL",
      tokenLabel: "Token (header x-lavega-token)",
      tokenPlaceholder: "openssl rand -hex 24",
      tokenAriaLabel: "n8n token",
      showTokenLabel: "token tonen",
      showTokenAriaLabel: "Token tonen",
      saveButton: "Opslaan",
      clearButton: "Wissen",
    },
    urlWarning:
      "Dit ziet er niet uit als een webhook-URL — hij hoort met http:// of https:// te beginnen.",
  },
  status: {
    vaultReadFailed: "Kon de kluis niet lezen — probeer dit scherm opnieuw te openen.",
    notLinkedOnSave: "De kluis is nog niet gekoppeld aan dit scherm — er is niets opgeslagen.",
    saveFailed: "Opslaan in de kluis is mislukt — probeer het opnieuw.",
    savedComplete:
      "Opgeslagen in je kluis. Facturen haalt de wachtrij vanzelf op zodra je dat scherm opent.",
    savedIncomplete: "Opgeslagen — maar zolang URL óf token leeg is, kan LaVega niets ophalen.",
    notLinkedOnClear: "De kluis is nog niet gekoppeld aan dit scherm — er is niets gewist.",
    clearFailed: "Wissen in de kluis is mislukt — probeer het opnieuw.",
    cleared: "Gewist. LaVega haalt nu niets meer op uit n8n.",
  },
};

const enFacturen: FacturenCopy = {
  head: {
    title: "Three ways to get an invoice in",
    eyebrow: "only a verified sender books itself",
  },

  forms: {
    sectionLabel: "Enter invoices",

    auto: {
      moduleTitle: "1 · Automatic",
      pullIntro: (minutes) =>
        `LaVega fetches your own n8n's queue as soon as this screen opens, and again every ${minutes} minutes while you stay here. The button below is for an immediate recheck.`,
      gateNote: (entityCount) => {
        const oneEntity = entityCount === 1 ? ", you have one company" : "";
        const manyEntities =
          entityCount > 1
            ? " You have more than one company, so LaVega never picks the BV for you: it asks that choice once, and until then nothing here books automatically."
            : "";
        return `An invoice books itself only when there is nothing left to decide: the mail arrived through your forwarding address and passed the SPF/DKIM check${oneEntity}, and the invoice is complete. That one gets the “automatic” label and can be undone with a single click. Everything else waits for you, with the reason attached — an unverified sender books nothing here.${manyEntities}`;
      },
      fetchButton: "Fetch from n8n",
      connectionsButton: "Set up connections",
      pendingWarning: (n) =>
        `${n} ${n === 1 ? "row is" : "rows are"} waiting on your decision — see below.`,
    },

    drop: {
      moduleTitle: "2 · Drag & drop",
      dropzoneAriaLabel: "Drag an invoice file here",
      dropzoneTitle: "Drag an invoice here",
      dropzoneSub: "PDF, CSV export, or UBL/EN-16931 XML. Or click to choose one.",
      fileInputAriaLabel: "Choose an invoice file",
      aiCheckboxAriaLabel: "Read invoices with AI",
      aiCheckboxLabel: "Read invoices with AI (PDF → Mistral)",
      aiHint:
        "Only with this switch on does a PDF go through our server to Mistral — just that one document, and you confirm it yourself before it counts.",
    },

    manual: {
      moduleTitle: "3 · Manual",
      footer:
        "An expected invoice shows up on its due date in Overview and Forecast, and switches itself to “paid” as soon as a matching bank transaction comes in.",
      entityLabel: "Entity",
      entityAriaLabel: "Entity",
      directionLabel: "Direction",
      directionAriaLabel: "Direction",
      counterpartyLabel: "Counterparty",
      counterpartyAriaLabel: "Counterparty",
      invoiceNumberLabel: "Inv. no.",
      invoiceNumberAriaLabel: "Invoice number",
      issueDateLabel: "Invoice date",
      issueDateAriaLabel: "Invoice date",
      dueDateLabel: "Due date",
      dueDateAriaLabel: "Due date",
      amountLabel: "Amount",
      amountAriaLabel: "Amount",
      vatLabel: "VAT (BTW)",
      vatHint: "(blank = unknown)",
      vatAriaLabel: "VAT (BTW)",
      vatPlaceholder: "unknown",
      currencyLabel: "Currency",
      currencyAriaLabel: "Currency",
      currencyPlaceholder: "unknown",
      aiDraftBadge: "AI draft",
      addButton: "Add",
      discardDraftButton: "Discard AI draft",
    },
  },

  directionOptions: {
    out: "Outgoing (purchase)",
    in: "Incoming (sales)",
    unset: "— pick one —",
  },

  manualErrors: {
    missingCounterparty: "Enter a counterparty.",
    missingDirection:
      "Choose whether this is a purchase or a sales invoice. LaVega could not read it off the document.",
    missingIssueDate: "Enter an invoice date.",
    missingDueDate: "Enter a due date.",
    missingAmount: "Enter a valid amount — without an amount nothing gets booked.",
    invalidCurrency: "Enter the currency (3 letters) — LaVega never guesses euros.",
  },

  n8nNotices: {
    vaultNotLinked: "The vault is not yet connected to this screen. Nothing was fetched.",
    fetching: "Fetching…",
    notConfigured:
      "Not set up yet: first fill in the webhook URL and the token under Connections. Nothing was fetched.",
    unauthorized: (status) =>
      `n8n refused the token (${status}). Nothing was fetched; the queue in n8n is still there, because the workflow never even started. Check the token under Connections.`,
    httpError: (status) =>
      `n8n responded with status ${status}. Nothing was fetched. Is the workflow switched on?`,
    network:
      "No response from n8n. If n8n also shows no execution, this is almost certainly the CORS check: LaVega sends along a token header, so the browser first asks permission with an OPTIONS request — and that request leaves no trace in n8n if the webhook does not allow this page's origin. In the Webhook node, under Allowed Origins (CORS), set this page's address, or * to try it out. If you first want to know whether the URL is alive at all, paste it with the token into a terminal with curl: that request bypasses the browser and so needs no CORS. Nothing came in here.",
    unreadable:
      "n8n's response could not be read. Nothing was taken over — and because the queue is emptied on fetch, that row may be lost. Check in n8n.",
    emptyQueue:
      "The queue in n8n was empty. Nothing was fetched — that is not confirmation that there are invoices.",
    nothingNew: "Nothing new: everything n8n sent was already handled here.",
    fetched: (n) =>
      `${n} ${n === 1 ? "invoice" : "invoices"} fetched. n8n has emptied its queue as a result.`,
    autoBooked: (n) =>
      `${n} of ${n === 1 ? "those was" : "these were"} booked automatically: the sender passed the SPF/DKIM check and everything needed was there. They show up below marked “automatic” and can be undone with a single click.`,
    alreadyStoredOne: "One of them was already in LaVega and was not booked twice.",
    alreadyStoredMany: (n) => `${n} of them were already in LaVega and were not booked twice.`,
    waiting: (n) => `${n} ${n === 1 ? "row is" : "rows are"} waiting on you — each row says why.`,
    duplicatesSkipped: (n) =>
      `${n} row(s) LaVega already knew (same messageId) and are not offered again.`,
    dropped: (n) =>
      `${n} row(s) were missing a messageId or an amount and were not taken over — they are not in LaVega and no longer in n8n.`,
    noticesWaiting: (n) =>
      `${n} ${n === 1 ? "mail is waiting" : "mails are waiting"} under “Fetch it yourself”: none of them held an invoice LaVega could book.`,
    confirmedDuplicate: (counterparty) =>
      `This invoice (${counterparty}) was already in LaVega — row checked off, nothing booked twice.`,
    confirmedNew: (counterparty) => `Invoice from ${counterparty} added as expected.`,
    rejected: "Row rejected. Nothing was booked, and it will not be offered again.",
    undone:
      "Automatic booking undone: the invoice is now cancelled and no longer counts toward the forecast.",
    noticeDismissed: "Notice checked off. Nothing was booked.",
  },

  importNotices: {
    duplicateManualEntry: "This invoice is already there.",
    noneRecognized: "No invoices recognized in this file.",
    imported: (added, total) =>
      `${added} of ${total} invoices imported${added !== total ? " (the rest was already there)" : ""}.`,
    noneNew: "No new invoices (all already there).",
    pdfNeedsAi: (filename) =>
      `"${filename}" is a PDF. That can only be read by the AI reader — turn on "Read invoices with AI" below, or enter the invoice manually. Nothing was sent.`,
  },

  aiExtraction: {
    reading: "Reading…",
    extractFailedStatus: (status) => `AI extraction failed (${status}).`,
    extractFailed: "AI extraction failed. Try again.",
    confidencePart: (pct) => ` (AI-estimated confidence ${pct}%)`,
    vatPart: (formattedAmount) => `, incl. VAT (BTW) ${formattedAmount}`,
    noCurrencyPart: " The currency was not in it — fill it in yourself.",
    draftReady: (confidencePart, vatPart, noCurrencyPart) =>
      `AI draft — check every field and confirm${confidencePart}${vatPart}.${noCurrencyPart}`,
  },

  queue: {
    sectionAriaLabel: "Invoices to confirm",
    heading: "To confirm",
    eyebrow: (n) => `from n8n · ${n}`,
    warningLead: "Note — this is the only copy.",
    warningBody: (n) =>
      ` n8n empties its queue the moment it answers: fetching again will not bring these ${n} ${n === 1 ? "row" : "rows"} back. Reloading or locking the vault wipes them too. Confirm or reject them now.`,
    mailSourcePrefix: "From the mail:",
    waitReason: (reason) => `Waiting on you: ${reason}`,
    holds: {
      senderForwarded: (c) =>
        `The sender did not pass the SPF check${checkDetail(c)}, but DKIM does check out — that pattern belongs to a FORWARDED mail, not to a faked sender. Most likely your own forwarding rule. LaVega still won't book it for you: that the mail wasn't altered in transit says nothing about who forwarded it. Check it and confirm it yourself.`,
      senderFailed: (c) =>
        `The sender did not pass the SPF/DKIM check${checkDetail(c)}. That can be a sloppily configured domain or a faked sender — which is why LaVega won't book this one for you. Check it and confirm it yourself.`,
      senderUnchecked:
        "No sender check was run on this mail — it did not arrive through the forwarding address. No check is not an approval, so this one waits for you.",
      entityAmbiguous:
        "You have more than one company and the invoice doesn't say which one it's for. LaVega does not guess an entity — pick it and confirm.",
      incomplete: (gap) => `${enGaps[gap]} Until that's there, LaVega books nothing automatically.`,
      gaps: enGaps,
      overCeiling: (cents) =>
        `Above €${(cents / 100).toLocaleString("en-GB")} LaVega books nothing itself, not even from a verified sender. This one waits for you.`,
    },
    entityLabel: "Entity",
    entityAriaLabel: "Entity (n8n)",
    directionLabel: "Direction",
    directionAriaLabel: "Direction (n8n)",
    counterpartyLabel: "Counterparty",
    counterpartyAriaLabel: "Counterparty (n8n)",
    invoiceNumberLabel: "Inv. no.",
    invoiceNumberAriaLabel: "Invoice number (n8n)",
    issueDateLabel: "Invoice date",
    issueDateAriaLabel: "Invoice date (n8n)",
    dueDateLabel: "Due date",
    dueDateAriaLabel: "Due date (n8n)",
    amountLabel: "Amount",
    amountAriaLabel: "Amount (n8n)",
    currencyLabel: "Currency",
    currencyAriaLabel: "Currency (n8n)",
    currencyPlaceholder: "unknown",
    vatLabel: "VAT (BTW)",
    vatAriaLabel: "VAT (BTW) (n8n)",
    vatPlaceholder: "unknown",
    confirmButton: "Confirm",
    rejectButton: "Reject",
    missingDueDateNote:
      "No due date found — fill it in yourself. LaVega does not invent a payment term.",
    missingCurrencyNote:
      "No currency found — fill it in yourself. LaVega does not book anything in euros just because the invoice happened not to mention a currency.",
    missingVatNote: "VAT (BTW) was not on the invoice; blank stays “unknown”, not € 0.00.",
  },

  notices: {
    kindLabels: {
      notification: "Waiting for you at the supplier",
      reminder: "Reminder or final notice",
      "no-amount": "Invoice with no readable amount",
      unreadable: "Nothing readable in this mail",
    },
    sectionAriaLabel: "Fetch it yourself",
    heading: "Fetch it yourself",
    eyebrow: (n) => `from n8n · ${n}`,
    introLead:
      "These mails were about an invoice, but none of them held one LaVega can book. There is deliberately",
    introStrong: "no amount",
    introTail:
      "shown here: this is a to-do list, not a booking in progress. Fetch the invoice yourself and drag it in above.",
    noSubjectFallback: "(no subject)",
    openInGmail: "Open in Gmail",
    noLinkFallback: "n8n did not include a link; search your mail by the subject.",
    doneButton: "Done",
  },

  list: {
    heading: "Outstanding and booked",
    eyebrowCount: (n) => `${n} outstanding ${n === 1 ? "invoice" : "invoices"} · net expected `,
    sectionAriaLabel: "Invoices",
    empty: "No invoices yet.",
    columns: {
      counterparty: "Counterparty",
      company: "Company",
      direction: "Direction",
      amount: "Amount",
      dueDate: "Due date",
      status: "Status",
    },
    directionBadge: { in: "AR · incoming", out: "AP · outgoing" },
    autoBadge: "automatic",
    autoBadgeTitle:
      "This invoice was booked without a click: the sender passed the SPF/DKIM check and the invoice was complete.",
    statusLabels: { expected: "expected", paid: "paid", cancelled: "cancelled" },
    undoButton: "Undo",
    markPaidButton: "mark paid",
    cancelButton: "cancel",
    noActions: "—",
  },
};

const enBelasting: BelastingCopy = {
  header: {
    title: "Tax",
    rulesAsOfPrefix: "rules as of",
    caveatsSummary: "What LaVega does not calculate here",
    taxSystemLabel: "Tax system",
    taxSystemHint: "Decides which rules this screen applies. Separate from your country in Profile.",
    unsupportedCountry: (country) =>
      `LaVega has no tax rules for ${country} yet. What follows is derived from the Dutch rules, not from ${country}'s — pick a system above, or read this screen as not applying to you.`,
    entitiesEmpty: "No entities yet — import accounts first.",
    taxCount: (n) => (n === 2 ? "2 taxes" : "1 tax"),
    gridLabel: "Taxes",
    countryLabel: { NL: "the Netherlands", DE: "Germany" },
    caveatsByCountry: {
      NL: [
        "A VAT (BTW) return includes corrections LaVega does not see: private use, the annual Q4 correction, the KOR (small business scheme) and the margin scheme. The amount here is therefore structurally too low, most of all in Q4.",
        "The provisional corporate income tax assessment (voorlopige aanslag vennootschapsbelasting) is imposed by the Belastingdienst and collected in monthly instalments — LaVega does not estimate it; set it as a manual reservation.",
        "Indicative snapshot; check with the Belastingdienst.",
        "LaVega measures transfers between your companies and your personal accounts, but does not calculate anything about the excessive-loan rule (excessief lenen bij eigen vennootschap): that requires the total amount you have borrowed from your company, and that is not in your vault. A loan that already existed before you imported your first statement was never seen by LaVega.",
        "LaVega does not calculate a pension in own management (pensioen in eigen beheer): the accrued entitlement and the agreement behind it are not in your transactions.",
        "LaVega does not calculate the use of a property, car or other asset made available to your own company (terbeschikkingstelling): it sees the payment, not the agreement behind it.",
        "LaVega reads your bank accounts and your invoices. It does not see what is in your wage tax return (loonaangifte) or your bookkeeping — a bookkeeping file you import here also stays a single file in this tab, not a set of accounts. Every amount here is therefore measured against what is in your vault, not against what has been filed.",
      ],
      DE: [
        "The rate is indicative (legal form and Hebesatz vary by municipality) — enter the amount from your Vorauszahlungsbescheid once you have it.",
        "Dauerfristverlängerung (a one-month extension for the USt-Voranmeldung) is not taken into account.",
        "Indicative snapshot; check with the Finanzamt.",
        "LaVega reads your bank accounts and your invoices. It does not see what is in your tax returns or your bookkeeping — a bookkeeping file you import here also stays a single file in this tab, not a set of accounts.",
      ],
    },
    profitTaxDE: {
      what: "Germany collects profit tax as prepayments on four fixed dates. Whatever the prepayments do not cover arrives as a Nachzahlung shortly after the year closes — that is the amount owners get caught out by.",
      rateBasis:
        "15% KSt + 5.5% Soli on top of that + Gewerbesteuer at a Hebesatz of 400% ≈ 29.8% — rounded up to 30%.",
    },
  },

  vat: {
    frequencyLabels: {
      monthly: "Monthly",
      quarterly: "Quarterly",
      yearly: "Yearly",
    },
    basisLabels: {
      manual: "the amount you entered yourself",
      sheet: "your own bookkeeping",
      invoices: "your invoices (invoice basis / factuurstelsel)",
      proxy: "a margin approximation from your bank transactions",
    },
    directionLabels: {
      betalen: "to pay",
      terugvragen: "to reclaim",
      onbekend: "not yet determinable",
    },

    footer: ({ countryLabel, ratesList }) =>
      `Rates in ${countryLabel}: ${ratesList}. Every figure comes from a single source — your own amount, your bookkeeping, your invoices, or a margin approximation (net ≈ margin × rate ⁄ (100 + rate)) — and these sources are never added together. None of the four is a VAT return.`,
    noAmount: "no amount",

    periodSummary: ({ periodLabel, directionLabel, deadline, loopt, asOf }) =>
      `${periodLabel} · ${directionLabel} · due by ${deadline} · ${loopt ? `as of ${asOf}` : "closed"}`,

    detailsSummary: "Where this figure comes from",
    periodStatus: ({ periodLabel, periodEnd, asOf, loopt }) =>
      loopt
        ? `${periodLabel} is still running through ${periodEnd} — this is the position as of ${asOf}, not the return.`
        : `${periodLabel} is closed (through ${periodEnd}).`,

    sourceLine: ({ basisLabel, rulesAsOf }) => `Source: ${basisLabel} · rules as of ${rulesAsOf}.`,
    sourceAmounts: ({ chargedEuro, paidEuro }) =>
      ` VAT (BTW) on revenue ${chargedEuro}, input VAT ${paidEuro}.`,

    coverageLine: ({ withVat, total }) =>
      `VAT (BTW) amount known on ${withVat} of the ${total} invoices in this period.`,

    outsidePeriod: ({ outside, nearestOutside, total }) => {
      const head =
        outside === 1
          ? "There is 1 invoice from this entity outside this period"
          : `There are ${outside} invoices from this entity outside this period`;
      const nearest = nearestOutside ? `, the nearest of which is ${nearestOutside}` : "";
      const tail =
        total === 0
          ? "There is none in this period, so nothing can be derived from your invoices here."
          : outside === 1
            ? "That one does not count here."
            : "Those do not count here.";
      return `${head}${nearest}. ${tail}`;
    },

    refundNotInForecast:
      "This amount does not appear as an incoming payment in your forecast: LaVega does not know when the Belastingdienst will pay it out.",
    willReserve: (deadline) =>
      `With “Calculate & save” this amount will appear in your forecast on ${deadline} and will be deducted from your available balance.`,

    notes: {
      "gemengde-tarieven": () =>
        "Mixed rates: LaVega does not calculate anything here, and it does not fill in a zero either. Enter the amount yourself, or import your bookkeeping.",
      "stelsel-onbekend": ({ total }) =>
        `There ${total === 1 ? "is 1 invoice" : `are ${total} invoices`} in this period. LaVega does not use them yet, because it does not know which basis applies for this entity: under the invoice basis (factuurstelsel) the VAT (BTW) falls in the period of the invoice, and under the cash basis (kasstelsel) in the period of the payment. Invoice basis (factuurstelsel) or cash basis (kasstelsel)?`,
      kasstelsel: () =>
        "Cash basis (kasstelsel): the VAT (BTW) falls in the period of the payment, not of the invoice. LaVega therefore does not derive the amount from your invoices.",
      "btw-onbekend-op-facturen": ({ missing, total }) =>
        `For ${missing} of the ${total} invoices in this period the VAT (BTW) amount is unknown, so your invoices are not the basis here. Unknown is not zero.`,
      "omzetfacturen-onbekend": () =>
        "This period contains only purchase invoices. LaVega cannot see the VAT (BTW) on your revenue — and it does not fill that in as zero.",
      "voorbelasting-onbekend": () =>
        "No purchase invoice with a VAT (BTW) amount in this period, so the input VAT is unknown. Unknown is not zero, so your invoices are not the basis here.",
      "boekhouding-andere-periode": () =>
        "Your imported bookkeeping does not fully cover this period, or does not name the two VAT (BTW) columns, so LaVega does not use it halfway.",
      "geen-banktransacties": () =>
        "LaVega sees no transactions for this entity in this period. That is not zero: there is nothing to read an amount from.",
    },

    fields: {
      frequencyLabel: "Frequency",
      stelselLabel: "Basis (stelsel)",
      stelselUnset: "not yet set",
      stelselFactuur: "Invoice basis (factuurstelsel)",
      stelselKas: "Cash basis (kasstelsel)",
      ratePctLabel: "Rate %",
      manualAmountLabel: "Manual €",
      manualAmountPlaceholder: "auto",
      mixedRatesLabel: "Mixed rates",
      sheetLabel: "Bookkeeping (CSV)",
    },

    taxLabel: { NL: "VAT", DE: "VAT" },
    ariaLabels: {
      frequency: (vatLabel, entity) => `${vatLabel} frequency ${entity}`,
      stelsel: (entity) => `Basis (stelsel) ${entity}`,
      ratePct: (vatLabel, entity) => `${vatLabel} rate ${entity}`,
      manualAmount: (vatLabel, entity) => `Manual ${vatLabel} amount ${entity}`,
      mixedRates: (entity) => `Mixed rates ${entity}`,
      sheetImport: (entity) => `Import bookkeeping ${entity}`,
    },

    sheetFieldLabels: {
      period: "Period",
      revenue: "Revenue",
      expenses: "Expenses",
      profit: "Profit",
      vatCharged: "VAT (BTW) on revenue",
      vatPaid: "VAT (BTW) on costs (input VAT)",
    },
    sheetProblem: {
      missingColumns: (fields) => `no column matched for: ${fields}`,
      undatedRows: (count) => `${count} row(s) with no readable period — not counted`,
    },

    sheetStatus: ({ fileName, rowCount, isBasis, periodLabel, problemsText }) =>
      `${fileName}: ${rowCount} row(s) read` +
      (isBasis
        ? ` — the VAT (BTW) for ${periodLabel} comes from this.`
        : ` — not yet the basis for ${periodLabel}.`) +
      (problemsText ? ` ${problemsText}.` : "") +
      " This import stays in this tab; LaVega does not store your bookkeeping outside the encrypted vault.",
  },

  profitTax: {
    noAmount: "—",
    estimateBadge: "estimate",
    nothingToReserve: (authority) =>
      `Nothing to set aside yet: LaVega sees no profit this year in this entity's bank transactions, and it does not invent one. Once ${authority} imposes an amount, enter it below.`,
    authorityDE: "the Finanzamt",
    authorityOther: "the tax office",
    fields: {
      ratePctLabel: "Rate %",
      imposedAmountLabel: "Assessed amount €",
      imposedAmountPlaceholder: "no assessment yet",
    },
    ariaLabels: {
      ratePct: (entity) => `Profit tax rate ${entity}`,
      imposedAmount: (entity) => `Assessed profit tax ${entity}`,
    },
  },

  actions: {
    saveButton: "Calculate & save",
    savedNothing:
      "Saved. There is nothing to set aside with the current data — that is not the same as a forecast showing zero.",
    savedSome: (count) =>
      `Saved. ${count} ${count === 1 ? "reserved amount is" : "reserved amounts are"} now in your forecast and ${count === 1 ? "has" : "have"} been deducted from your available balance.`,
  },
};

const enRegels: RegelsCopy = {
  section: {
    ariaLabel: "Rules",
    heading: "Rules",
  },
  intro: {
    autoCategorization:
      "LaVega automatically categorises transactions using a built-in Dutch list (Albert Heijn → Boodschappen, NS → Transport, Netflix → Entertainment, and so on). Your own rules below take priority over those automatic categories.",
    matchingRules: {
      beforeMatchWord: "A rule matches when the ",
      matchWord: "match",
      beforeFirstWord: " text appears anywhere in the counterparty or the description, and the ",
      firstWord: "first",
      beforeUnknownWord:
        ' matching rule wins — a short match like "car" will also catch "cartoon". Do you see a transaction listed as ',
      unknownWord: "unknown",
      afterUnknownWord:
        " under Transactions? It shows why there too, and that's usually the text you'd base a rule on here.",
    },
  },
  form: {
    matchLabel: "Match",
    categoryLabel: "Category",
    categoryPlaceholder: "Choose or type a category",
    addButton: "Add",
  },
  newCategoryWarning: (typedCategory: string) =>
    `"${typedCategory}" isn't in the list. That's fine, but it will become a separate category in every overview — even if you meant an existing one with different spelling.`,
  table: {
    matchHeader: "Match",
    categoryHeader: "Category",
    deleteButton: "Delete",
    emptyState: "No rules yet.",
    sortNote:
      "Sorted alphabetically for reading. If one transaction matches two rules, the rule you created first wins — not the one on top of this list.",
  },
};

const enBackup: BackupCopy = {
  title: "Backup",
  ariaLabel: "Backup",
  common: {
    busy: "Working…",
  },
  download: {
    title: "Download",
    description:
      "Download an encrypted backup. Keep it safe; you'll need your password to restore it.",
    button: "Download backup",
  },
  server: {
    title: "Backup on the server",
    signedOut:
      "Sign in to also keep your encrypted vault on the server, under Account above. Handy for a second device.",
    noBackupYet: "No backup on the server yet.",
    lastBackup: (date) => `Last backup: ${date}.`,
    encryptionNote: "The server only stores encrypted bytes and can't read your data.",
    backupNowButton: "Back up now",
    conflict: {
      message: (date) =>
        `Another device saved a newer backup on ${date}. Overwriting will delete it.`,
      overwriteButton: "Overwrite anyway",
    },
    success: "Backup saved.",
    errors: {
      locked: "Unlock the vault before making a backup.",
      saveFailed: "Failed to save backup.",
    },
    restoreFromServer: {
      prompt: "Restoring from the server? Download it first and use the form below.",
      button: "Get backup from server",
    },
    erase: {
      button: "Delete server data",
      warning:
        "This deletes everything the server holds about you: the encrypted backup, bank connections and broker vaults, price history, AI runs and your settings. The local vault in this browser is untouched.",
      confirmButton: "Yes, delete",
      cancelButton: "Cancel",
      success: (rows, tables) => `Deleted: ${rows} rows across ${tables} tables.`,
      errorGeneric: "Failed to delete.",
    },
  },
  restore: {
    title: "Restore from backup",
    warning: "This replaces the current data in this vault.",
    fileLabel: "Backup file",
    passwordLabel: "Password",
    confirmLabel: "I understand this replaces the current data in this vault",
    error: "Incorrect password or invalid backup file.",
    success: "Restore successful.",
    submitButton: "Restore",
  },
};

const enKoppelingen: KoppelingenCopy = {
  forwardAddress: {
    heading: "Forwarding address for invoices",
    eyebrow: "send an invoice here and it lands in the queue",
    addressLabel: "Address",
    addressPlaceholder: "invoices@lavega.dev",
    addressAriaLabel: "Forwarding address",
    invalidError:
      "That's not an email address. Nothing was saved — the previous address is still there.",
    emptyIntroPrefix: "No address yet. Type the address you created in Cloudflare, or ",
    generateButton: "have LaVega create one",
    emptyIntroSuffix: ".",
  },
  n8nLink: {
    heading: "Connection with n8n",
    eyebrow: "for the invoice queue ",
    intro: [
      { text: "Paste the " },
      { text: "Production URL", mark: "em" },
      { text: " of the webhook node in your n8n here, along with the token you set there under " },
      { text: "Header Auth", mark: "em" },
      { text: ". Invoices uses those two to fetch the queue." },
    ],
    explain: {
      prefix: "Explanation of",
      linkSubject: "this connection",
      urlSubject: "the webhook URL",
      tokenSubject: "the token",
    },
    info: {
      link: [
        [
          {
            text: "Your own n8n reads your mailbox, lets Mistral decide whether it contains an invoice, and holds it in a queue. LaVega fetches that queue directly: ",
          },
          { text: "your mailbox → your n8n → your browser", mark: "strong" },
          { text: ". The LaVega server is never involved, so it never sees an invoice amount." },
        ],
        [
          { text: "You set this up once, in n8n itself: import " },
          { text: "docs/n8n/lavega-invoices.json", mark: "code" },
          {
            text: ", put a Header Auth credential on the webhook node, activate the workflow, and paste the Production URL and that token below. Both are stored encrypted in your vault, just like a broker connection — so they travel with a backup and can only be read while the vault is unlocked.",
          },
        ],
        [
          { text: "There is deliberately no test button.", mark: "strong" },
          {
            text: " The webhook empties the queue as soon as it responds: one reader, once — a “test” would use up real invoices. Fetching happens in Facturen, where you see every line and confirm it yourself.",
          },
        ],
      ],
      url: [
        { text: "The address your n8n listens on. In n8n it's on the Webhook node under " },
        { text: "Production URL", mark: "em" },
        {
          text: " — not the Test URL, which only works while you've clicked “Listen” in n8n. It starts with http:// or https://.",
        },
      ],
      token: [
        {
          text: "A password you make up yourself, so only your browser can empty that queue. Create one with ",
        },
        { text: "openssl rand -hex 24", mark: "code" },
        { text: " and set the same value in n8n under " },
        { text: "Header Auth", mark: "em" },
        { text: ", header name " },
        { text: "x-lavega-token", mark: "code" },
        { text: ". It stays in this browser and never goes to the LaVega server." },
      ],
    },
    form: {
      urlLabel: "Webhook URL (n8n, Production URL)",
      urlPlaceholder: "https://your-n8n/webhook/lavega-facturen",
      urlAriaLabel: "n8n webhook URL",
      tokenLabel: "Token (header x-lavega-token)",
      tokenPlaceholder: "openssl rand -hex 24",
      tokenAriaLabel: "n8n token",
      showTokenLabel: "show token",
      showTokenAriaLabel: "Show token",
      saveButton: "Save",
      clearButton: "Clear",
    },
    urlWarning: "This doesn't look like a webhook URL — it should start with http:// or https://.",
  },
  status: {
    vaultReadFailed: "Couldn't read the vault — try opening this screen again.",
    notLinkedOnSave: "The vault isn't linked to this screen yet — nothing was saved.",
    saveFailed: "Saving to the vault failed — please try again.",
    savedComplete:
      "Saved to your vault. Facturen will fetch the queue automatically once you open that screen.",
    savedIncomplete:
      "Saved — but as long as the URL or token is empty, LaVega can't fetch anything.",
    notLinkedOnClear: "The vault isn't linked to this screen yet — nothing was cleared.",
    clearFailed: "Clearing the vault failed — please try again.",
    cleared: "Cleared. LaVega will no longer fetch anything from n8n.",
  },
};

const nl: AdminCopy = {
  facturen: nlFacturen,
  belasting: nlBelasting,
  regels: nlRegels,
  backup: nlBackup,
  koppelingen: nlKoppelingen,
};
const en: AdminCopy = {
  facturen: enFacturen,
  belasting: enBelasting,
  regels: enRegels,
  backup: enBackup,
  koppelingen: enKoppelingen,
};

export const adminCopy: Record<Locale, AdminCopy> = { nl, en };
