import { expect, test } from "vitest";
import { adminCopy } from "./admin.js";
import type { GuideStage } from "../forwardingGuide.js";
import {
  GMAIL_FILTER_QUERY,
  RULE_WORDS,
  GMAIL_FILTERS_URL,
  GMAIL_FORWARDING_URL,
} from "../forwardingGuide.js";

/* Typed as Record<GuideStage, true> so adding a stage to the state machine
 * without listing it here is a compile error, and listing it here without copy
 * fails the test below. */
const STAGES: Record<GuideStage, true> = {
  "no-address": true,
  "address-ready": true,
  "waiting-for-code": true,
  "code-wait-timed-out": true,
  "code-shown": true,
  "test-pending": true,
  "test-passed": true,
  "test-timed-out": true,
};

test.each(["nl", "en"] as const)("%s: every guide stage has a status line", (lang) => {
  const stages = adminCopy[lang].facturen.guide.stages;
  for (const stage of Object.keys(STAGES)) {
    const line = (stages as Record<string, string>)[stage];
    expect(line, stage).toBeTypeOf("string");
    expect(line.trim().length, stage).toBeGreaterThan(0);
  }
  expect(Object.keys(stages).sort()).toEqual(Object.keys(STAGES).sort());
});

test.each(["nl", "en"] as const)("%s: unreadable setup mail has copy", (lang) => {
  const u = adminCopy[lang].facturen.guide.setupUnreadable;
  expect(u.message.length).toBeGreaterThan(0);
  expect(u.dismiss.length).toBeGreaterThan(0);
});

test.each(["nl", "en"] as const)(
  "%s: the confirmation code is shown as a code, never a link",
  (lang) => {
    const g = adminCopy[lang].facturen.guide;
    const line = g.gmail.step2Code("123456789");
    expect(line).toContain("123456789");
    expect(line).not.toMatch(/https?:|www\./i);
    expect(line.toLowerCase()).toContain("gmail");
  },
);

test.each(["nl", "en"] as const)("%s: no URL is hard-coded in the guide copy", (lang) => {
  const g = adminCopy[lang].facturen.guide;
  const all = JSON.stringify(g, (_k, v) => (typeof v === "function" ? v("X") : v));
  expect(all).not.toMatch(/https?:\/\//i);
});

test("the multi-account note matches the /u/0/ deep links", () => {
  expect(GMAIL_FORWARDING_URL).toContain("/u/0/");
  expect(GMAIL_FILTERS_URL).toContain("/u/0/");
  expect(adminCopy.nl.facturen.guide.gmail.multiAccountNote).toBe(
    "Meerdere Gmail-accounts? Open de instellingen in het juiste account.",
  );
  expect(adminCopy.en.facturen.guide.gmail.multiAccountNote).toBe(
    "Several Gmail accounts? Open settings in the right account.",
  );
});

test("the Outlook work note hedges with may / kan", () => {
  expect(adminCopy.en.facturen.guide.outlook.workNote).toMatch(/\bmay block\b/);
  expect(adminCopy.nl.facturen.guide.outlook.workNote).toMatch(/\bkunnen\b.*\bblokkeren\b/);
});

test("the test intro explains the filter word, and the rule words are injected", () => {
  expect(adminCopy.nl.facturen.guide.test.intro).toContain("“factuur”");
  expect(adminCopy.en.facturen.guide.test.intro).toContain("“invoice”");
  for (const lang of ["nl", "en"] as const) {
    expect(adminCopy[lang].facturen.guide.outlook.step2(RULE_WORDS)).toContain(RULE_WORDS);
  }
  expect(GMAIL_FILTER_QUERY).toBe(
    "has:attachment filename:pdf (factuur OR invoice OR rekening OR nota OR receipt)",
  );
});

test.each(["nl", "en"] as const)(
  "%s: no copy claims Gmail always sends a code or a timing",
  (lang) => {
    const g = adminCopy[lang].facturen.guide;
    const waiting = [g.gmail.step2Waiting, g.stages["waiting-for-code"]].join(" ").toLowerCase();
    expect(waiting).not.toMatch(/minuut|minute/);
    expect(g.gmail.step2TimedOut.length).toBeGreaterThan(0);
    expect(g.gmail.retryCode.length).toBeGreaterThan(0);
    expect(g.test.checklist.length).toBe(2);
    expect(g.test.checklistGmail.length).toBeGreaterThan(0);
    expect(g.test.checklistOutlook.length).toBeGreaterThan(0);
  },
);
