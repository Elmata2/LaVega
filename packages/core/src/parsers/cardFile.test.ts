import { expect, test } from "vitest";
import { parseBankCsv, parseBankRows, T212_ACCOUNT_KEY } from "./bankCsv.js";
import { parseBankFile, parseBankSheet } from "./parseBankFile.js";
import {
  applyCardFiles,
  cardFileHintKey,
  planCardFiles,
  stampCardFile,
  type CardFileInput,
} from "./cardFile.js";
import { ingest } from "../ingest.js";
import type { Account } from "../model.js";
import { mergeImportedAccounts } from "../views.js";
import { countsAsLinked } from "../plan/connectChecklist.js";

/* All data synthetic. */
const AMEX_EN = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/05/2026,SHOP ONE,A TESTER,-11111,10.00,SHOP ONE,x
03/06/2026,SHOP TWO,B TESTER,-22222,20.00,SHOP TWO,x
03/07/2026,PAYMENT RECEIVED,A TESTER,-11111,-50.00,PAYMENT,x`;
const AMEX_NL = `Datum,Omschrijving,Kaartnummer,Bedrag,Vermeld op uw rekeningoverzicht als,Aanvullende informatie
03/05/2026,WINKEL,-33333,"12,50",WINKEL,`;
const AMEX_NOACC = `Date,Description,Card Member,Amount,Appears on Your Statement As,Extended Details
03/05/2026,SHOP ONE,A TESTER,10.00,SHOP ONE,x`;

test("Amex EN: account key from the Account # column, two cards = two accounts", () => {
  const r = parseBankCsv(AMEX_EN, "AMEX-FILENAME");
  expect(r.accounts.map((a) => a.key).sort()).toEqual(["AMEX-11111", "AMEX-22222"]);
  expect(r.txs.find((t) => t.counterparty === "SHOP ONE")).toMatchObject({
    amount: -10,
    date: "2026-03-05",
    accountKey: "AMEX-11111",
  });
  expect(r.txs.find((t) => t.counterparty === "PAYMENT RECEIVED")?.amount).toBe(50);
});

test("Amex NL: Kaartnummer column wins over the filename", () => {
  const r = parseBankCsv(AMEX_NL, "AMEX-FILENAME");
  expect(r.accounts[0]!.key).toBe("AMEX-33333");
  expect(r.txs[0]!.amount).toBe(-12.5);
});

test("Amex without an account column: picked-card hint beats the filename", () => {
  const hint = cardFileHintKey("american-express-platinum");
  expect(parseBankCsv(AMEX_NOACC, "AMEX-FILENAME", { accountHint: hint }).accounts[0]!.key).toBe(
    hint,
  );
  expect(parseBankCsv(AMEX_NOACC, "AMEX-FILENAME").accounts[0]!.key).toBe("AMEX-FILENAME");
});

test("Amex: re-import adds 0 transactions", () => {
  const r = parseBankCsv(AMEX_EN, "x");
  const first = ingest([], r.txs);
  expect(ingest(first, parseBankCsv(AMEX_EN, "x").txs)).toHaveLength(first.length);
});

const sheetRows = (csv: string) => csv.split("\n").map((l) => l.split(","));

test("XLSX rows: same profile detection; Excel date serials are read", () => {
  const rows = [
    [
      "Date",
      "Description",
      "Card Member",
      "Account #",
      "Amount",
      "Appears on Your Statement As",
      "Extended Details",
    ],
    ["46086", "SHOP ONE", "A", "-11111", "10.00", "SHOP ONE", "x"], // 2026-03-05
  ];
  const r = parseBankSheet("xlsx", rows, "AMEX", {});
  expect(r.source).toBe("American Express");
  expect(r.txs[0]).toMatchObject({ date: "2026-03-05", amount: -10, accountKey: "AMEX-11111" });
  expect(parseBankRows(rows, "x").profile).toBe("American Express");
});

test("XLSX no profile recognises: specific problem", () => {
  const r = parseBankSheet(
    "xlsx",
    [
      ["foo", "bar"],
      ["1", "2"],
    ],
    "x",
  );
  expect(r.problems).toEqual([{ kind: "spreadsheet-unrecognised", format: "xlsx" }]);
});

const T212 = `Action,Time,ISIN,Ticker,Name,Notes,ID,Currency (Total),Total,Merchant name,Merchant category
Deposit,2026-01-14 08:00:00,,,,,,EUR,1000.00,,
Market buy,2026-01-14 09:00:00,US0378331005,AAPL,Apple Inc,,tx1,EUR,-500.00,,
Card debit,2026-01-15 12:30:00,,,,,c1,EUR,-12.40,Cafe Test,Restaurants
Card debit,2026-01-16 12:30:00,,,,,c2,EUR,7.00,Shop Test,Retail
Card credit,2026-01-17 10:00:00,,,,,c3,EUR,-3.00,Shop Test,Retail
Spending cashback,2026-01-18 10:00:00,,,,,c4,EUR,0.50,,
Card fee,2026-01-19 10:00:00,,,,,c5,EUR,-1.00,,
Mystery action,2026-01-20 10:00:00,,,,,c6,EUR,5.00,,
Mystery action,2026-01-21 10:00:00,,,,,c7,EUR,5.00,,`;

test("Trading 212: card rows kept as money out/in, cash kept, trades ignored, unknown reported", () => {
  const r = parseBankCsv(T212, "TRADING212");
  expect(r.profile).toBe("Trading 212");
  const byDesc = (d: string) => r.txs.filter((t) => t.description === d);
  expect(byDesc("Deposit")[0]).toMatchObject({ amount: 1000, accountKey: T212_ACCOUNT_KEY });
  expect(byDesc("Card debit").map((t) => t.amount)).toEqual([-12.4, -7]);
  expect(byDesc("Card debit")[0]).toMatchObject({
    counterparty: "Cafe Test",
    accountKey: T212_ACCOUNT_KEY,
    date: "2026-01-15",
  });
  expect(byDesc("Card credit")[0]!.amount).toBe(3);
  expect(byDesc("Spending cashback")[0]!.amount).toBe(0.5);
  expect(byDesc("Market buy")).toHaveLength(0);
  expect(r.unrecognised).toEqual([
    { action: "Card fee", count: 1 },
    { action: "Mystery action", count: 2 },
  ]);
  expect(r.accounts.map((a) => a.key)).toEqual([T212_ACCOUNT_KEY]);
});

test("Trading 212: the account key ignores the filename and the hint", () => {
  const a = parseBankFile("a.csv", T212, { accountHint: "FILE-x" });
  const b = parseBankFile("other-name.csv", T212);
  expect(a.accounts.map((x) => x.key)).toEqual(b.accounts.map((x) => x.key));
  expect(a.accounts[0]!.name).toBe("Trading 212");
});

test("Trading 212: counterparty falls back to Notes, then the action text", () => {
  const csv = `Action,Time,Notes,ID,Currency (Total),Total
Card debit,2026-01-15 12:30:00,Note shop,c1,EUR,-1.00
Card debit,2026-01-16 12:30:00,,c2,EUR,-2.00`;
  const r = parseBankCsv(csv, "T");
  expect(r.txs.map((t) => t.counterparty)).toEqual(["Note shop", "Card debit"]);
});

const ASOF = "2026-11-16";
const AMEX_TARGET = { cardId: "amex-1", label: "American Express Card", brand: "amex" };
const T212_TARGET = { cardId: "212-card", label: "212 Card", brand: "trading-212" };
const file = (
  csv: string,
  name = "f.csv",
  target: CardFileInput["target"] = null,
): CardFileInput => ({
  result: parseBankFile(name, csv),
  target,
  link: target !== null,
});

test("planCardFiles: counts new vs duplicates, writes nothing", () => {
  const f = file(AMEX_EN);
  const held = ingest([], f.result.txs);
  const [plan] = planCardFiles({ accounts: [], txs: held }, [f], ASOF);
  expect(plan).toMatchObject({
    brand: "amex",
    txCount: 3,
    newCount: 0,
    duplicateCount: 3,
    period: { from: "2026-03-05", to: "2026-03-07" },
  });
  expect(planCardFiles({ accounts: [], txs: [] }, [f], ASOF)[0]!.newCount).toBe(3);
});

const A = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/01/2026,ROW ONE,A,-11111,1.00,ROW ONE,x
03/02/2026,ROW TWO,A,-11111,2.00,ROW TWO,x`;
const B = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/02/2026,ROW TWO,A,-11111,2.00,ROW TWO,x
03/03/2026,ROW THREE,A,-11111,3.00,ROW THREE,x`;

test("overlapping files: previews say 2 new then 1 new, and 3 are stored", () => {
  const files = [file(A, "a.csv", AMEX_TARGET), file(B, "b.csv", AMEX_TARGET)];
  const plans = planCardFiles({ accounts: [], txs: [] }, files, ASOF);
  expect(plans.map((p) => p.newCount)).toEqual([2, 1]);
  const out = applyCardFiles({ accounts: [], txs: [] }, files, ASOF);
  expect(out.txs).toHaveLength(3);
  expect(out.added).toBe(3);
});

test("an Amex account keyed from the filename takes the new file's rows: re-import adds 0", () => {
  const old = parseBankFile("AMEX-2026.csv", AMEX_NOACC); // key AMEX-2026, as before
  const oldKey = old.accounts[0]!.key;
  const held = {
    accounts: old.accounts.map((a) => ({ ...a, linkedAt: "2026-01-01" })),
    txs: ingest([], old.txs),
  };
  const f = file(
    AMEX_NOACC.replace("Card Member,Amount", "Card Member,Account #,Amount").replace(
      "A TESTER,10.00",
      "A TESTER,-77777,10.00",
    ),
    "x.csv",
    AMEX_TARGET,
  );
  const [asked] = planCardFiles(held, [f], ASOF);
  expect(asked!.question).not.toBeNull(); // a legacy account: the user must say it is the same card
  const yes = { ...f, sameCard: true };
  const [plan] = planCardFiles(held, [yes], ASOF);
  expect(plan!.newCount).toBe(0);
  const out = applyCardFiles(held, [yes], ASOF);
  expect(out.added).toBe(0);
  expect(out.accounts[0]).toMatchObject({ key: oldKey, source: "file", statedCardId: "amex-1" });
});

test("several existing Amex accounts: match by digits, else say it could not be matched", () => {
  const mk = (key: string) => ({
    ...parseBankFile("a.csv", AMEX_NOACC, { accountHint: key }).accounts[0]!,
    bank: "American Express",
    linkedAt: "2026-01-01",
  });
  const held = { accounts: [mk("AMEX-11111"), mk("AMEX-22222")], txs: [] };
  const hit = planCardFiles(held, [file(A, "a.csv", AMEX_TARGET)], ASOF)[0]!;
  expect(hit.accountKeys).toEqual(["AMEX-11111"]);
  expect(hit.unmatchedExisting).toBe(false);
  const other = planCardFiles(
    held,
    [file(A.replaceAll("-11111", "-99999"), "a.csv", AMEX_TARGET)],
    ASOF,
  )[0]!;
  expect(other.accountKeys).toEqual(["AMEX-99999"]);
  expect(other.unmatchedExisting).toBe(true);
});

test("Trading 212 file with cash rows only for the stated card: the one account, tied to the card", () => {
  const cash = `Action,Time,Currency (Total),Total
Deposit,2026-01-14 08:00:00,EUR,1000.00
Interest on cash,2026-01-15 08:00:00,EUR,0.50`;
  const f = file(cash, "trading212.csv", T212_TARGET);
  const out = applyCardFiles({ accounts: [], txs: [] }, [f], ASOF);
  expect(out.accounts).toHaveLength(1);
  expect(out.accounts[0]).toMatchObject({
    key: T212_ACCOUNT_KEY,
    name: "Trading 212",
    statedCardId: "212-card",
    source: "file",
  });
});

test("rows with an unreadable amount are counted, and (12,34) / € 12,34 read", () => {
  const csv = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/01/2026,A,X,-11111,(12.34),A,x
03/02/2026,B,X,-11111,€ 5.00,B,x
03/03/2026,C,X,-11111,abc,C,x`;
  const r = parseBankFile("a.csv", csv);
  expect(r.txs.map((t) => t.amount)).toEqual([12.34, -5]); // Amex flips: charge out
  expect(r.unreadable).toBe(1);
});

test("stampCardFile: file marker on all, card link on one; merge keeps it on a plain re-import", () => {
  const parsed = parseBankFile("x.csv", AMEX_NOACC, { accountHint: cardFileHintKey("amex-1") });
  const [acc] = stampCardFile(parsed, {
    cardId: "amex-1",
    label: "American Express Card",
    brand: "amex",
  });
  expect(acc).toMatchObject({
    source: "file",
    statedCardId: "amex-1",
    name: "American Express Card",
  });
  const plain = parseBankFile("x.csv", AMEX_NOACC, { accountHint: cardFileHintKey("amex-1") });
  const merged = mergeImportedAccounts([acc!], plain.accounts);
  expect(merged[0]).toMatchObject({
    source: "file",
    statedCardId: "amex-1",
    name: "American Express Card",
  });
});

test("stampCardFile: T212 has one account and it is tied to the card", () => {
  const parsed = parseBankFile("t.csv", T212);
  const out = stampCardFile(parsed, {
    cardId: "212-card",
    label: "212 Card",
    brand: "trading-212",
  });
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({
    key: T212_ACCOUNT_KEY,
    statedCardId: "212-card",
    source: "file",
    name: "Trading 212",
  });
});

test("PDF gets its own problem", () => {
  expect(parseBankFile("x.pdf", "%PDF-1.4").problems).toEqual([{ kind: "pdf-not-supported" }]);
});
void sheetRows;

test("Trading 212 with a picked card: card and cash rows share the one account", () => {
  const r = parseBankFile("t212.csv", T212, { accountHint: cardFileHintKey("212-card") });
  expect(r.accounts.map((a) => a.key)).toEqual([T212_ACCOUNT_KEY]);
  const out = stampCardFile(r, { cardId: "212-card", label: "212 Card", brand: "trading-212" });
  expect(out[0]!.name).toBe("Trading 212");
});

test("a live bank link on a file-fed key clears the file flag but keeps the stated card; a plain file re-import keeps both", () => {
  const prev = {
    key: "NL01INGB0001",
    iban: "NL01INGB0001",
    name: "ING",
    bank: "ING",
    entity: "P",
    currency: "EUR",
    balance: null,
    source: "file" as const,
    statedCardId: "ing-betaalpas",
    linkedAt: "2026-01-01",
  };
  const live = {
    ...prev,
    source: undefined,
    statedCardId: undefined,
    balance: 10,
    balanceFetchedAt: "2026-02-02",
  };
  delete (live as Record<string, unknown>).source;
  delete (live as Record<string, unknown>).statedCardId;
  const [afterLive] = mergeImportedAccounts([prev], [live]);
  expect(afterLive!.source).toBeUndefined();
  // The owner's answer to "which card is this?" survives the bank sync.
  expect(afterLive!.statedCardId).toBe("ing-betaalpas");
  const plain = { ...live, balanceFetchedAt: undefined };
  delete (plain as Record<string, unknown>).balanceFetchedAt;
  const [afterFile] = mergeImportedAccounts([prev], [plain]);
  expect(afterFile).toMatchObject({ source: "file", statedCardId: "ing-betaalpas" });
  expect(countsAsLinked(afterLive!)).toBe(true);
});

/* --- Round 3: never merge a card into an existing account without evidence. --- */
const GOLD = {
  cardId: "american-express-gold-card",
  label: "American Express Gold Card",
  brand: "amex",
};
const PLAT = "american-express-platinum";
const amexAcc = (key: string, over: Record<string, unknown> = {}) =>
  ({
    key,
    iban: "",
    name: key,
    bank: "American Express",
    entity: "P",
    currency: "EUR",
    balance: null,
    linkedAt: "2026-01-01",
    source: "file",
    ...over,
  }) as Account;
const GOLD_COL = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/05/2026,GOLD ONE,A,-44444,10.00,GOLD ONE,x`;
const goldInput = (
  csv: string,
  extra: Partial<CardFileInput> = {},
  hint?: string,
): CardFileInput => ({
  result: parseBankFile("g.csv", csv, hint ? { accountHint: hint } : {}),
  target: GOLD,
  link: true,
  ...extra,
});
const plat = amexAcc("AMEX-2026", { statedCardId: PLAT, name: "American Express Platinum" });

test("a different, stamped card is never merged into: two accounts, Platinum's stamp untouched", () => {
  for (const [csv, hint] of [
    [GOLD_COL, undefined],
    [AMEX_NOACC, "FILE-american-express-gold-card"],
  ] as const) {
    const held = { accounts: [plat], txs: [] };
    const f = goldInput(csv, {}, hint);
    const [plan] = planCardFiles(held, [f], ASOF);
    expect(plan!.question).toBeNull();
    expect(plan!.accountKeys).toEqual([hint ?? "AMEX-44444"]);
    expect(plan!.destination).toMatchObject({ existing: false });
    const out = applyCardFiles(held, [f], ASOF);
    expect(out.accounts.map((a) => a.key)).toEqual([hint ?? "AMEX-44444"]);
    expect(out.accounts[0]!.statedCardId).toBe(GOLD.cardId);
  }
});

test("the same card (same statedCardId) re-keys onto its account: 0 added", () => {
  const first = applyCardFiles({ accounts: [], txs: [] }, [goldInput(GOLD_COL)], ASOF);
  // Its account was keyed from the filename in an older vault.
  const old = { ...first.accounts[0]!, key: "AMEX-2026" };
  const txs = ingest(
    [],
    first.txs.map(({ id: _i, ...t }) => ({ ...t, accountKey: "AMEX-2026" })),
  );
  const f = goldInput(GOLD_COL);
  const [plan] = planCardFiles({ accounts: [old], txs }, [f], ASOF);
  expect(plan).toMatchObject({
    newCount: 0,
    accountKeys: ["AMEX-2026"],
    destination: { existing: true },
  });
});

test("a legacy unstamped file account: a question, then both answers", () => {
  const legacy = amexAcc("AMEX-2026", { source: undefined });
  const held = { accounts: [legacy], txs: [] };
  const [asked] = planCardFiles(held, [goldInput(GOLD_COL)], ASOF);
  expect(asked!.question).toEqual({ accountKey: "AMEX-2026", accountName: "AMEX-2026" });
  // Unanswered: not written.
  expect(applyCardFiles(held, [goldInput(GOLD_COL)], ASOF).added).toBe(0);
  const yes = applyCardFiles(held, [goldInput(GOLD_COL, { sameCard: true })], ASOF);
  expect(yes.accounts[0]).toMatchObject({ key: "AMEX-2026", statedCardId: GOLD.cardId });
  const no = applyCardFiles(held, [goldInput(GOLD_COL, { sameCard: false })], ASOF);
  expect(no.accounts[0]).toMatchObject({ key: "AMEX-44444", statedCardId: GOLD.cardId });
  expect(no.accounts).toHaveLength(1);
  // Generic path (no card): same question.
  const generic: CardFileInput = {
    result: parseBankFile("g.csv", GOLD_COL),
    target: null,
    link: false,
  };
  expect(planCardFiles(held, [generic], ASOF)[0]!.question).not.toBeNull();
});

test("manual and live Amex accounts are never candidates", () => {
  const manual = amexAcc("hand-made", { linkedAt: undefined, source: undefined });
  const live = amexAcc("EB-1", { source: undefined, balanceFetchedAt: "2026-02-02" });
  const [plan] = planCardFiles({ accounts: [manual, live], txs: [] }, [goldInput(GOLD_COL)], ASOF);
  expect(plan!.question).toBeNull();
  expect(plan!.accountKeys).toEqual(["AMEX-44444"]);
});

test("a filename year is not card evidence; digits must match exactly", () => {
  const yearKey = amexAcc("AMEX-2026", { statedCardId: PLAT });
  const col = GOLD_COL.replace("-44444", "-12026");
  expect(
    planCardFiles({ accounts: [yearKey], txs: [] }, [goldInput(col)], ASOF)[0]!.accountKeys,
  ).toEqual(["AMEX-12026"]);
  const odd = amexAcc("AMEX-123456-X", { source: undefined });
  const col2 = GOLD_COL.replace("-44444", "-23456");
  const [p2] = planCardFiles({ accounts: [odd], txs: [] }, [goldInput(col2)], ASOF);
  expect(p2!.accountKeys).toEqual(["AMEX-23456"]); // not re-keyed without an answer
  expect(p2!.question).not.toBeNull();
  // A longer key that merely ends in the same digits is not evidence either: the
  // parser only ever emits the last five, so equal keys are the only digit proof.
  const sfx = amexAcc("AMEX-123456", { source: undefined });
  const [p3] = planCardFiles({ accounts: [sfx], txs: [] }, [goldInput(col2)], ASOF);
  expect(p3!.accountKeys).toEqual(["AMEX-23456"]);
  expect(p3!.question).not.toBeNull();
});

const TWO_CARDS = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/05/2026,GOLD ONE,A,-44444,10.00,GOLD ONE,x
03/06/2026,OTHER CARD,B,-55555,20.00,OTHER CARD,y`;

test("a file with two cards never folds both into the one stamped account", () => {
  const gold = amexAcc("AMEX-44444", { statedCardId: GOLD.cardId, name: GOLD.label });
  const held = { accounts: [gold], txs: [] };
  const f = goldInput(TWO_CARDS);
  const [plan] = planCardFiles(held, [f], ASOF);
  expect([...plan!.accountKeys].sort()).toEqual(["AMEX-44444", "AMEX-55555"]);
  const out = applyCardFiles(held, [f], ASOF);
  expect(out.accounts.map((a) => a.key).sort()).toEqual(["AMEX-44444", "AMEX-55555"]);
  expect(out.txs.filter((t) => t.accountKey === "AMEX-44444")).toHaveLength(1);
  expect(out.txs.filter((t) => t.accountKey === "AMEX-55555")).toHaveLength(1);
  // The same file against a Gold account under an OLD key: still no fold.
  const oldGold = amexAcc("AMEX-2026", { statedCardId: GOLD.cardId, name: GOLD.label });
  const [plan2] = planCardFiles({ accounts: [oldGold], txs: [] }, [f], ASOF);
  expect(new Set(plan2!.accountKeys).size).toBe(2);
  expect(plan2!.accountKeys).not.toContain("AMEX-2026");
  expect(plan2!.unmatchedExisting).toBe(true);
});

test("one legacy account and a two-card file: split, and the preview says it could not match", () => {
  const legacy = amexAcc("AMEX-2026", { source: undefined });
  const [plan] = planCardFiles({ accounts: [legacy], txs: [] }, [goldInput(TWO_CARDS)], ASOF);
  expect(plan!.question).toBeNull();
  expect([...plan!.accountKeys].sort()).toEqual(["AMEX-44444", "AMEX-55555"]);
  expect(plan!.unmatchedExisting).toBe(true);
});

test("a vault change between preview and confirm lowers the stored count", () => {
  const f = goldInput(GOLD_COL);
  const preview = planCardFiles({ accounts: [], txs: [] }, [f], ASOF)[0]!.newCount;
  const later = ingest([], parseBankFile("g.csv", GOLD_COL, {}).txs);
  expect(preview).toBe(1);
  expect(applyCardFiles({ accounts: [], txs: later }, [f], ASOF).added).toBe(0);
});
