import type { ImportProblem, UnrecognisedAction } from "@lavega/core";
import type { Locale } from "../locale.js";

/* Words of the "add a card by file" dialog. The issuer steps live in
 * importGuides.ts. */
export type CardFileCopy = {
  title: (name: string) => string;
  titleGeneric: string;
  close: string;
  chooseIntro: string;
  otherChoice: string;
  /** The name used in the done line when no card was chosen. */
  otherName: string;
  stepsHeading: string;
  dropHint: string;
  typesHint: string;
  chooseButton: string;
  removeFile: (name: string) => string;
  reading: string;
  newLine: (n: number) => string;
  metaLine: (dup: number, period: string, issuer: string) => string;
  nothingNew: (total: number) => string;
  unreadableRows: (k: number) => string;
  noCardPayments: string;
  unmatchedExisting: string;
  xls: string;
  unreadableFile: string;
  failedPartial: string;
  question: (account: string) => string;
  questionYes: (account: string) => string;
  questionNo: string;
  goesTo: (name: string) => string;
  goesToNew: (name: string) => string;
  doneDiff: (n: number, already: number, name: string) => string;
  unrecognisedLine: (rows: UnrecognisedAction[]) => string;
  noTransactions: string;
  wrongIssuer: (picked: string, found: string) => string;
  continueAnyway: string;
  continueAnywayDone: string;
  problem: (p: ImportProblem) => string;
  add: string;
  adding: string;
  cancel: string;
  failed: string;
  done: (n: number, name: string) => string;
  doneNothing: (name: string) => string;
  doneClose: string;
  /** Entry-point labels. */
  upload: string;
  uploadFor: (name: string) => string;
  viaFile: string;
  connectedViaFile: string;
};

const range = (rows: UnrecognisedAction[]) => rows.map((r) => `${r.action} x${r.count}`).join(", ");
const n = (rows: UnrecognisedAction[]) => rows.reduce((s, r) => s + r.count, 0);
const rowsNl = (k: number) => (k === 1 ? "regel" : "regels");
const rowsEn = (k: number) => (k === 1 ? "row" : "rows");

export const cardFileCopy: Record<Locale, CardFileCopy> = {
  nl: {
    title: (name) => `${name} toevoegen`,
    titleGeneric: "Kaart of bank toevoegen via bestand",
    close: "Sluiten",
    chooseIntro: "Welke kaart wil je toevoegen?",
    otherChoice: "Andere bank of kaart",
    otherName: "je rekeningen",
    stepsHeading: "Zo haal je het bestand op",
    dropHint: "Sleep je bestanden hierheen, of kies ze. Meerdere bestanden mag.",
    typesHint: "CSV of Excel (.xlsx)",
    chooseButton: "Kies bestand",
    removeFile: (name) => `${name} verwijderen`,
    reading: "Bestand lezen...",
    newLine: (n) => (n === 1 ? "1 nieuwe transactie" : `${n} nieuwe transacties`),
    metaLine: (d, p, i) =>
      `${d === 1 ? "1 stond" : `${d} stonden`} er al in · ${p} · herkend als ${i}`,
    nothingNew: (t) =>
      t === 1
        ? "Niets nieuws: deze transactie stond er al in."
        : `Niets nieuws: alle ${t} transacties stonden er al in.`,
    unreadableRows: (k) =>
      k === 1 ? "1 regel kon niet gelezen worden." : `${k} regels konden niet gelezen worden.`,
    noCardPayments: "Dit bestand bevat geen kaartbetalingen, alleen stortingen/rente.",
    unmatchedExisting:
      "We konden je bestaande American Express-gegevens niet aan dit bestand koppelen. Controleer na het toevoegen of er dubbele transacties staan.",
    xls: "Dit is een oud Excel-bestand (.xls). Kies CSV of .xlsx.",
    unreadableFile: "Dit bestand konden we niet lezen. Probeer CSV of Excel (.xlsx).",
    failedPartial: "Niet alles is opgeslagen. Controleer je rekeningen en probeer het opnieuw.",
    question: (a) => `Je hebt al een American Express-rekening: ${a}. Is dit dezelfde kaart?`,
    questionYes: (a) => `Ja, voeg toe aan ${a}`,
    questionNo: "Nee, dit is een andere kaart",
    goesTo: (n) => `Komt in: ${n}`,
    goesToNew: (n) => `Nieuwe rekening: ${n}`,
    doneDiff: (n, k, name) =>
      `${n === 1 ? "1 transactie" : `${n} transacties`} toegevoegd aan ${name}. ${k === 1 ? "1 stond" : `${k} stonden`} er intussen al in.`,
    unrecognisedLine: (rows) =>
      `Niet herkend: ${n(rows)} ${rowsNl(n(rows))} (${range(rows)}). Die worden niet toegevoegd.`,
    noTransactions: "Geen transacties gevonden.",
    wrongIssuer: (picked, found) =>
      `Je koos ${picked}, maar dit bestand lijkt van ${found}. Controleer of je het juiste bestand hebt.`,
    continueAnyway: "Toch toevoegen, los van deze kaart",
    continueAnywayDone: "Wordt toegevoegd, los van deze kaart.",
    problem: (p) => {
      switch (p.kind) {
        case "camt-not-supported":
          return "Dit is een CAMT-bestand en dat lezen we nog niet. Kies CSV of MT940.";
        case "spreadsheet-not-supported":
          return `Dit Excel-bestand (.${p.format}) kunnen we niet lezen. Kies CSV.`;
        case "spreadsheet-unrecognised":
          return `Dit Excel-bestand (.${p.format}) heeft kolommen die we niet kennen. Probeer CSV, of een bestand rechtstreeks van je bank.`;
        case "pdf-not-supported":
          return "Dit is een PDF. Kies CSV of Excel.";
        case "recognised-but-empty":
          return `Formaat herkend (${p.source}), maar er stonden geen transacties in. Kies een periode met uitgaven.`;
        case "unrecognised":
          return "Dit bestand herkennen we niet. Download een CSV-, Excel- (.xlsx) of MT940-export bij je bank.";
      }
    },
    add: "Toevoegen",
    adding: "Bezig met toevoegen...",
    cancel: "Annuleren",
    failed: "Toevoegen lukte niet. Er is niets opgeslagen. Probeer het nog eens.",
    done: (c, name) =>
      `${c === 1 ? "1 transactie" : `${c} transacties`} toegevoegd aan ${name}.`,
    doneNothing: (name) =>
      `Deze transacties stonden er al bij ${name}. Er is niets nieuws toegevoegd.`,
    doneClose: "Sluiten",
    upload: "Bestand uploaden",
    uploadFor: (name) => `Bestand uploaden voor ${name}`,
    viaFile: "via bestand",
    connectedViaFile: "Gekoppeld via bestand",
  },
  en: {
    title: (name) => `Add ${name}`,
    titleGeneric: "Add a card or bank by file",
    close: "Close",
    chooseIntro: "Which card do you want to add?",
    otherChoice: "Other bank or card",
    otherName: "your accounts",
    stepsHeading: "How to get the file",
    dropHint: "Drop your files here, or choose them. More than one file is fine.",
    typesHint: "CSV or Excel (.xlsx)",
    chooseButton: "Choose file",
    removeFile: (name) => `Remove ${name}`,
    reading: "Reading file...",
    newLine: (n) => (n === 1 ? "1 new transaction" : `${n} new transactions`),
    metaLine: (d, p, i) => `${d} already here · ${p} · recognised as ${i}`,
    nothingNew: (t) =>
      t === 1
        ? "Nothing new: this transaction was already here."
        : `Nothing new: all ${t} transactions were already here.`,
    unreadableRows: (k) =>
      k === 1 ? "1 row could not be read." : `${k} rows could not be read.`,
    noCardPayments: "This file has no card payments, only deposits/interest.",
    unmatchedExisting:
      "We could not match your existing American Express data to this file. After adding, check for duplicate transactions.",
    xls: "This is an old Excel file (.xls). Choose CSV or .xlsx.",
    unreadableFile: "We could not read this file. Try CSV or Excel (.xlsx).",
    failedPartial: "Not everything was saved. Check your accounts and try again.",
    question: (a) => `You already have an American Express account: ${a}. Is this the same card?`,
    questionYes: (a) => `Yes, add to ${a}`,
    questionNo: "No, this is a different card",
    goesTo: (n) => `Goes to: ${n}`,
    goesToNew: (n) => `New account: ${n}`,
    doneDiff: (n, k, name) =>
      `${n === 1 ? "1 transaction" : `${n} transactions`} added to ${name}. ${k} ${k === 1 ? "was" : "were"} already there in the meantime.`,
    unrecognisedLine: (rows) =>
      `Not recognised: ${n(rows)} ${rowsEn(n(rows))} (${range(rows)}). These will not be added.`,
    noTransactions: "No transactions found.",
    wrongIssuer: (picked, found) =>
      `You chose ${picked}, but this file looks like ${found}. Check that you have the right file.`,
    continueAnyway: "Add anyway, apart from this card",
    continueAnywayDone: "Will be added apart from this card.",
    problem: (p) => {
      switch (p.kind) {
        case "camt-not-supported":
          return "This is a CAMT file and we cannot read those yet. Choose CSV or MT940.";
        case "spreadsheet-not-supported":
          return `We cannot read this Excel file (.${p.format}). Choose CSV.`;
        case "spreadsheet-unrecognised":
          return `This Excel file (.${p.format}) has columns we do not know. Try CSV, or a file straight from your bank.`;
        case "pdf-not-supported":
          return "This is a PDF. Choose CSV or Excel.";
        case "recognised-but-empty":
          return `Format recognised (${p.source}), but it held no transactions. Choose a period with spending.`;
        case "unrecognised":
          return "We do not recognise this file. Download a CSV, Excel (.xlsx) or MT940 export from your bank.";
      }
    },
    add: "Add",
    adding: "Adding...",
    cancel: "Cancel",
    failed: "Adding failed. Nothing was saved. Try again.",
    done: (c, name) =>
      `${c === 1 ? "1 transaction" : `${c} transactions`} added to ${name}.`,
    doneNothing: (name) => `These transactions were already in ${name}. Nothing new was added.`,
    doneClose: "Close",
    upload: "Upload file",
    uploadFor: (name) => `Upload file for ${name}`,
    viaFile: "via file",
    connectedViaFile: "Connected via file",
  },
};
