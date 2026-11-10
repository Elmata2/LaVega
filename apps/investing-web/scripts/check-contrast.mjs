/* WCAG contrast of the text and semantic tokens against the three panel tones
 * (background, card, surface-2) in src/styles/tokens.css. Tokens are HSL
 * triplets, so they are converted to sRGB first. Adapted from
 * apps/web/scripts/check-midnight-contrast.mjs.
 * Run: node apps/investing-web/scripts/check-contrast.mjs  (exit 1 below AA). */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const start = css.indexOf(":root {");
if (start < 0) throw new Error("no :root block in tokens.css");
const block = css.slice(start, css.indexOf("\n  }", start));
const tokens = Object.fromEntries(
  [...block.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/g)].map((m) => [
    m[1],
    [Number(m[2]), Number(m[3]) / 100, Number(m[4]) / 100],
  ]),
);

const rgb = ([h, s, l]) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
};
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (name) => {
  if (!tokens[name]) throw new Error(`token --${name} missing or not an HSL triplet`);
  const [r, g, b] = rgb(tokens[name]).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const grounds = ["background", "card", "secondary"];
const text = [
  "foreground",
  "muted-foreground",
  "accent",
  "primary",
  "pos",
  "neg",
  "warning",
  "chart-blue",
  "chart-purple",
  "chart-teal",
  "chart-amber",
  "chart-coral",
];
const pairs = [
  ...text.flatMap((t) => grounds.map((g) => [t, g])),
  ["primary-foreground", "primary"],
  ["accent-foreground", "accent"],
];
let bad = 0;
for (const [fg, bg] of pairs) {
  const r = ratio(fg, bg);
  const ok = r >= 4.5;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${fg.padEnd(19)} on ${bg.padEnd(11)} ${r.toFixed(2)}`);
}
process.exit(bad ? 1 : 0);
