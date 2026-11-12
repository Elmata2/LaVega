import type { Locale } from "../locale.js";
import type { UploadProblem } from "@lavega/core";

/** The document card's words (WS3.4/WS3.5, issue #293). A refusal or a
 *  reconciliation result is a sentence with a reason, never a silent state. */
export type DocumentsCopy = {
  title: string;
  intro: string;
  upload: string;
  uploadAria: string;
  cap: (mb: number) => string;
  empty: string;
  eraseAll: string;
  eraseAllConfirm: string;
  eraseAllCancel: string;
  erased: (count: number) => string;
  remove: string;
  link: string;
  reject: string;
  linkTo: string;
  review: string;
  reviewEmpty: string;
  stored: string;
  refused: Record<UploadProblem, string>;
  duplicate: string;
  reason: {
    "no-period": string;
    ambiguous: string;
    "no-hint": string;
    rejected: string;
    unmatched: string;
  };
  period: (from: string, to: string) => string;
  noPeriod: string;
  suggested: (account: string, pct: string) => string;
  tied: (accounts: string) => string;
  noSuggestion: string;
  linked: (account: string) => string;
  reconciliation: {
    verified: string;
    mismatched: (difference: string) => string;
    unavailable: string;
    reason: {
      "no-account": string;
      "no-period": string;
      "no-statement-balances": string;
      "no-ledger-value": string;
      difference: string;
    };
  };
  kind: { statement: string; other: string };
};

const nl: DocumentsCopy = {
  title: "Documenten",
  intro:
    "Bewaar je afschriften bij de cijfers. De bestanden gaan versleuteld de kluis in, apart van de rest, en een back-up neemt ze mee.",
  upload: "Document toevoegen",
  uploadAria: "Document toevoegen (pdf, csv of xlsx)",
  cap: (mb) => `Maximaal ${mb} MB per bestand.`,
  empty: "Nog geen documenten.",
  eraseAll: "Alle documenten wissen",
  eraseAllConfirm: "Zeker weten? Dit wist de bestanden én de gegevens erover.",
  eraseAllCancel: "Annuleren",
  erased: (count) => `${count} document${count === 1 ? "" : "en"} gewist, met de bestanden erbij.`,
  remove: "Verwijderen",
  link: "Koppelen",
  reject: "Niet deze",
  linkTo: "Koppel aan rekening",
  review: "Nog te beoordelen",
  reviewEmpty: "Niets te beoordelen.",
  stored: "Document bewaard.",
  refused: {
    empty: "Dit bestand is leeg.",
    "too-large": "Dit bestand is groter dan de limiet.",
    type: "Dit bestandstype wordt niet ondersteund: gebruik pdf, csv of xlsx.",
    name: "Geef het bestand een naam met een extensie (.pdf, .csv of .xlsx).",
  },
  duplicate: "Deze bytes zaten al in de kluis: hetzelfde bestand is één document.",
  reason: {
    "no-period": "Geen periode in het bestand gevonden; het blijft in de wachtrij staan.",
    ambiguous: "Twee rekeningen passen even goed; LaVega kiest niet.",
    "no-hint": "Geen herkenbare bank of rekening in de naam.",
    rejected: "Eerder afgewezen; je kunt het opnieuw koppelen.",
    unmatched: "Nog niet gekoppeld.",
  },
  period: (from, to) => `${from} t/m ${to}`,
  noPeriod: "geen periode",
  suggested: (account, pct) => `Voorstel: ${account} (${pct})`,
  tied: (accounts) => `Twijfel tussen ${accounts}`,
  noSuggestion: "Geen voorstel",
  linked: (account) => `Gekoppeld aan ${account}`,
  reconciliation: {
    verified: "Gecontroleerd tegen het grootboek",
    mismatched: (difference) => `Wijkt af van het grootboek (${difference})`,
    unavailable: "Niet te controleren",
    reason: {
      "no-account": "geen rekening gekoppeld",
      "no-period": "geen periode bekend",
      "no-statement-balances": "geen saldi in het bestand",
      "no-ledger-value": "geen grootboekstand op deze datum",
      difference: "het verschil is groter dan één cent",
    },
  },
  kind: { statement: "afschrift", other: "overig" },
};

const en: DocumentsCopy = {
  title: "Documents",
  intro:
    "Keep your statements next to the numbers. The files are sealed into the vault, apart from the rest, and a backup carries them.",
  upload: "Add document",
  uploadAria: "Add document (pdf, csv or xlsx)",
  cap: (mb) => `At most ${mb} MB per file.`,
  empty: "No documents yet.",
  eraseAll: "Erase all documents",
  eraseAllConfirm: "Are you sure? This erases the files and the facts about them.",
  eraseAllCancel: "Cancel",
  erased: (count) => `${count} document${count === 1 ? "" : "s"} erased, files included.`,
  remove: "Remove",
  link: "Link",
  reject: "Not this one",
  linkTo: "Link to account",
  review: "Needs review",
  reviewEmpty: "Nothing to review.",
  stored: "Document stored.",
  refused: {
    empty: "This file is empty.",
    "too-large": "This file is larger than the limit.",
    type: "This file type is not supported: use pdf, csv or xlsx.",
    name: "Give the file a name with an extension (.pdf, .csv or .xlsx).",
  },
  duplicate: "These bytes are already in the vault: the same file is one document.",
  reason: {
    "no-period": "No period found in the file; it stays in the review queue.",
    ambiguous: "Two accounts fit equally well; LaVega does not choose.",
    "no-hint": "No recognisable bank or account in the name.",
    rejected: "Rejected earlier; you can link it again.",
    unmatched: "Not linked yet.",
  },
  period: (from, to) => `${from} – ${to}`,
  noPeriod: "no period",
  suggested: (account, pct) => `Suggestion: ${account} (${pct})`,
  tied: (accounts) => `Tied between ${accounts}`,
  noSuggestion: "No suggestion",
  linked: (account) => `Linked to ${account}`,
  reconciliation: {
    verified: "Checked against the ledger",
    mismatched: (difference) => `Differs from the ledger (${difference})`,
    unavailable: "Cannot be checked",
    reason: {
      "no-account": "no account linked",
      "no-period": "no known period",
      "no-statement-balances": "no balances in the file",
      "no-ledger-value": "no ledger value on that date",
      difference: "the difference is more than one cent",
    },
  },
  kind: { statement: "statement", other: "other" },
};

export const documentsCopy: Record<Locale, DocumentsCopy> = { nl, en };
