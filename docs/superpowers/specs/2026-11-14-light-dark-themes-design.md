# Dark and light theme, both with colour

Date: 14 Nov 2026. Branch: `feat/light-dark-themes` (from `origin/master` `3797dc09`).
Status: approved by the owner on 14 Nov 2026 ("yes" to the design below).

## 1. Intent

The owner wants two themes, dark and light, and both must keep "a touch of colour" (coloured
money figures, coloured charts, the cantaloupe primary action), like the reference finance app
he compares against. The black-and-white theme has no colour and goes.

## 2. Design

1. The theme switch (Weergave, in the Algemeen card of Profiel) has two options:
   **Donker** / **Dark** and **Licht** / **Light**.
2. **Donker** is today's midnight theme. No token changes.
3. **Licht** is the existing `:root[data-theme="light"]` block in `styles/tokens.css`, made
   selectable. Every `#rrggbb` token of `:root` must be set in it (including card faces if needed)
   and `scripts/check-midnight-contrast.mjs` must pass for it.
4. **Zwart-wit is removed from the switch.** Stored value `"mono"` in
   `localStorage["lavega.theme"]` is read as light and rewritten on the next save. Stored values
   are then `"midnight"` and `"light"`; anything else is midnight.
5. Default stays Donker. The landing page stays dark in both themes (`MidnightScope`).
   `public/theme-init.js` applies the light theme on `/app` paths only, before first paint.
6. No "follow the system" option (owner: not now).
7. The mono token block and the mono-only CSS rules are deleted when nothing can select them.
   Behaviour rules that came with mono and help colour-blind users (sign and glyph on amounts,
   dashed warning borders, focus ring) stay in both themes.

## 3. Approaches considered

- **A. Switch on the existing light block, drop mono (chosen).** Small, already contrast-checked.
- **B. Keep mono as a third option.** More to maintain; the owner asked for two.
- **C. Rebuild both themes on neutral greys.** Large, and drops the midnight look the owner approved.

## 4. Non-goals

- No change to midnight colours, to layout, type, radius or motion.
- No server-side preference (ADR 0009). No names or class strings of other products (ADR 0010).

## 5. Verification

- typecheck, lint, web tests, contrast script, build: exit 0.
- Browser, light AND dark, 1440 and 390: Home (both chart modes, every Statistieken tab),
  Optimalisatie, Rekeningen (with the currency dialog), Profiel, intake wizard, assistant panel
  and sheet, a pop-up dialog. In light: no dark-on-dark or light-on-light text, no hard-coded
  dark surface left, charts readable, bank card faces intact, focus ring visible.
- A browser with stored `"mono"` opens in light.

## 6. Changes during the build (14 Nov 2026)

- Light fault found in the browser and fixed: the "(peildatum …)" asides in Optimalisatie were
  3.21:1. New token `--aside-opacity` (0.7 dark, 0.9 light).
- Dark bug that predates this branch, fixed: the card-row legend in the wizard was dark ink on the
  dark ground (1.12:1). `--wz-cardrow-ink` and `--wz-cardrow-line` are now theme tokens.
- Not checked: the world map (its view is archived) and wizard steps 19–28.
- Known: `--line` hairlines are about 1.2:1 on white; surfaces separate by tone.
