import { fingerprint, type Proposal } from "./evidence.js";

/** A `Proposal` (Task 2) plus the figures the card shows. `kind` stays the
 *  card's name; the payload lives in `data`. */
export type DataProposal<K extends string, D> = Proposal<K> & { data: D };

/** Fewer than three transactions behind a fact is a thin guess. */
export const THIN_BELOW = 3;

export function makeProposal<K extends string, D>(
  kind: K,
  evidence: readonly string[],
  data: D,
): DataProposal<K, D> {
  const ids = [...new Set(evidence)];
  const fp = fingerprint(ids);
  return {
    id: `${kind}:${fp}`,
    kind,
    evidence: ids,
    fingerprint: fp,
    confidence: ids.length >= THIN_BELOW ? "enough" : "thin",
    data,
  };
}
