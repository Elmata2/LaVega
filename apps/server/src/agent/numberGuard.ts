import type { ToolResult } from "@lavega/core";

/* The model never writes text. It SELECTS which computed fact sentences answer the
 * question (`use`) and may pick one intro and one outro phrase from fixed lists by
 * index (`{"intro":1,"use":[0],"outro":null}`). The server composes the message:
 * intro phrase, the chosen facts byte for byte, outro phrase. Every word the user
 * reads is a computed fact or a phrase that the owner wrote. Pure; nothing here logs. */

const MAX_MESSAGE_CHARS = 1000;
const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

export type Selection = { use: number[]; intro: number | null; outro: number | null };
/** The phrase texts around the facts; "" means none. */
export type Framing = { intro: string; outro: string };
const NO_FRAMING: Framing = { intro: "", outro: "" };

/** A phrase index in [0, count), else null: a bad choice drops only that side. */
const phraseIndex = (value: unknown, count: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < count
    ? value
    : null;

/** The model's step 2 output, or null. Exactly the keys `intro`, `use`, `outro` (`use`
 *  required): `use` is 1..factCount unique integers in [0, factCount). `intro` and `outro`
 *  are null or an index into the phrase lists; anything else becomes null and the
 *  selection stays. A JSON string may sit in a ```json fence or have surrounding
 *  whitespace, nothing else. */
export function parseSelection(
  raw: unknown,
  factCount: number,
  introCount: number,
  outroCount: number,
): Selection | null {
  let value = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    const body = FENCE.exec(trimmed)?.[1] ?? trimmed;
    try {
      value = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (!keys.every((k) => k === "intro" || k === "use" || k === "outro")) return null;
  if (!Object.hasOwn(value, "use")) return null;
  const { use, intro, outro } = value as { use?: unknown; intro?: unknown; outro?: unknown };
  if (!Array.isArray(use) || use.length < 1 || use.length > factCount) return null;
  const seen = new Set<number>();
  for (const i of use) {
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= factCount || seen.has(i))
      return null;
    seen.add(i);
  }
  return {
    use: use as number[],
    intro: phraseIndex(intro, introCount),
    outro: phraseIndex(outro, outroCount),
  };
}

/** The intro phrase, the chosen facts (all of them without a selection), the
 *  accepted outro, one per line, within 1000 characters: whole trailing facts are
 *  dropped and `more(n)` says how many. When the framing does not fit, it goes first. */
export function composeAnswer(
  facts: readonly string[],
  selection: number[] | null,
  more: (n: number) => string,
  framing: Framing = NO_FRAMING,
): string {
  const chosen = selection ? selection.map((i) => facts[i]!) : [...facts];
  const build = (kept: string[], f: Framing) =>
    [f.intro, ...kept, f.outro].filter((l) => l !== "").join("\n");
  for (const f of framing.intro || framing.outro ? [framing, NO_FRAMING] : [NO_FRAMING]) {
    const all = build(chosen, f);
    if (all.length <= MAX_MESSAGE_CHARS) return all;
    for (let keep = chosen.length - 1; keep >= 1; keep--) {
      const text = build([...chosen.slice(0, keep), more(chosen.length - keep)], f);
      if (text.length <= MAX_MESSAGE_CHARS) return text;
    }
  }
  return more(chosen.length);
}

/** Invariant check right before sending: every line is exactly one fact, the
 *  "N more" line, or one of the fixed phrases of the user's language. True by
 *  construction; it fails a later edit that adds free text. */
export function guardAnswer(
  answer: string,
  allowed: ToolResult[],
  more: (n: number) => string,
  phrases: readonly string[] = [],
): { ok: true } | { ok: false } {
  const facts = new Set(allowed.flatMap((r) => r.facts));
  const lines = answer.split("\n");
  if (answer === "") return { ok: false };
  const total = Math.max(1, ...allowed.map((r) => r.facts.length));
  const moreLines = new Set(Array.from({ length: total }, (_, n) => more(n + 1)));
  const accepted = new Set(phrases);
  return lines.every((l) => facts.has(l) || moreLines.has(l) || accepted.has(l))
    ? { ok: true }
    : { ok: false };
}
