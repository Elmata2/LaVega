import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ADVICE_LANGUAGE, RISK_SCALE, findAdviceLanguage } from "@lavega/core";
import { intakeCopy } from "./intake";

type Tree = Record<string, unknown>;
const money = (e: number) => `€${e}`;
function strings(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (typeof node === "function") {
    const out: string[] = [];
    for (const args of [
      [],
      [1],
      ["A"],
      ["A", "B"],
      ["A", "B", "C"],
      ["A", "B", "C", "D"],
      [1, 2, "x"],
      [money],
    ]) {
      try {
        const r = (node as (...a: unknown[]) => unknown)(...args);
        if (typeof r === "string") out.push(r);
      } catch {
        /* wrong shape */
      }
    }
    return out;
  }
  if (Array.isArray(node)) return node.flatMap(strings);
  if (node && typeof node === "object") return Object.values(node as Tree).flatMap(strings);
  return [];
}

test("no intake copy trips the shared advice-language list (NL and EN)", () => {
  expect(ADVICE_LANGUAGE.length).toBeGreaterThan(0);
  for (const locale of ["nl", "en"] as const) {
    const hits = strings(intakeCopy[locale])
      .map((s) => ({ s, f: findAdviceLanguage(s, locale) }))
      .filter((x) => x.f.length > 0)
      .map((x) => `${x.s} -> ${JSON.stringify(x.f)}`);
    expect(hits).toEqual([]);
  }
});

test("every risk item and option has copy in both languages", () => {
  for (const locale of ["nl", "en"] as const) {
    const c = intakeCopy[locale].block3;
    for (const item of RISK_SCALE.items) {
      expect(c.risk.items[item.id], item.id).toBeDefined();
      for (const o of item.options) expect(c.risk.items[item.id]!.options[o.id], o.id).toBeTruthy();
      expect(c.risk.items[item.id]!.prompt(money)).toBeTruthy();
    }
  }
});

test("no Dutch string literal in intake/ or the wizard view", () => {
  const sources = (dir: string) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
      .map((f) => join(dir, f));
  const files = [
    ...sources(join(__dirname, "..", "intake")),
    ...sources(join(__dirname, "..", "intake", "wizard")),
    join(__dirname, "..", "views", "IntakeWizard.tsx"),
  ];
  const WORDS = /\b(en|de|het|niet|voor|rekening)\b/i;
  const hits: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
      if (WORDS.test(m[2]!)) hits.push(`${f}: ${m[0]}`);
    }
  }
  expect(hits).toEqual([]);
});
