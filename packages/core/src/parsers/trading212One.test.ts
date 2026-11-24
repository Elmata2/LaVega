import { expect, test } from "vitest";
import { T212_ACCOUNT_KEY } from "./bankCsv.js";
import { parseBankFile } from "./parseBankFile.js";
import { applyCardFiles, planCardFiles, type CardFileInput } from "./cardFile.js";
import { ingest } from "../ingest.js";
import { assignTxIds } from "../hash.js";
import type { Account } from "../model.js";
import { countsAsLinked } from "../plan/connectChecklist.js";

/* One Trading 212 account: card rows and cash rows share it. All data synthetic. */
const ASOF = "2026-11-16";
const T212_TARGET = { cardId: "212-card", label: "212 Card", brand: "trading-212" };
const FULL = `Action,Time,ISIN,Ticker,Name,Notes,ID,Currency (Total),Total,Merchant name,Merchant category
Deposit,2026-01-14 08:00:00,,,,,,EUR,1000.00,,
Market buy,2026-01-14 09:00:00,US0378331005,AAPL,Apple Inc,,tx1,EUR,-500.00,,
Card debit,2026-01-15 12:30:00,,,,,c1,EUR,-12.40,Cafe Test,Restaurants
Mystery action,2026-01-20 10:00:00,,,,,c6,EUR,5.00,,`;
const CASH_ONLY = `Action,Time,Currency (Total),Total
Deposit,2026-01-14 08:00:00,EUR,1000.00
Interest on cash,2026-01-15 08:00:00,EUR,0.50`;
const CARD3 = `Action,Time,Currency (Total),Total,Merchant name
Card debit,2026-01-01 10:00:00,EUR,-1.00,Shop A
Card debit,2026-01-02 10:00:00,EUR,-2.00,Shop B
Card debit,2026-01-03 10:00:00,EUR,-3.00,Shop C`;
const SAME_FILE = `Action,Time,Currency (Total),Total,Merchant name
Card debit,2026-01-01 10:00:00,EUR,-1.00,Shop A
Card debit,2026-01-02 10:00:00,EUR,-2.00,Shop B
Card debit,2026-01-03 10:00:00,EUR,-3.00,Shop C
Deposit,2026-01-04 10:00:00,EUR,100.00,
Interest on cash,2026-01-05 10:00:00,EUR,0.50,`;
const LATER = `Action,Time,Currency (Total),Total,Merchant name
Card debit,2026-02-01 10:00:00,EUR,-4.00,Shop D
Deposit,2026-02-02 10:00:00,EUR,50.00,`;

const input = (
  csv: string,
  name: string,
  target: CardFileInput["target"] = T212_TARGET,
): CardFileInput => ({
  result: parseBankFile(name, csv),
  target,
  link: target !== null,
});

test("one export: one account, stable key, name Trading 212, signs right, trade ignored", () => {
  const a = parseBankFile("from_2026-10-01_to_2026-11-16_MTc5NDg1MD.csv", FULL);
  const b = parseBankFile("other.csv", FULL, { accountHint: "FILE-212-card" });
  expect(a.accounts).toHaveLength(1);
  expect(a.accounts[0]).toMatchObject({
    key: T212_ACCOUNT_KEY,
    name: "Trading 212",
    bank: "Trading 212",
  });
  expect(b.accounts[0]!.key).toBe(a.accounts[0]!.key);
  expect(a.txs.every((t) => t.accountKey === T212_ACCOUNT_KEY)).toBe(true);
  expect(a.txs.find((t) => t.description === "Card debit")!.amount).toBe(-12.4);
  expect(a.txs.find((t) => t.description === "Deposit")!.amount).toBe(1000);
  expect(a.txs.some((t) => t.description === "Market buy")).toBe(false);
  expect(a.unrecognised).toEqual([{ action: "Mystery action", count: 1 }]);
});

test("the single key is the old card key, so existing card rows keep their ids", () => {
  expect(T212_ACCOUNT_KEY).toBe("TRADING212-CARD");
});

test("two exports with other names and overlapping dates: one account, overlap once", () => {
  const files = [
    input(FULL, "from_a.csv"),
    input(FULL.replace("Deposit,2026-01-14", "Deposit,2026-01-13"), "from_b.csv"),
  ];
  const out = applyCardFiles({ accounts: [], txs: [] }, files, ASOF);
  expect(out.accounts).toHaveLength(1);
  expect(out.txs).toHaveLength(3); // Deposit (new date) + Deposit + Card debit; shared card row once
  expect(out.added).toBe(3);
});

test("cash-only export for the stated 212 card: the one account, stamped", () => {
  const [plan] = planCardFiles({ accounts: [], txs: [] }, [input(CASH_ONLY, "x.csv")], ASOF);
  expect(plan!.destination).toEqual({ existing: false, name: "Trading 212" });
  const out = applyCardFiles({ accounts: [], txs: [] }, [input(CASH_ONLY, "x.csv")], ASOF);
  expect(out.accounts).toHaveLength(1);
  expect(out.accounts[0]).toMatchObject({
    key: T212_ACCOUNT_KEY,
    source: "file",
    statedCardId: "212-card",
  });
  expect(countsAsLinked(out.accounts[0]!)).toBe(true);
});

/* --- existing vault: card account + file-name-keyed cash account --- */
const acct = (key: string, over: Partial<Account> = {}): Account => ({
  key,
  iban: "",
  name: key,
  bank: "Trading 212",
  entity: "P",
  currency: "EUR",
  balance: null,
  ...over,
});
const OLD_KEY = "from_2026-10-01_to_2026-11-16_MTc5NDg1MD";
const oldVault = () => {
  const cardRows = parseBankFile("a.csv", CARD3).txs.map((t) => ({
    ...t,
    accountKey: "TRADING212-CARD",
  }));
  const cashRows = parseBankFile("a.csv", SAME_FILE)
    .txs.filter((t) => t.description !== "Card debit")
    .map((t) => ({ ...t, accountKey: OLD_KEY }));
  return {
    accounts: [
      acct("TRADING212-CARD", {
        name: "Trading 212 Card",
        balance: 250,
        balanceDate: "2026-11-01",
        source: "file",
        statedCardId: "212-card",
        linkedAt: "2026-11-02",
      }),
      acct(OLD_KEY, { name: OLD_KEY, source: "file", linkedAt: "2026-11-02" }),
    ] as Account[],
    txs: ingest([], [...cardRows, ...cashRows]),
  };
};

test("migration: re-import of the same file folds the old account, 0 added, balance and stamp kept", () => {
  const held = oldVault();
  expect(held.txs).toHaveLength(5);
  const f = input(SAME_FILE, "from_2026-10-01_to_2026-11-16_MTc5NDg1MD.csv");
  const [plan] = planCardFiles(held, [f], ASOF);
  expect(plan).toMatchObject({ newCount: 0, duplicateCount: 5, foldsExisting: true });
  const out = applyCardFiles(held, [f], ASOF);
  expect(out.added).toBe(0);
  expect(out.removedAccountKeys).toEqual([OLD_KEY]);
  expect(out.txs).toHaveLength(5);
  expect(new Set(out.txs.map((t) => t.accountKey))).toEqual(new Set([T212_ACCOUNT_KEY]));
  expect(new Set(out.txs.map((t) => t.id)).size).toBe(5);
  expect(out.accounts).toHaveLength(1);
  expect(out.accounts[0]).toMatchObject({
    key: T212_ACCOUNT_KEY,
    name: "Trading 212",
    balance: 250,
    balanceDate: "2026-11-01",
    statedCardId: "212-card",
    source: "file",
  });
  // a later file still ends in one account
  const merged = { accounts: out.accounts, txs: out.txs };
  const later = applyCardFiles(merged, [input(LATER, "later-name.csv")], ASOF);
  expect(later.added).toBe(2);
  expect(later.removedAccountKeys).toEqual([]);
  expect(later.accounts.map((a) => a.key)).toEqual([T212_ACCOUNT_KEY]);
});

test("migration: the removed ids and the id remap are reported", () => {
  const held = oldVault();
  const out = applyCardFiles(held, [input(SAME_FILE, "x.csv")], ASOF);
  const oldCashIds = held.txs.filter((t) => t.accountKey === OLD_KEY).map((t) => t.id);
  expect(oldCashIds).toHaveLength(2);
  for (const id of oldCashIds) expect(out.txIdRemap.has(id)).toBe(true);
  expect(out.folds).toEqual([{ survivorKey: T212_ACCOUNT_KEY, duplicateKey: OLD_KEY }]);
});

test("migration: only the cash account exists (card key absent): renamed to the one key, balance kept", () => {
  const held = oldVault();
  const only = {
    accounts: [{ ...held.accounts[1]!, balance: 80, balanceDate: "2026-11-03" }],
    txs: held.txs.filter((t) => t.accountKey === OLD_KEY),
  };
  const out = applyCardFiles(only, [input(SAME_FILE, "x.csv")], ASOF);
  expect(out.accounts).toHaveLength(1);
  expect(out.accounts[0]).toMatchObject({
    key: T212_ACCOUNT_KEY,
    balance: 80,
    statedCardId: "212-card",
  });
  expect(out.txs).toHaveLength(5);
  expect(out.removedAccountKeys).toEqual([OLD_KEY]);
});

test("balance: both accounts have one, the surviving key's balance wins (not added up)", () => {
  const held = oldVault();
  held.accounts[1] = { ...held.accounts[1]!, balance: 70, balanceDate: "2026-11-05" };
  const out = applyCardFiles(held, [input(SAME_FILE, "x.csv")], ASOF);
  expect(out.accounts[0]).toMatchObject({ balance: 250, balanceDate: "2026-11-01" });
});

test("balance: only the folded account has one, it moves over with its date", () => {
  const held = oldVault();
  held.accounts[0] = { ...held.accounts[0]!, balance: null };
  delete (held.accounts[0] as Partial<Account>).balanceDate;
  held.accounts[1] = { ...held.accounts[1]!, balance: 70, balanceDate: "2026-11-05" };
  const out = applyCardFiles(held, [input(SAME_FILE, "x.csv")], ASOF);
  expect(out.accounts[0]).toMatchObject({ balance: 70, balanceDate: "2026-11-05" });
});

test("never folded: a live-linked Trading 212 account, a hand-made one, one with a manual row", () => {
  const live = acct("NL-LIVE", { balanceFetchedAt: "2026-11-10", balance: 5 });
  const hand = acct("HAND", { name: "Mijn 212" }); // no linkedAt, no source
  const manual = acct("MANUAL", { source: "file", linkedAt: "2026-11-02" });
  const held = {
    accounts: [...oldVault().accounts.slice(0, 1), live, hand, manual],
    txs: [
      ...oldVault().txs.filter((t) => t.accountKey === "TRADING212-CARD"),
      ...assignTxIds([
        {
          accountKey: "MANUAL",
          date: "2026-01-01",
          amount: -9,
          currency: "EUR",
          counterparty: "me",
          description: "typed",
          category: "",
          manual: true,
        },
      ]),
    ],
  };
  const f = input(SAME_FILE, "x.csv");
  const [plan] = planCardFiles(held, [f], ASOF);
  expect(plan!.foldsExisting).toBe(false);
  const out = applyCardFiles(held, [f], ASOF);
  expect(out.removedAccountKeys).toEqual([]);
  expect(out.folds).toEqual([]);
  expect(out.txs.filter((t) => t.accountKey === "MANUAL")).toHaveLength(1);
});

test("a non-Trading-212 file never folds anything", () => {
  const amex = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/05/2026,SHOP ONE,A TESTER,-11111,10.00,SHOP ONE,x`;
  const f: CardFileInput = { result: parseBankFile("a.csv", amex), target: null, link: false };
  const [plan] = planCardFiles(oldVault(), [f], ASOF);
  expect(plan!.foldsExisting).toBe(false);
});

test("plan writes nothing: the held vault is untouched", () => {
  const held = oldVault();
  const snap = JSON.stringify(held);
  planCardFiles(held, [input(SAME_FILE, "x.csv")], ASOF);
  expect(JSON.stringify(held)).toBe(snap);
});

/* --- A1: the fold predicate. Only what a Trading 212 card-path import made folds. --- */
const foldRun = (extra: Account[], survivor = true) => {
  const v = oldVault();
  const accounts = survivor ? [v.accounts[0]!, ...extra] : extra;
  const txs = survivor ? v.txs : [];
  const extraTxs = ingest(
    [],
    extra.flatMap((a) =>
      parseBankFile("a.csv", SAME_FILE)
        .txs.filter((t) => t.description === "Deposit")
        .map((t) => ({ ...t, accountKey: a.key })),
    ),
  );
  return applyCardFiles(
    { accounts, txs: [...txs, ...extraTxs] },
    [input(SAME_FILE, "x.csv")],
    ASOF,
  );
};
const cand = (key: string, over: Partial<Account> = {}): Account =>
  acct(key, { name: key, source: "file", linkedAt: "2026-11-02", ...over });

test("the owner's real shape folds: card-path cash account (file-fed, personal, EUR, no type) beside the stamped card", () => {
  const out = foldRun([cand("from_2026-10-01_to_2026-11-16_MTc5NDg1MD")]);
  expect(out.removedAccountKeys).toEqual(["from_2026-10-01_to_2026-11-16_MTc5NDg1MD"]);
});

test("every old account that qualifies is folded, three accounts into one", () => {
  const out = foldRun([cand("OLD-A"), cand("OLD-B")]);
  expect(out.removedAccountKeys.sort()).toEqual(["OLD-A", "OLD-B"]);
});

test.each<[string, Partial<Account>]>([
  ["another entity than the survivor", { entity: "BV" }],
  ["another currency", { currency: "GBP" }],
  ["an investing type", { type: "Beleggingsrekening" }],
  ["a savings type", { type: "Spaarrekening" }],
  ["a crypto type", { type: "Crypto" }],
  ["another type than the survivor", { type: "Overig" }],
  ["a bank called Trading 212 ISA", { bank: "Trading 212 ISA" }],
  ["only linkedAt (no file stamp)", { source: undefined }],
])("never folded: %s", (_n, over) => {
  const a = cand("OTHER", over);
  if (over.source === undefined && "source" in over) delete (a as Partial<Account>).source;
  const out = foldRun([a]);
  expect(out.removedAccountKeys).toEqual([]);
  expect(out.txs.some((t) => t.accountKey === "OTHER")).toBe(true);
});

test("an account keyed by a Trading 212 export file name folds without a file stamp (import with no card picked)", () => {
  // The dialog opened from Profiel with no card chosen does not stamp `source`.
  // The key is the export's own file name, which only this parser produced.
  const a = cand("from_2026-10-01_to_2026-11-16_MTc5NDg1MD");
  delete (a as Partial<Account>).source;
  expect(foldRun([a]).removedAccountKeys).toEqual(["from_2026-10-01_to_2026-11-16_MTc5NDg1MD"]);
  // Still bound by entity: the same key in another entity stays.
  const b = cand("from_2026-10-01_to_2026-11-16_MTc5NDg1MD", { entity: "BV" });
  delete (b as Partial<Account>).source;
  expect(foldRun([b]).removedAccountKeys).toEqual([]);
});

test("a stated-card stamp alone (no source) is enough to be file-fed", () => {
  const a = cand("STAMPED", { statedCardId: "212-card" });
  delete (a as Partial<Account>).source;
  expect(foldRun([a]).removedAccountKeys).toEqual(["STAMPED"]);
});

test("a rejected candidate is left untouched while a qualifying one still folds", () => {
  const out = foldRun([cand("GOOD"), cand("BIZ", { entity: "BV" })]);
  expect(out.removedAccountKeys).toEqual(["GOOD"]);
});

test("no survivor yet: candidates in different entities fold none and the plan says so", () => {
  const held = { accounts: [cand("A"), cand("B", { entity: "BV" })], txs: [] as never[] };
  const [plan] = planCardFiles(held, [input(SAME_FILE, "x.csv")], ASOF);
  expect(plan).toMatchObject({ foldsExisting: false, foldBlocked: true });
  expect(applyCardFiles(held, [input(SAME_FILE, "x.csv")], ASOF).removedAccountKeys).toEqual([]);
});

test("no survivor yet, same entity: they fold; a GBP candidate stays", () => {
  const held = {
    accounts: [cand("A"), cand("B"), cand("G", { currency: "GBP" })],
    txs: [] as never[],
  };
  const out = applyCardFiles(held, [input(SAME_FILE, "x.csv")], ASOF);
  expect(out.removedAccountKeys.sort()).toEqual(["A", "B"]);
});

test("a retry: a row already moved under the survivor maps its old id to the survivor's id, not to null", () => {
  const held = oldVault();
  const out1 = applyCardFiles(held, [input(SAME_FILE, "x.csv")], ASOF);
  // crash before the old rows were deleted: both the old and the new rows are stored
  const stored = {
    accounts: [...out1.accounts, held.accounts[1]!],
    txs: [...out1.txs, ...held.txs.filter((t) => t.accountKey === OLD_KEY)],
  };
  const out2 = applyCardFiles(stored, [input(SAME_FILE, "x.csv")], ASOF);
  expect(out2.txs).toHaveLength(5);
  for (const t of held.txs.filter((x) => x.accountKey === OLD_KEY)) {
    const to = out2.txIdRemap.get(t.id);
    expect(to).toBe(out1.txIdRemap.get(t.id));
    expect(to).not.toBeNull();
  }
});

test("A5: a file that is not written folds nothing and records nothing", () => {
  const amex = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/05/2026,SHOP,A,-77777,10.00,SHOP,x`;
  const legacy = { ...cand("AMEX-LEGACY", { bank: "American Express" }) };
  const held = { accounts: [...oldVault().accounts, legacy], txs: oldVault().txs };
  const f: CardFileInput = {
    result: parseBankFile("a.csv", amex),
    target: { cardId: "amex-1", label: "Amex", brand: "amex" },
    link: true,
  };
  const out = applyCardFiles(held, [f, input(SAME_FILE, "x.csv")], ASOF);
  // the Amex file is held back by its question; the Trading 212 file after it still folds once
  expect(out.folds).toHaveLength(1);
  expect(out.accounts.some((a) => a.key === "AMEX-77777")).toBe(false);
});
