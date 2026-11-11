import type { ToolResult } from "@lavega/core";
import { expect, test } from "vitest";
import { composeAnswer, guardAnswer, parseSelection } from "./numberGuard.js";

const facts = ["Fact A: €84.", "Fact B: €15,99 op 12 nov.", "Fact C: 2 betalingen."];
const more = (n: number) => `... en nog ${n} regels.`;
const result = (f: string[]): ToolResult => ({ figures: {}, facts: f, containsBankText: false });

test("parseSelection accepts the exact shape, a fenced block and surrounding whitespace", () => {
  expect(parseSelection({ use: [1, 0] }, 3)).toEqual([1, 0]);
  expect(parseSelection('{"use":[1,0]}', 3)).toEqual([1, 0]);
  expect(parseSelection('  \n{"use":[2]}\n ', 3)).toEqual([2]);
  expect(parseSelection('```json\n{"use":[0,2]}\n```', 3)).toEqual([0, 2]);
  expect(parseSelection('```\n{"use":[0]}\n```', 3)).toEqual([0]);
});

test("parseSelection rejects everything else", () => {
  const bad: unknown[] = [
    '{"use":[0,0]}',
    '{"use":[3]}',
    '{"use":[-1]}',
    '{"use":[0.5]}',
    '{"use":["0"]}',
    '{"use":[]}',
    '{"use":[0,1,2,3]}',
    '{"use":[0],"extra":1}',
    '{"use":[0],"__proto__":{"x":1}}',
    '{"__proto__":{"use":[0]}}',
    "[0,1]",
    '[{"use":[0]}]',
    'Sure! {"use":[0]}',
    '{"use":[0]} Hope that helps',
    '{"use":0}',
    '{"use":null}',
    "null",
    "",
    "not json",
    undefined,
    null,
    42,
    { use: "0" },
    { use: [0], other: true },
    ["use"],
  ];
  for (const raw of bad) expect(parseSelection(raw, 3), String(raw)).toBeNull();
  expect(parseSelection({ use: [0] }, 0)).toBeNull();
  // Object.create(null) payloads and inherited keys are not accepted as a plain `use` object.
  expect(parseSelection(Object.create({ use: [0] }), 3)).toBeNull();
});

test("composeAnswer follows the selection, or takes all facts when there is none", () => {
  expect(composeAnswer(facts, [2, 0], more)).toBe(`${facts[2]}\n${facts[0]}`);
  expect(composeAnswer(facts, null, more)).toBe(facts.join("\n"));
});

test("composeAnswer caps at 1000 characters, dropping whole trailing facts", () => {
  const many = Array.from(
    { length: 30 },
    (_, n) => `Fact number ${n + 1} is here and it is long enough.`,
  );
  const text = composeAnswer(many, null, more);
  expect(text.length).toBeLessThanOrEqual(1000);
  const lines = text.split("\n");
  const kept = lines.slice(0, -1);
  expect(kept.every((l, n) => l === many[n])).toBe(true);
  expect(lines.at(-1)).toBe(more(30 - kept.length));
});

test("guardAnswer accepts a message made only of fact lines and the more line", () => {
  const r = result(facts);
  expect(guardAnswer(composeAnswer(facts, [1], more), [r], more)).toEqual({ ok: true });
  expect(guardAnswer(composeAnswer(facts, null, more), [r], more)).toEqual({ ok: true });
  const many = Array.from(
    { length: 30 },
    (_, n) => `Fact number ${n + 1} is here and it is long enough.`,
  );
  expect(guardAnswer(composeAnswer(many, null, more), [result(many)], more)).toEqual({ ok: true });
});

test("guardAnswer rejects any other line: an altered character, added prose, a different count", () => {
  const r = result(facts);
  for (const bad of [
    "Fact A: €85.",
    "fact A: €84.",
    `${facts[0]} Dat is niet waar.`,
    `Hoi!\n${facts[0]}`,
    `${facts[0]}\nDubbel.`,
    "Een kwart.",
    "",
    `${facts[0]}\n... en nog 0 regels.`,
    `${facts[0]}\n... en nog -1 regels.`,
    `${facts[0]}\n... en nog 1.5 regels.`,
  ])
    expect(guardAnswer(bad, [r], more).ok, bad).toBe(false);
});
