import { fallbackFromName, parseBankFile, parseBankSheet, type Account } from "@lavega/core";
import type { BankAccessAdapter, BankResult } from "./BankAccessAdapter.js";

/* FileImport: the local-file banking adapter. Reads already-loaded file text
 * (this package does no disk I/O), routes it through @lavega/core's
 * parseBankFile format dispatcher (ING/ABN/Rabobank/Knab/Revolut/Amex/Trading
 * 212 CSV + MT940/.STA), and stamps the caller-supplied `entity` onto every
 * created account. Later adapters (EnableBanking, finAPI) implement this same
 * BankAccessAdapter interface over live bank APIs. */

export function createFileImport(): BankAccessAdapter {
  return {
    async load({ filename, text, entity, accountHint, sheet }): Promise<BankResult> {
      const opts = accountHint ? { accountHint } : {};
      const { accounts, txs, source, problems, unrecognised, unreadable } = sheet
        ? parseBankSheet(sheet.format, sheet.rows, fallbackFromName(filename), opts)
        : parseBankFile(filename, text, opts);
      // parseBankFile is entity-agnostic (it lives in pure core); the import-time
      // entity is stamped here so the overview groups the account correctly.
      const withEntity: Account[] = accounts.map((a) => ({ ...a, entity }));
      return {
        accounts: withEntity,
        txs,
        source,
        problems,
        unrecognised,
        unreadable: unreadable ?? 0,
      };
    },
  };
}
