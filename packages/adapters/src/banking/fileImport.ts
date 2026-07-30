import { norm, parseIngCsv, splitRows, type Account } from "@lavega/core";
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

function isIngHeader(headerLine: string): boolean {
  const h = norm(headerLine);
  return h.includes("af bij") && h.includes("bedrag (eur)");
}

/* Uses core's quote-aware splitRows (not a naive ';'-split) so a quoted embedded
 * ';' in an earlier free-text column (e.g. "Naam / Omschrijving") can't desync
 * the "Rekening" column index. */
function deriveIngAccountKey(rows: string[][], filename: string): string {
  const header = rows[0] ?? [];
  const rekeningIdx = header.findIndex((h) => norm(h) === "rekening");
  if (rekeningIdx > -1 && rows.length > 1) {
    const value = rows[1][rekeningIdx];
    if (value) return value;
  }
  return filename;
}

export function createFileImport(): BankAccessAdapter {
  return {
    async load({ filename, text, entity }): Promise<BankResult> {
      const rows = splitRows(text);
      const headerLine = (rows[0] ?? []).join(";");
      if (!isIngHeader(headerLine)) return unknownFormat();

      const key = deriveIngAccountKey(rows, filename);
      const account: Account = {
        key, iban: key, name: key, bank: "ING", entity, currency: "EUR", balance: null,
      };
      const txs = parseIngCsv(text, key);
      return { accounts: [account], txs, source: "ING", problems: [] };
    },
  };
}
