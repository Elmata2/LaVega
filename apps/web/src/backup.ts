import type { CipherBlob, VaultStorage } from "@lavega/adapters";
import {
  buildAndVerifyLavegaExport,
  lavegaExportFilename,
  type LavegaExportManifest,
  type LavegaExportReadback,
} from "@lavega/core";

// Pure helpers for the encrypted back-up download/restore flow. No crypto
// here — the back-up IS the vault's own audited CipherBlob (Task 2-4); these
// just shape the filename and (de)serialize + shape-validate the file on disk.

export function backupFilename(dateStr: string): string {
  return `lavega-backup-${dateStr}.lavega`;
}

/** True when this back-up file carries the sealed document bytes (v3). */
export function backupCarriesDocuments(blob: CipherBlob): boolean {
  return blob.v === 3;
}

export function serializeBackup(blob: CipherBlob): string {
  return JSON.stringify(blob);
}

/** Parse + shape-validate a back-up file. Throws on anything that isn't a
 *  CipherBlob — the actual passphrase check happens later, in vault.restore. */
export function parseBackup(text: string): CipherBlob {
  const o = JSON.parse(text);
  // Sealed with the account's vault key: no KDF parameters to bound. Version 3
  // is the full bundle (vault + sealed document bytes); version 2 is the older
  // vault-only file, still restorable (it clears the document store).
  if (o?.v === 2 || o?.v === 3) {
    if (o.kdf !== "account-key" || typeof o.iv !== "string" || typeof o.ct !== "string")
      throw new Error("ongeldig back-upbestand");
    return o as CipherBlob;
  }
  if (
    !o ||
    o.v !== 1 ||
    o.kdf !== "PBKDF2-SHA256" ||
    typeof o.salt !== "string" ||
    typeof o.iv !== "string" ||
    typeof o.ct !== "string" ||
    typeof o.iterations !== "number" ||
    // Cap the KDF work factor: a crafted file with an absurd iteration count
    // would otherwise make crypto.subtle.deriveKey run for minutes and hang the
    // tab (self-inflicted DoS). The vault's real floor (210k) is enforced in
    // deriveKey; this bounds the top end before we ever derive.
    o.iterations < 1 ||
    o.iterations > 10_000_000
  ) {
    throw new Error("ongeldig back-upbestand");
  }
  return o as CipherBlob;
}

/** The portable export, built from the OPEN vault (WS6.1, issue #302).
 *
 * The `.lavega` download above is an encrypted blob: restorable, not readable.
 * This one reads every portable section through the storage interface and hands
 * the bytes to a versioned ZIP writer in core, then reads the very bytes back
 * before the caller downloads them. A download that cannot be read back is a
 * bug, so the UI gets the readback report and can say so.
 *
 * Runs in the browser after unlock: the plaintext never leaves the machine
 * except as the file the owner asks for (ADR 0009). */
export async function buildPortableExport(
  storage: VaultStorage,
  asOf: string,
  appVersion?: string,
): Promise<{
  bytes: Uint8Array;
  filename: string;
  manifest: LavegaExportManifest;
  readback: LavegaExportReadback;
}> {
  const [
    accounts,
    transactions,
    rules,
    transfers,
    merchants,
    bills,
    billOccurrences,
    billDecisions,
    budgetPeriods,
    categoryGroups,
    scheduledFlows,
    invoices,
    vatSettings,
    valuations,
    importSessions,
    documents,
    fxHistory,
  ] = await Promise.all([
    storage.getAccounts(),
    storage.getTxs(),
    storage.getRules(),
    storage.getTransfers(),
    storage.getMerchants(),
    storage.getBills(),
    storage.getBillOccurrences(),
    storage.getBillDecisions(),
    storage.getBudgetPeriods(),
    storage.getCategoryGroups(),
    storage.getScheduledFlows(),
    storage.getInvoices(),
    storage.getVatSettings(),
    storage.getValuations(),
    storage.getImportSessions(),
    storage.getDocuments(),
    storage.getFxHistory(),
  ]);
  const built = buildAndVerifyLavegaExport({
    createdAt: asOf,
    ...(appVersion == null ? {} : { appVersion }),
    accounts,
    transactions,
    rules,
    transfers,
    merchants,
    bills,
    billOccurrences,
    billDecisions,
    budgetPeriods,
    categoryGroups,
    scheduledFlows,
    invoices,
    vatSettings,
    valuations,
    importSessions,
    documents,
    fxHistory,
  });
  return {
    ...built,
    filename: lavegaExportFilename(asOf),
  };
}
