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
 * Compose one agent's instructions from markdown files, `_base.md` first.
 *
 * This is the whole point of the instruction-file design: every agent — chat,
 * categorize, the invoice extractor, travel — is DEFINED in Markdown next to
 * this file, and its behaviour is changed by editing that Markdown, not by
 * editing a string literal in TypeScript. Missing files are skipped, so an
 * agent whose own file hasn't shipped yet still gets the shared charter.
 * Cached per file set.
 */
export function composePrompt(...files: string[]): string {
  const wanted = files.filter(Boolean);
  const key = wanted.join("+");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const prompt = wanted.map(read).filter(Boolean).join("\n\n");
  cache.set(key, prompt);
  return prompt;
}

/** The chat assistant on one tab: shared charter + chat charter + that tab's
 *  own instructions. A non-alphabetic tab falls back to the two charters. */
export function loadChatPrompt(tab: string): string {
  return composePrompt("_base.md", "_chat.md", /^[a-z]+$/.test(tab) ? `${tab}.md` : "");
}

/** A task agent (`categorize`, `facturen-extract`, `travel`): shared charter +
 *  that agent's own instruction file. */
export function loadAgentPrompt(agent: string): string {
  return composePrompt("_base.md", /^[a-z-]+$/.test(agent) ? `${agent}.md` : "");
}
