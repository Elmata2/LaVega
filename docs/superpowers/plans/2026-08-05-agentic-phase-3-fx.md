# Agentic Phase 3 — FX / Conversion agent (minimal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Help the owner pick the cheapest way to convert money between currencies: enter an amount + from/to currency → see the live mid-market rate (ECB) and a ranked table of conversion routes (Wise / Revolut / bank / …) by what you'd actually receive.

**Architecture:** Deterministic core (`fx.ts`: `crossRate` / `routeNet` / `rankRoutes` + a maintained static route-cost table + a fallback rate snapshot) — no LLM. A thin server proxy `GET /api/fx/rate` fetches ECB mid-market rates from Frankfurter (free, no key) with the same cache→last-good→static resilience as `rates.ts`. A minimal **Valuta** web view: one form + one ranked table. Privacy: only public rate data is fetched; nothing about the user's accounts leaves the device (the amount/currencies stay in the browser — the route ranking is computed locally).

**Tech Stack:** TypeScript, pnpm monorepo, Vitest, Hono, React (Vite). No new dependencies. No credentials required (Frankfurter is keyless).

## Global Constraints

- **Deterministic + local-first:** the FX math is pure and integer-free-but-exact-enough (decimal rates; assert with `toBeCloseTo`). No LLM, no `@anthropic-ai/sdk`. Only public rate data crosses the network; the user's amount/currency choice is used client-side only (the server rate endpoint receives NO user data — it always serves EUR-based ECB rates).
- **Rate source:** `https://api.frankfurter.dev/v1/latest?base=EUR` → `{ amount, base, date, rates: { USD: 1.15, ... } }` (ECB reference rates; verified live). Always fetch base=EUR; derive any cross rate in `crossRate`.
- **Route costs are INDICATIVE** (a maintained static bundle with a "verified as of" date, exactly like `NL_SAVINGS_RATES`). The UI must label them indicatief.
- Dutch UI copy. Follow existing patterns: server resilience mirrors `apps/server/src/rates.ts`; view wiring mirrors the Optimalisatie tab (View union in `App.tsx`, `NAV_ITEMS` + icon in `Sidebar.tsx`, a `view === "..."` block in `App.tsx`).
- Each task commits with a message ending `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Verify per task: `pnpm test`, `pnpm typecheck`, and (Task 3) `pnpm --filter @lavega/web build`.

## File Structure

- `packages/core/src/fx.ts` — NEW: types, `crossRate`, `routeNet`, `rankRoutes`, `FX_ROUTES` + `FX_ROUTES_AS_OF`, `FX_RATE_FALLBACK`, `parseFxRatePayload`.
- `packages/core/src/fx.test.ts` — NEW.
- `packages/core/src/index.ts` — export `./fx.js` (modify).
- `apps/server/src/fx.ts` — NEW: `getFxRate()` (Frankfurter + cache + fallback).
- `apps/server/src/fx.test.ts` — NEW.
- `apps/server/src/index.ts` — register `GET /api/fx/rate` (modify).
- `apps/web/src/views/Valuta.tsx` — NEW.
- `apps/web/src/valuta.test.ts` — NEW (logic-only).
- `apps/web/src/App.tsx`, `apps/web/src/components/Sidebar.tsx` — wire the new view (modify).

---

## Task 1: Core `fx.ts` — cross-rate + route ranking (pure, TDD)

**Files:** Create `packages/core/src/fx.ts`, `packages/core/src/fx.test.ts`; modify `packages/core/src/index.ts`.

**Interfaces produced:**

```ts
export type FxRate = { base: string; date: string; rates: Record<string, number> }; // base->ccy multipliers
export type FxRoute = { provider: string; spreadPct: number; fixedFeeFrom?: number; note?: string };
export type FxRouteResult = {
  provider: string;
  netReceived: number;
  effectiveRate: number;
  totalCostPct: number;
  note?: string;
};
export function crossRate(from: string, to: string, rate: FxRate): number;
export function routeNet(amountFrom: number, mid: number, route: FxRoute): FxRouteResult;
export function rankRoutes(
  amountFrom: number,
  from: string,
  to: string,
  rate: FxRate,
  routes?: readonly FxRoute[],
): FxRouteResult[];
export function parseFxRatePayload(raw: unknown): FxRate | null;
export const FX_ROUTES_AS_OF: string;
export const FX_ROUTES: readonly FxRoute[];
export const FX_RATE_FALLBACK: FxRate;
```

- [ ] **Step 1: Failing test** — `packages/core/src/fx.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  crossRate,
  routeNet,
  rankRoutes,
  parseFxRatePayload,
  FX_ROUTES,
  FX_RATE_FALLBACK,
} from "./fx.js";

const RATE = { base: "EUR", date: "2026-08-04", rates: { USD: 1.15, GBP: 0.85 } };

test("crossRate: base identity, to-base, and cross", () => {
  expect(crossRate("EUR", "USD", RATE)).toBeCloseTo(1.15, 6);
  expect(crossRate("USD", "EUR", RATE)).toBeCloseTo(1 / 1.15, 6);
  expect(crossRate("USD", "GBP", RATE)).toBeCloseTo(0.85 / 1.15, 6);
  expect(crossRate("USD", "USD", RATE)).toBe(1);
});

test("crossRate throws on an unknown currency", () => {
  expect(() => crossRate("EUR", "XXX", RATE)).toThrow();
});

test("routeNet: spread + fixed fee reduce what you receive; cost vs mid is positive", () => {
  const mid = 1.15; // EUR->USD
  const r = routeNet(1000, mid, { provider: "Test", spreadPct: 1, fixedFeeFrom: 10 });
  // (1000 - 10) * 1.15 * 0.99 = 1127.115
  expect(r.netReceived).toBeCloseTo(1127.115, 3);
  expect(r.totalCostPct).toBeGreaterThan(0);
  expect(r.effectiveRate).toBeCloseTo(1127.115 / 1000, 6);
});

test("routeNet clamps a fixed fee larger than the amount to zero received", () => {
  const r = routeNet(5, 1.15, { provider: "Test", spreadPct: 0, fixedFeeFrom: 10 });
  expect(r.netReceived).toBe(0);
});

test("rankRoutes sorts by net received, best first", () => {
  const ranked = rankRoutes(1000, "EUR", "USD", RATE, [
    { provider: "Cheap", spreadPct: 0.5 },
    { provider: "Pricey", spreadPct: 2 },
  ]);
  expect(ranked[0].provider).toBe("Cheap");
  expect(ranked[0].netReceived).toBeGreaterThan(ranked[1].netReceived);
});

test("parseFxRatePayload accepts a Frankfurter-shaped payload and rejects junk", () => {
  const ok = parseFxRatePayload({
    amount: 1,
    base: "EUR",
    date: "2026-08-04",
    rates: { USD: 1.15 },
  });
  expect(ok).toEqual({ base: "EUR", date: "2026-08-04", rates: { USD: 1.15 } });
  expect(parseFxRatePayload({ base: "EUR" })).toBeNull();
  expect(parseFxRatePayload(null)).toBeNull();
  expect(parseFxRatePayload({ base: "EUR", date: "x", rates: { USD: "nope" } })).toBeNull();
});

test("bundled route table and fallback rate are non-empty and well-formed", () => {
  expect(FX_ROUTES.length).toBeGreaterThan(2);
  expect(FX_ROUTES.every((r) => typeof r.spreadPct === "number")).toBe(true);
  expect(FX_RATE_FALLBACK.base).toBe("EUR");
  expect(FX_RATE_FALLBACK.rates.USD).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm vitest run packages/core/src/fx.test.ts`).
- [ ] **Step 3: Implement `packages/core/src/fx.ts`:**

```ts
/* FX / conversion agent (deterministic). Given ECB mid-market rates and a small
 * maintained table of provider costs, rank the routes to convert an amount from
 * one currency to another by what you'd actually receive. Rates are decimal
 * (not integer cents) — FX is inherently fractional. Route costs are INDICATIVE
 * (see FX_ROUTES_AS_OF); the UI must say so. */

export type FxRate = { base: string; date: string; rates: Record<string, number> };
export type FxRoute = {
  provider: string;
  /** Markup over mid-market, in percent (0.5 = 0.5% worse than mid). */
  spreadPct: number;
  /** Fixed fee charged in the SOURCE currency (approximation for wire fees). */
  fixedFeeFrom?: number;
  note?: string;
};
export type FxRouteResult = {
  provider: string;
  netReceived: number; // amount in `to` after this route's costs
  effectiveRate: number; // netReceived / amountFrom
  totalCostPct: number; // % less than pure mid-market on the full amount
  note?: string;
};

/** Cross rate from->to via the payload's base. `rates` are base->ccy multipliers
 *  (1 base = rates[ccy] ccy). Throws on an unknown currency. */
export function crossRate(from: string, to: string, rate: FxRate): number {
  if (from === to) return 1;
  const perBase = (ccy: string): number => {
    if (ccy === rate.base) return 1;
    const v = rate.rates[ccy];
    if (typeof v !== "number" || !(v > 0)) throw new Error(`onbekende valuta: ${ccy}`);
    return v;
  };
  return perBase(to) / perBase(from);
}

export function routeNet(amountFrom: number, mid: number, route: FxRoute): FxRouteResult {
  const afterFee = Math.max(0, amountFrom - (route.fixedFeeFrom ?? 0));
  const applied = mid * (1 - route.spreadPct / 100);
  const netReceived = afterFee * applied;
  const idealMid = amountFrom * mid;
  const totalCostPct = idealMid > 0 ? ((idealMid - netReceived) / idealMid) * 100 : 0;
  const effectiveRate = amountFrom > 0 ? netReceived / amountFrom : 0;
  return { provider: route.provider, netReceived, effectiveRate, totalCostPct, note: route.note };
}

export function rankRoutes(
  amountFrom: number,
  from: string,
  to: string,
  rate: FxRate,
  routes: readonly FxRoute[] = FX_ROUTES,
): FxRouteResult[] {
  const mid = crossRate(from, to, rate);
  return routes
    .map((r) => routeNet(amountFrom, mid, r))
    .sort((a, b) => b.netReceived - a.netReceived);
}

/** Validate an external rate payload (e.g. Frankfurter's `{amount,base,date,rates}`)
 *  into an FxRate, or null on any shape problem. `amount` is ignored. */
export function parseFxRatePayload(raw: unknown): FxRate | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.base !== "string" ||
    typeof o.date !== "string" ||
    !o.rates ||
    typeof o.rates !== "object"
  )
    return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.rates as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
    out[k] = v;
  }
  if (Object.keys(out).length === 0) return null;
  return { base: o.base, date: o.date, rates: out };
}

/* Indicative provider costs — owner-maintained, re-verify periodically. */
export const FX_ROUTES_AS_OF = "2026-08-05";
export const FX_ROUTES: readonly FxRoute[] = [
  {
    provider: "Wise",
    spreadPct: 0.45,
    fixedFeeFrom: 1.0,
    note: "Mid-market + ~0,45% + kleine vaste fee",
  },
  {
    provider: "Revolut (weekdag, Standard)",
    spreadPct: 0.0,
    note: "Mid-market tot plan-limiet, daarna 0,5%",
  },
  { provider: "Revolut (weekend)", spreadPct: 1.0, note: "Weekend-opslag ~1%" },
  { provider: "bunq", spreadPct: 0.5, note: "Indicatief" },
  {
    provider: "Typische bank (overboeking)",
    spreadPct: 1.5,
    fixedFeeFrom: 7.0,
    note: "Wisselopslag ~1,5% + kosten buitenlandse overboeking",
  },
  { provider: "Creditcard (typisch)", spreadPct: 2.0, note: "Bij kaartbetaling in vreemde valuta" },
];

/* Offline fallback (ECB via Frankfurter, verified 2026-08-04). Majors only. */
export const FX_RATE_FALLBACK: FxRate = {
  base: "EUR",
  date: "2026-08-04",
  rates: {
    USD: 1.1515,
    GBP: 0.85639,
    CHF: 0.9319,
    JPY: 170.0,
    SEK: 11.2,
    NOK: 11.6,
    DKK: 7.46,
    PLN: 4.27,
    CAD: 1.58,
    AUD: 1.74,
  },
};
```

- [ ] **Step 4: Add to `packages/core/src/index.ts`:** `export * from "./fx.js";`
- [ ] **Step 5: Run → PASS; `pnpm typecheck`.** **Step 6: Commit** (`fx.ts`, `fx.test.ts`, `index.ts`): `feat(core): FX cross-rate + route ranking (deterministic)`.

---

## Task 2: Server `GET /api/fx/rate` — ECB rate proxy with fallback

**Files:** Create `apps/server/src/fx.ts`, `apps/server/src/fx.test.ts`; modify `apps/server/src/index.ts`.

**Interfaces produced:** `getFxRate(): Promise<FxRate>` (fresh cache → live Frankfurter → last-good cache → `FX_RATE_FALLBACK`). Route `GET /api/fx/rate` → the FxRate JSON, open CORS (public data).

- [ ] **Step 1: Failing test** — `apps/server/src/fx.test.ts` (mock global fetch; run with `pnpm vitest run apps/server/src/fx.test.ts`):

```ts
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

test("getFxRate returns the parsed live payload on a good response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            amount: 1,
            base: "EUR",
            date: "2026-08-04",
            rates: { USD: 1.15, GBP: 0.85 },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    ),
  );
  const { getFxRate } = await import("./fx.js");
  const r = await getFxRate();
  expect(r.base).toBe("EUR");
  expect(r.rates.USD).toBeCloseTo(1.15, 6);
});
```

(One success-path test. The fallback path is structurally identical to the already-tested `getRates()` in `rates.ts`; note that in the report rather than re-testing the module-level cache.)

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `apps/server/src/fx.ts`** (mirror `rates.ts` resilience):

```ts
/* FX rate service. GET /api/fx/rate serves this. Fetches ECB mid-market rates
 * (base EUR) from Frankfurter — public data, NO user data is sent. 6h in-memory
 * cache; on any failure serves the last good result, else the bundled snapshot.
 * The client derives any from->to cross rate locally via crossRate(). */
import type { FxRate } from "@lavega/core";
import { FX_RATE_FALLBACK, parseFxRatePayload } from "@lavega/core";

const SOURCE_URL = "https://api.frankfurter.dev/v1/latest?base=EUR";
const TTL_MS = 6 * 60 * 60 * 1000;

let cache: { payload: FxRate; at: number } | null = null;

export async function getFxRate(): Promise<FxRate> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.payload;
  try {
    const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const parsed = parseFxRatePayload(await res.json());
      if (parsed) {
        cache = { payload: parsed, at: Date.now() };
        return parsed;
      }
    }
  } catch {
    /* fall through to last-good / static */
  }
  if (cache) return cache.payload;
  return FX_RATE_FALLBACK;
}
```

- [ ] **Step 4: Register in `apps/server/src/index.ts`** — add `import { getFxRate } from "./fx.js";` and, next to the `/api/rates` route (BEFORE the `serveStatic` catch-all):

```ts
app.get("/api/fx/rate", async (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(await getFxRate());
});
```

- [ ] **Step 5: Run → PASS; `pnpm typecheck`; `pnpm --filter @lavega/server build`.** **Step 6: Commit** (`fx.ts`, `fx.test.ts`, `index.ts`): `feat(server): /api/fx/rate ECB proxy (Frankfurter) with fallback`.

---

## Task 3: Web **Valuta** view — form + ranked routes table

**Files:** Create `apps/web/src/views/Valuta.tsx`, `apps/web/src/valuta.test.ts`; modify `apps/web/src/App.tsx`, `apps/web/src/components/Sidebar.tsx`.

**Interfaces produced:** `Valuta` default-export component `({ accounts }: { accounts: Account[] })`. A small pure helper `ownedProviders(accounts, routes): Set<string>` (which route providers the user likely already has, by matching `account.bank` tokens to route provider names) — exported for the test.

- [ ] **Step 1: Failing test** — `apps/web/src/valuta.test.ts` (logic-only):

```ts
import { expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { FX_ROUTES } from "@lavega/core";
import { ownedProviders } from "./views/Valuta.js";

const acct = (bank: string): Account => ({
  key: bank,
  iban: "",
  name: bank,
  bank,
  entity: "BV1",
  currency: "EUR",
  balance: 0,
});

test("ownedProviders matches a route to a bank the user holds (Revolut)", () => {
  const owned = ownedProviders([acct("Revolut"), acct("ING")], FX_ROUTES);
  expect([...owned].some((p) => p.toLowerCase().includes("revolut"))).toBe(true);
  // A provider the user does NOT have is not marked owned.
  expect([...owned].some((p) => p.toLowerCase().includes("wise"))).toBe(false);
});

test("ownedProviders is empty when no bank matches any route", () => {
  expect(ownedProviders([acct("Knab")], FX_ROUTES).size).toBe(0);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `apps/web/src/views/Valuta.tsx`:**

```tsx
import { useEffect, useMemo, useState } from "react";
import type { Account } from "@lavega/core";
import {
  FX_ROUTES,
  FX_ROUTES_AS_OF,
  FX_RATE_FALLBACK,
  parseFxRatePayload,
  rankRoutes,
} from "@lavega/core";
import type { FxRate, FxRoute } from "@lavega/core";
import { API_BASE } from "../api";

/** Which route providers the user likely already holds, by matching each
 *  account's bank name against the provider label (token contains). Lets the
 *  UI flag "in bezit" so the owner can prefer a route they can use today. */
export function ownedProviders(accounts: Account[], routes: readonly FxRoute[]): Set<string> {
  const banks = accounts.map((a) => (a.bank || "").toLowerCase()).filter(Boolean);
  const owned = new Set<string>();
  for (const r of routes) {
    const label = r.provider.toLowerCase();
    if (banks.some((b) => b.length > 2 && (label.includes(b) || b.includes(label.split(" ")[0])))) {
      owned.add(r.provider);
    }
  }
  return owned;
}

export default function Valuta({ accounts }: { accounts: Account[] }) {
  const [rate, setRate] = useState<FxRate>(FX_RATE_FALLBACK);
  const [source, setSource] = useState<"live" | "offline">("offline");
  const [amount, setAmount] = useState("1000");
  const [from, setFrom] = useState("EUR");
  const [to, setTo] = useState("USD");

  useEffect(() => {
    let ok = true;
    void fetch(`${API_BASE}/api/fx/rate`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const parsed = parseFxRatePayload(j);
        if (ok && parsed) {
          setRate(parsed);
          setSource("live");
        }
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => {
      ok = false;
    };
  }, []);

  const currencies = useMemo(
    () => [rate.base, ...Object.keys(rate.rates)].filter((v, i, a) => a.indexOf(v) === i).sort(),
    [rate],
  );
  const owned = useMemo(() => ownedProviders(accounts, FX_ROUTES), [accounts]);
  const foreignHoldings = useMemo(
    () => [...new Set(accounts.map((a) => a.currency).filter((c) => c && c !== "EUR"))],
    [accounts],
  );
  const amt = Number(amount.replace(",", ".")) || 0;
  const results = useMemo(() => {
    try {
      return rankRoutes(amt, from, to, rate);
    } catch {
      return [];
    }
  }, [amt, from, to, rate]);

  const fmt = (n: number, ccy: string) =>
    new Intl.NumberFormat("nl-NL", {
      style: "currency",
      currency: ccy,
      maximumFractionDigits: 2,
    }).format(n);

  return (
    <section className="card" aria-label="Valuta">
      <div className="card-header">
        <h2>Valuta</h2>
        <span className="eyebrow">beste wisselroute</span>
      </div>
      <p className="cell-sub">
        Vergelijk wat je overhoudt bij het omwisselen van valuta. Middenkoers via de ECB
        (Frankfurter); de kosten per aanbieder zijn <strong>indicatief</strong> (peildatum{" "}
        {FX_ROUTES_AS_OF}). Er wordt niets over je rekeningen verstuurd.
      </p>

      {foreignHoldings.length > 0 && (
        <p className="cell-sub">Je hebt saldi in: {foreignHoldings.join(", ")}.</p>
      )}

      <div className="facturen-form">
        <label>
          Bedrag{" "}
          <input
            className="saldo-input"
            type="number"
            step={0.01}
            min={0}
            value={amount}
            aria-label="Bedrag"
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>{" "}
        <label>
          Van{" "}
          <select value={from} aria-label="Van valuta" onChange={(e) => setFrom(e.target.value)}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Naar{" "}
          <select value={to} aria-label="Naar valuta" onChange={(e) => setTo(e.target.value)}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="eyebrow" style={{ marginTop: "var(--sp-3)" }}>
        Middenkoers 1 {from} ={" "}
        {(() => {
          try {
            return rankRoutes(1, from, to, rate);
          } catch {
            return null;
          }
        })()
          ? ""
          : ""}
        {(() => {
          try {
            return results.length ? (rankRoutes(1, from, to, rate)[0] ? "" : "") : "";
          } catch {
            return "";
          }
        })()}
      </p>

      {results.length === 0 ? (
        <p>Kies geldige valuta.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Aanbieder</th>
                <th>Effectieve koers</th>
                <th>Je ontvangt</th>
                <th>Kosten vs midden</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={r.provider}>
                  <td>
                    {r.provider}
                    {owned.has(r.provider) ? (
                      <span className="badge" style={{ marginLeft: "var(--sp-1)" }}>
                        in bezit
                      </span>
                    ) : null}
                    {r.note ? <span className="cell-sub"> · {r.note}</span> : null}
                  </td>
                  <td>{r.effectiveRate.toFixed(4)}</td>
                  <td className={i === 0 ? "text-pos" : ""}>{fmt(r.netReceived, to)}</td>
                  <td>{r.totalCostPct.toFixed(2)}%</td>
                  <td>{i === 0 ? <span className="badge">beste</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="cell-sub" style={{ marginTop: "var(--sp-2)" }}>
        Koersbron: {source === "live" ? `live (ECB, ${rate.date})` : "offline snapshot"}.
      </p>
    </section>
  );
}
```

NOTE to implementer: the two `eyebrow` mid-koers lines above are placeholder-ugly — REPLACE that `<p className="eyebrow">` block with a clean single line showing the mid-market rate, computed ONCE: `const mid = useMemo(() => { try { return crossRate(from, to, rate); } catch { return null; } }, [from, to, rate]);` (import `crossRate`) and render `Middenkoers: 1 {from} = {mid ? mid.toFixed(4) : "—"} {to}`. Do not ship the placeholder IIFE lines.

- [ ] **Step 4: Wire the view:**
  - `apps/web/src/App.tsx`: add `"valuta"` to the `View` union (line ~30); import `Valuta`; add a block `{view === "valuta" && <Valuta accounts={accounts} />}` alongside the other `view === ...` blocks.
  - `apps/web/src/components/Sidebar.tsx`: add `{ key: "valuta", label: "Valuta" }` to `NAV_ITEMS` (after "optimalisatie" is a sensible spot), and add a `valuta:` entry to the icon map (reuse an existing inline SVG style — a simple currency/arrows glyph; copy the shape of a neighboring icon so it renders).
- [ ] **Step 5: Verify** — `pnpm vitest run apps/web/src/valuta.test.ts` (PASS), `pnpm test`, `pnpm typecheck`, `pnpm --filter @lavega/web build`. **Step 6: Commit** (`Valuta.tsx`, `valuta.test.ts`, `App.tsx`, `Sidebar.tsx`): `feat(web): Valuta tab — ranked FX conversion routes`.

## Self-Review notes

- No LLM, no credentials — Frankfurter is keyless; the feature is fully testable/verifiable now (unlike Phase 2c).
- Privacy: the rate endpoint receives no user data (always EUR-based ECB rates); route ranking + the amount/currency choice stay in the browser.
- Route costs are INDICATIVE and labelled as such in the UI (open decision #7 upkeep chore accepted; live Wise `/v4/comparisons` intentionally deferred per the design's "graceful fallback" — noted, not built).
- Types consistent: `FxRate`/`FxRoute`/`FxRouteResult` defined in core Task 1, consumed by server Task 2 and web Task 3; `parseFxRatePayload` shared server+web.
