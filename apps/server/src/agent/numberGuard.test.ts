import type { ToolResult } from "@lavega/core";
import { expect, test } from "vitest";
import { composeAnswer, guardAnswer, parseSelection } from "./numberGuard.js";

const facts = ["Fact A: €84.", "Fact B: €15,99 op 12 nov.", "Fact C: 2 betalingen."];
const more = (n: number) => `... en nog ${n} regels.`;
const result = (f: string[]): ToolResult => ({
  figures: {},
  facts: f,
  containsBankText: false,
  empty: false,
});

const sel = (use: number[], intro: number | null = null, outro: number | null = null) => ({
  use,
  intro,
  outro,
});
// Eight intros and eight outros.
const parse = (raw: unknown, n = 3) => parseSelection(raw, n, 8, 8);

test("parseSelection accepts the exact shape, a fenced block and surrounding whitespace", () => {
  expect(parse({ use: [1, 0] }, 3)).toEqual(sel([1, 0]));
  expect(parse('{"use":[1,0]}', 3)).toEqual(sel([1, 0]));
  expect(parse('  \n{"use":[2]}\n ', 3)).toEqual(sel([2]));
  expect(parse('```json\n{"use":[0,2]}\n```', 3)).toEqual(sel([0, 2]));
  expect(parse('```\n{"use":[0]}\n```', 3)).toEqual(sel([0]));
});

test("parseSelection reads intro and outro as phrase indices or null", () => {
  expect(parse({ intro: 0, use: [0], outro: 7 })).toEqual(sel([0], 0, 7));
  expect(parse({ intro: null, use: [0], outro: null })).toEqual(sel([0]));
  expect(parse({ intro: 3, use: [0] })).toEqual(sel([0], 3));
  expect(parse('{"use":[0],"outro":2}')).toEqual(sel([0], null, 2));
  // Anything else for one side drops that side only; the selection and the other side stay.
  for (const bad of [8, -1, 1.5, "2", "Goeie vraag!", "Nee.", true, [1], {}, NaN]) {
    expect(parse({ intro: bad, use: [1], outro: 2 }), String(bad)).toEqual(sel([1], null, 2));
    expect(parse({ intro: 1, use: [1], outro: bad }), String(bad)).toEqual(sel([1], 1, null));
  }
  // A bad use is null whatever the phrases say.
  expect(parse({ intro: 1, use: [9], outro: 2 })).toBeNull();
  expect(parse({ intro: 1, use: [], outro: 2 })).toBeNull();
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
    '{"use":[0],"intro":"a","extra":1}',
    '{"use":[0],"__proto__":{"x":1}}',
    '{"__proto__":{"use":[0]}}',
    '{"intro":"Hoi"}',
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
  for (const raw of bad) expect(parse(raw, 3), String(raw)).toBeNull();
  expect(parse({ use: [0] }, 0)).toBeNull();
  // Object.create(null) payloads and inherited keys are not accepted as a plain `use` object.
  expect(parse(Object.create({ use: [0] }), 3)).toBeNull();
});

test("composeAnswer follows the selection, or takes all facts when there is none", () => {
  expect(composeAnswer(facts, [2, 0], more)).toBe(`${facts[2]}\n${facts[0]}`);
  expect(composeAnswer(facts, null, more)).toBe(facts.join("\n"));
});

test("composeAnswer puts the intro phrase before and the outro phrase after the facts", () => {
  const framing = { intro: "Goeie vraag!", outro: "Fijne dag!" };
  expect(composeAnswer(facts, [2, 0], more, framing)).toBe(
    `Goeie vraag!\n${facts[2]}\n${facts[0]}\nFijne dag!`,
  );
  expect(composeAnswer(facts, [1], more, { intro: "Goeie vraag!", outro: "" })).toBe(
    `Goeie vraag!\n${facts[1]}`,
  );
  expect(composeAnswer(facts, null, more, { intro: "", outro: "" })).toBe(facts.join("\n"));
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

const PHRASES = ["Goeie vraag!", "Fijne dag!"];

test("guardAnswer accepts a phrase from the locale list as an extra line, and nothing else", () => {
  const r = result(facts);
  const text = composeAnswer(facts, [0], more, { intro: "Goeie vraag!", outro: "Fijne dag!" });
  expect(guardAnswer(text, [r], more, PHRASES)).toEqual({ ok: true });
  // The same text is refused when the phrase is not on the list.
  expect(guardAnswer(text, [r], more).ok).toBe(false);
  expect(guardAnswer(text, [r], more, ["Anders!"]).ok).toBe(false);
  expect(guardAnswer(`Nee.\n${facts[0]}`, [r], more, PHRASES).ok).toBe(false);
});

test("guardAnswer fails a message with an extra line", () => {
  const r = result(facts);
  const ok = composeAnswer(facts, [0], more, { intro: "Goeie vraag!", outro: "Fijne dag!" });
  for (const bad of [`${ok}\nNog iets.`, `Nog iets.\n${ok}`, `${ok}\n`, `${ok}\n\n${facts[1]}`])
    expect(guardAnswer(bad, [r], more, PHRASES).ok, bad).toBe(false);
});
