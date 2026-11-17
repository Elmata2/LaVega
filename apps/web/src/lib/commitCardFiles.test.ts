import { expect, test } from "vitest";
import { parseBankFile, type Account, type Tx } from "@lavega/core";
import { commitToStorage } from "./commitCardFiles";

const CSV = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/01/2026,ROW ONE,A,-11111,1.00,ROW ONE,x`;
const files = [{ result: parseBankFile("a.csv", CSV), target: null, link: false }];

function fake(failOn: "putAccounts" | "putTxs" | null) {
  let accounts: Account[] = [];
  let txs: Tx[] = [];
  return {
    store: {
      async putAccounts(a: Account[]) {
        if (failOn === "putAccounts") throw new Error("boom");
        accounts = a;
      },
      async putTxs(t: Tx[]) {
        if (failOn === "putTxs") throw new Error("boom");
        txs = t;
      },
      getAccounts: async () => accounts,
      getTxs: async () => txs,
    },
    written: () => ({ accounts, txs }),
  };
}

test("success stores and returns the stored state and the added count", async () => {
  const f = fake(null);
  const r = await commitToStorage(f.store, { accounts: [], txs: [] }, files, "2026-11-16", async () => {});
  expect(r).toMatchObject({ ok: true, count: 1 });
  expect(f.written().txs).toHaveLength(1);
});

test("a failure before anything is written is not partial", async () => {
  const f = fake("putAccounts");
  const r = await commitToStorage(f.store, { accounts: [], txs: [] }, files, "2026-11-16", async () => {});
  expect(r).toMatchObject({ ok: false, partial: false });
});

test("a failure after accounts were written is partial and returns the re-read state", async () => {
  const f = fake("putTxs");
  const r = await commitToStorage(f.store, { accounts: [], txs: [] }, files, "2026-11-16", async () => {});
  expect(r).toMatchObject({ ok: false, partial: true });
  if (!r.ok) expect(r.accounts).toHaveLength(1);
});

test("a failing follow-up step after the rows are in is partial too", async () => {
  const f = fake(null);
  const r = await commitToStorage(f.store, { accounts: [], txs: [] }, files, "2026-11-16", async () => {
    throw new Error("bills");
  });
  expect(r).toMatchObject({ ok: false, partial: true });
  if (!r.ok) expect(r.txs).toHaveLength(1);
});

test("the result names the accounts this import wrote, as stored", async () => {
  const f = fake(null);
  const r = await commitToStorage(f.store, { accounts: [], txs: [] }, files, "2026-11-16", async () => {});
  if (!r.ok) throw new Error("expected ok");
  expect(r.written.map((a) => a.key)).toEqual(["AMEX-11111"]);
  expect(r.written[0]!.balance).toBeNull();
});
