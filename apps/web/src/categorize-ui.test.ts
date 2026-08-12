import { expect, test } from "vitest";
import type { Tx } from "@lavega/core";
import { buildCategorizeItems, toDecisions } from "./categorize-ui.js";

function tx(over: Partial<Tx>): Tx {
  return {
    id: "t1",
    date: "2026-08-01",
    amount: -12.5,
    counterparty: "Albert Heijn",
    description: "pinbetaling",
    bank: "ING",
    accountKey: "NL01",
    entity: "Prive",
    ...over,
  } as Tx;
}

test("buildCategorizeItems maps to {id,text,sign} only — no amount/account/date leaks", () => {
  const items = buildCategorizeItems([tx({})]);
  expect(items).toEqual([{ id: "t1", text: "Albert Heijn pinbetaling", sign: "out" }]);
  // The redaction boundary: nothing beyond the three allowlisted fields.
  expect(Object.keys(items[0]).sort()).toEqual(["id", "sign", "text"]);
});

test("buildCategorizeItems derives sign from amount and trims text to 200 chars", () => {
  const long = "X".repeat(300);
  const items = buildCategorizeItems([
    tx({ id: "in", amount: 2000, counterparty: "Salaris", description: "" }),
    tx({ id: "big", counterparty: long, description: long }),
  ]);
  expect(items[0]).toEqual({ id: "in", text: "Salaris", sign: "in" });
  expect(items[1].text.length).toBe(200);
});

test("toDecisions drops rows left on 'Sla over' (empty category)", () => {
  const decisions = toDecisions([
    { id: "t1", category: "Boodschappen" },
    { id: "t2", category: "" },
    { id: "t3", category: "Inkomen" },
  ]);
  expect(decisions).toEqual([
    { id: "t1", category: "Boodschappen" },
    { id: "t3", category: "Inkomen" },
  ]);
});
