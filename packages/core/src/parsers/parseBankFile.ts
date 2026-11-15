import type { Account, Tx } from "../model.js";
import { findIban } from "./primitives.js";
import { parseBankCsv } from "./bankCsv.js";
import { parseMt940 } from "./mt940.js";

/* Ported from Kasoverzicht.html's parseAny (618-630) + fallbackFromName
 * (631-640), minus the CAMT branch (deferred to Plan 2 Task 4 — reported as a
 * problem instead of parsed). The format dispatcher: detect MT940 (:20:/:61:),
 * CAMT (XML preamble), else CSV, and route to the right parser, returning a
 * uniform {accounts, txs, source, problems}. Pure — no I/O. ABN AMRO's
 * TAB/no-header CSV is handled inside parseBankCsv (Task 1), so there is no
 * separate ABN branch here. */

/** What went wrong with an imported file — a KIND, never a sentence.
 *
 *  These were Dutch strings built here in core and printed verbatim by the
 *  import screen, which is the FIRST screen anyone uses. An English reader
 *  importing a statement got "onbekend of leeg bestand" and no idea what to do
 *  about it. The wording now belongs to `copy/shell`; core says which of the
 *  five things happened and carries the one fact the sentence needs. */
export type ImportProblem =
  | { kind: "camt-not-supported" }
  /** A workbook, not a statement. Its own case because the answer is an
   *  instruction ("save it as CSV") and not a shrug. */
  | { kind: "spreadsheet-not-supported"; format: "xlsx" | "xls" }
  | { kind: "recognised-but-empty"; source: string }
  | { kind: "unrecognised" };

export type ParsedBankFile = {
  accounts: Account[];
  txs: Array<Omit<Tx, "id">>;
  source: string;
  problems: ImportProblem[];
};

/* --- fallback account key from the filename, for CSV profiles that carry no
 * account column (Revolut/Amex/Trading 212). Ported from fallbackFromName. --- */
export function fallbackFromName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const ib = findIban(base);
  if (ib) return ib;
  const d = base.match(/(\d{4})(?!.*\d{4})/);
  if (/amex|american/i.test(base)) return "AMEX" + (d ? "-" + d[1] : "");
  if (/trading\s*212|t212/i.test(base)) return "TRADING212";
  if (/revolut/i.test(base)) return "REVOLUT";
  return base.slice(0, 40) || "onbekend";
}

/* Attach a problem when a format was routed but yielded nothing (a malformed
 * MT940 with no :25:, an all-trades Trading 212 export, an unrecognized/empty
 * CSV). A recognized format/profile with zero rows says so explicitly; only a
 * truly unidentified file gets the generic "onbekend of leeg" message — so the
 * `source` and the `problems` text never contradict each other. Never throws. */
function finalize(accounts: Account[], txs: Array<Omit<Tx, "id">>, source: string): ParsedBankFile {
  if (accounts.length > 0 || txs.length > 0) return { accounts, txs, source, problems: [] };
  const recognized = source !== "" && source !== "generic" && source !== "leeg";
  const problem: ImportProblem = recognized
    ? { kind: "recognised-but-empty", source }
    : { kind: "unrecognised" };
  return { accounts, txs, source, problems: [problem] };
}

/* A workbook read as text is mojibake, and mojibake parses as "unrecognised or
 * empty" — a dead end in front of someone whose bank only offers .xlsx. Both
 * signatures survive a UTF-8 decode as their leading ASCII, which is why this
 * can sniff the decoded text instead of needing the bytes:
 *   · .xlsx is a ZIP, so it starts "PK\x03\x04";
 *   · .xls is an OLE2 compound file, whose D0 CF 11 E0 decodes to U+FFFD but
 *     leaves the extension as the only honest signal, so that one is by name. */
function spreadsheetFormat(filename: string, text: string): "xlsx" | "xls" | null {
  if (text.startsWith("PK\u0003\u0004") || /\.xlsx$/i.test(filename)) return "xlsx";
  if (/\.xls$/i.test(filename)) return "xls";
  return null;
}

export function parseBankFile(filename: string, text: string): ParsedBankFile {
  const sheet = spreadsheetFormat(filename, text);
  if (sheet)
    return {
      accounts: [],
      txs: [],
      source: sheet,
      problems: [{ kind: "spreadsheet-not-supported", format: sheet }],
    };
  // CAMT.053 XML — deferred (Plan 2 Task 4). Detect and report clearly; don't throw.
  if (/^\s*<\?xml|<Document/i.test(text.slice(0, 400))) {
    return {
      accounts: [],
      txs: [],
      source: "CAMT.053",
      problems: [{ kind: "camt-not-supported" }],
    };
  }
  // MT940 / .STA — content-detected SWIFT tag block.
  if (/:20:/.test(text.slice(0, 4000)) && /:61:/.test(text)) {
    const { accounts, txs } = parseMt940(text);
    return finalize(accounts, txs, "MT940");
  }
  // Otherwise CSV — parseBankCsv handles profile detection, ABN-TAB, and the generic fallback.
  const { accounts, txs, profile } = parseBankCsv(text, fallbackFromName(filename));
  return finalize(accounts, txs, profile);
}
