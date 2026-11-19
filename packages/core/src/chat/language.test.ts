import { expect, it } from "vitest";
import { detectChatLanguage } from "./language.js";

it("reads English questions as English", () => {
  for (const q of [
    "What did I spend yesterday?",
    "how much do I have in total",
    "Show my subscriptions",
    "Can I save 500 this month?",
    "what are my balances",
  ])
    expect(detectChatLanguage(q, "nl")).toBe("en");
});

it("reads Dutch questions as Dutch", () => {
  for (const q of [
    "Wat gaf ik gisteren uit?",
    "En vorige maand?",
    "Hoeveel heb ik in totaal?",
    "Welke abonnementen heb ik",
    "Kan ik deze maand € 500 sparen?",
  ])
    expect(detectChatLanguage(q, "en")).toBe("nl");
});

it("falls back to the interface language when the words do not decide", () => {
  expect(detectChatLanguage("500", "en")).toBe("en");
  expect(detectChatLanguage("500?", "nl")).toBe("nl");
  expect(detectChatLanguage("Albert Heijn", "nl")).toBe("nl");
  expect(detectChatLanguage("", "en")).toBe("en");
});
