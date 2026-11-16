import type { Rule, Tx } from "@lavega/core";

/** What a categorisation changes, as a PATCH rather than a replacement list:
 *  which txs get which category (always `manual`), and which rules are new. A
 *  patch is applied to the CURRENT state, so rows or rules that arrived while a
 *  save was awaiting (bank sync, file import, another save) are never lost. */
export type CategorizePatch = {
  txs: { id: string; category: string }[];
  rules: Rule[];
};

/** The patch between a list before and after a pure categorise step: the txs
 *  whose category/manual flag changed, and the rules appended. */
export function diffPatch(
  prev: { txs: Tx[]; rules: Rule[] },
  next: { txs: Tx[]; rules: Rule[] },
): CategorizePatch {
  const before = new Map(prev.txs.map((t) => [t.id, t]));
  const known = new Set(prev.rules.map((r) => r.id));
  return {
    txs: next.txs
      .filter((t) => {
        const b = before.get(t.id);
        return b !== undefined && (b.category !== t.category || b.manual !== t.manual);
      })
      .map((t) => ({ id: t.id, category: t.category })),
    rules: next.rules.filter((r) => !known.has(r.id)),
  };
}

export function applyTxPatch(txs: Tx[], patch: CategorizePatch): Tx[] {
  if (patch.txs.length === 0) return txs;
  const by = new Map(patch.txs.map((p) => [p.id, p.category]));
  return txs.map((t) => (by.has(t.id) ? { ...t, category: by.get(t.id)!, manual: true } : t));
}

export function addMissingRules(rules: Rule[], add: Rule[]): Rule[] {
  const have = new Set(rules.map((r) => r.id));
  const fresh = add.filter((r) => !have.has(r.id));
  return fresh.length === 0 ? rules : [...rules, ...fresh];
}

export type SaverIo = {
  /** The newest txs/rules the app knows (refs kept current by the caller). */
  getTxs: () => Tx[];
  getRules: () => Rule[];
  /** Functional updaters: they run against the CURRENT React state. */
  updateTxs: (fn: (prev: Tx[]) => Tx[]) => void;
  updateRules: (fn: (prev: Rule[]) => Rule[]) => void;
  putTxs: (txs: Tx[]) => Promise<void>;
  putRules: (rules: Rule[]) => Promise<void>;
};

/** ONE in-flight queue for every categorise save (the per-row picker and the AI
 *  apply flow), so two saves can never interleave.
 *
 *  Each job reads the newest txs/rules when it STARTS, writes only what its
 *  patch changed (txs are upserted; the rule set is read-modify-write against
 *  the newest rules at write time), and commits through functional updaters.
 *  Storage is written first and state committed after each write: a rejected tx
 *  write commits nothing and rethrows; a rejected rule write keeps the txs,
 *  leaves the in-memory rules alone and comes back as `rulesError`. */
export function createCategorizeSaver(io: SaverIo) {
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job, job);
    tail = run.catch(() => {});
    return run;
  }

  function run<R>(
    build: (cur: { txs: Tx[]; rules: Rule[] }) => { patch: CategorizePatch; result: R },
  ): Promise<{ result: R; rulesError?: unknown }> {
    return enqueue(async () => {
      const { patch, result } = build({ txs: io.getTxs(), rules: io.getRules() });
      if (patch.txs.length > 0) {
        const ids = new Set(patch.txs.map((p) => p.id));
        const changed = applyTxPatch(
          io.getTxs().filter((t) => ids.has(t.id)),
          patch,
        );
        await io.putTxs(changed);
        io.updateTxs((prev) => applyTxPatch(prev, patch));
      }
      const merged = addMissingRules(io.getRules(), patch.rules);
      if (merged === io.getRules()) return { result };
      try {
        await io.putRules(addMissingRules(io.getRules(), patch.rules));
      } catch (rulesError) {
        return { result, rulesError };
      }
      io.updateRules((prev) => addMissingRules(prev, patch.rules));
      return { result };
    });
  }

  return { run, enqueue };
}
