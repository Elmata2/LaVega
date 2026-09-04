# LaVega — Foundation + Offline Aggregation MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a bank CSV and see a consolidated, per-entity cash overview — running fully locally — with the deployment-agnostic monorepo scaffold in place.

**Architecture:** pnpm-workspace monorepo. Pure `core/` (model, parsers, ingest) with no I/O. Storage and bank access sit behind adapter interfaces (`StorageAdapter`, `BankAccessAdapter`) so the same code runs local now and hosted later. A Vite+React app renders from storage. This plan builds the thinnest end-to-end slice (one CSV parser); later plans broaden parsers, views, and add live Enable Banking sync.

**Tech Stack:** TypeScript, pnpm workspaces, Vite + React, Vitest, `idb` (IndexedDB wrapper), `fake-indexeddb` (tests). License AGPL-3.0.

## Global Constraints

- **No FinnTell reuse.** Clean-room only. The Kasoverzicht app (in `~/Downloads/FinnTell_archief_en_Kasoverzicht.zip`) is clean-room and may be referenced/ported.
- **Privacy / local-first.** No cloud, account, or telemetry. Secrets never in the repo — `.gitignore` must exclude `config.json`, `state.json`, `*.pem`, `.env*` before the first commit.
- **Read-only.** No payment initiation (PIS).
- **`core/` stays I/O-free.** No `idb`, `fetch`, `fs`, or DOM in `packages/core` (except a `DOMParser` seam later for CAMT — not in this plan).
- **Datamodel is fixed** (preserve for cross-import compatibility with existing Kasoverzicht back-ups):
  ```ts
  account = { key, iban, name, bank, entity, currency, balance };
  tx = {
    id,
    accountKey,
    date /* YYYY-MM-DD */,
    amount /* negative = outflow */,
    currency,
    counterparty,
    description,
    category,
    manual,
  };
  ```
  `base = [accountKey, date, amount.toFixed(2), norm(counterparty).slice(0,40), norm(description).slice(0,60)].join('|')`; `n` = **1-based** occurrence count of `base` within one import batch; `tx.id = hash(base + '#' + n)` — a single **djb2** token (the counter is hashed _in_, not appended). Port `hash` (Kasoverzicht.html line 308) and `norm` (line 309) **verbatim** — a byte-exact match is required or existing back-ups won't dedupe on import.
- **Conventions:** amounts negative for outflow; dates `YYYY-MM-DD`; Dutch UI copy, English identifiers.

---

### Task 1: Monorepo scaffold

**Files:**

- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`, `LICENSE`, `README.md`, `vitest.config.ts`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/smoke.test.ts`

**Interfaces:**

- Produces: workspace packages `@lavega/core`, resolvable via `workspace:*`.

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "lavega",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "pnpm --filter @lavega/web dev"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4: Create `.gitignore` (secrets first — hard constraint)**

```
node_modules/
dist/
config.json
state.json
*.pem
.env
.env.*
.DS_Store
```

- [ ] **Step 5: Create `LICENSE` (AGPL-3.0) and `README.md`**
      Fetch the full AGPL-3.0 text into `LICENSE` (`curl -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE`). `README.md`: one paragraph — "LaVega — local-first personal finance agent. See `docs/CONTEXT.md`." plus `pnpm install` / `pnpm test` / `pnpm dev`.

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["packages/**/*.test.ts", "apps/**/*.test.ts"] },
});
```

- [ ] **Step 7: Create `packages/core/package.json`**

```json
{
  "name": "@lavega/core",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

- [ ] **Step 8: Create `packages/core/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 9: Create `packages/core/src/index.ts` and a smoke test**

```ts
// packages/core/src/index.ts
export const VERSION = "0.0.0";
```

```ts
// packages/core/src/smoke.test.ts
import { expect, test } from "vitest";
import { VERSION } from "./index.js";
test("core loads", () => {
  expect(VERSION).toBe("0.0.0");
});
```

- [ ] **Step 10: Install and verify**
      Run: `pnpm install && pnpm test`
      Expected: 1 test file, 1 passing test.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "chore: monorepo scaffold + core package"
```

---

### Task 2: Core model + tx.id (byte-exact djb2 port from Kasoverzicht)

**Files:**

- Create: `packages/core/src/model.ts`, `packages/core/src/hash.ts`, `packages/core/src/hash.test.ts`
- Modify: `packages/core/src/index.ts` (re-export)
- Reference (port VERBATIM): `Kasoverzicht.html` lines 308-309 (`hash`, `norm`) and 669-671 (base / counter / id).

**Interfaces:**

- Produces: `type Account`, `type Tx`; `hash(s: string): string`; `norm(s: unknown): string`; `assignTxIds(rows: Omit<Tx,"id">[]): Tx[]` — replicates Kasoverzicht's exact base/counter/id so existing back-ups dedupe on import.

- [ ] **Step 1: Write the failing test (pin a golden djb2 value for compat)**

```ts
// packages/core/src/hash.test.ts
import { expect, test } from "vitest";
import { hash, assignTxIds } from "./hash.js";
test("hash is djb2, byte-exact with Kasoverzicht", () => {
  // GOLDEN: run the reference hash() from Kasoverzicht.html line 308 in Node once, paste the output:
  expect(hash("abc")).toBe("<PASTE djb2('abc') FROM THE REFERENCE>");
});
const base = {
  accountKey: "NL01",
  date: "2026-01-02",
  amount: -10,
  currency: "EUR",
  counterparty: "Shop",
  description: "x",
  category: "",
  manual: false,
};
test("id is a single djb2 token — the counter is hashed IN, not appended", () => {
  const [a] = assignTxIds([{ ...base }]);
  expect(a.id).not.toContain("#");
});
test("identical same-day rows get distinct ids; the same row in a fresh import is stable", () => {
  const [a, b] = assignTxIds([{ ...base }, { ...base }]);
  expect(a.id).not.toBe(b.id); // n=1 then n=2, hashed in
  const [c] = assignTxIds([{ ...base }]); // fresh batch → counter resets → n=1
  expect(c.id).toBe(a.id); // stable across imports
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm test hash`
      Expected: FAIL — `hash` / `assignTxIds` not defined.

- [ ] **Step 3: Write `model.ts`**

```ts
// packages/core/src/model.ts
export type Account = {
  key: string;
  iban: string;
  name: string;
  bank: string;
  entity: string;
  currency: string;
  balance: number | null;
};
export type Tx = {
  id: string;
  accountKey: string;
  date: string;
  amount: number;
  currency: string;
  counterparty: string;
  description: string;
  category: string;
  manual: boolean;
};
```

- [ ] **Step 4: Write `hash.ts` — port djb2 + norm + the exact base/counter/id (no crypto)**

```ts
// packages/core/src/hash.ts — pure, no I/O. Ported byte-exact from Kasoverzicht.html (308-309, 669-671).
import type { Tx } from "./model.js";
export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export const norm = (s: unknown): string =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export function assignTxIds(rows: Omit<Tx, "id">[]): Tx[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = [
      r.accountKey,
      r.date,
      r.amount.toFixed(2),
      norm(r.counterparty).slice(0, 40),
      norm(r.description).slice(0, 60),
    ].join("|");
    const n = (seen.get(base) ?? 0) + 1; // 1-based, matches Kasoverzicht
    seen.set(base, n);
    return { ...r, id: hash(base + "#" + n) };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**
      Run: `pnpm test hash`
      Expected: PASS (paste the golden djb2 value into Step 1 first).

- [ ] **Step 6: Re-export from index and commit**

```ts
// add to packages/core/src/index.ts
export * from "./model.js";
export * from "./hash.js";
```

```bash
git add -A && git commit -m "feat(core): model + byte-exact djb2 tx.id (Kasoverzicht-compatible)"
```

---

### Task 3: CSV parser (ING profile)

**Files:**

- Create: `packages/core/src/parsers/csv.ts`, `packages/core/src/parsers/csv.test.ts`
- Reference (port from): the `/* PARSERS START */ … /* PARSERS END */` block in `kasoverzicht/Kasoverzicht.html` (extracted copy in scratchpad) — port the **ING CSV profile** behavior into TS.

**Interfaces:**

- Produces: `parseIngCsv(text: string, accountKey: string): Omit<Tx,"id">[]`.

- [ ] **Step 1: Write the failing test with a synthetic ING fixture**

```ts
// packages/core/src/parsers/csv.test.ts
import { expect, test } from "vitest";
import { parseIngCsv } from "./csv.js";
const ING = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"Boodschappen"
"20260103";"Salaris";"NL01INGB0001";"NL99";"OV";"Bij";"2500,00";"Overschrijving";"Loon"`;
test("ING CSV: dates ISO, outflow negative, inflow positive", () => {
  const rows = parseIngCsv(ING, "NL01INGB0001");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    date: "2026-01-02",
    amount: -12.34,
    counterparty: "Albert Heijn",
  });
  expect(rows[1].amount).toBe(2500);
});
```

- [ ] **Step 2: Run test to verify it fails**
      Run: `pnpm test csv`
      Expected: FAIL — `parseIngCsv` not defined.

- [ ] **Step 3: Implement `parseIngCsv`** porting the ING profile: split on `;`, strip quotes, parse `YYYYMMDD`→ISO, comma-decimal → number, sign from the "Af"/"Bij" column (Af = negative). Map `Naam / Omschrijving`→counterparty, `Mededelingen`→description. Return `Omit<Tx,"id">[]` with `currency:"EUR", category:"", manual:false`. (Full field mapping mirrors the ING branch of the Kasoverzicht PARSERS block.)

- [ ] **Step 4: Run test to verify it passes**
      Run: `pnpm test csv`
      Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): ING CSV parser"
```

---

### Task 4: Ingest — normalize, dedup, consolidate

**Files:**

- Create: `packages/core/src/ingest.ts`, `packages/core/src/ingest.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `assignTxIds`, `Tx`, `Account`.
- Produces: `ingest(existing: Tx[], incoming: Omit<Tx,"id">[]): Tx[]` (dedupes by id against `existing`); `consolidate(accounts: Account[], txs: Tx[]): { byEntity: Record<string,{in:number;out:number;balance:number|null}>; totalBalance: number|null }`.

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/src/ingest.test.ts
import { expect, test } from "vitest";
import { ingest, consolidate } from "./ingest.js";
import { assignTxIds } from "./hash.js";
const mk = (o: Partial<any>) => ({
  accountKey: "A",
  date: "2026-01-02",
  amount: -10,
  currency: "EUR",
  counterparty: "S",
  description: "d",
  category: "",
  manual: false,
  ...o,
});
test("ingest dedupes overlapping imports by id", () => {
  const first = assignTxIds([mk({}), mk({ amount: -20 })]);
  const merged = ingest(first, [mk({}), mk({ amount: -30 })]); // one overlap, one new
  expect(merged).toHaveLength(3);
});
test("consolidate sums in/out per entity", () => {
  const txs = assignTxIds([mk({ amount: -10 }), mk({ amount: 40 })]);
  const accounts = [
    { key: "A", iban: "A", name: "", bank: "", entity: "BV1", currency: "EUR", balance: 100 },
  ];
  const c = consolidate(accounts, txs);
  expect(c.byEntity["BV1"]).toMatchObject({ in: 40, out: -10, balance: 100 });
});
```

- [ ] **Step 2: Run to verify fail** — `pnpm test ingest` → FAIL.

- [ ] **Step 3: Implement `ingest.ts`**

```ts
import type { Account, Tx } from "./model.js";
import { assignTxIds } from "./hash.js";
export function ingest(existing: Tx[], incoming: Omit<Tx, "id">[]): Tx[] {
  const seen = new Set(existing.map((t) => t.id));
  const withIds = assignTxIds(incoming);
  return [...existing, ...withIds.filter((t) => !seen.has(t.id))];
}
export function consolidate(accounts: Account[], txs: Tx[]) {
  const entityOf = new Map(accounts.map((a) => [a.key, a.entity]));
  const byEntity: Record<string, { in: number; out: number; balance: number | null }> = {};
  for (const a of accounts) {
    byEntity[a.entity] ??= { in: 0, out: 0, balance: 0 };
    const b = byEntity[a.entity];
    b.balance =
      b.balance === null || a.balance === null ? (a.balance ?? b.balance) : b.balance + a.balance;
  }
  for (const t of txs) {
    const e = entityOf.get(t.accountKey) ?? "onbekend";
    byEntity[e] ??= { in: 0, out: 0, balance: null };
    if (t.amount >= 0) byEntity[e].in += t.amount;
    else byEntity[e].out += t.amount;
  }
  const totals = Object.values(byEntity).map((b) => b.balance);
  const totalBalance = totals.some((x) => x === null)
    ? null
    : totals.reduce((s, x) => s + (x as number), 0);
  return { byEntity, totalBalance };
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm test ingest` → PASS.

- [ ] **Step 5: Re-export + commit**

```bash
git add -A && git commit -m "feat(core): ingest dedup + per-entity consolidation"
```

---

### Task 5: Storage adapter (IndexedDB)

**Files:**

- Create: `packages/adapters/package.json`, `packages/adapters/tsconfig.json`, `packages/adapters/src/storage/StorageAdapter.ts`, `packages/adapters/src/storage/indexeddb.ts`, `packages/adapters/src/storage/indexeddb.test.ts`

**Interfaces:**

- Consumes: `@lavega/core` (`Tx`, `Account`).
- Produces: `interface StorageAdapter { getAccounts(): Promise<Account[]>; putAccounts(a: Account[]): Promise<void>; getTxs(): Promise<Tx[]>; putTxs(t: Tx[]): Promise<void> }`; `createIndexedDbStorage(): StorageAdapter`.

- [ ] **Step 1: Add deps** — in `packages/adapters/package.json`: `"@lavega/core":"workspace:*"`, `"idb":"^8.0.0"`; devDep `"fake-indexeddb":"^6.0.0"`. Run `pnpm install`.

- [ ] **Step 2: Write the interface** `StorageAdapter.ts` (exact signatures above).

- [ ] **Step 3: Write the failing test**

```ts
// packages/adapters/src/storage/indexeddb.test.ts
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { createIndexedDbStorage } from "./indexeddb.js";
test("round-trips txs", async () => {
  const s = createIndexedDbStorage();
  await s.putTxs([
    {
      id: "1#0",
      accountKey: "A",
      date: "2026-01-02",
      amount: -5,
      currency: "EUR",
      counterparty: "x",
      description: "",
      category: "",
      manual: false,
    },
  ]);
  expect(await s.getTxs()).toHaveLength(1);
});
```

Set this test file's environment to jsdom via a top `// @vitest-environment jsdom` comment (IndexedDB needs a DOM global; `fake-indexeddb/auto` provides the DB itself).

- [ ] **Step 4: Run to verify fail** — `pnpm test indexeddb` → FAIL.

- [ ] **Step 5: Implement `indexeddb.ts`** using `idb`'s `openDB` with object stores `accounts` (keyPath `key`) and `txs` (keyPath `id`); implement the four methods with `getAll` / `put` in a transaction.

- [ ] **Step 6: Run to verify pass** — `pnpm test indexeddb` → PASS.

- [ ] **Step 7: Commit** — `git commit -m "feat(adapters): IndexedDB StorageAdapter"`.

---

### Task 6: Banking adapter (FileImport)

**Files:**

- Create: `packages/adapters/src/banking/BankAccessAdapter.ts`, `packages/adapters/src/banking/fileImport.ts`, `packages/adapters/src/banking/fileImport.test.ts`

**Interfaces:**

- Consumes: `parseIngCsv`, `Tx`, `Account`.
- Produces: `type BankResult = { accounts: Account[]; txs: Omit<Tx,"id">[]; source: string; problems: string[] }`; `interface BankAccessAdapter { load(input): Promise<BankResult> }`; `createFileImport(): BankAccessAdapter` where `load({ filename, text, entity })` detects ING by header and returns a `BankResult` (one account derived from the data + parsed txs).

- [ ] **Step 1: Write failing test** — feed the ING fixture text; assert `result.txs.length === 2`, `result.accounts[0].entity === "BV1"`, `result.problems === []`.
- [ ] **Step 2: Run to verify fail** — `pnpm test fileImport` → FAIL.
- [ ] **Step 3: Implement** — header sniff → `parseIngCsv`; build the account (`key`/`iban` from the `Rekening` column, `bank:"ING"`, `entity` from input, `balance:null` — CSV has no balance); unknown header → `problems:["onbekend CSV-formaat"]`, empty txs.
- [ ] **Step 4: Run to verify pass** — `pnpm test fileImport` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(adapters): FileImport banking adapter (ING CSV)"`.

---

### Task 7: Web app — Import + Overview

**Files:**

- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/tsconfig.json`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/overview.test.ts`

**Interfaces:**

- Consumes: `@lavega/core` (`consolidate`, `ingest`), `@lavega/adapters` (`createIndexedDbStorage`, `createFileImport`).

- [ ] **Step 1: Scaffold Vite React TS** — `apps/web/package.json` with `react`, `react-dom`, dev `@vitejs/plugin-react`, `vite`, `jsdom`; deps `@lavega/core":"workspace:*"`, `@lavega/adapters":"workspace:*"`. Run `pnpm install`.
- [ ] **Step 2: Write a logic test (headless)** `overview.test.ts` (`// @vitest-environment jsdom`, import `fake-indexeddb/auto`): simulate importing the ING fixture via `createFileImport` → `ingest` → `createIndexedDbStorage().putTxs` → `consolidate`; assert `byEntity["BV1"].out === -12.34` and `.in === 2500`.
- [ ] **Step 3: Run to verify fail** — `pnpm test overview` → FAIL.
- [ ] **Step 4: Implement `App.tsx`** — an **Import** control (file input, entity text field) that reads the file text, runs `createFileImport().load(...)`, `ingest`s against stored txs, persists via the storage adapter, and re-renders; an **Overzicht** view showing total balance, per-entity in/out, from `consolidate`. Wire `main.tsx` to mount `<App/>`. Keep the same wiring path (`ingest` is the single entry) that the test exercises so the test covers the core flow.
- [ ] **Step 5: Run to verify pass** — `pnpm test overview` → PASS.
- [ ] **Step 6: Manual verify** — `pnpm dev`, open the app, drop a real ING CSV, confirm the overview populates. (Reduced/`prefers-reduced-motion` not relevant yet.)
- [ ] **Step 7: Commit** — `git commit -m "feat(web): import + consolidated overview (MVP)"`.

---

## Known toolchain risks (resolve during execution)

- **Vite consuming raw-TS workspace packages.** `@lavega/core` / `@lavega/adapters` expose `src/*.ts` via `main`/`exports`. Vitest transforms these fine, but the Vite **dev server/build** for `apps/web` may not transpile pnpm-symlinked deps in `node_modules`. If `pnpm dev` fails to load workspace TS (Task 7 Step 6), add `resolve.alias` mapping the two packages to their `src/` in `apps/web/vite.config.ts` (or `ssr.noExternal: [/@lavega/]`).
- **Import extensions.** With `moduleResolution: bundler`, prefer **extensionless** imports (`./model`) if Vite/Vitest complains about the `.js` specifiers; keep it consistent across packages.
- **Mixed test environments.** Core tests run in `node`; adapter/web tests need jsdom + `fake-indexeddb/auto` via a per-file `// @vitest-environment jsdom` pragma at the top of the file — confirm Vitest honors it.

## Self-Review

- **Spec coverage:** scaffold (T1), model+hash incl. preserved tx.id (T2), CSV parse (T3), ingest/dedup/consolidate (T4), IndexedDB storage adapter (T5), FileImport banking adapter (T6), React Overview + import (T7). Out-of-scope items (MT940/CAMT, other banks, Transactions/Accounts/Signals/Rules views, Enable Banking, Hono server) are deferred to Plans 2–3 per the scope split — intentional, not gaps.
- **Placeholder scan:** parser field-mapping and IndexedDB/`idb` bodies reference the exact source/library rather than re-printing verbatim; every test has concrete fixtures and assertions. Acceptable — the ported logic exists in the clean-room Kasoverzicht source.
- **Type consistency:** `Tx`/`Account` (T2) are consumed unchanged in T3–T7; `assignTxIds`/`ingest`/`consolidate` signatures match across tasks; `StorageAdapter`/`BankAccessAdapter`/`BankResult` names are stable T5→T7.
- **Constraint check:** `core/` imports no I/O (djb2 hash is pure — no node:crypto/DOM); `tx.id` is ported byte-exact from Kasoverzicht (djb2 + `norm` + `amount.toFixed(2)` + 40/60 slices + 1-based counter, guarded by a golden-value test) so back-up import compatibility holds; `.gitignore` secrets rule is Task 1 Step 4, before any commit.
- **Hash bug caught in re-check:** the first draft used SHA-256 + `hash#n` + 0-based counter — corrected to the real djb2/base/counter after reading the source. Amount enters the hash as `.toFixed(2)`, counterparty/description are `norm`'d and sliced (40/60); replicate exactly.
