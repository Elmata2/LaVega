import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { canonicalAccountId, findDuplicateAccounts, mergeAccounts } from "./accounts.js";
import { assignTxIds } from "./hash.js";

function acc(over: Partial<Account>): Account {
  return {
    key: "NL01",
    iban: "",
    name: "Rekening",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: null,
    ...over,
  };
}

function tx(over: Partial<Omit<Tx, "id">>): Omit<Tx, "id"> {
  return {
    accountKey: "NL01",
    date: "2026-08-01",
    amount: -10,
    currency: "EUR",
    counterparty: "Shop",
    description: "x",
    category: "",
    manual: false,
    ...over,
  };
}

// --- canonicalAccountId ----------------------------------------------------

test("canonicalAccountId reduces IBAN and raw BBAN to the same domestic number", () => {
  expect(canonicalAccountId(acc({ iban: "NL12ABNA0123456789", key: "NL12ABNA0123456789" }))).toBe("123456789");
  expect(canonicalAccountId(acc({ iban: "", key: "0123456789" }))).toBe("123456789");
  // old-style ABN account number vs its padded IBAN form
  expect(canonicalAccountId(acc({ iban: "NL01ABNA0155430750" }))).toBe("155430750");
  expect(canonicalAccountId(acc({ iban: "", key: "155430750" }))).toBe("155430750");
});

test("canonicalAccountId returns null when there's nothing safe to match", () => {
  expect(canonicalAccountId(acc({ iban: "", key: "Betaalrekening" }))).toBeNull(); // product name
  expect(canonicalAccountId(acc({ iban: "", key: "12" }))).toBeNull(); // too short
});

// --- findDuplicateAccounts -------------------------------------------------

test("findDuplicateAccounts groups an IBAN row with its BBAN twin (same bank) and keeps the IBAN survivor", () => {
  const ibanRow = acc({ key: "NL12INGB0123456789", iban: "NL12INGB0123456789", bank: "ING", balance: 100 });
  const bbanRow = acc({ key: "0123456789", iban: "", bank: "ING" });
  const groups = findDuplicateAccounts([ibanRow, bbanRow]);
  expect(groups).toHaveLength(1);
  expect(groups[0].canonicalId).toBe("123456789");
  expect(groups[0].survivor.key).toBe("NL12INGB0123456789");
});

test("findDuplicateAccounts ignores product-name-only rows and single accounts", () => {
  const revolut = acc({ key: "Betaalrekening", iban: "", bank: "Revolut" });
  const solo = acc({ key: "NL99RABO0000000001", iban: "NL99RABO0000000001", bank: "Rabobank" });
  expect(findDuplicateAccounts([revolut, solo])).toEqual([]);
});

test("findDuplicateAccounts does NOT flag the same number across two different banks", () => {
  const a = acc({ key: "0123456789", iban: "", bank: "ING" });
  const b = acc({ key: "NL12ABNA0123456789", iban: "NL12ABNA0123456789", bank: "ABN AMRO" });
  expect(findDuplicateAccounts([a, b])).toEqual([]);
});

// --- mergeAccounts ---------------------------------------------------------

test("mergeAccounts re-keys the duplicate's txs, collapses the overlap, appends distinct dates", () => {
  const survivor = acc({ key: "NL12INGB0123456789", iban: "NL12INGB0123456789", bank: "ING", balance: 50 });
  const duplicate = acc({ key: "0123456789", iban: "", bank: "ING" });
  // Overlap: same movement on 08-01 in both accounts (should collapse to 1).
  // Distinct: the duplicate also has a 07-15 movement the survivor lacks.
  const sTxs = assignTxIds([tx({ accountKey: survivor.key, date: "2026-08-01", amount: -10, description: "Albert Heijn" })]);
  const dTxs = assignTxIds([
    tx({ accountKey: duplicate.key, date: "2026-08-01", amount: -10, description: "Albert Heijn" }),
    tx({ accountKey: duplicate.key, date: "2026-07-15", amount: -20, description: "Shell" }),
  ]);
  const { accounts, txs } = mergeAccounts([survivor, duplicate], [...sTxs, ...dTxs], survivor.key, duplicate.key);

  // Duplicate account dropped; survivor kept.
  expect(accounts.map((a) => a.key)).toEqual([survivor.key]);
  // Overlap collapsed (1 AH, not 2) + the distinct Shell appended = 2 txs.
  expect(txs).toHaveLength(2);
  expect(txs.every((t) => t.accountKey === survivor.key)).toBe(true);
  expect(txs.filter((t) => t.description === "Albert Heijn")).toHaveLength(1);
  expect(txs.filter((t) => t.description === "Shell")).toHaveLength(1);
  // No id collisions.
  expect(new Set(txs.map((t) => t.id)).size).toBe(2);
});

test("mergeAccounts enriches an IBAN-less survivor with the duplicate's IBAN, keeps other fields", () => {
  const survivor = acc({ key: "0123456789", iban: "", bank: "ING", entity: "Zaak", balance: 99 });
  const duplicate = acc({ key: "NL12INGB0123456789", iban: "NL12INGB0123456789", bank: "ING", entity: "Prive" });
  const { accounts } = mergeAccounts([survivor, duplicate], [], survivor.key, duplicate.key);
  const kept = accounts.find((a) => a.key === survivor.key)!;
  expect(kept.iban).toBe("NL12INGB0123456789"); // inherited
  expect(kept.entity).toBe("Zaak"); // survivor's own field kept
  expect(kept.balance).toBe(99);
});

test("mergeAccounts is a no-op when keys are equal or an account is missing", () => {
  const a = acc({ key: "A" });
  expect(mergeAccounts([a], [], "A", "A").accounts).toHaveLength(1);
  expect(mergeAccounts([a], [], "A", "ghost").accounts).toHaveLength(1);
});
