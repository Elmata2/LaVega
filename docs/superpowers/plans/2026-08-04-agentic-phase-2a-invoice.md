# Agentic Phase 2a — Invoice (local slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the owner record incoming (AR) and outgoing (AP) invoices — by hand and by importing UBL/CSV — so the 13-week forecast sees them as _expected_ cash flows on their due dates, and auto-reconciles them against bank transactions once paid (no double-count).

**Architecture:** A new pure `Invoice` entity in `@lavega/core`. Expected invoices project into the existing `ScheduledFlow` primitive (Phase 0) via `scheduledInvoiceFlows()`, so the forecast/alerts wiring already works — App just merges invoice-derived flows with the VAT flows. `reconcileInvoices()` flips an invoice to `paid` when a matching bank Tx appears (so it stops being an expected flow). Deterministic parsers (generic invoice CSV + UBL/EN-16931 XML) follow the existing `bankCsv.ts` per-source pattern. NO LLM, NO connectors, NO network — those are Phase 2b/2c.

**Tech Stack:** TypeScript, pnpm monorepo, Vitest. `@lavega/core` (pure), `@lavega/adapters` (vault), `apps/web` (React+Vite).

## Global Constraints

- Pure/deterministic in `@lavega/core`: `asOf` passed in (no `Date.now()` in pure fns); ISO `YYYY-MM-DD` date math via `Date.UTC`; `Invoice.amount`/`vatAmount` are DECIMAL euros (same convention as `Tx.amount`), converted to integer cents only when producing a `ScheduledFlow`.
- Additive only: reuse the Phase 0 `ScheduledFlow` + `makeScheduledFlow` + the forecast's `scheduledFlows` input. Existing tests stay green.
- `Invoice.id` content-hashed via `hash()` (like `assignTxIds`/`makeScheduledFlow`).
- A `paid` or `cancelled` invoice produces NO scheduled flow (prevents double-count with the real bank Tx).
- Local-first: NO LLM, NO connectors, NO network in Phase 2a.
- Dutch UI copy. Each task ends with a commit whose message ends:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Verify with `pnpm test`, `pnpm typecheck`, `pnpm --filter @lavega/web build`.

## File Structure

- `packages/core/src/model.ts` — add `Invoice` type (modify).
- `packages/core/src/invoices.ts` — NEW: `scheduledInvoiceFlows`, `reconcileInvoices`, `makeInvoice`.
- `packages/core/src/index.ts` — export `./invoices.js` (modify).
- `packages/core/src/parsers/invoiceCsv.ts` — NEW: generic invoice CSV → `Omit<Invoice,"id">[]`.
- `packages/core/src/parsers/invoiceUbl.ts` — NEW: UBL/EN-16931 XML → `Omit<Invoice,"id">[]`.
- `packages/core/src/parsers/parseInvoiceFile.ts` — NEW: dispatch CSV vs UBL by content.
- `packages/adapters/src/storage/encryptedStorage.ts` — `getInvoices`/`putInvoices` (modify).
- `apps/web/src/views/Facturen.tsx` — NEW: manual entry + file drop + list.
- `apps/web/src/App.tsx`, `components/Sidebar.tsx`, `components/TopBar.tsx` — wire the Facturen view + merge invoice flows into the forecast (modify).

---

## Task 1: `Invoice` type + `scheduledInvoiceFlows` + `makeInvoice`

**Files:** Modify `packages/core/src/model.ts`; Create `packages/core/src/invoices.ts`, `packages/core/src/invoices.test.ts`; Modify `packages/core/src/index.ts`.

**Interfaces produced:** `Invoice` type; `makeInvoice(input: Omit<Invoice,"id">): Invoice`; `scheduledInvoiceFlows(invoices: Invoice[]): ScheduledFlow[]` (only `expected` invoices; AR→sign +1, AP→sign -1; source `"invoice"`).

- [ ] **Step 1: Failing test** — `packages/core/src/invoices.test.ts`

```ts
import { expect, test } from "vitest";
import { makeInvoice, scheduledInvoiceFlows } from "./invoices.js";
import type { Invoice } from "./model.js";

const inv = (o: Partial<Invoice>): Invoice =>
  makeInvoice({
    entity: "BV1",
    direction: "out",
    counterparty: "Leverancier",
    issueDate: "2026-08-01",
    dueDate: "2026-09-01",
    amount: 1210,
    currency: "EUR",
    status: "expected",
    sourceType: "manual",
    ...o,
  });

test("makeInvoice gives a stable content-hashed id", () => {
  expect(inv({}).id).toBe(inv({}).id);
  expect(inv({ amount: 1210 }).id).not.toBe(inv({ amount: 999 }).id);
});

test("scheduledInvoiceFlows: AP invoice -> outflow, AR -> inflow, on the due date, in cents", () => {
  const flows = scheduledInvoiceFlows([
    inv({ direction: "out", amount: 1210, dueDate: "2026-09-01" }),
    inv({ direction: "in", counterparty: "Klant", amount: 2500, dueDate: "2026-08-20" }),
  ]);
  expect(flows).toHaveLength(2);
  expect(flows[0]).toMatchObject({
    sign: -1,
    amountCents: 121000,
    dueDate: "2026-09-01",
    source: "invoice",
  });
  expect(flows[1]).toMatchObject({
    sign: 1,
    amountCents: 250000,
    dueDate: "2026-08-20",
    source: "invoice",
  });
});

test("scheduledInvoiceFlows: paid/cancelled invoices produce no flow (no double-count)", () => {
  expect(scheduledInvoiceFlows([inv({ status: "paid" }), inv({ status: "cancelled" })])).toEqual(
    [],
  );
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm vitest run packages/core/src/invoices.test.ts`.

- [ ] **Step 3: Add `Invoice` to `model.ts`**:

```ts
/** An incoming (AR: money owed TO you) or outgoing (AP: you owe) invoice. amount
 *  is DECIMAL euros (gross), Tx-convention. An `expected` invoice projects into a
 *  ScheduledFlow; `paid`/`cancelled` do not (so a paid invoice doesn't
 *  double-count with the bank transaction that settled it). */
export type Invoice = {
  id: string;
  entity: string;
  direction: "in" | "out";
  counterparty: string;
  invoiceNumber?: string;
  issueDate: string; // ISO
  dueDate: string; // ISO
  amount: number; // decimal euros (gross)
  vatAmount?: number;
  currency: string;
  status: "expected" | "paid" | "cancelled";
  matchedTxId?: string;
  sourceType: "manual" | "csv" | "ubl";
};
```

- [ ] **Step 4: Create `packages/core/src/invoices.ts`**:

```ts
import type { Invoice, ScheduledFlow, Tx } from "./model.js";
import { hash, norm } from "./hash.js";
import { makeScheduledFlow } from "./scheduledFlows.js";

/** Content-hashed id (stable across recompute, so re-import doesn't duplicate). */
export function makeInvoice(i: Omit<Invoice, "id">): Invoice {
  const id = hash(
    [
      i.entity,
      i.direction,
      i.counterparty,
      i.invoiceNumber ?? "",
      i.issueDate,
      i.dueDate,
      i.amount,
    ].join("|"),
  );
  return { ...i, id };
}

/** Expected invoices -> ScheduledFlow[] (AR inflow / AP outflow), due-dated, in cents. */
export function scheduledInvoiceFlows(invoices: Invoice[]): ScheduledFlow[] {
  return invoices
    .filter((i) => i.status === "expected")
    .map((i) =>
      makeScheduledFlow({
        entity: i.entity,
        label: `Factuur ${i.counterparty}${i.invoiceNumber ? " " + i.invoiceNumber : ""}`,
        sign: i.direction === "in" ? 1 : -1,
        amountCents: Math.round(Math.abs(i.amount) * 100),
        dueDate: i.dueDate,
        source: "invoice",
        status: "expected",
      }),
    );
}

export {}; // reconcileInvoices added in Task 2
```

- [ ] **Step 5: Export in `index.ts`** — add `export * from "./invoices.js";` after the `scheduledFlows.js` line.

- [ ] **Step 6: Run → PASS**; **Step 7: Commit** (`model.ts`, `invoices.ts`, `invoices.test.ts`, `index.ts`): `feat(core): Invoice entity + scheduledInvoiceFlows`.

---

## Task 2: `reconcileInvoices` — auto-mark paid against bank Tx

**Files:** Modify `packages/core/src/invoices.ts`; append `packages/core/src/invoices.test.ts`.

**Interfaces produced:** `reconcileInvoices(invoices: Invoice[], txs: Tx[]): Invoice[]` — for each `expected` invoice, find an UNUSED tx with matching direction (AR→`amount>0`, AP→`amount<0`), amount within tolerance `max(0.02, 1% of invoice.amount)`, `tx.date` in `[dueDate−60d, dueDate+30d]`, and counterparty overlap (`norm(tx.counterparty)` contains or is contained by `norm(invoice.counterparty)`, when both non-empty). Exactly one match → set `status:"paid"`, `matchedTxId`. Zero/multiple → unchanged. Each tx matches at most one invoice.

- [ ] **Step 1: Failing test** — append:

```ts
import { reconcileInvoices } from "./invoices.js";
import type { Tx } from "./model.js";
const tx = (id: string, date: string, amount: number, cp: string): Tx => ({
  id,
  accountKey: "A",
  date,
  amount,
  currency: "EUR",
  counterparty: cp,
  description: "",
  category: "",
  manual: false,
});

test("reconcileInvoices: an AP invoice with a matching outflow near the due date flips to paid", () => {
  const invoices = [
    inv({ direction: "out", counterparty: "Coolblue", amount: 1210, dueDate: "2026-09-01" }),
  ];
  const out = reconcileInvoices(invoices, [tx("t1", "2026-08-28", -1210, "Coolblue B.V.")]);
  expect(out[0]).toMatchObject({ status: "paid", matchedTxId: "t1" });
});

test("reconcileInvoices: no counterparty overlap or wrong sign -> stays expected", () => {
  const invoices = [
    inv({ direction: "out", counterparty: "Coolblue", amount: 1210, dueDate: "2026-09-01" }),
  ];
  expect(reconcileInvoices(invoices, [tx("t1", "2026-08-28", 1210, "Coolblue")])[0].status).toBe(
    "expected",
  ); // wrong sign
  expect(reconcileInvoices(invoices, [tx("t2", "2026-08-28", -1210, "Bol.com")])[0].status).toBe(
    "expected",
  ); // no overlap
});

test("reconcileInvoices: one tx cannot settle two invoices", () => {
  const invoices = [
    inv({ counterparty: "X", amount: 100, dueDate: "2026-09-01" }),
    inv({ counterparty: "X", amount: 100, dueDate: "2026-09-01" }),
  ];
  const out = reconcileInvoices(invoices, [tx("t1", "2026-08-30", -100, "X")]);
  expect(out.filter((i) => i.status === "paid")).toHaveLength(1);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — replace `export {};` in `invoices.ts` with:

```ts
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
function cpOverlap(a: string, b: string): boolean {
  const x = norm(a),
    y = norm(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

export function reconcileInvoices(invoices: Invoice[], txs: Tx[]): Invoice[] {
  const used = new Set<string>();
  return invoices.map((inv) => {
    if (inv.status !== "expected") return inv;
    const tol = Math.max(0.02, inv.amount * 0.01);
    const matches = txs.filter((t) => {
      if (used.has(t.id)) return false;
      const signOk = inv.direction === "in" ? t.amount > 0 : t.amount < 0;
      if (!signOk) return false;
      if (Math.abs(Math.abs(t.amount) - inv.amount) > tol) return false;
      const d = dayDiff(inv.dueDate, t.date); // t.date - dueDate
      if (d < -60 || d > 30) return false;
      return cpOverlap(t.counterparty, inv.counterparty);
    });
    if (matches.length !== 1) return inv; // ambiguous or none -> leave for manual review
    used.add(matches[0].id);
    return { ...inv, status: "paid" as const, matchedTxId: matches[0].id };
  });
}
```

- [ ] **Step 4: Run → PASS**; **Step 5: Commit** (`invoices.ts`, `invoices.test.ts`): `feat(core): reconcileInvoices auto-marks paid against bank Tx`.

---

## Task 3: Vault storage for invoices

**Files:** Modify `packages/adapters/src/storage/encryptedStorage.ts`; append `encryptedStorage.test.ts`.

**Interfaces produced (on `VaultStorage`):** `getInvoices(): Promise<Invoice[]>`, `putInvoices(i: Invoice[]): Promise<void>` (replace-all).

Follow EXACTLY the existing `getScheduledFlows`/`putScheduledFlows` pattern (added in Phase 0): import `Invoice` from `@lavega/core`; add `invoices?: Invoice[]` to the internal `VaultData` type; add the two methods to the `VaultStorage` interface; add the methods to the returned object (replace-all via `enqueueWrite` + `persist`, `LOCKED_ERROR`, getter defaults to `[]`). Single-blob vault ⇒ NO migration.

- [ ] **Step 1: Failing test** — append (match the file's jsdom + fake-indexeddb setup; unique db name):

```ts
test("invoices round-trip; legacy vault defaults to []", async () => {
  const s = createEncryptedStorage("lavega-vault-test-inv");
  await s.setup("pw");
  expect(await s.getInvoices()).toEqual([]);
  const invoice = {
    id: "i1",
    entity: "BV1",
    direction: "out" as const,
    counterparty: "X",
    issueDate: "2026-08-01",
    dueDate: "2026-09-01",
    amount: 100,
    currency: "EUR",
    status: "expected" as const,
    sourceType: "manual" as const,
  };
  await s.putInvoices([invoice]);
  expect(await s.getInvoices()).toEqual([invoice]);
});
```

- [ ] **Step 2: Run → FAIL; Step 3: implement (mirror getScheduledFlows/putScheduledFlows); Step 4: Run → PASS; Step 5: Commit** (`encryptedStorage.ts`, `encryptedStorage.test.ts`): `feat(adapters): vault stores invoices`.

---

## Task 4: Facturen view (manual entry) + App wiring end-to-end

**Files:** Create `apps/web/src/views/Facturen.tsx`; Modify `apps/web/src/App.tsx`, `components/Sidebar.tsx`, `components/TopBar.tsx`; Create `apps/web/src/facturen.test.ts`.

**Goal:** after this task, a manually-entered invoice shows up as an expected flow in the Overzicht/Forecast, and reconciles to `paid` when a matching bank Tx exists. Minimal styling (polish later), reuse existing classes.

- [ ] **Step 1: Wiring test** — `apps/web/src/facturen.test.ts`:

```ts
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { makeInvoice, scheduledInvoiceFlows, reconcileInvoices } from "@lavega/core";
import type { Tx } from "@lavega/core";

test("manual invoice -> expected flow; paid after a matching tx", () => {
  const invoice = makeInvoice({
    entity: "BV1",
    direction: "out",
    counterparty: "Coolblue",
    issueDate: "2026-08-01",
    dueDate: "2026-09-01",
    amount: 1210,
    currency: "EUR",
    status: "expected",
    sourceType: "manual",
  });
  expect(scheduledInvoiceFlows([invoice])).toHaveLength(1);
  const tx: Tx = {
    id: "t1",
    accountKey: "A",
    date: "2026-08-29",
    amount: -1210,
    currency: "EUR",
    counterparty: "Coolblue BV",
    description: "",
    category: "",
    manual: false,
  };
  const reconciled = reconcileInvoices([invoice], [tx]);
  expect(reconciled[0].status).toBe("paid");
  expect(scheduledInvoiceFlows(reconciled)).toHaveLength(0); // no longer an expected flow
});
```

- [ ] **Step 2: Run → PASS** (guards the contract; core already built).

- [ ] **Step 3: `View` + nav.** `App.tsx`: add `"facturen"` to `View`. `Sidebar.tsx`: add a `facturen` icon (a document glyph) + `{ key: "facturen", label: "Facturen" }` in NAV_ITEMS (place after `belasting`). `TopBar.tsx`: `facturen: "Facturen"` in VIEW_TITLES.

- [ ] **Step 4: `App.tsx` state + wiring.**
  - `const [invoices, setInvoices] = useState<Invoice[]>([]);`
  - In the gate-ready load effect add `storage.getInvoices()` → `setInvoices(...)`; in `handleLock` reset `setInvoices([])`; in `handleRestored` reload it.
  - `async function saveInvoices(next: Invoice[]) { setInvoices(next); await storage.putInvoices(next); }`
  - Merge invoice flows into the forecast/alerts input. Replace the `scopedScheduledFlows` memo so it includes invoice-derived flows:
    ```ts
    const allScheduledFlows = useMemo(
      () => [...scheduledFlows, ...scheduledInvoiceFlows(invoices)],
      [scheduledFlows, invoices],
    );
    const scopedScheduledFlows = useMemo(
      () => scheduledFlowsForScope(allScheduledFlows, entityScope),
      [allScheduledFlows, entityScope],
    );
    ```
    (Import `scheduledInvoiceFlows`, `reconcileInvoices`, type `Invoice` from `@lavega/core`.)
  - Reconcile on import: at the end of the existing `handleImport` (after txs are persisted+reloaded) and after the Enable-Banking import, call:
    ```ts
    const curInvoices = await storage.getInvoices();
    const reconciled = reconcileInvoices(curInvoices, freshTxs);
    if (JSON.stringify(reconciled) !== JSON.stringify(curInvoices)) await saveInvoices(reconciled);
    ```
    (use the freshly-reloaded txs already in scope as `freshTxs`).
  - Route:
    ```tsx
    {
      view === "facturen" && (
        <Facturen
          entities={entityOptions}
          invoices={invoices}
          txs={txs}
          asOf={asOf}
          busy={busy}
          defaultEntity={entity}
          onSaveInvoices={saveInvoices}
        />
      );
    }
    ```

- [ ] **Step 5: `Facturen.tsx`.** A card with: a manual-entry form (direction select in/out, counterparty, invoiceNumber, issueDate, dueDate, amount, currency default EUR) that calls `makeInvoice` + appends via `onSaveInvoices([...invoices, inv])`; a table of invoices (counterparty, direction badge, amount, dueDate, status — with a "verwacht/betaald/geannuleerd" badge and a "markeer betaald"/"annuleer" action that updates status); and a live summary of `scheduledInvoiceFlows(invoices)` count + net per-month impact. Reuse `.card/.table/.btn/.badge/.eyebrow` + `formatEuro`. Props:

```ts
type FacturenProps = {
  entities: string[];
  invoices: Invoice[];
  txs: Tx[];
  asOf: string;
  busy: boolean;
  defaultEntity: string;
  onSaveInvoices: (next: Invoice[]) => void;
};
```

- [ ] **Step 6: Verify** — `pnpm test && pnpm typecheck && pnpm --filter @lavega/web build` → green.
- [ ] **Step 7: Commit** (`apps/web/src`): `feat(web): Facturen view (manual entry) wired into forecast + reconciliation`.

---

## Task 5: Generic invoice CSV import

**Files:** Create `packages/core/src/parsers/invoiceCsv.ts`, `packages/core/src/parsers/invoiceCsv.test.ts`; export in `index.ts`; add file-drop to `Facturen.tsx`.

**Interfaces produced:** `parseInvoiceCsv(text: string): Array<Omit<Invoice,"id">>` — reuse `splitRows`, `parseDate`, `parseAmount`, `headerIndex` from `packages/core/src/parsers/primitives.js` and the fuzzy `pick()` idea from `bankCsv.ts`. Map flexible headers: counterparty (`relatie|leverancier|klant|counterparty|naam`), amount (`bedrag|amount|totaal|total`), issueDate (`factuurdatum|datum|issue date`), dueDate (`vervaldatum|due date|verval`), direction (`richting|type` → "in"/"inkoop"/"verkoop" heuristic; default by a `direction` column or a sign), invoiceNumber (`factuurnummer|nummer|invoice`), vat (`btw|vat`). Rows missing amount or a date are skipped.

- [ ] **Step 1: Failing test** with a small NL-style CSV fixture asserting 2 parsed invoices (one `in`, one `out`) with correct amounts/dates/direction. **Step 2: FAIL. Step 3: implement** following `bankCsv.ts`'s structure (delimiter sniff, header index, `pick`, per-row map). **Step 4: PASS. Step 5:** add a file-`<input>` in `Facturen.tsx` that reads the file text, calls `parseInvoiceCsv`, maps each row through `makeInvoice` (stamping `sourceType:"csv"`, default entity = `defaultEntity`), merges (dedup by id) into invoices, runs `reconcileInvoices` against `txs`, and saves. **Step 6: verify. Step 7: Commit**: `feat(core+web): generic invoice CSV import`.

---

## Task 6: UBL / EN-16931 XML import (future-proof; deferrable)

**Files:** Create `packages/core/src/parsers/invoiceUbl.ts`, `invoiceUbl.test.ts`, `packages/core/src/parsers/parseInvoiceFile.ts` (dispatch: XML preamble → UBL, else CSV); export; use `parseInvoiceFile` in `Facturen.tsx`'s file drop.

**Interfaces produced:** `parseInvoiceUbl(xml: string): Array<Omit<Invoice,"id">>` — parse EN-16931 UBL tags with a small regex/`DOMParser`-free approach (extract `cbc:IssueDate`, `cbc:DueDate`, `cbc:PayableAmount`, `cbc:TaxAmount`, `cac:AccountingSupplierParty//cbc:Name`, `cac:AccountingCustomerParty//cbc:Name`, `cbc:InvoiceTypeCode`). Direction: a received purchase invoice (supplier = someone else) → `out`; a sales invoice you issued → `in` — infer from `InvoiceTypeCode`/which party matches the user, default `out` with a note. `parseInvoiceFile(name, text)` dispatches: `/^\s*<\?xml|<(ubl:)?Invoice/i` → UBL, else CSV.

- [ ] **Step 1: Failing test** with a minimal UBL invoice fixture asserting the extracted fields. **Steps 2-4:** TDD implement (no new deps; string/regex parse like `mt940.ts`). **Step 5:** switch `Facturen.tsx`'s file drop to `parseInvoiceFile`. **Step 6: verify (full suite + typecheck + build). Step 7: Commit**: `feat(core+web): UBL/EN-16931 invoice import + file dispatch`.

> If time-boxed, Task 6 may be deferred — Tasks 1-5 already deliver a working local invoice slice (manual + CSV + reconciliation + forecast). Note the deferral in the ledger if so.

## Self-Review notes

- Reuses Phase 0 `ScheduledFlow`/forecast wiring — invoices need no new forecast code, only the merge in App (Task 4).
- Double-count avoided: `paid`/`cancelled` invoices produce no flow (Task 1) + `reconcileInvoices` flips paid on a matching Tx (Task 2), so a settled invoice drops out of the projection exactly when its bank Tx appears.
- Deterministic + local throughout; LLM/connectors are Phase 2b/2c.
- Types consistent: `Invoice` defined once in `model.ts`; `scheduledInvoiceFlows`/`reconcileInvoices` in `invoices.ts`; parsers return `Omit<Invoice,"id">[]` mapped through `makeInvoice`.
