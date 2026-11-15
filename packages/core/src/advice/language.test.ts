import { expect, test } from "vitest";
import { ADVICE_LANGUAGE, findAdviceLanguage } from "./language.js";

test("Dutch: flags beste, we raden aan, mensen zoals jij, kopen, veilig, moeten", () => {
  expect(findAdviceLanguage("Dit is de beste keuze", "nl")).toContain("best");
  expect(findAdviceLanguage("We raden aan om te sparen", "nl")).toContain("recommend");
  expect(findAdviceLanguage("Mensen zoals jij sparen 10%", "nl")).toContain("people like you");
  expect(findAdviceLanguage("Huishoudens zoals het jouwe", "nl")).toContain("people like you");
  expect(findAdviceLanguage("Je moet dit fonds KOPEN", "nl")).toEqual(
    expect.arrayContaining(["buy/sell/hold", "should"]),
  );
  expect(findAdviceLanguage("Dit fonds is veilig", "nl")).toContain("safe");
  expect(findAdviceLanguage("Een goede deal", "nl")).toContain("good deal");
  expect(findAdviceLanguage("Beleg in dit fonds", "nl")).toContain("invest an amount");
});

test("English: flags best, recommend, people like you, buy, safe, should, typical", () => {
  expect(findAdviceLanguage("The Best option", "en")).toContain("best");
  expect(findAdviceLanguage("We recommend this fund", "en")).toContain("recommend");
  expect(findAdviceLanguage("People like you save more", "en")).toContain("people like you");
  expect(findAdviceLanguage("Households like you", "en")).toContain("people like you");
  expect(findAdviceLanguage("You should buy", "en")).toEqual(
    expect.arrayContaining(["buy/sell/hold", "should"]),
  );
  expect(findAdviceLanguage("A safe choice", "en")).toContain("safe");
  expect(findAdviceLanguage("Typical savers", "en")).toContain("typical");
  expect(findAdviceLanguage("Invest EUR 200 a month", "en")).toContain("invest an amount");
});

test("ISIN and ticker patterns match in both locales", () => {
  for (const locale of ["nl", "en"] as const) {
    expect(findAdviceLanguage("IE00B4L5Y983 is een ETF", locale)).toContain("isin");
    expect(findAdviceLanguage("kijk naar $AAPL", locale)).toContain("ticker");
    expect(findAdviceLanguage("NASDAQ:MSFT", locale)).toContain("ticker");
  }
});

test("false-positive guards: matches respect word boundaries (nl)", () => {
  expect(findAdviceLanguage("Je bestelling is onderweg", "nl")).toEqual([]); // 'beste' inside 'bestelling'
  expect(findAdviceLanguage("Bestanden worden bewaard", "nl")).toEqual([]);
  expect(findAdviceLanguage("Kopenhagen en veiligheid", "nl")).toEqual([]);
});

test("false-positive guards: matches respect word boundaries (en)", () => {
  expect(findAdviceLanguage("Your household bestseller safeguard", "en")).toEqual([]);
  expect(findAdviceLanguage("The shoulder of the road", "en")).toEqual([]);
});

test("clean copy passes and the list is non-empty", () => {
  expect(findAdviceLanguage("Je houdt elke maand 250 euro over.", "nl")).toEqual([]);
  expect(findAdviceLanguage("You keep 250 euro each month.", "en")).toEqual([]);
  expect(ADVICE_LANGUAGE.length).toBeGreaterThan(5);
});

test("Dutch guards: plain uses of koop/aanhouden/best are not flagged", () => {
  expect(findAdviceLanguage("Je kunt een buffer aanhouden", "nl")).toEqual([]);
  expect(findAdviceLanguage("Reserve aanhouden voor onvoorzien", "nl")).toEqual([]);
  expect(findAdviceLanguage("De koop van een huis", "nl")).toEqual([]);
  expect(findAdviceLanguage("Dat gaat best goed", "nl")).toEqual([]);
});

test("Dutch and English: instrument buys and advice words are flagged", () => {
  expect(findAdviceLanguage("Koop dit fonds", "nl")).toContain("buy/sell/hold");
  expect(findAdviceLanguage("Houd dit aandeel aan", "nl")).toContain("buy/sell/hold");
  expect(findAdviceLanguage("Aandelen aanhouden", "nl")).toContain("buy/sell/hold");
  expect(findAdviceLanguage("Wij adviseren sparen", "nl")).toContain("advice");
  expect(findAdviceLanguage("Ons advies", "nl")).toContain("advice");
  expect(findAdviceLanguage("We advise saving", "en")).toContain("advice");
  expect(findAdviceLanguage("Some advice", "en")).toContain("advice");
  expect(findAdviceLanguage("De beste keuze", "nl")).toContain("best");
});

test("the legal line can be stated: negated advice forms pass, positive ones still flag", () => {
  const pass: Array<[string, "nl" | "en"]> = [
    ["Dit is geen advies", "nl"],
    ["Dit is geen financieel advies", "nl"],
    ["Dit is niet bedoeld als financieel advies", "nl"],
    ["This is not advice", "en"],
    ["This is not investment advice", "en"],
    ["There is no advice here", "en"],
    ["This does not constitute advice", "en"],
    ["This doesn't constitute financial advice", "en"],
  ];
  for (const [text, locale] of pass) expect(findAdviceLanguage(text, locale), text).toEqual([]);
  const flagged: Array<[string, "nl" | "en"]> = [
    ["Wij adviseren dit", "nl"],
    ["Ons advies", "nl"],
    ["Advies: spaar meer", "nl"],
    ["We advise this", "en"],
    ["Our advice", "en"],
    ["Dit is geen advies. Wij adviseren dit fonds.", "nl"],
    ["This is not advice. Our advice is to save.", "en"],
  ];
  for (const [text, locale] of flagged) {
    expect(findAdviceLanguage(text, locale), text).toContain("advice");
  }
});

test("final review gaps: amount-to-save and suggest/consider phrasings are flagged", () => {
  const flagged: Array<[string, "nl" | "en"]> = [
    ["Spaar 250 per maand", "nl"],
    ["Zet elke maand 300 euro apart", "nl"],
    ["Leg 200 euro per maand opzij", "nl"],
    ["Overweeg een indexfonds", "nl"],
    ["Wij stellen voor", "nl"],
    ["Save 250 a month", "en"],
    ["Set aside 300 euro every month", "en"],
    ["Put 200 euro aside each month", "en"],
    ["We suggest index funds", "en"],
    ["Consider an index fund", "en"],
    ["Geen advies: spaar meer", "nl"],
    ["Not advice: save more", "en"],
  ];
  for (const [text, locale] of flagged) {
    expect(findAdviceLanguage(text, locale), text).not.toEqual([]);
  }
});

test("final review gaps: plain information stays clean", () => {
  const clean: Array<[string, "nl" | "en"]> = [
    ["Dit is geen advies", "nl"],
    ["This is not advice.", "en"],
    ["Je spaart gemiddeld 250 per maand", "nl"],
    ["Zet de gegevens hieronder in het formulier", "nl"],
    ["You saved 250 last month", "en"],
    ["Consider the figures below", "en"],
    ["We suggest nothing here", "en"],
  ];
  for (const [text, locale] of clean) expect(findAdviceLanguage(text, locale), text).toEqual([]);
});
