# Clean Home, right-hand assistant panel, pop-ups for intake and connect

Status: APPROVED by the owner 2026-11-13 ("approved go ahead") with no edits; the open questions in section 12 take their stated defaults. Plan: `docs/superpowers/plans/2026-11-13-home-assistant-popups.md`. No product code in this change. Branch `feat/home-assistant-popups`, cut from `origin/master` fb5f8f97.
Reader: a builder who cannot ask the owner. Lines marked "owner" are fixed. Everything else is a builder-facing default made by the session that wrote this spec; it may be changed with a one-line note in the PR.

Sources: the owner's review of the live shell (13 Nov, after PR #331) and his four answers of the same day; `.superpowers/research/2026-11-13-sure-settings-home-assistant.md` and `.superpowers/research/2026-11-12-sure-layout-report.md` (git-ignored, local). Earlier spec: `2026-11-13-sure-shell-monochrome-design.md` ("the shell spec"). This spec reverses one of its non-goals: the right-hand assistant panel.

## 1. Intent

The first page of the personal app (`apps/web`, view `overview`) carries too much: an assistant card, an intake invitation, a "room per month" card, a connect checklist and eleven data blocks. The owner judges it against the home page of the open-source app Sure and wants the same calm structure: a few charts, his cards, travel, and a clear place to add more.

Three changes, one round:

1. **Home**: the page is renamed and starts with four fixed blocks and an add area. Everything else is opt-in through four "add" boxes.
2. **Assistant**: leaves the page and becomes a right-hand column of the shell, available on every view.
3. **Pop-ups**: the intake invitation and the connect checklist stop being cards and become dialogs.

Why: LaVega is a consumer money co-pilot. The first screen must show the user's money, not the product's requests to the user. Requests (answer questions, connect a bank) are real but momentary, so they get a momentary surface. The assistant is useful on every page, so it belongs to the frame and not to one page.

## 2. Decided by the owner (fixed)

1. The Assistent leaves Overzicht and becomes a right side panel like Sure's.
2. The intake prompt ("Vertel LaVega over je situatie") is a pop-up when the user has not answered yet, not a card.
3. The card "Koppel voor het complete beeld" / "Connect for the full picture" becomes a pop-up. (His dictation "credit for full purchase block" meant this card; confirmed 13 Nov.)
4. "Je ruimte per maand" leaves the page.
5. The page is renamed **Home**: rail label and page title, nl and en. The URL and the view id stay.
6. Home keeps by default: net-worth chart, outflows chart, statistics, Kaarten, Travel.
7. Totale positie (net worth) and Cashflow share one place with a switch. **Totale positie shows first.**
8. All other blocks now on the page (Recente transacties, Betaalagenda, BTW, Facturen, Positie per bedrijf, Top uitgaven) are **off by default** and offered in an "add new" area of **four boxes**. A user who already made a widget choice keeps it.
9. "Widget toevoegen" in the top bar shows on Home only (shipped in #332; unchanged here).
10. Standing rules that still apply: ADR 0009 (no UI prefs on the server), ADR 0010 (describe and reimplement Sure; never its names, colours, shadows or class strings), restrained motion, the "not financial advice" footer stays, no new view in the default navigation.

Note for the builder: Sure's home has **no** four add boxes. That part is LaVega's own design (section 5.4).

## 3. Goals, non-goals, anti-goals

Goals
- A new user's Home shows four fixed blocks and the add area, in one calm column.
- Adding or hiding a block takes one click on Home and never leaves a hole in the grid.
- The assistant is one click away on every view at >= 1024px, keeps its conversation across views, and never makes main narrower than 480px.
- A user who has something to answer or connect is told once, in a dialog that is easy to dismiss and does not come back for a week.
- Zero bytes leave the browser for an assistant turn (unchanged from the thin slice).

Non-goals (this spec)
- Drag to reorder, per-card collapse, width/height presets, a "customize" mode, a period picker above the page. Sure has these; LaVega does not get them in this round.
- New assistant capabilities: no model call, no new tools, no server route. Only the mounting and the look change.
- The Profiel rework (a later session) and any change to Optimalisatie, Rekeningen or the intake wizard itself.
- An assistant route or view. On a phone the assistant opens in a sheet, not on a page.
- Changing what any data block computes.

Anti-goals (must not happen)
- A pop-up on any view other than Home, more than one pop-up in a browser session, or a pop-up that cannot be closed with Escape.
- A pop-up that hides a problem banner or opens over the vault gate, the wizard or another dialog.
- The assistant answering from a vault snapshot that is older than the last import.
- Any server-side storage of a UI preference; any new network request in the assistant path.
- A hole or a lone narrow card in the Home grid.
- Copy that calls LaVega an adviser, or the disclaimer footer disappearing.

## 4. Constraints

- Local-first. Preferences are per device in `localStorage`, every access in try/catch, and the UI renders correctly when storage is blocked (pattern: `lib/sidebar.ts`, `moduleRegistry.tsx`).
- Effect 4 for new logic (AGENTS.md); React components stay plain. Rules that decide something (which pop-up, which spans, how panels fit) are pure functions with a unit test and no DOM. Time comes in as a parameter; new code uses Effect's `DateTime`, not `Date.now`.
- All colour through `styles/tokens.css` variables; both themes (midnight, monochrome) pass `contrast` after every step.
- Copy in `copy/shell.ts`, `copy/intake.ts`, `copy/assistant.ts`, nl and en, Dutch primary.
- Motion: load `emil-design-eng` and `animate` before writing transition CSS. Budget in section 9.
- Do not commit or push. Leave the tree staged.

## 5. Home

### 5.1 Name
`shellCopy.*.topBar.viewTitles.overview`, the rail/bottom-bar/drawer label and the module-picker texts that say "overzicht"/"overview" become "Home" in both locales. The view id `overview`, the route `/app` and the storage key `lavega.overviewWidgets` do not change.

### 5.2 Default page, top to bottom

```
+--------------------------------------------------------------+
| [Totale positie | Cashflow]                     chart, tall   |
+--------------------------------------------------------------+
| Statistieken (opens on the outflows donut)                    |
+--------------------------------------------------------------+
| Je kaarten                                                    |
+--------------------------------------------------------------+
| Travel                                                        |
+--------------------------------------------------------------+
| Voeg toe aan Home                                             |
| [+ Aandacht] [+ Recente tx] [+ Betaalagenda] [+ Top uitgaven] |
|                                               Alle widgets -> |
+--------------------------------------------------------------+
```

All four blocks are full-width (`span 3`), so the default page is one column at every width, as on Sure.

Gone from the page: `AssistantPanel` (section 6), `IntakeInviteWidget` and `ConnectChecklistWidget` (section 7), `RoomCardWidget` (owner 4). "Je ruimte per maand" stays where it already is: at the end of the wizard and on Jouw plan. `RoomCard.tsx` is deleted if nothing else imports it; `RoomBody` in `intake/RoomPayoff.tsx` stays. Correction 14 Nov 2026: after the build nothing imported `RoomBody` or `RoomPayoff` any more, so `intake/RoomPayoff.tsx` and the `intakeCopy.payoff` block were deleted as dead code.

"Outflows chart" (owner 6) is read as the donut that already exists inside Statistieken (`StatView` "verdeling"), not a new card. Statistieken therefore opens on "verdeling" instead of "categorie". See open question 1.

### 5.3 The chart slot
Cashflow stops being a card of its own: it exists on Home only inside this slot. Top uitgaven (a category list) is a separate opt-in widget and is not the "outflows chart".

One module, `span 3`, `height tall`, with a two-option segmented control in the module header: "Totale positie" | "Cashflow". It renders the body of the existing `SaldoBlock` or `CashflowBlock`; nothing in either calculation changes.
- Preference: `lavega.homeChart` = `"position" | "cashflow"`, default `"position"` (owner 7). Unknown or unreadable value = default.
- The control is a radio group (native inputs, arrow keys). Switching swaps the body with no animation.
- The module title follows the choice. Footer links of the shown block stay.
- When the widget "Positie per bedrijf" is on (only possible while business is not archived), the slot is `span 2` and that card sits beside it, as today.

### 5.4 Widgets and the add area
Registry (`components/moduleRegistry.tsx`):
- Remove ids `intake-invite`, `room-card`, `connect-checklist`. Stored lists that still hold them are cleaned by `normaliseWidgets` (unknown ids are dropped today).
- Add ids `recente-transacties` and `top-uitgaven`, with label, one-line `what` and a preview thumb like the others. Both blocks become widget-gated like `BetaalschemaWidget`.
- `defaultOn` becomes `false` for `betaalagenda` and `btw-stand`. After this change no widget is on by default. The long comments in the registry that explain the old defaults are rewritten to the new rule: "Home starts with the four fixed blocks; every widget is a choice".
- Stored choices (owner 8): the existing `{on, seen}` logic is the migration and is not changed. An id in `seen` keeps the user's answer. The two new ids are in nobody's `seen`, so they start off for everybody. Consequence, accepted: a browser that has a stored choice from before may still show Betaalagenda or BTW; a browser with no stored choice gets the clean page.
- The module picker in Profiel gets one text button "Standaard herstellen" / "Reset to default" that removes the stored widget choice.

Order on the page when widgets are on: Aandacht, chart slot (+ Positie per bedrijf), Statistieken, Recente transacties, Betaalagenda, BTW, Facturen, Top uitgaven, Kaarten, Travel, add area.

No holes: a pure function `homeSpans(enabledIds) -> Record<id, 1 | 2 | 3>` decides the span of every optional card from which neighbours are on. Rules: a row always sums to 3; pairs keep today's proportions (Recente 2 + Betaalagenda 1; BTW 2 + Facturen 1); a card with no partner takes 3. It replaces the three ad-hoc span expressions now in `Overzicht.tsx`. Unit test over every on/off combination of the optional ids: every row sums to 3.

Add area (`HomeAddArea`, new, last child of the grid, `span 3`):
- A heading "Voeg toe aan Home" / "Add to Home" and up to four dashed-outline boxes in an inner grid: 4 columns, 2 at a container width <= 900px, 1 at <= 520px.
- Each box is one widget that is off and not archived, in registry order: label, the registry's one-line `what`, a "+" mark. The whole box is one `<button>`.
- Click: the widget turns on through `setEnabledWidgets`, the box is replaced by the next off widget, and focus moves to the new card's heading. A polite live region says "<label> toegevoegd".
- Fewer than four widgets off: fewer boxes. None off: the area does not render.
- One link under the boxes, "Alle widgets" / "All widgets", calls the existing `handleAddWidget` (opens the picker in Profiel). The top-bar "Widget toevoegen" button keeps the same target.
- With business archived (the production state) the off widgets are exactly Aandacht, Recente transacties, Betaalagenda and Top uitgaven: four boxes.

Hide control: every widget-gated card gets one icon button in its module header, label "Verberg <label>" / "Hide <label>", visible on hover and on focus, always visible on touch. It turns the widget off; focus moves to the add area heading. The box that reappears in the add area is the undo; there is no confirm step and no toast. The four fixed blocks have no hide control.

### 5.5 Empty vault
With no accounts the fixed blocks show their existing empty states. The add area still renders. The sidebar's "add account" row already covers the first action; no new placeholder.

## 6. Assistant panel

### 6.1 Frame, >= 1024px
`Shell` gets a fourth region after main in source order:

```
rail 84 | account sidebar 240..440 | main (>= 480) | assistant 320..520
```

- `<aside id="shell2-assistant" aria-label="Assistent">`, full height, left hairline, its own scroll. Same surface as the account sidebar; no shadow.
- Toggle: an icon button at the right end of the top bar on **every** view (a panel icon mirrored from the sidebar toggle), `aria-expanded`, `aria-controls`, label "Assistent openen" / "sluiten". It sits right of "Widget toevoegen".
- Width: default 380, min 320, max 520. A resize handle on the panel's left edge reuses `SidebarResizeHandle` (mirrored): `role="separator"`, arrow keys 16px, Shift 64px, Home/End, double-click or Enter resets.
- Preference: `lavega.assistantPanel` = `{open, width}`, same shape and fallbacks as `lavega.sidebar`. First visit: open when the viewport is >= 1440, closed below. A stored choice always wins. See open question 2.
- Fit rule, a pure function `fitPanels(viewport, sidebarPrefs, assistantPrefs)`: main never gets narrower than `MAIN_MIN_WIDTH` (480). Widths shrink toward their minimums first. If both panels at minimum width still do not fit (viewport below 84 + 240 + 480 + 320 = 1124), the panel the user opened last stays and the other is shown closed. This is display only: the stored `open` of the other panel is not overwritten, so it returns when the window is wider.
- Closed = not focusable and out of the accessibility tree (`inert`), width 0. The component stays mounted so the conversation survives a close.
- Without `storage` (vault locked, tests) there is no toggle and no panel.
- The module grid already measures its own container (`CONTENT_CONTAINER_CLASS`), so it follows the narrower main without new breakpoints. Verify at 1440 with both panels open: main is 680 and Home is one column.

### 6.2 Phone, < 1024px
No column. The bottom bar gets a fourth item "Assistent" (after Rekeningen, before "Meer"). It is a button, not a link: it opens the assistant in a full-height sheet from the right, built on the `ShellDrawer` mechanics (modal dialog semantics, focus trap, Escape, scrim, page behind `inert`, focus back to the opener). It is not a view and has no route. See open question 3: this is a fourth bar item, which the owner's "no new items in the default nav" rule may or may not cover.

### 6.3 Content
`AssistantPanel` keeps its logic (`routeAssistantIntent`, the three tools, approval events, one `putAssistant` save per decision) and its copy. Layout becomes a column:
- Header: title "Assistent", a close button (same action as the toggle).
- Log: scrolls, newest at the bottom, `aria-live="polite"` as today. The open approval card stays inline in the log.
- Empty state (no messages yet): the existing intro line and three sample chips, one per tool: spending this month, account balances, "onthoud dat ik korte antwoorden wil". A chip click submits that text.
- Input: pinned to the bottom of the panel.
- "Beslissingen" and "Onthouden" lists: one collapsed `<details>` under the log, closed by default.
- The privacy line stays visible under the input.
- The panel currently uses utility classes that `styles/*.css` does not define (`border-border`, `bg-card`, `rounded-tile`, `rounded-chip`, `bg-secondary/30`, `text-muted-foreground`; grep finds no definition). Check in the browser whether they resolve; restyle the panel on the app's tokens either way.

### 6.4 Fresh data
Today the panel reads the vault once on mount and lives only as long as Overzicht. In the frame it lives for the whole session, so a one-time snapshot goes stale after an import or a bank sync. Required: the snapshot is read again **before every turn** (`getAccounts`, `getTxs`, `getRules`), and the assistant state (`getAssistant`) is read again when the panel opens. A test imports a transaction after the panel mounted and asserts that the next spending answer includes it.

### 6.5 What moves in the code
`Overzicht` loses the `storage` prop and the `AssistantPanel` import (the assistant is its only use of `storage`; the widget store is `localStorage`). `Shell` renders the toggle in its own top bar, next to the sidebar toggle's counterpart on the right, and gets no `storage` today. `App.tsx` passes `storage` and `asOf` to `Shell` (or passes the panel as a node, like `sidebar`). `docs/superpowers/specs/2026-11-11-assistant-thin-slice.md` decision 7 ("one card at the top of Overzicht") gets a dated amendment line that points here.

## 7. Pop-ups

### 7.1 One dialog primitive
New `components/ui/Dialog.tsx` on the native `<dialog>` with `showModal()`, the pattern already used by `views/ForwardingGuide.tsx` and the landing sign-in dialog: always mounted, state drives `showModal()`/`close()`, a click on the backdrop closes, Escape closes, focus returns to the element that had it. Width `min(92vw, 480px)`. Title is the dialog's accessible name (`aria-labelledby`). A visible close button. Moving ForwardingGuide onto the primitive is allowed and not required.

### 7.2 Which pop-up, when
A pure function decides: `nextPopup({view, invite, unconnectedBrands, dismissed, shownThisSession, now, blocked}) -> "intake" | "connect" | null`.

- Only when `view === "overview"`, the vault is open, the profile has been read (`intake` prop present), and `blocked` is false. The wizard is its own view (`intake`), so no pop-up can open during it. `blocked` is true in exactly these states: `problems.length > 0` in `App.tsx` (the warning banner), the empty-scope line shows (`scopedAccounts.length === 0 && accounts.length > 0`), the phone drawer or the assistant sheet is open, or another `<dialog>` is open. When a blocked state ends on Home, the pop-up may open then.
- `hasTransactions` is `txs.length > 0`, the value `Overzicht` passes to the card today. Other callers of `inviteState` (`Plan.tsx`, the Profiel plan card) pass the same value so that all three agree.
- `intake` when `inviteState(store, asOf, hasTransactions)` is not null. This covers all four states the card covered: not started, half done, new questions, round 2, risk answers due. See open question 4.
- else `connect` when the unconnected-brand list (the function now private in `ConnectChecklist.tsx`; export it) is not empty.
- At most one pop-up per browser session (`sessionStorage`, with an in-memory fallback). The session mark is written at the moment the dialog **opens**, so a remount of Home, a view round trip or React Strict Mode's double effect cannot open a second one. Intake wins over connect.
- An open assistant panel does not block a pop-up; the dialog is modal and sits above the whole frame.
- Dismissed (button "Later", Escape, backdrop, close button): that pop-up id does not show again for 7 days. Store: `lavega.popups` = `{[id]: ISO timestamp}`. The intake id includes the invite kind (`intake:intake`, `intake:new-questions`, `intake:round2`, `intake:risk`), so a dismissed "start the intake" does not silence a later "new questions".
- Taking the primary action writes no dismissal (the session mark from the open is enough).
- The dialog opens after the page has painted (one frame after mount), never during the vault gate.

Correction 14 Nov 2026: `blocked` does not check for another `<dialog>`. In `App.tsx` it is true for exactly three conditions: `problems.length > 0`, the empty-scope line, and the phone drawer or assistant sheet being open (`overlayOpen`). The "or another `<dialog>` is open" clause above is not implemented.

### 7.3 Intake pop-up
Same texts as the card (`intakeCopy.home.invite`: title, intro, `resumed`, `riskDue`, the two count lines). Primary button "Begin" or "Ga verder" with exactly the card's behaviour, including the `reopenRisk` save before the wizard opens for the risk review and `onOpenRound2` for round 2. Secondary button "Later". `IntakeInviteCard.tsx` is reduced to the exported `inviteState` (moved to `intake/`) and the card component is deleted with its widget wrapper.

The quiet, permanent way in is the plan card at the top of Profiel. It currently always says "Begin" while locked; it now uses `inviteState` too and says "Ga verder" for a half-done wizard. This closes the open minor from PR #332.

### 7.4 Connect pop-up
Title `intakeCopy.home.connect.title`. Body: the list of banks not connected yet, one line each (`connect.line`), with one primary button "Koppelen" that goes to Rekeningen and closes the dialog, and "Later". The per-row links of the old card become that one button. The permanent surface for the same fact is the Kaarten block, which already marks cards that are not connected. `ConnectChecklist.tsx` is deleted except for the exported brand function.

Correction 14 Nov 2026: the Jouw plan page (`views/Plan.tsx`) also used it, so a plain `ConnectChecklist` component stays in `components/blocks/ConnectChecklist.tsx` for that page. Only its Home widget wrapper and the widget id `connect-checklist` are gone.

## 8. Approaches

A. **Extend the existing frame (chosen).** A fourth region in `Shell`, a second panel-prefs store beside `useSidebar`, one `Dialog` primitive on the native element, and the Home page driven by the existing widget registry. Reuses the resize handle, the drawer mechanics, the `{on, seen}` store and the container queries from the shell round. Cost: the fit rule between two side panels is new and needs care at 1024-1279.

B. **Assistant as a floating overlay** over main instead of a column. No width arithmetic and no fit rule. Rejected: it covers the numbers the user is asking about, and the owner asked for a panel "like Sure", which is a column.

C. **Full dashboard parity with Sure**: drag reorder, collapse, size presets, customize mode. Rejected for this round: three to four times the work, a layout store that must survive registry changes, and the owner's request ("clean", "four boxes to add widgets") is met by A. It can follow on top of A because the registry stays the single list.

## 9. Accessibility and motion

- Landmarks: rail `<nav>`, sidebar `<aside aria-label="Rekeningen">`, `<main>`, assistant `<aside aria-label="Assistent">`. Tab order follows source order: skip link, rail, sidebar, main, assistant.
- Opening the assistant with its toggle moves focus to the input; closing returns focus to the toggle. The panel is not modal at >= 1024 and Escape does not close it. The phone sheet is modal.
- Dialogs: native modal semantics; first focus on the primary button; Escape and backdrop close; focus returns. jsdom asserts attributes, Escape and focus return; the trap is checked in a real browser.
- Add boxes and hide buttons are real buttons with text names; hit area >= 44px on touch. Focus is moved explicitly after add and hide (section 5.4) so it is never lost on an unmounted element.
- Nothing in this round carries meaning by colour alone; dashed outlines and "+" marks work in monochrome.
- Motion budget, everything else static: assistant open/close 200ms with `--ease-emphasized` on one width transition (same as the sidebar); phone sheet slide 220ms on `transform`; scrim and dialog fade 150ms on `opacity`; a new card after "add" fades in 150ms. No transition while dragging the handle. `prefers-reduced-motion: reduce` makes all of it instant.

## 10. Delivery: small, independently verifiable steps

Each step is one reviewable diff, green on its own, and the app is usable after it. Each step has its own implementer and a different reviewer.

Common verification for every step: `pnpm --filter @lavega/web typecheck`, `pnpm --filter @lavega/web test`, `pnpm run lint`, the contrast script, and the `verify-lavega` skill with browser screenshots at 1440, 1280, 1024 and 390 in both themes, against a vault with accounts and an empty vault. Evidence under `.superpowers/evidence/home-round/<step>/` (git-ignored); the hand-off cites the paths. A browser check without an evidence file is not done.

1. **Dialog primitive + pop-up rules (S).** `ui/Dialog.tsx`, `nextPopup` and the dismissal store as pure code with tests. Nothing user-visible.
2. **Intake and connect pop-ups (M).** Mount on Home; delete the two cards and their widget ids; Profiel plan card uses `inviteState`. Browser: each of the four invite states and the connect state opens the right dialog once; "Later" survives a reload; nothing opens on another view.
3. **Assistant column, >= 1024 (M-L).** Shell region, toggle, prefs, `fitPanels`, resize handle, restyled panel, fresh-data rule. Below 1024 the card stays on Home until step 4. Browser: both panels at 1440, 1280, 1124 and 1024; conversation survives a view change; the network log shows no request during a turn.
4. **Assistant on the phone (M).** Bottom-bar item and sheet; the card leaves Home at every width. Browser at 390: focus trap, Escape, focus return.
5. **Home page (M).** Rename, registry changes, `homeSpans`, chart slot, Statistieken opens on the donut, `RoomCard` removed. Browser: clean default on an empty `localStorage`; a stored legacy choice is respected; no hole in any combination spot-checked at 1440 and 1024.
6. **Add area and hide control (M).** Browser: add all four, hide them again, keyboard only; "Standaard herstellen" in Profiel.
7. **Docs and cleanup (S).** `DESIGN.md` (Home anatomy, panel, dialog), `CONTEXT.md` terms (Home, widget, add area), the shell spec's non-goal line and the thin-slice amendment, dead CSS (`.chat-widget` in `base.css` if still unused), dead copy keys.

Steps 1-2, 3-4 and 5-6 are three independent lanes after step 1 and may run in parallel worktrees; they meet in `Overzicht.tsx` and `App.tsx`, so merge in the order above.

## 11. Left to the builder

Settled after the builder check (a second agent read this spec against the code, 13 Nov): the exact `blocked` states, when the session mark is written, where `hasTransactions` comes from, Cashflow as slot-only, and the `storage` plumbing. All five are calls of the writing session, not of the owner.


- Whether `lavega.sidebar` and `lavega.assistantPanel` share one generic panel-prefs module. Allowed only if the existing sidebar tests pass unchanged.
- File and component names not given here; the exact icon drawings; the exact Dutch and English wording of new strings (keep them short, no "adviseur").
- How the chart slot reuses `SaldoBlock` and `CashflowBlock` (wrapper that renders one, or bodies extracted); the calculation code must not be duplicated.
- Where the pop-up host mounts (Home view or App), as long as the `blocked` inputs of 7.2 are available there.
- Thumbnails for the two new widgets.

## 12. Open questions for the owner (each has a default; work proceeds on the default)

1. **Outflows chart.** Default: the donut inside Statistieken, shown first; no separate outflows card. Alternative: a separate donut card above Statistieken.
2. **Assistant on first visit.** Default: open at >= 1440px, closed below. Alternative: always closed until the user opens it.
3. **Assistant on the phone.** Default: a fourth item "Assistent" in the bottom bar that opens a sheet. Alternative: an icon in the phone top bar, bar unchanged.
4. **Pop-up for follow-up questions.** Default: the pop-up also covers "new questions", round 2 and the yearly risk review, each at most once per 7 days. Alternative: pop-up only for a user who has not finished the intake; the other three show only on the Profiel plan card.
5. **Existing browsers.** Default: a stored widget choice is kept, so such a browser may still show Betaalagenda or BTW until "Standaard herstellen". Alternative: reset everybody to the clean page once.
6. **Aandacht.** Default: stays opt-in (off), as it is today, and is the first add box. Alternative: on by default, shown only when there is an alert.
7. Carried from the shell round, not part of this spec: signed balance totals vs plain ink; `--warn`/`--pos` as chart series colours; legal check of the card-advice wording.

## 13. Changes during the build (14 Nov 2026)

- The Plan page keeps its connect list: a plain `ConnectChecklist` component stays for `views/Plan.tsx` (see the correction under 7.4).
- `lib/panelPrefs.ts` is one prefs store shared by the sidebar and the assistant panel.
- The assistant panel remounts when the viewport crosses 1024px, so the conversation resets at that crossing (known limit).
- `StatistiekBlock` got an `initialView` prop; it defaults to `"verdeling"` (the donut); the existing tests pass `"categorie"`.
- A browser with a stored widget choice loses Recente transacties and Top uitgaven until the user adds them again.
- Owner point 6 ("outflows chart") is the donut inside Statistieken, so the page has four fixed blocks, not five.
- `blockingInfoOf` and the room-card copy (`home.room`, `blocking`, `anAccount`) were removed with the card.
- Fix wave, 14 Nov 2026: `intake/RoomPayoff.tsx` and `intakeCopy.payoff` deleted (no importer left; supersedes the 5.2 line that kept `RoomBody`).
