import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, test, vi } from "vitest";
import { findAdviceLanguage } from "@lavega/core";
import { markOnboardingSeen, onboardingSeen, showOnboarding } from "./onboarding.js";
import { LANDING_COPY, landingCopy } from "./landingCopy.js";
import { shellCopy } from "./copy/shell.js";
import type { Locale } from "./locale.js";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

test("the seen flag survives a reload and defaults to unseen", () => {
  expect(onboardingSeen()).toBe(false);
  markOnboardingSeen();
  expect(onboardingSeen()).toBe(true);
});

test("step 0 shows once for a fresh vault; seen or non-fresh never shows it", () => {
  expect(showOnboarding(true, false)).toBe(true);
  expect(showOnboarding(true, true)).toBe(false);
  expect(showOnboarding(false, false)).toBe(false);
  expect(showOnboarding(false, true)).toBe(false);
});

test("the old onboarding copy tree is gone from the shell copy", () => {
  for (const l of ["nl", "en"] as const)
    expect(Object.keys(shellCopy[l])).not.toContain("onboarding");
});

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

test("landing copy mentions only features that still exist", () => {
  const archived =
    /facturen|invoices?|belasting|\btax\b|\bbtw\b|\bvat\b|valuta|currency|zakelijk|business mode/i;
  for (const l of ["nl", "en"] as const) {
    const text = strings(landingCopy(l));
    // Allowed: the brand-neutral phrases that are not features.
    const hits = text.filter((t) => archived.test(t));
    expect(hits, `${l} landing copy still names an archived feature`).toEqual([]);
  }
});

test("the intake pointers (landing FAQ, overview prompt) stay inside the information-only line", () => {
  /* Only the pointers this task added: the FAQ also holds security answers
   * ("is my data safe") that are not advice and trip the generic list. */
  for (const l of ["nl", "en"] as const) {
    const item = landingCopy(l).faq.items.find((i) => /profiel|profile/i.test(i.q));
    expect(item, `${l} FAQ has no profile entry`).toBeDefined();
    expect(findAdviceLanguage(`${item!.q} ${item!.a}`, l as Locale)).toEqual([]);
  }
  const prompt = readFileSync(
    fileURLToPath(new URL("../../server/src/agent/prompts/overview.md", import.meta.url)),
    "utf8",
  );
  expect(findAdviceLanguage(prompt, "nl")).toEqual([]);
});

test("the landing copy exports both locales", () => {
  expect(Object.keys(LANDING_COPY).sort()).toEqual(["en", "nl"]);
});
