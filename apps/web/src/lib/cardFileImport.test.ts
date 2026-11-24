// @vitest-environment jsdom
import { expect, test } from "vitest";
import { applyCardFiles, ingest, planCardFiles, type Account } from "@lavega/core";
import {
  formatPeriod,
  isCommittable,
  previewCardFile,
  toInput,
  type CardTarget,
} from "./cardFileImport";
import { CATALOGUE_ENTRIES } from "../catalogue-rates";
import { statedCardPlaceholders } from "../plan/statedPlaceholders";
import { unconnectedItems } from "../intake/unconnectedBrands";
import { focusAfterFileDialog } from "./focusAfterFile";

const AMEX: CardTarget = {
  id: "american-express-gold-card",
  name: "American Express Gold Card",
  brand: "amex",
  kind: "credit",
};
const T212: CardTarget = { id: "212-card", name: "212 Card", brand: "trading-212", kind: "debit" };
const AMEX_CSV = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/05/2026,SHOP ONE,A TESTER,-11111,10.00,SHOP ONE,x`;
const T212_CSV = `Action,Time,ISIN,Ticker,Name,Notes,ID,Currency (Total),Total,Merchant name,Merchant category
Card debit,2026-01-15 12:30:00,,,,,c1,EUR,-12.40,Cafe Test,Restaurants
Mystery,2026-01-16 12:30:00,,,,,c2,EUR,1.00,,`;
const T212_CASH = `Action,Time,Currency (Total),Total
Deposit,2026-01-14 08:00:00,EUR,1000.00`;
const labels = { credit: "Een andere kaart", debit: "Een andere pas" };
const ASOF = "2026-11-16";
const read = (csv: string, name: string, card: CardTarget | null = null) =>
  previewCardFile(new File([csv], name), { id: name, entity: "Prive", card });
const stateOf = (held: { accounts: Account[] }) => ({
  credit: [AMEX.id],
  debit: [T212.id],
  accounts: held.accounts,
  entries: CATALOGUE_ENTRIES,
  otherLabels: labels,
});

test("preview reads without planning; commit stamps the account and the placeholder clears", async () => {
  const p = await read(AMEX_CSV, "amex.csv", AMEX);
  expect(p.matchesCard).toBe(true);
  const input = toInput(p, AMEX, false)!;
  const [plan] = planCardFiles({ accounts: [], txs: [] }, [input], ASOF);
  expect(plan).toMatchObject({ txCount: 1, newCount: 1, duplicateCount: 0 });
  expect(isCommittable(p, plan, false)).toBe(true);
  const out = applyCardFiles({ accounts: [], txs: [] }, [input], ASOF);
  expect(out.accounts[0]).toMatchObject({
    key: "AMEX-11111",
    source: "file",
    statedCardId: AMEX.id,
    name: "American Express Gold Card",
  });
  expect(statedCardPlaceholders({ ...stateOf({ accounts: [] }), debit: [] })).toHaveLength(1);
  expect(statedCardPlaceholders({ ...stateOf(out), debit: [] })).toEqual([]);
});

test("re-importing the same file counts every row as already there", async () => {
  const p = await read(AMEX_CSV, "amex.csv", AMEX);
  const input = toInput(p, AMEX, false)!;
  const held = applyCardFiles({ accounts: [], txs: [] }, [input], ASOF);
  const [again] = planCardFiles({ accounts: held.accounts, txs: held.txs }, [input], ASOF);
  expect(again).toMatchObject({ newCount: 0, duplicateCount: 1 });
});

test("an ING file for an Amex card does not match the chosen card until the user continues", async () => {
  const ING = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"x"`;
  const p = await read(ING, "ing.csv", AMEX);
  expect(p.matchesCard).toBe(false);
  expect(toInput(p, AMEX, true)!.link).toBe(false);
});

test("Trading 212: a card file and a cash-only file both land in the ONE account and clear the card", async () => {
  const card = await read(T212_CSV, "t212.csv", T212);
  const [plan] = planCardFiles({ accounts: [], txs: [] }, [toInput(card, T212, false)!], ASOF);
  expect(plan!.unrecognised).toEqual([{ action: "Mystery", count: 1 }]);
  expect(plan!.destination).toEqual({ existing: false, name: "Trading 212" });
  const out = applyCardFiles({ accounts: [], txs: [] }, [toInput(card, T212, false)!], ASOF);
  expect(statedCardPlaceholders({ ...stateOf(out), credit: [] })).toEqual([]);

  const cash = await read(T212_CASH, "trading212-other-name.csv", T212);
  const cin = toInput(cash, T212, false)!;
  const [again] = planCardFiles({ accounts: out.accounts, txs: out.txs }, [cin], ASOF);
  expect(again).toMatchObject({
    foldsExisting: false,
    destination: { existing: true, name: "Trading 212" },
  });
  const both = applyCardFiles({ accounts: out.accounts, txs: out.txs }, [cin], ASOF);
  expect(both.txs.map((t) => t.accountKey)).toEqual(["TRADING212-CARD", "TRADING212-CARD"]);

  // a cash-only export alone also stamps the card and clears the placeholder
  const held = applyCardFiles({ accounts: [], txs: [] }, [cin], ASOF);
  expect(held.accounts).toHaveLength(1);
  expect(statedCardPlaceholders({ ...stateOf(held), credit: [] })).toEqual([]);
  const items = unconnectedItems(
    { current: { statedBanks: { value: ["trading-212"] } } } as never,
    held.accounts,
  );
  expect(items).toEqual([]);
});

test("Trading 212 preview: the fold line only appears when a fold will happen, and planning writes nothing", async () => {
  const card = await read(T212_CSV, "t212.csv", T212);
  const input = toInput(card, T212, false)!;
  const old = {
    key: "FILE-NAME",
    iban: "",
    name: "FILE-NAME",
    bank: "Trading 212",
    entity: "P",
    currency: "EUR",
    balance: null,
    source: "file",
    linkedAt: "2026-11-01",
  } as Account;
  const held = { accounts: [old], txs: [] };
  const snap = JSON.stringify(held);
  expect(planCardFiles(held, [input], ASOF)[0]).toMatchObject({
    foldsExisting: true,
    destination: { name: "Trading 212" },
  });
  expect(JSON.stringify(held)).toBe(snap);
  expect(planCardFiles({ accounts: [], txs: [] }, [input], ASOF)[0]!.foldsExisting).toBe(false);
});

test("two overlapping files in one list store 3 rows; previews say 2 new then 1 new", async () => {
  const mk = (rows: string[]) =>
    `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details\n${rows.join("\n")}`;
  const a = await read(
    mk(["03/01/2026,R1,A,-11111,1.00,R1,x", "03/02/2026,R2,A,-11111,2.00,R2,x"]),
    "a.csv",
    AMEX,
  );
  const b = await read(
    mk(["03/02/2026,R2,A,-11111,2.00,R2,x", "03/03/2026,R3,A,-11111,3.00,R3,x"]),
    "b.csv",
    AMEX,
  );
  const inputs = [toInput(a, AMEX, false)!, toInput(b, AMEX, false)!];
  expect(planCardFiles({ accounts: [], txs: [] }, inputs, ASOF).map((p) => p.newCount)).toEqual([
    2, 1,
  ]);
  const out = applyCardFiles({ accounts: [], txs: [] }, inputs, ASOF);
  expect(out.added).toBe(3);
  expect(
    ingest(
      [],
      out.txs.map(({ id: _id, ...t }) => t),
    ),
  ).toHaveLength(3);
});

test("an old filename-keyed Amex account takes the rows only after the user says it is the same card", async () => {
  const old = await read(
    AMEX_CSV.replace(",Account #", ",Zzz").replace("-11111", "x"),
    "AMEX-2026.csv",
  );
  expect(old.result!.accounts[0]!.key).toBe("AMEX-2026");
  const held = {
    accounts: old.result!.accounts.map((a) => ({ ...a, linkedAt: "2026-01-01" })),
    txs: ingest([], old.result!.txs),
  };
  const p = await read(AMEX_CSV, "new.csv", AMEX);
  expect(planCardFiles(held, [toInput(p, AMEX, false)!], ASOF)[0]!.question).not.toBeNull();
  const yes = toInput(p, AMEX, false, true)!;
  expect(planCardFiles(held, [yes], ASOF)[0]!.newCount).toBe(0); // the same rows as the old file: deduped
  const out = applyCardFiles(held, [yes], ASOF);
  expect(out.accounts[0]).toMatchObject({ key: "AMEX-2026", statedCardId: AMEX.id });
  const no = applyCardFiles(held, [toInput(p, AMEX, false, false)!], ASOF);
  expect(no.accounts[0]).toMatchObject({ key: "AMEX-11111", statedCardId: AMEX.id });
});

test("an .xls is refused without reading; a broken xlsx gives a reason, never raw text", async () => {
  const xls = await read("whatever", "old.xls", AMEX);
  expect(xls).toMatchObject({ result: null, reason: "xls" });
  const bad = await read("PK\u0003\u0004junk", "a.xlsx", AMEX);
  expect(bad).toMatchObject({ result: null, reason: "unreadable" });
  expect(JSON.stringify(bad)).not.toContain("xlsx:");
});

test("period: first year dropped when both dates share it", () => {
  expect(formatPeriod("nl", "2026-11-03", "2026-11-09")).toBe("3 nov – 9 nov 2026");
  expect(formatPeriod("nl", "2025-12-30", "2026-01-02")).toBe("30 dec 2025 – 2 jan 2026");
});

test("focus after close never stays on body", () => {
  document.body.innerHTML = '<main><h1>Rekeningen</h1><button id="b">x</button></main>';
  (document.activeElement as HTMLElement | null)?.blur();
  const el = focusAfterFileDialog();
  expect(el?.tagName).toBe("H1");
  expect(document.activeElement).toBe(el);
  document.getElementById("b")!.focus();
  expect(focusAfterFileDialog()?.id).toBe("b");
});

test("keeping current: a file-fed card's entered balance is rolled forward by LATER imported rows", async () => {
  const { withCurrentBalances } = await import("@lavega/core");
  const p = await read(AMEX_CSV, "amex.csv", AMEX);
  const out = applyCardFiles({ accounts: [], txs: [] }, [toInput(p, AMEX, false)!], ASOF);
  // The user entered what they owe on 16 Nov (stored negative by the saldo path).
  const acct = { ...out.accounts[0]!, balance: -842.17, balanceDate: "2026-11-16" };
  const later = ingest(out.txs, [
    {
      accountKey: acct.key,
      date: "2026-11-18",
      amount: -10,
      currency: "EUR",
      counterparty: "NEW",
      description: "",
      category: "",
      manual: false,
    },
  ]);
  const [rolled] = withCurrentBalances([acct], later, "2026-11-20");
  expect(rolled!.balance).toBeCloseTo(-852.17, 2);
  // Rows dated before the balance date are already in it and do not move it.
  expect(withCurrentBalances([acct], out.txs, "2026-11-20")[0]!.balance).toBeCloseTo(-842.17, 2);
});
