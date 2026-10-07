import type { VaultOpenResult } from "@lavega/adapters";

/** What the page shows before the app: nothing to ask in the normal case.
 *  `password-vault` is a one-time step for a vault from before accounts held
 *  the key; `key-error` is a key the server could not hand over. */
export type GateState =
  | "loading"
  | "password-vault"
  | { error: "unreachable" | "unreadable" }
  | "ready";

export function gateState(result: VaultOpenResult): GateState {
  return result === "password-vault" ? "password-vault" : "ready";
}
