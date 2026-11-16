import type { Rule, Tx } from "@lavega/core";

/** Write a categorisation so that what the screen shows equals what is stored.
 *
 *  Storage is written FIRST and React state is committed only after its write
 *  succeeded, so a rejected write leaves the screen exactly as it was (the
 *  previous category stays visible) and the error propagates to the caller.
 *  The two writes are independent: when the tx write succeeds but the rule
 *  write rejects, the txs stay committed, the in-memory rules stay as they
 *  were, and the rule error comes back as `rulesError` — the category is set,
 *  but not remembered. */
export async function persistCategorized(io: {
  prevRules: Rule[];
  next: { txs: Tx[]; rules: Rule[] };
  putTxs: (txs: Tx[]) => Promise<void>;
  putRules: (rules: Rule[]) => Promise<void>;
  commitTxs: (txs: Tx[]) => void;
  commitRules: (rules: Rule[]) => void;
}): Promise<{ rulesError?: unknown }> {
  await io.putTxs(io.next.txs);
  io.commitTxs(io.next.txs);
  if (io.next.rules.length === io.prevRules.length) return {};
  try {
    await io.putRules(io.next.rules);
  } catch (rulesError) {
    return { rulesError };
  }
  io.commitRules(io.next.rules);
  return {};
}
