import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { consolidate } from "./ingest.js";
import {
  DEFAULT_ENTITY_SCOPE,
  ENTITY_SCOPES,
  ENTITY_SCOPE_LABELS,
  accountScope,
  accountsInScope,
  clearEntityScope,
  consolidateByScope,
  entityScope,
  entitySummaries,
  renameEntity,
  setEntityScope,
  suggestEntityScope,
  type EntityProfile,
} from "./entities.js";

const acc = (key: string, entity: string, balance: number | null = 100): Account => ({
  key,
  iban: key,
  name: key,
  bank: "ING",
  entity,
  currency: "EUR",
  balance,
});

const tx = (accountKey: string, amount: number): Tx => ({
  id: accountKey + amount,
  accountKey,
  date: "2026-08-01",
  amount,
  currency: "EUR",
  counterparty: "x",
  description: "",
  category: "",
  manual: false,
});

test("the default is personal: an unclassified entity, and an empty profile list, resolve to privé", () => {
  expect(DEFAULT_ENTITY_SCOPE).toBe("personal");
  expect(entityScope("BV1")).toBe("personal");
  expect(entityScope("BV1", [])).toBe("personal");
  expect(accountScope(acc("A", "Holding B.V."))).toBe("personal");
  expect(ENTITY_SCOPES).toEqual(["personal", "business"]);
  expect(ENTITY_SCOPE_LABELS.personal).toBe("Privé");
  expect(ENTITY_SCOPE_LABELS.business).toBe("Zakelijk");
});

test("an explicit classification wins, and it is matched case/space-insensitively", () => {
  const profiles: EntityProfile[] = [{ entity: "BV1", scope: "business" }];
  expect(entityScope("BV1", profiles)).toBe("business");
  expect(entityScope(" bv1 ", profiles)).toBe("business");
  expect(entityScope("BV2", profiles)).toBe("personal"); // untouched entity keeps the default
  expect(accountScope(acc("A", "bv1"), profiles)).toBe("business");
});

test("suggestEntityScope only SUGGESTS: a legal form reads business, a private name reads privé, anything else defaults", () => {
  expect(suggestEntityScope("Steunenberg Holding B.V.")).toBe("business");
  expect(suggestEntityScope("BV1")).toBe("business");
  expect(suggestEntityScope("Generation C GmbH")).toBe("business");
  expect(suggestEntityScope("Privé")).toBe("personal"); // accent-insensitive
  expect(suggestEntityScope("prive")).toBe("personal");
  expect(suggestEntityScope("Huishouden")).toBe("personal");
  expect(suggestEntityScope("Vakantiepot")).toBe("personal"); // no signal -> default
  expect(suggestEntityScope("Bvergadering")).toBe("personal"); // whole-token match only
  expect(suggestEntityScope("Privé Holding BV")).toBe("business"); // legal form is the stronger signal
  // ...but the suggestion NEVER resolves on its own: without a profile the
  // account is still personal, so nothing is silently promoted to business.
  expect(entityScope("Steunenberg Holding B.V.")).toBe("personal");
});

test("setEntityScope upserts (never duplicates a differently-spelled entity) and clearEntityScope returns it to the default", () => {
  const a = setEntityScope([], "BV1", "business");
  expect(a).toEqual([{ entity: "BV1", scope: "business" }]);
  const b = setEntityScope(a, " bv1 ", "personal");
  expect(b).toHaveLength(1);
  expect(b[0].entity).toBe("BV1"); // the stored spelling stays
  expect(b[0].scope).toBe("personal");
  const c = setEntityScope(b, "Privé", "personal");
  expect(c).toHaveLength(2);
  expect(a).toEqual([{ entity: "BV1", scope: "business" }]); // input never mutated

  expect(clearEntityScope(c, "bv1")).toEqual([{ entity: "Privé", scope: "personal" }]);
  expect(entityScope("BV1", clearEntityScope(c, "bv1"))).toBe("personal");
});

test("entitySummaries: one row per entity, with whether the owner classified it himself and what to prefill", () => {
  const accounts = [acc("A", "BV1"), acc("B", "BV1"), acc("C", "Privé")];
  const rows = entitySummaries(accounts, [{ entity: "BV1", scope: "business" }]);
  expect(rows.map((r) => r.entity)).toEqual(["BV1", "Privé"]); // sorted, deterministic
  expect(rows[0]).toMatchObject({
    scope: "business",
    explicit: true,
    suggested: "business",
    accountKeys: ["A", "B"],
  });
  expect(rows[1]).toMatchObject({
    scope: "personal",
    explicit: false,
    suggested: "personal",
    accountKeys: ["C"],
  });

  // An unclassified BV shows the default AS its scope but suggests business.
  const fresh = entitySummaries([acc("A", "Holding BV")]);
  expect(fresh[0]).toMatchObject({ scope: "personal", explicit: false, suggested: "business" });
});

test("renameEntity moves every account of that entity and carries the classification with it", () => {
  const accounts = [acc("A", "onbekend"), acc("B", "onbekend"), acc("C", "Privé")];
  const profiles: EntityProfile[] = [{ entity: "onbekend", scope: "business" }];
  const r = renameEntity(accounts, profiles, "onbekend", "BV1");
  expect(r.accounts.map((a) => a.entity)).toEqual(["BV1", "BV1", "Privé"]);
  expect(r.profiles).toEqual([{ entity: "BV1", scope: "business" }]);
  expect(accounts[0].entity).toBe("onbekend"); // input untouched
});

test("renameEntity into an EXISTING entity merges, and the target's own classification wins", () => {
  const accounts = [acc("A", "BV oud"), acc("B", "BV1")];
  const profiles: EntityProfile[] = [
    { entity: "BV oud", scope: "business" },
    { entity: "BV1", scope: "personal" },
  ];
  const r = renameEntity(accounts, profiles, "BV oud", "BV1");
  expect(r.accounts.every((a) => a.entity === "BV1")).toBe(true);
  expect(r.profiles).toEqual([{ entity: "BV1", scope: "personal" }]); // not re-classified by the merge
});

test("renameEntity is a no-op for an identical or blank target", () => {
  const accounts = [acc("A", "BV1")];
  expect(renameEntity(accounts, [], "BV1", "BV1").accounts).toEqual(accounts);
  expect(renameEntity(accounts, [], "BV1", "   ").accounts).toEqual(accounts);
});

test("accountsInScope splits the accounts the classification actually applies to", () => {
  const accounts = [acc("A", "BV1"), acc("B", "Privé"), acc("C", "BV2")];
  const profiles: EntityProfile[] = [
    { entity: "BV1", scope: "business" },
    { entity: "BV2", scope: "business" },
  ];
  expect(accountsInScope(accounts, "business", profiles).map((a) => a.key)).toEqual(["A", "C"]);
  expect(accountsInScope(accounts, "personal", profiles).map((a) => a.key)).toEqual(["B"]);
  expect(accountsInScope(accounts, "personal").map((a) => a.key)).toEqual(["A", "B", "C"]); // no profiles: all privé
});

test("the existing per-entity consolidation is untouched, and the scope rollup agrees with it", () => {
  const accounts = [acc("A", "BV1", 100), acc("B", "BV2", 200), acc("C", "Privé", 50)];
  const txs = [tx("A", 30), tx("B", -10), tx("C", 5)];
  const profiles: EntityProfile[] = [
    { entity: "BV1", scope: "business" },
    { entity: "BV2", scope: "business" },
  ];

  const perEntity = consolidate(accounts, txs);
  expect(perEntity.byEntity).toEqual({
    BV1: { in: 30, out: 0, balance: 100 },
    BV2: { in: 0, out: -10, balance: 200 },
    Privé: { in: 5, out: 0, balance: 50 },
  });

  const { byScope, totalBalance } = consolidateByScope(accounts, txs, profiles);
  expect(byScope).toEqual({
    business: { in: 30, out: -10, balance: 300 },
    personal: { in: 5, out: 0, balance: 50 },
  });
  expect(totalBalance).toBe(350);
  expect(totalBalance).toBe(perEntity.totalBalance); // same money, two lenses
});

test("the scope rollup inherits consolidate's unknown-balance rule: one null makes the whole scope unknown", () => {
  const accounts = [acc("A", "BV1", 100), acc("B", "BV2", null), acc("C", "Privé", 50)];
  const profiles: EntityProfile[] = [
    { entity: "BV1", scope: "business" },
    { entity: "BV2", scope: "business" },
  ];
  const { byScope, totalBalance } = consolidateByScope(accounts, [], profiles);
  expect(byScope.business.balance).toBeNull();
  expect(byScope.personal.balance).toBe(50);
  expect(totalBalance).toBeNull();
});

test("with no profiles at all everything rolls up as privé — the default is genuinely the fallback", () => {
  const accounts = [acc("A", "BV1", 100), acc("B", "Privé", 50)];
  const { byScope } = consolidateByScope(accounts, []);
  expect(Object.keys(byScope)).toEqual(["personal"]);
  expect(byScope.personal.balance).toBe(150);
});
