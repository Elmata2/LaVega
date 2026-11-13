# Personal app shell: icon rail, account sidebar, full-width frame, monochrome theme

Status: APPROVED by the owner 2026-11-13 ("go for it") with no edits; the four open questions in section 13 therefore take their stated defaults (light monochrome; order Overzicht, Optimalisatie, Rekeningen, Jouw plan; stored nav lists kept; sidebar on Profiel). No product code in this change. Branch `feat/app-focus`.
Reader: a builder who cannot ask the owner. Anything not marked "owner" is a builder-facing default, not owner-approved, and may be changed with a one-line note in the PR.

Research behind this: `.superpowers/research/2026-11-12-sure-layout-report.md` (git-ignored, local; "the report"). Not restated here. Where the code disagrees with it, see section 9.

## 1. Intent

The personal app (`apps/web`) looks like a floating card with pill tabs on top. The owner wants it to read as a calm, full-viewport money tool: a left icon rail, an account sidebar, a wide main area. The layout follows the open-source app Sure. The skin stays LaVega (Geist, serif page title, hairlines, no resting shadows), and a black-and-white theme is added next to the current one.

Why: LaVega is positioned as a consumer money co-pilot. The user lives in three places (Overzicht, Optimalisatie, Rekeningen) and in their accounts. A rail plus an account sidebar makes accounts always one click away, and frees the top of the page. A monochrome theme gives a quieter, more "serious" register for a trust-sensitive product.

## 2. Decided by the owner (fixed)

1. Take over most of Sure's layout as an independent reimplementation (ADR 0010: describe and reimplement; attribution plus a `NOTICE` line; never use the names Sure or Maybe in product; no class-string copy).
2. A left icon rail replaces the top pill tabs.
3. The app frame becomes full-width. The floating 32px rounded frame goes. This overrides the report's "recommend keep" and the DESIGN.md conflict note. `DESIGN.md` is updated as part of the work.
4. A black-and-white theme is added as a second theme next to midnight + cantaloupe, switchable in Profiel.
5. An account sidebar is added. The Rekeningen page stays. "Jouw plan" (after the intake wizard) also appears in the account sidebar.
6. Default nav: Overzicht, Optimalisatie, Rekeningen, plus Jouw plan after the wizard. All other views are optional modules, off by default.
7. Register: trust-sensitive fintech. Restrained micro-interaction only; no scroll choreography. The intake wizard layout does not change.
8. Local-first: no server-side UI prefs. Sidebar width/open state and theme live in `localStorage` and must render correctly when storage is blocked.

Not an owner decision: Midnight stays the default theme. This is the call of the session that commissioned this spec, not the owner's (say so in the PR). It is consistent with DESIGN.md ("Dark by default").

## 3. Goals, non-goals, anti-goals

Goals
- Rail, sidebar, main in a full-viewport frame; only inner regions scroll.
- Account sidebar usable at a glance (balances per bank group), keyboard-operable, collapsible, resizable.
- Two themes, switchable, no flash on load, both pass the contrast script.
- Phone layout with bottom bar and drawer.

Non-goals (this spec)
- Right-hand assistant panel. The AssistantPanel stays inline on Overzicht. Moving it is a separate spec. The shell must not reserve space for it.
- Account detail page, date-grouped transaction rows, bulk bar, Drawer primitive (report steps 5+).
- Sparklines in the sidebar (needs a per-account balance series that does not exist yet). Rows show name and balance only.
- Privacy-blur toggle, breadcrumbs, dashboard widget drag/hide UI, an insights feed.
- A dark variant of the monochrome theme (see Open question 1).
- Following `prefers-color-scheme` (investing-web ignores it too; keep the two apps consistent).
- Changing the intake wizard layout, landing page, or any copy that calls LaVega an adviser. The "not financial advice" footer stays.

Anti-goals (must not happen)
- Sure's colours, resting shadows, or English labels in the product.
- Any server-side storage of UI prefs (ADR 0009).
- Colour as the only carrier of meaning in the monochrome theme.
- New items in the default nav.
- Scroll-linked animation, parallax, staggered page-load choreography.

## 4. Constraints

- Local-first. Prefs are per device, in `localStorage`, every access in try/catch. Pattern: `apps/web/src/settings.ts` (`getEnabledModules`).
- Effect 4 for new logic per AGENTS.md; React components stay plain. Hooks (`useSidebar`, `useTheme`) wrap pure functions that are unit-testable without a DOM.
- Tokens: all colour comes from `styles/tokens.css` variables. Tailwind utilities map to them through `@theme inline`, so a theme switch needs no per-component work. No hex colours outside `tokens.css` (the landing page and `wizard.css` have a few today; see step 1).
- Copy goes through `copy/shell.ts` in nl and en. Dutch is primary.
- Motion work: load `emil-design-eng` and `animate` before writing any transition CSS (owner's standing rule).
- Do not commit or push. Leave the tree staged.
- Old shell stays as is until the flag-flip step (11, step 9c). New shell rules live in a new `styles/shell.css`, under their own class names (`shell2-*`) or under a flag-scoped root selector (`.shell2 …`). Do not edit `.shell`, `.appbar*`, `.navrail`, `.nav-item` in `base.css` before 9c. While `SHELL_V2` exists, tests cover both shells.

## 5. Target shell anatomy

```
+------+-----------------+-------------------------------------------+
| RAIL | ACCOUNT SIDEBAR | TOP BAR (sticky, in main)                 |
| 72   | 296 (240..440)  |  [sidebar toggle] Page title      [actions]|
|      |                 +-------------------------------------------+
| nav  | Jouw plan       | MAIN (scrolls)                            |
| ...  | Alle|Activa|    |  gutters 32 / 24 / 16                     |
|      |  Schulden       |  no max-width                             |
| user | groups + rows   |                                           |
+------+-----------------+-------------------------------------------+
```

The frame is `height: 100dvh`, `display: flex`, no outer margin, no radius, no shadow. Body background is `--bg`. `--gutter`, `--frame-gap` and `--r-lg` (frame radius) are retired in step 10 after a grep shows no other user; if `--r-lg` is used by dialogs, keep it and drop only the frame use.

### 5.1 Rail (replaces `NavBar` top bar)
- Width 72px, fixed. `--surface` ground, 1px `--line` on the right edge. Not resizable.
- Top: brand mark (the existing dot plus a short "LaVega" wordmark is too wide; use the existing dot only, with `aria-label="LaVega"`; builder-facing default, not owner-approved).
- Items: icon (20px) over a 12px label, centred, 56px tall, 44px minimum hit area. Active item: `--surface-2` fill, 3x20 indicator bar on the left edge in `--ink`, `aria-current="page"`. Never coral (DESIGN.md rule), never a theme-specific hue.
- Order and contents are in 5.5.
- Bottom group: Investing link (external, unchanged behaviour and `INVESTING_URL` logic) and Profiel (avatar plus label, same route as now).
- If items overflow the viewport height, the item list scrolls (scrollbar hidden), brand and bottom group stay put.
- Separate scope switch (`SHOW_SCOPE_SWITCH`) is archived and stays in `TopBar`, unchanged.

### 5.2 Account sidebar (new `AccountSidebar`)
- Default 296px, min 240, max 440. Collapsible to 0. Drag handle on its right edge; double-click on the handle resets to default. Main always keeps at least 480px; the hook clamps the sidebar to `viewport - 72 - 480`.
- Content, top to bottom:
  1. "Jouw plan" row: only when `planUnlocked` (same predicate as the rail). Icon, label, links to the plan view, active state when on it. This is the owner-required second entry point.
  2. Segmented control Alle | Activa | Schulden (inset `--surface-2`, 4px padding, 8px radius). Filters the list below. Debts are accounts for which `accountIsLiability(account)` is true (imported from `@lavega/core` at `apps/web/src/views/Rekeningen.tsx:5`, used at `:385` and `:459`; a liability stores a negative balance). Do not invent a new classifier.
  3. Ghost row "+ Rekening toevoegen": goes where the empty Rekeningen state sends the user to add or import (reuse that route; no new flow). Not yet traced in code: the builder traces it first and records the route in the PR.
  4. Groups by bank, as on Rekeningen: `<details>` with chevron, bank name, group total. Rows: 8px 12px padding, 8px radius, account name left, balance right (tabular, `--pos`/`--neg` per section 6), active row when that account is the current transaction filter. Click behaves exactly as an account click on Rekeningen does today: the inline `onSelectAccount` closure at `apps/web/src/App.tsx:2453` (sets `setFAccount(key)`, clears the other filters, goes to Transacties). Lift it into one named handler used by both Rekeningen and the sidebar. Transacties is optional and off by default; the click still navigates there (as today on Rekeningen) and does not add Transacties to the rail (builder-facing default, not owner-approved).
- Data: the same scoped account list the Rekeningen page receives from `App.tsx` (`scopedAccounts`, defined `App.tsx:1423`, passed at `:2433`). `planUnlocked` is defined at `App.tsx:1322-1326` (`intakeBlocksDone >= 1`); reuse it. Do not recompute or fetch. No new network calls.
- Empty (no accounts): one short empty state with the same CTA as the add row.
- Tone: `--bg` ground, 1px `--line` right edge, no shadow. Group totals 12px `--muted`.
- Shown on every shell view including Profiel. Hidden in the intake wizard and the vault gate (they render outside the shell today; keep it so).

### 5.3 Main
- Top bar sticky inside main: 56px, bottom hairline. Left: sidebar toggle (icon button) and the page title (serif title stays, but 1.75rem, one line, truncates). Right: existing actions (`+ Widget` on views that have it). The eyebrow line goes away.
- Content: fluid, no max-width. Horizontal gutters 32px at >= 1280, 24px at 1024-1279, 16px below 1024. Vertical padding 24px.
- Cards and modules unchanged in look. Module headers are not restyled in this spec.

### 5.4 Breakpoints and responsive behaviour
- One new shell breakpoint at 1024px (`lg`).
- >= 1280: rail + sidebar open (or per stored state) + main.
- 1024-1279: first visit with no stored state starts with the sidebar collapsed, so main keeps room. A stored choice always wins.
- < 1024: no rail, no inline sidebar. A sticky top bar (48px): left menu button (opens the drawer), centre brand, right Profiel avatar. A fixed bottom tab bar (56px plus safe-area inset) with the first four nav items (Overzicht, Optimalisatie, Rekeningen, Jouw plan when unlocked). If more modules are enabled, the last slot is "Meer", which opens the drawer scrolled to a list of the remaining modules. Main gets bottom padding equal to the bar so nothing hides under it.
- Drawer: the account sidebar content in a left sheet, `min(88vw, 360px)`, scrim `--scrim`, closes on scrim tap, Escape, and navigation. At < 1024 it also lists all enabled modules at the top (the rail is gone).
- Existing media queries at 900 and 620 in `base.css` are reviewed: those that exist only for the old top bar are deleted; the rest move to 1024 where they concern the shell.
- Bottom bar contents, exactly: Overzicht, Optimalisatie, Rekeningen, plus Jouw plan when `planUnlocked`. Every other enabled module goes under "Meer" (a fifth slot, shown only when at least one other module is enabled). No module is dropped by the count of slots.
- Content grids: the module grid switches columns on viewport width (`styles/modules.css:175` 2 columns at <=1200px; `:184` 1 column at <=900px). The span and height classes carry the same breakpoints as Tailwind variants `[@media(max-width:1200px)]:` and `[@media(max-width:900px)]:` in `src/module-grid.ts`; `styles/views.css:35` and `styles/charts.css:478` use `[@media(max-width:900px)]` too. The test is `src/module-grid.test.tsx` (not `.ts`; the comment at `modules.css:220` repeats the wrong name), and it resolves styles through `src/test-support/resolveStyle.ts`. With a rail and sidebar taking up to 368px, the same viewport width gives a much narrower main, so 3 columns appear too early. Convert these to container queries measured on main. Thresholds are offset by today's shell chrome so the old shell switches at the same viewport widths: 1136 (3 to 2 columns, 1200 - 64) and 868 (to 1 column, 900 - 32). Measured: `.shell` is full viewport width (`margin: var(--frame-gap) auto` gives top and bottom gap only) and `.content` pads 32px per side, 16px at <= 900px. One threshold cannot be exact on both sides of the 900px padding change; viewports 901-932 get 1 column where the old rule gave 2. Revisit both numbers when the rail and sidebar land, because main then measures itself. Put `container-type: inline-size` on a new inner wrapper inside the scrolling main, not on the scroll element itself, and not on an ancestor of fixed or sticky chrome (a size-containment ancestor changes how they lay out). Files: `modules.css`, `module-grid.ts`, `views.css`, `charts.css`, `test-support/resolveStyle.ts` (must understand `@container`), `module-grid.test.tsx`, the main wrapper in `App.tsx`. This is the main hidden cost of the layout change and ships as its own early diff with no flag (step 2); with the old shell the wrapper is narrower than the viewport, so the thresholds carry the offsets above.

### 5.5 Navigation set and order
- Default set (`DEFAULT_MODULES`, stored value `null`): Overzicht, Optimalisatie, Rekeningen, Jouw plan (locked until `intakeBlocksDone >= 1`, unchanged logic in `withoutLockedModules`).
- Order in rail, picker and bottom bar (registry order): Overzicht, Optimalisatie, Rekeningen, Jouw plan, then optional modules in their current relative order (Transacties, Verplichtingen, Forecast, Punten, others). This changes the registry: Jouw plan moves from first to after Rekeningen, and Optimalisatie moves before Rekeningen.
- Owner to confirm: the order Overzicht, Optimalisatie, Rekeningen (today the app shows Rekeningen first), and Jouw plan last. Both follow the owner's wording but are not tested against a user.
- Optional modules stay in the Profiel picker (`ModulePicker`), unchanged. "+ Widget" in the top bar keeps opening it.

## 6. Monochrome theme

Selector `:root[data-theme="mono"]`, defined in `tokens.css` after the existing blocks. Scheme: light (white ground, black ink). That is a builder-facing default, not owner-approved; see Open question 1. Set `color-scheme: light` so native controls match.

Every colour token in `:root` is overridden explicitly, so nothing leaks from midnight (the script enforces this, see 6.3). Radii, type, spacing and motion tokens are shared.

### 6.1 Token set (starting values; the contrast script is the judge)

| Token | Midnight | Mono | Notes |
|---|---|---|---|
| `--gutter` | #02070a | #ffffff | retired with the frame; keep until grep is clean |
| `--bg` | #02070a | #ffffff | |
| `--surface` | #0d171d | #f5f5f5 | cards, rail |
| `--surface-2` | #16222a | #ebebeb | inset fills, active nav |
| `--ink` | #ffffff | #000000 | 21:1 on bg |
| `--ink-soft` | #e3e9ec | #262626 | |
| `--on-ink` | #02070a | #ffffff | |
| `--muted` | #a9b4bb | #595959 | 7.0 / 6.4 / 5.9 on bg / surface / surface-2 |
| `--line` | rgba(255,255,255,.12) | rgba(0,0,0,.12) | hairline, decorative |
| `--accent` | #0297de | #000000 | links, active, focus. Links are underlined in mono (colour cannot carry "link") |
| `--accent-soft` | blue 16% | rgba(0,0,0,.06) | |
| `--cta` / `--on-cta` | #fc734d / #02070a | #000000 / #ffffff | the single filled action: a black pill with white label. DESIGN.md's "One Action Rule" holds, with black as the action colour |
| `--pos` | #5fd38d | #000000 | see 6.2 |
| `--neg` | #ff8f8f | #404040 | 10.4:1 on bg; distinguished by sign and icon, see 6.2 |
| `--warn` | #f2b84b | #262626 | paired with a warning icon and dashed border |
| `--pos-tint` / `--neg-tint` | derived | derived (keep `color-mix`) | grey tints; meaning is in the glyph |
| `--chart-blue` / `-purple` / `-teal` | blues etc. | #000000 / #4d4d4d / #737373 | non-text, must reach 3:1 on bg, surface AND surface-2 (#737373: 4.7 / 4.3 / 4.0:1 expected; script is the judge) |
| `--slice-1..8`, `--slice-rest` | colours | an 8-step grey ramp, #1a1a1a to #b0b0b0, `--slice-rest` lightest | informational only in the script; the 6.2 labels rule is the requirement |
| `--card-face-1..4`, `--card-text` | brand-ish darks | #1f1f1f, #2b2b2b, #383838, #454545; text #ffffff | bank logos get `filter: grayscale(1)` in mono |
| `--scrim` | rgba(2,7,10,.72) | rgba(0,0,0,.4) | |
| `--shadow-float` | dark | rgba(0,0,0,.14) soft | floating layers only |

The existing `:root[data-theme="light"]` block stays untouched (see section 9, finding 3).

### 6.2 Behaviour rules in black and white
- Positive and negative amounts: always carry an explicit sign ("+ €120,00" / "- €120,00" with a real minus) and keep the existing arrow/icon where one exists. Negative amounts are `--neg` (dark grey) and positive `--pos` (black), a difference no one is asked to perceive. Builder audits every place that colours an amount and adds the glyph where it is missing. This audit is part of step 4, not optional.
- Delta pills: tint plus sign. Problem/warning status lines: dashed border plus icon for warning, solid border plus icon for problem; never tint alone.
- CTA: black pill, white label, hover `--ink-soft`. Secondary stays outline. Selected segmented option: black pill with white text (same shape as midnight's white pill).
- Focus ring: 2px `--ink` outline with 2px `--bg` offset, >= 3:1 against bg and surface, on every focusable element in both themes. In midnight it stays Signal Blue.
- Charts: top series use the three chart tokens; any chart with more than 3 series must add direct value labels or a legend with figures, and adjacent slices are separated by a 2px `--bg` stroke. Chart greys must reach 3:1 on bg, surface and surface-2 (6.3 item 3). Estimated regions keep their hatch (hatch already encodes "estimated" without colour). Never rely on grey steps alone to identify a slice.
- Surfaces: tone plus hairline, no resting shadows (unchanged).
- Third-party content (bank logos) is greyscaled in mono. Landing page stays midnight in both themes (see 7).

### 6.3 Contrast script
Today the script (`apps/web/scripts/check-midnight-contrast.mjs`) is run by hand: it is in no `package.json` script and no CI step (the root only has `check:attribution`). Extend it:
1. Add a `mono` theme read from `:root[data-theme="mono"]`. Merge over midnight like `light` does, then fail if any 6-digit-hex colour token defined in `:root` is not defined in the mono block (allow-list: none). This catches the silent-inheritance bug the light block has today (it omits `card-face-1..4` and `card-text`, checked by diff). Limit: the script reads only `#rrggbb` tokens. `--line`, `--accent-soft`, `--pos-tint`, `--neg-tint`, `--scrim` and `--shadow-float` (rgba, `color-mix`) are not covered; the table in 6.1 is their only guard.
2. Text pairs at 4.5:1 for all themes: ink, muted, accent, pos, neg, warn on bg, surface, surface-2; on-cta/cta; on-ink/ink; on-ink/accent; card-text on each card face. Remove `chart-blue`, `chart-purple`, `chart-teal` from this list: today they ARE checked here at 4.5:1 (`check-midnight-contrast.mjs:33`), so #737373-class greys would fail it, and the old claim that they were never checked was wrong.
3. New non-text list at 3:1 for all three themes: chart-blue/purple/teal against bg, surface AND surface-2; accent (focus ring) against bg and surface. If midnight or light fail the new 3:1 list, fix the token in that theme in the same diff, or record it as a known gap in the script header.
4. Slices: `slice-1..8` and `slice-rest` against surface are printed as `info` lines and never fail (an 8-step grey ramp cannot each reach 3:1; the lightest, #b0b0b0, is 1.99:1 on surface). The 6.2 charts rule (direct labels or legend with figures, 2px `--bg` separators) is the requirement.
5. Same `ok`/`FAIL` output, exit 1 on failure. Add `apps/web/src/contrast-script.test.ts` (vitest) that spawns the script with `node` and asserts exit 0. That is the CI route; there is none today.

Known gap, not fixed here: input borders at 12% line are below the 3:1 non-text guideline in all themes. Listed under "Consider" in section 12.

## 7. Theme switch and persistence

- Where: a new card in `Profiel` ("Weergave") placed directly above the module picker card, following the same `Card as="section"` pattern. One control: a two-option radio group (`role="radiogroup"`, native radios styled as a segmented control): "Midnight" and "Zwart-wit" (en: "Midnight", "Black and white"), each with a 24px swatch preview. Applies immediately; no save button; no confirmation.
- State: `localStorage["lavega.theme"]` = `"midnight"` or `"mono"`. Anything else, missing or unreadable means midnight. Every access in try/catch. If storage throws, the switch still works in memory for the page view and the UI shows no error.
- Applying: `document.documentElement.dataset.theme` = `"mono"`, or the attribute removed for midnight (matches the current `:root` default and the preview harness). Also set `style.colorScheme`.
- No flash: a classic synchronous script `public/theme-init.js` in `index.html` `<head>` (before the module script) reads the key and sets the attribute before first paint. Do the same as `apps/investing-web` (`public/theme-init.js`, a test that runs the real file). The CSP is `script-src 'self' https://*.posthog.com` (`apps/web/src/csp.ts:26`), which blocks inline scripts, so the external same-origin file is required, not just safe. This is also why investing-web uses an external file (`apps/investing-web/public/theme-init.js`).
- Cross-tab: a `storage` event listener updates the attribute when another tab changes the key.
- Scope: the pre-unlock vault gate and the intake wizard follow the theme (same tokens). The landing page (`landing.css`, 48 hex literals) does not: it stays midnight. Implementation: the landing route sets `data-theme="midnight"` on `<html>` while mounted (builder-facing default, not owner-approved; re-declaring tokens on a wrapper is the fallback if the attribute causes a flash). Verify with a screenshot in both stored themes.
- Motion: the switch is instant. No colour transition on theme change (it flashes mid-values on large surfaces and adds nothing).
- Sidebar prefs: `localStorage["lavega.sidebar"]` = `{"open": boolean, "width": number}`. On read: parse in try/catch, coerce types, clamp width to 240-440 and to the viewport rule in 5.2, fall back to `{open: true (or false in 1024-1279), width: 296}` on anything invalid. Blocked storage: state lives in memory; layout renders with defaults; no thrown error. Writes are debounced during drag (write on pointer-up only).

## 8. Existing users and `lavega.navModules`

- Key, shape and helper (`getEnabledModules` / `setEnabledModules`) do not change. No migration, no rewrite, no new key.
- `null` (user never opened the picker; the key is only written on a toggle): gets the new default set and order automatically.
- Stored list: honoured exactly. Unknown ids are dropped (existing behaviour), `overview` is always added back, order follows the new registry order. A user who earlier toggled on Verplichtingen, Forecast or Punten keeps them in the rail after the core group. The owner's "off by default" cannot reach people who made an explicit choice; resetting them would silently remove things they switched on, so it is not done.
- Test to add: a stored legacy list (including `plan` first and `forecast`) renders in the new order with the same members; `null` renders the four-item default; garbage JSON behaves as `null`.
- A stored sidebar or theme key from nowhere (new keys) needs no migration.

## 9. Where the code disagrees with the report

1. Report: "Rekeningen before Optimalisatie" is only half the story. The registry also puts `plan` first of all (`MODULES[0]`), so today's default nav is Jouw plan, Overzicht, Rekeningen, Optimalisatie. This spec moves plan after Rekeningen.
2. Report implies the new default nav is a change. In code it is mostly already so: `DEFAULT_MODULES` is every non-archived module without `defaultOn: false`, and `transactions`, `bills`, `forecast`, `punten` are already `false`; `facturen`, `belasting`, `valuta` are archived via `ARCHIVE_BUSINESS`. The real change is order and position of plan.
3. Report does not mention that a `:root[data-theme="light"]` block already exists in `tokens.css`, is checked by the contrast script, and is used only by `src/preview/harness.tsx` (storage key `lavega-preview-theme`). No product code sets it and Profiel has no theme control. `Globe.test.tsx` splits `tokens.css` at that selector (`TOKENS_CSS`), so the mono block must be placed after it. Light is not exposed to users by this spec.
4. Report's sized estimate of the shell does not mention the module-grid breakpoints (1200 / 900): `modules.css:175,184`, the Tailwind variants in `module-grid.ts`, `views.css:35`, `charts.css:478`, pinned by `module-grid.test.tsx`. They key on viewport width and break once a rail and sidebar take width. Handled in 5.4 and step 2.
5. The report cites `scripts/check-midnight-contrast.mjs` at repo root; it lives at `apps/web/scripts/check-midnight-contrast.mjs`.
6. The report places the mobile breakpoint question aside. The existing shell has three breakpoints (1200, 900, 620). This spec makes 1024 the one shell breakpoint.
7. `apps/web/DESIGN.md` is mostly about apps/investing-web (its Themes section describes `lavega-investing-theme`). The frame appears at `DESIGN.md:54` (`rounded.frame: "32px"`), `:99` (single floating frame on the gutter), `:107` (gutter and app surface same value), `:144` (`.shell` is `calc(100vh - 2 * 20px)`, 32px radius, `--shadow-float`) and `:147` (20px frame gutter). Those lines change in step 9c, when the frame really goes, not earlier. The final "Personal app shell" and "Monochrome theme" sections are written in step 10, when values are final.

## 10. Accessibility

- Landmarks: rail is `<nav aria-label>` using the existing nav label; sidebar is `<aside aria-label="Rekeningen">`; main is `<main id="main">`; top bar is inside main's `<header>`. At < 1024 the bottom bar is the nav. Rail or bottom bar is chosen in JS (a `matchMedia('(min-width: 1024px)')` hook) so only one `<nav>` is in the DOM at a time; CSS `display: none` cannot be verified in jsdom, so it is not the mechanism.
- A "Naar inhoud" skip link is the first focusable element and moves focus to `#main`.
- Tab order follows source order: skip link, rail, sidebar, main.
- Rail items are links with `href` (as now) and `aria-current="page"`; each has a visible text label, never icon-only. Hit area >= 44px.
- Sidebar toggle: `<button aria-expanded aria-controls>`. Resize handle: `role="separator"` `aria-orientation="vertical"`, focusable, `aria-valuenow/min/max`, ArrowLeft/Right resize by 16px (Shift 64px), Home/End to min/max, Enter or double-click resets. Collapsed sidebar is `inert`/`display:none`, not just off-screen.
- Drawer: modal dialog semantics, focus moves in, trapped, Escape closes, focus returns to the opener, page behind is `inert`. jsdom tests assert the attributes and the Escape, scrim and focus-return behaviour; the trap itself is checked in a real browser (step 9b).
- Theme radios: native inputs in a labelled group, arrow keys work by default.
- Focus ring: section 6.2. Visible in both themes on every surface.
- Reduced motion (`prefers-reduced-motion: reduce`): sidebar width, drawer slide and hover transitions become instant. Nothing else moves.
- Motion budget (everything else is static): rail/row hover and active state 120ms ease-out on background and colour; sidebar open/close 200ms with `--ease-emphasized` (exists, `tokens.css:173`); drawer slide 220ms on `transform`; scrim fade 150ms. No transition while dragging the resize handle. Only `transform`, `opacity` and (for the sidebar) one width transition. Load `emil-design-eng` and `animate` before writing these.
- Non-colour meaning: section 6.2 applies to midnight too where cheap (signs on amounts), because it helps colour-blind users.

## 11. Delivery: small, independently verifiable steps

Order differs from the report: the container-query change and the theme work come first (both flag-free and independent), the registry reorder is its own diff, and the rail, sidebar and frame change land behind `SHELL_V2`. Each step ships green on its own; the app is usable after each. Each step (or lettered sub-step) is one reviewable diff.

Common verification for every step: `pnpm --filter @lavega/web typecheck`, `pnpm --filter @lavega/web test`, `pnpm run lint`, and the `verify-lavega` skill with browser screenshots at 1440, 900 and 390 widths (both themes from step 4 on; midnight only before). Always check against a vault with accounts, and an empty vault. Evidence goes under `.superpowers/evidence/<step>/` (git-ignored); every browser check below names its file, and the hand-off cites the paths. A browser check with no evidence file is not done.

While `SHELL_V2` exists (steps 6 to 9b) both shells are tested: the flag-off path keeps its existing tests green, and each new test runs with the flag on. Old-shell CSS is not edited before 9c.

### Step 1: Foundations (S, low)
- Do: `NOTICE` sentence for layout inspiration (the current Sure paragraph covers logic and fixtures only; add that the app shell layout is an independent reimplementation inspired by Sure's layout, no code or class strings copied, non-affiliation stated). Move the 2 hex literals in `styles/wizard.css` (`:386`, `:397`) into tokens. Nothing else: no gutter or title CSS (old-shell CSS), no DESIGN.md frame edit (step 9c).
- Files: `NOTICE`, `styles/wizard.css`, `styles/tokens.css`.
- Verify: unit tests; `pnpm run check:attribution` passes, output in `step-1/attribution.txt`; midnight wizard screenshots before/after in `step-1/`.
- Rollback: revert; no data or storage change.

### Step 2: Module grid to container queries, no flag (M, med)
- Do: the change in 5.4. Wrapper with `container-type: inline-size` inside main; 1136 / 868 thresholds (old 1200 / 900 minus shell chrome, see 5.4) measured on the wrapper; convert `modules.css:175,184`, the variants in `module-grid.ts`, `views.css:35`, `charts.css:478`; teach `test-support/resolveStyle.ts` `@container`; update `module-grid.test.tsx` to pin the new rules.
- Files: as listed in 5.4.
- Verify: `module-grid.test.tsx` passes against class names read off mounted elements; browser check at 1440, 1200, 900, 390 in the old shell: columns are 3 / 2 / 1 / 1 exactly where they were before. Evidence: `step-2/columns-before-after.txt` (computed `grid-template-columns` per width, before and after).
- Rollback: revert the commit.

### Step 3: Monochrome tokens + contrast script (M, low)
- Do: the `mono` block (6.1), the extended script and its vitest (6.3), `lib/theme.ts` (pure read/validate/apply), `public/theme-init.js`, the `index.html` tag, a test that runs the real init file. Landing forced to midnight. No switch UI: verify by setting `localStorage["lavega.theme"]="mono"`.
- Files: `styles/tokens.css`, `scripts/check-midnight-contrast.mjs`, new `src/contrast-script.test.ts`, new `src/lib/theme.ts` (+test), `public/theme-init.js`, `index.html`, landing wrapper.
- Verify: `node apps/web/scripts/check-midnight-contrast.mjs` exits 0 with mono rows printed, output in `step-3/contrast.txt`; `contrast-script.test.ts` green; theme unit tests (invalid, missing, blocked storage); `Globe.test.tsx` passes (mono block after light); screenshots of Overzicht, Rekeningen, Optimalisatie, wizard, vault gate in mono at 3 widths in `step-3/`; landing unchanged (same dir).
- Rollback: delete the mono block and init script; stored `lavega.theme` is then ignored.

### Step 4: Theme switch in Profiel (S, low)
- Do: "Weergave" card, copy nl/en, cross-tab listener, `useTheme` hook.
- Files: `views/Profiel.tsx`, `copy/shell.ts`, new `hooks/useTheme.ts`, `Profiel.test.tsx`.
- Verify: tests that selecting persists, blocked storage still switches in memory, a `storage` event updates the attribute; browser reload check (`step-4/reload.txt`: attribute value before and after reload); screenshot of both options selected.
- Rollback: remove card; step 3 still works via storage.

### Step 5: Black-and-white audit, bounded (three diffs, each S-M, low)
- 5.0 (inventory, no code, first): grep `--pos`, `--neg`, `--warn`, `--slice-`, `text-pos`, `text-neg`, `bg-pos`, `bg-neg` across `apps/web/src`; write the hit list, grouped as chart / amount / status, into the PR description and `step-5/inventory.txt`. Sub-steps 5a to 5c may only touch files on that list; a file found later is added to the list with a one-line note.
- 5a Charts: legends or direct labels for charts above 3 series, 2px `--bg` separators, bank-logo `grayscale(1)` in mono. Verify: component tests that each such chart renders a legend or labels; mono screenshots in `step-5/charts/`.
- 5b Amounts: explicit sign and glyph wherever an amount is coloured. Verify: component tests that rendered text carries `+` or a real minus; a browser script lists every element whose computed colour comes from `--pos` or `--neg` and whose text has no sign; expected list empty, output in `step-5/amounts-unsigned.txt`.
- 5c Status: dashed or solid border plus icon for warning and problem lines; delta pills with sign. Verify: component tests that each status variant renders its icon and border class; one screenshot sheet of every variant in mono (`step-5/status.png`).
- Rollback: revert the diff; themes stay functional.
- Browser colour emulation to greyscale is not used as a check (not available everywhere); the DOM-level checks above replace it.

### Step 6: Shell regions + `useSidebar`, behind `SHELL_V2` (M, med)
- Do: new `styles/shell.css` with its own class names (`shell2-*`), a new `components/Shell.tsx` with the full-width frame, rail placeholder, sidebar slot and main, and `useSidebar` (clamp, persistence, blocked storage). `SHELL_V2` is a module constant in `archive.ts` style, default false until 9c; with it off the old shell renders and no old CSS is changed. `App.tsx` gets only the wrapper switch.
- Files: `App.tsx` (switch only), new `styles/shell.css`, new `components/Shell.tsx`, new `hooks/useSidebar.ts` (+test).
- Verify: `useSidebar` tests (clamp to 240/440 and the 480 main rule, garbage storage, blocked storage, reset, collapsed-state persistence); browser check, flag on and off, at 3 widths, no horizontal page scroll at 390 (`step-6/scrollwidth.txt`: `scrollWidth` vs `clientWidth` per width); old-shell tests unchanged and green.
- Rollback: flag off; delete `shell.css` and `Shell.tsx`.

### Step 7: Registry reorder (S, low)
- Do: the order change in 5.5 and nothing else. It also reorders the old shell's nav; accepted, noted in the PR.
- Files: `components/moduleRegistry.tsx`, `ModulePicker.test.tsx`, `archive.test.ts`, `NavBar.test.tsx`, `shell.english.test.tsx`.
- Verify: the tests from section 8 (a legacy list with `plan` first and `forecast` renders in the new order with the same members; `null` gives the four-item default; garbage JSON behaves as `null`).
- Rollback: one-commit revert.

### Step 8: Rail + mobile bottom bar (M-L, med)
- Do: `Rail` under the flag, bottom bar and sticky top bar at < 1024 (5.4), skip link, the a11y of section 10. Rail or bottom bar is chosen by a `matchMedia` hook so one `<nav>` exists at a time.
- Files: new `components/Rail.tsx`, new `components/BottomBar.tsx`, new `hooks/useMediaQuery.ts` (+test), `Shell.tsx`, `copy/shell.ts`, tests. `NavBar.tsx` stays untouched until 9c.
- Verify: tests with a mocked `matchMedia`: exactly one `<nav>` rendered per breakpoint; `aria-current="page"` on the active item; bottom bar holds exactly the three core items plus Jouw plan when unlocked, and "Meer" only when other modules are enabled. Browser: keyboard walk (`step-8/tab-order.txt`: ordered descriptions of `document.activeElement` for 15 Tab presses; expected skip link, rail items, sidebar, main); accessibility-tree dump per width showing one navigation landmark (`step-8/landmarks-<width>.txt`); screenshots of the rail with 4 items and with all optional modules on (overflow), both themes.
- Rollback: flag off.

### Step 9a: Account sidebar, inline (M, med)
- Do: `AccountSidebar` (5.2) at >= 1024 inside `Shell`: "Jouw plan" row, tabs, groups, empty state, resize handle with its keyboard rules, collapse toggle. Lift `onSelectAccount` (`App.tsx:2453`) into a named handler shared with Rekeningen. No drawer yet.
- Files: new `components/AccountSidebar.tsx`, `App.tsx`, `styles/shell.css`, `copy/shell.ts`, tests.
- Verify: component tests for tabs (`accountIsLiability` split), groups, plan row only when unlocked, empty state, click calls the shared handler (filters Transacties), separator keyboard behaviour; network check that no new request appears (`step-9a/network.txt`: request list before and after opening the sidebar, expected identical); screenshots on a synthetic vault with several banks, a debt, and an empty vault.
- Rollback: remove the component; flag still off.

### Step 9b: Drawer, "Meer", phone layout (M, med)
- Do: shell-local drawer (not the general Drawer primitive of report step 5) with the account content and the module list at < 1024; "Meer" slot opens the drawer on the module list; scrim; focus handling.
- Files: new `components/ShellDrawer.tsx`, `BottomBar.tsx`, `Shell.tsx`, `styles/shell.css`, `copy/shell.ts`, tests.
- Verify: jsdom tests for what jsdom can show: opening moves focus into the drawer, Escape closes, scrim tap closes, navigation closes, focus returns to the opener, siblings get `inert`, "Meer" lists exactly the enabled modules not in the bar. Focus trap in a real browser: with the drawer open press Tab 20 times and Shift+Tab 20 times and assert `document.activeElement` stays inside the drawer each time (`step-9b/focus-trap.txt`). Screenshots at 390 with the drawer open, both themes.
- Rollback: remove the drawer; sidebar and rail stay.

### Step 9c: Flip the flag, delete the old shell (M, med)
- Do: set `SHELL_V2` true and then delete it, `NavBar.tsx`, the old-shell-only parts of `TopBar` (it keeps the archived scope switch, `SHOW_SCOPE_SWITCH`), `.shell`, `.shell-body`, `.appbar*`, `.navrail`, `.nav-item` and the old-bar media queries (900 / 620 in `base.css`). Update `DESIGN.md:54,99,107,144,147` (frame wording and frontmatter `rounded.frame`). May be a follow-up PR if reviewers want the flag to live one release.
- Files: `App.tsx`, `archive.ts`, `components/NavBar.tsx`, `components/TopBar.tsx`, `styles/base.css`, `DESIGN.md`, old-shell tests.
- Verify: full test run; grep shows no `navrail`, `appbar` or `SHELL_V2` left (`step-9c/grep.txt`); screenshots both themes at 3 widths.
- Rollback: revert the PR (the flag is gone, so revert is the only route).

### Step 10: Docs and cleanup (S)
- Do: final `DESIGN.md` sections "Personal app shell" and "Monochrome theme" with the real values; retire `--gutter`, `--frame-gap` and the frame use of `--r-lg`; update handoff notes (AGENTS.md says docs stay current).
- Verify: grep shows no remaining use (`step-10/grep.txt`); full test run.

Out of this spec, in order: assistant to the right panel (fix the undefined classes the report found), account detail page and transaction rows.

## 12. Left to the builder

- Exact icon set for the rail (reuse the 18px line icons in `moduleRegistry.tsx`, scale to 20px).
- Final pixel tuning of the numbers above (rail 72 vs 84, sidebar default 296), as long as min/max/rules hold.
- Which chart components need legends (found in step 5a's grep).
- Whether `SHELL_V2` is a constant or a build-time define.

Settled calls (builder-facing default, not owner-approved; change with a one-line PR note):
- Brand mark: the dot only, `aria-label="LaVega"`.
- Slice ramp: informational lines in the script, not failing; labels rule is the requirement.
- Sidebar account click with Transacties off: navigates to Transacties anyway; not added to the rail.
- Landing forced to midnight via the `<html>` attribute while mounted.
- Hooks live in a new `src/hooks/` directory (`useIdleLock.ts` and `useBrandRamps.ts` sit flat in `src/`, so either fits; a directory is clearer).
- `--gutter` stays until the grep in step 10 is clean.
- "Consider" list for the PR, not in scope: input borders under 3:1; first-class sparklines; hiding balances (privacy blur); a dark monochrome variant.

## 13. Open questions for the owner

Only questions whose answer changes what is built. Defaults apply if unanswered. Owner approved the spec on 2026-11-13 without answering: all four defaults apply.

1. Monochrome: light (white ground, black ink) or dark (black ground, white ink)? Default: light. A dark mono would sit too close to Midnight and the CTA/active treatment flips; choose now, adding the other later costs a second block plus script rows.
2. Nav order: Overzicht, Optimalisatie, Rekeningen, with Jouw plan last, confirmed? Today Rekeningen comes before Optimalisatie and Jouw plan comes first. Default: as written in 5.5.
3. Should a user who has an explicit stored nav selection (including Verplichtingen, Forecast, Punten) be reset to the new default? Default: no, stored lists are honoured (section 8).
4. Should the sidebar show on Profiel? Default: yes, same shell on every view. If no, it hides on Profiel only.

## 14. Changes after builder check

- Contrast plan (6.1, 6.3): chart tokens moved from the 4.5:1 list (where they are checked today, `check-midnight-contrast.mjs:33`) to a new 3:1 list on bg, surface and surface-2; mono chart greys now #000000 / #4d4d4d / #737373; slices informational; hex-only limit stated; new vitest spawns the script because it is manual today.
- Corrected facts: test file is `module-grid.test.tsx`; full file list for the container-query change; `container-type` on an inner wrapper; landing hex count 48; DESIGN.md lines 54, 99, 107, 144, 147 named; `accountIsLiability` use sites are `Rekeningen.tsx:385,459` (the earlier note said 382).
- Flag claim made true: old-shell CSS untouched until step 9c; new rules in `shell.css` under own class names; both shells tested while the flag exists. Frame removal and the DESIGN.md frame edit moved to 9c; the old step 1 CSS pass was dropped because it edited old-shell CSS.
- Steps reordered and split (section 11): container-query diff first and flag-free, registry reorder own diff, step 4 bounded by a grep inventory, old step 7 split into 9a / 9b / 9c.
- Unverifiable checks replaced (greyscale emulation, nav landmark in jsdom, drawer focus trap) and an evidence file named per browser check.
- Code facts added as facts with file:line (`accountIsLiability`, `onSelectAccount`, `planUnlocked`, CSP, `--ease-emphasized` at `tokens.css:173`).
- Bottom bar defined exactly; (b) items settled and marked as defaults.
