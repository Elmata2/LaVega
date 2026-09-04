# LaVega — Polish: date-range filter + monthly chart + rules-based categories — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Three daily-use polish features: (1) a **date-range filter** on Transacties, (2) a **monthly in/out chart** on Overzicht (inline SVG, no chart lib), and (3) **rules-based transaction categories** — a Regels tab to define `match → category` rules, a Categorie column on Transacties, and a by-category breakdown on Overzicht.

**Architecture:** Pure derivations (`filterTxs` from/to, `monthlyTotals`, `categorize`, `categoryTotals`) + a `Rule` type live in `@lavega/core`. Rules persist through a new `getRules`/`putRules` on the `StorageAdapter` (IndexedDB store, schema-versioned). The three UI additions live in `apps/web/src/App.tsx`. No new dependencies; no chart library (hand-drawn SVG).

**Tech stack:** TypeScript, React (Vite), Vitest (+ jsdom + fake-indexeddb for storage/wiring tests — the repo's existing pattern; no component-render library).

## Global Constraints

- **`packages/core` stays I/O-free** — the new helpers are pure. ESM (`.js` import specifiers).
- **Don't break existing behavior** — Import (no `accept` filter), Overzicht, Transacties, Rekeningen views and all existing tests stay green. Do NOT change `consolidate`, `ingest`, `tx.id`, or any parser.
- **Category is derived, not stored on the tx** — `categorize(tx, rules)` computes it at display time; editing a rule re-labels instantly. `Tx.category` is left as-is (reserved for a future manual override, which wins when non-empty). No writes to txs for categorization.
- **Rules persistence = replace-all** — `putRules(rules)` replaces the whole rules set (the UI holds the full list; add/remove = save the new list). IndexedDB schema bump from v1 → v2 adds a `rules` store; existing `accounts`/`txs` data is preserved by the upgrade.
- Dutch UI copy: nav adds `Regels`; date inputs `Van`/`Tot`; columns/labels `Categorie`, `Maand`. ISO dates compare as strings (lexicographic).

---

### Task 1: Core helpers — date-range filter, monthly totals, categorize, category totals + `Rule` type

**Files:**

- Modify: `packages/core/src/model.ts` (add `Rule`)
- Modify: `packages/core/src/views.ts` (extend `TxFilter`/`filterTxs`; add `monthlyTotals`, `categorize`, `categoryTotals`)
- Modify: `packages/core/src/views.test.ts` (add tests)

**Interfaces produced (later tasks depend on these):**

- `type Rule = { id: string; match: string; category: string }` (in model.ts, re-exported via index)
- `TxFilter` gains `from?: string; to?: string`
- `type MonthlyTotal = { month: string; in: number; out: number }`; `monthlyTotals(txs: Tx[]): MonthlyTotal[]`
- `categorize(tx: Tx, rules: Rule[]): string`
- `categoryTotals(txs: Tx[], rules: Rule[]): Record<string, { in: number; out: number }>`

- [ ] **Step 1: Add the `Rule` type to `packages/core/src/model.ts`**

Append:

```ts
export type Rule = { id: string; match: string; category: string };
```

- [ ] **Step 2: Write the failing tests** — append to `packages/core/src/views.test.ts`

```ts
import { monthlyTotals, categorize, categoryTotals } from "./views.js";
import type { Rule } from "./model.js";

const txsForMonths: Tx[] = [
  {
    id: "a",
    accountKey: "A1",
    date: "2026-06-05",
    amount: 100,
    currency: "EUR",
    counterparty: "Klant",
    description: "Factuur",
    category: "",
    manual: false,
  },
  {
    id: "b",
    accountKey: "A1",
    date: "2026-06-20",
    amount: -30,
    currency: "EUR",
    counterparty: "Albert Heijn",
    description: "Boodschappen",
    category: "",
    manual: false,
  },
  {
    id: "c",
    accountKey: "A1",
    date: "2026-07-02",
    amount: -12.5,
    currency: "EUR",
    counterparty: "Coffee",
    description: "Koffie",
    category: "",
    manual: false,
  },
];

test("filterTxs: from/to bound the date range (inclusive), combinable with other filters", () => {
  const e = enrichTxs(txsForMonths, accounts);
  expect(filterTxs(e, { from: "2026-07-01" }).map((t) => t.id)).toEqual(["c"]);
  expect(filterTxs(e, { to: "2026-06-30" }).map((t) => t.id)).toEqual(["a", "b"]);
  expect(filterTxs(e, { from: "2026-06-10", to: "2026-06-30" }).map((t) => t.id)).toEqual(["b"]);
  expect(
    filterTxs(e, { from: "2026-06-01", to: "2026-07-31", search: "koffie" }).map((t) => t.id),
  ).toEqual(["c"]);
});

test("monthlyTotals: groups by YYYY-MM, sums in/out, sorted ascending by month", () => {
  const m = monthlyTotals(txsForMonths);
  expect(m).toEqual([
    { month: "2026-06", in: 100, out: -30 },
    { month: "2026-07", in: 0, out: -12.5 },
  ]);
});

const rules: Rule[] = [
  { id: "r1", match: "albert heijn", category: "Boodschappen" },
  { id: "r2", match: "klant", category: "Inkomen" },
];

test("categorize: first matching rule wins (case-insensitive over counterparty+description); else 'onbekend'; manual tx.category wins", () => {
  expect(categorize(txsForMonths[0], rules)).toBe("Inkomen"); // "Klant"
  expect(categorize(txsForMonths[1], rules)).toBe("Boodschappen"); // "Albert Heijn"
  expect(categorize(txsForMonths[2], rules)).toBe("onbekend"); // no match
  const manual: Tx = { ...txsForMonths[2], category: "Handmatig" };
  expect(categorize(manual, rules)).toBe("Handmatig"); // non-empty tx.category wins
});

test("categoryTotals: sums in/out per derived category", () => {
  const t = categoryTotals(txsForMonths, rules);
  expect(t["Inkomen"]).toEqual({ in: 100, out: 0 });
  expect(t["Boodschappen"]).toEqual({ in: 0, out: -30 });
  expect(t["onbekend"]).toEqual({ in: 0, out: -12.5 });
});
```

(The `accounts` const already exists at the top of views.test.ts from Task-1 of the views work.)

- [ ] **Step 3: Run to verify they fail** — `pnpm test` → FAIL (symbols missing).

- [ ] **Step 4: Implement in `packages/core/src/views.ts`**

Extend `TxFilter` and `filterTxs`:

```ts
export type TxFilter = {
  entity?: string;
  accountKey?: string;
  search?: string;
  from?: string;
  to?: string;
};

export function filterTxs(txs: EnrichedTx[], f: TxFilter): EnrichedTx[] {
  const q = f.search ? norm(f.search) : "";
  return txs.filter((t) => {
    if (f.entity && t.entity !== f.entity) return false;
    if (f.accountKey && t.accountKey !== f.accountKey) return false;
    if (f.from && t.date < f.from) return false; // ISO dates compare lexicographically
    if (f.to && t.date > f.to) return false;
    if (q && !(norm(t.counterparty).includes(q) || norm(t.description).includes(q))) return false;
    return true;
  });
}
```

Append the new helpers (import `Rule` from `./model.js` at the top — the file already imports `Account, Tx`):

```ts
export type MonthlyTotal = { month: string; in: number; out: number };

/** Per-calendar-month inflow/outflow totals, sorted ascending by month
 *  (YYYY-MM). Drives the Overzicht bar chart. */
export function monthlyTotals(txs: Tx[]): MonthlyTotal[] {
  const byMonth = new Map<string, { in: number; out: number }>();
  for (const t of txs) {
    const m = t.date.slice(0, 7);
    const b = byMonth.get(m) ?? { in: 0, out: 0 };
    if (t.amount >= 0) b.in += t.amount;
    else b.out += t.amount;
    byMonth.set(m, b);
  }
  return [...byMonth.entries()]
    .map(([month, b]) => ({ month, in: b.in, out: b.out }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Category for a tx: a non-empty tx.category (manual override) wins; else the
 *  first rule whose match text is a substring of counterparty+description
 *  (case/space-insensitive); else "onbekend". */
export function categorize(tx: Tx, rules: Rule[]): string {
  if (tx.category) return tx.category;
  const hay = norm(tx.counterparty + " " + tx.description);
  for (const r of rules) {
    if (r.match && hay.includes(norm(r.match))) return r.category;
  }
  return "onbekend";
}

/** In/out totals grouped by derived category (via categorize). */
export function categoryTotals(
  txs: Tx[],
  rules: Rule[],
): Record<string, { in: number; out: number }> {
  const out: Record<string, { in: number; out: number }> = {};
  for (const t of txs) {
    const c = categorize(t, rules);
    const b = (out[c] ??= { in: 0, out: 0 });
    if (t.amount >= 0) b.in += t.amount;
    else b.out += t.amount;
  }
  return out;
}
```

- [ ] **Step 5: Run tests + typecheck** — `pnpm test` (new tests pass) + `pnpm typecheck` clean.

- [ ] **Step 6: Commit** — `feat(core): date-range filter, monthlyTotals, categorize, categoryTotals + Rule type`

---

### Task 2: Storage — rules CRUD (schema-versioned)

**Files:**

- Modify: `packages/adapters/src/storage/StorageAdapter.ts` (add `getRules`/`putRules`)
- Modify: `packages/adapters/src/storage/indexeddb.ts` (v2 schema + rules store + impl)
- Create: `packages/adapters/src/storage/rules.test.ts`

**Interfaces:**

- Consumes: `Rule` from `@lavega/core` (Task 1).
- Produces: `StorageAdapter.getRules(): Promise<Rule[]>`, `StorageAdapter.putRules(rules: Rule[]): Promise<void>` (**replace-all**).

- [ ] **Step 1: Extend the interface** — `packages/adapters/src/storage/StorageAdapter.ts`

```ts
import type { Account, Tx, Rule } from "@lavega/core";

export interface StorageAdapter {
  getAccounts(): Promise<Account[]>;
  putAccounts(a: Account[]): Promise<void>;
  getTxs(): Promise<Tx[]>;
  putTxs(t: Tx[]): Promise<void>;
  getRules(): Promise<Rule[]>;
  putRules(rules: Rule[]): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test** — `packages/adapters/src/storage/rules.test.ts`

```ts
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import type { Rule } from "@lavega/core";
import { createIndexedDbStorage } from "./indexeddb.js";

test("rules store: put then get round-trips; putRules replaces the whole set", async () => {
  const storage = createIndexedDbStorage();
  expect(await storage.getRules()).toEqual([]);

  const rules: Rule[] = [
    { id: "r1", match: "albert heijn", category: "Boodschappen" },
    { id: "r2", match: "salaris", category: "Inkomen" },
  ];
  await storage.putRules(rules);
  const back = await storage.getRules();
  expect(back).toHaveLength(2);
  expect(back.find((r) => r.id === "r1")).toMatchObject({
    match: "albert heijn",
    category: "Boodschappen",
  });

  // replace-all: saving a shorter list drops the removed rule
  await storage.putRules([{ id: "r2", match: "salaris", category: "Loon" }]);
  const after = await storage.getRules();
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ id: "r2", category: "Loon" });
});

test("existing accounts/txs stores still work after the v2 upgrade adds the rules store", async () => {
  const storage = createIndexedDbStorage();
  await storage.putAccounts([
    {
      key: "A1",
      iban: "A1",
      name: "ING",
      bank: "ING",
      entity: "BV1",
      currency: "EUR",
      balance: null,
    },
  ]);
  expect(await storage.getAccounts()).toHaveLength(1);
});
```

- [ ] **Step 3: Run to verify it fails** — `pnpm test` → FAIL (`getRules` missing).

- [ ] **Step 4: Implement** — `packages/adapters/src/storage/indexeddb.ts`

Bump the version and add the store + methods:

```ts
import { openDB, type IDBPDatabase } from "idb";
import type { Account, Tx, Rule } from "@lavega/core";
import type { StorageAdapter } from "./StorageAdapter.js";

const DB_NAME = "lavega";
const DB_VERSION = 2;

function openLaVegaDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("accounts")) {
        db.createObjectStore("accounts", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("txs")) {
        db.createObjectStore("txs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("rules")) {
        db.createObjectStore("rules", { keyPath: "id" });
      }
    },
  });
}
```

Add these two methods to the returned object (alongside the existing four):

```ts
    async getRules(): Promise<Rule[]> {
      const db = await openLaVegaDb();
      return db.getAll("rules");
    },
    // Replace-all: the UI owns the full rules list, so a save clears and rewrites.
    async putRules(rules: Rule[]): Promise<void> {
      const db = await openLaVegaDb();
      const tx = db.transaction("rules", "readwrite");
      await tx.store.clear();
      await Promise.all(rules.map((r) => tx.store.put(r)));
      await tx.done;
    },
```

- [ ] **Step 5: Run tests + typecheck** — both green.

- [ ] **Step 6: Commit** — `feat(adapters): IndexedDB rules store (v2 schema) + getRules/putRules`

---

### Task 3: UI — date-range filter (Transacties) + monthly chart (Overzicht)

**Files:**

- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/daterange.test.ts`

**Interfaces:** Consumes `filterTxs` (with from/to), `monthlyTotals`, `MonthlyTotal` from `@lavega/core`.

**Design notes (implementer writes the JSX):**

- Import `monthlyTotals`, and `type MonthlyTotal`, from `@lavega/core`.
- **Date range:** add `const [fFrom, setFFrom] = useState("");` `const [fTo, setFTo] = useState("");`. Add two `<input type="date">` (labels `Van` / `Tot`) in the Transacties filter row. Add `from: fFrom || undefined, to: fTo || undefined` to the existing `filterTxs(enrichTxs(...), {...})` call, and add `fFrom, fTo` to that `rows` useMemo dependency array.
- **Monthly chart in Overzicht:** add `const chart = useMemo(() => monthlyTotals(txs), [txs]);` and render a `<MonthlyChart data={chart} />` above the existing Overzicht table (inside the `view === "overview"` block). Define this module-level component in App.tsx:

```tsx
function MonthlyChart({ data }: { data: MonthlyTotal[] }) {
  if (data.length === 0) return <p>Nog geen data voor een grafiek.</p>;
  const max = Math.max(1, ...data.map((d) => Math.max(d.in, -d.out)));
  const barW = 24,
    gap = 12,
    midY = 60,
    h = 120;
  const w = data.length * (barW + gap) + gap;
  const scale = (v: number) => (v / max) * (h / 2 - 10);
  return (
    <svg width={w} height={h + 20} role="img" aria-label="Maandelijkse in- en uitstroom">
      <line x1={0} y1={midY} x2={w} y2={midY} stroke="#ccc" />
      {data.map((d, i) => {
        const x = gap + i * (barW + gap);
        const inH = scale(d.in);
        const outH = scale(-d.out);
        return (
          <g key={d.month}>
            <rect x={x} y={midY - inH} width={barW} height={inH} fill="green" />
            <rect x={x} y={midY} width={barW} height={outH} fill="crimson" />
            <text x={x + barW / 2} y={h + 14} fontSize={9} textAnchor="middle">
              {d.month.slice(2)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 1: Write the failing test** — `apps/web/src/daterange.test.ts`

```ts
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { enrichTxs, filterTxs, monthlyTotals } from "@lavega/core";

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
    date: "2026-06-05",
    amount: 100,
    currency: "EUR",
    counterparty: "Klant",
    description: "F",
    category: "",
    manual: false,
  },
  {
    id: "t2",
    accountKey: "A1",
    date: "2026-07-05",
    amount: -20,
    currency: "EUR",
    counterparty: "AH",
    description: "B",
    category: "",
    manual: false,
  },
];

test("Transacties date-range pipeline: from/to bound the rows", () => {
  const e = enrichTxs(txs, accounts);
  expect(filterTxs(e, { from: "2026-07-01", to: "2026-07-31" }).map((t) => t.id)).toEqual(["t2"]);
});

test("Overzicht chart data: one bar-pair per month", () => {
  expect(monthlyTotals(txs)).toEqual([
    { month: "2026-06", in: 100, out: 0 },
    { month: "2026-07", in: 0, out: -20 },
  ]);
});
```

- [ ] **Step 2: Run to verify it passes** (Task 1 provides the helpers) — `pnpm test`.

- [ ] **Step 3: Implement the JSX** per the design notes above.

- [ ] **Step 4: Run tests + typecheck + build** — `pnpm test`, `pnpm typecheck`, `pnpm --filter @lavega/web build` all green.

- [ ] **Step 5: Commit** — `feat(web): date-range filter on Transacties + monthly in/out chart on Overzicht`

---

### Task 4: UI — rules-based categories (Regels tab + Categorie column + Overzicht by-category)

**Files:**

- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/categories.test.ts`

**Interfaces:** Consumes `categorize`, `categoryTotals`, `type Rule` from `@lavega/core`; `storage.getRules`/`putRules` (Task 2).

**Design notes (implementer writes the JSX):**

- Extend the `View` union with `"rules"`; add a 4th nav button `Regels`.
- Rules state: `const [rules, setRules] = useState<Rule[]>([]);`. Load in the existing mount `useEffect` (add `storage.getRules()` to the `Promise.all` and `setRules(...)`).
- Save helper:
  ```ts
  async function saveRules(next: Rule[]) {
    setRules(next);
    await storage.putRules(next);
  }
  ```
- **Regels view** (`view === "rules"`): a form with two `<input>`s (match text, category name) + a `Toevoegen` button that appends `{ id: crypto.randomUUID(), match, category }` via `saveRules` (ignore if either field is blank; clear the inputs after). Below, a table of current rules (Match · Categorie · a `Verwijderen` button per row that removes by id via `saveRules(rules.filter(r => r.id !== id))`). Empty state: `<p>Nog geen regels.</p>`.
- **Transacties:** add a `Categorie` column (last column) = `categorize(t, rules)` for each row.
- **Overzicht:** below the existing per-entity table, add a second table "Per categorie" from `categoryTotals(txs, rules)` — columns `Categorie · In · Uit`, one row per category (use `formatEuro`). Wrap in a `useMemo` on `[txs, rules]`.

- [ ] **Step 1: Write the failing test** — `apps/web/src/categories.test.ts`

```ts
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import type { Rule, Tx } from "@lavega/core";
import { categorize, categoryTotals } from "@lavega/core";
import { createIndexedDbStorage } from "@lavega/adapters";

const txs: Tx[] = [
  {
    id: "t1",
    accountKey: "A1",
    date: "2026-06-05",
    amount: 2500,
    currency: "EUR",
    counterparty: "Salaris",
    description: "Loon",
    category: "",
    manual: false,
  },
  {
    id: "t2",
    accountKey: "A1",
    date: "2026-06-06",
    amount: -30,
    currency: "EUR",
    counterparty: "Albert Heijn",
    description: "Boodschappen",
    category: "",
    manual: false,
  },
];

test("Categories wiring: rules persist and drive categorize + categoryTotals", async () => {
  const storage = createIndexedDbStorage();
  const rules: Rule[] = [
    { id: "r1", match: "salaris", category: "Inkomen" },
    { id: "r2", match: "albert heijn", category: "Boodschappen" },
  ];
  await storage.putRules(rules);
  const loaded = await storage.getRules();

  expect(categorize(txs[0], loaded)).toBe("Inkomen");
  expect(categorize(txs[1], loaded)).toBe("Boodschappen");
  const totals = categoryTotals(txs, loaded);
  expect(totals["Inkomen"]).toEqual({ in: 2500, out: 0 });
  expect(totals["Boodschappen"]).toEqual({ in: 0, out: -30 });
});
```

- [ ] **Step 2: Run to verify it passes** — `pnpm test`.

- [ ] **Step 3: Implement the JSX + wiring** per the design notes.

- [ ] **Step 4: Run tests + typecheck + build** — all green.

- [ ] **Step 5: Commit** — `feat(web): rules-based categories (Regels tab, Categorie column, Overzicht by-category)`

## Self-Review checklist

- `core` I/O-free; new helpers pure + unit-tested. `filterTxs` from/to inclusive + combinable. `monthlyTotals` sorted, grouped by YYYY-MM. `categorize` first-match/manual-override/onbekend. Rules persist (v2 schema, replace-all) and existing accounts/txs survive the upgrade. Category is derived, never written to txs. Overzicht/Transacties/Rekeningen + all prior tests still green. No new deps; chart is inline SVG. `pnpm --filter @lavega/web build` succeeds.

## Notes

- Deferred (not this plan): manual per-tx category override UI (the `tx.category`-wins path exists but no UI sets it); CSV export; per-account drill-down page; category color coding; rule reordering.
