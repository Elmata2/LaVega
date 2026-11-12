/* WCAG contrast of the text and semantic tokens against the three panel tones
 * (background, card, surface-2) in src/styles/tokens.css. Tokens are HSL
 * triplets, so they are converted to sRGB first. Adapted from
 * apps/web/scripts/check-midnight-contrast.mjs.
 * Run: node apps/investing-web/scripts/check-contrast.mjs  (exit 1 below AA). */
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const parse = (selector) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  const block = css.slice(start, css.indexOf("\n  }", start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/g)].map((m) => [
      m[1],
      [Number(m[2]), Number(m[3]) / 100, Number(m[4]) / 100],
    ]),
  );
};
const themes = { dark: parse(":root"), light: parse(':root[data-theme="light"]') };
let tokens = themes.dark;

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
// Text and semantic tokens: WCAG AA text, 4.5:1.
const text = ["foreground", "muted-foreground", "accent", "pos", "neg", "warning"];
// Chart series are non-text graphics: WCAG 1.4.11, 3:1 on the card.
const series = ["chart-blue", "chart-purple", "chart-teal", "chart-amber", "chart-coral"];
let bad = 0;
const check = (theme, fg, bg, min) => {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) bad++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${theme.padEnd(5)} ${fg.padEnd(19)} on ${bg.padEnd(11)} ${r.toFixed(2)} (>= ${min})`,
  );
};
for (const [theme, set] of Object.entries(themes)) {
  tokens = set;
  for (const t of text) for (const g of grounds) check(theme, t, g, 4.5);
  // Coral is a fill, never text, in both themes; only its label is text.
  check(theme, "primary-foreground", "primary", 4.5);
  check(theme, "accent-foreground", "accent", 4.5);
  for (const t of series) check(theme, t, "card", 3);
  // The dark theme also ran series as 4.5:1 text-grade on every ground.
  if (theme === "dark") for (const t of series) for (const g of grounds) check(theme, t, g, 4.5);
  // Informational: coral fill vs ground (non-text boundary; label carries the meaning).
  console.log(
    `info ${theme.padEnd(5)} primary fill vs background ${ratio("primary", "background").toFixed(2)}, vs card ${ratio("primary", "card").toFixed(2)}`,
  );
}
process.exit(bad ? 1 : 0);
