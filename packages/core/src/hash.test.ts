import { expect, test } from "vitest";
import { hash, assignTxIds } from "./hash.js";

test("hash is djb2, byte-exact with Kasoverzicht", () => {
  // GOLDEN: run the reference hash() from Kasoverzicht.html line 308 in Node once, paste the output:
  expect(hash("abc")).toBe("3772q3");
});

const base = {
  accountKey: "NL01",
  date: "2026-01-02",
  amount: -10,
  currency: "EUR",
  counterparty: "Shop",
  description: "x",
  category: "",
  manual: false,
};

test("id is a single djb2 token — the counter is hashed IN, not appended", () => {
  const [a] = assignTxIds([{ ...base }]);
  expect(a.id).not.toContain("#");
});

test("identical same-day rows get distinct ids; the same row in a fresh import is stable", () => {
  const [a, b] = assignTxIds([{ ...base }, { ...base }]);
  expect(a.id).not.toBe(b.id); // n=1 then n=2, hashed in
  const [c] = assignTxIds([{ ...base }]); // fresh batch → counter resets → n=1
  expect(c.id).toBe(a.id); // stable across imports
});
