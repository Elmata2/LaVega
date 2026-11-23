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

/** What a rule editor action changes, as a PATCH rather than a replacement
 *  list. Applied against the CURRENT rules at write time so a rule added
 *  concurrently by a category save is never dropped. */
export type RulePatch =
  | { kind: "add"; rule: Rule }
  | { kind: "update"; rule: Rule }
  | { kind: "delete"; id: string }
  | { kind: "move"; id: string; delta: -1 | 1 };

export function applyRulePatch(rules: Rule[], patch: RulePatch): Rule[] {
  switch (patch.kind) {
    case "add":
      return rules.some((r) => r.id === patch.rule.id) ? rules : [...rules, patch.rule];
    case "update":
      return rules.some((r) => r.id === patch.rule.id)
        ? rules.map((r) => (r.id === patch.rule.id ? patch.rule : r))
        : rules;
    case "delete": {
      const next = rules.filter((r) => r.id !== patch.id);
      return next.length === rules.length ? rules : next;
    }
    case "move": {
      const index = rules.findIndex((r) => r.id === patch.id);
      if (index === -1) return rules;
      const target = index + patch.delta;
      if (target < 0 || target >= rules.length) return rules;
      const next = [...rules];
      const [row] = next.splice(index, 1);
      if (row === undefined) return rules;
      next.splice(target, 0, row);
      return next;
    }
  }
}

/** Merge new or modified transactions into the CURRENT list without touching
 *  unrelated rows (e.g. a row whose category changed while an import was
 *  running). */
export function applyTxUpserts(txs: Tx[], upserts: Tx[]): Tx[] {
  if (upserts.length === 0) return txs;
  const byId = new Map(upserts.map((t) => [t.id, t]));
  const updated = txs.map((t) => byId.get(t.id) ?? t);
  const have = new Set(txs.map((t) => t.id));
  const added = upserts.filter((t) => !have.has(t.id));
  return added.length === 0 ? updated : [...updated, ...added];
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

  function patchRules(patch: RulePatch): Promise<void> {
    return enqueue(async () => {
      const cur = io.getRules();
      const next = applyRulePatch(cur, patch);
      if (next === cur) return;
      await io.putRules(next);
      io.updateRules((prev) => applyRulePatch(prev, patch));
    });
  }

  function upsertTxs<R>(build: (cur: Tx[]) => { upserts: Tx[]; result: R }): Promise<R> {
    return enqueue(async () => {
      const { upserts, result } = build(io.getTxs());
      if (upserts.length > 0) {
        await io.putTxs(upserts);
        io.updateTxs((prev) => applyTxUpserts(prev, upserts));
      }
      return result;
    });
  }

  return { run, patchRules, upsertTxs, enqueue };
}
