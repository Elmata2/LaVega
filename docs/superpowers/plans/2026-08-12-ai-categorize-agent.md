# AI-categorize agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the owner bulk-categorize the ~80% of transactions that land in **"onbekend"** by sending only the merchant/description text + in/out sign (opt-in) to Claude Haiku, reviewing the proposed categories, and — on confirm — applying them to the transactions AND generating reusable rules so future imports auto-categorize. Validated by the levelsio post ("categorize mass transactions cheaply; do it once so it sticks").

**Architecture:** Reuses the Phase-2c server LLM proxy (server-side `ANTHROPIC_API_KEY` via `loadLlmConfig`, in-memory rate limiter) + the redaction-boundary pattern. New `POST /api/agent/categorize` runs Haiku with a forced tool constrained to LaVega's existing category taxonomy. A pure core layer picks the uncategorized txs and applies decisions (tx.category + deduped rules). Client: a "Categoriseer met AI" flow in the Transacties view with a confirm-first review table. `@anthropic-ai/sdk` stays server-only.

**Tech Stack:** TypeScript, pnpm monorepo, Vitest, Hono, React, `@anthropic-ai/sdk` (Claude `claude-haiku-4-5`, forced tool).

## Global Constraints

- **Privacy (hard):** opt-in (default OFF); each request carries ONLY `{ items: [{id, text, sign}] }` — `text` = counterparty+description, `sign` = "in"/"out". NEVER amounts, balances, account keys, IBANs-as-fields, dates, or anything else. `sanitizeCategorizeInput` is the boundary (allowlist + size cap), tested. Confirm-first: nothing is written to the vault until the owner clicks apply. `@anthropic-ai/sdk` server-only. Dormant `503` until the key is set.
- **Deterministic core stays pure** (no `Date.now`/`Math.random`; ids via `hash.ts`). Money is untouched — this only sets `category`/`manual` + adds `Rule`s.
- **Model:** `claude-haiku-4-5`, forced tool, no streaming (bounded output). Categories constrained to `CATEGORY_OPTIONS`.
- Dutch UI copy. Follow existing patterns (agent-routes.ts, anthropicExtract.ts, redaction.ts; App save* + view props). Commit messages end `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Verify per task: `pnpm test`, `pnpm typecheck`, and (Task 3) `pnpm --filter @lavega/web build` + grep the web bundle is SDK-clean.

## File Structure

- `packages/core/src/categorize.ts` — NEW: `CATEGORY_OPTIONS`, `uncategorizedTxs`, `applyCategorizations`, `CategoryDecision`.
- `packages/core/src/categorize.test.ts` — NEW.
- `packages/core/src/index.ts` — export `./categorize.js` (modify).
- `apps/server/src/agent/categorize.ts` — NEW: `sanitizeCategorizeInput`, `CategorizeItem`, `categorizeTransactions` (Haiku), the tool spec.
- `apps/server/src/agent/categorize.test.ts` — NEW.
- `apps/server/src/agent-routes.ts` — add `POST /api/agent/categorize` (modify).
- `apps/server/src/agent-routes.test.ts` — add route tests (modify).
- `apps/web/src/api.ts` — `categorizeTxs(items)` (modify).
- `apps/web/src/settings.ts` — `getAiCategorizeEnabled`/`setAiCategorizeEnabled` (modify).
- `apps/web/src/views/Transacties.tsx` — the "Categoriseer met AI" flow + review (modify).
- `apps/web/src/App.tsx` — `saveTxs` + pass `onApplyCategories` to Transacties (modify).

---

## Task 1: Core — category taxonomy + pick/apply helpers (pure, TDD)

**Files:** Create `packages/core/src/categorize.ts`, `packages/core/src/categorize.test.ts`; modify `packages/core/src/index.ts`.

**Interfaces produced:**

```ts
export const CATEGORY_OPTIONS: readonly string[]; // the allowed categories (AI + review dropdown share this)
export function uncategorizedTxs(txs: Tx[], rules: Rule[], own?: OwnAccounts): Tx[]; // categorize()==="onbekend"
export type CategoryDecision = { id: string; category: string }; // category not in CATEGORY_OPTIONS => skipped
export function applyCategorizations(
  txs: Tx[],
  rules: Rule[],
  decisions: CategoryDecision[],
): { txs: Tx[]; rules: Rule[] };
```

- [ ] **Step 1: Failing test** — `categorize.test.ts`:

```ts
import { expect, test } from "vitest";
import type { Tx, Rule } from "./model.js";
import { CATEGORY_OPTIONS, uncategorizedTxs, applyCategorizations } from "./categorize.js";

const tx = (id: string, cp: string, amount: number, category = ""): Tx => ({
  id,
  accountKey: "A1",
  date: "2026-08-01",
  amount,
  currency: "EUR",
  counterparty: cp,
  description: "",
  category,
  manual: false,
});

test("uncategorizedTxs returns only txs that resolve to 'onbekend'", () => {
  const txs = [tx("t1", "Jan Jansen priv", -10), tx("t2", "Albert Heijn", -20)];
  const rules: Rule[] = [];
  // "Albert Heijn" hits a built-in NL default; "Jan Jansen priv" does not.
  const un = uncategorizedTxs(txs, rules);
  expect(un.map((t) => t.id)).toEqual(["t1"]);
});

test("applyCategorizations sets manual category on decided txs + builds deduped rules", () => {
  const txs = [
    tx("t1", "Jan Jansen priv", -10),
    tx("t2", "Jan Jansen priv", -12),
    tx("t3", "Mystery BV", -5),
  ];
  const rules: Rule[] = [];
  const out = applyCategorizations(txs, rules, [
    { id: "t1", category: "Overboekingen" },
    { id: "t2", category: "Overboekingen" },
    { id: "t3", category: "NietBestaand" }, // invalid -> skipped
  ]);
  const byId = Object.fromEntries(out.txs.map((t) => [t.id, t]));
  expect(byId.t1).toMatchObject({ category: "Overboekingen", manual: true });
  expect(byId.t2).toMatchObject({ category: "Overboekingen", manual: true });
  expect(byId.t3.category).toBe(""); // invalid category ignored, tx untouched
  // One deduped rule for "Jan Jansen priv" -> Overboekingen (not two)
  const janRules = out.rules.filter((r) => r.match.toLowerCase().includes("jan jansen"));
  expect(janRules).toHaveLength(1);
  expect(janRules[0].category).toBe("Overboekingen");
});

test("applyCategorizations does not duplicate an existing rule and skips empty counterparty", () => {
  const txs = [tx("t1", "Albert Heijn", -10), tx("t2", "", -5)];
  const existing: Rule[] = [{ id: "r0", match: "Albert Heijn", category: "Boodschappen" }];
  const out = applyCategorizations(txs, existing, [
    { id: "t1", category: "Boodschappen" },
    { id: "t2", category: "Overboekingen" },
  ]);
  expect(out.rules.filter((r) => r.match.toLowerCase() === "albert heijn")).toHaveLength(1); // no dup
  expect(out.rules.some((r) => r.match === "")).toBe(false); // empty counterparty -> no rule
  expect(out.txs.find((t) => t.id === "t2")).toMatchObject({
    category: "Overboekingen",
    manual: true,
  });
});

test("CATEGORY_OPTIONS is a non-empty set including the common NL buckets", () => {
  expect(CATEGORY_OPTIONS).toContain("Boodschappen");
  expect(CATEGORY_OPTIONS).toContain("Overboekingen");
  expect(CATEGORY_OPTIONS.length).toBeGreaterThan(10);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `categorize.ts`:**

```ts
import type { Tx, Rule, OwnAccounts } from "./model.js";
import { categorize } from "./views.js";
import { hash, norm } from "./hash.js";

/** The categories the AI may assign + the review dropdown offers — LaVega's
 *  existing taxonomy so results stay consistent with the rules engine. */
export const CATEGORY_OPTIONS: readonly string[] = [
  "Boodschappen",
  "Eten & drinken",
  "Transport",
  "Reizen",
  "Wonen & energie",
  "Abonnementen",
  "Verzekeringen",
  "Gezondheid",
  "Kleding & winkelen",
  "Online shopping",
  "Elektronica",
  "Entertainment",
  "Huis & tuin",
  "Huisdieren",
  "Goede doelen",
  "Bankkosten",
  "Belastingen & overheid",
  "Geldopname",
  "Sparen & beleggen",
  "Overboekingen",
  "Eigen overboeking",
  "Inkomen",
];
const VALID = new Set(CATEGORY_OPTIONS);

export function uncategorizedTxs(txs: Tx[], rules: Rule[], own?: OwnAccounts): Tx[] {
  return txs.filter((t) => categorize(t, rules, own) === "onbekend");
}

export type CategoryDecision = { id: string; category: string };

export function applyCategorizations(
  txs: Tx[],
  rules: Rule[],
  decisions: CategoryDecision[],
): { txs: Tx[]; rules: Rule[] } {
  const byId = new Map<string, string>();
  for (const d of decisions) if (VALID.has(d.category)) byId.set(d.id, d.category);

  const nextTxs = txs.map((t) =>
    byId.has(t.id) ? { ...t, category: byId.get(t.id)!, manual: true } : t,
  );

  // One rule per (counterparty, category), deduped against existing + each other.
  const seen = new Set(rules.map((r) => `${norm(r.match)}|${r.category}`));
  const nextRules = [...rules];
  for (const t of txs) {
    const cat = byId.get(t.id);
    if (!cat) continue;
    const match = t.counterparty.trim();
    if (!match) continue;
    const key = `${norm(match)}|${cat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nextRules.push({ id: hash([norm(match), cat].join("|")), match, category: cat });
  }
  return { txs: nextTxs, rules: nextRules };
}
```

- [ ] **Step 4: Add to `packages/core/src/index.ts`:** `export * from "./categorize.js";`
- [ ] **Step 5: Run → PASS; `pnpm typecheck`.** **Step 6: Commit:** `feat(core): AI-categorize helpers (pick onbekend + apply decisions -> txs + rules)`.

---

## Task 2: Server — redaction + Haiku categorizer + route

**Files:** Create `apps/server/src/agent/categorize.ts`, `apps/server/src/agent/categorize.test.ts`; modify `apps/server/src/agent-routes.ts`, `apps/server/src/agent-routes.test.ts`.

**Interfaces produced:**

- `type CategorizeItem = { id: string; text: string; sign: "in" | "out" }`.
- `sanitizeCategorizeInput(raw): { items: CategorizeItem[] }` — allowlist + caps (≤200 items; `text` ≤200 chars; `id` string; `sign` normalized to "in"/"out"); throws on empty/oversize.
- `categorizeTransactions(input, apiKey): Promise<{ id: string; category: string }[]>` — Haiku forced tool, categories constrained to `CATEGORY_OPTIONS` (imported from `@lavega/core`); drops any result whose category isn't valid.
- Route `POST /api/agent/categorize` (deps.categorize injectable, defaults to `categorizeTransactions`).

- [ ] **Step 1: `sanitizeCategorizeInput` + test** (mirror `redaction.ts`'s single-read/allowlist discipline). Test: extra fields (e.g. `amount`, `accountKey`) on an item are dropped; oversize (>200 items or text >200 chars) throws; empty throws; `sign` coerced to "in"/"out".
- [ ] **Step 2: `categorizeTransactions`** — build one Haiku request: a forced tool `categorize` whose `input_schema` is `{ results: [{ id: string, category: string(enum CATEGORY_OPTIONS) }] }`; system/user prompt lists the items (id + text + sign) and instructs: assign each a category from the allowed list based on the merchant text; use "Inkomen" for incoming, "Eigen overboeking"/"Overboekingen" for transfers; if genuinely unclear, omit that id. Parse the tool_use, keep only results whose `category ∈ CATEGORY_OPTIONS`. Model `claude-haiku-4-5`, no thinking/stream. Verify SDK types against the installed `@anthropic-ai/sdk` (like anthropicExtract.ts). Mocked-SDK test (vi.mock) asserting request shape + that invalid categories are filtered out.
- [ ] **Step 3: Route** in `agent-routes.ts` (mirror extract-invoice): `const categorize = deps.categorize ?? categorizeTransactions;` then `POST /api/agent/categorize`: 503 if not configured → 429 rate-limit (`limit("categorize")`) → `sanitizeCategorizeInput(await c.req.json())` (400 on throw) → `c.json(await categorize(input, apiKey))` (502 on throw).
- [ ] **Step 4: Route tests** (mirror the chat/extract tests): (a) no key → 503; (b) key + injected categorize → 200 with results; (c) a body with an item carrying a disallowed field (`amount`) → the injected categorize receives ONLY `{id,text,sign}` (prove the redaction boundary); (d) oversize → 400. Restore env in try/finally.
- [ ] **Step 5: Verify** — `pnpm test`, `pnpm typecheck`, `pnpm --filter @lavega/server build`. **Step 6: Commit:** `feat(server): /api/agent/categorize (Haiku, redaction boundary, rate limit)`.

---

## Task 3: Web — "Categoriseer met AI" flow + review + wiring

**Files:** Modify `apps/web/src/api.ts`, `apps/web/src/settings.ts`, `apps/web/src/views/Transacties.tsx`, `apps/web/src/App.tsx`; test `apps/web/src/categorize-ui.test.ts` (NEW).

- [ ] **Step 1: settings** — `getAiCategorizeEnabled()` (default false, localStorage `lavega.aiCategorize`) / `setAiCategorizeEnabled(on)`, mirroring `getAiExtractionEnabled`.
- [ ] **Step 2: api** — `async function categorizeTxs(items: { id: string; text: string; sign: "in" | "out" }[]): Promise<{ id: string; category: string }[]>` — POST `${API_BASE}/api/agent/categorize` with `{ items }`, `content-type: application/json`; on `!res.ok` read `{error}` and throw; else return `(await res.json())` (the results array). (Normal CORS: same-origin in prod; this is a JSON request/response, unlike the SSE chat.)
- [ ] **Step 3: App** — add `async function saveTxs(next: Tx[]) { setTxs(next); await storage.putTxs(next); }` (verify `storage.putTxs` exists — the importer uses it; if it's upsert-by-id, passing the full updated list is fine). Pass to Transacties: `onApplyCategories={async (updatedTxs, updatedRules) => { await saveTxs(updatedTxs); await saveRules(updatedRules); }}` and `configured={llmConfigured}`. Add the two props to `TransactiesProps`.
- [ ] **Step 4: Transacties** — add a **"Categoriseer met AI"** button in the view header, shown only when `configured` and there are onbekend txs in the current scoped list. Flow:
  - Consent gate: if `!getAiCategorizeEnabled()`, first click shows a one-line notice ("De merchant-omschrijving van je onbekend-transacties gaat opt-in naar Claude om te categoriseren; bedragen en rekeningen niet.") + an "Aanzetten" button → `setAiCategorizeEnabled(true)`.
  - On run: `const items = uncategorizedTxs(scopedTxs, rules, own).slice(0, 200).map((t) => ({ id: t.id, text: `${t.counterparty} ${t.description}`.trim().slice(0,200), sign: t.amount >= 0 ? "in" : "out" }))`; call `categorizeTxs(items)`.
  - **Review modal/panel**: a list of the items with the AI-proposed category in an editable `<select>` (options = `CATEGORY_OPTIONS`, plus a "— sla over —" option = skip). Show the tx text + amount for context (amount is shown to the user locally, NOT sent). "Toepassen" → build `CategoryDecision[]` (skip the "sla over" rows) → `applyCategorizations(txs, rules, decisions)` → `onApplyCategories(result.txs, result.rules)` → close + toast "N transacties gecategoriseerd, M regels toegevoegd."
  - Errors (503/network) → inline note. Loading state on the button.
  - NOTE: `applyCategorizations` needs the FULL `txs` (not just scoped) to return a complete updated list for `putTxs`. Transacties only has `scopedTxs`. So pass the full `txs` too, OR have App do the apply: simplest — pass `onApplyCategories(decisions)` up to App and let App call `applyCategorizations(fullTxs, rules, decisions)` + save. **Do that:** Transacties emits the confirmed `CategoryDecision[]`; App applies against the full `txs`+`rules` and saves. Adjust the prop to `onApplyCategories: (decisions: CategoryDecision[]) => Promise<void>`.
- [ ] **Step 5: test** `categorize-ui.test.ts` — logic-only: the item-builder mapping (onbekend tx → `{id,text,sign}`, text capped, no amount leaked) and that a skip decision is excluded. (The apply math is already core-tested; the SSE/LLM path is server-tested.)
- [ ] **Step 6: Verify** — `pnpm test`, `pnpm typecheck`, `pnpm --filter @lavega/web build`; grep `apps/web/dist` has no `@anthropic-ai`/`api.anthropic.com`. **Step 7: Commit:** `feat(web): Categoriseer-met-AI flow in Transacties (opt-in, confirm-first)`.

## Self-Review notes

- Redaction boundary (`sanitizeCategorizeInput`, Task 2) is dedicated + tested; the route test proves disallowed item fields never reach the model. Only `{id,text,sign}` leaves; amounts shown in the review are client-only.
- Opt-in (default OFF) + confirm-first (nothing saved until "Toepassen"); dormant 503 without the key; SDK server-only (bundle grep).
- "Direct + rules": `applyCategorizations` sets `manual` category on the txs AND adds deduped `Rule`s so future imports auto-categorize (the levelsio "do it once, it sticks").
- Category set shared via core `CATEGORY_OPTIONS` (server constrains the LLM to it; client dropdown offers it) — no drift.
- App owns the apply against the FULL tx list (Transacties only sees scoped), so `putTxs` gets a complete list.
