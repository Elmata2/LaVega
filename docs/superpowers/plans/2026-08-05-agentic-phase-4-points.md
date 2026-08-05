# Agentic Phase 4 — Points / Rewards agent (minimal-but-full) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the owner track loyalty/rewards balances across programs (Amex Membership Rewards, airline/hotel programs, bank cashback, etc.), see an indicative euro value per balance and a total, get a staleness nudge when a balance is old, and — for Amex MR — see transfer-partner options. Fully manual + local (there are NO consumer point APIs to auto-fetch), fully deterministic.

**Architecture:** Deterministic core (`rewards.ts`: types, an owner-maintained reference table of programs → cents-per-point, an Amex MR transfer table, and pure value/staleness/transfer functions). Rewards balances persist in the encrypted vault as an additive `VaultData.rewards?` field (same pattern as `invoices`, no migration). A minimal **Punten** web view: add/edit/delete balances + a value table + an Amex transfer card. No network, no LLM, no credentials.

**Tech Stack:** TypeScript, pnpm monorepo, Vitest, React (Vite). No new dependencies.

## Global Constraints

- **Deterministic + local-first:** core is pure (no `Date.now`/`Math.random`; `asOf` is passed in; day math via `Date.UTC`). No `@anthropic-ai/sdk`, no network. Balances live ONLY in the owner's encrypted vault.
- **Honesty:** point values are INDICATIVE (a maintained cents-per-point table with a "verified as of" date, like `NL_SAVINGS_RATES`/`FX_ROUTES`). The UI must say values are schattingen and that balances are entered/updated by hand (no auto-sync — no consumer point API exists). Do NOT imply live balances.
- Dutch UI copy. Follow existing patterns: additive vault field + `get*/put*` mirror `invoices` in `packages/adapters/src/storage/encryptedStorage.ts`; App state/load/save/reset mirror `invoices` in `apps/web/src/App.tsx`; view wiring mirrors the Valuta/Optimalisatie tabs (`View` union in `App.tsx`, `NAV_ITEMS` + icon in `Sidebar.tsx`, `VIEW_TITLES` in `TopBar.tsx`, a `view === "..."` block in `App.tsx`).
- Each task commits with a message ending `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Verify per task: `pnpm test`, `pnpm typecheck`, and (Task 3) `pnpm --filter @lavega/web build`.

## File Structure

- `packages/core/src/rewards.ts` — NEW: `RewardsBalance`, `RewardProgram`, `AmexTransfer` types; `REWARD_PROGRAMS`, `AMEX_MR_TRANSFERS`, `REWARDS_AS_OF`; `makeRewardsBalance`, `estimateValueCents`, `totalValueCents`, `isStale`, `amexTransferOptions`.
- `packages/core/src/rewards.test.ts` — NEW.
- `packages/core/src/index.ts` — export `./rewards.js` (modify).
- `packages/adapters/src/storage/encryptedStorage.ts` — `VaultData.rewards?` + `getRewards`/`putRewards` (modify).
- `packages/adapters/src/storage/encryptedStorage.test.ts` (or the existing adapters storage test) — add a rewards round-trip (modify/append).
- `apps/web/src/views/Punten.tsx` — NEW.
- `apps/web/src/punten.test.ts` — NEW (logic-only).
- `apps/web/src/App.tsx`, `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/TopBar.tsx` — wire the view + rewards state (modify).

---

## Task 1: Core `rewards.ts` — types, reference tables, value/staleness/transfer (pure, TDD)

**Files:** Create `packages/core/src/rewards.ts`, `packages/core/src/rewards.test.ts`; modify `packages/core/src/index.ts`.

**Interfaces produced:**
```ts
export type RewardsBalance = { id: string; program: string; points: number; updatedAt: string; note?: string };
export type RewardProgram = { name: string; centsPerPoint: number; category: string; note?: string };
export type AmexTransfer = { partner: string; ratio: number; note?: string };
export function makeRewardsBalance(r: Omit<RewardsBalance, "id">): RewardsBalance; // id = norm(program) — one row per program
export function estimateValueCents(b: RewardsBalance, programs?: readonly RewardProgram[]): number | null; // null if program not in table
export function totalValueCents(balances: RewardsBalance[], programs?: readonly RewardProgram[]): number;
export function isStale(b: RewardsBalance, asOf: string, maxDays?: number): boolean; // default maxDays = 90
export function amexTransferOptions(points: number, transfers?: readonly AmexTransfer[]): { partner: string; miles: number; note?: string }[];
export const REWARDS_AS_OF: string;
export const REWARD_PROGRAMS: readonly RewardProgram[];
export const AMEX_MR_TRANSFERS: readonly AmexTransfer[];
```

- [ ] **Step 1: Failing test** — `packages/core/src/rewards.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  makeRewardsBalance, estimateValueCents, totalValueCents, isStale, amexTransferOptions,
  REWARD_PROGRAMS, AMEX_MR_TRANSFERS,
} from "./rewards.js";

const amex = makeRewardsBalance({ program: "American Express Membership Rewards", points: 10000, updatedAt: "2026-06-01" });

test("makeRewardsBalance: stable id per program (same program -> same id)", () => {
  const a = makeRewardsBalance({ program: "American Express Membership Rewards", points: 1, updatedAt: "2026-01-01" });
  const b = makeRewardsBalance({ program: "  american express membership rewards ", points: 999, updatedAt: "2026-07-01" });
  expect(a.id).toBe(b.id); // dedupe by normalized program name
  expect(typeof a.id).toBe("string");
  expect(a.id.length).toBeGreaterThan(0);
});

test("estimateValueCents uses the program's cents-per-point; null for an unknown program", () => {
  // Amex MR default cpp is 1.0 -> 10000 pts = 10000 cents = €100
  expect(estimateValueCents(amex)).toBe(10000);
  const unknown = makeRewardsBalance({ program: "Kruidvat zegeltjes", points: 500, updatedAt: "2026-06-01" });
  expect(estimateValueCents(unknown)).toBeNull();
});

test("totalValueCents sums only the balances whose program is known", () => {
  const unknown = makeRewardsBalance({ program: "Onbekend", points: 500, updatedAt: "2026-06-01" });
  expect(totalValueCents([amex, unknown])).toBe(10000);
});

test("isStale: true past maxDays, false within", () => {
  expect(isStale(amex, "2026-06-15", 90)).toBe(false); // 14 days
  expect(isStale(amex, "2026-10-01", 90)).toBe(true);   // ~122 days
});

test("amexTransferOptions applies each partner ratio", () => {
  const opts = amexTransferOptions(10000);
  expect(opts.length).toBe(AMEX_MR_TRANSFERS.length);
  const fb = opts.find((o) => o.partner.includes("Flying Blue"));
  expect(fb?.miles).toBe(10000 * (AMEX_MR_TRANSFERS.find((t) => t.partner.includes("Flying Blue"))!.ratio));
});

test("reference tables are non-empty and well-formed", () => {
  expect(REWARD_PROGRAMS.length).toBeGreaterThan(5);
  expect(REWARD_PROGRAMS.every((p) => p.centsPerPoint > 0 && p.name && p.category)).toBe(true);
  expect(AMEX_MR_TRANSFERS.every((t) => t.ratio > 0 && t.partner)).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm vitest run packages/core/src/rewards.test.ts`).
- [ ] **Step 3: Implement `packages/core/src/rewards.ts`:**

```ts
import { norm } from "./hash.js";

export type RewardsBalance = { id: string; program: string; points: number; updatedAt: string; note?: string };
export type RewardProgram = { name: string; centsPerPoint: number; category: string; note?: string };
export type AmexTransfer = { partner: string; ratio: number; note?: string };

/** One row per program: id is the normalized program name, so editing a
 *  program's balance updates the same row instead of duplicating it. */
export function makeRewardsBalance(r: Omit<RewardsBalance, "id">): RewardsBalance {
  return { ...r, id: norm(r.program) };
}

function findProgram(name: string, programs: readonly RewardProgram[]): RewardProgram | null {
  const n = norm(name);
  return programs.find((p) => norm(p.name) === n) ?? null;
}

/** Indicative euro value in cents using the program's cents-per-point, or null
 *  when the program isn't in the reference table (UI shows "waarde onbekend"). */
export function estimateValueCents(b: RewardsBalance, programs: readonly RewardProgram[] = REWARD_PROGRAMS): number | null {
  const p = findProgram(b.program, programs);
  if (!p) return null;
  return Math.round(b.points * p.centsPerPoint);
}

export function totalValueCents(balances: RewardsBalance[], programs: readonly RewardProgram[] = REWARD_PROGRAMS): number {
  return balances.reduce((sum, b) => sum + (estimateValueCents(b, programs) ?? 0), 0);
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** A balance is stale when it was last updated more than `maxDays` before asOf. */
export function isStale(b: RewardsBalance, asOf: string, maxDays = 90): boolean {
  return daysBetween(b.updatedAt, asOf) > maxDays;
}

export function amexTransferOptions(
  points: number,
  transfers: readonly AmexTransfer[] = AMEX_MR_TRANSFERS,
): { partner: string; miles: number; note?: string }[] {
  return transfers.map((t) => ({ partner: t.partner, miles: Math.round(points * t.ratio), note: t.note }));
}

/* Indicative reference — owner-maintained, re-verify periodically. cents/point
 * are rough "typical redemption" values; actual value varies by how you redeem. */
export const REWARDS_AS_OF = "2026-08-05";
export const REWARD_PROGRAMS: readonly RewardProgram[] = [
  { name: "American Express Membership Rewards", centsPerPoint: 1.0, category: "Creditcard", note: "0,5–2 ct/punt; transfer naar airline is vaak het meest waard" },
  { name: "Flying Blue (KLM/Air France)", centsPerPoint: 0.8, category: "Airline" },
  { name: "Avios (BA/Iberia)", centsPerPoint: 1.0, category: "Airline" },
  { name: "Miles & More (Lufthansa)", centsPerPoint: 0.8, category: "Airline" },
  { name: "Marriott Bonvoy", centsPerPoint: 0.6, category: "Hotel" },
  { name: "World of Hyatt", centsPerPoint: 1.5, category: "Hotel" },
  { name: "IHG One Rewards", centsPerPoint: 0.4, category: "Hotel" },
  { name: "Hilton Honors", centsPerPoint: 0.4, category: "Hotel" },
  { name: "bunq", centsPerPoint: 1.0, category: "Bank", note: "cashback in euro's" },
  { name: "ING", centsPerPoint: 1.0, category: "Bank", note: "ING NL heeft geen puntenprogramma — gebruik dit voor cashback/acties" },
];
export const AMEX_MR_TRANSFERS: readonly AmexTransfer[] = [
  { partner: "Flying Blue (KLM/Air France)", ratio: 1.0 },
  { partner: "Avios (BA/Iberia)", ratio: 1.0 },
  { partner: "Marriott Bonvoy", ratio: 1.0 },
  { partner: "Miles & More (Lufthansa)", ratio: 1.0, note: "controleer actuele ratio" },
];
```

- [ ] **Step 4: Add to `packages/core/src/index.ts`:** `export * from "./rewards.js";`
- [ ] **Step 5: Run → PASS; `pnpm typecheck`.** **Step 6: Commit** (`rewards.ts`, `rewards.test.ts`, `index.ts`): `feat(core): rewards balances — value/staleness/transfer (deterministic)`.

---

## Task 2: Vault storage for rewards (additive `VaultData.rewards`)

**Files:** Modify `packages/adapters/src/storage/encryptedStorage.ts`; add a round-trip test to the existing adapters storage test file (find it, e.g. `packages/adapters/src/storage/*.test.ts`).

**Interfaces produced:** `VaultStorage.getRewards(): Promise<RewardsBalance[]>` and `putRewards(r: RewardsBalance[]): Promise<void>` — replace-all persistence, mirroring `getInvoices`/`putInvoices` exactly (same `enqueueWrite`/`persist`, default `[]` for a legacy vault).

- [ ] **Step 1:** Read the existing `getInvoices`/`putInvoices` implementation and the `VaultData` type in `encryptedStorage.ts`. Add `rewards?: RewardsBalance[]` to `VaultData`, add `getRewards`/`putRewards` to the `VaultStorage` interface, and implement them by copying the `invoices` methods verbatim with `invoices`→`rewards` and `Invoice`→`RewardsBalance` (import `RewardsBalance` from `@lavega/core`). Keep the "optional field → legacy vault decrypts fine" comment.
- [ ] **Step 2: Add a failing round-trip test** to the adapters storage test file (mirror the invoices round-trip test if one exists; otherwise a minimal one):

```ts
// inside the existing storage test suite
test("rewards round-trip through the vault (additive field)", async () => {
  const storage = /* however the suite builds a fresh in-memory VaultStorage */;
  // ... unlock/setup as the sibling tests do ...
  expect(await storage.getRewards()).toEqual([]); // default for a fresh/legacy vault
  const rows = [{ id: "amex", program: "American Express Membership Rewards", points: 10000, updatedAt: "2026-06-01" }];
  await storage.putRewards(rows);
  expect(await storage.getRewards()).toEqual(rows);
});
```
(Adapt the setup to match the sibling `invoices`/`scheduledFlows` test exactly — reuse its harness. If there is no existing storage test that unlocks a vault, put the round-trip alongside the closest existing one.)

- [ ] **Step 3: Run → PASS** (`pnpm vitest run packages/adapters`), `pnpm typecheck`. **Step 4: Commit** (`encryptedStorage.ts` + test): `feat(adapters): persist rewards balances in the vault (additive)`.

---

## Task 3: Web **Punten** view + App wiring

**Files:** Create `apps/web/src/views/Punten.tsx`, `apps/web/src/punten.test.ts`; modify `apps/web/src/App.tsx`, `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/TopBar.tsx`.

**Interfaces produced:** `Punten` default-export component `({ balances, asOf, busy, onSave }: { balances: RewardsBalance[]; asOf: string; busy: boolean; onSave: (next: RewardsBalance[]) => void })`. A pure helper `upsertBalance(list, balance): RewardsBalance[]` (replace by id or append) — exported for the test.

- [ ] **Step 1: App wiring (state + persistence), mirroring `invoices`:**
  - `apps/web/src/App.tsx`: import `RewardsBalance` type + `Punten`. Add `const [rewards, setRewards] = useState<RewardsBalance[]>([]);`. In the initial `Promise.all` load, add `storage.getRewards()` and `setRewards(loadedRewards)`. In `handleLock` reset, add `setRewards([])`. Add `async function saveRewards(next: RewardsBalance[]) { setRewards(next); await storage.putRewards(next); }`. (No reconcile-on-import — rewards are independent of bank data.)
  - Add `"punten"` to the `View` union; add the render block `{view === "punten" && <Punten balances={rewards} asOf={asOf} busy={busy} onSave={saveRewards} />}` (there is an `asOf` and a `busy` in scope — use the same ones the other views receive).
  - `Sidebar.tsx`: add `{ key: "punten", label: "Punten" }` to `NAV_ITEMS` (after "valuta") + a `punten:` icon (copy a neighbor's SVG shape).
  - `TopBar.tsx`: add `punten: "Punten"` to `VIEW_TITLES`.
- [ ] **Step 2: Failing test** — `apps/web/src/punten.test.ts` (logic-only):

```ts
import { expect, test } from "vitest";
import { makeRewardsBalance } from "@lavega/core";
import { upsertBalance } from "./views/Punten.js";

test("upsertBalance replaces the same-program row and appends a new one", () => {
  const a = makeRewardsBalance({ program: "American Express Membership Rewards", points: 100, updatedAt: "2026-01-01" });
  const a2 = makeRewardsBalance({ program: "American Express Membership Rewards", points: 5000, updatedAt: "2026-07-01" });
  const b = makeRewardsBalance({ program: "Flying Blue (KLM/Air France)", points: 200, updatedAt: "2026-07-01" });
  let list = upsertBalance([], a);
  expect(list).toHaveLength(1);
  list = upsertBalance(list, a2); // same id -> replace
  expect(list).toHaveLength(1);
  expect(list[0].points).toBe(5000);
  list = upsertBalance(list, b); // new program -> append
  expect(list).toHaveLength(2);
});
```

- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `apps/web/src/views/Punten.tsx`:**

```tsx
import { useMemo, useState } from "react";
import type { RewardsBalance } from "@lavega/core";
import {
  makeRewardsBalance, estimateValueCents, totalValueCents, isStale, amexTransferOptions,
  REWARD_PROGRAMS, REWARDS_AS_OF,
} from "@lavega/core";
import { formatEuro } from "../format";

/** Replace the balance with the same id, or append it. */
export function upsertBalance(list: RewardsBalance[], b: RewardsBalance): RewardsBalance[] {
  const i = list.findIndex((x) => x.id === b.id);
  if (i === -1) return [...list, b];
  const next = [...list];
  next[i] = b;
  return next;
}

export default function Punten({
  balances, asOf, busy, onSave,
}: { balances: RewardsBalance[]; asOf: string; busy: boolean; onSave: (next: RewardsBalance[]) => void }) {
  const [program, setProgram] = useState(REWARD_PROGRAMS[0].name);
  const [points, setPoints] = useState("");
  const [updatedAt, setUpdatedAt] = useState(asOf);

  const total = useMemo(() => totalValueCents(balances), [balances]);
  const amex = useMemo(
    () => balances.find((b) => b.program.toLowerCase().includes("membership rewards")),
    [balances],
  );

  function add() {
    const pts = Number(points.replace(/\./g, "").replace(",", "."));
    if (!program.trim() || !Number.isFinite(pts) || pts <= 0 || !updatedAt) return;
    onSave(upsertBalance(balances, makeRewardsBalance({ program: program.trim(), points: Math.round(pts), updatedAt })));
    setPoints("");
  }
  function remove(id: string) {
    onSave(balances.filter((b) => b.id !== id));
  }

  return (
    <section className="card" aria-label="Punten">
      <div className="card-header">
        <h2>Punten</h2>
        <span className="eyebrow">loyalty &amp; rewards</span>
      </div>
      <p className="cell-sub">
        Houd je punten- en cashback-saldi bij. Waardes zijn <strong>schattingen</strong> (indicatieve
        cent-per-punt, peildatum {REWARDS_AS_OF}) en je vult de saldi zelf bij — er is geen koppeling
        die punten automatisch ophaalt.
      </p>

      <div className="facturen-form">
        <label>Programma{" "}
          <input list="reward-programs" value={program} disabled={busy} aria-label="Programma"
            onChange={(e) => setProgram(e.target.value)} />
          <datalist id="reward-programs">
            {REWARD_PROGRAMS.map((p) => <option key={p.name} value={p.name} />)}
          </datalist>
        </label>{" "}
        <label>Punten{" "}
          <input className="saldo-input" type="number" min={0} step={1} value={points}
            disabled={busy} aria-label="Punten" onChange={(e) => setPoints(e.target.value)} />
        </label>{" "}
        <label>Bijgewerkt{" "}
          <input type="date" value={updatedAt} disabled={busy} aria-label="Bijgewerkt op"
            onChange={(e) => setUpdatedAt(e.target.value)} />
        </label>{" "}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={add}>Opslaan</button>
      </div>

      {balances.length === 0 ? (
        <p>Nog geen punten-saldi.</p>
      ) : (
        <>
          <p className="eyebrow" style={{ marginTop: "var(--sp-3)" }}>
            Totale geschatte waarde <span className="text-pos">{formatEuro(total / 100)}</span>
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Programma</th><th>Punten</th><th>Geschatte waarde</th><th>Bijgewerkt</th><th></th></tr>
              </thead>
              <tbody>
                {balances.map((b) => {
                  const val = estimateValueCents(b);
                  const stale = isStale(b, asOf);
                  return (
                    <tr key={b.id}>
                      <td>{b.program}</td>
                      <td>{b.points.toLocaleString("nl-NL")}</td>
                      <td>{val === null ? <span className="cell-sub">onbekend</span> : formatEuro(val / 100)}</td>
                      <td>{b.updatedAt}{stale ? <span className="badge" style={{ marginLeft: "var(--sp-1)" }}>verouderd</span> : null}</td>
                      <td><button type="button" className="btn" disabled={busy} onClick={() => remove(b.id)}>verwijder</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {amex && amex.points > 0 && (
        <>
          <p className="eyebrow" style={{ marginTop: "var(--sp-3)" }}>Amex MR overzetten (indicatief)</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Partner</th><th>Miles/punten</th></tr></thead>
              <tbody>
                {amexTransferOptions(amex.points).map((o) => (
                  <tr key={o.partner}><td>{o.partner}{o.note ? <span className="cell-sub"> · {o.note}</span> : null}</td><td>{o.miles.toLocaleString("nl-NL")}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Verify** — `pnpm vitest run apps/web/src/punten.test.ts` (PASS), `pnpm test`, `pnpm typecheck`, `pnpm --filter @lavega/web build`. **Step 6: Commit** (`Punten.tsx`, `punten.test.ts`, `App.tsx`, `Sidebar.tsx`, `TopBar.tsx`): `feat(web): Punten tab — rewards balances, value, staleness, Amex transfers`.

## Self-Review notes
- No LLM, no network, no credentials — fully local + deterministic; testable/usable immediately.
- Honesty enforced: values are labelled schattingen; the view states balances are manual (no auto-sync — the design's "no consumer point API" reality).
- Vault field is additive (`rewards?`) — a legacy vault decrypts and defaults to `[]`, no migration (same as `invoices`).
- Types consistent: `RewardsBalance` defined in core Task 1, persisted in adapters Task 2, consumed by web Task 3; `makeRewardsBalance` id = `norm(program)` gives one row per program (upsert semantics).
- "Full incl ING/Amex" honored via a broad program table + free-text `datalist` entry for any program not listed; Amex MR gets the transfer card. ING is included with an honest note (no NL points programme → cashback/acties).
