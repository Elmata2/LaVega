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

export type ParsedBankFile = {
  accounts: Account[];
  txs: Array<Omit<Tx, "id">>;
  source: string;
  problems: string[];
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

export function parseBankFile(filename: string, text: string): ParsedBankFile {
  // CAMT.053 XML — deferred (Plan 2 Task 4). Detect and report clearly; don't throw.
  if (/^\s*<\?xml|<Document/i.test(text.slice(0, 400))) {
    return { accounts: [], txs: [], source: "CAMT.053", problems: ["CAMT.053 nog niet ondersteund"] };
  }
  // MT940 / .STA — content-detected SWIFT tag block.
  if (/:20:/.test(text.slice(0, 4000)) && /:61:/.test(text)) {
    const { accounts, txs } = parseMt940(text);
    return { accounts, txs, source: "MT940", problems: [] };
  }
  // Otherwise CSV — parseBankCsv handles profile detection, ABN-TAB, and the generic fallback.
  const { accounts, txs, profile } = parseBankCsv(text, fallbackFromName(filename));
  // Nothing recognized (unknown header that maps no columns, or an empty file):
  // surface a problem rather than a silent empty success. No throw.
  if (accounts.length === 0 && txs.length === 0) {
    return { accounts, txs, source: profile, problems: ["onbekend of leeg bestand — geen transacties herkend"] };
  }
  return { accounts, txs, source: profile, problems: [] };
}
