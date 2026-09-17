import { expect, test } from "vitest";
import { CHAT_TABS } from "./chatContext.js";
import { composePrompt, loadAgentPrompt, loadChatPrompt } from "./prompts.js";

const BASE_MARKER = "LaVega — basis voor elke agent";

test("every agent is defined by an instruction file composed from _base.md", () => {
  for (const agent of ["categorize", "facturen-extract", "travel"]) {
    const prompt = loadAgentPrompt(agent);
    expect(prompt).toContain(BASE_MARKER);
    expect(prompt.length).toBeGreaterThan(BASE_MARKER.length + 200); // its own file is there too
    // The shared learning contract is stated once, for all of them.
    expect(prompt).toContain("WAT LAVEGA AL WEET");
    expect(prompt).toContain("(door de gebruiker)");
  }
});

test("the agent files really are on disk — a typo must not silently yield base-only", () => {
  const base = composePrompt("_base.md");
  for (const agent of ["categorize", "facturen-extract", "travel"]) {
    expect(loadAgentPrompt(agent)).not.toBe(base);
  }
  // A missing or malformed name falls back to the shared charter rather than throwing.
  expect(loadAgentPrompt("bestaat-niet")).toBe(base);
  expect(loadAgentPrompt("../../etc/passwd")).toBe(base);
});

test("each chat tab composes _base.md + _chat.md + its own file", () => {
  for (const tab of CHAT_TABS) {
    const prompt = loadChatPrompt(tab);
    expect(prompt).toContain(BASE_MARKER);
    expect(prompt).toContain("TAB-CONTEXT"); // from _chat.md
    expect(prompt).not.toBe(loadChatPrompt("")); // the tab's own file is present
  }
  // Composition order: shared charter first, then the chat charter, then the tab.
  const overview = loadChatPrompt("overview");
  expect(overview.indexOf(BASE_MARKER)).toBeLessThan(overview.indexOf("TAB-CONTEXT"));
});

test("composePrompt skips missing files and caches per file set", () => {
  expect(composePrompt("_base.md", "", "bestaat-niet.md")).toBe(composePrompt("_base.md"));
  expect(composePrompt("_base.md", "travel.md")).toBe(loadAgentPrompt("travel"));
});

/* THE PRODUCTION FAILURE THESE FILES SHIPPED WITH, found 17 Sep 2026.
 *
 * The Markdown is read at runtime from a directory derived from
 * import.meta.url. The Vercel build bundles the whole server into a single
 * .mjs, so that path resolved to the function directory — and nothing copied
 * the Markdown there. Every readFileSync threw, `read()` returned "", and EVERY
 * agent ran in production with no system prompt at all while still answering
 * plausibly. The first visible symptom was an invoice draft with every field
 * blank, weeks after the feature was called shipped.
 *
 * The tests above pass from source, which is precisely why none of them caught
 * it. The real guard is the assertion in scripts/vercel-build.mjs; what this
 * pins is the other half — that a composition resolving to nothing is now a
 * thrown error rather than a silent empty string that reaches a model. */
test("a composition that resolves to nothing throws instead of returning an empty prompt", () => {
  expect(() => composePrompt("bestaat-niet.md")).toThrow(/agent prompt missing/);
  expect(() => composePrompt("")).toThrow(/agent prompt missing/);
});

/* The extractor's own contract, so a prompt edit cannot quietly drop the field
 * names invoiceExtract.ts coerces against. */
test("the extraction prompt names the fields the coercion reads", () => {
  const p = loadAgentPrompt("facturen-extract");
  for (const field of ["seller", "buyer", "payeeIban", "amount", "issueDate"])
    expect(p, field).toContain(field);
});

/* It cannot know who the owner is — the redaction boundary sees to that — and
 * asking anyway made every model answer "inkoopfactuur" for every invoice. */
test("the extraction prompt does not ask the model who the owner is", () => {
  const p = loadAgentPrompt("facturen-extract");
  expect(p).not.toContain('"direction"');
  expect(p).not.toContain('"counterparty"');
});

test("the tax agent is told the country decides, not Nederland by default", () => {
  const prompt = loadChatPrompt("belasting");
  // the shared charter no longer assumes a Dutch owner …
  expect(prompt).not.toContain("Nederlandse ondernemer");
  expect(prompt).toContain("ga er nooit vanuit dat het Nederland is");
  // … and the tab file names the pack fields it must read instead
  for (const marker of ["country", "rules", "prepayments", "Nachzahlung", "sheet"]) {
    expect(prompt).toContain(marker);
  }
});

test("the punten assistant asks for a stale balance and never invents or scrapes one", () => {
  const prompt = loadChatPrompt("punten");
  expect(prompt).toContain("tracking");
  expect(prompt).toContain("stel de bijbehorende `question` letterlijk");
  expect(prompt).toContain("Verzin nooit een saldo");
  // The low-trust path only: no credential, no screenshot, no logging in for him.
  expect(prompt).toContain("geen inlogcode");
});
