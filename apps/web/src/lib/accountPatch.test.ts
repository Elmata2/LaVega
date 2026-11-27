import { expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { createAccountEditor, mergePatch, patchAccount } from "./accountPatch";

const acc = (key: string, over: Partial<Account> = {}): Account => ({
  key,
  iban: "",
  name: "Card",
  bank: "Bank",
  entity: "P",
  currency: "EUR",
  balance: null,
  ...over,
});

test("#369-7: two edits made before any re-render both survive", () => {
  const ref = { current: [acc("a"), acc("b")] };
  const first = patchAccount(ref, "a", { type: "Creditcard" });
  const second = patchAccount(ref, "a", { statedCardId: "ing-creditcard" });
  expect(first).toMatchObject({ type: "Creditcard" });
  expect(second).toMatchObject({ type: "Creditcard", statedCardId: "ing-creditcard" });
  expect(ref.current.find((x) => x.key === "a")).toEqual(second);
  expect(ref.current.find((x) => x.key === "b")).toEqual(acc("b"));
});

test("an unknown key changes nothing", () => {
  const ref = { current: [acc("a")] };
  expect(patchAccount(ref, "zzz", { type: "x" })).toBeNull();
  expect(ref.current).toEqual([acc("a")]);
});

test("#369-7: the state update merges only the patched fields into the current account", () => {
  const ref = { current: [acc("a")] };
  patchAccount(ref, "a", { type: "Creditcard" });
  const afterBalanceSave = [acc("a", { balance: 42 })];
  const next = mergePatch("a", { type: "Creditcard" })(afterBalanceSave);
  expect(next[0]).toMatchObject({ type: "Creditcard", balance: 42 });
});

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const rig = (accounts: Account[]) => {
  const ref = { current: accounts as readonly Account[] };
  let state = accounts;
  const writes: Account[] = [];
  const pending: ReturnType<typeof deferred>[] = [];
  const editor = createAccountEditor({
    ref,
    setState: (u) => {
      state = u(state);
    },
    put: (a) => {
      writes.push(...a);
      const d = deferred();
      pending.push(d);
      return d.promise;
    },
  });
  return { editor, writes, pending, state: () => state, ref };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

test("#369-7: two edits of different fields while the first write is pending: both in state and in the last write", async () => {
  const r = rig([acc("a")]);
  const first = r.editor.edit("a", { type: "Creditcard" }, { persist: true });
  const second = r.editor.edit("a", { statedCardId: "ing-creditcard" }, { persist: true });
  await tick();
  r.pending[0]!.resolve();
  await tick();
  r.pending[1]!.resolve();
  await Promise.all([first, second]);
  expect(r.state()[0]).toMatchObject({ type: "Creditcard", statedCardId: "ing-creditcard" });
  expect(r.writes.at(-1)).toMatchObject({ type: "Creditcard", statedCardId: "ing-creditcard" });
  expect(r.writes).toHaveLength(2);
});

test("#369-7: a balance edit pending while a type edit lands: neither is lost in state or storage", async () => {
  const r = rig([acc("a")]);
  const balance = r.editor.edit(
    "a",
    { balance: -250, balanceDate: "2026-11-25" },
    { persist: true },
  );
  const type = r.editor.edit("a", { type: "Creditcard" }, { persist: true });
  await tick();
  r.pending[0]!.resolve();
  await tick();
  r.pending[1]!.resolve();
  await Promise.all([balance, type]);
  expect(r.state()[0]).toMatchObject({ balance: -250, type: "Creditcard" });
  expect(r.writes.at(-1)).toMatchObject({ balance: -250, type: "Creditcard" });
});

test("#369-7: a failed write undoes only its own field and keeps a newer edit of the same field", async () => {
  const r = rig([acc("a", { statedCardId: "old" })]);
  const failing = r.editor.edit("a", { statedCardId: "x", type: "Creditcard" }, { persist: true });
  const failed = failing.catch((e: Error) => e.message);
  const newer = r.editor.edit("a", { statedCardId: "y" }, { persist: true });
  await tick();
  r.pending[0]!.reject(new Error("boom"));
  expect(await failed).toBe("boom");
  await tick();
  r.pending[1]!.resolve();
  await newer;
  expect(r.state()[0]).toMatchObject({ statedCardId: "y" });
  expect(r.state()[0]!.type).toBeUndefined();
  expect(r.writes.at(-1)).toMatchObject({ statedCardId: "y" });
});

test("#369-7: a failed write with no newer edit restores the old value", async () => {
  const r = rig([acc("a", { statedCardId: "old" })]);
  const p = r.editor.edit("a", { statedCardId: "x" }, { persist: true }).catch(() => "failed");
  await tick();
  r.pending[0]!.reject(new Error("boom"));
  expect(await p).toBe("failed");
  expect(r.state()[0]!.statedCardId).toBe("old");
  expect(r.ref.current[0]!.statedCardId).toBe("old");
});

test("#369-7: edits to two different accounts do not wait for each other", async () => {
  const r = rig([acc("a"), acc("b")]);
  void r.editor.edit("a", { type: "x" }, { persist: true });
  void r.editor.edit("b", { type: "y" }, { persist: true });
  await tick();
  expect(r.writes.map((w) => w.key).sort()).toEqual(["a", "b"]);
});

test("#369-7: the generic field change goes through the same path, without a write", async () => {
  const r = rig([acc("a")]);
  await r.editor.edit("a", { name: "Typing" });
  expect(r.state()[0]!.name).toBe("Typing");
  expect(r.ref.current[0]!.name).toBe("Typing");
  expect(r.writes).toHaveLength(0);
});

test("#369-7: two edits of one field that both fail end on the stored old value", async () => {
  const r = rig([acc("a", { type: "Old" })]);
  const one = r.editor.edit("a", { type: "X" }, { persist: true }).catch(() => "f1");
  const two = r.editor.edit("a", { type: "Y" }, { persist: true }).catch(() => "f2");
  await tick();
  r.pending[0]!.reject(new Error("boom"));
  await tick();
  r.pending[1]!.reject(new Error("boom"));
  expect([await one, await two]).toEqual(["f1", "f2"]);
  expect(r.state()[0]!.type).toBe("Old");
  expect(r.ref.current[0]!.type).toBe("Old");
});

test("#369-7: a queued edit of the same value as a failed one still writes it", async () => {
  const r = rig([acc("a", { type: "Old" })]);
  const one = r.editor.edit("a", { type: "C" }, { persist: true }).catch(() => "f1");
  const two = r.editor.edit("a", { type: "C" }, { persist: true });
  await tick();
  r.pending[0]!.reject(new Error("boom"));
  await one;
  await tick();
  r.pending[1]!.resolve();
  await two;
  expect(r.state()[0]!.type).toBe("C");
  expect(r.writes.at(-1)!.type).toBe("C");
});

test("#369-7: three edits, the middle write fails, the last succeeds: state and storage hold the last value", async () => {
  const r = rig([acc("a", { type: "Old" })]);
  const one = r.editor.edit("a", { type: "X" }, { persist: true });
  const two = r.editor.edit("a", { type: "Y" }, { persist: true }).catch(() => "f2");
  const three = r.editor.edit("a", { type: "Z" }, { persist: true });
  await tick();
  r.pending[0]!.resolve();
  await tick();
  r.pending[1]!.reject(new Error("boom"));
  await tick();
  r.pending[2]!.resolve();
  await Promise.all([one, two, three]);
  expect(r.state()[0]!.type).toBe("Z");
  expect(r.writes.at(-1)!.type).toBe("Z");
});

test("#369-7: a failed edit of field A does not disturb a pending edit of field B", async () => {
  const r = rig([acc("a", { type: "Old" })]);
  const a = r.editor.edit("a", { type: "X" }, { persist: true }).catch(() => "fa");
  const b = r.editor.edit("a", { statedCardId: "card" }, { persist: true });
  await tick();
  r.pending[0]!.reject(new Error("boom"));
  await a;
  expect(r.state()[0]).toMatchObject({ type: "Old", statedCardId: "card" });
  await tick();
  r.pending[1]!.resolve();
  await b;
  expect(r.writes.at(-1)).toMatchObject({ type: "Old", statedCardId: "card" });
});

test("#369-7: an edit for an account that is gone rejects", async () => {
  const r = rig([acc("a")]);
  await expect(r.editor.edit("zzz", { type: "x" }, { persist: true })).rejects.toThrow(/zzz/);
  const p = r.editor.edit("a", { type: "x" }, { persist: true });
  r.ref.current = [];
  await expect(p).rejects.toThrow(/a/);
  expect(r.writes).toHaveLength(0);
});

test("#387: prior write success does not snapshot unpersisted newer optimistic edits into persisted", async () => {
  const r = rig([acc("a", { type: "Old", statedCardId: "init" })]);
  const first = r.editor.edit("a", { type: "NewType" }, { persist: true });
  const second = r.editor
    .edit("a", { statedCardId: "optimistic" }, { persist: true })
    .catch((e: Error) => e.message);
  await tick();
  r.pending[0]!.resolve();
  await first;
  await tick();
  r.pending[1]!.reject(new Error("second-failed"));
  expect(await second).toBe("second-failed");
  expect(r.state()[0]!.type).toBe("NewType");
  expect(r.state()[0]!.statedCardId).toBe("init");
});
