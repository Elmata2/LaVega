import { norm, parseIngCsv, type Account } from "@lavega/core";
import type { BankAccessAdapter, BankResult } from "./BankAccessAdapter.js";

/* FileImport: the local-file banking adapter. Reads CSV text (already read from
 * disk by the caller — this package does no file I/O of its own), sniffs the
 * header to identify the bank export format, and delegates the actual row
 * parsing to @lavega/core's parseIngCsv. Later adapters (EnableBanking, finAPI)
 * implement the same BankAccessAdapter interface over live bank APIs. */

// Fresh object per call — never share a module-level literal, since callers may
// mutate the returned arrays (e.g. result.problems.push(...)).
function unknownFormat(): BankResult {
  return { accounts: [], txs: [], source: "", problems: ["onbekend CSV-formaat"] };
}

function nonBlankLines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim() !== "");
}

/* Minimal, non-quote-aware field split used only to locate the "Rekening"
 * column's value for the account key — NOT a general CSV parser (that's
 * parseIngCsv's job). Good enough for ING's simple quoted-field header/rows. */
function splitFields(line: string): string[] {
  return line.split(";").map((c) => c.replace(/^"|"$/g, "").trim());
}

function isIngHeader(headerLine: string): boolean {
  const h = norm(headerLine);
  return h.includes("af bij") && h.includes("bedrag (eur)");
}

function deriveIngAccountKey(lines: string[], filename: string): string {
  const header = splitFields(lines[0] ?? "");
  const rekeningIdx = header.findIndex((h) => norm(h) === "rekening");
  if (rekeningIdx > -1 && lines.length > 1) {
    const value = splitFields(lines[1])[rekeningIdx];
    if (value) return value;
  }
  return filename;
}

export function createFileImport(): BankAccessAdapter {
  return {
    async load({ filename, text, entity }): Promise<BankResult> {
      const lines = nonBlankLines(text);
      const headerLine = lines[0] ?? "";
      if (!isIngHeader(headerLine)) return unknownFormat();

      const key = deriveIngAccountKey(lines, filename);
      const account: Account = {
        key, iban: key, name: key, bank: "ING", entity, currency: "EUR", balance: null,
      };
      const txs = parseIngCsv(text, key);
      return { accounts: [account], txs, source: "ING", problems: [] };
    },
  };
}
