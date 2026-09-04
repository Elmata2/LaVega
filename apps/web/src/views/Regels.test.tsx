// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { Rule, Tx } from "@lavega/core";
import { categorize } from "@lavega/core";
import Regels from "./Regels";

/* Regels — alfabetisch OM TE LEZEN, oorspronkelijke orde OM TE MATCHEN.
 *
 * Hij vroeg de lijst alfabetisch (review 2 en opnieuw review 3, item 11). Dat is
 * een weergavevraag met een valstrik erin: categorize() loopt de regels in de
 * OPGESLAGEN orde af en pakt de eerste die matcht. Sorteer je de array zelf, dan
 * verandert stil welke regel wint. Deze tests pinnen beide helften vast — het
 * alfabet op het scherm, en de opgeslagen orde in alles wat het scherm
 * terugmeldt. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(rules: Rule[], onSaveRules: (next: Rule[]) => void = () => {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <Regels
        rules={rules}
        busy={false}
        ruleMatch=""
        onRuleMatchChange={() => {}}
        ruleCategory=""
        onRuleCategoryChange={() => {}}
        onSaveRules={onSaveRules}
      />,
    ),
  );
  return container;
}

/** The first cell of every body row, i.e. the match column as displayed. */
function shownMatches(): string[] {
  return [...container!.querySelectorAll("tbody tr")].map(
    (tr) => tr.querySelector("td")!.textContent ?? "",
  );
}

test("de lijst staat op alfabet, ongeacht in welke orde hij is opgeslagen", () => {
  render([
    { id: "1", match: "zalando", category: "Kleding" },
    { id: "2", match: "Albert Heijn", category: "Boodschappen" },
    { id: "3", match: "ns.nl", category: "Transport" },
    { id: "4", match: "École", category: "Onderwijs" },
  ]);
  // Hoofdletters doen niet mee (sensitivity: "base"), en É valt onder de E waar
  // een Nederlandse lezer hem zoekt — niet achteraan zoals bij een ruwe
  // codepoint-sortering.
  expect(shownMatches()).toEqual(["Albert Heijn", "École", "ns.nl", "zalando"]);
});

test("nummers lopen op zoals je ze leest: 2 vóór 10", () => {
  render([
    { id: "1", match: "Regel 10", category: "A" },
    { id: "2", match: "Regel 2", category: "B" },
  ]);
  expect(shownMatches()).toEqual(["Regel 2", "Regel 10"]);
});

test("het alfabet is WEERGAVE — verwijderen laat de opgeslagen orde intact", () => {
  const stored: Rule[] = [
    { id: "1", match: "zalando pay", category: "Kleding" },
    { id: "2", match: "zalando", category: "Onbekend" },
    { id: "3", match: "Albert Heijn", category: "Boodschappen" },
  ];
  const onSaveRules = vi.fn();
  render(stored, onSaveRules);

  // Op het scherm staat "Albert Heijn" bovenaan…
  expect(shownMatches()[0]).toBe("Albert Heijn");
  // …en als je die verwijdert, gaan de andere twee terug in hun EIGEN orde: de
  // specifieke "zalando pay" staat nog vóór de algemene "zalando".
  const row = [...container!.querySelectorAll("tbody tr")].find((tr) =>
    (tr.textContent ?? "").includes("Albert Heijn"),
  )!;
  act(() => row.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(onSaveRules).toHaveBeenCalledWith([
    { id: "1", match: "zalando pay", category: "Kleding" },
    { id: "2", match: "zalando", category: "Onbekend" },
  ]);
});

test("en dat is niet cosmetisch: de opgeslagen orde bepaalt welke regel wint", () => {
  const stored: Rule[] = [
    { id: "1", match: "zalando pay", category: "Kleding" },
    { id: "2", match: "zalando", category: "Onbekend" },
  ];
  // Alleen de twee velden waar een regel naar kijkt zijn hier van belang; de
  // rest van een Tx doet in categorize() niets mee.
  const tx = { counterparty: "Zalando Payments", description: "" } as unknown as Tx;
  // Wat categorize() met deze orde doet…
  expect(categorize(tx, stored)).toBe("Kleding");
  // …en wat het met de alfabetische orde zou doen. Zou het scherm de array zelf
  // sorteren, dan viel de specifieke regel stil van de kaart.
  const alphabetical = [...stored].sort((a, b) =>
    a.match.localeCompare(b.match, "nl", { sensitivity: "base", numeric: true }),
  );
  expect(categorize(tx, alphabetical)).toBe("Onbekend");
});

test("de lijst zegt zelf dat de bovenste regel niet de winnende is", () => {
  const c = render([
    { id: "1", match: "zalando pay", category: "Kleding" },
    { id: "2", match: "Albert Heijn", category: "Boodschappen" },
  ]);
  expect(c.textContent).toContain("Op alfabet gesorteerd om te lezen");
  expect(c.textContent).toContain("de regel die je het eerst hebt gemaakt");
});

test("een nieuwe regel komt ACHTER de bestaande, niet op zijn alfabetische plek", () => {
  // Anders zou het toevoegen van een korte regel als "spar" ongemerkt vóór een
  // bestaande specifieke regel schuiven.
  const stored: Rule[] = [{ id: "1", match: "zalando pay", category: "Kleding" }];
  const onSaveRules = vi.fn();
  const c = render(stored, onSaveRules);
  // De knop leest ruleMatch/ruleCategory uit de props, dus zetten we die daar.
  act(() =>
    root!.render(
      <Regels
        rules={stored}
        busy={false}
        ruleMatch="Albert Heijn"
        onRuleMatchChange={() => {}}
        ruleCategory="Boodschappen"
        onRuleCategoryChange={() => {}}
        onSaveRules={onSaveRules}
      />,
    ),
  );
  const add = [...c.querySelectorAll("button")].find((b) => b.textContent === "Toevoegen")!;
  act(() => add.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const next = onSaveRules.mock.calls[0]![0] as Rule[];
  expect(next.map((r) => r.match)).toEqual(["zalando pay", "Albert Heijn"]);
});
