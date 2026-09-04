# LaVega — Transactions & Accounts views (with entity reassignment) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Grow the app from a single aggregated Overzicht into three views — **Overzicht** (existing), **Transacties** (a filterable list of individual transactions), **Rekeningen** (per-account list with **inline entity reassignment**) — so the owner can inspect individual transactions and re-group an account under a different entity without re-importing.

**Architecture:** All the derivation logic lives as pure, unit-tested helpers in `@lavega/core` (`enrichTxs`, `filterTxs`, `accountSummaries`, `reassignEntity`); the views + filter state + reassignment wiring live in `apps/web/src/App.tsx`; persistence reuses the existing `StorageAdapter.putAccounts`. No new dependencies, no new adapters, no router.

**Tech stack:** TypeScript, React (Vite), Vitest (+ jsdom + fake-indexeddb for the headless wiring test — the repo's existing pattern; there is no component-render library and we don't add one).

## Global Constraints

- **`packages/core` stays I/O-free** — the new helpers are pure functions over `Account[]`/`Tx[]`. ESM (`.js` import specifiers).
- **Don't break existing behavior** — the Import section (incl. the `.sta` accept fix) and the Overzicht table must keep working exactly as today; `overview.test.ts` stays green.
- **Reassignment goes through storage** — changing an account's `entity` persists via `storage.putAccounts(...)` and re-consolidates; `consolidate` already groups by `account.entity` (rebuilt from accounts each call), so its transactions regroup automatically. Do NOT change `consolidate`, `ingest`, `tx.id`, or any parser.
- **Dutch UI copy** (matches the existing app): view labels `Overzicht` / `Transacties` / `Rekeningen`; column headers in Dutch as specified per task.
- Amounts formatted with the existing `formatEuro` (nl-NL EUR); dates shown as the stored ISO `YYYY-MM-DD`.

---

### Task 1: Pure view helpers in `@lavega/core`

**Files:**

- Create: `packages/core/src/views.ts`
- Create: `packages/core/src/views.test.ts`
- Modify: `packages/core/src/index.ts` (add one export line)

**Interfaces:**

- Consumes: `Account`, `Tx` from `./model.js`; `norm` from `./hash.js`.
- Produces (later tasks rely on these exact signatures):
  - `type EnrichedTx = Tx & { entity: string; bank: string; accountName: string }`
  - `enrichTxs(txs: Tx[], accounts: Account[]): EnrichedTx[]`
  - `type TxFilter = { entity?: string; accountKey?: string; search?: string }`
  - `filterTxs(txs: EnrichedTx[], f: TxFilter): EnrichedTx[]`
  - `type AccountSummary = { account: Account; txCount: number }`
  - `accountSummaries(accounts: Account[], txs: Tx[]): AccountSummary[]`
  - `reassignEntity(accounts: Account[], key: string, entity: string): Account[]`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/src/views.test.ts
import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { enrichTxs, filterTxs, accountSummaries, reassignEntity } from "./views.js";

const accounts: Account[] = [
  {
    key: "NL01INGB0001",
    iban: "NL01INGB0001",
    name: "ING lopend",
    bank: "ING",
    entity: "BV1",
    currency: "EUR",
    balance: null,
  },
  {
    key: "NL91ABNA0417164300",
    iban: "NL91ABNA0417164300",
    name: "ABN zakelijk",
    bank: "ABN AMRO",
    entity: "BV2",
    currency: "EUR",
    balance: 3424.5,
  },
];
const txs: Tx[] = [
  {
    id: "t1",
    accountKey: "NL01INGB0001",
    date: "2026-01-03",
    amount: 2500,
    currency: "EUR",
    counterparty: "Salaris",
    description: "Loon januari",
    category: "",
    manual: false,
  },
  {
    id: "t2",
    accountKey: "NL01INGB0001",
    date: "2026-01-02",
    amount: -12.34,
    currency: "EUR",
    counterparty: "Albert Heijn",
    description: "Boodschappen",
    category: "",
    manual: false,
  },
  {
    id: "t3",
    accountKey: "NL91ABNA0417164300",
    date: "2026-01-05",
    amount: -45,
    currency: "EUR",
    counterparty: "Coolblue",
    description: "Laptop",
    category: "",
    manual: false,
  },
  {
    id: "t4",
    accountKey: "NL99UNKNOWN000",
    date: "2026-01-06",
    amount: -9.99,
    currency: "EUR",
    counterparty: "Onbekend",
    description: "x",
    category: "",
    manual: false,
  },
];

test("enrichTxs joins each tx to its account's entity/bank/name; missing account -> onbekend", () => {
  const e = enrichTxs(txs, accounts);
  expect(e).toHaveLength(4);
  expect(e[0]).toMatchObject({ id: "t1", entity: "BV1", bank: "ING", accountName: "ING lopend" });
  expect(e[2]).toMatchObject({ id: "t3", entity: "BV2", bank: "ABN AMRO" });
  // tx whose accountKey has no matching account
  expect(e[3]).toMatchObject({
    id: "t4",
    entity: "onbekend",
    bank: "",
    accountName: "NL99UNKNOWN000",
  });
});

test("filterTxs filters by entity, account, and case-insensitive search, combinable", () => {
  const e = enrichTxs(txs, accounts);
  expect(filterTxs(e, { entity: "BV1" }).map((t) => t.id)).toEqual(["t1", "t2"]);
  expect(filterTxs(e, { accountKey: "NL91ABNA0417164300" }).map((t) => t.id)).toEqual(["t3"]);
  // search matches counterparty OR description, case-insensitive
  expect(filterTxs(e, { search: "albert" }).map((t) => t.id)).toEqual(["t2"]);
  expect(filterTxs(e, { search: "LOON" }).map((t) => t.id)).toEqual(["t1"]);
  // combined: entity + search
  expect(filterTxs(e, { entity: "BV1", search: "boodschappen" }).map((t) => t.id)).toEqual(["t2"]);
  // empty filter returns all (order preserved)
  expect(filterTxs(e, {}).map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4"]);
});

test("accountSummaries counts txs per account, including accounts with zero txs", () => {
  const accountsPlusEmpty: Account[] = [
    ...accounts,
    {
      key: "NL22KNAB0000",
      iban: "NL22KNAB0000",
      name: "Knab",
      bank: "Knab",
      entity: "BV1",
      currency: "EUR",
      balance: null,
    },
  ];
  const s = accountSummaries(accountsPlusEmpty, txs);
  expect(s.find((x) => x.account.key === "NL01INGB0001")!.txCount).toBe(2);
  expect(s.find((x) => x.account.key === "NL91ABNA0417164300")!.txCount).toBe(1);
  expect(s.find((x) => x.account.key === "NL22KNAB0000")!.txCount).toBe(0);
});

test("reassignEntity changes only the target account, immutably", () => {
  const next = reassignEntity(accounts, "NL01INGB0001", "BV3");
  expect(next.find((a) => a.key === "NL01INGB0001")!.entity).toBe("BV3");
  expect(next.find((a) => a.key === "NL91ABNA0417164300")!.entity).toBe("BV2"); // untouched
  expect(accounts.find((a) => a.key === "NL01INGB0001")!.entity).toBe("BV1"); // original not mutated
  expect(next).not.toBe(accounts);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test` (from repo root). Expected: FAIL — `./views.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/views.ts
import type { Account, Tx } from "./model.js";
import { norm } from "./hash.js";

/* Pure derivations behind the Transacties and Rekeningen views. No I/O — these
 * take the already-loaded accounts/txs and return view-ready data, so the
 * React components stay thin and the logic is unit-tested here. */

export type EnrichedTx = Tx & { entity: string; bank: string; accountName: string };

/** Join each tx to its account so the Transacties table can show entity/bank
 *  without a per-row lookup. A tx whose accountKey has no account (shouldn't
 *  normally happen) falls back to entity "onbekend" — matching consolidate. */
export function enrichTxs(txs: Tx[], accounts: Account[]): EnrichedTx[] {
  const byKey = new Map(accounts.map((a) => [a.key, a]));
  return txs.map((t) => {
    const a = byKey.get(t.accountKey);
    return {
      ...t,
      entity: a?.entity ?? "onbekend",
      bank: a?.bank ?? "",
      accountName: a?.name ?? t.accountKey,
    };
  });
}

export type TxFilter = { entity?: string; accountKey?: string; search?: string };

/** Apply the (combinable) Transacties filters. Search is case/space-insensitive
 *  over counterparty + description (via norm). Input order is preserved. */
export function filterTxs(txs: EnrichedTx[], f: TxFilter): EnrichedTx[] {
  const q = f.search ? norm(f.search) : "";
  return txs.filter((t) => {
    if (f.entity && t.entity !== f.entity) return false;
    if (f.accountKey && t.accountKey !== f.accountKey) return false;
    if (q && !(norm(t.counterparty).includes(q) || norm(t.description).includes(q))) return false;
    return true;
  });
}

export type AccountSummary = { account: Account; txCount: number };

/** Per-account transaction count for the Rekeningen table (balance is already
 *  on the account). Accounts with zero txs are still returned. */
export function accountSummaries(accounts: Account[], txs: Tx[]): AccountSummary[] {
  const counts = new Map<string, number>();
  for (const t of txs) counts.set(t.accountKey, (counts.get(t.accountKey) ?? 0) + 1);
  return accounts.map((a) => ({ account: a, txCount: counts.get(a.key) ?? 0 }));
}

/** Return a new accounts array with one account reassigned to `entity`
 *  (immutable — never mutates the input). The caller persists + re-consolidates. */
export function reassignEntity(accounts: Account[], key: string, entity: string): Account[] {
  return accounts.map((a) => (a.key === key ? { ...a, entity } : a));
}
```

- [ ] **Step 4: Add the export**

In `packages/core/src/index.ts`, add:

```ts
export * from "./views.js";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test` then `pnpm typecheck` (repo root). Expected: PASS (4 new tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/views.ts packages/core/src/views.test.ts packages/core/src/index.ts
git commit -m "feat(core): pure view helpers (enrichTxs, filterTxs, accountSummaries, reassignEntity)"
```

---

### Task 2: Navigation shell + Transacties view

**Files:**

- Modify: `apps/web/src/App.tsx` (add view state + nav + the Transacties view; keep Import + Overzicht intact)
- Create: `apps/web/src/transactions.test.ts` (headless data-pipeline test)

**Interfaces:**

- Consumes: `enrichTxs`, `filterTxs`, `EnrichedTx` from `@lavega/core` (Task 1); existing `accounts`/`txs` state and `formatEuro` in App.tsx.
- Produces: a `view` state (`"overview" | "transactions" | "accounts"`) and nav that Task 3 extends with the Rekeningen view.

**Design notes for the implementer:**

- Add `const [view, setView] = useState<"overview" | "transactions" | "accounts">("overview")`.
- Render a nav (3 `<button>`s) above the sections; the active view's button is disabled or marked `aria-current="page"`.
- The Import `<section>` stays visible in all views (it's the primary action). Only the per-view content (Overzicht table / Transacties table / Rekeningen table) switches on `view`.
- Transacties view content:
  - Filter state: `const [fEntity, setFEntity] = useState("")`, `const [fAccount, setFAccount] = useState("")`, `const [fSearch, setFSearch] = useState("")`.
  - Entity options = unique `accounts.map(a => a.entity)`; account options = `accounts` (label `bank + " · " + key`, value `key`).
  - `const rows = useMemo(() => filterTxs(enrichTxs(txs, accounts), { entity: fEntity || undefined, accountKey: fAccount || undefined, search: fSearch || undefined }).slice().sort((a, b) => b.date.localeCompare(a.date)), [txs, accounts, fEntity, fAccount, fSearch])`.
  - Table columns: `Datum · Tegenpartij · Omschrijving · Rekening · Bedrag · Entiteit`. Rekening cell = `${bank} · ${accountKey}`. Bedrag cell = `formatEuro(amount)`, styled green when `amount >= 0` else red (inline `style={{ color: amount >= 0 ? "green" : "crimson" }}`). Show a count line `{rows.length} transacties`. Empty state: a `<p>` "Geen transacties." when `rows.length === 0`.
- Keep Task 3's `accounts` case as a placeholder that renders nothing yet (or a "binnenkort" note) — Task 3 fills it.

- [ ] **Step 1: Write the failing test** (the data pipeline the Transacties view renders)

```ts
// apps/web/src/transactions.test.ts
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { enrichTxs, filterTxs } from "@lavega/core";

const accounts: Account[] = [
  {
    key: "A1",
    iban: "A1",
    name: "ING",
    bank: "ING",
    entity: "BV1",
    currency: "EUR",
    balance: null,
  },
  {
    key: "A2",
    iban: "A2",
    name: "ABN",
    bank: "ABN AMRO",
    entity: "BV2",
    currency: "EUR",
    balance: 100,
  },
];
const txs: Tx[] = [
  {
    id: "t1",
    accountKey: "A1",
    date: "2026-01-02",
    amount: -10,
    currency: "EUR",
    counterparty: "Albert Heijn",
    description: "Eten",
    category: "",
    manual: false,
  },
  {
    id: "t2",
    accountKey: "A2",
    date: "2026-01-05",
    amount: 200,
    currency: "EUR",
    counterparty: "Klant",
    description: "Factuur",
    category: "",
    manual: false,
  },
  {
    id: "t3",
    accountKey: "A1",
    date: "2026-01-03",
    amount: -5,
    currency: "EUR",
    counterparty: "Coffee",
    description: "Koffie",
    category: "",
    manual: false,
  },
];

test("Transacties pipeline: enrich + filter(entity=BV1) + sort desc by date", () => {
  const rows = filterTxs(enrichTxs(txs, accounts), { entity: "BV1" })
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  expect(rows.map((r) => r.id)).toEqual(["t3", "t1"]); // both BV1, newest first
  expect(rows[0]).toMatchObject({ bank: "ING", entity: "BV1" });
});
```

- [ ] **Step 2: Run to verify it passes** (Task 1 already provides the helpers)

Run: `pnpm test`. Expected: PASS. (This test locks the exact pipeline the view uses; the view is a thin render over it.)

- [ ] **Step 3: Implement the nav + Transacties view in `App.tsx`**

Add the `view` state and nav; extract the existing Overzicht table into a `view === "overview"` block; add the `view === "transactions"` block per the Design notes above; leave a `view === "accounts"` placeholder (`<p>Binnenkort.</p>`). Keep the Import section and `formatEuro` unchanged. Preserve the existing `accept=".csv,.sta,.txt,.940,.mt940,.swi"` on the file input.

- [ ] **Step 4: Run tests + typecheck + build**

Run: `pnpm test` → all green; `pnpm typecheck` → clean; `pnpm --filter @lavega/web build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/transactions.test.ts
git commit -m "feat(web): view navigation + Transacties (filterable transaction list)"
```

---

### Task 3: Rekeningen view + entity reassignment

**Files:**

- Modify: `apps/web/src/App.tsx` (fill the `view === "accounts"` block; add the reassignment handler)
- Create: `apps/web/src/reassign.test.ts` (headless reassignment → reconsolidate flow)

**Interfaces:**

- Consumes: `accountSummaries`, `reassignEntity` from `@lavega/core` (Task 1); the existing `storage` (`createIndexedDbStorage`), `accounts`/`setAccounts` state, `consolidate`, `formatEuro`.

**Design notes for the implementer:**

- Reassignment handler in App.tsx:
  ```ts
  async function handleReassign(key: string, newEntity: string) {
    const next = reassignEntity(accounts, key, newEntity);
    setAccounts(next);
    const changed = next.find((a) => a.key === key);
    if (changed) await storage.putAccounts([changed]);
  }
  ```
  (Optimistic local update + persist the single changed account. `putAccounts` upserts by keyPath "key". `consolidate` is a `useMemo` on `accounts`, so Overzicht/Transacties regroup immediately.)
- Rekeningen view content: `const summaries = accountSummaries(accounts, txs)`. Table columns: `Bank · Rekening · Entiteit · Saldo · Transacties`.
  - Rekening cell = `account.name` (falls back to key). Saldo = `account.balance === null ? "onbekend" : formatEuro(account.balance)`. Transacties = `txCount`.
  - **Entiteit cell = an editable `<input>`** bound to `account.entity`, `onChange` → `void handleReassign(account.key, e.target.value)`. Disable while `busy` is true.
  - Empty state: `<p>Nog geen rekeningen — importeer eerst een bestand.</p>` when `accounts.length === 0`.

- [ ] **Step 1: Write the failing test** (reassignment persists and regroups)

```ts
// apps/web/src/reassign.test.ts
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { consolidate, reassignEntity } from "@lavega/core";
import { createIndexedDbStorage } from "@lavega/adapters";

test("Reassign flow: change an account's entity -> persist -> its txs regroup on reconsolidate", async () => {
  const storage = createIndexedDbStorage();
  const accounts: Account[] = [
    {
      key: "A1",
      iban: "A1",
      name: "ING",
      bank: "ING",
      entity: "BV1",
      currency: "EUR",
      balance: null,
    },
  ];
  const txs: Tx[] = [
    {
      id: "t1",
      accountKey: "A1",
      date: "2026-01-02",
      amount: -10,
      currency: "EUR",
      counterparty: "AH",
      description: "Eten",
      category: "",
      manual: false,
    },
    {
      id: "t2",
      accountKey: "A1",
      date: "2026-01-03",
      amount: 50,
      currency: "EUR",
      counterparty: "Klant",
      description: "Factuur",
      category: "",
      manual: false,
    },
  ];
  await storage.putAccounts(accounts);
  await storage.putTxs(txs);

  // Before: all under BV1
  expect(consolidate(accounts, txs).byEntity["BV1"]).toMatchObject({ in: 50, out: -10 });

  // Reassign A1 to BV3 and persist the changed account
  const next = reassignEntity(accounts, "A1", "BV3");
  await storage.putAccounts([next.find((a) => a.key === "A1")!]);

  // Reload accounts (txs unchanged) and reconsolidate
  const reloaded = await storage.getAccounts();
  const persistedTxs = await storage.getTxs();
  const after = consolidate(reloaded, persistedTxs);
  expect(after.byEntity["BV3"]).toMatchObject({ in: 50, out: -10 });
  expect(after.byEntity["BV1"]).toBeUndefined(); // nothing left under the old entity
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm test`. Expected: PASS — proves the reassignment data flow (persist + reconsolidate) the view relies on.

- [ ] **Step 3: Implement the Rekeningen view + handler in `App.tsx`**

Fill the `view === "accounts"` block and add `handleReassign` per the Design notes.

- [ ] **Step 4: Run tests + typecheck + build**

Run: `pnpm test` → all green; `pnpm typecheck` → clean; `pnpm --filter @lavega/web build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/reassign.test.ts
git commit -m "feat(web): Rekeningen view with inline entity reassignment"
```

## Self-Review checklist

- `core` stays I/O-free; the 4 helpers are pure + unit-tested. Overzicht + Import unchanged (`overview.test.ts` green, `.sta` accept preserved). Reassignment persists via `putAccounts` and regroups through the unchanged `consolidate`. No new deps, no router, no `tx.id`/parser changes. `pnpm --filter @lavega/web build` succeeds.

## Notes

- No component-render tests (the repo has no render library and we don't add one) — each view's data pipeline is locked by a headless test; visuals are verified against the running dev server.
- Deferred (not this plan): PDF import (decision: defer — CSV/MT940 cover all banks); date-range filter; pagination/virtualization; per-transaction editing/categor, a "onbekend"-entity cleanup flow.
