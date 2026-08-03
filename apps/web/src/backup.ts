import type { CipherBlob } from "@lavega/adapters";

// Pure helpers for the encrypted back-up download/restore flow. No crypto
// here — the back-up IS the vault's own audited CipherBlob (Task 2-4); these
// just shape the filename and (de)serialize + shape-validate the file on disk.

export function backupFilename(dateStr: string): string {
  return `lavega-backup-${dateStr}.lavega`;
}

export function serializeBackup(blob: CipherBlob): string {
  return JSON.stringify(blob);
}

/** Parse + shape-validate a back-up file. Throws on anything that isn't a
 *  CipherBlob — the actual passphrase check happens later, in vault.restore. */
export function parseBackup(text: string): CipherBlob {
  const o = JSON.parse(text);
  if (
    !o ||
    o.v !== 1 ||
    o.kdf !== "PBKDF2-SHA256" ||
    typeof o.salt !== "string" ||
    typeof o.iv !== "string" ||
    typeof o.ct !== "string" ||
    typeof o.iterations !== "number"
  ) {
    throw new Error("ongeldig back-upbestand");
  }
  return o as CipherBlob;
}
