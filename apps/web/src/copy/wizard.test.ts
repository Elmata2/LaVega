import { expect, test } from "vitest";
import { findAdviceLanguage } from "@lavega/core";
import { wizardCopy } from "./wizard.js";
import type { Locale } from "../locale.js";

type Tree = Record<string, unknown>;

function paths(node: unknown, prefix = ""): string[] {
  if (typeof node === "function") return [`${prefix}()`];
  if (node && typeof node === "object")
    return Object.entries(node as Tree).flatMap(([k, v]) =>
      paths(v, prefix ? `${prefix}.${k}` : k),
    );
  return [prefix];
}

const PROBES: unknown[][] = [[true], [false], [1], [3], [1, 5]];

function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "function") {
    const out: string[] = [];
    for (const a of PROBES) {
      try {
        const r = (node as (...x: unknown[]) => unknown)(...a);
        if (typeof r === "string") out.push(r);
      } catch {
        /* wrong shape */
      }
    }
    return out;
  }
  if (node && typeof node === "object") return Object.values(node as Tree).flatMap(strings);
  return [];
}

test("every NL key has an EN key", () => {
  const nl = paths(wizardCopy.nl).sort();
  const en = paths(wizardCopy.en).sort();
  expect(en).toEqual(nl);
});

test("no wizard string contains advice language", () => {
  for (const l of ["nl", "en"] as Locale[]) {
    const all = strings(wizardCopy[l]);
    expect(all.length).toBeGreaterThan(40);
    for (const s of all) expect(findAdviceLanguage(s, l), `${l}: ${s}`).toEqual([]);
  }
});

test("household variants differ", () => {
  for (const l of ["nl", "en"] as Locale[]) {
    const q = wizardCopy[l].questions;
    expect(q.income(true)).not.toBe(q.income(false));
    expect(q.spend(true)).not.toBe(q.spend(false));
    expect(q.savings(true)).not.toBe(q.savings(false));
  }
});

test("new keys exist: work kinds, five spend bands, upload copy, card questions", () => {
  for (const l of ["nl", "en"] as Locale[]) {
    const w = wizardCopy[l];
    expect(Object.keys(w.workKinds).sort()).toEqual(
      ["business", "employed", "freelance", "jobseeking", "other", "retired", "student"],
    );
    expect(w.spendBands).toHaveLength(5);
    expect(w.upload.imported(3)).toContain("3");
  }
  expect(wizardCopy.nl.questions.hasCards(false)).toBe("Heb je een creditcard?");
  expect(wizardCopy.nl.questions.hasCards(true)).toBe("Hebben jullie een creditcard?");
  expect(wizardCopy.nl.questions.cards(false)).toBe("Welke creditcards heb je?");
  expect(wizardCopy.nl.spendBands[0]).toBe("Minder dan €1.500");
});
