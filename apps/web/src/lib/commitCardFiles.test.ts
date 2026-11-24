import { expect, test } from "vitest";
import {
  billMatchId,
  EMPTY_BILL_DECISIONS,
  ingest,
  parseBankFile,
  transferPairId,
  type Account,
  type BillDecisions,
  type ImportSession,
  type VaultDocument,
  type Tx,
  type TransferPair,
  type Valuation,
} from "@lavega/core";
import { commitToStorage, type FoldRefsState } from "./commitCardFiles";

const CSV = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/01/2026,ROW ONE,A,-11111,1.00,ROW ONE,x`;
const files = [{ result: parseBankFile("a.csv", CSV), target: null, link: false }];

/** An upsert store like the real one: put by key/id, delete by key/id. */
function fake(failOn: "putAccounts" | "putTxs" | null, seed?: { accounts: Account[]; txs: Tx[] }) {
  let accounts: Account[] = [...(seed?.accounts ?? [])];
  let txs: Tx[] = [...(seed?.txs ?? [])];
  return {
    store: {
      async putAccounts(a: Account[]) {
        if (failOn === "putAccounts") throw new Error("boom");
        const keys = new Set(a.map((x) => x.key));
        accounts = [...accounts.filter((x) => !keys.has(x.key)), ...a];
      },
      async putTxs(t: Tx[]) {
        if (failOn === "putTxs") throw new Error("boom");
        const ids = new Set(t.map((x) => x.id));
        txs = [...txs.filter((x) => !ids.has(x.id)), ...t];
      },
      async deleteTxs(ids: string[]) {
        txs = txs.filter((x) => !ids.includes(x.id));
      },
      async deleteAccount(key: string) {
        accounts = accounts.filter((x) => x.key !== key);
      },
      getAccounts: async () => accounts,
      getTxs: async () => txs,
    },
    written: () => ({ accounts, txs }),
  };
}

test("success stores and returns the stored state and the added count", async () => {
  const f = fake(null);
  const r = await commitToStorage(
    f.store,
    { accounts: [], txs: [] },
    files,
    "2026-11-16",
    async () => {},
  );
  expect(r).toMatchObject({ ok: true, count: 1 });
  expect(f.written().txs).toHaveLength(1);
});

test("a failure before anything is written is not partial", async () => {
  const f = fake("putAccounts");
  const r = await commitToStorage(
    f.store,
    { accounts: [], txs: [] },
    files,
    "2026-11-16",
    async () => {},
  );
  expect(r).toMatchObject({ ok: false, partial: false });
});

test("a failure after accounts were written is partial and returns the re-read state", async () => {
  const f = fake("putTxs");
  const r = await commitToStorage(
    f.store,
    { accounts: [], txs: [] },
    files,
    "2026-11-16",
    async () => {},
  );
  expect(r).toMatchObject({ ok: false, partial: true });
  if (!r.ok) expect(r.accounts).toHaveLength(1);
});

test("a failing follow-up step after the rows are in is partial too", async () => {
  const f = fake(null);
  const r = await commitToStorage(
    f.store,
    { accounts: [], txs: [] },
    files,
    "2026-11-16",
    async () => {
      throw new Error("bills");
    },
  );
  expect(r).toMatchObject({ ok: false, partial: true });
  if (!r.ok) expect(r.txs).toHaveLength(1);
});

test("the result names the accounts this import wrote, as stored", async () => {
  const f = fake(null);
  const r = await commitToStorage(
    f.store,
    { accounts: [], txs: [] },
    files,
    "2026-11-16",
    async () => {},
  );
  if (!r.ok) throw new Error("expected ok");
  expect(r.written.map((a) => a.key)).toEqual(["AMEX-11111"]);
  expect(r.written[0]!.balance).toBeNull();
});

/* Trading 212: a vault with the card account and a file-name-keyed cash account. */
const T212_FILE = `Action,Time,Currency (Total),Total,Merchant name
Card debit,2026-01-01 10:00:00,EUR,-1.00,Shop A
Card debit,2026-01-02 10:00:00,EUR,-2.00,Shop B
Deposit,2026-01-04 10:00:00,EUR,100.00,
Interest on cash,2026-01-05 10:00:00,EUR,0.50,`;
const OLD = "from_2026-10-01_to_2026-11-16_MTc5NDg1MD";
const base = {
  iban: "",
  entity: "P",
  currency: "EUR",
  bank: "Trading 212",
  linkedAt: "2026-11-02",
  source: "file" as const,
};

test("Trading 212 migration: stored vault ends with one account, no duplicate rows, old account and ids gone", async () => {
  const parsed = parseBankFile("x.csv", T212_FILE);
  const mk = (accountKey: string, descs: string[]) =>
    parsed.txs.filter((t) => descs.includes(t.description)).map((t) => ({ ...t, accountKey }));
  const seedTxs = ingest(
    [],
    [...mk("TRADING212-CARD", ["Card debit"]), ...mk(OLD, ["Deposit", "Interest on cash"])],
  );
  const seed = {
    accounts: [
      {
        ...base,
        key: "TRADING212-CARD",
        name: "Trading 212 Card",
        balance: 250,
        balanceDate: "2026-11-01",
        statedCardId: "212-card",
      },
      { ...base, key: OLD, name: OLD, balance: null },
    ] as Account[],
    txs: seedTxs,
  };
  const f = fake(null, seed);
  const input = [
    {
      result: parsed,
      target: { cardId: "212-card", label: "212 Card", brand: "trading-212" },
      link: true,
    },
  ];
  const r = await commitToStorage(f.store, seed, input, "2026-11-16", async () => {});
  if (!r.ok) throw new Error("expected ok");
  expect(r.count).toBe(0);
  expect(r.folds).toEqual([{ survivorKey: "TRADING212-CARD", duplicateKey: OLD }]);
  const stored = f.written();
  expect(stored.accounts).toHaveLength(1);
  expect(stored.accounts[0]).toMatchObject({
    key: "TRADING212-CARD",
    name: "Trading 212",
    balance: 250,
    statedCardId: "212-card",
  });
  expect(stored.txs).toHaveLength(4);
  expect(new Set(stored.txs.map((t) => t.accountKey))).toEqual(new Set(["TRADING212-CARD"]));
  // the same file again, and a later file under another name, change nothing / add rows to the same account
  const again = await commitToStorage(
    f.store,
    { accounts: stored.accounts, txs: stored.txs },
    input,
    "2026-11-16",
    async () => {},
  );
  expect(again).toMatchObject({ ok: true, count: 0, folds: [] });
  expect(f.written().accounts).toHaveLength(1);
});

/* --- A2/A3: the fold writes the records that point at rows BEFORE it deletes anything,
 * and a retry after a failure at any step finishes the job. --- */
const STEPS = [
  "putAccounts",
  "putTxs",
  "putTransfers",
  "putValuations",
  "putBillPlan",
  "putImportSessions",
  "putDocuments",
  "deleteTxs",
  "deleteAccount",
] as const;
type Step = (typeof STEPS)[number];

function world() {
  const parsed = parseBankFile("x.csv", T212_FILE);
  const mk = (accountKey: string, descs: string[]) =>
    parsed.txs.filter((t) => descs.includes(t.description)).map((t) => ({ ...t, accountKey }));
  const txs = ingest(
    [],
    [...mk("TRADING212-CARD", ["Card debit"]), ...mk(OLD, ["Deposit", "Interest on cash"])],
  );
  const deposit = txs.find((t) => t.description === "Deposit")!;
  const card = txs.find((t) => t.description === "Card debit")!;
  const db = {
    accounts: [
      {
        ...base,
        key: "TRADING212-CARD",
        name: "Trading 212 Card",
        balance: 250,
        balanceDate: "2026-11-01",
        statedCardId: "212-card",
      },
      { ...base, key: OLD, name: OLD, balance: null },
    ] as Account[],
    txs,
    transfers: [
      {
        id: transferPairId(card.id, deposit.id),
        outflowTxId: card.id,
        inflowTxId: deposit.id,
        status: "confirmed",
        kind: "funds_movement",
        amountCents: 100,
        currency: "EUR",
        createdAt: "x",
      },
    ] as TransferPair[],
    valuations: [
      {
        id: `${OLD}|2026-01-04`,
        accountKey: OLD,
        date: "2026-01-04",
        amountCents: 100,
        currency: "EUR",
        kind: "reconciliation",
        source: "manual",
        recordedAt: "x",
      },
    ] as unknown as Valuation[],
    decisions: {
      ...EMPTY_BILL_DECISIONS,
      matches: [
        {
          id: billMatchId("occ", deposit.id),
          occurrenceId: "occ",
          billId: "b",
          txId: deposit.id,
          amountCents: 1,
          currency: "EUR",
          source: "user",
          confidence: 1,
          decidedAt: "x",
        },
      ],
    } as BillDecisions,
    sessions: [{ id: "s1", accountKey: OLD, txIds: [deposit.id] }] as unknown as ImportSession[],
    documents: [
      { id: "d1", accountKey: OLD, suggestedAccountKey: null, txIds: [deposit.id] },
    ] as unknown as VaultDocument[],
  };
  return { db, deposit };
}

function fakeDb(db: ReturnType<typeof world>["db"], failAt: Step | null) {
  const state = { ...db, accounts: [...db.accounts], txs: [...db.txs] };
  const hit = (s: Step) => {
    if (failAt === s) throw new Error(`boom ${s}`);
  };
  const store = {
    async putAccounts(a: Account[]) {
      hit("putAccounts");
      const k = new Set(a.map((x) => x.key));
      state.accounts = [...state.accounts.filter((x) => !k.has(x.key)), ...a];
    },
    async putTxs(t: Tx[]) {
      hit("putTxs");
      const k = new Set(t.map((x) => x.id));
      state.txs = [...state.txs.filter((x) => !k.has(x.id)), ...t];
    },
    async deleteTxs(ids: string[]) {
      hit("deleteTxs");
      state.txs = state.txs.filter((x) => !ids.includes(x.id));
    },
    async deleteAccount(key: string) {
      hit("deleteAccount");
      state.accounts = state.accounts.filter((x) => x.key !== key);
    },
    getAccounts: async () => state.accounts,
    getTxs: async () => state.txs,
  };
  const refStore = {
    async putTransfers(p: TransferPair[]) {
      hit("putTransfers");
      state.transfers = p;
    },
    async putValuations(v: Valuation[]) {
      hit("putValuations");
      state.valuations = v;
    },
    async putBillPlan(_b: unknown, _o: unknown, d: BillDecisions) {
      hit("putBillPlan");
      state.decisions = d;
    },
    async putImportSessions(x: ImportSession[]) {
      hit("putImportSessions");
      state.sessions = x;
    },
    async putDocuments(x: VaultDocument[]) {
      hit("putDocuments");
      state.documents = x;
    },
  };
  return { state, store, refStore };
}

const refsOf = (s: ReturnType<typeof fakeDb>["state"]): FoldRefsState => ({
  transfers: s.transfers,
  valuations: s.valuations,
  bills: [],
  billOccurrences: [],
  decisions: s.decisions,
  sessions: s.sessions,
  documents: s.documents,
});

async function runImport(f: ReturnType<typeof fakeDb>) {
  const parsed = parseBankFile("x.csv", T212_FILE);
  const input = [
    {
      result: parsed,
      target: { cardId: "212-card", label: "212 Card", brand: "trading-212" },
      link: true,
    },
  ];
  let refs = refsOf(f.state);
  return commitToStorage(
    f.store,
    { accounts: f.state.accounts, txs: f.state.txs },
    input,
    "2026-11-16",
    async () => {},
    {
      state: refs,
      store: f.refStore,
      onWritten: (n) => {
        refs = n;
      },
    },
  );
}

function expectHealed(s: ReturnType<typeof fakeDb>["state"]) {
  expect(s.accounts.map((a) => a.key)).toEqual(["TRADING212-CARD"]);
  expect(s.accounts[0]).toMatchObject({ balance: 250, statedCardId: "212-card" });
  expect(s.txs).toHaveLength(4);
  expect(new Set(s.txs.map((t) => t.id)).size).toBe(4);
  expect(s.txs.every((t) => t.accountKey === "TRADING212-CARD")).toBe(true);
  const ids = new Set(s.txs.map((t) => t.id));
  expect(s.transfers).toHaveLength(1);
  expect(ids.has(s.transfers[0]!.outflowTxId) && ids.has(s.transfers[0]!.inflowTxId)).toBe(true);
  expect(s.valuations.map((v) => v.accountKey)).toEqual(["TRADING212-CARD"]);
  expect(s.decisions.matches).toHaveLength(1);
  expect(ids.has(s.decisions.matches[0]!.txId)).toBe(true);
  expect(s.sessions[0]).toMatchObject({ accountKey: "TRADING212-CARD" });
  expect(s.sessions[0]!.txIds.every((id) => ids.has(id))).toBe(true);
  expect(s.documents[0]).toMatchObject({ accountKey: "TRADING212-CARD" });
  expect(s.documents[0]!.txIds!.every((id) => ids.has(id))).toBe(true);
}

test("a clean fold writes records first, then deletes, and ends healed", async () => {
  const f = fakeDb(world().db, null);
  const r = await runImport(f);
  expect(r).toMatchObject({ ok: true, count: 0 });
  expectHealed(f.state);
});

test("issue #355: category set while commitToStorage is in-flight is preserved in storage and result", async () => {
  const existing: Tx = {
    id: "tx-existing",
    accountKey: "NL91ABNA0417164300",
    date: "2026-02-01",
    amount: -12.5,
    currency: "EUR",
    counterparty: "NS Groep",
    description: "Treinkaartje",
    category: "",
    manual: false,
  };
  const f = fake(null, { accounts: [], txs: [existing] });

  // Hold putAccounts open so a category save can land in storage mid-import,
  // while commitToStorage was handed the older held snapshot (`category: ""`).
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const origPutAccounts = f.store.putAccounts.bind(f.store);
  f.store.putAccounts = async (a) => {
    await gate;
    await origPutAccounts(a);
  };

  const committing = commitToStorage(
    f.store,
    { accounts: [], txs: [existing] },
    files,
    "2026-11-16",
    async () => {},
  );

  // Concurrent category save updates existing tx in storage while import runs.
  await f.store.putTxs([{ ...existing, category: "Transport", manual: true }]);
  release();

  const r = await committing;
  if (!r.ok) throw new Error("expected ok");
  expect(r.count).toBe(1);
  // Both persisted storage AND returned state keep the newly set category.
  expect(f.written().txs.find((t) => t.id === "tx-existing")).toMatchObject({
    category: "Transport",
    manual: true,
  });
  expect(r.txs.find((t) => t.id === "tx-existing")).toMatchObject({
    category: "Transport",
    manual: true,
  });
  expect(f.written().txs).toHaveLength(2);
});

test.each(STEPS)(
  "a failure at %s returns partial, never throws, and the same import afterwards heals",
  async (step) => {
    const w = world();
    const f = fakeDb(w.db, step);
    const first = await runImport(f);
    expect(first).toMatchObject({ ok: false, partial: step !== "putAccounts" });
    // the failure is gone; the second identical import runs against what is stored
    const retry = fakeDb({ ...f.state }, null);
    const second = await runImport(retry);
    expect(second).toMatchObject({ ok: true });
    expectHealed(retry.state);
  },
);
