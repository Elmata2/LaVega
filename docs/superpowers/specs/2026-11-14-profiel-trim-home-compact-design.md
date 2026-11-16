# Profiel trim, compact Home charts, brand mark font

Date: 14 Nov 2026. Branch: `feat/profiel-trim-home-compact` (from `origin/master` `3bb552bd`).
Status: written from the owner's dictated review of the live site (after PR #333). The owner
ordered "make a spec, then implement" while away, so the calls in section 6 are the controller's
and are open for correction.

## 1. Intent

The owner reviewed the live shell. Verdict: "already much better". Three things are left before
the wizard, the Instinct agent and the card functionality get their turn:

1. The brand mark ("LV" and "LaVega") must use the same font as the rest of the app.
2. The four fixed Home blocks must be smaller, so that all four are visible in one view.
3. Profiel must be cut down "massively" and put in a logical order.

## 2. Goals

- One font (Geist, the body face) for the brand mark in the rail, the sidebar and the phone drawer.
- At 1440 x 900 the four fixed Home blocks (chart slot, Statistieken, Kaarten, Travel) are all
  fully visible without a scroll, in a 2 x 2 arrangement, with the assistant panel open or closed.
- Profiel shows five things, in this order, and nothing else:
  1. **Algemeen** (General): e-mail of the account, first name, last name, country and region,
     language, appearance (theme).
  2. **Jouw plan**: unchanged card. The "Over jou" entry becomes a secondary link in this card.
  3. **Importeren**: the existing bank import card, unchanged.
  4. **Back-up**: a simpler card (section 4.4).
  5. **Uitloggen**: exactly one sign-out control on the page.
  The build stamp stays as the last line.

## 3. Non-goals and anti-goals

- No change to the vault format, to stored preferences or to what any setting does.
- No deletion of feature code that is "removed for now". Hide it; do not delete it.
- No new view and no new item in the default navigation.
- No change to a data-sharing default (section 6, call 3).
- ADR 0009 (UI preferences stay in the browser) and ADR 0010 (no Sure/Maybe names, no copied
  class strings) apply. Copy never calls LaVega an adviser.
- Anti-goal: a setting that still has an effect but that the user can no longer reach or see,
  with the exception of the items listed in 4.3.

## 4. Design

### 4.1 Brand mark

Every element that renders "LV" or "LaVega" as the app brand inside the signed-in shell (rail top,
sidebar head, phone drawer, sheet heads if any) uses `var(--font-body)` (Geist). Weight and size
may be tuned so the mark still reads as a mark (for example 600 weight, slight negative tracking).
The landing page keeps its serif headlines; its own logo is out of scope.

### 4.2 Compact Home

- The four fixed blocks sit in a 2 x 2 grid when the Home container is wide enough for two
  columns; one column below that (existing breakpoints stay).
- Block heights go down so that two rows plus the page head fit in a 900px-high viewport at a
  1440px-wide window. Target: each fixed block at most about 340px high in that window. Charts
  scale down with the block; no clipped legend, no clipped axis label, no inner scroll bar.
- The add area and added widgets stay below the fold; that is accepted.
- At 390px nothing may get worse: no new horizontal scroll.

### 4.3 Profiel: what goes

| Card today | Decision |
|---|---|
| Modules | Removed from Profiel. A stored module choice stays honoured. |
| Widgets op Home (with "Standaard herstellen") | Removed. Home's add boxes and hide buttons are the only control. |
| Land en regio | Moves into Algemeen. The two explanatory paragraphs shrink to one short line. |
| Delen met LaVega Investing | Removed from Profiel. The stored value and the default do not change (call 3). 2026-11-14: the card stays visible for anyone who already opted in (or has a delete pending), so the choice can still be seen and revoked. |
| Vreemde valuta | Leaves Profiel. It becomes a small pop-up on Rekeningen (4.5). |
| Bestand met eigen kolommen | Hidden behind a flag in `archive.ts`. |
| Documenten | Hidden behind a flag in `archive.ts`. |
| Cashback corrigeren | Hidden behind a flag in `archive.ts`. Later: a pop-up. |
| Over jou | Becomes a secondary link in the Jouw plan card. |
| Account + Uitloggen (two cards, two buttons) | One e-mail line in Algemeen, one sign-out control at the bottom. |

Any entry point elsewhere that led to a removed card (for example "Widget toevoegen" that scrolls
to the Modules card, `focusModules`) is removed or pointed at the Home add area. No dead link.

### 4.4 Back-up, simpler

One card: one line of text, the primary action "Back-up maken" and the secondary action
"Terugzetten". Everything else the card has today (server back-up options, long explanations,
status detail) goes inside a closed `<details>` "Meer opties" in the same card. No function is
lost and no behaviour changes.

### 4.5 Vreemde valuta on Rekeningen

Rekeningen gets one quiet control in its page head or toolbar ("Valuta-instellingen"). It opens the
shared `Dialog` (`components/ui/Dialog.tsx`) with the existing convert / separate checkbox and its
one-line description. Same state, same handler (`fxConversionMode`, `onFxConversionModeChange`).

### 4.6 Sign-out

One control labelled "Uitloggen" at the bottom of Profiel. When an account session exists it signs
out of the account (existing `handleSignOut` path) and then locks the vault (existing `onLock`).
When no account session exists it only locks. The signed-out and unconfigured account states keep
their existing content (sign-in form or note) inside Algemeen.

## 5. Approaches considered

- **A. Reorder and hide in place (chosen).** Edit `views/Profiel.tsx`, hide three cards behind
  archive flags, move two controls. Small diff, nothing deleted, every item can come back.
- **B. Settings sub-pages like Sure (General / Transactions / Advanced).** Right long-term shape,
  but the owner planned a later full Profiel session for that; too large for "one last UI check".
- **C. Delete the removed cards and their code.** Rejected: the owner said "for now".

## 6. Calls made for the owner (each can be undone)

1. **"Four next to each other on one view" = 2 x 2 in one viewport**, not four in one row. With
   the sidebar and the assistant open, main is about 700–800px wide; four charts in one row would
   be unreadable. Cost if wrong: one CSS change.
2. **"Booklins" = the Documenten card.** It is the only card between "eigen kolommen" and
   "Cashback" in page order. Cost if wrong: flip one flag.
3. **"Investing: assume yes, remove it" = remove the card only.** Turning net-worth sharing on by
   default would send data to the Investing server without a visible consent. That is a privacy
   decision, so the default is not changed here. Open question for the owner.
4. **Appearance (theme) stays, inside Algemeen.** The owner did not name it; without it the
   monochrome theme cannot be chosen.
5. **Modules card removed means optional views can no longer be switched on in the UI.** The owner
   asked for this. Stored choices stay.
6. **One sign-out does both: account sign-out and vault lock.**

## 7. Verification

- `pnpm --filter @lavega/web typecheck`, `pnpm run lint`, `pnpm --filter @lavega/web test`,
  contrast script, build: all exit 0.
- Browser, both themes: Home at 1440 x 900 with panel open and closed (four blocks in view,
  measured), 1280, 1024, 390; Profiel at 1440 and 390 (card order, one sign-out); Rekeningen
  pop-up opens, toggles, closes with Escape.

## 8. Changes during the build (14 Nov 2026)

- **4.1 Brand mark.** Every brand element in the signed-in app already used Geist. The one serif
  mark was the landing page wordmark ("LaVega" in the header and in the product mockup nav). Both
  now use Geist, weight 600. Landing headlines keep the serif.
- **4.2 Compact Home.** The four fixed blocks sit in their own `.home-fixed` group. Measured at
  1440 x 900 with the assistant panel closed: lowest block bottom 805–888px on every Statistieken
  tab and both chart modes. With the panel open at 1440 the group is one column (a column under
  380px is not readable) and the page scrolls. With the panel open, four-in-view holds from a
  window width of about 1800px.
- **Statistieken header** wraps to two rows (title and period, then tabs) so that nothing leaves
  the card.
- **4.3 Net-worth share card** (visible again since 16 Nov 2026: sharing is on by default) stays visible for a user who already has sharing on or a pending
  delete, so that consent can be withdrawn.
- **4.6 Sign-out** always locks the vault, also when the account sign-out call fails.
- **"Widget toevoegen"** is hidden when every widget is already on Home.
