import { expect, test, vi } from "vitest";
import type { Rule, Tx } from "@lavega/core";
import { persistCategorized } from "./categorize-persist";

const tx = (category: string): Tx => ({
  id: "t1",
  accountKey: "A",
  date: "2026-01-01",
  amount: -1,
  currency: "EUR",
  counterparty: "X",
  description: "",
  category,
  manual: category !== "",
});
const rule: Rule = { id: "r1", match: "x", category: "Transport" };

const io = (over: Partial<Parameters<typeof persistCategorized>[0]> = {}) => ({
  prevRules: [] as Rule[],
  next: { txs: [tx("Transport")], rules: [rule] },
  putTxs: vi.fn(async () => {}),
  putRules: vi.fn(async () => {}),
  commitTxs: vi.fn(),
  commitRules: vi.fn(),
  ...over,
});

test("success writes both, then commits both", async () => {
  const a = io();
  expect(await persistCategorized(a)).toEqual({});
  expect(a.commitTxs).toHaveBeenCalledWith([tx("Transport")]);
  expect(a.commitRules).toHaveBeenCalledWith([rule]);
});

test("a rejected tx write commits nothing and rethrows: the old category stays on screen", async () => {
  const a = io({ putTxs: vi.fn(async () => Promise.reject(new Error("disk"))) });
  await expect(persistCategorized(a)).rejects.toThrow("disk");
  expect(a.commitTxs).not.toHaveBeenCalled();
  expect(a.commitRules).not.toHaveBeenCalled();
  expect(a.putRules).not.toHaveBeenCalled();
});

test("a rejected rule write keeps the tx, drops the rule, and reports it", async () => {
  const a = io({ putRules: vi.fn(async () => Promise.reject(new Error("rules"))) });
  const out = await persistCategorized(a);
  expect(out.rulesError).toBeInstanceOf(Error);
  expect(a.commitTxs).toHaveBeenCalledTimes(1);
  expect(a.commitRules).not.toHaveBeenCalled();
});

test("no new rule means no rule write", async () => {
  const a = io({ prevRules: [rule] });
  await persistCategorized(a);
  expect(a.putRules).not.toHaveBeenCalled();
});
