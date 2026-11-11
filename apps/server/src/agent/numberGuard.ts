import type { ToolResult } from "@lavega/core";

/* The model never writes the answer. It SELECTS which computed fact sentences
 * answer the question (`{"use":[...]}`); the server composes the message from
 * those sentences, byte for byte. A wrong, re-bound or invented figure is then
 * not detected but unrepresentable. Free text from a model cannot be policed by
 * a denylist, so none is sent. Pure; nothing here logs. */

const MAX_MESSAGE_CHARS = 1000;
const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

/** The model's step 2 output to fact indices, or null. Exactly `{"use":[...]}` with
 *  1..factCount unique integers in [0, factCount); a JSON string may sit in a
 *  ```json fence or have surrounding whitespace, nothing else. */
export function parseSelection(raw: unknown, factCount: number): number[] | null {
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
  if (keys.length !== 1 || keys[0] !== "use") return null;
  const use = (value as { use?: unknown }).use;
  if (!Array.isArray(use) || use.length < 1 || use.length > factCount) return null;
  const seen = new Set<number>();
  for (const i of use) {
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= factCount || seen.has(i))
      return null;
    seen.add(i);
  }
  return use as number[];
}

/** The chosen facts (all of them without a selection), one per line, within 1000
 *  characters: whole trailing facts are dropped and `more(n)` says how many. */
export function composeAnswer(
  facts: readonly string[],
  selection: number[] | null,
  more: (n: number) => string,
): string {
  const chosen = selection ? selection.map((i) => facts[i]!) : [...facts];
  const all = chosen.join("\n");
  if (all.length <= MAX_MESSAGE_CHARS) return all;
  for (let keep = chosen.length - 1; keep >= 1; keep--) {
    const text = [...chosen.slice(0, keep), more(chosen.length - keep)].join("\n");
    if (text.length <= MAX_MESSAGE_CHARS) return text;
  }
  return more(chosen.length);
}

/** Invariant check right before sending: every line is exactly one fact or the
 *  "N more" line. True by construction; it fails a later edit that adds free text. */
export function guardAnswer(
  answer: string,
  allowed: ToolResult[],
  more: (n: number) => string,
): { ok: true } | { ok: false } {
  const facts = new Set(allowed.flatMap((r) => r.facts));
  const lines = answer.split("\n");
  if (answer === "") return { ok: false };
  const total = Math.max(1, ...allowed.map((r) => r.facts.length));
  const moreLines = new Set(Array.from({ length: total }, (_, n) => more(n + 1)));
  return lines.every((l) => facts.has(l) || moreLines.has(l)) ? { ok: true } : { ok: false };
}
