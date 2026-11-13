/* WCAG contrast of the colour tokens in three themes: dark (:root, "midnight"),
 * light (:root[data-theme="light"]) and mono (:root[data-theme="mono"]). light
 * and mono inherit what they do not override, as in the browser; mono may not
 * inherit anything: every #rrggbb token of :root must be defined in its block.
 *   - text pairs at 4.5:1 (AA text)
 *   - non-text pairs at 3:1 (chart tokens on all three grounds; accent as the
 *     focus ring on bg and surface)
 *   - slice-1..8 / slice-rest on surface: printed as `info`, never fail (an
 *     8-step grey ramp cannot each reach 3:1; the charts rule in the design spec
 *     is the requirement)
 * Only #rrggbb tokens are read. --line, --accent-soft, --pos-tint, --neg-tint,
 * --scrim and --shadow-float (rgba, color-mix) are not covered.
 * KNOWN GAPS: none for midnight or light on the 3:1 list at the time of writing.
 * Run: node apps/web/scripts/check-midnight-contrast.mjs  (exit 1 on any FAIL). */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  return css.slice(start, css.indexOf("\n}", start));
};
const read = (src) =>
  Object.fromEntries(
    [...src.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]),
  );
const dark = read(block(":root"));
const monoOwn = read(block(':root[data-theme="mono"]'));
const themes = {
  dark,
  light: { ...dark, ...read(block(':root[data-theme="light"]')) },
  mono: { ...dark, ...monoOwn },
};

const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const grounds = ["bg", "surface", "surface-2"];
const text = ["ink", "muted", "accent", "pos", "neg", "warn"];
const pairs = [
  ...text.flatMap((t) => grounds.map((g) => [t, g])),
  ["on-cta", "cta"],
  ["on-ink", "ink"],
  ["on-ink", "accent"],
  ["card-text", "card-face-1"],
  ["card-text", "card-face-2"],
  ["card-text", "card-face-3"],
  ["card-text", "card-face-4"],
];
const nonText = [
  ...["chart-blue", "chart-purple", "chart-teal"].flatMap((t) => grounds.map((g) => [t, g])),
  ["accent", "bg"],
  ["accent", "surface"],
];
const slices = [...Array.from({ length: 8 }, (_, i) => `slice-${i + 1}`), "slice-rest"];
let bad = 0;
const line = (status, name, fg, bg, r) =>
  console.log(`${status} ${name.padEnd(5)} ${fg.padEnd(12)} on ${bg.padEnd(12)} ${r.toFixed(2)}`);
for (const token of Object.keys(dark)) {
  if (!(token in monoOwn)) {
    bad++;
    console.log(`FAIL mono  --${token} is defined in :root but not in the mono block`);
  }
}
for (const [name, tok] of Object.entries(themes)) {
  for (const [list, min] of [
    [pairs, 4.5],
    [nonText, 3],
  ]) {
    for (const [fg, bg] of list) {
      const r = ratio(tok[fg], tok[bg]);
      const ok = r >= min;
      if (!ok) bad++;
      line(ok ? "ok  " : "FAIL", name, fg, bg, r);
    }
  }
  for (const s of slices) line("info", name, s, "surface", ratio(tok[s], tok.surface));
}
process.exit(bad ? 1 : 0);
