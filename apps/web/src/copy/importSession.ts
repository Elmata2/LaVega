import type { Locale } from "../locale.js";
import type { ImportFormat } from "@lavega/core";

/** The generic import wizard's words (WS3.6, issue #294). Counts and reasons,
 *  never a silent row. */
export type ImportSessionCopy = {
  title: string;
  intro: string;
  choose: string;
  chooseAria: string;
  noFile: string;
  unsupported: string;
  mapping: string;
  mappingHint: string;
  fields: {
    date: string;
    amount: string;
    debit: string;
    credit: string;
    counterparty: string;
    description: string;
    currency: string;
    none: string;
  };
  dateOrder: string;
  dmy: string;
  mdy: string;
  invert: string;
  account: string;
  accountPlaceholder: string;
  crossFormat: (formats: string) => string;
  crossFormatOverride: string;
  preview: string;
  previewEmpty: string;
  rejected: string;
  rejectedRow: (line: number, reason: string) => string;
  reason: { date: string; amount: string };
  counts: (read: number, imported: number, duplicates: number, rejected: number) => string;
  import: string;
  importing: string;
  imported: (n: number) => string;
  nothingNew: string;
  sessions: string;
  sessionsEmpty: string;
  sessionRow: (filename: string, imported: number, date: string) => string;
  revert: string;
  reverted: (n: number) => string;
  formatLabels: Record<ImportFormat, string>;
};

const nl: ImportSessionCopy = {
  title: "Bestand met eigen kolommen",
  intro:
    "Een csv- of Excel-bestand dat geen enkel bankprofiel herkent: koppel zelf de kolommen, kijk wat erin komt, en importeer of draai het terug.",
  choose: "Bestand kiezen",
  chooseAria: "Kies een csv- of xlsx-bestand",
  noFile: "Nog geen bestand gekozen.",
  unsupported: "Dit bestand kon niet gelezen worden. Gebruik csv of xlsx.",
  mapping: "Kolommen",
  mappingHint: "LaVega raadt; jij beslist. Een leeg vak betekent: die kolom is er niet.",
  fields: {
    date: "Datum",
    amount: "Bedrag",
    debit: "Af",
    credit: "Bij",
    counterparty: "Tegenpartij",
    description: "Omschrijving",
    currency: "Valuta",
    none: "geen",
  },
  dateOrder: "Datumvolgorde",
  dmy: "dag-maand-jaar",
  mdy: "maand-dag-jaar",
  invert: "Teken omdraaien (uitgaven staan positief in dit bestand)",
  account: "Rekening",
  accountPlaceholder: "Kies een rekening",
  crossFormat: (formats) =>
    `Deze rekening is al geïmporteerd als ${formats}. Hetzelfde bestand in een tweede formaat telt dubbel: LaVega doet dat niet standaard.`,
  crossFormatOverride: "Ik weet het; importeer toch",
  preview: "Wat erin komt",
  previewEmpty: "Geen rijen om te importeren.",
  rejected: "Afgekeurd",
  rejectedRow: (line, reason) => `regel ${line}: ${reason}`,
  reason: { date: "geen geldige datum", amount: "geen geldig bedrag" },
  counts: (read, imported, duplicates, rejected) =>
    `${read} gelezen · ${imported} nieuw · ${duplicates} dubbel · ${rejected} afgekeurd`,
  import: "Importeren",
  importing: "Bezig…",
  imported: (n) => `${n} rij${n === 1 ? "" : "en"} geïmporteerd.`,
  nothingNew: "Niets nieuws: dit bestand staat al in de kluis.",
  sessions: "Eerdere imports",
  sessionsEmpty: "Nog geen imports.",
  sessionRow: (filename, imported, date) => `${filename} · ${imported} rijen · ${date}`,
  revert: "Terugdraaien",
  reverted: (n) => `${n} rij${n === 1 ? "" : "en"} teruggedraaid.`,
  formatLabels: {
    "generic-csv": "csv met eigen kolommen",
    "generic-xlsx": "Excel met eigen kolommen",
    "bank-csv": "bank-csv",
    mt940: "MT940",
    camt053: "CAMT.053",
    other: "een ander formaat",
  },
};

const en: ImportSessionCopy = {
  title: "A file with its own columns",
  intro:
    "A csv or Excel file no bank profile recognises: map the columns yourself, see what will land, then import or revert it.",
  choose: "Choose file",
  chooseAria: "Choose a csv or xlsx file",
  noFile: "No file chosen yet.",
  unsupported: "This file could not be read. Use csv or xlsx.",
  mapping: "Columns",
  mappingHint: "LaVega guesses; you decide. An empty box means the column is not there.",
  fields: {
    date: "Date",
    amount: "Amount",
    debit: "Debit",
    credit: "Credit",
    counterparty: "Counterparty",
    description: "Description",
    currency: "Currency",
    none: "none",
  },
  dateOrder: "Date order",
  dmy: "day-month-year",
  mdy: "month-day-year",
  invert: "Flip the sign (this file writes expenses as positive)",
  account: "Account",
  accountPlaceholder: "Choose an account",
  crossFormat: (formats) =>
    `This account was already imported as ${formats}. The same file in a second format double-counts, so LaVega does not do it by default.`,
  crossFormatOverride: "I understand; import anyway",
  preview: "What will land",
  previewEmpty: "No rows to import.",
  rejected: "Rejected",
  rejectedRow: (line, reason) => `line ${line}: ${reason}`,
  reason: { date: "no valid date", amount: "no valid amount" },
  counts: (read, imported, duplicates, rejected) =>
    `${read} read · ${imported} new · ${duplicates} duplicate · ${rejected} rejected`,
  import: "Import",
  importing: "Working…",
  imported: (n) => `${n} row${n === 1 ? "" : "s"} imported.`,
  nothingNew: "Nothing new: this file is already in the vault.",
  sessions: "Earlier imports",
  sessionsEmpty: "No imports yet.",
  sessionRow: (filename, imported, date) => `${filename} · ${imported} rows · ${date}`,
  revert: "Revert",
  reverted: (n) => `${n} row${n === 1 ? "" : "s"} reverted.`,
  formatLabels: {
    "generic-csv": "csv with its own columns",
    "generic-xlsx": "Excel with its own columns",
    "bank-csv": "bank csv",
    mt940: "MT940",
    camt053: "CAMT.053",
    other: "another format",
  },
};

export const importSessionCopy: Record<Locale, ImportSessionCopy> = { nl, en };
