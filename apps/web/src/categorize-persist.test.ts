import { expect, test, vi } from "vitest";
import type { Rule, Tx } from "@lavega/core";
import { createCategorizeSaver, diffPatch, type CategorizePatch } from "./categorize-persist";

const tx = (id: string, category = ""): Tx => ({
  id,
  accountKey: "A",
  date: "2026-01-01",
  amount: -1,
  currency: "EUR",
  counterparty: id,
  description: "",
  category,
  manual: category !== "",
});
const rule = (id: string): Rule => ({ id, match: id, category: "Transport" });

/** A tiny fake app: refs + state + a "vault" whose writes can be held open. */
function harness(init: { txs: Tx[]; rules: Rule[] }) {
  const s = { txs: init.txs, rules: init.rules };
  const vault = { txs: new Map(init.txs.map((t) => [t.id, t])), rules: init.rules };
  const gate: { hold: Promise<void> | null } = { hold: null };
  const putTxs = vi.fn(async (t: Tx[]) => {
    if (gate.hold) await gate.hold;
    for (const x of t) vault.txs.set(x.id, x);
  });
  const putRules = vi.fn(async (r: Rule[]) => {
    if (gate.hold) await gate.hold;
    vault.rules = r;
  });
  const saver = createCategorizeSaver({
    getTxs: () => s.txs,
    getRules: () => s.rules,
    updateTxs: (fn) => (s.txs = fn(s.txs)),
    updateRules: (fn) => (s.rules = fn(s.rules)),
    putTxs,
    putRules,
  });
  return { s, vault, saver, gate, putTxs, putRules };
}
const patch = (id: string, category: string, rules: Rule[] = []): CategorizePatch => ({
  txs: [{ id, category }],
  rules,
});

test("diffPatch carries only the changed txs and the appended rules", () => {
  const a = { txs: [tx("t1"), tx("t2")], rules: [rule("r0")] };
  const b = { txs: [tx("t1", "Transport"), tx("t2")], rules: [rule("r0"), rule("r1")] };
  const p = diffPatch(a, b);
  expect(p.txs).toEqual([{ id: "t1", category: "Transport" }]);
  expect(p.rules.map((r) => r.id)).toEqual(["r1"]);
});

test("(a) rows added by a sync while a save awaits are still there, and the change is applied", async () => {
  const h = harness({ txs: [tx("t1")], rules: [] });
  let release!: () => void;
  h.gate.hold = new Promise((r) => (release = r));
  const saving = h.saver.run(() => ({ patch: patch("t1", "Transport"), result: null }));
  // a bank sync lands during the await: it replaces state with a longer list
  await Promise.resolve();
  h.s.txs = [...h.s.txs, tx("new1"), tx("new2")];
  h.gate.hold = null;
  release();
  await saving;
  expect(h.s.txs.map((t) => t.id)).toEqual(["t1", "new1", "new2"]);
  expect(h.s.txs.find((t) => t.id === "t1")).toMatchObject({ category: "Transport", manual: true });
  expect(h.vault.txs.get("t1")).toMatchObject({ category: "Transport", manual: true });
  // storage got only the changed tx, not the whole list
  expect(h.putTxs).toHaveBeenCalledWith([expect.objectContaining({ id: "t1" })]);
});

test("(b) a rule added by another path during the await survives in state and storage", async () => {
  const h = harness({ txs: [tx("t1")], rules: [] });
  let release!: () => void;
  h.gate.hold = new Promise((r) => (release = r));
  const saving = h.saver.run(() => ({
    patch: patch("t1", "Transport", [rule("mine")]),
    result: null,
  }));
  await Promise.resolve();
  h.s.rules = [...h.s.rules, rule("elsewhere")]; // another path added a rule
  h.gate.hold = null;
  release();
  await saving;
  expect(h.s.rules.map((r) => r.id).sort()).toEqual(["elsewhere", "mine"]);
  expect(h.vault.rules.map((r) => r.id).sort()).toEqual(["elsewhere", "mine"]);
});

test("(c) two saves started back to back run one after the other and both persist", async () => {
  const h = harness({ txs: [tx("t1"), tx("t2")], rules: [] });
  const order: string[] = [];
  let release!: () => void;
  h.gate.hold = new Promise((r) => (release = r));
  const first = h.saver
    .run(() => ({ patch: patch("t1", "Transport", [rule("r1")]), result: 1 }))
    .then(() => order.push("first"));
  const second = h.saver
    .run((cur) => {
      // the second job's builder sees the first job's committed result
      expect(cur.txs.find((t) => t.id === "t1")?.category).toBe("Transport");
      expect(cur.rules.map((r) => r.id)).toEqual(["r1"]);
      return { patch: patch("t2", "Boodschappen", [rule("r2")]), result: 2 };
    })
    .then(() => order.push("second"));
  h.gate.hold = null;
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(["first", "second"]);
  expect(h.vault.txs.get("t1")?.category).toBe("Transport");
  expect(h.vault.txs.get("t2")?.category).toBe("Boodschappen");
  expect(h.vault.rules.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  expect(h.s.rules.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
});

test("a rejected tx write commits nothing, rethrows, and the queue keeps working", async () => {
  const h = harness({ txs: [tx("t1")], rules: [] });
  h.putTxs.mockRejectedValueOnce(new Error("disk"));
  await expect(
    h.saver.run(() => ({ patch: patch("t1", "Transport", [rule("r")]), result: 0 })),
  ).rejects.toThrow("disk");
  expect(h.s.txs[0]!.category).toBe("");
  expect(h.s.rules).toEqual([]);
  expect(h.putRules).not.toHaveBeenCalled();
  await h.saver.run(() => ({ patch: patch("t1", "Transport"), result: 0 }));
  expect(h.s.txs[0]!.category).toBe("Transport");
});

test("a rejected rule write keeps the txs, drops the rule, and reports it", async () => {
  const h = harness({ txs: [tx("t1")], rules: [] });
  h.putRules.mockRejectedValueOnce(new Error("rules"));
  const out = await h.saver.run(() => ({
    patch: patch("t1", "Transport", [rule("r")]),
    result: 0,
  }));
  expect(out.rulesError).toBeInstanceOf(Error);
  expect(h.s.txs[0]!.category).toBe("Transport");
  expect(h.s.rules).toEqual([]);
});

test("a patch with no new rule does not write rules", async () => {
  const h = harness({ txs: [tx("t1")], rules: [rule("r")] });
  await h.saver.run(() => ({ patch: patch("t1", "Transport", [rule("r")]), result: 0 }));
  expect(h.putRules).not.toHaveBeenCalled();
});
