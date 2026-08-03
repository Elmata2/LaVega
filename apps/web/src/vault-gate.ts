import type { VaultStatus } from "@lavega/adapters";

export type GateState = "loading" | "setup" | "migrate" | "unlock" | "ready";

/** status "unlocked" => ready. "locked" => unlock. "empty" => migrate if legacy
 *  plaintext data exists, else setup. */
export function gateState(status: VaultStatus | null, hasLegacyData: boolean): GateState {
  if (status === null) return "loading";
  if (status === "unlocked") return "ready";
  if (status === "locked") return "unlock";
  return hasLegacyData ? "migrate" : "setup"; // status === "empty"
}
