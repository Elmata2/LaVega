/* Lists every hard-coded colour, gradient or old typeface left in apps/web/src
 * that the midnight tokens do not own. Run: node apps/web/scripts/midnight-sweep.mjs
 * Exit 1 when anything is neither fixed nor in ALLOW (with its reason). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const SKIP = /(\/styles\/tokens\.css|\.test\.|\/test-support\/|\.generated\.|\/Landing|landing\.css|landingCopy|\/preview\/)/;
const PATTERNS = [
  ["hex", /#[0-9a-fA-F]{3,8}\b/g],
  ["rgb/hsl", /\b(?:rgba?|hsla?)\(/g],
  ["gradient", /(?:linear|radial|conic)-gradient\(/g],
  ["old-font", /Garamond|\bInter\b/g],
  ["white/black", /(?:^|[\s:"'`])(?:white|black)\b(?!-space)/g],
  ["tw-colour", /\b(?:bg|text|border|fill|stroke)-(?:white|black|\[(?:#|rgb|hsl))/g],
];
/* file suffix + pattern -> reason it stays. */
const ALLOW = [
  ["styles/blocks.css", "rgb/hsl", "bank-card sheen alpha 0.14 is pinned by brandFace.test.ts against SHEEN_PEAK_ALPHA; hover ring is white-on-brand-colour"],
  ["styles/blocks.css", "gradient", "bank-card sheen (see above)"],
  ["styles/modules.css", "gradient", "select chevron drawn from two token-coloured gradients, not a fill"],
  ["components/SpendPie.tsx", "hex", "categorical pie palette: 8 hues chosen to stay distinct on dark; chart data colours"],
  ["components/SpendPie.tsx", "gradient", "conic-gradient is how the pie ring is drawn, not decoration"],
  ["brandFace.ts", "hex", "doc comments + toHex() of bank brand colours derived from logos"],
  ["brandFace.ts", "gradient", "cardRamp builds the per-bank brand gradient"],
  ["brandFace.ts", "rgb/hsl", "brand ramp output / sheen compositing"],
  ["components/Globe.tsx", "rgb/hsl", "canvas reads computed CSS colour (rgb() out of getComputedStyle)"],
];
const found = [];
function walk(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|tsx?)$/.test(n) && !SKIP.test(p)) scan(p);
  }
}
function scan(p) {
  const rel = relative(root, p);
  let src = readFileSync(p, "utf8");
  if (p.endsWith(".css")) src = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  src.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (p.endsWith(".css") ? false : /^(\*|\/\/|\/\*)/.test(t)) return;
    for (const [kind, re] of PATTERNS) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) found.push({ rel, line: i + 1, kind, text: t.slice(0, 110), hit: m[0] });
    }
  });
}
walk(root);
let open = 0;
const justified = new Map();
for (const f of found) {
  const a = ALLOW.find(([file, kind]) => f.rel === file && f.kind === kind);
  if (a) justified.set(a[2], (justified.get(a[2]) ?? 0) + 1);
  else { open++; console.log(`${f.rel}:${f.line} [${f.kind}] ${f.text}`); }
}
console.log(`\nmatches: ${found.length}  open: ${open}  justified: ${found.length - open}`);
for (const [r, n] of justified) console.log(`  ${n} x ${r}`);
process.exit(open ? 1 : 0);
