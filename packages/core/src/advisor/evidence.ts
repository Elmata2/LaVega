import { hash } from "../hash.js";

/** Stable identity of a set of evidence ids: order- and duplicate-independent.
 *  The same transactions give the same fingerprint; one more or fewer gives a
 *  different one, which is what lets "Not mine" stay removed only until the
 *  underlying data changes. */
export function fingerprint(evidenceIds: readonly string[]): string {
  return hash([...new Set(evidenceIds)].sort().join("|"));
}

/** A fact the inference proposes for the user to confirm, correct or reject.
 *  `kind` names the card; `evidence` holds the transaction ids it rests on. */
export interface Proposal<T extends string = string> {
  id: string;
  kind: T;
  evidence: string[];
  fingerprint: string;
  confidence: "enough" | "thin";
}
