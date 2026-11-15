# LaVega Investing: app shell, modules and widgets

Date: 2026-09-28. Status: approved in conversation, awaiting written-spec review.
Part C of the Investing UI/UX review (part A shipped in #170; part B, ETF sector
look-through, is a separate spike).

## Goal

Investing should feel like LaVega Personal: a full-window app with tabs in a top bar,
a profile page where the owner connects brokers and chooses what is shown, and an
Overview made of cards that can be switched on and off. Personal and Investing stay two
apps on one account; each links to the other.

## Decisions

| Question                             | Decision                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is "Personal" inside Investing? | A link back to LaVega Personal in the top bar, same session. No Personal data inside Investing.                                                      |
| What is switchable?                  | Tabs (modules) and Overview cards (widgets), both from the profile page; widgets also from an "Add widget" button.                                   |
| Shared shell package or copy?        | Copy Personal's pattern into `apps/investing-web` (approach 1). Personal is not touched. Extract a shared package only if the copies drift.          |
| Where are settings stored?           | Server-side per account, in the existing `investing.preferences` store (the one that holds benchmark selection). Personal keeps its browser storage. |
| Widget ordering                      | Fixed order, no drag-and-drop, as in Personal.                                                                                                       |

## 1. Shell and navigation

- **Width.** Remove the `max-w-6xl` frame in `Layout` (`apps/investing-web/src/app.tsx`). Content spans the window with Personal's page gutters.
- **Top bar.** Left: LaVega Investing brand, then tabs **Overview | Positions | Net worth | Agents**. Right: **Personal** link, **Add widget** (on Overview only), **profile button**.
- **Modules.** Overview is the home module, always on, toggle disabled. Positions, Net worth and Agents are modules, all `defaultOn: true`. A switched-off module disappears from the top bar; its route redirects to `/` (an old bookmark still lands).
- **Routes.** `/` Overview, `/positions` (+ `/positions/:symbol`), `/net-worth` (new; renders `NetWorthChart`), `/agents` (new list page) and `/agents/:agentId` (exists), `/profile` (new). `/brokers/connect` redirects to `/profile#brokers`.
- **Footer.** Sign-out moves to the profile page; the health status stays where it is useful (profile or a small status line).

## 2. Profile page

Sections, in order:

1. **Brokers.** The current `BrokerConnect` content (IBKR Flex, Trading 212 API, vault unlock) moves here unchanged.
2. **Modules.** One switch per module with label, one-line description and preview thumbnail, copied from Personal's `ModulePicker` shape.
3. **Widgets.** Same picker for Overview cards.
4. **Account.** Signed-in email, sign out, link to LaVega Personal.

## 3. Overview widgets

| Widget id     | Card                                        | Default | Column            |
| ------------- | ------------------------------------------- | ------- | ----------------- |
| `performance` | Benchmark comparison chart                  | on      | left, wide        |
| `allocation`  | Allocation donut                            | on      | left, wide        |
| `kpis`        | Key figures                                 | on      | right, first      |
| `risk`        | Risk & composition (`PortfolioSummaryCard`) | on      | right, second     |
| `sectors`     | Sector allocation                           | on      | full width, below |
| `agent`       | Portfolio agent card                        | on      | full width, below |

- Positions table and net-worth chart leave Overview; they live on their tabs.
- Hiding a card closes its gap; the grid does not leave holes.
- **Empty state.** All widgets off: one line and an Add widget button.
- A widget id is never a module id (Personal's rule, with a test).
- `OverviewStatusRail` stays as page chrome, not a widget.

## 4. Data model

```ts
type InvestingModuleId = "positions" | "net-worth" | "agents"; // "overview" is home, not switchable
type InvestingWidgetId = "performance" | "allocation" | "kpis" | "risk" | "sectors" | "agent";

type InvestingLayout = {
  modules: Partial<Record<InvestingModuleId, boolean>>; // only choices the user made
  widgets: Partial<Record<InvestingWidgetId, boolean>>;
};
```

- Store only explicit choices; an absent key means "use the registry default". A default changed later reaches every user who never chose.
- `GET /api/investing/layout` returns the stored choices; `PUT /api/investing/layout` replaces them. Unknown ids in stored data are dropped on read, never an error.
- One registry file in `apps/investing-web` declares modules and widgets (id, label, what, preview, defaultOn), mirroring `apps/web/src/components/moduleRegistry.tsx`.

## 5. Testing and verification

- Registry: no widget id equals a module id; defaults; unknown stored ids ignored; Overview cannot be switched off.
- Server: layout persists per tenant (standalone file store and Neon store); PUT validates ids; GET on a new account returns `{}`.
- Web: switched-off module leaves the nav and its route redirects; hidden widget leaves no gap; empty state; `/brokers/connect` redirect.
- Browser (`verify-investing`): toggle a module and a widget, reload, both remembered; full-width layout at desktop and phone widths.

## Out of scope

- ETF sector look-through (part B, spike first).
- Personal-app changes, including a shared shell package.
- Widget reordering.
