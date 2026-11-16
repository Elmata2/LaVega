# Home, Assistant Panel and Pop-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clean "Home" page with five fixed blocks and an add area, the assistant as a right-hand column of the shell, and the intake and connect prompts as dialogs.

**Architecture:** Extend the existing frame (`components/Shell.tsx`) with a fourth region and a second panel-prefs store; add one `Dialog` primitive on the native `<dialog>`; drive Home from the existing widget registry (`components/moduleRegistry.tsx`). Every rule that decides something is a pure function with a unit test.

**Tech Stack:** React 18, TypeScript, Tailwind utilities + hand-written CSS on tokens, vitest + Testing Library (jsdom), Effect 4 (`DateTime`) for new time logic.

**Spec:** `docs/superpowers/specs/2026-11-13-home-assistant-popups-design.md`. Read it first; this plan does not restate it. All paths below are relative to `apps/web/src/` unless they start with `docs/` or `apps/`.

## Global Constraints

- No commit, no push. The implementer leaves changes **unstaged**; the reviewer reads `git diff`; the orchestrator stages approved work with `git add -A`. So "staged" always means "reviewed".
- Local-first (ADR 0009): preferences only in `localStorage`/`sessionStorage`, every access in try/catch, correct render when storage is blocked. No new network request anywhere.
- ADR 0010: never the names Sure or Maybe in product code or copy; no copied class strings.
- New time logic takes `now` as a parameter (ISO string) and uses Effect `DateTime` for arithmetic; no `Date.now()` in new pure code.
- All colour through `styles/tokens.css` variables. No hex outside it.
- Copy in nl and en (`copy/shell.ts`, `copy/intake.ts`, `copy/assistant.ts`), Dutch primary, short, never "adviseur"/"adviser".
- Motion: load the `emil-design-eng` and `animate` skills before writing any transition CSS. Budget: spec section 9. `prefers-reduced-motion: reduce` makes all of it instant.
- Storage keys, verbatim: `lavega.homeChart`, `lavega.assistantPanel`, `lavega.popups`, session key `lavega.popupShown`. Existing keys `lavega.sidebar` and `lavega.overviewWidgets` do not change.
- Numbers, verbatim: assistant width default 380, min 320, max 520; first-visit open at viewport >= 1440; `MAIN_MIN_WIDTH` 480; rail 84; sidebar min 240; pop-up snooze 7 days; dialog width `min(92vw, 480px)`; add-area inner grid 4 / 2 (container <= 900px) / 1 (<= 520px).
- Per task, before hand-back: `pnpm --filter @lavega/web typecheck`, `pnpm --filter @lavega/web test`, `pnpm run lint` (from the repo root), and the contrast script if any CSS changed. Report the real output tail.
- Existing tests that pin removed behaviour are updated or deleted in the same task, with one line in the report saying which and why.

## Review Focus

1. Storage blocked (private mode): pop-up rules, panel prefs and chart choice must fall back to memory/defaults and never throw. Tests in Tasks 1, 3, 5.
2. A stored widget list from an older version (`["aandacht"]`, or `{on, seen}` that contains `intake-invite`): Home must render, unknown ids dropped, no crash. Test in Task 5.
3. Vault changed after the assistant mounted (import, bank sync): the next answer uses the new rows. Test in Task 3.
4. Viewport between 1024 and 1123 with both panels wanted: main never under 480, the stored `open` of the hidden panel is not overwritten. Test in Task 3.
5. Remount and React Strict Mode: a pop-up opens at most once per session; add/hide never leaves focus on an unmounted node. Tests in Tasks 2 and 6.

---

### Task 1: Dialog primitive and pop-up rules

**Files:**
- Create: `components/ui/Dialog.tsx`, `components/ui/Dialog.test.tsx`
- Create: `lib/popups.ts`, `lib/popups.test.ts`
- Modify: `styles/modules.css` (dialog rules beside `.guide-dialog`, same transition values, new class `ui-dialog`)

**Interfaces — Produces:**
```ts
// components/ui/Dialog.tsx
export type DialogProps = {
  open: boolean;
  onClose: () => void;          // Escape, backdrop click, close button
  title: string;                // rendered <h2>, wired with aria-labelledby
  closeLabel: string;
  children: ReactNode;          // body
  actions?: ReactNode;          // footer buttons
  initialFocusRef?: RefObject<HTMLElement | null>;
};
export default function Dialog(props: DialogProps): JSX.Element;

// lib/popups.ts
export type PopupId = "intake:intake" | "intake:new-questions" | "intake:round2" | "intake:risk" | "connect";
export type Dismissed = Partial<Record<PopupId, string>>;   // ISO timestamps
export const POPUP_SNOOZE_DAYS = 7;
export function isSnoozed(dismissedAt: string | undefined, now: string): boolean;
export function nextPopup(input: {
  view: string;                       // only "overview" can show one
  inviteKind: "intake" | "new-questions" | "round2" | "risk" | null;
  unconnectedCount: number;
  dismissed: Dismissed;
  shownThisSession: boolean;
  blocked: boolean;
  now: string;
}): PopupId | null;
export function readDismissed(): Dismissed;                 // lavega.popups, {} on any failure
export function writeDismissed(id: PopupId, now: string): void;
export function wasShownThisSession(): boolean;             // sessionStorage lavega.popupShown, in-memory fallback
export function markShownThisSession(): void;
export function forgetPopupMemory(): void;                  // tests only
```

- [ ] **Step 1: failing tests for `lib/popups.ts`.** Cases, each one `it`:
  - `nextPopup` returns null when `view !== "overview"`, when `blocked`, when `shownThisSession`.
  - intake wins: `inviteKind: "round2"`, `unconnectedCount: 2` -> `"intake:round2"`.
  - `inviteKind: null`, `unconnectedCount: 1` -> `"connect"`; `unconnectedCount: 0` -> null.
  - snooze: dismissed `"intake:intake"` at `2026-11-10T10:00:00Z`, now `2026-11-13T10:00:00Z` -> falls through to connect (or null); now `2026-11-17T10:00:01Z` -> `"intake:intake"` again.
  - a dismissed `"intake:intake"` does not silence `"intake:new-questions"`.
  - `isSnoozed(undefined, now)` false; an unparsable timestamp counts as not snoozed.
  - `readDismissed` returns `{}` when `localStorage.getItem` throws and when the value is not an object; `writeDismissed` does not throw when `setItem` throws.
  - `wasShownThisSession` is true after `markShownThisSession` even when `sessionStorage` throws (memory fallback).
- [ ] **Step 2: run, expect fail.** `pnpm --filter @lavega/web test -- popups`
- [ ] **Step 3: implement `lib/popups.ts`.** Day arithmetic with Effect `DateTime` (see `repos/effect/LLMS.md`); pattern for storage fallbacks: `lib/sidebar.ts`.
- [ ] **Step 4: failing tests for `Dialog`.** `open` true calls `showModal` (polyfilled in `testSetup.ts`) and the element has `aria-labelledby` pointing at the title; Escape (`cancel` event) calls `onClose`; a click whose target is the `<dialog>` itself calls `onClose`, a click inside the body does not; `open` false after true calls `close()`; the close button has `closeLabel` as accessible name.
- [ ] **Step 5: implement `Dialog`.** Mechanism copied from `views/ForwardingGuide.tsx:134-145`: always mounted, an effect drives `showModal()`/`close()`, the `close` event is not relied on. Focus return is the native behaviour of `<dialog>`; `initialFocusRef` is focused after `showModal()`.
- [ ] **Step 6: CSS `ui-dialog`** in `styles/modules.css`: width `min(92vw, 480px)`, tokens only, fade 150ms on opacity, `::backdrop` on `--scrim`, reduced-motion instant.
- [ ] **Step 7: run all checks** (Global Constraints). Nothing user-visible changes in this task.

### Task 2: Intake and connect pop-ups

**Files:**
- Create: `intake/inviteState.ts` (move `inviteState`, `InviteState`, `ResumeAt` out of `components/blocks/IntakeInviteCard.tsx`), `intake/unconnectedBrands.ts` (export the function now private in `components/blocks/ConnectChecklist.tsx`)
- Create: `components/HomePopups.tsx`, `components/HomePopups.test.tsx`
- Delete: `components/blocks/IntakeInviteCard.tsx`, `components/blocks/ConnectChecklist.tsx` and their tests (move the `inviteState` and brand-list tests to the new files)
- Modify: `views/Overzicht.tsx` (remove both widgets), `App.tsx` (mount `HomePopups`), `views/Plan.tsx` and `views/Profiel.tsx` (import path, `hasTransactions`, "Ga verder"), `components/moduleRegistry.tsx` (remove ids `intake-invite`, `connect-checklist`), `copy/intake.ts` (`later`, `connect.cta` nl/en), `copy/shell.ts` (remove the two widget texts)

**Interfaces:**
- Consumes: `Dialog`, `nextPopup`, `readDismissed`, `writeDismissed`, `wasShownThisSession`, `markShownThisSession` (Task 1).
- Produces:
```ts
// intake/inviteState.ts — signature unchanged
export function inviteState(store: AdvisorProfileStore | null, asOf: string, hasTransactions?: boolean): InviteState | null;
export function inviteKindOf(state: InviteState | null): "intake" | "new-questions" | "round2" | "risk" | null; // "risk" when kind "intake" && riskDue
// intake/unconnectedBrands.ts
export function unconnectedBrands(store: AdvisorProfileStore | null, accounts: readonly Pick<Account, "bank" | "linkedAt">[]): string[];
// components/HomePopups.tsx
export type HomePopupsProps = {
  view: View;
  blocked: boolean;
  store: AdvisorProfileStore | null;
  profileReady: boolean;            // false while the profile is loading or errored: nothing opens
  asOf: string;
  hasTransactions: boolean;
  accounts: readonly Pick<Account, "bank" | "linkedAt">[];
  onSave: (next: AdvisorProfileStore) => Promise<void>;
  onOpenIntake: () => void;
  onOpenRound2: () => void;
  onOpenAccounts: () => void;
  now?: () => string;
};
export function HomePopups(props: HomePopupsProps): JSX.Element | null;
```

- [ ] **Step 1: move `inviteState` and `unconnectedBrands`**, add `inviteKindOf`; keep their existing tests green under the new paths.
- [ ] **Step 2: failing tests for `HomePopups`** (render with a fake clock via `now`):
  - store `null`, `view="overview"` -> a dialog with title `intakeCopy.nl.home.invite.title`, primary "Begin"; clicking it calls `onOpenIntake` and writes **no** entry in `lavega.popups`.
  - "Later" writes `lavega.popups["intake:intake"]` and the dialog closes; a fresh render at now + 6 days shows nothing; at now + 8 days (with `forgetPopupMemory()` and a cleared session key) it shows again.
  - a round 2 store -> title `invite.round2.title`, primary calls `onOpenRound2`.
  - risk due -> primary first resolves the `reopenRisk` save (same mechanism as the deleted card: `useProfileCommit(...).update(reopenRisk)`), then calls `onOpenIntake`.
  - finished intake + one unconnected brand -> connect dialog listing `connect.line(bankName)`, primary calls `onOpenAccounts`.
  - `view="profiel"` -> nothing. `blocked` -> nothing; when `blocked` turns false on the same mount the dialog opens.
  - unmount and remount in the same session -> nothing (session mark written on open). Under `<StrictMode>` exactly one dialog opens.
  - `profileReady={false}` -> nothing.
- [ ] **Step 3: implement `HomePopups`.** The session mark is written in the same effect that opens the dialog. Open one frame after mount (`requestAnimationFrame`, cancelled on unmount).
- [ ] **Step 4: mount in `App.tsx`** beside the `Shell` children. `blocked = problems.length > 0 || (scopedAccounts.length === 0 && accounts.length > 0) || drawerOrSheetOpen`. Shell owns the drawer state, so add an optional `onOverlayChange?: (open: boolean) => void` prop to `Shell` and call it when the phone drawer (and, after Task 4, the assistant sheet) opens or closes. `profileReady` and `store` come from `profileRead` exactly as the `intake` prop of `Overzicht` is built today (`App.tsx:2370-2383`). `hasTransactions = txs.length > 0`.
- [ ] **Step 5: Profiel plan card** (`views/Profiel.tsx:549-557`): while locked, the button says `invite.resume` when `inviteState(...)` has `resumeAt !== null`, else `invite.start`. `Plan.tsx:119` passes `hasTransactions` too. Add the props these views need.
- [ ] **Step 6: delete the two cards and the two widget ids**; fix every test that referenced them. A stored `lavega.overviewWidgets` containing the removed ids must still resolve (test: `enabledWidgets({on:["intake-invite","betaalagenda"], seen:["intake-invite","betaalagenda"]})` -> `["betaalagenda"]`).
- [ ] **Step 7: run all checks.**

### Task 3: Assistant column at >= 1024px

**Files:**
- Create: `lib/assistantPanel.ts`, `lib/assistantPanel.test.ts`, `hooks/useAssistantPanel.ts`, `hooks/useAssistantPanel.test.tsx`
- Modify: `components/Shell.tsx` + `Shell.test.tsx`, `components/SidebarResizeHandle.tsx` (optional `edge?: "right" | "left"`, default `"right"`; `"left"` inverts the drag delta and arrow keys), `assistant/AssistantPanel.tsx` + test, `styles/shell.css`, `copy/shell.ts` (`frame.assistantLabel/assistantOpen/assistantClose`), `copy/assistant.ts` (chips, `close`), `App.tsx`, `views/Overzicht.tsx`

**Interfaces — Produces:**
```ts
// lib/assistantPanel.ts
export const ASSISTANT_KEY = "lavega.assistantPanel";
export const ASSISTANT_DEFAULT_WIDTH = 380;
export const ASSISTANT_MIN_WIDTH = 320;
export const ASSISTANT_MAX_WIDTH = 520;
export const ASSISTANT_OPEN_MIN_VIEWPORT = 1440;
export type PanelPrefs = { open: boolean; width: number };
export function defaultAssistant(viewport: number): PanelPrefs;
export function readAssistant(viewport: number): PanelPrefs;
export function writeAssistant(prefs: PanelPrefs): boolean;
export type Fit = { sidebarOpen: boolean; sidebarWidth: number; assistantOpen: boolean; assistantWidth: number };
export function fitPanels(input: {
  viewport: number;
  sidebar: PanelPrefs;
  assistant: PanelPrefs;
  lastOpened: "sidebar" | "assistant";
}): Fit;
// hooks/useAssistantPanel.ts
export type AssistantPanelApi = { prefs: PanelPrefs; toggle: () => void; setWidth: (w: number) => void; reset: () => void };
export function useAssistantPanel(): AssistantPanelApi;
// Shell: new optional prop
assistant?: ReactNode;   // absent = no toggle, no region
// AssistantPanel: new props
export type AssistantPanelProps = { storage: VaultStorage; asOf: string; variant: "panel" | "card"; onClose?: () => void; active?: boolean };
```
`useSidebar` must expose its raw stored prefs for `fitPanels`; add `prefs: SidebarPrefs` to `SidebarApi` without changing existing fields. Existing sidebar tests pass unchanged.

- [ ] **Step 1: failing tests for `fitPanels`** (rail 84, main >= 480):
  - 1440, sidebar `{open, 296}`, assistant `{open, 380}` -> both open, widths 296 and 380 (main 680).
  - 1280, sidebar 440, assistant 520 -> both open, widths shrunk, `1280 - 84 - s - a >= 480`, neither under its minimum.
  - 1100, both open, `lastOpened: "assistant"` -> `sidebarOpen: false`, `assistantOpen: true`; with `lastOpened: "sidebar"` the reverse.
  - 1124 exactly, both at minimum -> both open (240 + 320).
  - only one open -> the other's width is irrelevant, main >= 480.
  - `defaultAssistant(1440).open === true`, `defaultAssistant(1439).open === false`; `readAssistant` falls back to the default on garbage and when storage throws; `writeAssistant` returns false and keeps the choice in memory when `setItem` throws.
- [ ] **Step 2: implement `lib/assistantPanel.ts` and the hook** (mirror `lib/sidebar.ts` / `hooks/useSidebar.ts`).
- [ ] **Step 3: failing Shell tests** (viewport mocked wide, `assistant` node given): an `<aside id="shell2-assistant">` with the `frame.assistantLabel` name exists after `<main>` in DOM order; the top-bar toggle has `aria-controls="shell2-assistant"` and flips `aria-expanded`; closed -> the aside has `inert`; toggling open writes `lavega.assistantPanel`; without the `assistant` prop there is no toggle and no aside; at viewport 1100 with both wanted, opening the assistant makes the sidebar `inert` and `lavega.sidebar` still says `open: true`; below 1024 neither the aside nor the toggle renders (Task 4 adds the phone path).
- [ ] **Step 4: implement the region in `Shell.tsx`.** `lastOpened` is component state set by each toggle. Opening by the toggle focuses `#assistant-input`; closing returns focus to the toggle. The handle sits on the aside's left edge (`edge="left"`).
- [ ] **Step 5: failing AssistantPanel tests:** with `variant="panel"`: a close button calls `onClose`; with no messages three chips render and a chip click submits its text; the decisions and memory lists sit inside a closed `<details>`; **fresh data:** a storage fake whose `getTxs` returns one more transaction on its second call -> the second spending question's answer includes it; `getAssistant` is read again when `active` goes false -> true.
- [ ] **Step 6: restyle and rework `AssistantPanel`.** Column layout: header, scrolling log, `<details>`, pinned input, privacy line. Read `getAccounts/getTxs/getRules` before every turn instead of once. Replace the undefined utility classes (`border-border`, `bg-card`, `rounded-tile`, `rounded-chip`, `bg-secondary/30`, `text-muted-foreground`) with app tokens/classes. `variant="card"` keeps a bordered card for Home below 1024 until Task 4.
- [ ] **Step 7: wire in `App.tsx`**: `assistant={storage ? <AssistantPanel variant="panel" .../> : undefined}`. `Overzicht` renders its inline card only when `useMediaQuery("(min-width: 1024px)")` is false.
- [ ] **Step 8: CSS in `styles/shell.css`** (`shell2-assistant*`), width transition 200ms `--ease-emphasized`, none while dragging, reduced motion instant. Load the Emil skills first.
- [ ] **Step 9: run all checks.**

### Task 4: Assistant on the phone

**Files:**
- Create: `components/AssistantSheet.tsx`, `components/AssistantSheet.test.tsx`
- Modify: `components/BottomBar.tsx` + test, `components/Shell.tsx` + test, `views/Overzicht.tsx` (drop `storage` and the inline card completely), `App.tsx`, `styles/shell.css`, `copy/shell.ts` (`frame.assistant`)

**Interfaces:**
- Consumes: Shell's `assistant` node and `onOverlayChange` (Tasks 2, 3).
- Produces: `BottomBar` gets `onOpenAssistant?: () => void` and `assistantExpanded?: boolean`; `AssistantSheet({ open, onClose, title, closeLabel, children })`.

- [ ] **Step 1: failing tests.** BottomBar with `onOpenAssistant`: a `<button class="shell2-bar-item shell2-bar-assistant">` named `frame.assistant` after the module links and before "Meer", `aria-haspopup="dialog"`; without the prop no such button. Sheet: `role="dialog"`, `aria-modal="true"`, labelled by its title; Escape and scrim click call `onClose`; focus moves in on open. Shell below 1024: clicking the bar item opens the sheet, makes `main` and the bar `inert`, calls `onOverlayChange(true)`; closing returns focus to `.shell2-bar-assistant`; the menu drawer and the sheet are never open together.
- [ ] **Step 2: implement.** Reuse the focus-trap helper of `ShellDrawer.tsx` (extract `tabbables` to a shared module rather than copying it). The sheet slides from the right, full height, 220ms on `transform`.
- [ ] **Step 3: remove the inline assistant from `Overzicht`** and the `storage` prop from its type and from the `App.tsx` call site; delete tests that pinned the card on Home.
- [ ] **Step 4: run all checks.**

### Task 5: Home page

**Files:**
- Create: `lib/homeLayout.ts`, `lib/homeLayout.test.ts`, `lib/homeChart.ts`, `lib/homeChart.test.ts`, `components/blocks/ChartSlot.tsx`, `components/blocks/ChartSlot.test.tsx`
- Delete: `components/blocks/RoomCard.tsx` + test
- Modify: `views/Overzicht.tsx`, `components/moduleRegistry.tsx` + tests, `components/blocks/RecenteTransactiesBlock.tsx`, `components/blocks/TopUitgavenBlock.tsx`, `components/blocks/StatistiekBlock.tsx` (initial view `"verdeling"`), `components/ModulePicker.tsx` + `views/Profiel.tsx` (reset button), `copy/shell.ts`, `copy/intake.ts` (drop `home.room` keys that are now unused)

**Interfaces — Produces:**
```ts
// moduleRegistry.tsx
export type WidgetId = "aandacht" | "positie" | "recente-transacties" | "betaalagenda" | "btw-stand" | "facturen-open" | "top-uitgaven";
// WIDGETS order = page order: aandacht, positie, recente-transacties, betaalagenda, btw-stand, facturen-open, top-uitgaven. No entry has defaultOn: true.
export function resetWidgets(): void;      // removes lavega.overviewWidgets, notifies listeners
// lib/homeLayout.ts
export type HomeSpans = Partial<Record<WidgetId | "chart", 1 | 2 | 3>>;
export function homeSpans(enabled: readonly WidgetId[]): HomeSpans;
// lib/homeChart.ts
export type HomeChart = "position" | "cashflow";
export function readHomeChart(): HomeChart;          // default "position"
export function writeHomeChart(value: HomeChart): void;
// components/blocks/ChartSlot.tsx
export default function ChartSlot(props: { span: 2 | 3; saldo: SaldoBlockProps; cashflow: CashflowBlockProps }): JSX.Element;
```

- [ ] **Step 1: failing tests for `homeSpans`.** For every subset of the six optional ids (all except `aandacht`, which is always 3): walking the page order chart, positie, recente-transacties, betaalagenda, btw-stand, facturen-open, top-uitgaven, the spans of enabled entries pack into rows that each sum to exactly 3. Fixed cases: `[]` -> `{chart: 3}`; `["positie"]` -> chart 2, positie 1; `["recente-transacties","betaalagenda"]` -> 2 and 1; `["recente-transacties"]` -> 3; `["btw-stand","facturen-open"]` -> 2 and 1; `["betaalagenda","top-uitgaven"]` -> a pair that sums to 3 (2 + 1).
- [ ] **Step 2: implement `homeSpans`.** Greedy rows: preferred pairs first (chart+positie, recente+betaalagenda, btw+facturen); remaining singles pair in page order as 2 + 1; a last lone card takes 3.
- [ ] **Step 3: registry.** Remove `room-card`; add the two ids with nl label equal to the card title, a one-line `what`, a `Thumb` preview; set `defaultOn` false (or absent) for `betaalagenda` and `btw-stand`; rewrite the `defaultOn` comment block to the new rule (one short paragraph, English). `LEGACY_ARRAY_WIDGETS` and the `{on, seen}` logic stay as they are. Tests: `DEFAULT_WIDGETS` is `[]`; a stored `{on:["betaalagenda"], seen:[...old ids]}` still yields `["betaalagenda"]`; the bare legacy array `["aandacht"]` yields `["aandacht"]`; `resetWidgets()` then `enabledWidgets(getEnabledWidgets())` is `[]`. Add nl/en `widgetTexts` for the new ids in `copy/shell.ts` (follow the existing entries).
- [ ] **Step 4: gate the two blocks** with `useWidgetEnabled` wrappers exported as the default (pattern: `BetaalschemaBlock.tsx:291-304`), each taking a `span` prop.
- [ ] **Step 5: `ChartSlot`.** Failing tests: default shows the Totale positie body and a radio group with two options, "Totale positie" checked; choosing "Cashflow" swaps the body and writes `lavega.homeChart = "cashflow"`; a stored `"cashflow"` is honoured on mount; a garbage value or throwing storage gives "position". Implement by rendering `SaldoBlock` or `CashflowBlock` with the control passed into the module header: give both blocks an optional `headerControl?: ReactNode` (rendered in `Module`'s `period` slot) and an optional `span`. No calculation code is copied.
- [ ] **Step 6: rewrite the `Overzicht` render** to the order of spec 5.4 with spans from `homeSpans(useOverviewWidgets()[0])`. Remove `RoomCardWidget`, the standalone `CashflowBlock`, and the three ad-hoc span expressions. Rewrite the file's header comment to describe the new page (English, short). `intake` prop: keep only what `KaartenBlock` needs (`store`).
- [ ] **Step 7: rename.** `viewTitles.overview`, `nav.moduleLabels.overview` and the picker strings that say "overzicht"/"overview" -> "Home" in nl and en. The view id, route and storage key stay.
- [ ] **Step 8: Statistieken opens on `"verdeling"`**; update the tests that assumed `"categorie"` first.
- [ ] **Step 9: "Standaard herstellen" / "Reset to default"** text button under the widget picker in Profiel, calling `resetWidgets()`.
- [ ] **Step 10: run all checks.**

### Task 6: Add area and hide control

**Files:**
- Create: `components/HomeAddArea.tsx`, `components/HomeAddArea.test.tsx`, `components/WidgetHideButton.tsx`
- Modify: `views/Overzicht.tsx`, the widget-gated blocks (`AandachtBlock`, `PositieBlock`, `RecenteTransactiesBlock`, `BetaalschemaBlock`, `BtwWidget`, `FacturenWidget`, `TopUitgavenBlock`: pass `menu={<WidgetHideButton id=... />}` to `Module`), `components/Module.tsx` (heading gets `tabIndex={-1}` and a `data-widget` attribute when given an optional `widgetId`), `styles/modules.css`, `copy/shell.ts` (`home.addHeading`, `home.allWidgets`, `home.added(label)`, `home.hide(label)`)

**Interfaces:**
- Consumes: `WIDGETS`, `useOverviewWidgets`, `toggleWidget`, `isArchivedWidget`, `homeSpans` (Task 5).
- Produces: `HomeAddArea({ onOpenPicker }: { onOpenPicker: () => void })`; `WidgetHideButton({ id }: { id: WidgetId })`.

- [ ] **Step 1: failing tests.** With nothing stored and business archived (the default of `archive.ts`): exactly four `<button>` boxes, in order Aandacht, Recente transacties, Betaalagenda, Top uitgaven, each with its label and `what`; clicking the first writes `lavega.overviewWidgets` with `aandacht` on, the box list becomes three, a `role="status"` region says `home.added("Aandacht")`, and focus is on the element `[data-widget="aandacht"]` heading (render inside a small harness that also renders the widget). With all widgets on, the area renders nothing. The "Alle widgets" link calls `onOpenPicker`. `WidgetHideButton` for `betaalagenda`: accessible name `home.hide("Betaalagenda")`; click turns the widget off and focus lands on the add-area heading (`tabIndex={-1}`). Under `<StrictMode>` one click adds exactly one widget.
- [ ] **Step 2: implement.** Focus moves in an effect that runs after the store change is rendered. Mount `HomeAddArea` as the last child of the grid in `Overzicht` (`span 3`); `onOpenPicker` is the existing `handleAddWidget` from `App.tsx` (thread one prop).
- [ ] **Step 3: CSS.** Dashed hairline boxes on tokens, inner grid 4 / 2 at container <= 900px / 1 at <= 520px, hit area >= 44px; hide button visible on `:hover`, `:focus-within` and `(hover: none)`; new card fade-in 150ms; reduced motion instant. Emil skills first.
- [ ] **Step 4: run all checks.**

### Task 7: Docs and cleanup

**Files:** `DESIGN.md`, `docs/CONTEXT.md` (or root `CONTEXT.md`, whichever holds the glossary), `docs/superpowers/specs/2026-11-13-sure-shell-monochrome-design.md` (one dated line under Non-goals: superseded by the home spec), `docs/superpowers/specs/2026-11-11-assistant-thin-slice.md` (dated amendment under decision 7), `styles/base.css` (`.chat-widget` if `grep` finds no user), unused copy keys.

- [ ] **Step 1:** `DESIGN.md`: Home anatomy (five fixed blocks, widgets, add area), the assistant column and its numbers, the `Dialog` primitive and the pop-up rules, in the document's existing style.
- [ ] **Step 2:** Glossary terms: Home, widget, add area, assistant panel, pop-up.
- [ ] **Step 3:** The two spec amendments.
- [ ] **Step 4:** Dead code: `grep -rn "chat-widget\|RoomCard\|IntakeInviteCard\|ConnectChecklist" apps/web/src` must return nothing but intended references; remove unused copy keys that typecheck reveals.
- [ ] **Step 5: run all checks.**

---

## Browser verification (orchestrator, after Tasks 2, 4 and 6)

`verify-lavega` skill; headless Chromium at 1440, 1280, 1100, 1024 and 390, both themes, a vault with accounts and an empty vault. Evidence under `.superpowers/evidence/home-round/<task>/`. Checks: spec section 10 per step, plus the network log during an assistant turn (no request).
