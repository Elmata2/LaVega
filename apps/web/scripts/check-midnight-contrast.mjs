/* WCAG contrast of the text tokens against the three panel tones, in both the
 * dark (:root) and light (:root[data-theme="light"]) themes. A light token that
 * is not overridden inherits the dark one, as in the browser.
 * Run: node apps/web/scripts/check-midnight-contrast.mjs  (exit 1 below AA). */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  return css.slice(start, css.indexOf("\n}", start));
};
const read = (src) =>
  Object.fromEntries([...src.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
const dark = read(block(":root"));
const themes = { dark, light: { ...dark, ...read(block(':root[data-theme="light"]')) } };

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
const text = ["ink", "muted", "accent", "pos", "neg", "warn", "chart-blue", "chart-purple", "chart-teal"];
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
let bad = 0;
for (const [name, tok] of Object.entries(themes)) {
  for (const [fg, bg] of pairs) {
    const r = ratio(tok[fg], tok[bg]);
    const ok = r >= 4.5;
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(5)} ${fg.padEnd(12)} on ${bg.padEnd(12)} ${r.toFixed(2)}`);
  }
}
process.exit(bad ? 1 : 0);
