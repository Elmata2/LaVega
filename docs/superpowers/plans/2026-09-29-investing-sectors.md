# Investing Sectors: ETF Look-Through + Labelled Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the portfolio's "Unknown" sector bucket two ways: look through ETF/fund positions to their published sector weights (Yahoo `topHoldings`), then fill whatever real gap remains with labelled, precedence-respecting inference through System One (Jev), including an owner-correction escape hatch.

**Architecture:** Phase 1 turns a position's sector classification from a single label into a weight vector, so a fund's market value splits across the sectors it actually holds instead of collapsing to "Unknown." It reuses the existing single Yahoo `quoteSummary` call (now requesting `quoteType,assetProfile,topHoldings` together) and adds a durable, tenant-agnostic Neon cache for the classification (closing a real production gap: today's default store is an in-memory `Map` that a Vercel function never keeps past one invocation). Phase 2 extends the same `SectorProfileStore` record with a `source` tag (`provider` | `inferred`) and threads two new optional dependencies — a tenant-scoped correction lookup and a System One classifier — through the one existing resolution function, preserving its "omit the dependency, get no call and no write" discipline for read-only callers.

**Tech Stack:** TypeScript, Hono (`apps/investing-server`), React (`apps/investing-web`), Vitest, Neon Postgres via `@lavega/database`, Yahoo `quoteSummary` (unauthenticated), TypeSafe System One (`@typesafe-ai/sdk`) via the existing `systemOne.ts`/`systemOneUsage.ts` client.

**Spec:** `docs/investing/research/2026-09-28-sector-look-through-spike.md` (Option A, §4) and [GitHub issue #135](https://github.com/Elmata2/LaVega/issues/135) ("Jev-02: fill the unknown-sector gap with labelled inference").

## Global Constraints

- **Dependency: PR #171 must be on `master` before Task 5 lands.** It fixes the summary route's missing `hasYahooConsent` gate and gives `createApp()` a per-process shared `YahooHttpClient` default for `sectorProfile`. This plan does **not** re-implement that fix — Task 5 assumes it exists. If #171 is still open when Task 5 starts, rebase the branch onto `master` first and re-verify Task 5's consent test still passes against the merged version; do not write a second consent gate.
- **Dependency: PR #172 (migration `0016_investing_layout.sql`, `SectorAllocationCard` split) may or may not have merged before Task 6.** Task 6 targets `apps/investing-web/src/components/PortfolioSummaryCard.tsx` (current `master` shape, caption at line ~212-213). If `#172` has merged by execution time, re-target the equivalent caption inside the split-out `SectorAllocationCard.tsx` instead — same text change, same test shape, different file.
- **Migration numbering is provisional.** `0015_price_coverage.sql` is the latest migration on `master`; `#172` (open) claims `0016`. This plan uses `0017` (Task 3) and `0018` (Task 7). Before creating either file, run `ls db/migrations/` and use the actual next free number if `#172` merged with a different one, or if another migration landed first.
- **Taxonomy is one shared 11-label GICS-sector set, not two.** Yahoo's `sectorWeightings` keys (Title-Cased) and the System One classifier's `Choice` criteria must be the exact same label strings, exported from one place (`GICS_SECTOR_LABELS` in `packages/core/src/investing/sectorTaxonomy.ts`, Task 2). Two independently-typed label lists is exactly the kind of drift the codebase has already been bitten by (see `apps/investing-server/src/portfolioAgent.ts`'s comment on the "private" legal-wrapper bug).
- **Never an entity name, never a guessed industry finer than GICS sector/division.** This is the standing invariant `sectorResolution.ts` already documents (`UNKNOWN_SECTOR`'s comment) and issue #135 repeats twice (stories 9, 10). Every new code path that can produce a sector label (fund weights, inferred classification) must only ever emit a `GICS_SECTOR_LABELS` member or `UNKNOWN_SECTOR`.
- **Read-only callers stay read-only.** `resolvePortfolioSectors` callers that omit `fetchProfile`/`classifier` must trigger zero network calls and zero store writes — enforced today by `sectorResolution.test.ts`'s "without a fetch fallback nothing is fetched" test; Phase 2 adds the same guarantee for `classifier`.
- **Test commands use `--poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`.** Plain `--maxWorkers` throws a tinypool `RangeError` on this machine. Every `vitest run` invocation in this plan appends that flag pair.
- **Lint cap is 101 (`oxlint . --max-warnings 101`, already the root script).** No task may add a new warning; run `pnpm run lint` before each commit that touches lint-checked files.
- **No stash, no subagents, no Chrome, no product code from this planning session** — this document only.

## Review Focus

- **A fund whose Yahoo weights sum to less than 1 (VUAA: 99.98%, not 100%).** The naive implementation silently normalizes to 100% classified; the correct behavior folds the residual into `Unknown` for that position's share, per Task 4's test.
- **A 100%-bond fund (`AGGG.L`, `sectorWeightings: []`).** Must resolve to entirely `Unknown` for that position (not an error, not a crash on an empty array) — Task 4 and Task 5 both need a test for this exact fixture.
- **A stored profile written before this change (`{sector, industry}`, no `kind`/`source` field) must still load.** Task 2's file-store validator normalizes legacy records instead of rejecting or crash-parsing them; skip this and every existing production `sectors.json` cache entry silently reverts every symbol to `Unknown` on next deploy.
- **A symbol with a cached `inferred` profile must not re-invoke the classifier on every request** (issue #135 story 12), but **must still retry the cheap provider fetch** so a later Yahoo answer can replace the guess (story 6). Getting this backwards either re-pays System One on every dashboard load or never lets real data win.
- **An owner correction must short-circuit before any Yahoo or System One call for that symbol**, including on the very next resolution after the correction is saved (story 8: "correcting something once is enough"). Task 9's precedence tests must include a same-request-cycle check, not just an isolated unit assertion.

---

## File Structure

**New files:**
- `packages/core/src/investing/sectorTaxonomy.ts` — the shared `GICS_SECTOR_LABELS` array, the snake_case→Title-Case formatter, and (Phase 2) the sector→division fallback map. Single source of truth for every place a sector string can be produced.
- `packages/adapters/src/market-data/yahoo/__fixtures__/top-holdings-vfem.json`, `.../top-holdings-aggg.json` — real saved Yahoo responses (from the spike's scratchpad) used as CI fixtures.
- `apps/investing-server/src/neonSectorProfileStore.ts` — the Neon-backed `SectorProfileStore` (global table, no per-tenant RLS: a symbol's sector is not tenant data).
- `db/migrations/0017_sector_profiles.sql` — the new global `investing.sector_profiles` table.
- `db/migrations/0018_sector_corrections.sql` — adds `sector_corrections JSONB` to the existing per-user `investing.preferences` table.
- `apps/investing-server/src/sectorClassifier.ts` — the System One `Choice`-based classifier: builds the question, reads confidence, maps to sector or division, records usage.
- `apps/investing-server/src/sectorCorrectionStore.ts` — the tenant-scoped correction store contract + in-memory implementation (mirrors `inMemorySectorProfileStore.ts`'s split).
- `apps/investing-web/src/components/PositionSectorControl.tsx` — the minimal per-position sector display + correction input.

**Modified files:**
- `packages/adapters/src/market-data/yahoo/sectorProfile.ts` — one combined `quoteType,assetProfile,topHoldings` request; branches into a stock or fund profile.
- `apps/investing-server/src/inMemorySectorProfileStore.ts`, `fileSectorProfileStore.ts` — widen to the `SectorProfile` discriminated union; file store gains legacy-record normalization.
- `packages/core/src/investing/summary.ts` — `buildSectorExposure` accumulates a weight vector per position instead of one label.
- `apps/investing-server/src/sectorResolution.ts` — resolves a weight vector per symbol; Phase 2 adds the `correction`/`classifier` dependencies and the precedence ladder.
- `apps/investing-server/src/app.ts` — summary route consumes the new shape; Phase 2 adds the position-sector GET/PUT routes and wires consent + enable-flag gating.
- `apps/server/src/investing-mount.ts` — wires `createNeonSectorProfileStore` when a database is present (closing the existing "sector cache is in-memory-only on Vercel" gap).
- `apps/investing-web/src/app.tsx` — `PositionDetailSummary` renders `PositionSectorControl`.
- `apps/investing-web/src/components/PortfolioSummaryCard.tsx` — caption update (or `SectorAllocationCard.tsx`, see Global Constraints).
- `packages/database/src/index.ts` — `AiUsage["route"]` gains `"sector-inference"`; `PreferencesRepository` gains `getSectorCorrections`/`setSectorCorrection`/`clearSectorCorrection`.
- `apps/investing-server/src/systemOneUsage.ts`, `systemOne.ts` — `route` and per-call worst-case-token ceiling become parameters instead of the hardcoded `"portfolio-persona"`/`32_000`.

---

# Phase 1 — ETF look-through (ships as PR1)

### Task 1: Yahoo adapter detects funds and returns their sector weights

**Files:**
- Modify: `packages/adapters/src/market-data/yahoo/sectorProfile.ts`
- Create: `packages/adapters/src/market-data/yahoo/__fixtures__/top-holdings-vfem.json` (copy `combined_VFEM.json` from `/private/tmp/claude-501/-Users-alexandersteunenberg-Desktop-My-Code/c5b63205-9e66-488b-83a1-3b6733495640/scratchpad/spike-sectors/combined_VFEM.json` verbatim — real Yahoo response, equity ETF, `sectorWeightings` sums to ~0.9998)
- Create: `packages/adapters/src/market-data/yahoo/__fixtures__/top-holdings-aggg.json` (copy `combined_AGGG.json` from the same scratchpad dir — real Yahoo response, bond fund, `sectorWeightings: []`)
- Create: `packages/core/src/investing/sectorTaxonomy.ts`
- Test: `packages/adapters/src/market-data/yahoo/sectorProfile.test.ts`, `packages/core/src/investing/sectorTaxonomy.test.ts`

**Interfaces:**
- Produces: `GICS_SECTOR_LABELS: readonly string[]` (11 entries), `formatSectorWeightKey(key: string): string` from `sectorTaxonomy.ts`.
- Produces: `SectorProfile = StockSectorProfile | FundSectorProfile` from `sectorProfile.ts`, where `StockSectorProfile = { kind: "stock"; sector: string; industry: string; source: "provider" }` and `FundSectorProfile = { kind: "fund"; weights: { sector: string; weight: number }[]; source: "provider" }`. (The `source` field is always `"provider"` in Phase 1 — added now so Phase 2 only adds the `"inferred"` value, not a second schema migration.)
- Consumes: nothing new — `getYahooSymbolsToTry` (existing, `symbols.ts`) is unchanged.

- [ ] **Step 1: Write `sectorTaxonomy.ts` and its test first**

```typescript
// packages/core/src/investing/sectorTaxonomy.ts

/** The 11 GICS sectors, in Yahoo's own snake_case key order, Title-Cased.
 *  Every sector string the app ever stores or displays — a fund's look-through
 *  weight, a stock's provider-reported sector, or (Phase 2) a System One
 *  inference — must be one of these or UNKNOWN_SECTOR (sectorResolution.ts).
 *  One list, because two independently-typed copies is how "private" once
 *  became a sector (see portfolioAgent.ts's renderPortfolioSnapshot comment). */
export const GICS_SECTOR_LABELS = [
  "Technology",
  "Financial Services",
  "Healthcare",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Communication Services",
  "Industrials",
  "Energy",
  "Utilities",
  "Basic Materials",
  "Real Estate",
] as const;

export type GicsSectorLabel = (typeof GICS_SECTOR_LABELS)[number];

const SNAKE_KEY_TO_LABEL: Record<string, GicsSectorLabel> = {
  technology: "Technology",
  financial_services: "Financial Services",
  healthcare: "Healthcare",
  consumer_cyclical: "Consumer Cyclical",
  consumer_defensive: "Consumer Defensive",
  communication_services: "Communication Services",
  industrials: "Industrials",
  energy: "Energy",
  utilities: "Utilities",
  basic_materials: "Basic Materials",
  realestate: "Real Estate",
};

/** Yahoo's `sectorWeightings` key (snake_case, `realestate` with no
 *  underscore) to the app's display label. Returns `null` for a key Yahoo
 *  hasn't published before — callers drop that bucket's weight rather than
 *  inventing a 12th sector. */
export function formatSectorWeightKey(key: string): GicsSectorLabel | null {
  return SNAKE_KEY_TO_LABEL[key] ?? null;
}
```

```typescript
// packages/core/src/investing/sectorTaxonomy.test.ts
import { expect, test } from "vitest";
import { formatSectorWeightKey, GICS_SECTOR_LABELS } from "./sectorTaxonomy.js";

test("maps every Yahoo sectorWeightings key to a GICS label, realestate irregular", () => {
  expect(formatSectorWeightKey("technology")).toBe("Technology");
  expect(formatSectorWeightKey("consumer_cyclical")).toBe("Consumer Cyclical");
  expect(formatSectorWeightKey("realestate")).toBe("Real Estate");
});

test("an unrecognized key formats to null instead of inventing a 12th sector", () => {
  expect(formatSectorWeightKey("crypto_assets")).toBeNull();
});

test("every formatted label is a member of the canonical set", () => {
  for (const key of ["technology", "financial_services", "realestate"]) {
    expect(GICS_SECTOR_LABELS).toContain(formatSectorWeightKey(key));
  }
});
```

- [ ] **Step 2: Run it, confirm it fails on the missing module**

Run: `pnpm --filter @lavega/core test -- sectorTaxonomy --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: FAIL, `Cannot find module './sectorTaxonomy.js'`

- [ ] **Step 3: `sectorTaxonomy.ts` already written above satisfies it — re-run**

Run: `pnpm --filter @lavega/core test -- sectorTaxonomy --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS (3/3)

- [ ] **Step 4: Copy the two real fixtures**

```bash
cp /private/tmp/claude-501/-Users-alexandersteunenberg-Desktop-My-Code/c5b63205-9e66-488b-83a1-3b6733495640/scratchpad/spike-sectors/combined_VFEM.json \
   packages/adapters/src/market-data/yahoo/__fixtures__/top-holdings-vfem.json
cp /private/tmp/claude-501/-Users-alexandersteunenberg-Desktop-My-Code/c5b63205-9e66-488b-83a1-3b6733495640/scratchpad/spike-sectors/combined_AGGG.json \
   packages/adapters/src/market-data/yahoo/__fixtures__/top-holdings-aggg.json
```

- [ ] **Step 5: Write the failing adapter tests**

```typescript
// packages/adapters/src/market-data/yahoo/sectorProfile.test.ts — add alongside the existing tests
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const vfem = JSON.parse(readFileSync(join(fixturesDir, "top-holdings-vfem.json"), "utf8"));
const aggg = JSON.parse(readFileSync(join(fixturesDir, "top-holdings-aggg.json"), "utf8"));

test("an equity ETF returns a fund profile with Title-Cased weights", async () => {
  const fetchJsonWithCrumb = vi.fn().mockResolvedValue(vfem);
  const result = await fetchYahooSectorProfile("VFEM.L", { fetchJsonWithCrumb } as never);
  expect(result?.kind).toBe("fund");
  if (result?.kind !== "fund") throw new Error("expected a fund profile");
  expect(result.source).toBe("provider");
  expect(result.weights.length).toBeGreaterThan(0);
  expect(result.weights.every((w) => w.sector !== w.sector.toLowerCase())).toBe(true);
  const total = result.weights.reduce((sum, w) => sum + w.weight, 0);
  expect(total).toBeGreaterThan(0.99);
  expect(total).toBeLessThanOrEqual(1);
  expect(fetchJsonWithCrumb).toHaveBeenCalledWith(
    "https://query2.finance.yahoo.com/v10/finance/quoteSummary/VFEM.L?modules=quoteType,assetProfile,topHoldings",
  );
});

test("a bond fund returns an explicit empty-weights fund profile, not null", async () => {
  const result = await fetchYahooSectorProfile("AGGG.L", {
    fetchJsonWithCrumb: vi.fn().mockResolvedValue(aggg),
  } as never);
  expect(result).toEqual({ kind: "fund", weights: [], source: "provider" });
});

test("a stock still returns a single-sector profile (existing behavior preserved)", async () => {
  const result = await fetchYahooSectorProfile("acme", { fetchJsonWithCrumb } as never); // `fixture` from the existing test above
  expect(result).toEqual({
    kind: "stock",
    sector: "Technology",
    industry: "Consumer Electronics",
    source: "provider",
  });
});
```

- [ ] **Step 6: Run, confirm failure**

Run: `pnpm --filter @lavega/adapters test -- sectorProfile --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: FAIL — `result.kind` is `undefined`, existing "maps assetProfile sector" test now expects `kind: "stock"` and fails too.

- [ ] **Step 7: Rewrite `sectorProfile.ts`**

```typescript
// packages/adapters/src/market-data/yahoo/sectorProfile.ts
import { YahooHttpClient } from "./http.js";
import { getYahooSymbolsToTry } from "./symbols.js";
import { formatSectorWeightKey } from "@lavega/core";

const QUOTE_SUMMARY_URL = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/";
const MODULES = "quoteType,assetProfile,topHoldings";

export type StockSectorProfile = {
  kind: "stock";
  sector: string;
  industry: string;
  source: "provider";
};
export type FundSectorProfile = {
  kind: "fund";
  weights: { sector: string; weight: number }[];
  source: "provider";
};
export type SectorProfile = StockSectorProfile | FundSectorProfile;

type YahooCombinedResponse = {
  quoteSummary?: {
    result?: Array<{
      quoteType?: { quoteType?: string };
      assetProfile?: { sector?: string; industry?: string };
      topHoldings?: { sectorWeightings?: Array<Record<string, { raw?: number }>> };
    }>;
  };
};

const FUND_QUOTE_TYPES = new Set(["ETF", "MUTUALFUND"]);

/** Fetches sector data for one symbol in one call. Returns null on any
 *  failure or when neither a stock sector nor fund weights answer — never
 *  throws. */
export async function fetchYahooSectorProfile(
  symbol: string,
  client?: YahooHttpClient,
): Promise<SectorProfile | null> {
  try {
    const httpClient = client ?? new YahooHttpClient();
    for (const candidate of sectorProfileCandidates(symbol)) {
      const data = await httpClient.fetchJsonWithCrumb<YahooCombinedResponse>(
        `${QUOTE_SUMMARY_URL}${encodeURIComponent(candidate)}?modules=${MODULES}`,
      );
      const result = data.quoteSummary?.result?.[0];
      if (!result) continue;
      const profile = toSectorProfile(result);
      if (profile) return profile;
    }
    return null;
  } catch {
    return null;
  }
}

function toSectorProfile(result: {
  quoteType?: { quoteType?: string };
  assetProfile?: { sector?: string; industry?: string };
  topHoldings?: { sectorWeightings?: Array<Record<string, { raw?: number }>> };
}): SectorProfile | null {
  if (FUND_QUOTE_TYPES.has(result.quoteType?.quoteType ?? "")) {
    const weightings = result.topHoldings?.sectorWeightings ?? [];
    const weights = weightings.flatMap((entry) => {
      const [key, value] = Object.entries(entry)[0] ?? [];
      const sector = key ? formatSectorWeightKey(key) : null;
      return sector && typeof value?.raw === "number" && value.raw > 0
        ? [{ sector, weight: value.raw }]
        : [];
    });
    // Present regardless of length: [] for a bond fund is a real, cacheable
    // answer ("no equity sectors"), never confused with "the lookup failed."
    return { kind: "fund", weights, source: "provider" };
  }
  const asset = result.assetProfile;
  if (!asset?.sector && !asset?.industry) return null;
  return {
    kind: "stock",
    sector: asset?.sector ?? "Unknown",
    industry: asset?.industry ?? "Unknown",
    source: "provider",
  };
}

function sectorProfileCandidates(symbol: string): string[] {
  return [...new Set(getYahooSymbolsToTry(symbol, "").map((candidate) => candidate.toUpperCase()))];
}
```

Note the existing test `"tries Yahoo listing candidates for Trading 212-style symbols before giving up"` asserts the URL ends `?modules=assetProfile` — update that assertion to `?modules=${MODULES}` in the same edit (it is exercising the same code path, now requesting all three modules).

- [ ] **Step 8: Run, confirm pass**

Run: `pnpm --filter @lavega/adapters test -- sectorProfile --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS (all tests, including the pre-existing three with their updated URL/shape assertions)

- [ ] **Step 9: Typecheck and lint**

Run: `pnpm --filter @lavega/adapters typecheck && pnpm --filter @lavega/core typecheck && pnpm run lint`
Expected: both clean, lint ≤101 warnings with no new ones

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/investing/sectorTaxonomy.ts packages/core/src/investing/sectorTaxonomy.test.ts \
  packages/adapters/src/market-data/yahoo/sectorProfile.ts packages/adapters/src/market-data/yahoo/sectorProfile.test.ts \
  packages/adapters/src/market-data/yahoo/__fixtures__/top-holdings-vfem.json \
  packages/adapters/src/market-data/yahoo/__fixtures__/top-holdings-aggg.json
git commit -m "$(cat <<'EOF'
Detect ETF/fund holdings and return their sector weights

fetchYahooSectorProfile now requests quoteType,assetProfile,topHoldings in
one call (no extra round trip) and branches on quoteType into a stock or
fund profile. A fund's sectorWeightings becomes a Title-Cased weight vector
via the one shared GICS_SECTOR_LABELS taxonomy; a bond fund's empty
sectorWeightings is stored as an explicit zero-weight fund profile, not
null, so it's cached and never confused with a failed lookup.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `SectorProfileStore` implementations widen to the new shape, with legacy-record normalization

**Files:**
- Modify: `apps/investing-server/src/inMemorySectorProfileStore.ts`
- Modify: `apps/investing-server/src/fileSectorProfileStore.ts`
- Test: `apps/investing-server/src/fileSectorProfileStore.test.ts`

**Interfaces:**
- Consumes: `SectorProfile` (Task 1, `@lavega/adapters`).
- Produces: `SectorProfileStore = { get(symbol): Promise<SectorProfile | null>; set(symbol, profile): Promise<void> }` — signature unchanged, value type widened. Any legacy on-disk record (`{sector, industry}`, no `kind`) is normalized to `{ kind: "stock", sector, industry, source: "provider" }` on read.

- [ ] **Step 1: Write the failing legacy-normalization test**

```typescript
// apps/investing-server/src/fileSectorProfileStore.test.ts — add
test("a legacy record with no kind/source field loads as a provider-sourced stock profile", async () => {
  const path = tempFilePath(); // however the existing tests in this file build a scratch path
  await writeFile(path, JSON.stringify({ AAPL: { sector: "Technology", industry: "Hardware" } }));
  const store = createFileSectorProfileStore(path);
  expect(await store.get("AAPL")).toEqual({
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
});

test("a fund profile round-trips through the file store", async () => {
  const store = createFileSectorProfileStore(tempFilePath());
  const fund = {
    kind: "fund" as const,
    weights: [{ sector: "Technology", weight: 0.4 }],
    source: "provider" as const,
  };
  await store.set("VFEM.L", fund);
  expect(await store.get("VFEM.L")).toEqual(fund);
});
```

(Match whatever helper the existing tests in this file already use to build a scratch temp path — read the file's current top section before writing this step for real; do not invent a new helper name.)

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm --filter @lavega/investing-server test -- fileSectorProfileStore --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: FAIL — legacy record fails `isSectorProfile`, so `get()` returns `null` instead of a normalized stock profile; fund `set`/`get` fails the type check at compile time first.

- [ ] **Step 3: Update `inMemorySectorProfileStore.ts`'s type import (no behavior change needed — it stores whatever it's given)**

```typescript
// apps/investing-server/src/inMemorySectorProfileStore.ts — only the import + re-export comment changes
import type { SectorProfile } from "@lavega/adapters";
// ... createInMemorySectorProfileStore body is unchanged; it was always structurally generic.
```

- [ ] **Step 4: Rewrite `fileSectorProfileStore.ts`'s validator to normalize legacy records**

```typescript
// apps/investing-server/src/fileSectorProfileStore.ts
import type { SectorProfile } from "@lavega/adapters";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";
import type { SectorProfileStore } from "./inMemorySectorProfileStore.js";

export type { SectorProfileStore } from "./inMemorySectorProfileStore.js";

export function runtimeSectorStoreFile(): string {
  return runtimeDataFile("INVESTING_SECTOR_STORE_FILE", "sectors.json");
}

/** A record written before the fund/source split (Phase 1) had no `kind` or
 *  `source` field at all — just `{sector, industry}`. Every symbol classified
 *  before this shipped is one of these on disk. Reading it as `null` would
 *  silently revert every previously-classified stock to Unknown on deploy. */
function normalizeLegacyRecord(value: unknown): SectorProfile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind === "stock" || record.kind === "fund")
    return isSectorProfile(record) ? (record as SectorProfile) : null;
  if (typeof record.sector === "string" && typeof record.industry === "string")
    return { kind: "stock", sector: record.sector, industry: record.industry, source: "provider" };
  return null;
}

function isSectorProfile(value: unknown): value is SectorProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<StockShape & FundShape>;
  if (profile.kind === "stock")
    return typeof profile.sector === "string" && typeof profile.industry === "string";
  if (profile.kind === "fund")
    return (
      Array.isArray(profile.weights) &&
      profile.weights.every(
        (w) => w && typeof w.sector === "string" && typeof w.weight === "number",
      )
    );
  return false;
}
type StockShape = { kind: "stock"; sector: string; industry: string };
type FundShape = { kind: "fund"; weights: { sector: string; weight: number }[] };

/** Persistent per-symbol sector metadata cache for the Docker runtime. */
export function createFileSectorProfileStore(filePath: string): SectorProfileStore {
  const store = createJsonFileStore<Record<string, SectorProfile>>(filePath, {
    empty: {},
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error(`Invalid sector cache file: ${filePath}`);
      const entries = Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) => {
        const normalized = normalizeLegacyRecord(value);
        return normalized ? [[key, normalized] as const] : [];
      });
      return Object.fromEntries(entries);
    },
  });
  const key = (symbol: string) => symbol.toUpperCase();
  return {
    async get(symbol) {
      return (await store.read())[key(symbol)] ?? null;
    },
    async set(symbol, profile) {
      await store.update((current) => ({ ...current, [key(symbol)]: profile }));
    },
  };
}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @lavega/investing-server test -- fileSectorProfileStore --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS

- [ ] **Step 6: Typecheck, lint, commit**

Run: `pnpm --filter @lavega/investing-server typecheck && pnpm run lint`

```bash
git add apps/investing-server/src/inMemorySectorProfileStore.ts apps/investing-server/src/fileSectorProfileStore.ts \
  apps/investing-server/src/fileSectorProfileStore.test.ts
git commit -m "$(cat <<'EOF'
Widen SectorProfileStore to stock/fund and normalize legacy records

A record written before the fund/source split had no kind or source field.
The file store now normalizes it to a provider-sourced stock profile on
read instead of rejecting it, so a deploy doesn't silently revert every
already-classified symbol to Unknown.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: A real, durable sector-profile cache — Neon-backed store + migration

**Why this task exists (read before executing):** `apps/server/src/investing-mount.ts` — the actual Vercel production wiring — never passes a `sectorStore` into `createRuntimeApp`, so it silently falls back to `createApp()`'s in-memory default. Unlike `priceStore`/`benchmarkSelectionStore`/`marketDataConsentStore`, which all switch between a Neon-backed and a file-backed implementation depending on whether `runtimeDatabase()` returns a database, sector profiles have never had a Neon-backed option at all. On Vercel this means the classification cache does not survive between invocations — every cache-miss symbol re-negotiates Yahoo's crumb and re-fetches on every request. This is a pre-existing gap, not something either the spike or #135 called out explicitly, but Phase 1's look-through data is exactly what makes this worth fixing now: a fund's weight vector is more expensive to have go uncached than a single sector string was.

**Files:**
- Create: `db/migrations/0017_sector_profiles.sql`
- Create: `apps/investing-server/src/neonSectorProfileStore.ts`
- Test: `apps/investing-server/src/neonSectorProfileStore.test.ts`, addition to `packages/database/src/migrations.test.ts`
- Modify: `apps/server/src/investing-mount.ts`

**Interfaces:**
- Produces: `createNeonSectorProfileStore(db: Database): SectorProfileStore` (no `tenantId` parameter — deliberately global, see below).
- Consumes: `SectorProfile` (Task 1), `Database` (`@lavega/database`).

- [ ] **Step 1: Write the migration**

```sql
-- db/migrations/0017_sector_profiles.sql
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
 * A symbol's sector classification is not tenant data — AAPL's sector is the
 * same fact regardless of which account holds it. Every other table in this
 * schema (price_bars, price_coverage, preferences) is deliberately per-user
 * with row-level security, because market data is cached per tenant there
 * today; this table is the one place that convention would be actively
 * wrong, so it has neither a user_id column nor RLS, on the same documented
 * basis as personal.ai_usage ("aggregate ... not per-user data") — see
 * packages/database/src/migrations.test.ts.
 */
CREATE TABLE IF NOT EXISTS investing.sector_profiles (
  symbol TEXT NOT NULL PRIMARY KEY,
  profile JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sector_profiles_symbol_not_blank CHECK (btrim(symbol) <> ''),
  CONSTRAINT sector_profiles_kind_valid
    CHECK (profile ->> 'kind' IN ('stock', 'fund'))
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lavega_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON investing.sector_profiles TO lavega_runtime;
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 2: Write the failing migrations-test addition**

```typescript
// packages/database/src/migrations.test.ts — add
test("investing.sector_profiles deliberately has neither RLS nor FORCE — a symbol's sector is not tenant data", async () => {
  const rows = await db.query<{ enabled: boolean; forced: boolean }>(
    `SELECT c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'investing' AND c.relname = 'sector_profiles'`,
  );
  expect(rows.rows).toEqual([{ enabled: false, forced: false }]);
});
```

Also add `investing.sector_profiles` to the `checked` filter's implicit pass in the "every RLS-enabled table also forces it" test — no code change needed there since `enabled: false` never enters `violations`, but re-run it to confirm.

- [ ] **Step 3: Run migrations tests, confirm the new one fails (table doesn't exist yet) and the others still pass**

Run: `pnpm --filter @lavega/database test -- migrations --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: new test FAILs with `relation "sector_profiles" does not exist` (query returns 0 rows, `toEqual` fails); `every migration file applies without error` passes (SQL has no syntax error, table doesn't exist only because migration 0017 doesn't exist yet — actually place the SQL file first, so re-order: Step 1 before Step 2's run makes this a trivial pass/fail check on the new assertion only)

- [ ] **Step 4: Run again with the migration file in place, confirm pass**

Run: `pnpm --filter @lavega/database test -- migrations --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS, all tests including the new one

- [ ] **Step 5: Write `neonSectorProfileStore.ts` and its failing test**

```typescript
// apps/investing-server/src/neonSectorProfileStore.test.ts
import { expect, test } from "vitest";
import { createTestDatabase } from "@lavega/database/testing"; // match whatever the existing neonStores.test.ts imports for a real PGlite-backed Database — read that file's imports before writing this
import { createNeonSectorProfileStore } from "./neonSectorProfileStore.js";

test("round-trips a stock and a fund profile, keyed case-insensitively", async () => {
  const db = await createTestDatabase();
  const store = createNeonSectorProfileStore(db);
  await store.set("aapl", { kind: "stock", sector: "Technology", industry: "Hardware", source: "provider" });
  expect(await store.get("AAPL")).toEqual({
    kind: "stock",
    sector: "Technology",
    industry: "Hardware",
    source: "provider",
  });
  expect(await store.get("MISSING")).toBeNull();
});

test("set overwrites the same symbol rather than erroring on conflict", async () => {
  const db = await createTestDatabase();
  const store = createNeonSectorProfileStore(db);
  await store.set("VFEM.L", { kind: "fund", weights: [], source: "provider" });
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.5 }],
    source: "provider",
  });
  expect(await store.get("VFEM.L")).toEqual({
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.5 }],
    source: "provider",
  });
});
```

(Check `apps/investing-server/src/neonStores.test.ts` for the exact test-database bootstrap helper already in use in this package before writing this — reuse it verbatim rather than inventing `createTestDatabase`.)

- [ ] **Step 6: Run, confirm failure (module doesn't exist)**

Run: `pnpm --filter @lavega/investing-server test -- neonSectorProfileStore --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: FAIL, `Cannot find module './neonSectorProfileStore.js'`

- [ ] **Step 7: Implement it**

```typescript
// apps/investing-server/src/neonSectorProfileStore.ts
import type { Database } from "@lavega/database";
import type { SectorProfile } from "@lavega/adapters";
import type { SectorProfileStore } from "./inMemorySectorProfileStore.js";

/** Global cache — no tenantId, on purpose. See db/migrations/0017's comment:
 *  a symbol's sector is a market-data fact, not something one account owns. */
export function createNeonSectorProfileStore(db: Database): SectorProfileStore {
  return {
    async get(symbol) {
      const client = await db.connect();
      try {
        const result = await client.query<{ profile: SectorProfile }>(
          "SELECT profile FROM investing.sector_profiles WHERE symbol = $1",
          [symbol.toUpperCase()],
        );
        return result.rows[0]?.profile ?? null;
      } finally {
        client.release();
      }
    },
    async set(symbol, profile) {
      const client = await db.connect();
      try {
        await client.query(
          `INSERT INTO investing.sector_profiles (symbol, profile, updated_at)
           VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
           ON CONFLICT (symbol) DO UPDATE SET profile = EXCLUDED.profile, updated_at = CURRENT_TIMESTAMP`,
          [symbol.toUpperCase(), JSON.stringify(profile)],
        );
      } finally {
        client.release();
      }
    },
  };
}
```

This table has no RLS, so it uses `db.connect()` directly rather than `withTenantStatement` — matching the pattern `createAiUsageRepository` already uses for its non-tenant methods (see `packages/database/src/index.ts`'s own comment on `createEbFlowRepository`'s non-tenant methods).

- [ ] **Step 8: Run, confirm pass**

Run: `pnpm --filter @lavega/investing-server test -- neonSectorProfileStore --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS

- [ ] **Step 9: Wire it into the Vercel mount**

```typescript
// apps/server/src/investing-mount.ts
import {
  createNeonBenchmarkSelectionStore,
  createNeonMarketDataConsentStore,
  createNeonPriceStore,
} from "@lavega/investing-server/src/neonStores.js";
import { createNeonSectorProfileStore } from "@lavega/investing-server/src/neonSectorProfileStore.js";
import {
  createFileSectorProfileStore,
  runtimeSectorStoreFile,
} from "@lavega/investing-server/src/fileSectorProfileStore.js";

// inside getInvestingFetch(), alongside the existing store selections:
    sectorStore: database
      ? createNeonSectorProfileStore(database)
      : createFileSectorProfileStore(runtimeSectorStoreFile()),
```

- [ ] **Step 10: Typecheck, lint, commit**

Run: `pnpm --filter @lavega/investing-server typecheck && pnpm --filter @lavega/database typecheck && pnpm --filter @lavega/server typecheck && pnpm run lint`

```bash
git add db/migrations/0017_sector_profiles.sql apps/investing-server/src/neonSectorProfileStore.ts \
  apps/investing-server/src/neonSectorProfileStore.test.ts packages/database/src/migrations.test.ts \
  apps/server/src/investing-mount.ts
git commit -m "$(cat <<'EOF'
Add a durable, global sector-profile cache on Neon

investing-mount.ts (the real Vercel wiring) never set sectorStore, so
production silently used the in-memory default — a fresh, empty Map on
every invocation, and every fund weight would have re-fetched from Yahoo
on every request once look-through shipped. Sector classification isn't
tenant data (a symbol's sector is the same fact for every account), so
the new table has no user_id and no RLS, matching personal.ai_usage's
documented precedent for shared, non-per-user data.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `buildSectorExposure` accumulates a weight vector per position

**Files:**
- Modify: `packages/core/src/investing/summary.ts`
- Modify: `packages/core/src/investing/summary.test.ts`

**Interfaces:**
- Consumes: nothing new from earlier tasks (pure function, no adapter/server dependency — this is deliberately the isolated structural change the spike's §4 risk #3 calls out: "size and review it as its own unit").
- Produces: `SectorWeight = { sector: string; weight: number }`; `buildSectorExposure(positions, weightsBySymbol: ReadonlyMap<string, readonly SectorWeight[]>): SectorExposure[]`. Any residual under 1.0 for a position's vector (a fund whose Yahoo weights don't sum to 100%, or a bond fund's empty `[]`) folds into `"Unknown"` for that position's un-covered share.

- [ ] **Step 1: Update the existing test to the new signature, and add the two Review Focus cases**

```typescript
// packages/core/src/investing/summary.test.ts — replace the existing "sector exposure" test
test("sector exposure accumulates a weight vector per position, residual folds into Unknown", () => {
  const weights = new Map([
    ["ACME", [{ sector: "Technology", weight: 1 }]],
    ["BLOK", [{ sector: "Industrials", weight: 1 }]],
  ]);
  const exposure = buildSectorExposure(
    [
      { symbol: "ACME", marketValue: 300 },
      { symbol: "blok", marketValue: 100 },
      { symbol: "MYST", marketValue: 100 }, // no entry in weights at all
      { symbol: "ZERO", marketValue: null },
      { symbol: "NEG", marketValue: -50 },
    ],
    weights,
  );
  expect(exposure).toEqual([
    { sector: "Technology", weight: 0.6 },
    { sector: "Industrials", weight: 0.2 },
    { sector: "Unknown", weight: 0.2 },
  ]);
});

test("an unpriced portfolio has no exposure at all", () => {
  expect(buildSectorExposure([{ symbol: "ACME", marketValue: null }], new Map())).toEqual([]);
});

test("a fund position splits its market value across its own weight vector", () => {
  const weights = new Map([["VFEM.L", [
    { sector: "Technology", weight: 0.4 },
    { sector: "Financial Services", weight: 0.3 },
  ]]]);
  const exposure = buildSectorExposure([{ symbol: "VFEM.L", marketValue: 1000 }], weights);
  expect(exposure).toEqual([
    { sector: "Technology", weight: 0.4 },
    { sector: "Unknown", weight: 0.3 }, // 1 - (0.4+0.3) = 0.3 residual
    { sector: "Financial Services", weight: 0.3 },
  ]);
});

test("a fund with an empty weight vector (bond fund) is entirely Unknown, not an error", () => {
  const weights = new Map([["AGGG.L", []]]);
  expect(buildSectorExposure([{ symbol: "AGGG.L", marketValue: 500 }], weights)).toEqual([
    { sector: "Unknown", weight: 1 },
  ]);
});
```

(Sort order note: the existing sort is `weight desc, sector asc` — the third test's expected array order above must match that; adjust the literal order if the computed weights tie or differ from this sketch once the real numbers are in — verify by running, not by trusting this hand-computed ordering blindly.)

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm --filter @lavega/core test -- summary --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: FAIL — old signature takes `Map<string,string>`, type error / wrong grouping

- [ ] **Step 3: Rewrite `buildSectorExposure`**

```typescript
// packages/core/src/investing/summary.ts — replace lines 226-242
export type SectorWeight = { sector: string; weight: number };

export function buildSectorExposure(
  positions: readonly { symbol: string; marketValue: number | null }[],
  weightsBySymbol: ReadonlyMap<string, readonly SectorWeight[]>,
): SectorExposure[] {
  const totalsBySector = new Map<string, number>();
  let total = 0;
  for (const position of positions) {
    if (position.marketValue === null || position.marketValue <= 0) continue;
    const vector = weightsBySymbol.get(position.symbol.toUpperCase()) ?? [];
    let covered = 0;
    for (const { sector, weight } of vector) {
      totalsBySector.set(sector, (totalsBySector.get(sector) ?? 0) + position.marketValue * weight);
      covered += weight;
    }
    const residual = Math.max(0, 1 - covered);
    if (residual > 0)
      totalsBySector.set("Unknown", (totalsBySector.get("Unknown") ?? 0) + position.marketValue * residual);
    total += position.marketValue;
  }
  if (total <= 0) return [];
  return [...totalsBySector.entries()]
    .map(([sector, value]) => ({ sector, weight: value / total }))
    .sort((left, right) => right.weight - left.weight || left.sector.localeCompare(right.sector));
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @lavega/core test -- summary --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @lavega/core typecheck && pnpm run lint`

```bash
git add packages/core/src/investing/summary.ts packages/core/src/investing/summary.test.ts
git commit -m "$(cat <<'EOF'
buildSectorExposure accumulates a weight vector, not one label, per position

The one unavoidable structural change look-through requires (spike §3):
a position's sector classification is now a distribution, and a fund's
market value splits across every sector it holds. Any uncovered residual
— a fund whose Yahoo weights don't sum to 100%, or a bond fund's fully
empty weight vector — folds into the existing Unknown bucket rather than
being silently rounded up to fully classified.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `sectorResolution.ts` resolves weight vectors; consent-gated summary route

**Files:**
- Modify: `apps/investing-server/src/sectorResolution.ts`
- Modify: `apps/investing-server/src/sectorResolution.test.ts`
- Verify (no change expected, see Step 5): `apps/investing-server/src/app.ts`'s `/api/investing/summary` route

**Interfaces:**
- Consumes: `SectorProfile` (Task 1), `buildSectorExposure`/`SectorWeight` (Task 4).
- Produces: `PortfolioSectors = { sectorBySymbol: Map<string, string>; weightsBySymbol: Map<string, SectorWeight[]>; exposure: SectorExposure[] }`. `sectorBySymbol` keeps its existing meaning (one headline label per symbol — a stock's own sector, or a fund's single largest-weight sector) so Task 11 (Phase 2's per-position UI) has an obvious field to read; `weightsBySymbol` is new and carries the full distribution `buildSectorExposure` needs.

- [ ] **Step 1: Update the existing tests to the new profile/weight shape**

```typescript
// apps/investing-server/src/sectorResolution.test.ts — replace the whole file's profile literals
import { expect, test, vi } from "vitest";
import { createInMemorySectorProfileStore } from "./inMemorySectorProfileStore.js";
import { resolvePortfolioSectors, UNKNOWN_SECTOR } from "./sectorResolution.js";

const positions = [
  { symbol: "AAPL", marketValue: 75 },
  { symbol: "myst", marketValue: 25 },
  { symbol: "EMPTY", marketValue: null },
];

test("stored profiles classify priced positions and weight the exposure", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("AAPL", { kind: "stock", sector: "Technology", industry: "Hardware", source: "provider" });

  const { sectorBySymbol, exposure } = await resolvePortfolioSectors(positions, { store });

  expect(sectorBySymbol.get("AAPL")).toBe("Technology");
  expect(sectorBySymbol.get("MYST")).toBe(UNKNOWN_SECTOR);
  expect(exposure).toEqual([
    { sector: "Technology", weight: 0.75 },
    { sector: "Unknown", weight: 0.25 },
  ]);
});

test("without a fetch fallback nothing is fetched and nothing is written", async () => {
  const store = createInMemorySectorProfileStore();
  const set = vi.spyOn(store, "set");
  const fetchProfile = vi.fn();
  const { exposure } = await resolvePortfolioSectors(positions, { store });
  expect(fetchProfile).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
  expect(exposure).toEqual([{ sector: UNKNOWN_SECTOR, weight: 1 }]);
});

test("the fetch fallback persists what it resolves and degrades to Unknown on failure", async () => {
  const store = createInMemorySectorProfileStore();
  const fetchProfile = vi.fn(async (symbol: string) => {
    if (symbol === "myst") throw new Error("yahoo down");
    return { kind: "stock" as const, sector: "Technology", industry: "Hardware", source: "provider" as const };
  });
  const { sectorBySymbol } = await resolvePortfolioSectors(positions, { store, fetchProfile });
  expect(sectorBySymbol.get("AAPL")).toBe("Technology");
  expect(sectorBySymbol.get("MYST")).toBe(UNKNOWN_SECTOR);
  expect(await store.get("AAPL")).toMatchObject({ sector: "Technology" });
  expect(fetchProfile).toHaveBeenCalledTimes(2);
});

test("a fund profile's weights become the symbol's exposure split", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("VFEM.L", {
    kind: "fund",
    weights: [{ sector: "Technology", weight: 0.4 }, { sector: "Healthcare", weight: 0.5 }],
    source: "provider",
  });
  const { exposure } = await resolvePortfolioSectors(
    [{ symbol: "VFEM.L", marketValue: 100 }],
    { store },
  );
  expect(exposure).toEqual([
    { sector: "Healthcare", weight: 0.5 },
    { sector: "Technology", weight: 0.4 },
    { sector: "Unknown", weight: 0.1 },
  ]);
});

test("an unpriced portfolio has no exposure at all", async () => {
  expect(
    await resolvePortfolioSectors([{ symbol: "AAPL", marketValue: null }], {
      store: createInMemorySectorProfileStore(),
    }),
  ).toMatchObject({ exposure: [] });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm --filter @lavega/investing-server test -- sectorResolution --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: FAIL — `resolveSector` still returns a single string, fund profile branch doesn't exist

- [ ] **Step 3: Rewrite `sectorResolution.ts`**

```typescript
// apps/investing-server/src/sectorResolution.ts
import { buildSectorExposure, type SectorExposure, type SectorWeight } from "@lavega/core";
import type { SectorProfile } from "@lavega/adapters";
import type { SectorProfileStore } from "./inMemorySectorProfileStore.js";

export const UNKNOWN_SECTOR = "Unknown";

export type SectorProfileLookup = (symbol: string) => Promise<SectorProfile | null>;

export type SectorResolutionOptions = {
  store: SectorProfileStore;
  /** Provider fallback, persisted for next time. Omit it on read-only paths:
   *  stored profiles only, no provider call and no store write. */
  fetchProfile?: SectorProfileLookup;
};

export type PortfolioSectors = {
  /** Upper-cased symbol to one headline sector: a stock's own sector, or a
   *  fund's single largest-weight sector. For display where one label fits. */
  sectorBySymbol: Map<string, string>;
  /** Upper-cased symbol to its full resolved weight vector, before the
   *  residual-folding buildSectorExposure applies. */
  weightsBySymbol: Map<string, SectorWeight[]>;
  exposure: SectorExposure[];
};

/** The single sector-classification rule in the product. */
export async function resolvePortfolioSectors(
  positions: readonly { symbol: string; marketValue: number | null }[],
  options: SectorResolutionOptions,
): Promise<PortfolioSectors> {
  const weightsBySymbol = new Map<string, SectorWeight[]>();
  const sectorBySymbol = new Map<string, string>();
  for (const position of positions) {
    if (position.marketValue === null || position.marketValue <= 0) continue;
    const key = position.symbol.toUpperCase();
    if (weightsBySymbol.has(key)) continue;
    const weights = await resolveWeights(position.symbol, options);
    weightsBySymbol.set(key, weights);
    sectorBySymbol.set(key, weights[0]?.sector ?? UNKNOWN_SECTOR);
  }
  return { sectorBySymbol, weightsBySymbol, exposure: buildSectorExposure(positions, weightsBySymbol) };
}

async function resolveWeights(
  symbol: string,
  { store, fetchProfile }: SectorResolutionOptions,
): Promise<SectorWeight[]> {
  let profile = await store.get(symbol);
  if (!profile && fetchProfile) {
    try {
      profile = await fetchProfile(symbol);
      if (profile) await store.set(symbol, profile);
    } catch {
      profile = null;
    }
  }
  return profileToWeights(profile);
}

function profileToWeights(profile: SectorProfile | null): SectorWeight[] {
  if (!profile) return [];
  if (profile.kind === "stock") return [{ sector: profile.sector, weight: 1 }];
  return [...profile.weights].sort((left, right) => right.weight - left.weight);
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @lavega/investing-server test -- sectorResolution --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS

- [ ] **Step 5: Confirm `app.ts`'s summary route needs no change, then run its own test file**

`app.ts:273-276` destructures only `{ exposure }` from `resolvePortfolioSectors(...)`, which is unaffected by the new `weightsBySymbol` field. If PR #171 has merged, that call site already gates `fetchProfile` on `hasYahooConsent` — do not add a second gate. If it has not merged, stop here and rebase onto `master` first (Global Constraints).

Run: `pnpm --filter @lavega/investing-server test -- app.test --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS, no changes needed to `app.ts` itself in this task

- [ ] **Step 6: Full package test run, typecheck, lint**

Run: `pnpm --filter @lavega/investing-server test -- --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2 && pnpm --filter @lavega/investing-server typecheck && pnpm run lint`
Expected: all green, ≤101 warnings, no new ones

- [ ] **Step 7: Commit**

```bash
git add apps/investing-server/src/sectorResolution.ts apps/investing-server/src/sectorResolution.test.ts
git commit -m "$(cat <<'EOF'
resolvePortfolioSectors resolves a weight vector per symbol

A fund's stored profile now explodes into its own sector split via the new
buildSectorExposure; a stock keeps resolving to a single-entry vector, so
existing behavior for every non-fund symbol is unchanged. sectorBySymbol
keeps its old one-label-per-symbol meaning (a fund's largest weight) for
display call sites that want one string; weightsBySymbol carries the full
distribution.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Update the sector panel's caption to describe look-through

**Files:**
- Modify: `apps/investing-web/src/components/PortfolioSummaryCard.tsx` (current `master`) **or** `SectorAllocationCard.tsx` if PR #172 has merged by execution time — check `git log --oneline origin/master | grep -i "sector allocation"` or look for the file before starting this task.
- Test: matching `.test.tsx` for whichever file above

**Interfaces:**
- Consumes: nothing new — this is copy only, no data-shape change. `sectors` (from `usePortfolioSummary`) already renders as `{sector, weight}` pairs; that shape is untouched by Phase 1.

- [ ] **Step 1: Write the failing test**

```tsx
// PortfolioSummaryCard.test.tsx (or SectorAllocationCard.test.tsx) — add/replace
test("caption describes look-through instead of claiming funds are excluded", () => {
  render(<PortfolioSummaryCard />); // match this file's existing render setup (mocked summary resource) exactly
  expect(screen.queryByText(/underlying holdings are not included/i)).not.toBeInTheDocument();
  expect(screen.getByText(/look.?through/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm --filter @lavega/investing-web test -- PortfolioSummaryCard --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: FAIL, old caption text still present

- [ ] **Step 3: Update the caption**

```tsx
// apps/investing-web/src/components/PortfolioSummaryCard.tsx, replacing the text at the current line ~212-213
<p className="mt-2 text-xs text-muted-foreground">
  Fund holdings are looked through to their published sector weights; a small residual may still
  show as Unknown.
</p>
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @lavega/investing-web test -- PortfolioSummaryCard --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS

- [ ] **Step 5: Full web package test run, typecheck, lint**

Run: `pnpm --filter @lavega/investing-web test -- --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2 && pnpm --filter @lavega/investing-web typecheck && pnpm run lint`

- [ ] **Step 6: Commit**

```bash
git add apps/investing-web/src/components/PortfolioSummaryCard.tsx apps/investing-web/src/components/PortfolioSummaryCard.test.tsx
git commit -m "$(cat <<'EOF'
Update sector panel caption to describe look-through

Funds are no longer excluded from sector exposure (Task 5), so the caption
claiming otherwise was wrong. States the one real remaining limitation
instead: a fund whose published weights don't sum to 100% still leaves a
small residual as Unknown.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Phase 1 is PR-ready here.** `@lavega/core`, `@lavega/adapters`, `@lavega/investing-server`, `@lavega/investing-web`, `@lavega/database` all green; `pnpm run typecheck`; `pnpm run lint`. Open the PR per the `opening-a-pr` playbook once a human reviews this plan — not part of this planning document.

---

# Phase 2 — #135: labelled inference + owner correction (ships as PR2, stacked on PR1)

### Task 7: Database — new AI usage route, worst-case ceiling, and the owner-correction column

**Files:**
- Modify: `packages/database/src/index.ts`
- Create: `db/migrations/0018_sector_corrections.sql`
- Modify: `apps/investing-server/src/systemOneUsage.ts`
- Modify: `apps/investing-server/src/systemOne.ts`
- Test: `packages/database/src/migrations.test.ts`, `apps/investing-server/src/systemOne.test.ts`

**Interfaces:**
- Produces: `AiUsage["route"]` gains `"sector-inference"`. `PreferencesRepository` gains `getSectorCorrections(): Promise<Record<string,string>>`, `setSectorCorrection(symbol: string, sector: string): Promise<void>`, `clearSectorCorrection(symbol: string): Promise<void>`.
- Produces: `checkSystemOneBudget(userId, worstCaseCents?)` and `recordSystemOneUsage(model, inputTokens, outputTokens, userId, route?)` — both gain an optional trailing parameter so callers other than the portfolio agent can use their own route name and worst-case estimate; both default to today's values (`route: "portfolio-persona"`, cap check unchanged) so no existing caller needs to change.
- Produces: `createSystemOneProvider(deps)` gains an optional `route?: string` and `failedRequestInputTokens?: number` in `deps`, defaulting to today's `"portfolio-persona"` / `32_000` — a Choice call over instrument name/description is a few hundred tokens, not 32k, so the classifier (Task 8) passes its own, smaller ceiling.

- [ ] **Step 1: Write the failing migrations test**

```typescript
// packages/database/src/migrations.test.ts — add
test("investing.preferences gains a sector_corrections column, defaulting to an empty object", async () => {
  await db.exec("CREATE ROLE test_app_user"); // match however this file sets app.user_id for a scratch row — check an existing preferences-touching test in this file first
  const result = await db.query<{ sector_corrections: unknown }>(
    "SELECT sector_corrections FROM investing.preferences LIMIT 0",
  );
  expect(result.fields.some((f) => f.name === "sector_corrections")).toBe(true);
});
```

(If this file has no precedent for querying `investing.preferences` directly, simplify to an `information_schema.columns` check instead — do not invent a row-insert flow this file doesn't already use.)

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm --filter @lavega/database test -- migrations --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: FAIL, column doesn't exist

- [ ] **Step 3: Write the migration**

```sql
-- db/migrations/0018_sector_corrections.sql
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
 * An owner's correction to a symbol's sector, keyed by upper-cased symbol,
 * scoped to this account like every other column on this table. Unlike
 * investing.sector_profiles (0017), this genuinely is per-user: it's this
 * owner's judgment about a holding, not a fact about the instrument, and it
 * must outrank both the provider and any inference for their portfolio only.
 */
ALTER TABLE investing.preferences
  ADD COLUMN IF NOT EXISTS sector_corrections JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE investing.preferences
  ADD CONSTRAINT preferences_sector_corrections_object
  CHECK (jsonb_typeof(sector_corrections) = 'object');

COMMIT;
```

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @lavega/database test -- migrations --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS

- [ ] **Step 5: Extend `PreferencesRepository` and `AiUsage["route"]`**

```typescript
// packages/database/src/index.ts

export type AiUsage = {
  day: string;
  route: "categorize" | "extract-invoice" | "chat" | "travel" | "portfolio-persona" | "sector-inference";
  model: string;
  inputTokens: number;
  outputTokens: number;
  pages: number;
  searches: number;
  costCents: number;
};

export type PreferencesRepository = {
  getBenchmarkSymbols(): Promise<string[]>;
  setBenchmarkSymbols(symbols: readonly string[]): Promise<void>;
  getMarketDataConsent(): Promise<unknown | null>;
  setMarketDataConsent(decision: unknown): Promise<void>;
  getSectorCorrections(): Promise<Record<string, string>>;
  setSectorCorrection(symbol: string, sector: string): Promise<void>;
  clearSectorCorrection(symbol: string): Promise<void>;
};

// inside createPreferencesRepository, alongside the existing read/write helpers:
  const readCorrections = () => read<Record<string, string>>("sector_corrections", {});
  const writeCorrections = (value: Record<string, string>) => write("sector_corrections", value);
  return {
    getBenchmarkSymbols: () => read<string[]>("benchmark_symbols", []),
    setBenchmarkSymbols: (symbols) => write("benchmark_symbols", [...symbols]),
    getMarketDataConsent: () => read<unknown | null>("market_data_consent", null),
    setMarketDataConsent: (decision) => write("market_data_consent", decision),
    getSectorCorrections: readCorrections,
    async setSectorCorrection(symbol, sector) {
      const current = await readCorrections();
      await writeCorrections({ ...current, [symbol.toUpperCase()]: sector });
    },
    async clearSectorCorrection(symbol) {
      const current = await readCorrections();
      const { [symbol.toUpperCase()]: _removed, ...rest } = current;
      await writeCorrections(rest);
    },
  };
```

- [ ] **Step 6: Widen `systemOneUsage.ts` and `systemOne.ts` with optional, backward-compatible route/ceiling parameters**

```typescript
// apps/investing-server/src/systemOneUsage.ts
export async function checkSystemOneBudget(
  userId = "unscoped",
): Promise<SystemOneBudget> {
  // unchanged body — the cap is per-account across all routes, by design (spentCents sums every route)
}

export async function recordSystemOneUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  userId = "unscoped",
  route: AiUsage["route"] = "portfolio-persona",
): Promise<void> {
  const { day, month } = parts();
  const costCents = Math.max(1, Math.ceil((inputTokens / 1_000_000) * INPUT_EUR_CENTS_PER_MILLION));
  const database = databaseSource();
  if (database) {
    await createAiUsageRepository(database).record({
      userId, day, route, model, inputTokens, outputTokens, pages: 0, searches: 0, costCents,
    });
    return;
  }
  memory.set(`day:${userId}:${day}`, (memory.get(`day:${userId}:${day}`) ?? 0) + costCents);
  memory.set(`month:${userId}:${month}`, (memory.get(`month:${userId}:${month}`) ?? 0) + costCents);
}
```

```typescript
// apps/investing-server/src/systemOne.ts
export function createSystemOneProvider(
  deps: {
    client?: SystemOneClient;
    config?: SystemOneConfig;
    userId?: string;
    route?: string; // AiUsage["route"], kept as string here to avoid an investing-server -> database type import
    failedRequestInputTokens?: number;
    checkBudget?: () => Promise<{ ok: true } | { ok: false; scope: "day" | "month" }>;
    recordUsage?: (model: string, inputTokens: number, outputTokens: number) => Promise<void>;
  } = {},
): SystemOneProvider {
  const config = deps.config ?? resolveSystemOneConfig();
  const client = deps.client ?? new TypeSafeClient({ apiKey: config.apiKey, defaultModel: config.model });
  const userId = deps.userId;
  const route = deps.route ?? "portfolio-persona";
  const failedRequestInputTokens = deps.failedRequestInputTokens ?? FAILED_REQUEST_INPUT_TOKENS;
  const gate = deps.checkBudget ?? (() => checkSystemOneBudget(userId));
  const record =
    deps.recordUsage ??
    ((model: string, inputTokens: number, outputTokens: number) =>
      recordSystemOneUsage(model, inputTokens, outputTokens, userId, route as never));
  return {
    async judge(request) {
      assertStateSize(request.state);
      const budget = await gate();
      if (!budget.ok) throw new Error(`System One budget exhausted for ${budget.scope}`);
      let result;
      try {
        result = await client.systemOne({ state: request.state, questions: request.questions, model: request.model ?? config.model });
      } catch (error) {
        await record(request.model ?? config.model, failedRequestInputTokens, 0);
        throw error;
      }
      await record(result.model, result.usage.input_tokens, result.usage.output_tokens);
      return { model: result.model, answers: result.answers, usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens } };
    },
  };
}
```

- [ ] **Step 7: Write the failing/updated `systemOne.test.ts` case for a non-default route**

```typescript
// apps/investing-server/src/systemOne.test.ts — add
test("a caller-supplied route and failed-request ceiling are recorded instead of the portfolio-persona defaults", async () => {
  const recordUsage = vi.fn();
  const provider = createSystemOneProvider({
    client: { systemOne: vi.fn().mockRejectedValue(new Error("down")) },
    checkBudget: async () => ({ ok: true }),
    recordUsage,
    route: "sector-inference",
    failedRequestInputTokens: 500,
  });
  await expect(provider.judge({ state: "x", questions: {} })).rejects.toThrow("down");
  expect(recordUsage).toHaveBeenCalledWith(expect.any(String), 500, 0);
});
```

- [ ] **Step 8: Run all three affected suites, confirm pass**

Run: `pnpm --filter @lavega/database test -- --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2 && pnpm --filter @lavega/investing-server test -- systemOne --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS

- [ ] **Step 9: Typecheck, lint, commit**

Run: `pnpm --filter @lavega/database typecheck && pnpm --filter @lavega/investing-server typecheck && pnpm run lint`

```bash
git add packages/database/src/index.ts packages/database/src/migrations.test.ts \
  db/migrations/0018_sector_corrections.sql apps/investing-server/src/systemOneUsage.ts \
  apps/investing-server/src/systemOne.ts apps/investing-server/src/systemOne.test.ts
git commit -m "$(cat <<'EOF'
Add the sector-inference AI usage route and the owner-correction column

sector-inference joins the existing route union so its spend is visible in
the same ledger as portfolio-persona, sharing the same per-account day/month
cap. Its System One calls carry their own, much smaller failed-request
token ceiling (a Choice over instrument name/description, not a full
portfolio snapshot). sector_corrections is a new per-user JSONB column on
the existing investing.preferences row, deliberately not a new table: it's
this owner's opinion about their own holding, scoped like every other
preference on that row.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The System One sector classifier

**Files:**
- Create: `apps/investing-server/src/sectorClassifier.ts`
- Test: `apps/investing-server/src/sectorClassifier.test.ts`
- Modify: `packages/core/src/investing/sectorTaxonomy.ts` (add the division fallback map)

**Interfaces:**
- Consumes: `GICS_SECTOR_LABELS` (Task 1), `SystemOneProvider`/`createSystemOneProvider` (Task 7).
- Produces: `SectorClassification = { sector: string; confidence: number }` (already resolved to sector-or-division by the classifier — callers never see the raw Choice response) and `createSystemOneSectorClassifier(provider: SystemOneProvider, threshold?: number): (instrument: { symbol: string; description?: string }) => Promise<SectorClassification | null>`. Returns `null` only for the explicit no-match option — never throws (matches `fetchYahooSectorProfile`'s "never throws" contract so `sectorResolution.ts` can treat both provider and classifier failures identically).

- [ ] **Step 1: Add the division fallback map to `sectorTaxonomy.ts`**

```typescript
// packages/core/src/investing/sectorTaxonomy.ts — append
/** The 11 GICS sectors grouped into the classic three economic-sensitivity
 *  super-sectors (Cyclical / Defensive / Sensitive). Used only as the
 *  System One classifier's fallback label when its confidence in a specific
 *  sector is low — reported instead of discarding the answer, per issue #135
 *  ("the broad label is derivable from the narrow answer with no extra
 *  request"). This 3-way split isn't the only one in use across the industry
 *  (Fidelity's own public materials group Real Estate and Communication
 *  Services inconsistently across sources); it is a defensible first cut,
 *  not a verified-authoritative one — the confidence threshold below it is
 *  explicitly a placeholder to measure and tune, not a final number. */
export const SECTOR_TO_DIVISION: Record<GicsSectorLabel, "Cyclical" | "Defensive" | "Sensitive"> = {
  "Consumer Cyclical": "Cyclical",
  "Financial Services": "Cyclical",
  "Real Estate": "Cyclical",
  "Basic Materials": "Cyclical",
  "Consumer Defensive": "Defensive",
  Healthcare: "Defensive",
  Utilities: "Defensive",
  "Communication Services": "Sensitive",
  Energy: "Sensitive",
  Industrials: "Sensitive",
  Technology: "Sensitive",
};
```

- [ ] **Step 2: Write the failing classifier test**

```typescript
// apps/investing-server/src/sectorClassifier.test.ts
import { expect, test, vi } from "vitest";
import { createSystemOneSectorClassifier } from "./sectorClassifier.js";

function providerReturning(choice: string, confidence: number) {
  return { judge: vi.fn().mockResolvedValue({ model: "jev-1.13.0", answers: { sector: { type: "choice", choice, confidence, probabilities: {} } }, usage: { inputTokens: 1, outputTokens: 1 } }) };
}

test("a confident answer reports the sector itself", async () => {
  const classifier = createSystemOneSectorClassifier(providerReturning("Technology", 0.9), 0.6);
  expect(await classifier({ symbol: "ACME", description: "Acme Cloud Software Inc" })).toEqual({
    sector: "Technology",
    confidence: 0.9,
  });
});

test("an unconfident answer reports the broader division instead", async () => {
  const classifier = createSystemOneSectorClassifier(providerReturning("Technology", 0.3), 0.6);
  expect(await classifier({ symbol: "ACME" })).toEqual({ sector: "Sensitive", confidence: 0.3 });
});

test("an explicit no-match resolves to null, mapped to Unknown by the caller", async () => {
  const classifier = createSystemOneSectorClassifier(providerReturning("NoMatch", 0.95), 0.6);
  expect(await classifier({ symbol: "ACME" })).toBeNull();
});

test("sends only symbol and description as state — never holdings, quantity, or value", async () => {
  const provider = providerReturning("Technology", 0.9);
  const classifier = createSystemOneSectorClassifier(provider, 0.6);
  await classifier({ symbol: "ACME", description: "Acme Cloud Software Inc" });
  const [request] = provider.judge.mock.calls[0]!;
  expect(JSON.stringify(request.state)).not.toMatch(/quantity|marketValue|holding/i);
});
```

- [ ] **Step 3: Run, confirm failure**

Run: `pnpm --filter @lavega/investing-server test -- sectorClassifier --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: FAIL, module doesn't exist

- [ ] **Step 4: Implement it**

```typescript
// apps/investing-server/src/sectorClassifier.ts
import { GICS_SECTOR_LABELS, SECTOR_TO_DIVISION, type GicsSectorLabel } from "@lavega/core";
import type { SystemOneProvider } from "./systemOne.js";

/** Set once and measured, per issue #135's own "Tuning the confidence
 *  threshold" out-of-scope note — not a claim about the right number. */
export const SECTOR_INFERENCE_CONFIDENCE_THRESHOLD = 0.6;

const NO_MATCH = "NoMatch";

export type SectorClassification = { sector: string; confidence: number };
export type SectorClassifier = (
  instrument: { symbol: string; description?: string },
) => Promise<SectorClassification | null>;

const CRITERIA: Record<string, string> = Object.fromEntries([
  ...GICS_SECTOR_LABELS.map((label) => [label, sectorDescription(label)]),
  [NO_MATCH, "No listed GICS sector plausibly describes this instrument."],
]);

function sectorDescription(label: GicsSectorLabel): string {
  const descriptions: Record<GicsSectorLabel, string> = {
    Technology: "Software, hardware, semiconductors, IT services.",
    "Financial Services": "Banks, insurers, asset managers, exchanges, payments.",
    Healthcare: "Pharmaceuticals, biotech, medical devices, healthcare providers.",
    "Consumer Cyclical": "Retail, autos, travel, leisure, discretionary consumer goods.",
    "Consumer Defensive": "Food, beverages, household staples, discount retail.",
    "Communication Services": "Telecoms, media, entertainment, internet platforms.",
    Industrials: "Manufacturing, aerospace, defense, transport, business services.",
    Energy: "Oil, gas, coal, energy exploration and production.",
    Utilities: "Electric, gas, and water utilities.",
    "Basic Materials": "Chemicals, mining, metals, forestry, construction materials.",
    "Real Estate": "REITs and real-estate management and development.",
  };
  return descriptions[label];
}

/** Never throws — a failed or ambiguous classification degrades to `null`,
 *  the same contract fetchYahooSectorProfile already has, so sectorResolution
 *  can treat a missing provider profile and a missing inference identically. */
export function createSystemOneSectorClassifier(
  provider: SystemOneProvider,
  threshold = SECTOR_INFERENCE_CONFIDENCE_THRESHOLD,
): SectorClassifier {
  return async (instrument) => {
    try {
      const result = await provider.judge({
        state: { symbol: instrument.symbol, description: instrument.description ?? null },
        questions: {
          sector: {
            type: "choice",
            instructions:
              "Classify this financial instrument into one GICS sector, using only its symbol and description.",
            criteria: CRITERIA,
          },
        },
      });
      const answer = result.answers.sector;
      if (!answer || answer.type !== "choice" || answer.choice === NO_MATCH) return null;
      if (answer.confidence >= threshold) return { sector: answer.choice, confidence: answer.confidence };
      const division = SECTOR_TO_DIVISION[answer.choice as GicsSectorLabel];
      return division ? { sector: division, confidence: answer.confidence } : null;
    } catch {
      return null;
    }
  };
}
```

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @lavega/investing-server test -- sectorClassifier --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS

- [ ] **Step 6: Typecheck, lint, commit**

Run: `pnpm --filter @lavega/core typecheck && pnpm --filter @lavega/investing-server typecheck && pnpm run lint`

```bash
git add packages/core/src/investing/sectorTaxonomy.ts apps/investing-server/src/sectorClassifier.ts \
  apps/investing-server/src/sectorClassifier.test.ts
git commit -m "$(cat <<'EOF'
Add the System One sector classifier

One Choice over the 11 GICS sectors plus an explicit no-match option, state
limited to the instrument's own symbol and description. A confident answer
reports the sector; an unconfident one reports the Cyclical/Defensive/
Sensitive super-sector it rolls up into, from the same response with no
second call. No-match resolves to null, exactly like a failed provider
fetch, so sectorResolution treats the two identically.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Precedence ladder — `sectorResolution.ts` gains correction and classifier tiers

**Files:**
- Modify: `apps/investing-server/src/sectorResolution.ts`
- Modify: `apps/investing-server/src/sectorResolution.test.ts`

**Interfaces:**
- Consumes: `SectorClassifier` (Task 8), `SectorProfile`'s `source` field (Task 1/2).
- Produces: `SectorResolutionOptions` gains `correction?: (symbol: string) => Promise<string | null>` (always safe to pass, even read-only — it's a cheap read, never a paid call or a write) and `classifier?: (instrument: {symbol, description?}) => Promise<{sector,confidence}|null>` (omit on read-only paths, same discipline as `fetchProfile`). `SectorProfile`'s stock variant gains `confidence?: number`, present only when `source === "inferred"`.

- [ ] **Step 1: Write the failing precedence tests**

```typescript
// apps/investing-server/src/sectorResolution.test.ts — add
test("an owner correction outranks everything and triggers no fetch or classification", async () => {
  const store = createInMemorySectorProfileStore();
  const fetchProfile = vi.fn();
  const classifier = vi.fn();
  const correction = vi.fn(async (symbol: string) => (symbol === "AAPL" ? "Healthcare" : null));

  const { sectorBySymbol } = await resolvePortfolioSectors(positions, {
    store, fetchProfile, classifier, correction,
  });

  expect(sectorBySymbol.get("AAPL")).toBe("Healthcare");
  expect(fetchProfile).not.toHaveBeenCalledWith("AAPL");
  expect(classifier).not.toHaveBeenCalledWith(expect.objectContaining({ symbol: "AAPL" }));
});

test("a provider profile is used and the classifier is never called", async () => {
  const store = createInMemorySectorProfileStore();
  const classifier = vi.fn();
  const fetchProfile = vi.fn(async () => ({ kind: "stock" as const, sector: "Technology", industry: "Hardware", source: "provider" as const }));
  await resolvePortfolioSectors([{ symbol: "AAPL", marketValue: 100 }], { store, fetchProfile, classifier });
  expect(classifier).not.toHaveBeenCalled();
});

test("the classifier fills a real gap and is persisted with source inferred", async () => {
  const store = createInMemorySectorProfileStore();
  const fetchProfile = vi.fn(async () => null);
  const classifier = vi.fn(async () => ({ sector: "Technology", confidence: 0.9 }));
  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100, description: "Myst Robotics" }], {
    store, fetchProfile, classifier,
  });
  expect(sectorBySymbol.get("MYST")).toBe("Technology");
  expect(await store.get("MYST")).toEqual({ kind: "stock", sector: "Technology", industry: "Unknown", source: "inferred", confidence: 0.9 });
});

test("a cached inferred profile is reused without re-invoking the classifier, but the provider is still retried", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("MYST", { kind: "stock", sector: "Technology", industry: "Unknown", source: "inferred", confidence: 0.7 });
  const fetchProfile = vi.fn(async () => null);
  const classifier = vi.fn();
  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], { store, fetchProfile, classifier });
  expect(classifier).not.toHaveBeenCalled();
  expect(fetchProfile).toHaveBeenCalledWith("MYST");
  expect(sectorBySymbol.get("MYST")).toBe("Technology");
});

test("a later provider answer replaces a cached inferred profile", async () => {
  const store = createInMemorySectorProfileStore();
  await store.set("MYST", { kind: "stock", sector: "Technology", industry: "Unknown", source: "inferred", confidence: 0.7 });
  const fetchProfile = vi.fn(async () => ({ kind: "stock" as const, sector: "Healthcare", industry: "Biotech", source: "provider" as const }));
  const { sectorBySymbol } = await resolvePortfolioSectors([{ symbol: "MYST", marketValue: 100 }], { store, fetchProfile });
  expect(sectorBySymbol.get("MYST")).toBe("Healthcare");
  expect(await store.get("MYST")).toMatchObject({ source: "provider" });
});

test("read-only paths omitting classifier and correction cause no calls and no writes, same as omitting fetchProfile", async () => {
  const store = createInMemorySectorProfileStore();
  const set = vi.spyOn(store, "set");
  const { exposure } = await resolvePortfolioSectors(positions, { store });
  expect(set).not.toHaveBeenCalled();
  expect(exposure).toEqual([{ sector: UNKNOWN_SECTOR, weight: 1 }]);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm --filter @lavega/investing-server test -- sectorResolution --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: FAIL — `correction`/`classifier` options don't exist yet; position `description` isn't threaded to the classifier

- [ ] **Step 3: Rewrite `resolveWeights` with the full precedence ladder**

```typescript
// apps/investing-server/src/sectorResolution.ts
import { buildSectorExposure, type SectorExposure, type SectorWeight } from "@lavega/core";
import type { SectorProfile } from "@lavega/adapters";
import type { SectorProfileStore } from "./inMemorySectorProfileStore.js";

export const UNKNOWN_SECTOR = "Unknown";

export type SectorProfileLookup = (symbol: string) => Promise<SectorProfile | null>;
export type SectorCorrectionLookup = (symbol: string) => Promise<string | null>;
export type SectorClassifierLookup = (
  instrument: { symbol: string; description?: string },
) => Promise<{ sector: string; confidence: number } | null>;

export type SectorResolutionOptions = {
  store: SectorProfileStore;
  /** Provider fallback, persisted for next time. Omit on read-only paths. */
  fetchProfile?: SectorProfileLookup;
  /** The owner's own override for this symbol. Cheap and side-effect-free
   *  (a preferences read) — always safe to pass, including on read-only
   *  paths; it never calls out or writes. */
  correction?: SectorCorrectionLookup;
  /** System One classification, persisted with source "inferred". Omit on
   *  read-only paths and whenever consent/the enable flag say no — the same
   *  discipline fetchProfile already has. */
  classifier?: SectorClassifierLookup;
};

export type PortfolioSectors = {
  sectorBySymbol: Map<string, string>;
  weightsBySymbol: Map<string, SectorWeight[]>;
  exposure: SectorExposure[];
};

export async function resolvePortfolioSectors(
  positions: readonly { symbol: string; marketValue: number | null; description?: string }[],
  options: SectorResolutionOptions,
): Promise<PortfolioSectors> {
  const weightsBySymbol = new Map<string, SectorWeight[]>();
  const sectorBySymbol = new Map<string, string>();
  for (const position of positions) {
    if (position.marketValue === null || position.marketValue <= 0) continue;
    const key = position.symbol.toUpperCase();
    if (weightsBySymbol.has(key)) continue;
    const weights = await resolveWeights(position, options);
    weightsBySymbol.set(key, weights);
    sectorBySymbol.set(key, weights[0]?.sector ?? UNKNOWN_SECTOR);
  }
  return { sectorBySymbol, weightsBySymbol, exposure: buildSectorExposure(positions, weightsBySymbol) };
}

async function resolveWeights(
  position: { symbol: string; description?: string },
  { store, fetchProfile, correction, classifier }: SectorResolutionOptions,
): Promise<SectorWeight[]> {
  const symbol = position.symbol;
  const corrected = correction ? await correction(symbol) : null;
  if (corrected) return [{ sector: corrected, weight: 1 }];

  let profile = await store.get(symbol);
  if ((!profile || profile.source === "inferred") && fetchProfile) {
    try {
      const fetched = await fetchProfile(symbol);
      if (fetched) {
        profile = fetched;
        await store.set(symbol, profile);
      }
    } catch {
      /* keep whatever was already stored, if anything */
    }
  }
  if (!profile && classifier) {
    const guess = await classifier({ symbol, description: position.description });
    if (guess) {
      profile = {
        kind: "stock",
        sector: guess.sector,
        industry: "Unknown",
        source: "inferred",
        confidence: guess.confidence,
      };
      await store.set(symbol, profile);
    }
  }
  return profileToWeights(profile);
}

function profileToWeights(profile: SectorProfile | null): SectorWeight[] {
  if (!profile) return [];
  if (profile.kind === "stock") return [{ sector: profile.sector, weight: 1 }];
  return [...profile.weights].sort((left, right) => right.weight - left.weight);
}
```

Also add `confidence?: number` to `StockSectorProfile` and widen `source` to `"provider" | "inferred"` in `packages/adapters/src/market-data/yahoo/sectorProfile.ts` (Task 1's type) — a one-line type edit, no behavior change to that file, since it only ever constructs `source: "provider"` profiles itself.

- [ ] **Step 4: Run, confirm pass**

Run: `pnpm --filter @lavega/investing-server test -- sectorResolution --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @lavega/adapters typecheck && pnpm --filter @lavega/investing-server typecheck && pnpm run lint`

```bash
git add apps/investing-server/src/sectorResolution.ts apps/investing-server/src/sectorResolution.test.ts \
  packages/adapters/src/market-data/yahoo/sectorProfile.ts
git commit -m "$(cat <<'EOF'
Sector resolution gains the owner-correction and inference precedence tiers

Precedence, highest first: owner correction, provider, inferred, Unknown.
A correction short-circuits everything else for that symbol. A stored
inferred profile is reused without re-invoking the classifier (paid once
per symbol, not once per render) but a cheap provider retry still runs
every resolution, so a later real answer can replace the guess. Both new
dependencies follow the existing fetchProfile discipline: omit them and
nothing is called and nothing is written.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Wire consent, the enable flag, and the per-position sector routes into `app.ts`

**Files:**
- Modify: `apps/investing-server/src/app.ts`
- Modify: `apps/investing-server/src/index.ts` (classifier/correction wiring, `SECTOR_INFERENCE_ENABLED` flag)
- Modify: `apps/investing-server/src/sectorCorrectionStore.ts` (new file, tenant-scoped store contract + in-memory impl)
- Test: `apps/investing-server/src/app.test.ts`

**Interfaces:**
- Produces: `SectorCorrectionStore = { get(tenantId, symbol): Promise<string|null>; set(tenantId, symbol, sector): Promise<void>; clear(tenantId, symbol): Promise<void> }`, `createInMemorySectorCorrectionStore(): SectorCorrectionStore`. Neon-backed version wraps Task 7's `PreferencesRepository` methods (wire in `investing-mount.ts` alongside the other Neon preference-backed stores — same file, same pattern, not written out again here since it's a direct pass-through).
- Produces: `GET /api/investing/positions/:symbol/sector` → `{ sector: string, source: "provider"|"inferred"|"unknown", confidence?: number }`; `PUT /api/investing/positions/:symbol/sector` → body `{ sector: string }`, validated against `GICS_SECTOR_LABELS`, `204` on success, `400` on an unrecognized sector.

- [ ] **Step 1: Write `sectorCorrectionStore.ts`**

```typescript
// apps/investing-server/src/sectorCorrectionStore.ts
export type SectorCorrectionStore = {
  get(tenantId: string, symbol: string): Promise<string | null>;
  set(tenantId: string, symbol: string, sector: string): Promise<void>;
  clear(tenantId: string, symbol: string): Promise<void>;
};

export function createInMemorySectorCorrectionStore(): SectorCorrectionStore {
  const corrections = new Map<string, Record<string, string>>();
  const key = (symbol: string) => symbol.toUpperCase();
  return {
    async get(tenantId, symbol) {
      return corrections.get(tenantId)?.[key(symbol)] ?? null;
    },
    async set(tenantId, symbol, sector) {
      corrections.set(tenantId, { ...(corrections.get(tenantId) ?? {}), [key(symbol)]: sector });
    },
    async clear(tenantId, symbol) {
      const current = { ...(corrections.get(tenantId) ?? {}) };
      delete current[key(symbol)];
      corrections.set(tenantId, current);
    },
  };
}
```

- [ ] **Step 2: Write the failing route tests**

```typescript
// apps/investing-server/src/app.test.ts — add, matching this file's existing createApp()/request-building conventions
test("GET position sector reads the resolved sector for that symbol", async () => {
  const sectorStore = createInMemorySectorProfileStore();
  await sectorStore.set("AAPL", { kind: "stock", sector: "Technology", industry: "Hardware", source: "provider" });
  const app = createApp({ sectorStore, dashboardReader: async () => ({ ...emptyInvestingDashboard(), positions: [{ symbol: "AAPL", marketValue: 100, description: "Apple" }] }) });
  const res = await app.request("/api/investing/positions/AAPL/sector");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ sector: "Technology", source: "provider" });
});

test("PUT position sector rejects a label outside the GICS set", async () => {
  const app = createApp({});
  const res = await app.request("/api/investing/positions/AAPL/sector", {
    method: "PUT", body: JSON.stringify({ sector: "Not A Sector" }), headers: { "content-type": "application/json" },
  });
  expect(res.status).toBe(400);
});

test("PUT position sector then GET reflects the correction immediately, no provider call", async () => {
  const fetchProfile = vi.fn();
  const app = createApp({ sectorProfile: fetchProfile, dashboardReader: async () => ({ ...emptyInvestingDashboard(), positions: [{ symbol: "AAPL", marketValue: 100 }] }) });
  await app.request("/api/investing/positions/AAPL/sector", { method: "PUT", body: JSON.stringify({ sector: "Healthcare" }), headers: { "content-type": "application/json" } });
  const res = await app.request("/api/investing/positions/AAPL/sector");
  expect(await res.json()).toMatchObject({ sector: "Healthcare" });
  expect(fetchProfile).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run, confirm failure**

Run: `pnpm --filter @lavega/investing-server test -- app.test --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: FAIL, routes 404

- [ ] **Step 4: Add the dependencies and routes to `app.ts`**

```typescript
// apps/investing-server/src/app.ts — add to PriceDependencies
  sectorCorrectionStore: SectorCorrectionStore;
  sectorClassifier?: SectorClassifierLookup;

// inside createApp():
  const sectorCorrectionStore = dependencies.sectorCorrectionStore ?? createInMemorySectorCorrectionStore();

// new routes, alongside the existing /api/investing/summary route:
  investingApp.get("/api/investing/positions/:symbol/sector", async (c) => {
    const symbol = c.req.param("symbol");
    const tenantId = await resolveTenantId();
    const corrected = await sectorCorrectionStore.get(tenantId, symbol);
    if (corrected) return c.json({ sector: corrected, source: "correction" as const });
    const profile = await sectorStore.get(symbol);
    if (!profile) return c.json({ sector: UNKNOWN_SECTOR, source: "unknown" as const });
    if (profile.kind === "fund")
      return c.json({ sector: profile.weights[0]?.sector ?? UNKNOWN_SECTOR, source: "provider" as const });
    return c.json({
      sector: profile.sector,
      source: profile.source,
      ...(profile.source === "inferred" ? { confidence: profile.confidence } : {}),
    });
  });
  investingApp.put("/api/investing/positions/:symbol/sector", async (c) => {
    const symbol = c.req.param("symbol");
    const body: { sector?: unknown } = await c.req.json().catch(() => ({}));
    if (typeof body.sector !== "string" || !GICS_SECTOR_LABELS.includes(body.sector as never))
      return c.json({ message: "sector must be one of the GICS sector labels" }, 400);
    await sectorCorrectionStore.set(await resolveTenantId(), symbol, body.sector);
    return c.body(null, 204);
  });
```

Pass `correction: (symbol) => sectorCorrectionStore.get(tenantId, symbol)` (closing over the already-resolved `tenantId`) and, when `hasYahooConsent(tenantId)` and `process.env.SECTOR_INFERENCE_ENABLED === "1"`, `classifier: dependencies.sectorClassifier` into the existing `resolvePortfolioSectors` call in the summary route — both additive, optional arguments; the route's existing shape and error handling are unchanged.

- [ ] **Step 5: Wire the enable flag and classifier construction in `index.ts`**

```typescript
// apps/investing-server/src/index.ts — alongside sectorDependencies
  const sectorInferenceEnabled = process.env.SECTOR_INFERENCE_ENABLED === "1";
  const sectorClassifier = sectorInferenceEnabled
    ? createSystemOneSectorClassifier(
        createSystemOneProvider({ userId: tenantId, route: "sector-inference", failedRequestInputTokens: 500 }),
      )
    : undefined;
```

Two separate gates stay separate on purpose: a set `TYPESAFE_API_KEY` alone must not turn on a new AI-cost feature (the exact production mistake this codebase already hit once with `ANTHROPIC_API_KEY` being present but the feature dark — see the LaVega project memory on that). `SECTOR_INFERENCE_ENABLED` is a second, explicit switch.

- [ ] **Step 6: Run, confirm pass**

Run: `pnpm --filter @lavega/investing-server test -- app.test --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS

- [ ] **Step 7: Full server-package run, typecheck, lint, commit**

Run: `pnpm --filter @lavega/investing-server test -- --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2 && pnpm --filter @lavega/investing-server typecheck && pnpm run lint`

```bash
git add apps/investing-server/src/app.ts apps/investing-server/src/index.ts \
  apps/investing-server/src/sectorCorrectionStore.ts apps/investing-server/src/app.test.ts
git commit -m "$(cat <<'EOF'
Wire consent, the enable flag, and per-position sector routes

GET/PUT /api/investing/positions/:symbol/sector expose and let the owner
correct one position's sector. Inference is gated on two independent
switches — market-data consent and SECTOR_INFERENCE_ENABLED — so a set
TYPESAFE_API_KEY alone can never silently turn on a paid classification
path, the same mistake this app already made once with ANTHROPIC_API_KEY.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Minimal Position Detail UI — sector display and correction control

**Files:**
- Create: `apps/investing-web/src/components/PositionSectorControl.tsx`
- Test: `apps/investing-web/src/components/PositionSectorControl.test.tsx`
- Modify: `apps/investing-web/src/app.tsx` (`PositionDetailSummary`, ~line 2018-2061)

**Interfaces:**
- Consumes: `GET/PUT /api/investing/positions/:symbol/sector` (Task 10).
- Produces: `<PositionSectorControl symbol={string} />` — fetches on mount, renders the sector label with a small "inferred"/"your correction" badge when `source !== "provider"`, and a `<select>` of `GICS_SECTOR_LABELS` plus a Save button that `PUT`s and refetches.

- [ ] **Step 1: Write the failing component test**

```tsx
// apps/investing-web/src/components/PositionSectorControl.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PositionSectorControl } from "./PositionSectorControl";

test("shows the resolved sector and an inferred badge when the source is inferred", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ sector: "Technology", source: "inferred", confidence: 0.7 }),
  }));
  render(<PositionSectorControl symbol="MYST" />);
  await waitFor(() => expect(screen.getByText("Technology")).toBeInTheDocument());
  expect(screen.getByText(/inferred/i)).toBeInTheDocument();
});

test("saving a correction PUTs the chosen sector and shows it without a badge", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ sector: "Technology", source: "inferred", confidence: 0.7 }) })
    .mockResolvedValueOnce({ ok: true, status: 204 })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ sector: "Healthcare", source: "correction" }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<PositionSectorControl symbol="MYST" />);
  await waitFor(() => screen.getByText("Technology"));
  await userEvent.selectOptions(screen.getByLabelText(/correct sector/i), "Healthcare");
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() => expect(screen.getByText("Healthcare")).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/investing/positions/MYST/sector",
    expect.objectContaining({ method: "PUT" }),
  );
  expect(screen.queryByText(/inferred/i)).not.toBeInTheDocument();
});
```

(Match this repo's existing fetch-mocking convention in a neighboring `.test.tsx` file — some components in this codebase use MSW instead of `vi.stubGlobal("fetch", ...)`; check `PositionPriceChart.test.tsx` or similar before writing this step for real, and use whichever pattern that file already uses.)

- [ ] **Step 2: Run, confirm failure**

Run: `pnpm --filter @lavega/investing-web test -- PositionSectorControl --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: FAIL, module doesn't exist

- [ ] **Step 3: Implement it**

```tsx
// apps/investing-web/src/components/PositionSectorControl.tsx
import { useEffect, useState } from "react";
import { GICS_SECTOR_LABELS } from "@lavega/core";

type SectorState = { sector: string; source: "provider" | "inferred" | "correction" | "unknown"; confidence?: number };

export function PositionSectorControl({ symbol }: { symbol: string }) {
  const [state, setState] = useState<SectorState | null>(null);
  const [selection, setSelection] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch(`/api/investing/positions/${encodeURIComponent(symbol)}/sector`);
    if (res.ok) setState(await res.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (!state) return null;

  const badge =
    state.source === "inferred" ? (
      <span className="ml-2 rounded-pill bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
        inferred{state.confidence !== undefined ? ` · ${Math.round(state.confidence * 100)}%` : ""}
      </span>
    ) : state.source === "correction" ? (
      <span className="ml-2 rounded-pill bg-secondary px-2 py-0.5 text-xs text-muted-foreground">your correction</span>
    ) : null;

  async function save() {
    if (!selection) return;
    setSaving(true);
    try {
      await fetch(`/api/investing/positions/${encodeURIComponent(symbol)}/sector`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sector: selection }),
      });
      await load();
      setSelection("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
      <span>
        Sector: <span className="font-semibold">{state.sector}</span>
        {badge}
      </span>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Correct sector
        <select
          aria-label="Correct sector"
          className="rounded-md border bg-background px-2 py-1"
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
        >
          <option value="">Choose…</option>
          {GICS_SECTOR_LABELS.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="rounded-md border px-2 py-1 text-xs disabled:opacity-50"
        disabled={!selection || saving}
        onClick={save}
      >
        Save
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Mount it in `PositionDetailSummary`**

```tsx
// apps/investing-web/src/app.tsx — inside PositionDetailSummary, after the closing </dl> (~line 2115)
      <PositionSectorControl symbol={position.symbol} />
```

Add the import alongside `app.tsx`'s existing component imports at the top of the file.

- [ ] **Step 5: Run, confirm pass**

Run: `pnpm --filter @lavega/investing-web test -- PositionSectorControl --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2`
Expected: PASS

- [ ] **Step 6: Full web-package run, typecheck, lint, commit**

Run: `pnpm --filter @lavega/investing-web test -- --poolOptions.forks.minForks=1 --poolOptions.forks.maxForks=2 && pnpm --filter @lavega/investing-web typecheck && pnpm run lint`

```bash
git add apps/investing-web/src/components/PositionSectorControl.tsx apps/investing-web/src/components/PositionSectorControl.test.tsx apps/investing-web/src/app.tsx
git commit -m "$(cat <<'EOF'
Show a position's sector and let the owner correct it

Position Detail now renders the resolved sector with an inferred/correction
badge so a model's judgment is never mistaken for a broker-reported fact
(#135 story 2), plus a minimal select-and-save control for the owner's own
override (#135 stories 7-8).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Whole-branch verification

**Files:** none (verification only)

- [ ] **Step 1: Full monorepo test run**

Run: `pnpm run test`
Expected: every package green (`@lavega/core`, `@lavega/adapters`, `@lavega/database`, `@lavega/investing-server`, `@lavega/investing-web`, plus every other workspace package turbo touches — confirm none of them import anything this branch changed and regress)

- [ ] **Step 2: Full typecheck**

Run: `pnpm run typecheck`
Expected: clean across all 10 packages

- [ ] **Step 3: Full lint**

Run: `pnpm run lint`
Expected: ≤101 warnings total, zero new ones versus the pre-branch baseline (`git stash`, run lint, note the count, `git stash pop`, compare — or diff against the count PR #171/#172's own bodies report, 95, if both have merged by this point)

- [ ] **Step 4: Apply migrations 0017 and 0018 against a real Neon branch** (not part of automated tests — `packages/database/src/migrations.test.ts` runs them against PGlite, not Neon; a real apply catches a Neon-specific permission or extension gap PGlite can't)

Run: `pnpm run db:migrate:check` against the preview Neon branch, then `pnpm run db:migrate` once confirmed

- [ ] **Step 5: Confirm no task left a placeholder or a TODO**

Run: `grep -rn "TODO\|FIXME\|not implemented" apps/investing-server/src/sector*.ts apps/investing-web/src/components/PositionSectorControl.tsx packages/core/src/investing/sectorTaxonomy.ts`
Expected: no output

This is the last task before opening PR2 (stacked on PR1) per the `opening-a-pr` playbook — not part of this planning document.

---

## Self-Review

**1. Spec coverage.**
- Spike §4 Option A (fund detection, storage, exposure math) → Tasks 1, 2, 4, 5.
- Spike §4 PR2 (caption update, consent-gap close) → Task 6 (caption); consent gap is PR #171's, explicitly not re-planned (Global Constraints).
- Spike §3's residual-not-silently-classified requirement → Task 4's "Review Focus" tests, Task 5's fund test.
- Issue #135 stories 1-2 (fill the gap, mark inferred) → Tasks 9, 11.
- Story 3 (confidence → division fallback) → Task 8.
- Story 4 (coverage figure) → satisfied structurally by the residual folding into the existing `exposure` list (Task 4) rather than a parallel struct; the per-position `GET .../sector` route (Task 10) exposes `source` per symbol, which a future aggregate rollup could sum — flagged as a natural but out-of-scope extension, matching the issue's own "Out of Scope: redesigning the panel beyond marking inferred data and showing coverage."
- Story 5 (provider always wins) / 6 (inferred replaced by provider) / 8 (correction outranks both) → Task 9's precedence tests.
- Story 7 (self-correct) → Task 10 (PUT route), Task 11 (UI).
- Story 9/10 (no invented sector, no entity-as-sector) → Global Constraints' taxonomy invariant, Task 8's `NO_MATCH` handling.
- Story 11 (off critical path) → satisfied by construction: `classifier` is optional and only invoked from the summary/position-sector routes, never from price sync or valuation, which never call `resolvePortfolioSectors` at all.
- Story 12 (classified once) → Task 9's cached-inferred-profile test.
- Story 13/14 (turn off, respect consent) → Task 10's two-gate wiring.
- Story 15/16 (one resolution rule, injectable classifier) → Task 9 extends the existing function rather than adding a second path; `classifier` is a plain injected function throughout.
- Story 17 (read-only stays read-only) → Task 9's explicit test.
- Story 18 (usage ledger) → Task 7.
- "Further Notes" (System One client dependency lands first) → confirmed already present (`systemOne.ts`/`systemOneUsage.ts` exist on `master`); Task 7 only widens them.

**2. Placeholder scan.** No "TBD"/"handle appropriately" strings in any task. The two explicitly-flagged judgment calls — the confidence threshold (0.6) and the sector→division map — are real, checked-in values with a code comment explaining they're a documented first cut per the issue's own "set a placeholder and measure" instruction, not an unresolved gap.

**3. Type consistency.** `SectorProfile`/`StockSectorProfile`/`FundSectorProfile` (Task 1) flow unchanged through Tasks 2, 5, 9. `SectorWeight` (Task 4) is the same shape `buildSectorExposure`, `sectorResolution.ts`, and `PortfolioSectors.weightsBySymbol` all use. `GICS_SECTOR_LABELS` (Task 1) is the one label source Task 8's classifier and Task 11's `<select>` both import — checked against the Global Constraints taxonomy rule.

**4. Review Focus.** All five lines each have an owning task and test: the <100% fund residual (Task 4, Task 5), the 100%-bond fund (Task 4, Task 5), the legacy on-disk record (Task 2), the cached-inferred-doesn't-re-invoke-but-still-retries-provider case (Task 9), and the correction-short-circuits-immediately case (Task 9, explicit same-request-cycle test).
