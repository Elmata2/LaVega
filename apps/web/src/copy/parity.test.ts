import { expect, test } from "vitest";
import { shellCopy } from "./shell.js";
import { adminCopy } from "./admin.js";
import { moneyCopy } from "./money.js";
import { optimiseCopy } from "./optimise.js";
import { apiErrorCopy } from "./apiErrors.js";

/* The copy modules are typed `Record<Locale, T>`, so a missing English string
 * is normally a compile error. Normally is not always: a cast, an index
 * signature or a widened literal can hide one, and the failure then shows up
 * as a blank on a tester's screen rather than a red build. These two checks
 * re-prove from the values what the types are supposed to guarantee. */

type Tree = Record<string, unknown>;

function paths(node: unknown, prefix = ""): string[] {
  if (typeof node === "function") return [`${prefix}()`];
  if (Array.isArray(node)) return node.flatMap((v, i) => paths(v, `${prefix}[${i}]`));
  if (node && typeof node === "object")
    return Object.entries(node as Tree).flatMap(([k, v]) =>
      paths(v, prefix ? `${prefix}.${k}` : k),
    );
  return [prefix];
}

/* Most copy is a FUNCTION, not a string: a sentence built from a count, a date
 * or an amount. A scan that only reads string leaves therefore skips the
 * majority of what a user actually reads, which is how a Dutch sentence can sit
 * in the English tree behind a green gate. So each function is called with a
 * spread of plausible arguments and whatever comes back is scanned too. An
 * argument shape it does not accept just throws, and is skipped. */
const PROBES: unknown[][] = [
  [],
  [1],
  [2],
  [0],
  ["X"],
  [1, "X"],
  ["X", "Y"],
  [1_000_000],
  ["currency"],
  ["counterparty"],
  [{ spf: "softfail", dkim: "pass", dmarc: "fail" }],
  [null],
  [{ unclassified: [], personal: [] }],
];

function callResults(fn: (...a: never[]) => unknown): string[] {
  const out: string[] = [];
  for (const args of PROBES) {
    try {
      const r = (fn as (...a: unknown[]) => unknown)(...args);
      if (typeof r === "string") out.push(r);
      else if (Array.isArray(r)) for (const v of r) if (typeof v === "string") out.push(v);
    } catch {
      /* wrong shape for this builder */
    }
  }
  return out;
}

function strings(node: unknown, prefix = ""): Array<[string, string]> {
  if (typeof node === "string") return [[prefix, node]];
  if (typeof node === "function")
    return callResults(node as (...a: never[]) => unknown).map(
      (v, i) => [`${prefix}()#${i}`, v] as [string, string],
    );
  if (Array.isArray(node)) return node.flatMap((v, i) => strings(v, `${prefix}[${i}]`));
  if (node && typeof node === "object")
    return Object.entries(node as Tree).flatMap(([k, v]) =>
      strings(v, prefix ? `${prefix}.${k}` : k),
    );
  return [];
}

const MODULES: Array<[string, { nl: unknown; en: unknown }]> = [
  ["shell", shellCopy],
  ["admin", adminCopy],
  ["money", moneyCopy],
  ["optimise", optimiseCopy],
  ["apiErrors", apiErrorCopy],
];

test.each(MODULES)("%s has the same keys in both languages", (_name, copy) => {
  const nl = paths(copy.nl).sort();
  const en = paths(copy.en).sort();
  expect(en.filter((p) => !nl.includes(p))).toEqual([]);
  expect(nl.filter((p) => !en.includes(p))).toEqual([]);
});

/* Dutch function words that never appear in correct English copy. A hit means
 * a Dutch string was pasted into the English tree, which the key check above
 * cannot see because the key is present and the value is a non-empty string. */
const DUTCH = [
  "niet",
  "geen",
  "wordt",
  "voor de",
  "van de",
  "maand",
  "rekening",
  "uitgaven",
  "jouw",
  "deze",
  "nog geen",
  "betaald",
  "bedrag",
  "opnieuw",
];

test.each(MODULES)("%s English copy holds no Dutch", (_name, copy) => {
  const leaks = strings(copy.en)
    .filter(([, v]) => DUTCH.some((w) => v.toLowerCase().includes(w)))
    .map(([k, v]) => `${k}: ${v}`);
  expect(leaks).toEqual([]);
});
