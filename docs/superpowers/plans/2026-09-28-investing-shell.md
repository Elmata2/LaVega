# LaVega Investing App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the investing SPA into a full-window app shell with top-bar tabs driven by a server-stored per-tenant layout preference, a profile page that hosts broker setup and module/widget pickers, and an Overview that is a grid of independently hideable widgets instead of a fixed stack.

**Architecture:** A new `InvestingLayout` type (`{ modules, widgets }`, both `Partial<Record<Id, boolean>>`) is declared once in `@lavega/core`, persisted per tenant in the existing `investing.preferences` table (new `layout` JSONB column) behind a `GET`/`PUT /api/investing/layout` pair that mirrors the existing benchmarks route. `apps/investing-web` gets its own registry file (module/widget metadata, mirroring `apps/web/src/components/moduleRegistry.tsx` but adapted to react-router and to a server-backed preference instead of `localStorage`), a `useInvestingLayout()` resource hook, a `Profile` page, and a widget-grid `Overview`. The shell (`Layout` in `app.tsx`) drops its `max-w-6xl` cap, renders tabs from the enabled modules, and gates module routes so a disabled module's URL redirects home instead of rendering.

**Tech Stack:** React 18 + react-router-dom v7 (`apps/investing-web`), Hono (`apps/investing-server`), `@lavega/core`/`@lavega/adapters`/`@lavega/database`, Postgres/Neon via `pg`, Vitest, oxlint (shadcn plugin) with a repo-wide `--max-warnings 101` cap.

**Spec:** `docs/superpowers/specs/2026-09-28-investing-shell-design.md`

## Global Constraints

- Copy Personal's pattern into `apps/investing-web`; do not touch `apps/web` and do not extract a shared package (spec Decisions table, Out of scope).
- Layout preferences persist server-side per tenant in the existing `investing.preferences` store; Personal keeps its own browser storage — never share a key or a table between the two apps.
- Store only explicit choices: an absent key in `InvestingLayout.modules`/`.widgets` means "use the registry default", never "off". A default changed later must reach every user who never chose (spec §4).
- `GET /api/investing/layout` never errors on missing data — a tenant with no row reads back `{ modules: {}, widgets: {} }`. `PUT /api/investing/layout` drops unknown ids and non-boolean values rather than rejecting the request (spec §4, "Unknown ids in stored data are dropped on read, never an error").
- Overview is the always-on home module; its toggle is disabled and no stored value can turn it off (spec §1).
- Widget ordering is fixed, no drag-and-drop (spec Decisions table).
- No widget id is ever a module id (spec §3, "with a test" — mirrors Personal's own rule).
- `apps/investing-web`'s oxlint budget is `--max-warnings 101` and the branch starts at 95 warnings (measured before this plan). New code must add **zero** new warnings: reuse declared-safe classes (`rounded-card`, `rounded-pill`, `border-border`, `bg-card`, `bg-secondary`, `text-muted-foreground`, Tailwind's default `shadow-sm`/`tracking-wide` scale) and never introduce a new arbitrary-value class (`rounded-[Npx]`, `tracking-[.Nem]`) or another `shadow-soft`/`shadow-float` usage — both already trip `shadcn(no-raw-colors)` on every occurrence.
- English UI copy, English code and docs (spec header; investing-web is English-only, unlike Personal's Dutch UI).
- `/api/investing/*` needs no new wiring in `apps/server/src/investing-mount.ts` — `investingOwnsApiPath` derives its namespace set from the investing app's own route table, and every route this plan adds lives under `/api/investing/`.

## Review Focus

- A stored layout containing unknown or removed ids (an old module/widget the registry dropped) must not error and must not resurrect a phantom tab or card — covered in Task 1 (`resolveModules`/`resolveWidgets` registry tests) and Task 2 (`layoutResource` boundary test).
- A user who switched off every module except Overview must still see a working shell: only the Overview tab, no crash, `/positions` (or any disabled module's URL) redirects home — covered in Task 3.
- A deep link to a disabled module (typed URL or an old bookmark, not just an in-app nav click) must redirect rather than render partial or broken content — covered in Task 3.
- `GET /api/investing/layout` failing (network error or 5xx) must not blank the shell: the top bar and Overview must render with registry defaults, exactly as if the tenant had never chosen — covered in Task 2 (`layoutResource` fetch-failure test) and Task 3 (shell renders with defaults while/if layout never resolves).
- Unauthenticated mounted mode (session expires or never existed, so `/api/investing/layout` answers 401) must be treated identically to a network failure by `layoutResource` — defaults, not an error screen — and must not be confused with standalone single-tenant mode, which has no session at all and always answers 200 — covered in Task 1 (server test: PUT/GET both use `resolveTenantId()`, so a 401 never even reaches this route under `RequireAuth`) and Task 2 (`layoutResource` test using the same `withAuthUnconfigured` pattern as `app.test.tsx`).

## File Structure

```
packages/core/src/investing/
  layout.ts                    # InvestingModuleId/WidgetId, InvestingLayout, InvestingLayoutStore, validateInvestingLayout
  layout.test.ts
  index.ts                     # + export * from "./layout.js"

packages/adapters/src/layout/
  inMemoryInvestingLayoutStore.ts
  inMemoryInvestingLayoutStore.test.ts
packages/adapters/src/index.ts # + export

apps/investing-server/src/
  fileInvestingLayoutStore.ts
  fileInvestingLayoutStore.test.ts
  app.ts                       # + GET/PUT /api/investing/layout, + investingLayoutStore dependency
  app.test.ts                  # + route tests
  neonStores.ts                # + createNeonInvestingLayoutStore
  neonStores.test.ts           # + test
  index.ts                     # + investingLayoutStore wiring (RuntimeAppOptions, both createApp call sites)
  docker.ts                    # + createFileInvestingLayoutStore wiring

db/migrations/
  0016_investing_layout.sql    # ALTER TABLE investing.preferences ADD COLUMN layout

packages/database/src/
  index.ts                     # PreferencesRepository + getLayout/setLayout
  index.test.ts                # + repository test

apps/server/src/
  investing-mount.ts           # + investingLayoutStore dependency (file or Neon, mirrors benchmarkSelectionStore)

apps/investing-web/src/
  lib/investingRegistry.ts     # MODULES/WIDGETS metadata + resolveModules/resolveWidgets/toggle helpers
  lib/investingRegistry.test.ts
  lib/layoutResource.ts        # fetchLayout/putLayout + useInvestingLayout()
  lib/layoutResource.test.tsx
  components/LayoutPicker.tsx  # module + widget picker rows (Personal's ModulePicker, adapted)
  components/LayoutPicker.test.tsx
  components/BrokerSettings.tsx    # extracted from app.tsx's BrokerConnect + friends
  components/Profile.tsx           # Brokers / Modules / Widgets / Account sections
  components/Profile.test.tsx
  components/SectorAllocationCard.tsx  # extracted "Sector allocation" from PortfolioSummaryCard
  components/SectorAllocationCard.test.tsx
  components/PortfolioSummaryCard.tsx  # sectors section removed, data-dashboard-section renamed "risk"
  components/PortfolioSummaryCard.test.tsx  # sector assertions removed
  app.tsx                      # Layout, routes, Overview widget grid, ModuleRoute guard, AgentsList, NetWorth
  app.test.tsx                 # route/order/broker-connect tests updated for the new shell

docs/investing/DASHBOARD.md                                  # scope/layout sections updated
.claude/skills/verify-investing/features/README.md            # route table updated
.claude/skills/verify-investing/features/dashboard-overview.md # sub-features updated
.claude/skills/verify-investing/features/broker-connect-sync.md # reach text updated
```

---

### Task 1: Layout data model, registry validation, and server storage

**Files:**
- Create: `packages/core/src/investing/layout.ts`
- Create: `packages/core/src/investing/layout.test.ts`
- Modify: `packages/core/src/investing/index.ts`
- Create: `packages/adapters/src/layout/inMemoryInvestingLayoutStore.ts`
- Create: `packages/adapters/src/layout/inMemoryInvestingLayoutStore.test.ts`
- Modify: `packages/adapters/src/index.ts`
- Create: `apps/investing-server/src/fileInvestingLayoutStore.ts`
- Create: `apps/investing-server/src/fileInvestingLayoutStore.test.ts`
- Create: `db/migrations/0016_investing_layout.sql`
- Modify: `packages/database/src/index.ts:497-532`
- Modify: `packages/database/src/index.test.ts` (near the existing preferences tests, ~line 170-193)
- Modify: `apps/investing-server/src/neonStores.ts`
- Modify: `apps/investing-server/src/neonStores.test.ts`
- Modify: `apps/investing-server/src/app.ts:138-160,335-360`
- Modify: `apps/investing-server/src/app.test.ts` (near the existing benchmark route tests, ~line 121-144)
- Modify: `apps/investing-server/src/index.ts:182-213,868-904`
- Modify: `apps/investing-server/src/docker.ts:1-15,68-73`
- Modify: `apps/server/src/investing-mount.ts:9-27,101-132`

**Interfaces:**
- Produces (from `@lavega/core`): `InvestingModuleId = "positions" | "net-worth" | "agents"`, `InvestingWidgetId = "performance" | "allocation" | "kpis" | "risk" | "sectors" | "agent"`, `INVESTING_MODULE_IDS: readonly InvestingModuleId[]`, `INVESTING_WIDGET_IDS: readonly InvestingWidgetId[]`, `type InvestingLayout = { modules: Partial<Record<InvestingModuleId, boolean>>; widgets: Partial<Record<InvestingWidgetId, boolean>> }`, `type InvestingLayoutSelection = { tenantId: string } & InvestingLayout`, `interface InvestingLayoutStore { get(tenantId: string): Promise<InvestingLayout>; set(selection: InvestingLayoutSelection): Promise<void> }`, `function validateInvestingLayout(input: unknown): InvestingLayout`.
- Produces (from `@lavega/adapters`): `createInMemoryInvestingLayoutStore(initial?: InvestingLayoutSelection[]): InvestingLayoutStore`.
- Produces (from `apps/investing-server`): `createFileInvestingLayoutStore(filePath: string): InvestingLayoutStore`, `runtimeInvestingLayoutFile(): string`, `createNeonInvestingLayoutStore(db: Database): InvestingLayoutStore` (in `neonStores.ts`).
- Produces (routes on the investing Hono app): `GET /api/investing/layout` → `200 InvestingLayout`; `PUT /api/investing/layout` → `200` with the sanitized `InvestingLayout` it stored.
- Consumes: `Database`, `withTenantStatement`, `requireUserId` from `@lavega/database` (already used by `createPreferencesRepository`); `resolveTenantId`, `PriceDependencies` from `apps/investing-server/src/app.ts`.
- Task 2 consumes `InvestingModuleId`/`InvestingWidgetId`/`InvestingLayout` from `@lavega/core` and the `/api/investing/layout` route from this task.

- [ ] **Step 1: Write the failing core layout tests**

```ts
// packages/core/src/investing/layout.test.ts
import { describe, expect, test } from "vitest";
import {
  INVESTING_MODULE_IDS,
  INVESTING_WIDGET_IDS,
  validateInvestingLayout,
} from "./layout.js";

describe("investing layout validation", () => {
  test("no widget id is also a module id", () => {
    const modules = new Set<string>(INVESTING_MODULE_IDS);
    for (const widgetId of INVESTING_WIDGET_IDS) expect(modules.has(widgetId)).toBe(false);
  });

  test("drops unknown ids and non-boolean values, keeps known booleans", () => {
    expect(
      validateInvestingLayout({
        modules: { positions: false, "unknown-module": true, "net-worth": "yes" },
        widgets: { performance: true, bogus: true },
      }),
    ).toEqual({ modules: { positions: false }, widgets: { performance: true } });
  });

  test("a malformed body normalizes to an empty layout instead of throwing", () => {
    expect(validateInvestingLayout(null)).toEqual({ modules: {}, widgets: {} });
    expect(validateInvestingLayout("not an object")).toEqual({ modules: {}, widgets: {} });
    expect(validateInvestingLayout({ modules: "nope", widgets: 3 })).toEqual({
      modules: {},
      widgets: {},
    });
  });

  test("a missing modules or widgets key normalizes to an empty map for that key", () => {
    expect(validateInvestingLayout({ widgets: { agent: false } })).toEqual({
      modules: {},
      widgets: { agent: false },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lavega/core test -- src/investing/layout.test.ts`
Expected: FAIL — `Cannot find module './layout.js'` (file does not exist yet).

- [ ] **Step 3: Write the layout model and validator**

```ts
// packages/core/src/investing/layout.ts

/** The tabs a switched-off module hides. "overview" is the home module: it is
 *  always on and is not part of this union (Extract-style pattern would need a
 *  route union this package does not own; the id list below is the single
 *  source instead, exactly like INVESTING_WIDGET_IDS next to it). */
export type InvestingModuleId = "positions" | "net-worth" | "agents";
export const INVESTING_MODULE_IDS: readonly InvestingModuleId[] = [
  "positions",
  "net-worth",
  "agents",
];

/** The Overview cards a reader can switch on and off. Deliberately its own
 *  union — mixing this with InvestingModuleId would let a stored id answer
 *  both "which tab" and "which card" questions, which is exactly the bug the
 *  no-widget-id-is-a-module-id rule (layout.test.ts) exists to catch. */
export type InvestingWidgetId =
  | "performance"
  | "allocation"
  | "kpis"
  | "risk"
  | "sectors"
  | "agent";
export const INVESTING_WIDGET_IDS: readonly InvestingWidgetId[] = [
  "performance",
  "allocation",
  "kpis",
  "risk",
  "sectors",
  "agent",
];

/** Only the choices a reader explicitly made. An absent key means "use the
 *  registry default" — never "off" — so a default changed later still reaches
 *  everyone who never touched that switch. */
export type InvestingLayout = {
  modules: Partial<Record<InvestingModuleId, boolean>>;
  widgets: Partial<Record<InvestingWidgetId, boolean>>;
};

export type InvestingLayoutSelection = { tenantId: string } & InvestingLayout;

export interface InvestingLayoutStore {
  get(tenantId: string): Promise<InvestingLayout>;
  set(selection: InvestingLayoutSelection): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickBooleans<Id extends string>(
  value: unknown,
  knownIds: readonly Id[],
): Partial<Record<Id, boolean>> {
  if (!isRecord(value)) return {};
  const result: Partial<Record<Id, boolean>> = {};
  for (const id of knownIds) {
    const entry = value[id];
    if (typeof entry === "boolean") result[id] = entry;
  }
  return result;
}

/** Normalizes any JSON value into a well-formed InvestingLayout: unknown ids
 *  and non-boolean values are dropped, never rejected. GET reads stored data
 *  this way; PUT sanitizes the incoming body the same way before persisting,
 *  so the two never disagree about what "valid" means. */
export function validateInvestingLayout(input: unknown): InvestingLayout {
  const record = isRecord(input) ? input : {};
  return {
    modules: pickBooleans(record.modules, INVESTING_MODULE_IDS),
    widgets: pickBooleans(record.widgets, INVESTING_WIDGET_IDS),
  };
}
```

- [ ] **Step 4: Export it and run the test**

```ts
// packages/core/src/investing/index.ts — add one line, keep existing order
export * from "./splits.js";
export * from "./layout.js";
```

Run: `pnpm --filter @lavega/core test -- src/investing/layout.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/investing/layout.ts packages/core/src/investing/layout.test.ts packages/core/src/investing/index.ts
git commit -m "feat(core): add InvestingLayout type and validator"
```

- [ ] **Step 6: Write the failing in-memory store test**

```ts
// packages/adapters/src/layout/inMemoryInvestingLayoutStore.test.ts
import { expect, test } from "vitest";
import { createInMemoryInvestingLayoutStore } from "./inMemoryInvestingLayoutStore.js";

test("round-trips a layout selection per tenant", async () => {
  const store = createInMemoryInvestingLayoutStore();
  await store.set({ tenantId: "a", modules: { positions: false }, widgets: { agent: false } });
  await expect(store.get("a")).resolves.toEqual({
    modules: { positions: false },
    widgets: { agent: false },
  });
  await expect(store.get("b")).resolves.toEqual({ modules: {}, widgets: {} });
});

test("set drops unknown ids on the way in, same as validateInvestingLayout", async () => {
  const store = createInMemoryInvestingLayoutStore();
  await store.set({
    tenantId: "a",
    modules: { positions: true, "removed-module": true } as never,
    widgets: {},
  });
  await expect(store.get("a")).resolves.toEqual({ modules: { positions: true }, widgets: {} });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @lavega/adapters test -- src/layout/inMemoryInvestingLayoutStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement the in-memory store**

```ts
// packages/adapters/src/layout/inMemoryInvestingLayoutStore.ts
import {
  validateInvestingLayout,
  type InvestingLayout,
  type InvestingLayoutSelection,
  type InvestingLayoutStore,
} from "@lavega/core";

export function createInMemoryInvestingLayoutStore(
  initial: InvestingLayoutSelection[] = [],
): InvestingLayoutStore {
  const rows = new Map<string, InvestingLayout>(
    initial.map((selection) => [
      selection.tenantId,
      validateInvestingLayout(selection),
    ]),
  );
  return {
    async get(tenantId) {
      const layout = rows.get(tenantId);
      return layout ? structuredClone(layout) : { modules: {}, widgets: {} };
    },
    async set(selection) {
      rows.set(selection.tenantId, validateInvestingLayout(selection));
    },
  };
}
```

- [ ] **Step 9: Export it and run the test**

```ts
// packages/adapters/src/index.ts — add after the benchmarks exports (line 30)
export * from "./layout/inMemoryInvestingLayoutStore.js";
```

Run: `pnpm --filter @lavega/adapters test -- src/layout/inMemoryInvestingLayoutStore.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add packages/adapters/src/layout/inMemoryInvestingLayoutStore.ts packages/adapters/src/layout/inMemoryInvestingLayoutStore.test.ts packages/adapters/src/index.ts
git commit -m "feat(adapters): add in-memory investing layout store"
```

- [ ] **Step 11: Write the failing file store test**

```ts
// apps/investing-server/src/fileInvestingLayoutStore.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createFileInvestingLayoutStore } from "./fileInvestingLayoutStore.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

test("persists a layout selection across store instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-investing-layout-"));
  directories.push(directory);
  const file = join(directory, "nested", "layout.json");
  await createFileInvestingLayoutStore(file).set({
    tenantId: "local",
    modules: { agents: false },
    widgets: { sectors: false },
  });
  await expect(createFileInvestingLayoutStore(file).get("local")).resolves.toEqual({
    modules: { agents: false },
    widgets: { sectors: false },
  });
});

test("an unknown tenant reads back an empty layout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-investing-layout-"));
  directories.push(directory);
  const file = join(directory, "layout.json");
  await expect(createFileInvestingLayoutStore(file).get("missing")).resolves.toEqual({
    modules: {},
    widgets: {},
  });
});
```

- [ ] **Step 12: Run it to verify it fails**

Run: `pnpm --filter @lavega/investing-server test -- src/fileInvestingLayoutStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 13: Implement the file store**

```ts
// apps/investing-server/src/fileInvestingLayoutStore.ts
import {
  validateInvestingLayout,
  type InvestingLayoutSelection,
  type InvestingLayoutStore,
} from "@lavega/core";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

export function runtimeInvestingLayoutFile(): string {
  return runtimeDataFile("INVESTING_LAYOUT_STORE_FILE", "layout.json");
}

export function createFileInvestingLayoutStore(filePath: string): InvestingLayoutStore {
  const store = createJsonFileStore<InvestingLayoutSelection[]>(filePath, {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) throw new Error("Invalid investing layout store");
      return parsed.map((row) => {
        if (!row || typeof row !== "object" || typeof (row as { tenantId?: unknown }).tenantId !== "string")
          throw new Error("Invalid investing layout row");
        const selection = row as InvestingLayoutSelection;
        return { tenantId: selection.tenantId, ...validateInvestingLayout(selection) };
      });
    },
  });
  return {
    async get(tenantId) {
      const row = (await store.read()).find((selection) => selection.tenantId === tenantId);
      return row ? { modules: row.modules, widgets: row.widgets } : { modules: {}, widgets: {} };
    },
    async set(selection) {
      const normalized: InvestingLayoutSelection = {
        tenantId: selection.tenantId,
        ...validateInvestingLayout(selection),
      };
      await store.update((rows) => [
        ...rows.filter((row) => row.tenantId !== selection.tenantId),
        normalized,
      ]);
    },
  };
}
```

- [ ] **Step 14: Run the test to verify it passes**

Run: `pnpm --filter @lavega/investing-server test -- src/fileInvestingLayoutStore.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 15: Commit**

```bash
git add apps/investing-server/src/fileInvestingLayoutStore.ts apps/investing-server/src/fileInvestingLayoutStore.test.ts
git commit -m "feat(investing-server): add file-backed investing layout store"
```

- [ ] **Step 16: Write the failing migration and repository test**

The table is columnar per preference type (`benchmark_symbols`, `market_data_consent`), not key-value, so a new preference type is a new column — a migration is required, not optional. Name it `0016_investing_layout.sql`, following `0015_price_coverage.sql`'s ownership-check-first shape but as an `ALTER TABLE` since the table already exists.

```ts
// packages/database/src/index.test.ts — add near the existing preferences tests (after line 193)
test("layout shares the preferences row and round-trips independently of benchmarks", async () => {
  const { db, calls } = fakeDatabase([
    { benchmark_symbols: ["^AEX"], layout: { modules: { positions: false }, widgets: {} } },
  ]);
  const repository = createPreferencesRepository(db, "user-123");

  expect(await repository.getLayout()).toEqual({ modules: { positions: false }, widgets: {} });

  await repository.setLayout({ modules: {}, widgets: { agent: false } });
  const write = executed(calls).at(-1)!;
  expect(write.sql).toContain("layout");
  expect(write.sql).not.toContain("benchmark_symbols");
  expect(write.values).toEqual([JSON.stringify({ modules: {}, widgets: { agent: false } })]);
});

test("a tenant with no preferences row reads an empty layout rather than throwing", async () => {
  const repository = createPreferencesRepository(fakeDatabase().db, "user-123");
  expect(await repository.getLayout()).toBeNull();
});
```

- [ ] **Step 17: Run it to verify it fails**

Run: `pnpm --filter @lavega/database test -- src/index.test.ts -t "layout"`
Expected: FAIL — `repository.getLayout is not a function`.

- [ ] **Step 18: Write the migration**

```sql
-- db/migrations/0016_investing_layout.sql
BEGIN;

DO $$
DECLARE
  schema_owner TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    SELECT pg_get_userbyid(nspowner) INTO schema_owner FROM pg_namespace WHERE nspname = 'investing';
    IF NOT pg_has_role(current_user, schema_owner, 'MEMBER') THEN
      RAISE EXCEPTION 'apply this migration connected as %, the owner of schema % (you are %)',
        schema_owner, 'investing', current_user;
    END IF;
  END IF;
END $$;

/*
 * The investing app shell's per-tab and per-widget on/off choices, one row
 * per tenant sharing investing.preferences with benchmark_symbols and
 * market_data_consent. A JSONB object rather than a fourth top-level column
 * per module/widget: the id list is expected to grow (new modules, new
 * Overview cards), and each new id would otherwise be its own migration.
 */
ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS layout JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE investing.preferences
  DROP CONSTRAINT IF EXISTS preferences_layout_object;
ALTER TABLE investing.preferences
  ADD CONSTRAINT preferences_layout_object CHECK (jsonb_typeof(layout) = 'object');

COMMIT;
```

- [ ] **Step 19: Add `getLayout`/`setLayout` to `PreferencesRepository`**

```ts
// packages/database/src/index.ts:497-532 — replace the existing block
export type PreferencesRepository = {
  getBenchmarkSymbols(): Promise<string[]>;
  setBenchmarkSymbols(symbols: readonly string[]): Promise<void>;
  getMarketDataConsent(): Promise<unknown | null>;
  setMarketDataConsent(decision: unknown): Promise<void>;
  getLayout(): Promise<unknown | null>;
  setLayout(layout: unknown): Promise<void>;
};

/** Benchmarks, market-data consent and layout share one row, so each write names its own column. */
export function createPreferencesRepository(
  db: Database,
  userId: string | undefined | null,
): PreferencesRepository {
  const tenantId = requireUserId(userId);
  const read = async <T>(column: string, fallback: T): Promise<T> =>
    withTenantStatement(db, tenantId, async (client) => {
      const result = await client.query<QueryResultRow>(
        `SELECT ${column} FROM investing.preferences`,
      );
      const value = result.rows[0]?.[column];
      return value == null ? fallback : (value as T);
    });
  const write = async (column: string, value: unknown) => {
    await withTenantStatement(db, tenantId, async (client) => {
      await client.query(
        `INSERT INTO investing.preferences (user_id, ${column}) VALUES (current_setting('app.user_id'), $1::jsonb) ON CONFLICT (user_id) DO UPDATE SET ${column} = EXCLUDED.${column}, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(value)],
      );
    });
  };
  return {
    getBenchmarkSymbols: () => read<string[]>("benchmark_symbols", []),
    setBenchmarkSymbols: (symbols) => write("benchmark_symbols", [...symbols]),
    getMarketDataConsent: () => read<unknown | null>("market_data_consent", null),
    setMarketDataConsent: (decision) => write("market_data_consent", decision),
    getLayout: () => read<unknown | null>("layout", null),
    setLayout: (layout) => write("layout", layout),
  };
}
```

- [ ] **Step 20: Run the repository test, then the full migration suite**

Run: `pnpm --filter @lavega/database test -- src/index.test.ts -t "layout"`
Expected: PASS (2 tests).

Run: `pnpm --filter @lavega/database test -- src/migrations.test.ts`
Expected: PASS — `0016_investing_layout.sql` applies cleanly and the existing grants (already table-level, from `0002_auth.sql`) cover the new column with no further grant needed.

- [ ] **Step 21: Commit**

```bash
git add db/migrations/0016_investing_layout.sql packages/database/src/index.ts packages/database/src/index.test.ts
git commit -m "feat(database): add layout column to investing.preferences"
```

- [ ] **Step 22: Write the failing Neon store test**

```ts
// apps/investing-server/src/neonStores.test.ts — add near the benchmark selection test
test("investing layout is validated on the way in and out", async () => {
  const { db, calls } = fakeDatabase([{ layout: { modules: { positions: false }, widgets: {} } }]);
  const store = createNeonInvestingLayoutStore(db);

  await expect(store.get("user-123")).resolves.toEqual({
    modules: { positions: false },
    widgets: {},
  });

  await store.set({ tenantId: "user-123", modules: {}, widgets: { sectors: false } });
  const write = executed(calls).at(-1)!;
  expect(write.sql).toContain("layout");
  expect(write.values).toEqual([JSON.stringify({ modules: {}, widgets: { sectors: false } })]);
});

test("a tenant with no preferences row reads an empty layout from Neon", async () => {
  const store = createNeonInvestingLayoutStore(fakeDatabase().db);
  await expect(store.get("user-123")).resolves.toEqual({ modules: {}, widgets: {} });
});
```

Add `createNeonInvestingLayoutStore` to the existing import line at the top of the test file.

- [ ] **Step 23: Run it to verify it fails**

Run: `pnpm --filter @lavega/investing-server test -- src/neonStores.test.ts -t "layout"`
Expected: FAIL — `createNeonInvestingLayoutStore is not exported`.

- [ ] **Step 24: Implement `createNeonInvestingLayoutStore`**

```ts
// apps/investing-server/src/neonStores.ts — add import and function
import { validateInvestingLayout, type InvestingLayoutStore } from "@lavega/core";
// (alongside the existing `import { validateBenchmarkSymbols, ... } from "@lavega/core";`)

export function createNeonInvestingLayoutStore(db: Database): InvestingLayoutStore {
  return {
    async get(tenantId) {
      const stored = await createPreferencesRepository(db, tenantId).getLayout();
      return validateInvestingLayout(stored);
    },
    async set(selection) {
      await createPreferencesRepository(db, selection.tenantId).setLayout(
        validateInvestingLayout(selection),
      );
    },
  };
}
```

- [ ] **Step 25: Run the test to verify it passes**

Run: `pnpm --filter @lavega/investing-server test -- src/neonStores.test.ts`
Expected: PASS.

- [ ] **Step 26: Commit**

```bash
git add apps/investing-server/src/neonStores.ts apps/investing-server/src/neonStores.test.ts
git commit -m "feat(investing-server): add Neon-backed investing layout store"
```

- [ ] **Step 27: Write the failing route tests**

```ts
// apps/investing-server/src/app.test.ts — add near the benchmark route test (after line 144)
test("layout route persists per-tenant choices and drops unknown ids", async () => {
  const investingLayoutStore = createInMemoryInvestingLayoutStore();
  const investingApp = createApp({ investingLayoutStore });

  expect(await (await investingApp.request("/api/investing/layout")).json()).toEqual({
    modules: {},
    widgets: {},
  });

  const saved = await investingApp.request("/api/investing/layout", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      modules: { positions: false, "unknown-module": true },
      widgets: { sectors: false },
    }),
  });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ modules: { positions: false }, widgets: { sectors: false } });
  expect(await (await investingApp.request("/api/investing/layout")).json()).toEqual({
    modules: { positions: false },
    widgets: { sectors: false },
  });
});

test("layout route sanitizes a malformed body instead of rejecting it", async () => {
  const investingApp = createApp({ investingLayoutStore: createInMemoryInvestingLayoutStore() });
  const response = await investingApp.request("/api/investing/layout", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: "not json",
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ modules: {}, widgets: {} });
});
```

Add `createInMemoryInvestingLayoutStore` to the existing `@lavega/adapters` import at the top of `app.test.ts`.

- [ ] **Step 28: Run it to verify it fails**

Run: `pnpm --filter @lavega/investing-server test -- src/app.test.ts -t "layout route"`
Expected: FAIL — 404 on `/api/investing/layout` (route does not exist).

- [ ] **Step 29: Add the route and dependency to `createApp`**

```ts
// apps/investing-server/src/app.ts:105-137 — add to PriceDependencies
import {
  validateInvestingLayout,
  type InvestingLayoutStore,
  // ...existing InvestingDashboardData etc. imports stay
} from "@lavega/core";
import { createInMemoryInvestingLayoutStore } from "@lavega/adapters"; // alongside the existing adapters import

type PriceDependencies = {
  // ...existing fields...
  investingLayoutStore: InvestingLayoutStore;
};
```

```ts
// apps/investing-server/src/app.ts:138-160 — add default, alongside benchmarkSelectionStore
  const investingLayoutStore =
    dependencies.investingLayoutStore ?? createInMemoryInvestingLayoutStore();
```

```ts
// apps/investing-server/src/app.ts — add immediately after the /api/investing/benchmarks routes (after line 360)
  investingApp.get("/api/investing/layout", async (c) =>
    c.json(await investingLayoutStore.get(await resolveTenantId())),
  );
  investingApp.put("/api/investing/layout", async (c) => {
    const body: unknown = await c.req.json().catch(() => ({}));
    const layout = validateInvestingLayout(body);
    const tenantId = await resolveTenantId();
    await investingLayoutStore.set({ tenantId, ...layout });
    return c.json(layout);
  });
```

- [ ] **Step 30: Run the tests to verify they pass**

Run: `pnpm --filter @lavega/investing-server test -- src/app.test.ts`
Expected: PASS (full file — confirms the new routes don't disturb the existing benchmark/dashboard/broker tests).

- [ ] **Step 31: Commit**

```bash
git add apps/investing-server/src/app.ts apps/investing-server/src/app.test.ts
git commit -m "feat(investing-server): add GET/PUT /api/investing/layout"
```

- [ ] **Step 32: Wire `investingLayoutStore` through `createRuntimeApp`, the standalone Docker server, and the mounted server**

```ts
// apps/investing-server/src/index.ts:182-192 — add to RuntimeAppOptions
export type RuntimeAppOptions = {
  priceStore: PriceStore;
  resolveTenantId?: () => string | Promise<string>;
  benchmarkSelectionStore?: BenchmarkSelectionStore;
  investingLayoutStore?: InvestingLayoutStore;
  // ...unchanged fields...
};
```

```ts
// apps/investing-server/src/index.ts:210-213 — add default alongside benchmarkSelectionStore
  const benchmarkSelectionStore =
    options.benchmarkSelectionStore ?? createInMemoryBenchmarkSelectionStore();
  const investingLayoutStore =
    options.investingLayoutStore ?? createInMemoryInvestingLayoutStore();
```

```ts
// apps/investing-server/src/index.ts:868-904 — add `investingLayoutStore,` to BOTH createApp(...) calls,
// on the line right after `benchmarkSelectionStore,`
        benchmarkSelectionStore,
        investingLayoutStore,
```

Add `InvestingLayoutStore` to the existing `@lavega/core` type-only import, and `createInMemoryInvestingLayoutStore` to the existing `@lavega/adapters` import, at the top of `index.ts`.

```ts
// apps/investing-server/src/docker.ts:7-14 — add alongside the benchmark file-store import
import {
  createFileInvestingLayoutStore,
  runtimeInvestingLayoutFile,
} from "./fileInvestingLayoutStore.js";
```

```ts
// apps/investing-server/src/docker.ts:68-73 — add to the standalone createRuntimeApp call
  const runtimeApp = await createRuntimeApp({
    priceStore: createFilePriceStore(runtimePriceStoreFile()),
    benchmarkSelectionStore: createFileBenchmarkSelectionStore(runtimeBenchmarkSelectionFile()),
    marketDataConsentStore: createFileMarketDataConsentStore(runtimeMarketDataConsentFile()),
    investingLayoutStore: createFileInvestingLayoutStore(runtimeInvestingLayoutFile()),
  });
```

```ts
// apps/server/src/investing-mount.ts:9-27 — add alongside the existing file-store imports
import {
  createFileInvestingLayoutStore,
  runtimeInvestingLayoutFile,
} from "@lavega/investing-server/src/fileInvestingLayoutStore.js";
import {
  createNeonBenchmarkSelectionStore,
  createNeonMarketDataConsentStore,
  createNeonPriceStore,
  createNeonInvestingLayoutStore,
} from "@lavega/investing-server/src/neonStores.js";
```

```ts
// apps/server/src/investing-mount.ts:109-121 — add to the createRuntimeApp call inside getInvestingFetch()
  const runtimeApp = await createRuntimeApp({
    resolveTenantId: currentInvestingTenant,
    priceStore: database
      ? createNeonPriceStore(database, currentInvestingTenant)
      : createFilePriceStore(runtimePriceStoreFile()),
    benchmarkSelectionStore: database
      ? createNeonBenchmarkSelectionStore(database)
      : createFileBenchmarkSelectionStore(runtimeBenchmarkSelectionFile()),
    marketDataConsentStore: database
      ? createNeonMarketDataConsentStore(database)
      : createFileMarketDataConsentStore(runtimeMarketDataConsentFile()),
    investingLayoutStore: database
      ? createNeonInvestingLayoutStore(database)
      : createFileInvestingLayoutStore(runtimeInvestingLayoutFile()),
    dashboardCache,
  });
```

- [ ] **Step 33: Run the full investing-server suite and the server-side mount tests**

Run: `pnpm --filter @lavega/investing-server test`
Expected: PASS — every existing test still passes; the new dependency has a default everywhere it is not explicitly supplied.

Run: `pnpm --filter @lavega/server test -- src/investing-mount.test.ts src/investing-guard.test.ts src/apiGuard.investing.test.ts`
Expected: PASS — confirms `/api/investing/layout` needs no change to `investingOwnsApiPath`'s namespace derivation (it already walks the live route table and "investing" is already a recognized namespace via the existing `/api/investing/*` routes).

- [ ] **Step 34: Commit**

```bash
git add apps/investing-server/src/index.ts apps/investing-server/src/docker.ts apps/server/src/investing-mount.ts
git commit -m "feat(investing): wire investing layout store through runtime, docker, and mount"
```

---

### Task 2: Web layout resource, registry, and the Profile page

**Files:**
- Create: `apps/investing-web/src/lib/investingRegistry.ts`
- Create: `apps/investing-web/src/lib/investingRegistry.test.ts`
- Create: `apps/investing-web/src/lib/layoutResource.ts`
- Create: `apps/investing-web/src/lib/layoutResource.test.tsx`
- Create: `apps/investing-web/src/components/LayoutPicker.tsx`
- Create: `apps/investing-web/src/components/LayoutPicker.test.tsx`
- Create: `apps/investing-web/src/components/BrokerSettings.tsx`
- Create: `apps/investing-web/src/components/Profile.tsx`
- Create: `apps/investing-web/src/components/Profile.test.tsx`
- Modify: `apps/investing-web/src/app.tsx` (remove `BrokerConnect` and its supporting components; app.tsx wiring for the route itself happens in Task 3)
- Modify: `apps/investing-web/src/app.test.tsx` (move the 11 broker-connect tests listed in Step 12 to `Profile.test.tsx`)

**Interfaces:**
- Consumes: `InvestingModuleId`, `InvestingWidgetId`, `InvestingLayout` from `@lavega/core` (Task 1); `GET`/`PUT /api/investing/layout` (Task 1).
- Produces: `investingModulePath(id: InvestingModuleId | "overview"): string`; `MODULES: InvestingModuleDef[]`, `WIDGETS: InvestingWidgetDef[]`, `HOME_MODULE = "overview"`; `resolveModules(stored: Partial<Record<InvestingModuleId, boolean>>): InvestingModuleId[]` (registry order, "overview" always included first); `resolveWidgets(stored: Partial<Record<InvestingWidgetId, boolean>>): InvestingWidgetId[]` (registry order); `toggleModule`/`toggleWidget` helpers with the same shape as Personal's.
- Produces: `useInvestingLayout(): { status: "loading" | "ready"; modules: InvestingModuleId[]; widgets: InvestingWidgetId[]; setModules: (next: Partial<Record<InvestingModuleId, boolean>>) => void; setWidgets: (next: Partial<Record<InvestingWidgetId, boolean>>) => void }`. While `status === "loading"`, `modules`/`widgets` already reflect the registry defaults (`resolveModules({})`/`resolveWidgets({})`) — Task 3's shell and Task 4's Overview never need to special-case "loading" to avoid a blank/flashing render.
- Produces: `<LayoutPicker kind="module" | "widget" enabled={ids} onChange={(next) => void} />`.
- Produces: `<BrokerSettings />` (no props — same internal state as the old `BrokerConnect`).
- Produces: `<Profile />` (no props; reads `useInvestingLayout()` and `getSession()` itself). Consumed by Task 3's route table.
- Task 3 consumes `MODULES`, `resolveModules`, `investingModulePath`, `useInvestingLayout` for the shell and route guards. Task 4 consumes `WIDGETS`, `resolveWidgets`, `useInvestingLayout` for the Overview grid.

- [ ] **Step 1: Write the failing registry tests**

```ts
// apps/investing-web/src/lib/investingRegistry.test.ts
import { describe, expect, test } from "vitest";
import {
  HOME_MODULE,
  MODULES,
  WIDGETS,
  resolveModules,
  resolveWidgets,
  toggleModule,
  toggleWidget,
  investingModulePath,
} from "./investingRegistry.js";

describe("investing registry", () => {
  test("no widget id is also a module id", () => {
    const moduleIds = new Set(MODULES.map((m) => m.id));
    for (const widget of WIDGETS) expect(moduleIds.has(widget.id as never)).toBe(false);
  });

  test("overview is always present and first, regardless of stored data", () => {
    expect(resolveModules({})[0]).toBe(HOME_MODULE);
    expect(resolveModules({ positions: false, "net-worth": false, agents: false })).toEqual([
      "overview",
    ]);
  });

  test("an absent key falls back to the registry default (all modules on)", () => {
    expect(resolveModules({})).toEqual(["overview", "positions", "net-worth", "agents"]);
  });

  test("unknown stored module ids are dropped, not surfaced as a tab", () => {
    expect(resolveModules({ "old-module": true } as never)).toEqual(["overview"]);
  });

  test("all widgets default on and follow registry order regardless of storage order", () => {
    expect(resolveWidgets({})).toEqual([
      "performance",
      "allocation",
      "kpis",
      "risk",
      "sectors",
      "agent",
    ]);
    expect(resolveWidgets({ agent: true, performance: true })).toEqual([
      "performance",
      "agent",
    ]);
  });

  test("unknown stored widget ids are dropped, never rendered as a card", () => {
    expect(resolveWidgets({ "old-widget": true } as never)).toEqual([
      "performance",
      "allocation",
      "kpis",
      "risk",
      "sectors",
      "agent",
    ]);
  });

  test("toggling overview off is a no-op", () => {
    expect(toggleModule({}, "overview" as never, false)).toEqual({});
  });

  test("toggling a module or widget off removes only that id", () => {
    expect(toggleModule({ positions: true }, "positions", false)).toEqual({ positions: false });
    expect(toggleWidget({ agent: true }, "agent", false)).toEqual({ agent: false });
  });

  test("every module resolves to a real path", () => {
    for (const id of ["overview", "positions", "net-worth", "agents"] as const) {
      expect(investingModulePath(id)).toMatch(/^\//);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lavega/investing-web test -- src/lib/investingRegistry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the registry**

```ts
// apps/investing-web/src/lib/investingRegistry.ts
import type { ReactNode } from "react";
import {
  INVESTING_MODULE_IDS,
  INVESTING_WIDGET_IDS,
  type InvestingModuleId,
  type InvestingWidgetId,
} from "@lavega/core";

/* The module and widget registry — the one place a tab or Overview card is
 * declared, mirroring apps/web/src/components/moduleRegistry.tsx. Investing
 * stores the chosen ids server-side (see lib/layoutResource.ts) instead of
 * localStorage, and uses react-router paths instead of Personal's view state,
 * so this is an adaptation of that file's shape, not a shared import. */

export const HOME_MODULE = "overview" as const;
type ModuleOrHome = InvestingModuleId | typeof HOME_MODULE;

export type InvestingModuleDef = {
  id: ModuleOrHome;
  label: string;
  what: string;
  path: string;
  preview: ReactNode;
};

export type InvestingWidgetDef = {
  id: InvestingWidgetId;
  label: string;
  what: string;
  preview: ReactNode;
};

function Thumb({ children }: { children: ReactNode }) {
  return (
    <svg
      className="h-[60px] w-24 shrink-0"
      viewBox="0 0 96 60"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0" y="0" width="96" height="60" rx="8" className="fill-secondary" />
      {children}
    </svg>
  );
}

function Tile({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <rect x={x} y={y} width={w} height={h} rx="3" className="fill-card stroke-border" />;
}

function Line({ x, y, w, strong }: { x: number; y: number; w: number; strong?: boolean }) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={strong ? 4 : 2.5}
      rx="1.25"
      className={strong ? "fill-foreground" : "fill-muted-foreground"}
      opacity={strong ? 0.85 : 0.45}
    />
  );
}

/** In the order they appear in the top bar, after Overview. */
export const MODULES: InvestingModuleDef[] = [
  {
    id: "overview",
    label: "Overview",
    what: "Your home screen: performance, allocation and key figures.",
    path: "/",
    preview: (
      <Thumb>
        <Tile x={8} y={8} w={36} h={20} />
        <Line x={12} y={13} w={16} strong />
        <Tile x={52} y={8} w={36} h={20} />
        <Line x={56} y={13} w={12} strong />
        <Tile x={8} y={34} w={80} h={18} />
        <Line x={12} y={40} w={20} strong />
      </Thumb>
    ),
  },
  {
    id: "positions",
    label: "Positions",
    what: "Every open and closed position, sortable by value, weight and return.",
    path: "/positions",
    preview: (
      <Thumb>
        <Line x={8} y={8} w={26} strong />
        <Tile x={8} y={18} w={80} h={10} />
        <Tile x={8} y={31} w={80} h={10} />
        <Tile x={8} y={44} w={80} h={10} />
      </Thumb>
    ),
  },
  {
    id: "net-worth",
    label: "Net worth",
    what: "A stacked chart of invested value and cash over time.",
    path: "/net-worth",
    preview: (
      <Thumb>
        <path d="M8 44h80" className="stroke-border" strokeWidth="1.5" />
        <path
          d="M8 40 L26 34 L44 38 L62 24 L80 16"
          fill="none"
          className="stroke-primary"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Thumb>
    ),
  },
  {
    id: "agents",
    label: "Agents",
    what: "Portfolio lenses you can ask about concentration, return and risk.",
    path: "/agents",
    preview: (
      <Thumb>
        <circle cx="24" cy="30" r="12" className="fill-primary" opacity="0.35" />
        <circle cx="56" cy="20" r="9" className="fill-primary" opacity="0.25" />
        <circle cx="78" cy="38" r="9" className="fill-primary" opacity="0.2" />
      </Thumb>
    ),
  },
];

export function investingModulePath(id: ModuleOrHome): string {
  return MODULES.find((m) => m.id === id)?.path ?? "/";
}

const KNOWN_MODULES = new Set<string>(INVESTING_MODULE_IDS);

/** Resolve stored module choices into the tabs the top bar shows, always in
 *  registry order with Overview first and never removable. */
export function resolveModules(
  stored: Partial<Record<InvestingModuleId, boolean>>,
): ModuleOrHome[] {
  const chosen = MODULES.filter((m) => {
    if (m.id === HOME_MODULE) return true;
    const explicit = stored[m.id as InvestingModuleId];
    return explicit ?? true; // every module defaults on (spec §1)
  }).map((m) => m.id);
  return chosen;
}

export function toggleModule(
  enabled: Partial<Record<InvestingModuleId, boolean>>,
  id: InvestingModuleId,
  on: boolean,
): Partial<Record<InvestingModuleId, boolean>> {
  if (!KNOWN_MODULES.has(id)) return enabled;
  return { ...enabled, [id]: on };
}

/** In the order they appear on Overview: left column, then right column,
 *  then full-width cards below (spec §3's table). */
export const WIDGETS: InvestingWidgetDef[] = [
  {
    id: "performance",
    label: "Performance",
    what: "Portfolio value or indexed return against your chosen benchmarks.",
    preview: (
      <Thumb>
        <path
          d="M8 44 L28 30 L48 36 L68 18 L88 24"
          fill="none"
          className="stroke-primary"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Thumb>
    ),
  },
  {
    id: "allocation",
    label: "Allocation",
    what: "A donut of your holdings, by instrument or by entity.",
    preview: (
      <Thumb>
        <circle
          cx="48"
          cy="30"
          r="18"
          fill="none"
          className="stroke-primary"
          strokeWidth="8"
          opacity="0.7"
        />
      </Thumb>
    ),
  },
  {
    id: "kpis",
    label: "Key figures",
    what: "Portfolio value, daily change and total return since inception.",
    preview: (
      <Thumb>
        <Line x={8} y={12} w={40} strong />
        <Line x={8} y={26} w={30} strong />
        <Line x={8} y={40} w={34} strong />
      </Thumb>
    ),
  },
  {
    id: "risk",
    label: "Risk & composition",
    what: "Volatility, beta, alpha, drawdown and your largest positions.",
    preview: (
      <Thumb>
        <Tile x={8} y={8} w={80} h={44} />
        <Line x={13} y={14} w={30} strong />
        <Line x={13} y={24} w={40} />
        <Line x={13} y={34} w={36} />
      </Thumb>
    ),
  },
  {
    id: "sectors",
    label: "Sector allocation",
    what: "What sector your priced holdings are concentrated in.",
    preview: (
      <Thumb>
        <rect x="8" y="14" width="80" height="6" rx="3" className="fill-primary" opacity="0.7" />
        <rect x="8" y="26" width="56" height="6" rx="3" className="fill-primary" opacity="0.5" />
        <rect x="8" y="38" width="34" height="6" rx="3" className="fill-primary" opacity="0.35" />
      </Thumb>
    ),
  },
  {
    id: "agent",
    label: "Portfolio agent",
    what: "Ask a chosen investor lens about your positions.",
    preview: (
      <Thumb>
        <circle cx="24" cy="30" r="12" className="fill-primary" opacity="0.35" />
        <Line x={44} y={22} w={40} strong />
        <Line x={44} y={34} w={30} />
      </Thumb>
    ),
  },
];

const KNOWN_WIDGETS = new Set<string>(INVESTING_WIDGET_IDS);

/** Every widget defaults on (spec §3's table); an absent key means "on". */
export function resolveWidgets(
  stored: Partial<Record<InvestingWidgetId, boolean>>,
): InvestingWidgetId[] {
  return WIDGETS.filter((w) => stored[w.id] ?? true).map((w) => w.id);
}

export function toggleWidget(
  enabled: Partial<Record<InvestingWidgetId, boolean>>,
  id: InvestingWidgetId,
  on: boolean,
): Partial<Record<InvestingWidgetId, boolean>> {
  if (!KNOWN_WIDGETS.has(id)) return enabled;
  return { ...enabled, [id]: on };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lavega/investing-web test -- src/lib/investingRegistry.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/investing-web/src/lib/investingRegistry.ts apps/investing-web/src/lib/investingRegistry.test.ts
git commit -m "feat(investing-web): add module/widget registry"
```

- [ ] **Step 6: Write the failing layout resource tests**

```tsx
// apps/investing-web/src/lib/layoutResource.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { useInvestingLayout } from "./layoutResource.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => vi.restoreAllMocks());

function Probe() {
  const layout = useInvestingLayout();
  return (
    <div>
      <span data-testid="status">{layout.status}</span>
      <span data-testid="modules">{layout.modules.join(",")}</span>
      <span data-testid="widgets">{layout.widgets.join(",")}</span>
    </div>
  );
}

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

test("resolves registry defaults immediately, before the fetch settles", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  const { container, root } = render();
  act(() => root.render(<Probe />));
  expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("loading");
  expect(container.querySelector('[data-testid="modules"]')?.textContent).toBe(
    "overview,positions,net-worth,agents",
  );
  root.unmount();
});

test("applies the tenant's stored choices once the fetch resolves", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ modules: { agents: false }, widgets: { sectors: false } })),
      ),
    ),
  );
  const { container, root } = render();
  await act(async () => {
    root.render(<Probe />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("ready");
  expect(container.querySelector('[data-testid="modules"]')?.textContent).toBe(
    "overview,positions,net-worth",
  );
  expect(container.querySelector('[data-testid="widgets"]')?.textContent).toBe(
    "performance,allocation,kpis,risk,agent",
  );
  root.unmount();
});

test("a failed or unauthorized fetch keeps the registry defaults instead of erroring", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 401 }))));
  const { container, root } = render();
  await act(async () => {
    root.render(<Probe />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('[data-testid="modules"]')?.textContent).toBe(
    "overview,positions,net-worth,agents",
  );
  root.unmount();
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @lavega/investing-web test -- src/lib/layoutResource.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement the layout resource**

```ts
// apps/investing-web/src/lib/layoutResource.ts
import { useEffect, useState } from "react";
import type { InvestingLayout, InvestingModuleId, InvestingWidgetId } from "@lavega/core";
import { HOME_MODULE, resolveModules, resolveWidgets } from "./investingRegistry.js";

type LayoutState = {
  status: "loading" | "ready";
  layout: InvestingLayout;
};

const EMPTY_LAYOUT: InvestingLayout = { modules: {}, widgets: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Decodes only as much of the contract as this app reads. Any other shape —
 *  including a 401/500 body — falls back to EMPTY_LAYOUT, which resolves to
 *  registry defaults exactly like a tenant who never chose. A layout
 *  preference failing to load must never blank the shell (spec §5). */
function decodeLayout(payload: unknown): InvestingLayout {
  if (!isRecord(payload)) return EMPTY_LAYOUT;
  return {
    modules: isRecord(payload.modules) ? (payload.modules as InvestingLayout["modules"]) : {},
    widgets: isRecord(payload.widgets) ? (payload.widgets as InvestingLayout["widgets"]) : {},
  };
}

async function fetchLayout(): Promise<InvestingLayout> {
  try {
    const response = await fetch("/api/investing/layout");
    if (!response.ok) return EMPTY_LAYOUT;
    return decodeLayout(await response.json().catch(() => null));
  } catch {
    return EMPTY_LAYOUT;
  }
}

async function putLayout(layout: InvestingLayout): Promise<void> {
  try {
    await fetch("/api/investing/layout", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(layout),
    });
  } catch {
    // A failed save leaves the previous server-side choice in place; the
    // local optimistic update still reflects what the reader just did.
  }
}

export type InvestingLayoutResource = {
  status: "loading" | "ready";
  modules: Array<InvestingModuleId | typeof HOME_MODULE>;
  widgets: InvestingWidgetId[];
  setModules: (next: Partial<Record<InvestingModuleId, boolean>>) => void;
  setWidgets: (next: Partial<Record<InvestingWidgetId, boolean>>) => void;
};

export function useInvestingLayout(): InvestingLayoutResource {
  const [state, setState] = useState<LayoutState>({ status: "loading", layout: EMPTY_LAYOUT });

  useEffect(() => {
    let current = true;
    void fetchLayout().then((layout) => {
      if (current) setState({ status: "ready", layout });
    });
    return () => {
      current = false;
    };
  }, []);

  function setModules(next: Partial<Record<InvestingModuleId, boolean>>) {
    setState((previous) => ({ status: "ready", layout: { ...previous.layout, modules: next } }));
    void putLayout({ ...state.layout, modules: next });
  }

  function setWidgets(next: Partial<Record<InvestingWidgetId, boolean>>) {
    setState((previous) => ({ status: "ready", layout: { ...previous.layout, widgets: next } }));
    void putLayout({ ...state.layout, widgets: next });
  }

  return {
    status: state.status,
    modules: resolveModules(state.layout.modules),
    widgets: resolveWidgets(state.layout.widgets),
    setModules,
    setWidgets,
  };
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @lavega/investing-web test -- src/lib/layoutResource.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
git add apps/investing-web/src/lib/layoutResource.ts apps/investing-web/src/lib/layoutResource.test.tsx
git commit -m "feat(investing-web): add useInvestingLayout resource"
```

- [ ] **Step 11: Write the failing LayoutPicker tests**

```tsx
// apps/investing-web/src/components/LayoutPicker.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { LayoutPicker } from "./LayoutPicker.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => vi.restoreAllMocks());

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

test("module picker locks Overview's switch and lists every other module", () => {
  const onChange = vi.fn();
  const { container, root } = render();
  act(() => {
    root.render(
      <LayoutPicker
        kind="module"
        enabled={["overview", "positions", "net-worth", "agents"]}
        onChange={onChange}
      />,
    );
  });
  const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
  expect(switches).toHaveLength(4);
  expect(switches[0]?.disabled).toBe(true);
  expect(switches[0]?.getAttribute("aria-checked")).toBe("true");
  root.unmount();
});

test("clicking a switch reports the next enabled set, not a mutation of the old one", () => {
  const onChange = vi.fn();
  const { container, root } = render();
  act(() => {
    root.render(<LayoutPicker kind="widget" enabled={["performance", "kpis"]} onChange={onChange} />);
  });
  const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
  const performanceSwitch = switches.find((el) => el.getAttribute("aria-checked") === "true")!;
  act(() => performanceSwitch.click());
  expect(onChange).toHaveBeenCalledWith(["kpis"]);
  root.unmount();
});
```

- [ ] **Step 12: Run it to verify it fails**

Run: `pnpm --filter @lavega/investing-web test -- src/components/LayoutPicker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 13: Implement `LayoutPicker`**

```tsx
// apps/investing-web/src/components/LayoutPicker.tsx
import { HOME_MODULE, MODULES, WIDGETS } from "../lib/investingRegistry.js";
import type { InvestingModuleId, InvestingWidgetId } from "@lavega/core";

/* One row per module or widget: preview, label, one line, switch. Mirrors
 * apps/web/src/components/ModulePicker.tsx's row shape, hand-rolled as a
 * role="switch" button rather than a new shadcn Switch import — investing-web
 * has no Switch component yet and one control does not earn a new dependency. */

type Kind = "module" | "widget";

type LayoutPickerProps =
  | { kind: "module"; enabled: Array<InvestingModuleId | typeof HOME_MODULE>; onChange: (next: InvestingModuleId[]) => void }
  | { kind: "widget"; enabled: InvestingWidgetId[]; onChange: (next: InvestingWidgetId[]) => void };

function Switch({
  on,
  locked,
  label,
  onToggle,
}: {
  on: boolean;
  locked?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={locked}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-pill border border-border transition-colors disabled:opacity-60 ${on ? "bg-primary" : "bg-secondary"}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 size-5 rounded-pill bg-background transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

export function LayoutPicker(props: LayoutPickerProps) {
  if (props.kind === "module") {
    const on = new Set(props.enabled);
    return (
      <ul className="divide-y divide-border">
        {MODULES.map((m) => {
          const locked = m.id === HOME_MODULE;
          const isOn = on.has(m.id);
          return (
            <li key={m.id} className="flex items-center gap-4 py-4">
              {m.preview}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{m.label}</p>
                <p className="text-sm text-muted-foreground">{m.what}</p>
                {locked && <p className="text-xs text-muted-foreground">Always on.</p>}
              </div>
              <Switch
                on={isOn}
                locked={locked}
                label={`${m.label} in the top bar`}
                onToggle={() => {
                  if (locked) return;
                  const next = isOn ? [...on].filter((id) => id !== m.id) : [...on, m.id];
                  props.onChange(next.filter((id): id is InvestingModuleId => id !== HOME_MODULE));
                }}
              />
            </li>
          );
        })}
      </ul>
    );
  }
  const on = new Set(props.enabled);
  return (
    <ul className="divide-y divide-border">
      {WIDGETS.map((w) => {
        const isOn = on.has(w.id);
        return (
          <li key={w.id} className="flex items-center gap-4 py-4">
            {w.preview}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{w.label}</p>
              <p className="text-sm text-muted-foreground">{w.what}</p>
            </div>
            <Switch
              on={isOn}
              label={`${w.label} on Overview`}
              onToggle={() => {
                const next = isOn ? [...on].filter((id) => id !== w.id) : [...on, w.id];
                props.onChange(next);
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 14: Run the test to verify it passes**

Run: `pnpm --filter @lavega/investing-web test -- src/components/LayoutPicker.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 15: Commit**

```bash
git add apps/investing-web/src/components/LayoutPicker.tsx apps/investing-web/src/components/LayoutPicker.test.tsx
git commit -m "feat(investing-web): add LayoutPicker for modules and widgets"
```

- [ ] **Step 16: Extract `BrokerSettings` from `app.tsx`**

Move these declarations out of `apps/investing-web/src/app.tsx` verbatim (unchanged bodies) into a new file, in this order: the `SYNC_BACKGROUND_MESSAGE` constant, `otherBrokerUnconfigured`, `BrokerSetupCard`, `BrokerSyncAction`, `BrokerSyncProgressCard`, `useVaultPassphraseMode`, `BrokerVaultUnlock`, `BrokerCredentialForm`, and `BrokerConnect` itself (renamed `BrokerSettings`). Delete them from `app.tsx` and delete the now-unused `startBrokerSync`/`historyGate`-only-for-broker imports there if `app.tsx` no longer references them directly (check with `pnpm --filter @lavega/investing-web typecheck` in Step 18 — `startBrokerSync` is still used by `AppOpenSync`, so it stays imported in `app.tsx`).

The only content edit: inside the moved component (renamed from `function BrokerConnect()` to `export function BrokerSettings()`), delete the outer `<Link to="/" className="text-sm font-semibold text-primary hover:underline">← Back to overview</Link>` block and the `"Secure local connection"` eyebrow + `<h2>Connect broker</h2>` intro paragraph (lines that read `Follow the instructions for your broker...`), and change the wrapping `<div className="mx-auto max-w-5xl space-y-8">` to `<div className="space-y-8">` (Profile.tsx supplies its own heading and centering). Everything from `<BrokerVaultUnlock />` onward — vault unlock, the credential-problem paragraph, `BrokerSyncProgressCard`, the two `BrokerSetupCard`s, `BrokerCredentialForm`, `BrokerSyncAction`, and the "Credentials stay on your machine…" paragraph — is unchanged.

```tsx
// apps/investing-web/src/components/BrokerSettings.tsx — final shape (imports trimmed to what moved)
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { startBrokerSync } from "../lib/syncSession.js";

const SYNC_BACKGROUND_MESSAGE = "Sync continues in the background; progress is shown above.";

function otherBrokerUnconfigured(problem: string, broker: "ibkr" | "trading212"): boolean {
  const other = broker === "ibkr" ? /trading\s*212/i : /ibkr/i;
  return other.test(problem) && /credentials are not configured/i.test(problem);
}

// ...BrokerSetupCard, BrokerSyncAction, BrokerSyncProgressCard,
//    useVaultPassphraseMode, BrokerVaultUnlock, BrokerCredentialForm move here unchanged...

export function BrokerSettings() {
  const [unreadableBrokers, setUnreadableBrokers] = useState<Array<"ibkr" | "trading212">>([]);
  const [storageProblem, setStorageProblem] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/brokers/credentials/status")
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Broker credential storage is unavailable. Try again later.");
        return (await response.json()) as { brokers?: Record<"ibkr" | "trading212", string> };
      })
      .then(({ brokers }) => {
        const unreadable = (["ibkr", "trading212"] as const).filter(
          (broker) => brokers?.[broker] === "unreadable",
        );
        setUnreadableBrokers(unreadable);
      })
      .catch((error: unknown) =>
        setStorageProblem(
          error instanceof Error ? error.message : "Broker credential storage is unavailable.",
        ),
      );
  }, []);
  const credentialProblem =
    storageProblem ??
    (unreadableBrokers.length
      ? `${unreadableBrokers.map((broker) => (broker === "ibkr" ? "IBKR" : "Trading 212")).join(" and ")} credentials cannot be read. Save new credentials below to reconnect.`
      : null);
  return (
    <div className="space-y-8">
      <BrokerVaultUnlock />
      {credentialProblem && (
        <p
          role="alert"
          className="rounded-card border border-border bg-secondary/40 p-4 text-sm leading-6 text-foreground"
        >
          {credentialProblem}
        </p>
      )}
      <BrokerSyncProgressCard />
      <div className="grid gap-5 lg:grid-cols-2">
        <BrokerSetupCard
          name="Interactive Brokers"
          eyebrow="IBKR"
          description="Use IBKR Flex Web Service. This works with daily updated reports, without a local gateway or browser login."
          fields={[
            "Flex-token",
            "Numeric Query ID",
            "Flex Query with Open Positions, Trades, Cash Report and Statement of Funds",
          ]}
          steps={[
            "Open the Interactive Brokers Client Portal.",
            "Go to Performance & Reports → Flex Queries.",
            "Create one query with Open Positions, Trades, Cash Report and Statement of Funds.",
            "Save the query and note the numeric Query ID.",
            "Go to Flex Web Service and generate a token. Note the token immediately; IBKR only shows it briefly.",
          ]}
        />
        <BrokerSetupCard
          name="Trading 212"
          eyebrow="Trading 212"
          description="Use the official Trading 212 API. LaVega reads positions, orders, transactions and dividends through your own credentials, and never writes."
          fields={["API key", "API secret"]}
          steps={[
            "Open the Trading 212 app and go to Menu → Settings → API (Beta).",
            "Create the key on an Invest or Stocks ISA account. The API does not work on any other account type.",
            "Enable exactly five permissions: Account data, History – Dividends, History – Orders, History – Transactions, Portfolio.",
            "Leave Orders – Execute and Pies – Write off. LaVega has no code that trades.",
            "Copy both the API key and the API secret. The secret is shown once — without it nothing authenticates.",
          ]}
          warning="Those five are one per endpoint LaVega reads. A missing one does not fail at setup: it surfaces later as HTTP 403 on the first sync."
        />
      </div>
      <BrokerCredentialForm
        onSaved={(broker) =>
          setUnreadableBrokers((current) => current.filter((item) => item !== broker))
        }
      />
      <BrokerSyncAction />
      <p className="rounded-card border border-border bg-secondary/40 p-4 text-sm leading-6 text-muted-foreground">
        Credentials stay on your machine. Never share Flex tokens, API keys or API secrets in chat,
        screenshots, issues or git.
      </p>
    </div>
  );
}
```

- [ ] **Step 17: Remove the moved code from `app.tsx`**

Delete `SYNC_BACKGROUND_MESSAGE`, `otherBrokerUnconfigured`, `BrokerSetupCard`, `BrokerSyncAction`, `BrokerSyncProgressCard`, `useVaultPassphraseMode`, `BrokerVaultUnlock`, `BrokerCredentialForm`, and `BrokerConnect` from `app.tsx` (their old line ranges: 55, 57-60, 1157-1206, 1208-1259, 1261-1313, 1320-1339, 1341-1453, 1455-1624, 1626-1725). Do not remove the `App()` route for `/brokers/connect` yet — Task 3 replaces it with a redirect.

- [ ] **Step 18: Typecheck and run the affected suites**

Run: `pnpm --filter @lavega/investing-web typecheck`
Expected: FAIL at this point — `app.tsx`'s `App()` still references `<BrokerConnect />` on the `/brokers/connect` route. Change that one line to `<BrokerSettings />` (import it from `./components/BrokerSettings.js`) as a temporary bridge; Task 3's Step 6 replaces this route with the real redirect.

Run: `pnpm --filter @lavega/investing-web typecheck`
Expected: PASS.

- [ ] **Step 19: Commit**

```bash
git add apps/investing-web/src/components/BrokerSettings.tsx apps/investing-web/src/app.tsx
git commit -m "refactor(investing-web): extract BrokerSettings from app.tsx"
```

- [ ] **Step 20: Move the broker-connect tests out of `app.test.tsx`**

Move these 11 tests from `apps/investing-web/src/app.test.tsx` into a new `apps/investing-web/src/components/Profile.test.tsx` (created in Step 25), changing only the mounted route and the imported component: `<MemoryRouter initialEntries={["/brokers/connect"]}><App /></MemoryRouter>` becomes `<MemoryRouter initialEntries={["/profile"]}><App /></MemoryRouter>` in each one (still going through the real `<App />`, since `RequireAuth`/session handling must still be exercised) — nothing else in any of these test bodies changes:

1. `"connect broker opens setup guide with IBKR instructions"` (currently line 1483) — additionally change its trigger from clicking `a[href="/brokers/connect"]` to clicking the header's profile link (`a[href="/profile"]`), since the Overview page no longer carries a "Connect broker" shortcut once the shell redesign (Task 3) lands. Move this one last, after Task 3, since it depends on the new header shape — leave a `// TODO(Task 3): update once the profile button exists` comment for now and do not move it yet.
2. `"connect broker names an unreadable broker and offers reconnect"` (line 1518)
3. `"broker setup starts forced sync and shows returned problems"` (line 1589)
4. `"broker credential form stores IBKR credentials and starts sync"` (line 1631)
5. `"locked broker vault can be unlocked without entering broker credentials again"` (line 1691)
6. `"broker sync progress shows exact pages, orders, and provider wait"` (line 1747)
7. `"broker credential form succeeds when the other broker is not configured"` (line 1797)
8. `"a broker sync that outlives the edge timeout reports background progress, not a parser error"` (line 1893)
9. `"a server-key vault asks for no passphrase and does not claim the key is the user's"` (line 1948)
10. `"the Trading 212 card names the exact permissions the key needs"` (line 2279)
11. `"Trading 212 requires both halves of the key pair"` (line 2324)

Also move `responseFor`/`emptyResponseFor`/`withAuthUnconfigured` (or re-export them) so `Profile.test.tsx` can share the same fetch-mocking helpers as `app.test.tsx` — extract them into a new `apps/investing-web/src/test/fetchFixtures.ts` and import from both files, rather than duplicating the fixture bodies.

- [ ] **Step 21: Write the failing Profile page test (Brokers section)**

```tsx
// apps/investing-web/src/components/Profile.test.tsx (top of file, before the moved broker tests)
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "../app.js";
import { responseFor, withAuthUnconfigured } from "../test/fetchFixtures.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => vi.restoreAllMocks());

test("profile page lists brokers, modules, widgets and account sections", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(responseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Brokers");
  expect(container.textContent).toContain("Connect broker");
  expect(container.textContent).toContain("Modules");
  expect(container.textContent).toContain("Widgets");
  expect(container.textContent).toContain("Account");
  root.unmount();
});

test("account section shows the sign-in email and a sign-out control", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(JSON.stringify({ modules: {}, widgets: {} }))
            : responseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector("button")?.textContent).not.toBeNull();
  expect(container.textContent).toContain("Sign out");
  root.unmount();
});
```

Note: `withAuthUnconfigured` in these fixture tests always returns 503 for `/api/auth/get-session`, so `Profile`'s account section renders its "authentication not configured" copy rather than an email — Step 22 below accounts for both states.

- [ ] **Step 22: Run it to verify it fails**

Run: `pnpm --filter @lavega/investing-web test -- src/components/Profile.test.tsx -t "profile page lists"`
Expected: FAIL — `Cannot find module "../app.js"` resolves, but the `/profile` route does not exist yet (`App()` has no such `<Route>`), so the test renders nothing matching.

- [ ] **Step 23: Extract the shared fetch fixtures**

```ts
// apps/investing-web/src/test/fetchFixtures.ts
// Moved verbatim from app.test.tsx: withAuthUnconfigured, responseFor,
// emptyResponseFor, and the dashboard/portfolioSummary/portfolioAgents/
// agentInsight/agentConversation fixture objects they close over.
```

Update `app.test.tsx` to `import { responseFor, emptyResponseFor, withAuthUnconfigured } from "./test/fetchFixtures.js";` and delete the now-duplicated definitions from `app.test.tsx` itself.

- [ ] **Step 24: Implement `Profile`**

```tsx
// apps/investing-web/src/components/Profile.tsx
import { useEffect, useState } from "react";
import { getSession, signOut, type SessionState } from "../lib/auth-client.js";
import { useInvestingLayout } from "../lib/layoutResource.js";
import { PERSONAL_URL } from "../lib/personal.js";
import { BrokerSettings } from "./BrokerSettings.js";
import { LayoutPicker } from "./LayoutPicker.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import type { InvestingModuleId } from "@lavega/core";

/* Everything that is a setting rather than a place to work: broker
 * credentials, which tabs and which Overview cards are switched on, and the
 * account. Reached from the profile button in the top bar (Task 3) and from
 * the redirects at /brokers/connect and "Add widget". */

function AccountSection() {
  const [state, setState] = useState<SessionState | "loading">("loading");
  useEffect(() => {
    let current = true;
    void getSession().then((next) => current && setState(next));
    return () => {
      current = false;
    };
  }, []);
  return (
    <Card as="section" id="account" aria-label="Account">
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {state === "loading" ? null : state.status === "unconfigured" ? (
          <p className="text-muted-foreground">Authentication is not configured on this server.</p>
        ) : state.status === "anonymous" ? (
          <p className="text-muted-foreground">Not signed in.</p>
        ) : (
          <p>{state.user.email}</p>
        )}
        <div className="flex items-center gap-4">
          <Button type="button" variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
          {PERSONAL_URL && (
            <a href={PERSONAL_URL} className="text-sm font-semibold text-primary hover:underline">
              Go to LaVega Personal
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function Profile() {
  const layout = useInvestingLayout();

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <div className="space-y-6">
      <Card as="section" id="brokers" aria-label="Brokers">
        <CardHeader>
          <CardTitle>Brokers</CardTitle>
        </CardHeader>
        <CardContent>
          <BrokerSettings />
        </CardContent>
      </Card>

      <Card as="section" id="modules" aria-label="Modules">
        <CardHeader>
          <CardTitle>Modules</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Choose which tabs appear in the top bar.
          </p>
          <LayoutPicker
            kind="module"
            enabled={layout.modules}
            onChange={(next: InvestingModuleId[]) => {
              const record: Partial<Record<InvestingModuleId, boolean>> = {};
              for (const id of ["positions", "net-worth", "agents"] as const)
                record[id] = next.includes(id);
              layout.setModules(record);
            }}
          />
        </CardContent>
      </Card>

      <Card as="section" id="widgets" aria-label="Widgets">
        <CardHeader>
          <CardTitle>Widgets</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Choose which cards appear on Overview.
          </p>
          <LayoutPicker
            kind="widget"
            enabled={layout.widgets}
            onChange={(next) => {
              const record: Partial<Record<(typeof next)[number], boolean>> = {};
              for (const id of [
                "performance",
                "allocation",
                "kpis",
                "risk",
                "sectors",
                "agent",
              ] as const)
                record[id] = next.includes(id);
              layout.setWidgets(record);
            }}
          />
        </CardContent>
      </Card>

      <AccountSection />
    </div>
  );
}
```

`Card`'s shadcn implementation renders a `<div>` by default; check `apps/investing-web/src/components/ui/card.tsx` for whether it accepts an `as`/`asChild` prop. If it does not, drop `as="section"` and wrap each `<Card>` in a plain `<section id="..." aria-label="...">` instead — keep the `id` attributes either way, since Step 24's hash-scroll and the `/brokers/connect` redirect (Task 3) both depend on them.

- [ ] **Step 25: Run the Profile tests**

Run: `pnpm --filter @lavega/investing-web test -- src/components/Profile.test.tsx`
Expected: FAIL still on the moved broker tests, because `/profile` is not yet a route — this is expected; Task 3 Step 6 adds it. Confirm the failure is specifically "no route matched" / empty container, not a Profile-component error, by running just the two new tests:

Run: `pnpm --filter @lavega/investing-web test -- src/components/Profile.test.tsx -t "profile page lists"`
Expected: still FAIL for the same reason — leave it red at the end of this task; Task 3 Step 7 turns it green. Record this explicitly in the task's final commit message so the red test is not mistaken for a regression.

- [ ] **Step 26: Commit**

```bash
git add apps/investing-web/src/components/Profile.tsx apps/investing-web/src/components/Profile.test.tsx apps/investing-web/src/test/fetchFixtures.ts apps/investing-web/src/app.test.tsx
git commit -m "feat(investing-web): add Profile page (Brokers/Modules/Widgets/Account)

Profile.test.tsx is red until Task 3 adds the /profile route."
```

---

### Task 3: Shell — full width, top bar tabs, module-gated routes, new list pages

**Files:**
- Modify: `apps/investing-web/src/app.tsx:1774-1884` (`Layout`), `:2363-2383` (`App`)
- Modify: `apps/investing-web/src/app.test.tsx` (route/nav tests; finish moving the deferred test from Task 2 Step 20)
- Create: `apps/investing-web/src/components/AgentsList.tsx`
- Create: `apps/investing-web/src/components/AgentsList.test.tsx`
- Create: `apps/investing-web/src/components/NetWorthPage.tsx`
- Create: `apps/investing-web/src/components/NetWorthPage.test.tsx`

**Interfaces:**
- Consumes: `useInvestingLayout`, `HOME_MODULE`, `MODULES`, `investingModulePath` (Task 2); `Profile` (Task 2); `useAgentCatalog`, `AgentCatalogProblem` (existing, `apps/investing-web/src/lib/portfolioAgents.ts` / `app.tsx`); `useDashboard`, `NetWorthChart`, `DashboardLoading`, `DashboardError` (existing).
- Produces: `<ModuleRoute moduleId="positions" | "net-worth" | "agents">{children}</ModuleRoute>` (route guard, local to `app.tsx`, not exported — Task 4 does not need it since Overview is always reachable).
- Produces routes: `/net-worth`, `/agents` (list), `/profile`; `/brokers/connect` becomes `<Navigate to="/profile#brokers" replace />`.

- [ ] **Step 1: Write the failing shell tests**

```tsx
// apps/investing-web/src/app.test.tsx — add near the other Layout/nav tests
test("the shell has no max-width frame", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(emptyResponseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
  });
  expect(container.querySelector(".max-w-6xl")).toBeNull();
  root.unmount();
});

test("a disabled module's route redirects to Overview instead of rendering", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(JSON.stringify({ modules: { agents: false }, widgets: {} }))
            : emptyResponseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/agents"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('nav[aria-label="Main navigation"] a[href="/agents"]')).toBeNull();
  expect(container.textContent).not.toContain("Agents unavailable");
  root.unmount();
});

test("a deep link to a disabled module's detail route also redirects home", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(JSON.stringify({ modules: { positions: false }, widgets: {} }))
            : emptyResponseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions/ASML"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).not.toContain("Position detail");
  root.unmount();
});

test("a user who switched off every module except Overview still gets a working shell", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(
                JSON.stringify({
                  modules: { positions: false, "net-worth": false, agents: false },
                  widgets: {},
                }),
              )
            : responseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  const tabs = Array.from(
    container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main navigation"] a'),
  );
  expect(tabs).toHaveLength(1);
  expect(tabs[0]?.textContent).toBe("Overview");
  expect(container.textContent).toContain("Portfolio value");
  root.unmount();
});

test("/brokers/connect redirects to the profile page's brokers section", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(emptyResponseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/brokers/connect"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Brokers");
  expect(container.textContent).toContain("Connect broker");
  root.unmount();
});

test("layout GET failing does not blank the shell — it renders with defaults", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response("", { status: 500 })
            : responseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  const tabs = Array.from(
    container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main navigation"] a'),
  );
  expect(tabs.map((a) => a.textContent)).toEqual(["Overview", "Positions", "Net worth", "Agents"]);
  expect(container.textContent).toContain("Portfolio value");
  root.unmount();
});

test("/net-worth renders the net-worth chart", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(responseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/net-worth"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('[role="group"][aria-label="Choose net worth period"]')).not.toBeNull();
  root.unmount();
});

test("/agents lists every portfolio agent and links to its conversation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(responseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/agents"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Bill Ackman");
  expect(container.querySelector('a[href="/agents/bill_ackman"]')).not.toBeNull();
  root.unmount();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lavega/investing-web test -- src/app.test.tsx -t "shell\|disabled module\|net-worth\|redirects to the profile\|blank the shell\|lists every portfolio agent"`
Expected: FAIL — `/net-worth`, `/agents` list, `/profile` redirect, module gating, and full-width all fail against the current `app.tsx`.

- [ ] **Step 3: Build `NetWorthPage` and `AgentsList`**

```tsx
// apps/investing-web/src/components/NetWorthPage.tsx
import { useDashboard } from "../lib/dashboardResource.js";
import { NetWorthChart } from "./NetWorthChart.js";
import { EmptyState } from "./EmptyState.js";

function Loading() {
  return (
    <div
      role="status"
      className="rounded-card border border-border bg-secondary/30 p-6 text-sm text-muted-foreground"
    >
      Loading dashboard…
    </div>
  );
}

export function NetWorthPage() {
  const state = useDashboard();
  if (state.status === "loading") return <Loading />;
  if (state.status === "error")
    return <EmptyState title="Dashboard unavailable" description={state.message} />;
  return (
    <NetWorthChart data={state.data.portfolio} currency={state.data.presentationCurrency} />
  );
}
```

```tsx
// apps/investing-web/src/components/AgentsList.tsx
import { Link } from "react-router-dom";
import { useAgentCatalog } from "../lib/portfolioAgents.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";
import { Button } from "./ui/button.js";

export function AgentsList() {
  const { catalog, reload } = useAgentCatalog();
  if (catalog.status === "loading")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading agents…
      </p>
    );
  if (catalog.status === "error" || catalog.status === "empty")
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agents unavailable</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-sm text-negative">
            {catalog.status === "error" ? catalog.message : "No portfolio agents available."}
          </p>
          <Button type="button" variant="outline" className="mt-3" onClick={reload}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {catalog.agents.map((agent) => (
        <Link
          key={agent.id}
          to={`/agents/${agent.id}`}
          className="pressable rounded-card border border-border bg-card p-5 shadow-sm hover:bg-secondary/40"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Agent</p>
          <h3 className="mt-1 font-display text-2xl font-semibold">{agent.displayName}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{agent.investingStyle}</p>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `Layout` for full width and dynamic tabs**

```tsx
// apps/investing-web/src/app.tsx:1774-1884 — replace Layout entirely
function ModuleRoute({
  moduleId,
  children,
}: {
  moduleId: Exclude<ReturnType<typeof useInvestingLayout>["modules"][number], typeof HOME_MODULE>;
  children: React.ReactNode;
}) {
  const layout = useInvestingLayout();
  if (!layout.modules.includes(moduleId)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const layout = useInvestingLayout();
  const detail = location.pathname.startsWith("/positions/");
  const positionsList = location.pathname === "/positions";
  const agentView = location.pathname.startsWith("/agents/");
  const isProfile = location.pathname === "/profile";
  const isOverview = location.pathname === "/";
  return (
    <div className="min-h-screen p-3 sm:p-6">
      <div className="mx-auto min-h-[calc(100vh-1.5rem)] overflow-hidden rounded-frame bg-background shadow-float sm:min-h-[calc(100vh-3rem)]">
        <header className="flex flex-col gap-6 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Link to="/" className="pressable group">
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
              LaVega
            </span>
            <h1 className="font-display text-3xl font-semibold leading-none">Investing</h1>
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-1 rounded-pill bg-secondary p-1"
          >
            {layout.modules.map((id) => (
              <NavLink
                key={id}
                to={investingModulePath(id)}
                end={id === HOME_MODULE}
                className={({ isActive }) =>
                  `rounded-pill px-4 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`
                }
              >
                {MODULES.find((m) => m.id === id)?.label ?? id}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {isOverview && (
              <button
                type="button"
                onClick={() => navigate("/profile#widgets")}
                className="pressable rounded-pill border border-border bg-card px-3 py-2 text-xs font-semibold transition-colors hover:bg-secondary"
              >
                <span aria-hidden="true">+</span> Add widget
              </button>
            )}
            {PERSONAL_URL && (
              <a
                href={PERSONAL_URL}
                className="flex items-center gap-2 rounded-pill px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M19 12H5" />
                  <path d="m12 19-7-7 7-7" />
                </svg>
                <span>Personal</span>
              </a>
            )}
            <Link
              to="/profile"
              aria-label="Profile"
              className={`pressable flex size-9 items-center justify-center rounded-pill border border-border transition-colors hover:bg-secondary ${isProfile ? "bg-secondary" : ""}`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8.5" r="3.5" />
                <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
              </svg>
            </Link>
          </div>
        </header>
        <main className="px-5 py-8 sm:px-8 sm:py-12">
          {!isProfile && (
            <div className="mb-8 flex items-end justify-between gap-4">
              <div>
                <p className="mb-2 text-sm font-medium text-primary">
                  {detail
                    ? "Position detail"
                    : agentView
                      ? "Agent conversation"
                      : positionsList
                        ? "Positions"
                        : location.pathname === "/net-worth"
                          ? "Net worth"
                          : location.pathname === "/agents"
                            ? "Agents"
                            : "Your financial overview"}
                </p>
                <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
                  {detail
                    ? "Position"
                    : agentView
                      ? "Agent"
                      : positionsList
                        ? "Positions"
                        : location.pathname === "/net-worth"
                          ? "Net worth"
                          : location.pathname === "/agents"
                            ? "Agents"
                            : "Overview"}
                </h2>
              </div>
            </div>
          )}
          <Outlet />
        </main>
        <footer className="flex items-center justify-between border-t border-border px-5 py-5 text-xs text-muted-foreground sm:px-8">
          <span role="status">
            <HealthStatus />
          </span>
        </footer>
      </div>
    </div>
  );
}
```

Notes on this rewrite: the outer wrapper drops `max-w-6xl` (spec §1); the pill nav is generated from `layout.modules` instead of two hardcoded `NavLink`s; "Connect broker" no longer appears as a per-page shortcut (Brokers now lives on Profile, reached via the profile button — this removes the assumption Task 2 Step 20's first deferred test was written against); "Sign out" moves out of the footer (it is now in `Profile`'s Account section, Task 2); the footer keeps only `HealthStatus`, matching spec §1 ("the health status stays where it is useful"). Add `Navigate` to the existing `react-router-dom` import, and `HOME_MODULE`, `MODULES`, `investingModulePath` plus `useInvestingLayout` to the existing local imports at the top of `app.tsx`.

- [ ] **Step 5: Finish the deferred test from Task 2**

```tsx
// apps/investing-web/src/app.test.tsx — replace the body of
// "connect broker opens setup guide with IBKR instructions"
test("connect broker opens setup guide with IBKR instructions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
  });
  const profileLink = container.querySelector<HTMLAnchorElement>('a[href="/profile"]');
  expect(profileLink).not.toBeNull();

  await act(async () => {
    profileLink?.click();
  });
  expect(container.textContent).toContain("Connect broker");
  expect(container.textContent).toContain("Interactive Brokers");
  expect(container.textContent).toContain("Flex Web Service");
  expect(container.textContent).toContain("Trading 212");
  expect(container.textContent).toContain("Flex-token");
  expect(container.textContent).toContain("Cash Report");
  expect(container.textContent).toContain("Statement of Funds");
  root.unmount();
});
```

Move this test's body into `Profile.test.tsx` alongside the other moved broker tests (it now belongs there, not in `app.test.tsx`), and delete it from `app.test.tsx`.

- [ ] **Step 6: Rewrite the route table in `App`**

```tsx
// apps/investing-web/src/app.tsx:2363-2383 — replace App entirely
export function App() {
  return (
    <Routes>
      <Route path="/sign-up" element={<AuthForm mode="sign-up" />} />
      <Route path="/sign-in" element={<AuthForm mode="sign-in" />} />
      <Route path="/check-email" element={<CheckEmailPage />} />
      <Route path="/email-confirmed" element={<EmailConfirmedPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Overview />} />
          <Route
            path="/positions"
            element={
              <ModuleRoute moduleId="positions">
                <Positions />
              </ModuleRoute>
            }
          />
          <Route
            path="/positions/:symbol"
            element={
              <ModuleRoute moduleId="positions">
                <PositionDetail />
              </ModuleRoute>
            }
          />
          <Route
            path="/net-worth"
            element={
              <ModuleRoute moduleId="net-worth">
                <NetWorthPage />
              </ModuleRoute>
            }
          />
          <Route
            path="/agents"
            element={
              <ModuleRoute moduleId="agents">
                <AgentsList />
              </ModuleRoute>
            }
          />
          <Route
            path="/agents/:agentId"
            element={
              <ModuleRoute moduleId="agents">
                <AgentView />
              </ModuleRoute>
            }
          />
          <Route path="/profile" element={<Profile />} />
          <Route path="/brokers/connect" element={<Navigate to="/profile#brokers" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
```

Add imports at the top of `app.tsx`: `import { NetWorthPage } from "./components/NetWorthPage.js";`, `import { AgentsList } from "./components/AgentsList.js";`, `import { Profile } from "./components/Profile.js";`, `import { HOME_MODULE, MODULES, investingModulePath } from "./lib/investingRegistry.js";`, `import { useInvestingLayout } from "./lib/layoutResource.js";`.

- [ ] **Step 7: Run every test touched by this task**

Run: `pnpm --filter @lavega/investing-web test -- src/app.test.tsx`
Expected: PASS — including the shell tests from Step 1 and the previously-red `/brokers/connect` and "connect broker" tests.

Run: `pnpm --filter @lavega/investing-web test -- src/components/Profile.test.tsx`
Expected: PASS — all 13 tests (2 new + 11 moved), now that `/profile` exists.

Run: `pnpm --filter @lavega/investing-web test`
Expected: PASS — full suite. Note that the "overview preserves responsive reading order" test at `app.test.tsx:663` and the `PortfolioSummaryCard`/sector tests are expected to still be red at the end of this task; Task 4 fixes them (Overview's JSX only removes `NetWorthChart`/`PositionList` in this task's Step 4 rewrite — actually verify: **Step 4 above does not touch `Overview`'s body**, only `Layout`'s. Overview's own edit is Task 4's Step 3. Confirm `Overview` in `app.tsx` is unchanged after this task by diffing — if `pnpm --filter @lavega/investing-web test` shows `app.test.tsx:663` still green at this point, that is expected and correct; it turns red only once Task 4 removes `NetWorthChart`/`PositionList` from `Overview` in the next task.

- [ ] **Step 8: Typecheck and lint**

Run: `pnpm --filter @lavega/investing-web typecheck`
Expected: PASS.

Run: `pnpm oxlint . --max-warnings 101`
Expected: PASS with the same warning count as before this task started (95) — the new files in this task use only declared-safe classes (`rounded-pill`, `rounded-card`, `border-border`, `bg-secondary`, `bg-card`, `text-muted-foreground`, `shadow-sm`, `tracking-wide`); none introduce `rounded-[Npx]`, `tracking-[.Nem]`, `shadow-soft`, or `shadow-float`.

- [ ] **Step 9: Commit**

```bash
git add apps/investing-web/src/app.tsx apps/investing-web/src/app.test.tsx apps/investing-web/src/components/AgentsList.tsx apps/investing-web/src/components/AgentsList.test.tsx apps/investing-web/src/components/NetWorthPage.tsx apps/investing-web/src/components/NetWorthPage.test.tsx apps/investing-web/src/components/Profile.test.tsx
git commit -m "feat(investing-web): full-width shell, dynamic tabs, module-gated routes"
```

---

### Task 4: Overview as a widget grid

**Files:**
- Modify: `apps/investing-web/src/app.tsx:1929-2001` (`Overview`)
- Modify: `apps/investing-web/src/app.test.tsx` (rewrite the order test at line 663; the sector assertion is removed as part of Step 6 below)
- Modify: `apps/investing-web/src/components/PortfolioSummaryCard.tsx:75` (rename `data-dashboard-section`, remove the sector block)
- Modify: `apps/investing-web/src/components/PortfolioSummaryCard.test.tsx` (remove the sector assertions)
- Create: `apps/investing-web/src/components/SectorAllocationCard.tsx`
- Create: `apps/investing-web/src/components/SectorAllocationCard.test.tsx`

**Interfaces:**
- Consumes: `useInvestingLayout`, `WIDGETS` (Task 2); `usePortfolioSummary`, `PortfolioSummary` (existing, `apps/investing-web/src/lib/summaryResource.ts`).
- Produces: `<SectorAllocationCard currency={string} revision={string} />` — a `Card` with `data-dashboard-section="sectors"`, its own `usePortfolioSummary` fetch (sectors are independent of the risk period/benchmark selector `PortfolioSummaryCard` owns, so this is a second, independent read of `/api/investing/summary`, not a shared cache — each widget can be hidden independently and must not depend on its neighbor being mounted).
- No change to `PortfolioSummaryCard`'s public props; only its rendered `data-dashboard-section` value (`"summary"` → `"risk"`) and its content (sector block removed).

- [ ] **Step 1: Write the failing `SectorAllocationCard` test**

```tsx
// apps/investing-web/src/components/SectorAllocationCard.test.tsx
// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { SectorAllocationCard } from "./SectorAllocationCard.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

const summary = {
  metrics: {
    dailyVolatility: 0.01,
    annualizedVolatility: 0.1587,
    beta: 1.1,
    alpha: 0.02,
    maxDrawdown: -0.25,
    observationDays: 252,
    excludedIntervals: 0,
    pairedObservationDays: 252,
    startDate: "2025-09-10",
    endDate: "2026-09-10",
  },
  risk: {
    status: "estimate",
    range: "1Y",
    from: "2025-09-10",
    to: "2026-09-10",
    drawdownFrom: null,
    minimumObservations: 60,
    benchmark: null,
    benchmarks: [],
    reasons: [],
    missingHoldings: [],
    missingPrices: [],
    coverage: 1,
    currency: "EUR",
  },
  sectors: [
    { sector: "Technology", weight: 0.6 },
    { sector: "Unknown", weight: 0.4 },
  ],
  topPositions: [],
};

test("renders sector bars from the summary endpoint", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(summary), { status: 200 })),
  );
  const { container, root } = render();
  act(() => root.render(<SectorAllocationCard />));
  await act(async () => {});
  expect(container.textContent).toContain("Technology");
  expect(container.querySelector('[data-dashboard-section="sectors"]')).not.toBeNull();
  expect(container.querySelectorAll('[aria-label="Sector allocation"] li')).toHaveLength(2);
});

test("no sector data yet reads as an honest empty state, not a broken card", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ ...summary, sectors: [] }), { status: 200 }),
    ),
  );
  const { container, root } = render();
  act(() => root.render(<SectorAllocationCard />));
  await act(async () => {});
  expect(container.textContent).toContain("No sector data yet.");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @lavega/investing-web test -- src/components/SectorAllocationCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SectorAllocationCard`**

```tsx
// apps/investing-web/src/components/SectorAllocationCard.tsx
import { usePortfolioSummary } from "../lib/summaryResource.js";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.js";

const barColors = [
  "hsl(var(--chart-blue))",
  "hsl(var(--chart-teal))",
  "hsl(var(--chart-purple))",
  "hsl(var(--chart-amber))",
  "hsl(var(--chart-coral))",
];

const percent = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "Unavailable"
    : value.toLocaleString("en-GB", { style: "percent", maximumFractionDigits: 1 });

/** Independent of PortfolioSummaryCard's risk-period/benchmark selector —
 *  sector exposure is computed from current positions regardless of range or
 *  benchmark (see apps/investing-server/src/app.ts's /api/investing/summary
 *  route), so this fetches with a fixed range and no benchmark. It is a
 *  second read of the same endpoint rather than shared state: this card and
 *  "Risk & composition" are independently hideable widgets, and neither may
 *  depend on the other being mounted to have data. */
export function SectorAllocationCard({
  currency,
  revision = "",
}: {
  currency?: string;
  revision?: string;
}) {
  const { state } = usePortfolioSummary("1Y", "", revision);
  if (state.status === "loading")
    return (
      <Card aria-busy="true" data-dashboard-section="sectors">
        <CardContent>
          <p className="p-5 text-sm text-muted-foreground">Loading sectors…</p>
        </CardContent>
      </Card>
    );
  if (state.status === "error")
    return (
      <Card role="alert" data-dashboard-section="sectors">
        <CardContent>
          <p className="p-5 text-sm text-muted-foreground">{state.message}</p>
        </CardContent>
      </Card>
    );
  const { sectors } = state.data;
  return (
    <Card data-dashboard-section="sectors">
      <CardHeader>
        <p className="text-sm font-medium text-muted-foreground">Composition</p>
        <CardTitle className="text-xl">Sector allocation</CardTitle>
      </CardHeader>
      <CardContent>
        <ul aria-label="Sector allocation" className="space-y-2">
          {sectors.length === 0 && (
            <li className="text-sm text-muted-foreground">No sector data yet.</li>
          )}
          {sectors.map((sector, index) => (
            <li key={sector.sector}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{sector.sector}</span>
                <span className="font-semibold tabular-nums">{percent(sector.weight)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  aria-hidden="true"
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, sector.weight * 100)}%`,
                    backgroundColor: barColors[index % barColors.length],
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
        {currency && <p className="mt-3 text-xs text-muted-foreground">Amounts in {currency}.</p>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lavega/investing-web test -- src/components/SectorAllocationCard.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/investing-web/src/components/SectorAllocationCard.tsx apps/investing-web/src/components/SectorAllocationCard.test.tsx
git commit -m "feat(investing-web): extract SectorAllocationCard from PortfolioSummaryCard"
```

- [ ] **Step 6: Remove the sector section from `PortfolioSummaryCard`, rename its section id**

```tsx
// apps/investing-web/src/components/PortfolioSummaryCard.tsx:75 — rename
<Card aria-label="Portfolio summary" data-dashboard-section="risk">
```

Delete the `<div>` block starting at `<p className="mb-2 text-xs font-medium text-muted-foreground">Sector allocation</p>` through its closing `</div>` (the whole "Sector allocation" list, including the now-unused `barColors` constant and the `sectors` destructure from `state.data` on line 61 — change `const { metrics, sectors, topPositions, risk, composition } = state.data;` to `const { metrics, topPositions, risk, composition } = state.data;`).

```tsx
// apps/investing-web/src/components/PortfolioSummaryCard.test.tsx — trim the summary fixture's
// unused destructure is fine to leave (sectors stays in PortfolioSummary's type), but update:
test("renders metrics, top positions, and sector bars", async () => {
  // rename to: test("renders metrics and top positions", ...)
  // delete: expect(container.textContent).toContain("Technology");
  // delete: expect(container.querySelectorAll('[aria-label="Sector allocation"] li')).toHaveLength(2);
});
```

- [ ] **Step 7: Run `PortfolioSummaryCard`'s tests**

Run: `pnpm --filter @lavega/investing-web test -- src/components/PortfolioSummaryCard.test.tsx`
Expected: PASS — the renamed test and every other existing assertion in the file still pass; only the two sector-specific lines are gone.

- [ ] **Step 8: Commit**

```bash
git add apps/investing-web/src/components/PortfolioSummaryCard.tsx apps/investing-web/src/components/PortfolioSummaryCard.test.tsx
git commit -m "refactor(investing-web): move sector allocation out of PortfolioSummaryCard"
```

- [ ] **Step 9: Write the failing Overview widget-grid tests**

```tsx
// apps/investing-web/src/app.test.tsx:663-722 — replace the whole test with two smaller ones
test("overview renders widgets in registry order and excludes positions and net worth", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(responseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  const order = Array.from(
    container.querySelectorAll<HTMLElement>("[data-dashboard-section]"),
  ).map((element) => element.dataset.dashboardSection);
  expect(order).toEqual(["status", "performance", "allocation", "kpis", "risk", "sectors", "agent"]);
  expect(container.querySelector('[data-dashboard-section="positions"]')).toBeNull();
  expect(container.querySelector('[data-dashboard-section="net-worth"]')).toBeNull();

  const riskCard = container.querySelector<HTMLElement>('[data-dashboard-section="risk"]')!;
  expect(riskCard.textContent).toContain("Historical account risk");
  expect(riskCard.textContent).toContain("Largest positions");
  expect(riskCard.textContent).not.toContain("Sector allocation");
  root.unmount();
});

test("hiding a widget closes its gap instead of leaving a blank card", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(JSON.stringify({ modules: {}, widgets: { allocation: false } }))
            : responseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('[data-dashboard-section="allocation"]')).toBeNull();
  const order = Array.from(
    container.querySelectorAll<HTMLElement>("[data-dashboard-section]"),
  ).map((element) => element.dataset.dashboardSection);
  expect(order).toEqual(["status", "performance", "kpis", "risk", "sectors", "agent"]);
  root.unmount();
});

test("switching off every widget shows one line and an Add widget button, not a blank page", async () => {
  const allOff = {
    modules: {},
    widgets: {
      performance: false,
      allocation: false,
      kpis: false,
      risk: false,
      sectors: false,
      agent: false,
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(JSON.stringify(allOff))
            : responseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('[data-dashboard-section="status"]')).not.toBeNull();
  expect(container.querySelector('[data-dashboard-section="performance"]')).toBeNull();
  const addWidget = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Add widget"),
  );
  expect(addWidget).toBeTruthy();
  root.unmount();
});
```

- [ ] **Step 10: Run the tests to verify they fail**

Run: `pnpm --filter @lavega/investing-web test -- src/app.test.tsx -t "overview renders widgets\|closes its gap\|Add widget button"`
Expected: FAIL — `Overview` still renders the old fixed stack (order includes `net-worth`/`positions`, `data-dashboard-section="summary"` not `"risk"`, no `sectors` section, no empty-state button).

- [ ] **Step 11: Rewrite `Overview`**

```tsx
// apps/investing-web/src/app.tsx:1929-2001 — replace Overview entirely
function OverviewEmptyState() {
  const navigate = useNavigate();
  return (
    <div className="rounded-card border border-dashed border-border bg-transparent p-10 text-center">
      <p className="text-sm text-muted-foreground">
        Every Overview card is switched off. Add one to see your portfolio here.
      </p>
      <Button
        type="button"
        className="mt-4"
        onClick={() => navigate("/profile#widgets")}
      >
        <span aria-hidden="true">+</span> Add widget
      </Button>
    </div>
  );
}

function Overview() {
  const state = useDashboard();
  const { broker, price } = useSyncSession();
  const layout = useInvestingLayout();
  const gate = historyGate(broker?.history);
  const widgets = new Set(layout.widgets);
  return (
    <div className="space-y-5">
      <AppOpenSync />
      {state.status === "loading" ? (
        <DashboardLoading />
      ) : state.status === "error" ? (
        <DashboardError message={state.message} />
      ) : gate.kind === "first-sync" ? (
        <HistoryLoading brokers={gate.brokers} />
      ) : (
        <>
          {state.refreshError && <DashboardRefreshError message={state.refreshError} />}
          <DashboardProblems problems={state.data.problems} />
          <OverviewStatusRail dataVersion={state.data.dataVersion} />
          {widgets.size === 0 ? (
            <OverviewEmptyState />
          ) : (
            <>
              <div
                className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]"
                data-dashboard-layout="overview"
              >
                <div className="min-w-0 space-y-5">
                  {widgets.has("performance") && (
                    <div data-dashboard-section="performance">
                      <PortfolioBenchmarkChart
                        data={state.data.portfolio}
                        benchmarks={state.data.benchmarks}
                        externalCashFlows={state.data.externalCashFlows}
                        currency={state.data.presentationCurrency}
                      />
                    </div>
                  )}
                  {widgets.has("allocation") && (
                    <div data-dashboard-section="allocation">
                      <AllocationDonut
                        instrument={state.data.allocation.instrument}
                        entity={state.data.allocation.entity}
                        currency={state.data.presentationCurrency}
                      />
                    </div>
                  )}
                </div>
                <aside aria-label="Portfolio overview" className="space-y-5">
                  {widgets.has("kpis") && <PortfolioKpis data={state.data} />}
                  {widgets.has("risk") && (
                    <PortfolioSummaryCard
                      stillLoading={
                        gate.updating.length > 0 ||
                        broker?.status === "running" ||
                        broker?.status === "waiting" ||
                        price?.status === "running" ||
                        price?.status === "paused" ||
                        (price?.remainingSymbols?.length ?? 0) > 0
                      }
                      currency={state.data.presentationCurrency}
                      revision={state.data.benchmarks.map((item) => item.symbol).join(",")}
                    />
                  )}
                </aside>
              </div>
              {widgets.has("sectors") && (
                <SectorAllocationCard
                  currency={state.data.presentationCurrency}
                  revision={String(state.data.dataVersion)}
                />
              )}
              {widgets.has("agent") && <PortfolioAgentCard />}
            </>
          )}
        </>
      )}
    </div>
  );
}
```

Add `import { SectorAllocationCard } from "./components/SectorAllocationCard.js";` to `app.tsx`'s imports. `PositionList` and the `<section aria-labelledby="positions-heading">` block are deleted from `Overview` entirely — `PositionList` itself stays in `app.tsx` (still used by `Positions()`).

- [ ] **Step 12: Run the widget-grid tests, then the full suite**

Run: `pnpm --filter @lavega/investing-web test -- src/app.test.tsx -t "overview renders widgets\|closes its gap\|Add widget button"`
Expected: PASS (3 tests).

Run: `pnpm --filter @lavega/investing-web test`
Expected: PASS — full suite, including `PortfolioSummaryCard.test.tsx`, `SectorAllocationCard.test.tsx`, `Profile.test.tsx`, and every test from Tasks 2–3. The agent-in-overview tests (`"overview analyses the persona the reader selected"`, `"agent choice exposes radio semantics..."`, and the two others matching `[data-dashboard-section="agent"]`) still pass unchanged, since `PortfolioAgentCard` itself did not change — only its position in `Overview`'s JSX moved from the right rail to a full-width block below.

- [ ] **Step 13: Typecheck and lint**

Run: `pnpm --filter @lavega/investing-web typecheck`
Expected: PASS.

Run: `pnpm oxlint . --max-warnings 101`
Expected: PASS at 95 warnings (unchanged) — `OverviewEmptyState` and `SectorAllocationCard` reuse `rounded-card`/`border-dashed`/`bg-secondary`/standard Tailwind spacing, no new arbitrary values.

- [ ] **Step 14: Commit**

```bash
git add apps/investing-web/src/app.tsx apps/investing-web/src/app.test.tsx
git commit -m "feat(investing-web): render Overview as a widget grid"
```

---

### Task 5: Verification and docs

**Files:**
- Modify: `docs/investing/DASHBOARD.md` (Scope section, ~lines 16-21; layout-order paragraphs, ~lines 214-220)
- Modify: `.claude/skills/verify-investing/features/README.md` (route table)
- Modify: `.claude/skills/verify-investing/features/dashboard-overview.md` (sub-features list)
- Modify: `.claude/skills/verify-investing/features/broker-connect-sync.md` (reach text)
- No source changes — this task is verification plus the feature-map correction the `verify-investing` skill's own README requires ("when a run finds it wrong, fix the map in the same change").

**Interfaces:**
- Consumes: the shipped shell from Tasks 1-4; the `verify-investing` CLI (`node .claude/skills/verify-investing/control-investing.mjs`) and its `browser` subcommand.

- [ ] **Step 1: Build the investing-web bundle and start the standalone server**

```bash
pnpm --filter @lavega/investing-web build
node .claude/skills/verify-investing/control-investing.mjs up
```

Expected: `up` prints a pid, port 8799, and a log path; `/health` answers `{"service":"investing-server"}`.

- [ ] **Step 2: Doctor and probe against the running standalone instance**

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C doctor
node $C probe --out /tmp/lavega-verify-investing/evidence/shell-probe.json
```

Expected: `doctor` exits 0; `probe`'s output shows `/api/investing/layout` answering 200 with `{"modules":{},"widgets":{}}` on a fresh data directory (no prior tenant row).

- [ ] **Step 3: Drive the shell in a real browser and prove the toggle-and-reload contract**

```bash
node $C browser open
node $C browser wait-settle
node $C browser snapshot --interactive --out /tmp/lavega-verify-investing/evidence/shell-snapshot.json
```

Read the snapshot for the profile button (`@e` ref) and click it, then find and click the "Positions" module switch to turn it off:

```bash
node $C browser click @<profile-button-ref>
node $C browser wait-settle
node $C browser snapshot --interactive --out /tmp/lavega-verify-investing/evidence/profile-snapshot.json
node $C browser click @<positions-switch-ref>
node $C browser wait-settle
node $C api GET /api/investing/layout --out /tmp/lavega-verify-investing/evidence/layout-after-toggle.json
```

Expected: `layout-after-toggle.json` shows `{"modules":{"positions":false},"widgets":{}}`.

```bash
node $C browser raw -- navigate http://127.0.0.1:8799/
node $C browser wait-settle
node $C browser snapshot --interactive --out /tmp/lavega-verify-investing/evidence/shell-after-reload.json
```

Expected: the reloaded snapshot's `nav[aria-label="Main navigation"]` no longer lists "Positions", proving the choice was read back from the server, not from browser memory. Also toggle a widget (e.g. "Sector allocation" off from `/profile#widgets`) and confirm after reload that `[data-dashboard-section="sectors"]` is absent from the Overview snapshot.

- [ ] **Step 4: Prove full width at desktop and phone**

```bash
node $C browser raw -- navigate http://127.0.0.1:8799/
node $C browser raw -- viewport 1440x900
node $C browser screenshot --png /tmp/lavega-verify-investing/evidence/shell-desktop.png
node $C browser raw -- viewport 390x844
node $C browser screenshot --png /tmp/lavega-verify-investing/evidence/shell-phone.png
```

Expected: both screenshots show the shell filling the viewport width with Personal-style gutters, no centered `max-w-6xl` card floating in a wide background.

- [ ] **Step 5: Cleanup**

```bash
node .claude/skills/verify-investing/control-investing.mjs cleanup
```

- [ ] **Step 6: Update `docs/investing/DASHBOARD.md`**

```markdown
<!-- docs/investing/DASHBOARD.md:16-21 — replace the "overview contains these views" bullet list -->
The app is a full-window shell with tabs in a top bar (Overview, and whichever of Positions, Net worth and Agents the owner has switched on) and a profile page for brokers, tabs and cards. See `docs/superpowers/specs/2026-09-28-investing-shell-design.md` for the shell's layout, module and widget model. Overview itself is a grid of independently hideable cards:

- A portfolio chart in EUR value mode or indexed-return mode.
- A compact allocation donut.
- Key figures, risk & composition, and sector allocation.
- A portfolio agent card.

The positions table and the stacked net-worth chart moved to their own tabs (`/positions`, `/net-worth`); they are no longer part of Overview.
```

```markdown
<!-- docs/investing/DASHBOARD.md:214-220 — replace the now-obsolete layout-order paragraphs -->
Overview's card order and column placement (left/right/full-width) are owned by the widget registry described in `docs/superpowers/specs/2026-09-28-investing-shell-design.md` §3-4, not by this document. The positions table and the net-worth chart are on their own tabs and are laid out by those tabs' own pages, each full width.
```

- [ ] **Step 7: Update the verify-investing feature map**

```markdown
<!-- .claude/skills/verify-investing/features/README.md — replace the intro paragraph on routes and the table -->
Every other route (`/`, `/positions`, `/positions/:symbol`, `/net-worth`, `/agents`, `/agents/:agentId`, `/profile`) sits behind `RequireAuth`. `/brokers/connect` redirects to `/profile#brokers`. The top bar's tabs are exactly the modules the tenant's stored layout enables, plus the always-on Overview tab.

| Feature                                    | Route                                                                                             | File                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------| ------------------------------------------------------- |
| Account and session                        | `/sign-in`, `/sign-up`, `/check-email`, `/email-confirmed`, `/forgot-password`, `/reset-password` | [auth-session.md](auth-session.md)                     |
| Dashboard overview                         | `/`                                                                                               | [dashboard-overview.md](dashboard-overview.md)         |
| Portfolio agents                           | `/`, `/agents`, `/agents/:agentId`                                                                 | [portfolio-agents.md](portfolio-agents.md)             |
| Profile (brokers, modules, widgets, account)| `/profile`, `/brokers/connect` (redirect)                                                         | [broker-connect-sync.md](broker-connect-sync.md)       |
| Positions and position detail              | `/positions`, `/positions/:symbol`                                                                 | [positions.md](positions.md)                           |
| Net worth                                  | `/net-worth`                                                                                       | [dashboard-overview.md](dashboard-overview.md)         |
| Prices, benchmarks and market-data consent | `/` (Vault / Cache panels)                                                                          | [prices-and-market-data.md](prices-and-market-data.md) |
```

```markdown
<!-- .claude/skills/verify-investing/features/dashboard-overview.md — replace the sub-features list -->
## Sub-features

- headline figures: `Portfolio value`, `Daily change`, `Total return`; `Value partly
unknown` when some positions are unpriced.
- portfolio chart (`Performance` widget) with window modes and a benchmark overlay.
- allocation donut (`Allocation` widget).
- KPI block (`Key figures` widget) — volatility, beta, alpha, max drawdown, from
  `/api/investing/summary`.
- risk & composition (`Risk & composition` widget) and `Sector allocation` (its own widget,
  independently hideable — see `SectorAllocationCard`).
- portfolio agents card (`Choose agent` widget) — see [portfolio-agents.md](portfolio-agents.md).
- operational status (`Operational status`) — chips `Connection`, `Brokers`,
  `Price history`, `Vault`, `Cache`. Always rendered; not a switchable widget.
- every card above can be switched off from `/profile#widgets`; switching off every
  card replaces the grid with one line and an `Add widget` button.
- degraded and empty states: `Dashboard unavailable`, `Refresh failed`, `Reading problems`,
  `Cached data remains visible`, `Still loading your history`.
- the positions table and the net-worth chart are their own tabs (`/positions`, `/net-worth`),
  not part of this view.
```

```markdown
<!-- .claude/skills/verify-investing/features/broker-connect-sync.md — update the reach text -->
Reach: `/profile#brokers` (mounted: `https://www.lavega.dev/investing/profile#brokers`), or the
profile button in the top bar. `/brokers/connect` is a redirect kept for old bookmarks.
```

- [ ] **Step 8: Commit the docs**

```bash
git add docs/investing/DASHBOARD.md .claude/skills/verify-investing/features/README.md .claude/skills/verify-investing/features/dashboard-overview.md .claude/skills/verify-investing/features/broker-connect-sync.md
git commit -m "docs(investing): update DASHBOARD.md and the verify-investing feature map for the new shell"
```

---

## Self-Review

**Spec coverage:**

- §1 Shell and navigation — width (Task 3 Step 4), top bar tabs/Personal/Add widget/profile button (Task 3 Step 4), module `defaultOn`/locked Overview (Task 2 registry), routes including `/net-worth`, `/agents`, `/profile`, `/brokers/connect` redirect (Task 3 Step 6), footer sign-out moved / health status stays (Task 2 Profile Account section, Task 3 Layout rewrite).
- §2 Profile page — Brokers/Modules/Widgets/Account in order (Task 2 Step 24).
- §3 Overview widgets — all six widgets, columns, positions/net-worth removed, gap-closing, empty state, no widget id is a module id (Task 1 registry test, Task 4).
- §4 Data model — `InvestingLayout` type, GET/PUT contract, unknown ids dropped, one registry file (Task 1, Task 2).
- §5 Testing and verification — registry tests (Task 1 Step 1, Task 2 Step 1), server persistence/validation tests (Task 1 Steps 16, 22, 27), web module/widget/redirect/empty-state tests (Task 3, Task 4), browser toggle-and-reload proof at desktop and phone widths (Task 5).
- Out of scope items (ETF sector look-through, Personal changes, shared package, widget reordering) — none touched by any task.

**Placeholder scan:** no task uses "TBD", "handle appropriately", or an unshown "similar to Task N" edit; every mechanical repeated edit (Task 2 Step 20's 11 moved tests) names each test by its exact current title and line number rather than describing the transform abstractly.

**Type consistency:** `InvestingLayout`/`InvestingLayoutSelection`/`InvestingLayoutStore` (Task 1) are the same three names used unchanged through `neonStores.ts`, `fileInvestingLayoutStore.ts`, `app.ts`, `index.ts`, and `investing-mount.ts`. `resolveModules`/`resolveWidgets`/`toggleModule`/`toggleWidget` (Task 2) keep identical signatures between `investingRegistry.ts`, its test, `layoutResource.ts`, and `LayoutPicker.tsx`. `data-dashboard-section` values (`performance`, `allocation`, `kpis`, `risk`, `sectors`, `agent`, `status`) match one-to-one with `InvestingWidgetId` plus the one non-widget `status` chrome section, checked explicitly by Task 4 Step 9's order test.

**Review Focus:** all five items listed above are each pinned by a named test in the task that owns the code (Task 1 Steps 1/27, Task 2 Steps 1/6, Task 3 Step 1). No gap found.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-28-investing-shell.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end. Runs well with a mid-tier session model, since the plan carries the design.

For this plan I recommend **subagent-driven**, because Task 2 deliberately leaves `Profile.test.tsx` red until Task 3 lands (the `/profile` route doesn't exist until then), and Task 4 renames a `data-dashboard-section` value and moves JSX that three other already-passing test blocks query by that exact selector — a fresh reviewer catching a broken cross-task dependency or a silently-passing-for-the-wrong-reason test before the next task builds on it is worth more here than in a purely additive plan. Does the plan capture what you want, and which approach should we use?
