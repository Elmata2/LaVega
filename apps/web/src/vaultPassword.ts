/**
 * The rule for a NEW vault password.
 *
 * The gate used to be `pass1.length > 0` — one character made a valid vault.
 * That undercut the crypto underneath it, which is otherwise sound: the threat
 * here is an OFFLINE attack. The .lavega backup file is meant to be downloaded
 * and kept somewhere, and whoever holds that file can guess without limit. At
 * 210k PBKDF2 iterations a four-digit pin falls in seconds and a dictionary
 * word in minutes, however good the cipher is.
 *
 * Deliberately NOT applied when unlocking or restoring: those check a password
 * that already exists, and refusing a short one there would lock the owner out
 * of a backup made before this rule — protecting nothing, since the attacker
 * with the file does not use this screen.
 */
export const MIN_VAULT_PASSWORD = 12;

export function vaultPasswordProblem(pass: string): string | null {
  if (pass.length < MIN_VAULT_PASSWORD) {
    return `Gebruik minstens ${MIN_VAULT_PASSWORD} tekens — je kluis-back-up kan offline onbeperkt geraden worden.`;
  }
  // Length on its own is not strength: "aaaaaaaaaaaa" clears the bar and falls
  // to the first thing any cracker tries.
  if (new Set(pass).size < 4) {
    return "Te weinig variatie — gebruik meer verschillende tekens, bijvoorbeeld een zin van een paar woorden.";
  }
  return null;
}
