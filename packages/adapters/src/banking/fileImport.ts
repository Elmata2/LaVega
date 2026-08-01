import { parseBankFile, type Account } from "@lavega/core";
import type { BankAccessAdapter, BankResult } from "./BankAccessAdapter.js";

/* FileImport: the local-file banking adapter. Reads already-loaded file text
 * (this package does no disk I/O), routes it through @lavega/core's
 * parseBankFile format dispatcher (ING/ABN/Rabobank/Knab/Revolut/Amex/Trading
 * 212 CSV + MT940/.STA), and stamps the caller-supplied `entity` onto every
 * created account. Later adapters (EnableBanking, finAPI) implement this same
 * BankAccessAdapter interface over live bank APIs. */

export function createFileImport(): BankAccessAdapter {
  return {
    async load({ filename, text, entity }): Promise<BankResult> {
      const { accounts, txs, source, problems } = parseBankFile(filename, text);
      // parseBankFile is entity-agnostic (it lives in pure core); the import-time
      // entity is stamped here so the overview groups the account correctly.
      const withEntity: Account[] = accounts.map((a) => ({ ...a, entity }));
      return { accounts: withEntity, txs, source, problems };
    },
  };
}
