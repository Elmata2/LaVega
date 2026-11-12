import { expect, test } from "vitest";
import type { RuleAction, RuleCondition, RuleTx, RuleV2 } from "./model.js";
import { compileRules } from "./compile.js";
import { evaluateRules, locksForTx } from "./evaluate.js";

const tx = (overrides: Partial<RuleTx> = {}): RuleTx => ({
  id: "t1",
  accountKey: "NL01INGB0001",
  date: "2026-06-15",
  amount: -12.34,
  counterparty: "Albert Heijn",
  description: "Boodschappen",
  category: "",
  manual: false,
  ...overrides,
});

const rule = (
  id: string,
  conditions: RuleCondition[],
  actions: RuleAction[],
  extra: Partial<Pick<RuleV2, "stopProcessing" | "effectiveFrom" | "name">> = {},
): RuleV2 => ({ v: 2, id, conditions, actions, ...extra });

const cat = (category: string): RuleAction => ({ kind: "setCategory", category });

const evaluate = (t: RuleTx, rules: RuleV2[], locks = {}) =>
  evaluateRules(t, compileRules(rules), locks);

/* --- first claims -------------------------------------------------------- */

test("first claim wins per attribute ACROSS rules; the rest still claim unclaimed attributes", () => {
  const rules = [
    rule(
      "r1",
      [{ kind: "text", target: "text", op: "contains", value: "albert heijn" }],
      [cat("Boodschappen"), { kind: "setDisplayName", displayName: "AH" }],
    ),
    rule(
      "r2",
      [{ kind: "text", target: "counterparty", op: "contains", value: "albert" }],
      [cat("Anders"), { kind: "setMerchant", merchant: "ah.nl" }],
    ),
  ];
  const out = evaluate(tx(), rules);
  expect(out.claims).toEqual({ category: "r1", displayName: "r1", merchant: "r2" });
  expect(out.patch).toEqual({
    category: "Boodschappen",
    displayName: "AH",
    merchant: "ah.nl",
    tags: [],
    excluded: false,
    transfer: false,
  });
  expect(out.winnerRuleId).toBe("r1");
  expect(out.matches).toEqual([
    { ruleId: "r1", fields: ["text"], attributes: ["category", "displayName"] },
    { ruleId: "r2", fields: ["counterparty"], attributes: ["merchant"] },
  ]);
});

test("first action of a kind wins WITHIN one rule; later ones are ignored", () => {
  const rules = [
    rule(
      "r1",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [cat("Eerste"), cat("Tweede")],
    ),
  ];
  const out = evaluate(tx(), rules);
  expect(out.patch.category).toBe("Eerste");
  expect(out.claims.category).toBe("r1");
  expect(out.matches[0]!.attributes).toEqual(["category"]);
});

test("a rule that matches but claims nothing is still recorded in matches", () => {
  const rules = [
    rule("r1", [{ kind: "text", target: "text", op: "contains", value: "albert" }], []),
    rule(
      "r2",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [cat("Boodschappen")],
    ),
  ];
  const out = evaluate(tx(), rules);
  expect(out.matches.map((m) => m.ruleId)).toEqual(["r1", "r2"]);
  expect(out.winnerRuleId).toBe("r2");
  expect(out.claims).toEqual({ category: "r2" });
});

test("array order is priority: a later, more specific rule cannot take a claimed attribute", () => {
  const rules = [
    rule(
      "broad",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [cat("Breed")],
    ),
    rule(
      "specific",
      [{ kind: "text", target: "text", op: "equals", value: "albert heijn boodschappen" }],
      [cat("Specifiek")],
    ),
  ];
  const out = evaluate(tx(), rules);
  expect(out.patch.category).toBe("Breed");
  expect(out.claims.category).toBe("broad");
  expect(out.winnerRuleId).toBe("broad");
});

/* --- stopProcessing ------------------------------------------------------ */

test("stopProcessing on a matched rule ends the walk after its own actions", () => {
  const rules = [
    rule(
      "r1",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [cat("Boodschappen")],
      { stopProcessing: true },
    ),
    rule(
      "r2",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [cat("Anders")],
    ),
  ];
  const out = evaluate(tx(), rules);
  expect(out.stoppedBy).toBe("r1");
  expect(out.matches).toHaveLength(1);
  expect(out.patch.category).toBe("Boodschappen");
});

test("stopProcessing ends the walk even when the rule claimed no attribute", () => {
  const rules = [
    rule(
      "r1",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [{ kind: "setCategory", category: "X" }],
      { stopProcessing: true },
    ),
    rule(
      "r2",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [cat("Anders")],
    ),
  ];
  // The category lock makes r1 claim nothing, but it still matched.
  const out = evaluate(tx({ manual: true }), rules, locksForTx(tx({ manual: true })));
  expect(out.matches.map((m) => m.ruleId)).toEqual(["r1"]);
  expect(out.stoppedBy).toBe("r1");
  expect(out.winnerRuleId).toBeNull();
  expect(out.patch.category).toBeUndefined();
});

test("a rule that does not match does not stop the walk", () => {
  const rules = [
    rule(
      "r1",
      [{ kind: "text", target: "text", op: "contains", value: "jumbo" }],
      [cat("Boodschappen")],
      { stopProcessing: true },
    ),
    rule(
      "r2",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [cat("Boodschappen")],
    ),
  ];
  const out = evaluate(tx(), rules);
  expect(out.stoppedBy).toBeNull();
  expect(out.claims.category).toBe("r2");
});

/* --- effectiveFrom ------------------------------------------------------- */

test("effectiveFrom is a tx.date gate: before is out of force, equal and after are in force", () => {
  const make = (effectiveFrom: string) =>
    rule(
      "r1",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [cat("Boodschappen")],
      { effectiveFrom },
    );

  expect(evaluate(tx({ date: "2026-06-14" }), [make("2026-06-15")]).matches).toHaveLength(0);
  expect(evaluate(tx({ date: "2026-06-15" }), [make("2026-06-15")]).matches).toHaveLength(1);
  expect(evaluate(tx({ date: "2026-06-16" }), [make("2026-06-15")]).matches).toHaveLength(1);
  // No clock is consulted: the same tx and rule give the same answer forever.
  expect(evaluate(tx({ date: "2026-06-14" }), [make("2026-06-15")]).claims).toEqual({});
});

/* --- locks --------------------------------------------------------------- */

test("locksForTx locks the category of a manual tx and records the reason", () => {
  const manual: RuleTx = { ...tx(), manual: true };
  expect(locksForTx(manual)).toEqual({ category: "met de hand gezet" });
  expect(locksForTx(tx())).toEqual({});

  const rules = [
    rule(
      "r1",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [cat("Boodschappen")],
    ),
  ];
  const out = evaluateRules(manual, compileRules(rules), locksForTx(manual));
  expect(out.claims.category).toBeUndefined();
  expect(out.patch.category).toBeUndefined();
  expect(out.locked).toEqual({ category: "met de hand gezet" });
  expect(out.matches[0]!.attributes).toEqual([]);
  expect(out.winnerRuleId).toBeNull();
});

test("a locked non-category attribute is skipped with its own reason", () => {
  const rules = [
    rule(
      "r1",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [{ kind: "setDisplayName", displayName: "AH" }, cat("Boodschappen")],
    ),
  ];
  const out = evaluate(tx(), rules, { displayName: "met de hand gezet" });
  expect(out.locked).toEqual({ displayName: "met de hand gezet" });
  // The category is still claimable.
  expect(out.patch.category).toBe("Boodschappen");
  expect(out.patch.displayName).toBeUndefined();
});

/* --- conditions ---------------------------------------------------------- */

test("amount conditions are signed integer cents, with inclusive between", () => {
  const r = (condition: RuleCondition) => rule("r", [condition], [cat("Bedrag")]);
  const t = tx({ amount: -12.34 }); // -1234 cents

  expect(evaluate(t, [r({ kind: "amount", op: "eq", valueCents: -1234 })]).claims.category).toBe(
    "r",
  );
  expect(evaluate(t, [r({ kind: "amount", op: "gt", valueCents: -1235 })]).claims.category).toBe(
    "r",
  );
  expect(
    evaluate(t, [r({ kind: "amount", op: "gt", valueCents: -1234 })]).claims.category,
  ).toBeUndefined();
  expect(evaluate(t, [r({ kind: "amount", op: "gte", valueCents: -1234 })]).claims.category).toBe(
    "r",
  );
  expect(evaluate(t, [r({ kind: "amount", op: "lt", valueCents: -1233 })]).claims.category).toBe(
    "r",
  );
  expect(evaluate(t, [r({ kind: "amount", op: "lte", valueCents: -1234 })]).claims.category).toBe(
    "r",
  );
  expect(
    evaluate(t, [r({ kind: "amount", op: "between", valueCents: -1234, upperCents: -1000 })]).claims
      .category,
  ).toBe("r");
  expect(
    evaluate(t, [r({ kind: "amount", op: "between", valueCents: -2000, upperCents: -1234 })]).claims
      .category,
  ).toBe("r");
  expect(
    evaluate(t, [r({ kind: "amount", op: "between", valueCents: -1200, upperCents: -1100 })]).claims
      .category,
  ).toBeUndefined();
});

test("account, category and direction conditions read the stored row", () => {
  const t = tx({ accountKey: "NL01INGB0001", category: "", amount: -1 });
  expect(
    evaluate(t, [rule("r", [{ kind: "account", accountKey: "NL01INGB0001" }], [cat("A")])]).claims
      .category,
  ).toBe("r");
  expect(
    evaluate(t, [rule("r", [{ kind: "account", accountKey: "NL99XXXX" }], [cat("A")])]).claims
      .category,
  ).toBeUndefined();

  expect(
    evaluate(t, [rule("r", [{ kind: "category", op: "empty" }], [cat("A")])]).claims.category,
  ).toBe("r");
  expect(
    evaluate(tx({ category: "X" }), [rule("r", [{ kind: "category", op: "empty" }], [cat("A")])])
      .claims.category,
  ).toBeUndefined();
  expect(
    evaluate(tx({ category: "X" }), [rule("r", [{ kind: "category", op: "notEmpty" }], [cat("A")])])
      .claims.category,
  ).toBe("r");
  expect(
    evaluate(tx({ category: "X" }), [
      rule("r", [{ kind: "category", op: "equals", value: "X" }], [cat("A")]),
    ]).claims.category,
  ).toBe("r");
  expect(
    evaluate(tx({ category: "Y" }), [
      rule("r", [{ kind: "category", op: "equals", value: "X" }], [cat("A")]),
    ]).claims.category,
  ).toBeUndefined();

  expect(
    evaluate(tx({ amount: 5 }), [rule("r", [{ kind: "direction", direction: "in" }], [cat("A")])])
      .claims.category,
  ).toBe("r");
  expect(
    evaluate(tx({ amount: 5 }), [rule("r", [{ kind: "direction", direction: "out" }], [cat("A")])])
      .claims.category,
  ).toBeUndefined();
  expect(
    evaluate(tx({ amount: -5 }), [rule("r", [{ kind: "direction", direction: "out" }], [cat("A")])])
      .claims.category,
  ).toBe("r");
  // Zero is an inflow, matching the built-in sign convention in views.ts.
  expect(
    evaluate(tx({ amount: 0 }), [rule("r", [{ kind: "direction", direction: "in" }], [cat("A")])])
      .claims.category,
  ).toBe("r");
});

test("date conditions compare ISO strings", () => {
  const t = tx({ date: "2026-06-15" });
  expect(
    evaluate(t, [rule("r", [{ kind: "date", op: "onOrAfter", from: "2026-06-15" }], [cat("A")])])
      .claims.category,
  ).toBe("r");
  expect(
    evaluate(t, [rule("r", [{ kind: "date", op: "onOrAfter", from: "2026-06-16" }], [cat("A")])])
      .claims.category,
  ).toBeUndefined();
  expect(
    evaluate(t, [rule("r", [{ kind: "date", op: "onOrBefore", from: "2026-06-15" }], [cat("A")])])
      .claims.category,
  ).toBe("r");
  expect(
    evaluate(t, [
      rule(
        "r",
        [{ kind: "date", op: "between", from: "2026-06-01", to: "2026-06-30" }],
        [cat("A")],
      ),
    ]).claims.category,
  ).toBe("r");
  expect(
    evaluate(t, [
      rule(
        "r",
        [{ kind: "date", op: "between", from: "2026-06-16", to: "2026-06-30" }],
        [cat("A")],
      ),
    ]).claims.category,
  ).toBeUndefined();
});

test("merchant conditions read the counterparty alone", () => {
  const t = tx({ counterparty: "CCV*ALBERT HEIJN 1234", description: "Jumbo" });
  expect(
    evaluate(t, [
      rule("r", [{ kind: "merchant", op: "contains", value: "albert-heijn" }], [cat("A")]),
    ]).claims.category,
  ).toBe("r");
  expect(
    evaluate(t, [
      rule("r", [{ kind: "merchant", op: "equals", value: "ccv albert heijn 1234" }], [cat("A")]),
    ]).claims.category,
  ).toBe("r");
  // "jumbo" is only in the description, so a merchant condition must not see it.
  expect(
    evaluate(t, [rule("r", [{ kind: "merchant", op: "contains", value: "jumbo" }], [cat("A")])])
      .claims.category,
  ).toBeUndefined();
});

test("text ops apply to text, counterparty and description targets", () => {
  const t = tx({ counterparty: "Albert Heijn 1234", description: "Boodschappen Amsterdam" });

  const hit = (condition: RuleCondition) =>
    evaluate(t, [rule("r", [condition], [cat("A")])]).claims.category === "r";

  expect(hit({ kind: "text", target: "text", op: "contains", value: "amsterdam" })).toBe(true);
  expect(hit({ kind: "text", target: "counterparty", op: "contains", value: "amsterdam" })).toBe(
    false,
  );
  expect(hit({ kind: "text", target: "description", op: "contains", value: "amsterdam" })).toBe(
    true,
  );
  expect(
    hit({ kind: "text", target: "counterparty", op: "equals", value: "albert heijn 1234" }),
  ).toBe(true);
  expect(
    hit({ kind: "text", target: "description", op: "startsWith", value: "boodschappen" }),
  ).toBe(true);
  expect(hit({ kind: "text", target: "description", op: "endsWith", value: "amsterdam" })).toBe(
    true,
  );
  expect(hit({ kind: "text", target: "description", op: "startsWith", value: "amsterdam" })).toBe(
    false,
  );
});

test("an empty normalized text condition never matches", () => {
  for (const value of ["", "   ", "!!!", "---"]) {
    const t = tx();
    expect(
      evaluate(t, [
        rule("r", [{ kind: "text", target: "text", op: "contains", value }], [cat("A")]),
      ]).claims.category,
    ).toBeUndefined();
  }
});

/* --- actions / projections ---------------------------------------------- */

test("addTag accumulates across rules and within one rule; the first tag rule owns the claim", () => {
  const rules = [
    rule(
      "r1",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [
        { kind: "addTag", tag: "boodschappen" },
        { kind: "addTag", tag: "wekelijks" },
      ],
    ),
    rule(
      "r2",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [{ kind: "addTag", tag: "ah" }],
    ),
  ];
  const out = evaluate(tx(), rules);
  expect(out.patch.tags).toEqual(["boodschappen", "wekelijks", "ah"]);
  expect(out.claims.tags).toBe("r1");
  expect(out.matches[0]!.attributes).toEqual(["tags"]);
  expect(out.matches[1]!.attributes).toEqual(["tags"]);
});

test("exclude, markTransfer, displayName and merchant are projections in the patch", () => {
  const rules = [
    rule(
      "r1",
      [{ kind: "text", target: "text", op: "contains", value: "albert" }],
      [
        { kind: "exclude" },
        { kind: "markTransfer" },
        { kind: "setDisplayName", displayName: "AH" },
        { kind: "setMerchant", merchant: "ah.nl" },
      ],
    ),
  ];
  const out = evaluate(tx(), rules);
  expect(out.patch).toEqual({
    displayName: "AH",
    merchant: "ah.nl",
    tags: [],
    excluded: true,
    transfer: true,
  });
  expect(out.claims).toEqual({
    excluded: "r1",
    transfer: "r1",
    displayName: "r1",
    merchant: "r1",
  });
});

/* --- run log ------------------------------------------------------------- */

test("the run log records the condition fields that held, deduped and in condition order", () => {
  const rules = [
    rule(
      "r1",
      [
        { kind: "text", target: "counterparty", op: "contains", value: "albert" },
        { kind: "amount", op: "lte", valueCents: -1000 },
        { kind: "account", accountKey: "NL01INGB0001" },
        { kind: "merchant", op: "contains", value: "heijn" },
        { kind: "direction", direction: "out" },
        { kind: "date", op: "onOrAfter", from: "2026-01-01" },
        { kind: "category", op: "empty" },
      ],
      [cat("Boodschappen")],
    ),
  ];
  const out = evaluate(tx(), rules);
  expect(out.matches[0]).toEqual({
    ruleId: "r1",
    fields: ["counterparty", "amount", "accountKey", "direction", "date", "category"],
    attributes: ["category"],
  });
});

test("compileRules caches by rules-array identity", () => {
  const rules = [
    rule("r1", [{ kind: "text", target: "text", op: "contains", value: "albert" }], [cat("A")]),
  ];
  const first = compileRules(rules as RuleV2[]);
  expect(compileRules(rules as RuleV2[])).toBe(first);
  // A new array is a new compile, even with identical content.
  expect(compileRules([...rules] as RuleV2[])).not.toBe(first);
});
