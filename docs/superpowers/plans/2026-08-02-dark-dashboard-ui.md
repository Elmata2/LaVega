# LaVega — Dark-dashboard UI overhaul + Forecast view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Restyle the LaVega app from bare unstyled HTML into the FinnTell **dark dashboard** (sidebar + top bar + KPI tiles + cards), and build the **Forecast view** matching `app-forecast.png` on top of the finished `forecastCashflow` engine. Purely presentational + a new view — no changes to `@lavega/core`/`@lavega/adapters` logic.

**Design source of truth (implementers: view these):**
- `/Users/alexandersteunenberg/Desktop/My_Code/finntell/design.md` — brand/design system (color/type/spacing/component tokens). NOTE: design.md documents the LIGHT marketing site; the APP is DARK — use design.md's *structure/scale/components* but the DARK palette below.
- `/Users/alexandersteunenberg/Desktop/My_Code/finntell/website/qa/app-overzicht.png` and `app-forecast.png` — the exact app screens to match (sidebar, top bar, entity pills, KPI tiles, cards, the forecast chart + drivers + shortfall banner).

**Architecture:** A CSS design-system (custom-property tokens + component classes) under `apps/web/src/styles/`, imported once in `main.tsx`. `App.tsx` (~400 lines) is split into a shell (`Sidebar`, `TopBar`) + per-view components under `apps/web/src/views/`. Self-hosted fonts via `@fontsource/*` (OFL — offline-capable, AGPL-clean) with a system fallback stack if install is unavailable. All existing view logic/state moves verbatim into the components; behavior and tests are unchanged.

## Global Constraints
- **No logic changes** — `@lavega/core`/`@lavega/adapters` untouched; the import→ingest→consolidate→persist flow, filters, reassignment, categories, and all existing state move verbatim. Every existing test stays green.
- **Dark palette** (starting tokens — refine visually against the mockups via the dev server):
  `--bg:#0A0B10` · `--surface:#12141C` · `--surface-2:#181B25` · `--ink:#F5F6FA` · `--muted:#8A8FA3` · `--line:rgba(255,255,255,.08)` · `--accent:#2F5BFF` (cobalt, interactive) · `--pos:#2FD6A6` (mint) · `--neg:#E5484D` · `--warn:#E8A33D`. Radius `--r:14px`/`--r-sm:10px`/`--pill:999px`. Space scale 4·8·12·16·24·32.
- **Type:** Space Grotesk (headings + big numbers, tabular-nums for figures) + Inter (body/UI) + a mono (`ui-monospace, SFMono-Regular, Menlo, monospace`) for metadata/labels (the mockups use mono for `cijfers van...`, timestamps, counts). Cobalt sparingly; semantic colors ONLY for financial pos/neg/warn.
- **Dutch copy** preserved; euro via the existing `formatEuro`.
- Responsive: sidebar collapses under ~900px (mockup has a mobile menu); tables scroll in an `overflow-x:auto` wrapper.
- `pnpm --filter @lavega/web build` must succeed each task.

---

### Task 1: Design system (tokens + fonts + base) + app shell (Sidebar + TopBar + entity filter)

**Files:**
- Create: `apps/web/src/styles/tokens.css`, `apps/web/src/styles/base.css` (reset + element defaults + component classes: `.card`, `.kpi`, `.pill`, `.btn`, `.table`, `.badge`, `.nav-item`, status dots)
- Create: `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/TopBar.tsx`
- Modify: `apps/web/src/main.tsx` (import the CSS; import `@fontsource/space-grotesk` + `@fontsource/inter` if available, else rely on the fallback stack in tokens.css)
- Modify: `apps/web/src/App.tsx` (render the shell: `<Sidebar>` + `<TopBar>` + a `<main class="content">` holding the existing per-view blocks; keep ALL state/handlers)
- Modify: `apps/web/package.json` only if adding `@fontsource/*` (try `pnpm add -D @fontsource/space-grotesk @fontsource/inter`; if offline, skip and use the system fallback — note which in the report)

**Design notes:**
- **Sidebar** (left, ~240px, `--surface`): a brand row (LaVega + a cobalt/mint dot), nav items Overzicht · Transacties · Rekeningen · Regels · Forecast · Importeren (each an icon glyph + label; active = `--accent-soft` bg + cobalt left-border or text), and a footer identity card. Drives the existing `view` state (extend the `View` union with `"forecast"`; "Importeren" can scroll to / toggle the import control).
- **TopBar**: breadcrumb (muted mono "LaVega · Alle bedrijven") + the current view title (Space Grotesk), and **entity-filter pills** on the right: "Alle" + one pill per entity (unique `accounts.map(a=>a.entity)`), plus the import Entiteit control relocated here or kept in an import card. Selecting a pill sets a new top-level `entityScope` state ("" = all).
- **entityScope wiring:** thread `entityScope` into the views' data (filter accounts/txs to the scope before consolidate/enrichTxs/forecast). Overzicht/Transacties/Rekeningen/Forecast all honor it. (Transacties already has its own entity dropdown — the top pill can set `fEntity`, or keep both; simplest: the pill sets a shared `entityScope` that pre-filters, and the Transacties dropdown stays for finer control. Decide during impl; keep it coherent.)
- Move `formatEuro` to a shared `apps/web/src/format.ts` (re-used by all view components).
- **Do not restyle the view *content* yet** beyond wrapping each existing `<section>` in `.card` — Tasks 2–4 do the per-view visual work. This task is: dark theme is on, the shell + nav + entity pills work, the app still functions identically.

- [ ] Step 1: tokens.css + base.css (dark theme, fonts, component classes).
- [ ] Step 2: Sidebar + TopBar components; extend `View` with `"forecast"`; add `entityScope` state.
- [ ] Step 3: App.tsx renders the shell; existing views render inside `.content`, each wrapped in `.card`; entityScope pre-filters the data passed to views.
- [ ] Step 4: `pnpm test` (all green — logic unchanged), `pnpm typecheck`, `pnpm --filter @lavega/web build` all pass. Manual: dev server shows the dark shell.
- [ ] Step 5: Commit — `feat(web): dark design-system tokens + app shell (sidebar, top bar, entity pills)`.

---

### Task 2: Overzicht — KPI tiles + cards (match app-overzicht.png)

**Files:** Create `apps/web/src/views/Overzicht.tsx`; modify `App.tsx` to render it.
- **KPI row** (4 `.kpi` tiles): Totaalpositie (Σ known balances, big Space Grotesk, `--pos` if ≥0), # rekeningen, # entiteiten, # aandacht (e.g. problems / unknown-balance count). One tile highlighted with `--accent-soft`.
- **Card grid:** "Positie over je bedrijven" (per-entity rows: name, bank·#rek, a mini SVG sparkline of that entity's monthly net, balance right-aligned; a stacked proportion bar) · "Cashflow · komende 13 weken" (the forecast mini-chart from `forecastCashflow` consolidated — median line + band + dashed buffer + "Krapste week" line, link to Forecast) · "Recente transacties" (latest ~6 enriched txs, entity·bank·date muted mono, amount pos/neg). Keep the existing monthly chart + Per-categorie table as cards too (or fold monthly chart into the position card).
- Reuse `consolidate`, `monthlyTotals`, `categoryTotals`, `enrichTxs`, and `forecastCashflow` (asOf = a date passed from App; use a single `asOf` const built once at App mount — pass it down, keep determinism).
- [ ] TDD: a headless test asserting the KPI derivations (total position, counts) from sample accounts/txs. Then build. Commit — `feat(web): Overzicht KPI tiles + position/cashflow/recent cards`.

---

### Task 3: Transacties · Rekeningen · Regels · Import — carded dark styling

**Files:** Create `apps/web/src/views/{Transacties,Rekeningen,Regels,Import}.tsx`; modify `App.tsx`.
- Move each existing view's markup+logic verbatim into its component, re-housed in `.card` with the `.table` class (hairline rows, muted mono uppercase headers), pill/`.btn` controls, semantic amount colors, status dots on Rekeningen (pos/neg by balance). Filters become a tidy toolbar row. No logic change — the same handlers/state (lifted in App or via props).
- [ ] Existing tests (`transactions/reassign/categories/daterange`) stay green (logic unmoved). Build passes. Commit — `feat(web): carded dark styling for Transacties/Rekeningen/Regels/Import`.

---

### Task 4: Forecast view (match app-forecast.png) — wire `forecastCashflow`

**Files:** Create `apps/web/src/views/Forecast.tsx`; modify `App.tsx` (route `view==="forecast"`).
- Compute `forecastCashflow(txs, accounts, { asOf, horizonDays: 91, bufferCents })` honoring `entityScope` (scope → its `EntityForecast`; "Alle" → `consolidated`).
- **Shortfall banner** (top): green (`--pos`) "Geen tekort verwacht in de komende 13 weken" when `shortfall === null`; red/amber when set — "Tekort verwacht rond <date> — laagste ~€X (buffer €Y)". Uses the eye/guardian tone from design.md voice.
- **13-week chart card** (inline SVG, no lib): median line (`--pos`/mint), the P-band as a filled area between `lowerCents`/`upperCents`, a dashed buffer line, x-axis `nu…w13`, y-axis euro ticks; legend "Verwacht · Bandbreedte · Buffer". Null-opening → show "positie onbekend — alleen stromen" (plot flow deltas or a message).
- **Drivers card**: "Drivers · per week (gem.)" — `drivers` split into Verwachte inkomsten (pos, green) / Verwachte uitgaven (neg, red), label + `perWeekCents` formatted.
- **Footnote**: "Deterministische 13-weeks forecast (herkende terugkerende betalingen + roll-forward). Geen ML." + honest thin-data note when `streams.length === 0` / limited history ("onvoldoende historie voor een betrouwbare prognose").
- [ ] TDD: headless test that `forecastCashflow` output maps to the banner/driver split correctly (shortfall present→banner variant; drivers partition by sign). Build passes. Commit — `feat(web): Forecast view (shortfall banner, 13-week chart, drivers) on the forecast engine`.

## Self-Review checklist
- Dark theme matches the mockups; cobalt sparingly; semantic colors only for pos/neg/warn. All existing logic/tests unchanged (green). `entityScope` pills coherently scope every view. Forecast view reads `forecastCashflow`, honors null-opening + thin-data honestly, and the shortfall banner/driver split are correct. Fonts self-hosted or graceful fallback. `pnpm --filter @lavega/web build` succeeds. Responsive (sidebar collapse, tables scroll).

## Notes
- `asOf`: build ONE `asOf` (today, ISO) at App mount and thread it down so the forecast stays deterministic within a session (do not call `new Date()` inside pure code; the UI boundary may read the clock once).
- Deferred: motion/animation polish (design.md §7 — GSAP/Lenis is marketing-site scope, not needed here); a true mobile menu drawer (basic collapse is enough for v1); per-entity color coding of sparklines.
