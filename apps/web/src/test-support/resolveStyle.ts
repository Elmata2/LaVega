import { existsSync, readFileSync, readdirSync } from "node:fs";
/* NodeURL, not the global URL. Under vitest's jsdom environment Vite transforms
 * this module in web mode, and its static asset-URL analysis rewrites
 * `new URL(..., import.meta.url)` into a dev-server path that fileURLToPath then
 * rejects with "The URL must be of scheme file". Aliasing the Node class
 * sidesteps the pattern match. Two test files in this repo already hit the same
 * thing and worked around it the same way. */
import { fileURLToPath, URL as NodeURL } from "node:url";

/* WHAT AN ELEMENT RESOLVES TO, rather than what a named rule says.
 *
 * Several suites here pin layout by reading a stylesheet and asserting on a
 * selector: `declaration(base, ".module-span-1", "grid-column")`. That was the
 * only option when they were written, and module-grid.test.ts says why — this
 * repo has no render/DOM test library, so the CSS text was the contract.
 *
 * It has one fatal property for a styling migration: the moment a component
 * stops using `.module-span-1` and starts using utilities, the assertion is
 * about a rule nobody renders. It does not fail. It passes, describing dead
 * CSS. That is worse than failing.
 *
 * So ask the question the other way round. Give this the class list an element
 * actually carries and it returns the winning declaration, resolving across
 * every rule that matches — hand-written or generated. The assertion then
 * survives the conversion, because it never mentions how the style arrived. */

const DIST = new NodeURL("../../dist/assets/", import.meta.url);
const SOURCE = new NodeURL("../styles/", import.meta.url);

function css(): string {
  /* The built sheet first: it holds the generated utilities as well as the
   * hand-written rules, so it is the only complete answer once anything is
   * converted. Source files are the fallback for a tree that has not been
   * built, which keeps the suite runnable without a build step. */
  const dist = fileURLToPath(DIST);
  if (existsSync(dist)) {
    const sheets = readdirSync(dist).filter((f) => f.endsWith(".css"));
    if (sheets.length > 0) return sheets.map((f) => readFileSync(dist + f, "utf8")).join("\n");
  }
  const src = fileURLToPath(SOURCE);
  return readdirSync(src)
    .filter((f) => f.endsWith(".css"))
    .map((f) => readFileSync(src + f, "utf8"))
    .join("\n");
}

const SHEET = css().replace(/\/\*[\s\S]*?\*\//g, "");

/** The stylesheet outside any media block, plus each max-width block by width. */
function scopes(source: string): { base: string; media: Map<number, string> } {
  const media = new Map<number, string>();
  let base = "";
  let i = 0;
  while (i < source.length) {
    const at = source.indexOf("@media", i);
    if (at === -1) {
      base += source.slice(i);
      break;
    }
    base += source.slice(i, at);
    const open = source.indexOf("{", at);
    const width = Number(/max-width:\s*(\d+)px/.exec(source.slice(at, open))?.[1] ?? NaN);
    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === "{") depth += 1;
      else if (source[j] === "}") depth -= 1;
      j += 1;
    }
    const body = source.slice(open + 1, j - 1);
    if (Number.isFinite(width)) media.set(width, (media.get(width) ?? "") + body);
    i = j;
  }
  return { base, media };
}

const SCOPES = scopes(SHEET);

/** Does `selector` target an element carrying these classes, in `state`?
 *
 *  `state` is the suffix a rule carries beyond its classes — ":hover",
 *  ":focus-visible", '[data-open="true"]'. It matters twice over: the
 *  hand-written sheets use those rules heavily, and a converted component emits
 *  them too, since `hover:bg-surface` compiles to `.hover\:bg-surface:hover`.
 *  Without this the migration could not verify any interactive state.
 *
 *  Descendant, child and sibling combinators are still refused. Those describe
 *  a relationship between elements, and this function is only given one. */
function targets(selector: string, classes: readonly string[], state: string): boolean {
  let s = selector.trim();
  if (/[\s>+~]/.test(s)) return false;
  if (state) {
    if (!s.endsWith(state)) return false;
    s = s.slice(0, -state.length);
  } else if (/[:[]/.test(s.replace(/\\./g, ""))) {
    return false;
  }
  if (!s.startsWith(".")) return false;
  return s
    .slice(1)
    .split(".")
    .map((c) => c.replace(/\\/g, ""))
    .every((c) => classes.includes(c));
}

/**
 * The value an element with `classes` ends up with for `property`.
 *
 * Later rules win, which is CSS's own order and enough here: this codebase has
 * no `!important` and no id selectors in the sheets these tests read. Pass
 * `atWidth` to resolve inside a `max-width` block instead of the base scope, and
 * `state` for a rule that only applies in one, such as ":hover".
 *
 * Throws when no rule matches at all, rather than returning undefined. A silent
 * undefined is how a conversion turns a real assertion into a vacuous one.
 */
export function resolved(
  classes: readonly string[],
  property: string,
  atWidth?: number,
  state = "",
): string | undefined {
  const scope =
    atWidth === undefined ? SCOPES.base : SCOPES.base + "\n" + (SCOPES.media.get(atWidth) ?? "");
  let found: string | undefined;
  let matchedAnyRule = false;
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = rule.exec(scope); m !== null; m = rule.exec(scope)) {
    const [, selectors, body] = m;
    if (!selectors.split(",").some((s) => targets(s, classes, state))) continue;
    matchedAnyRule = true;
    const decl = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(body);
    /* Normalised, because the source sheets are readable and the built one is
     * minified: "repeat(3, minmax(0, 1fr))" and "repeat(3,minmax(0,1fr))" are
     * the same declaration, and an assertion that passes only when dist happens
     * to exist is worse than no assertion. */
    if (decl) found = decl[1].trim().replace(/\s*([,()])\s*/g, "$1").replace(/\s+/g, " ");
  }
  if (!matchedAnyRule) {
    throw new Error(
      `no rule matches .${classes.join(".")}${state} — the classes changed but the assertion did not`,
    );
  }
  return found;
}
