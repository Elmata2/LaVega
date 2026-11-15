import { Effect } from "effect";
import { type CsvTable, DeGiroReadError, readCsv } from "./read.js";

/** Which DeGiro export a file is, once its header signature matched. */
export type DeGiroProfile = "account" | "transactions" | "portfolio";

/** Header language of the export. DeGiro localises headers, not the delimiter. */
export type DeGiroLanguage = "nl" | "en";

/**
 * The verified header signatures, byte for byte, from `docs/investing/DEGIRO.md`
 * (verified against real exports of 2026-11-12).
 *
 * The empty cells are deliberate: DeGiro labels the currency in the column
 * before the amount and leaves the amount's own cell unnamed (`Mutatie,,EUR`).
 * The account statement has no observed EN export, so it appears in NL only;
 * inventing an EN signature would make a guess look like detection.
 */
export const DEGIRO_HEADERS: readonly {
  profile: DeGiroProfile;
  language: DeGiroLanguage;
  header: readonly string[];
}[] = [
  {
    profile: "account",
    language: "nl",
    header: [
      "Datum",
      "Tijd",
      "Valutadatum",
      "Product",
      "ISIN",
      "Omschrijving",
      "FX",
      "Mutatie",
      "",
      "Saldo",
      "",
      "Order Id",
    ],
  },
  {
    profile: "transactions",
    language: "nl",
    header: [
      "Datum",
      "Tijd",
      "Product",
      "ISIN",
      "Beurs",
      "Uitvoeringsplaats",
      "Aantal",
      "Koers",
      "",
      "Lokale waarde",
      "",
      "Waarde EUR",
      "Wisselkoers",
      "AutoFX Kosten",
      "Transactiekosten en/of kosten van derden EUR",
      "Totaal EUR",
      "Order ID",
    ],
  },
  {
    profile: "transactions",
    language: "en",
    header: [
      "Date",
      "Time",
      "Product",
      "ISIN",
      "Reference exchange",
      "Venue",
      "Quantity",
      "Price",
      "",
      "Local value",
      "",
      "Value EUR",
      "Exchange rate",
      "AutoFX Fee",
      "Transaction and/or third party fees EUR",
      "Total EUR",
      "Order ID",
    ],
  },
  {
    profile: "portfolio",
    language: "nl",
    header: [
      "Product",
      "Symbool/ISIN",
      "Aantal",
      "Slotkoers",
      "Lokale waarde",
      "",
      "Waarde in EUR",
    ],
  },
  {
    profile: "portfolio",
    language: "en",
    header: ["Product", "Symbol/ISIN", "Amount", "Closing", "Local value", "", "Value in EUR"],
  },
];

/** A detection result: a verified profile, or the problem that says why not. */
export type DeGiroDetection =
  | { known: true; profile: DeGiroProfile; language: DeGiroLanguage }
  | { known: false; problem: string };

/** Trimmed cells, the only normalisation the signature comparison allows. */
function trimCells(cells: readonly string[]): string[] {
  return cells.map((cell) => cell.trim());
}

function sameCells(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((cell, index) => cell === b[index]);
}

/**
 * Exact header-signature match against `DEGIRO_HEADERS`. Never guesses and never
 * throws: an unverified header is `known: false` with the header named.
 *
 * The filename is deliberately not an input. DeGiro names every export
 * `Account.csv`/`Transactions.csv`/`Portfolio.csv` in the user's download
 * folder, so a rename must not change what the file is.
 */
export function detectProfile(header: readonly string[]): DeGiroDetection {
  const cells = trimCells(header);
  for (const entry of DEGIRO_HEADERS) {
    if (sameCells(entry.header, cells)) {
      return { known: true, profile: entry.profile, language: entry.language };
    }
  }
  return { known: false, problem: unknownHeaderProblem(header) };
}

/**
 * The single Dutch problem sentence for an unrecognised header. The trimmed
 * cells are joined with a comma so the problem names the header that was read.
 */
export function unknownHeaderProblem(header: readonly string[]): string {
  return `onbekend DeGiro-formaat: ${trimCells(header).join(",")}`;
}

export type DeGiroRead = {
  detection: DeGiroDetection;
  /** null only when the input had no header at all (empty file). */
  table: CsvTable | null;
  /** Exactly one entry when the file is unusable, otherwise empty. */
  problems: string[];
};

const EMPTY_FILE_PROBLEM = "leeg bestand — geen DeGiro-export gevonden";

/**
 * Reads one DeGiro export and reports its profile, or exactly one reason it is
 * unusable. Never throws; an unknown shape stays a problem, never a guess.
 */
export function readDeGiroCsv(text: string): DeGiroRead {
  const table = readCsv(text);
  if (table.header.length === 0) {
    return {
      detection: { known: false, problem: EMPTY_FILE_PROBLEM },
      table: null,
      problems: [EMPTY_FILE_PROBLEM],
    };
  }
  const detection = detectProfile(table.header);
  if (!detection.known) return { detection, table, problems: [detection.problem] };
  // A verified header with zero data rows is not an import: the download was
  // cut off or the user saved an empty tab. Say so instead of returning nothing.
  if (table.rows.length === 0) {
    const problem = `DeGiro ${detection.profile}-export zonder rijen`;
    return { detection, table, problems: [problem] };
  }
  return { detection, table, problems: [] };
}

/**
 * Effect entry point around `readDeGiroCsv`: success narrows the detection to a
 * verified profile, failure carries the one problem as a typed error.
 */
export const readDeGiro: (
  text: string,
) => Effect.Effect<
  DeGiroRead & { detection: { known: true; profile: DeGiroProfile; language: DeGiroLanguage } },
  DeGiroReadError
> = Effect.fn("readDeGiro")(function* (text: string) {
  const read = readDeGiroCsv(text);
  const problem = read.problems[0];
  if (problem !== undefined) return yield* Effect.fail(new DeGiroReadError({ problem }));
  if (!read.detection.known) {
    // readDeGiroCsv reports every unknown detection as a problem, so this branch
    // is unreachable; it narrows the detection type without an assertion.
    const fallback = unknownHeaderProblem(read.table?.header ?? []);
    return yield* Effect.fail(new DeGiroReadError({ problem: fallback }));
  }
  return { ...read, detection: read.detection };
});
