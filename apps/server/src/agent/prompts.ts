import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Prompt markdown lives next to this module (src/agent/prompts/). Resolve the
// directory from import.meta.url so it works under tsx (running from source),
// not from process.cwd().
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts");
const cache = new Map<string, string>();

function read(name: string): string {
  try {
    return readFileSync(path.join(DIR, name), "utf8");
  } catch {
    return "";
  }
}

/**
 * Build the system prompt for one tab: the shared `_base.md` plus the tab's own
 * `<tab>.md` (if it exists). A missing or non-alphabetic tab falls back to
 * base-only, so tabs whose prompt hasn't shipped yet still get the shared rules.
 * Result is cached per tab.
 */
export function loadPrompt(tab: string): string {
  if (cache.has(tab)) return cache.get(tab)!;
  const base = read("_base.md");
  const t = /^[a-z]+$/.test(tab) ? read(`${tab}.md`) : "";
  const prompt = t ? `${base}\n\n${t}` : base;
  cache.set(tab, prompt);
  return prompt;
}
