// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account, LegacyRule, Rule, Tx } from "@lavega/core";
import { categorize, isRuleV2 } from "@lavega/core";
import { adminCopy } from "../copy/admin.js";
import { categoryLabel } from "../copy/money.js";
import Regels from "./Regels";

/* Regels — the v2 rules editor.
 *
 * The stored order IS the priority: `rules[index]` is what the engine consults
 * first, so the list renders in that order, the number column states it, and
 * Omhoog/Omlaag hand back the reordered whole array. The old screen sorted a
 * copy for reading and had a note explaining the mismatch; that note is gone.
 *
 * The dry run is pinned against `categorize()` for the same transaction and
 * rule set. That is the promise the panel makes in copy ("dezelfde winnaar"),
 * and a test that only checked the panel's own maths would not catch a drift
 * between the preview and the categorisation the transactions list shows. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT: Account = {
  key: "NL91ABNA0417164300",
  iban: "NL91ABNA0417164300",
  name: "Betaalrekening",
  bank: "ABN AMRO",
  entity: "Privé",
  currency: "EUR",
  balance: 0,
};

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  document.cookie = "lavega_locale=nl; Path=/";
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
});

function render(
  rules: Rule[],
  onSaveRules: (next: Rule[]) => void = () => {},
  txs: Tx[] = [],
  accounts: Account[] = [ACCOUNT],
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <Regels rules={rules} txs={txs} accounts={accounts} busy={false} onSaveRules={onSaveRules} />,
    ),
  );
  return container;
}

function click(el: Element) {
  act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function setValue(el: Element, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function byText(selector: string, text: string): HTMLElement {
  const hit = [...container!.querySelectorAll(selector)].find((node) =>
    (node.textContent ?? "").includes(text),
  );
  if (!hit) throw new Error(`no ${selector} containing "${text}"`);
  return hit as HTMLElement;
}

function ruleRows(): HTMLElement[] {
  return [...container!.querySelectorAll('[data-testid="rule-list"] tbody tr')] as HTMLElement[];
}

function quickAddInput(labelText: string): HTMLInputElement {
  const label = [...container!.querySelectorAll("label")].find((node) =>
    (node.textContent ?? "").startsWith(labelText),
  );
  const input = label?.querySelector("input");
  if (!input) throw new Error(`no input under label "${labelText}"`);
  return input;
}

function tx(partial: Partial<Tx> & { id: string }): Tx {
  return {
    accountKey: ACCOUNT.key,
    date: "2026-02-01",
    amount: -49.99,
    currency: "EUR",
    counterparty: "",
    description: "",
    category: "",
    manual: false,
    ...partial,
  };
}

test("shows the rules in stored order with their priority", () => {
  render([
    { id: "1", match: "zalando pay", category: "Kleding" },
    { id: "2", match: "Albert Heijn", category: "Boodschappen" },
    { id: "3", match: "ns.nl", category: "Transport" },
  ]);

  const rows = ruleRows();
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.querySelector("td")!.textContent)).toEqual(["1", "2", "3"]);
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("zalando pay"),
    expect.stringContaining("Albert Heijn"),
    expect.stringContaining("ns.nl"),
  ]);
  expect(container!.textContent).toContain(
    "De volgorde hieronder is de prioriteit: de eerste regel die past, wint.",
  );
});

test("move down and up persist the reordered whole array", () => {
  const stored: Rule[] = [
    { id: "1", match: "zalando pay", category: "Kleding" },
    { id: "2", match: "Albert Heijn", category: "Boodschappen" },
  ];
  const onSaveRules = vi.fn();
  render(stored, onSaveRules);

  click(byText("button", adminCopy.nl.regels.list.downButton));
  // The first Omlaag belongs to "zalando pay": it swaps with the row below.
  expect(onSaveRules).toHaveBeenLastCalledWith([stored[1], stored[0]]);

  // Re-render with the persisted order, then move the now-second rule up.
  act(() =>
    root!.render(
      <Regels
        rules={[stored[1]!, stored[0]!]}
        txs={[]}
        accounts={[ACCOUNT]}
        busy={false}
        onSaveRules={onSaveRules}
      />,
    ),
  );
  const upOnSecond = ruleRows()[1]!.querySelectorAll("button")[1]!;
  expect(upOnSecond.textContent).toBe(adminCopy.nl.regels.list.upButton);
  click(upOnSecond);
  expect(onSaveRules).toHaveBeenLastCalledWith([stored[0], stored[1]]);
});

test("the ends are disabled", () => {
  render([
    { id: "1", match: "zalando pay", category: "Kleding" },
    { id: "2", match: "Albert Heijn", category: "Boodschappen" },
  ]);
  const rows = ruleRows();
  const firstButtons = rows[0]!.querySelectorAll("button");
  const lastButtons = rows[1]!.querySelectorAll("button");
  expect((firstButtons[1] as HTMLButtonElement).disabled).toBe(true); // Omhoog
  expect((firstButtons[2] as HTMLButtonElement).disabled).toBe(false); // Omlaag
  expect((lastButtons[1] as HTMLButtonElement).disabled).toBe(false);
  expect((lastButtons[2] as HTMLButtonElement).disabled).toBe(true);
});

test("quick add appends a canonical v2 rule after the existing rules", () => {
  const stored: Rule[] = [{ id: "1", match: "zalando pay", category: "Kleding" }];
  const onSaveRules = vi.fn();
  render(stored, onSaveRules);

  setValue(quickAddInput(adminCopy.nl.regels.form.matchLabel), "Albert Heijn");
  setValue(quickAddInput(adminCopy.nl.regels.form.categoryLabel), "Boodschappen");
  click(byText("button", adminCopy.nl.regels.form.addButton));

  const next = onSaveRules.mock.calls[0]![0] as Rule[];
  expect(next).toHaveLength(2);
  expect(next[0]!.id).toBe("1");
  const added = next[1]!;
  expect(isRuleV2(added)).toBe(true);
  if (!isRuleV2(added)) throw new Error("quick add must write a v2 rule");
  expect(added.id).not.toBe("");
  expect(added.conditions).toEqual([
    { kind: "text", target: "text", op: "contains", value: "Albert Heijn" },
  ]);
  expect(added.actions).toEqual([{ kind: "setCategory", category: "Boodschappen" }]);
});

test("editing a legacy rule lowers it, changes the condition and action, and saves v2", () => {
  const stored: Rule[] = [{ id: "1", match: "zalando pay", category: "Kleding" }];
  const onSaveRules = vi.fn();
  render(stored, onSaveRules);

  click(byText("button", adminCopy.nl.regels.list.editButton));
  const editor = container!.querySelector('[data-testid="rule-editor"]')!;
  expect(editor.textContent).toContain(adminCopy.nl.regels.editor.legacyNote);

  const conditionValue = editor.querySelector('[data-testid="editor-conditions"] input')!;
  expect((conditionValue as HTMLInputElement).value).toBe("zalando pay");
  const actionValue = editor.querySelector('[data-testid="editor-actions"] input')!;
  expect((actionValue as HTMLInputElement).value).toBe("Kleding");

  setValue(conditionValue, "zalando");
  setValue(actionValue, "Online shopping");
  click(byText("button", adminCopy.nl.regels.editor.saveButton));

  const next = onSaveRules.mock.calls[0]![0] as Rule[];
  const saved = next[0]!;
  expect(isRuleV2(saved)).toBe(true);
  if (!isRuleV2(saved)) throw new Error("saving an edited legacy rule must write v2");
  expect(saved.id).toBe("1");
  expect(saved.conditions).toEqual([
    { kind: "text", target: "text", op: "contains", value: "zalando" },
  ]);
  expect(saved.actions).toEqual([{ kind: "setCategory", category: "Online shopping" }]);
});

test("the editor opens a v2 rule with every field and saves it unchanged", () => {
  const rule: Rule = {
    v: 2,
    id: "v2-1",
    name: "Grote uitgaven",
    effectiveFrom: "2026-01-01",
    stopProcessing: true,
    conditions: [
      { kind: "amount", op: "between", valueCents: -25000, upperCents: -10000 },
      { kind: "category", op: "empty" },
    ],
    actions: [
      { kind: "setCategory", category: "Boodschappen" },
      { kind: "addTag", tag: "groot" },
    ],
  };
  const onSaveRules = vi.fn();
  render([rule], onSaveRules);
  expect(ruleRows()[0]!.textContent).toContain("Grote uitgaven");

  click(byText("button", adminCopy.nl.regels.list.editButton));
  const editor = container!.querySelector('[data-testid="rule-editor"]')!;
  expect(editor.querySelector("h3")!.textContent).toBe(adminCopy.nl.regels.editor.editHeading);
  expect((editor.querySelector("input") as HTMLInputElement).value).toBe("Grote uitgaven");
  expect((editor.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("2026-01-01");

  // Amounts are edited in euros, not cents. -25000 cents is -250 euro.
  const amountInputs = editor.querySelectorAll('[data-testid="editor-conditions"] input');
  expect((amountInputs[0] as HTMLInputElement).value).toBe("-250");
  expect((amountInputs[1] as HTMLInputElement).value).toBe("-100");

  const stop = editor.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(stop.checked).toBe(true);

  const actionInputs = editor.querySelectorAll('[data-testid="editor-actions"] input');
  expect((actionInputs[0] as HTMLInputElement).value).toBe("Boodschappen");
  expect((actionInputs[1] as HTMLInputElement).value).toBe("groot");

  click(byText("button", adminCopy.nl.regels.editor.saveButton));
  expect(onSaveRules).toHaveBeenCalledWith([rule]);
});

test("the editor refuses an empty value and saves nothing", () => {
  const onSaveRules = vi.fn();
  render([{ id: "1", match: "zalando pay", category: "Kleding" }], onSaveRules);

  click(byText("button", adminCopy.nl.regels.list.editButton));
  const conditionValue = container!.querySelector('[data-testid="editor-conditions"] input')!;
  setValue(conditionValue, "   ");
  click(byText("button", adminCopy.nl.regels.editor.saveButton));

  expect(onSaveRules).not.toHaveBeenCalled();
  expect(container!.querySelector('[role="alert"]')!.textContent).toBe(
    adminCopy.nl.regels.validation.emptyValue,
  );
});

test("legacy rules render readably", () => {
  render([{ id: "1", match: "albert heijn", category: "Boodschappen" }]);
  const row = ruleRows()[0]!;
  expect(row.textContent).toContain("albert heijn → Boodschappen");
  expect(row.textContent).toContain("Categorie: Boodschappen");
});

test("warns when a typed category is a new one, and offers the existing list", () => {
  render([]);
  expect(container!.querySelector('input[list="regel-categorieen"]')).toBeTruthy();
  expect(container!.querySelector("datalist")).toBeTruthy();

  const categoryInput = quickAddInput(adminCopy.nl.regels.form.categoryLabel);
  setValue(categoryInput, "Boodschappen");
  expect(container!.textContent).not.toContain("staat niet in de lijst");

  // A different spelling of an existing category is exactly the case that
  // silently splits every total, so it has to be called out.
  setValue(categoryInput, "boodschappen ");
  expect(container!.textContent).not.toContain("staat niet in de lijst");
  setValue(categoryInput, "Boodschappen");
  expect(container!.textContent).not.toContain("staat niet in de lijst");

  setValue(categoryInput, "Boodschapen");
  expect(container!.textContent).toContain('"Boodschapen" staat niet in de lijst');
});

test("the dry run previews the same category categorize() decides, and names the rule", () => {
  const rules: Rule[] = [{ id: "r1", match: "zalando pay", category: "Kleding" }];
  const sample = tx({ id: "t1", counterparty: "Zalando Payments", description: "Bestelling" });
  render(rules, () => {}, [sample]);

  click(byText("button", adminCopy.nl.regels.preview.button));

  const panel = container!.querySelector('[data-testid="dry-run"]')!;
  expect(panel.textContent).toContain("1 van 1 transacties geraakt");
  const cells = [...panel.querySelectorAll('[data-testid="dry-run-table"] tbody tr td')].map(
    (cell) => cell.textContent,
  );
  const expected = categoryLabel("nl", categorize(sample, rules));
  expect(expected).toBe("Kleding");
  expect(cells[4]).toBe(expected); // "Nieuwe categorie" column
  expect(cells[5]).toContain("zalando pay"); // winning rule summary
});

test("a hand-set category is locked: the preview keeps it and no rule claims it", () => {
  const rules: Rule[] = [{ id: "r1", match: "zalando pay", category: "Kleding" }];
  const manual = tx({
    id: "t1",
    counterparty: "Zalando Payments",
    category: "Boodschappen",
    manual: true,
  });
  render(rules, () => {}, [manual]);

  click(byText("button", adminCopy.nl.regels.preview.button));

  const panel = container!.querySelector('[data-testid="dry-run"]')!;
  const cells = [...panel.querySelectorAll('[data-testid="dry-run-table"] tbody tr td')].map(
    (cell) => cell.textContent,
  );
  expect(cells[4]).toBe("Boodschappen"); // stays the stored category
  expect(cells[5]).toContain(adminCopy.nl.regels.preview.lockedBadge);
  expect(cells[5]).not.toContain("zalando pay");
});

test("switches to English copy when the locale cookie says en", () => {
  document.cookie = "lavega_locale=en; Path=/";
  const en = adminCopy.en.regels;
  const c = render([{ id: "1", match: "zalando pay", category: "Kleding" }]);

  expect(c.querySelector("h2")!.textContent).toBe(en.section.heading);
  expect(c.textContent).toContain(en.intro.autoCategorization);
  expect(c.textContent).toContain(en.intro.priorityNote);

  const paragraphs = [...c.querySelectorAll("p.cell-sub")];
  const matchingRulesParagraph = paragraphs.find((p) =>
    p.textContent?.includes(en.intro.matchingRules.matchWord),
  )!;
  expect(matchingRulesParagraph.querySelector("em")!.textContent).toBe(
    en.intro.matchingRules.matchWord,
  );
  expect(matchingRulesParagraph.querySelector("strong")!.textContent).toBe(
    en.intro.matchingRules.firstWord,
  );
  expect([...matchingRulesParagraph.querySelectorAll("em")][1]!.textContent).toBe(
    en.intro.matchingRules.unknownWord,
  );
  expect(matchingRulesParagraph.textContent).toBe(
    en.intro.matchingRules.beforeMatchWord +
      en.intro.matchingRules.matchWord +
      en.intro.matchingRules.beforeFirstWord +
      en.intro.matchingRules.firstWord +
      en.intro.matchingRules.beforeUnknownWord +
      en.intro.matchingRules.unknownWord +
      en.intro.matchingRules.afterUnknownWord,
  );

  expect(c.querySelector("thead th")!.textContent).toBe(en.list.priorityHeader);
  for (const label of [
    en.list.editButton,
    en.list.upButton,
    en.list.downButton,
    en.list.deleteButton,
    en.list.newButton,
    en.form.addButton,
    en.preview.button,
  ]) {
    expect([...c.querySelectorAll("button")].find((b) => b.textContent === label)).toBeTruthy();
  }
});

test("a rule's category renders translated while the stored value stays Dutch", () => {
  document.cookie = "lavega_locale=en; Path=/";
  const stored: Rule[] = [{ id: "1", match: "albert heijn", category: "Boodschappen" }];
  render(stored);

  expect(ruleRows()[0]!.textContent).toContain("albert heijn → Groceries");
  expect(stored[0]).toMatchObject({ category: "Boodschappen" });
});

test("stored order, not alphabetical order, decides the winner", () => {
  const stored: LegacyRule[] = [
    { id: "1", match: "zalando pay", category: "Kleding" },
    { id: "2", match: "zalando", category: "Onbekend" },
  ];
  // Only the two fields a legacy rule reads matter here.
  const sample = { counterparty: "Zalando Payments", description: "" } as Tx;

  expect(categorize(sample, stored)).toBe("Kleding");

  // The alphabetical order would let the general rule win — which is exactly
  // why the screen never sorts the stored array.
  const alphabetical = [...stored].sort((a, b) =>
    a.match.localeCompare(b.match, "nl", { sensitivity: "base", numeric: true }),
  );
  expect(categorize(sample, alphabetical)).toBe("Onbekend");
});

test("the intro explanation survives, including the em/strong paragraph", () => {
  const html = renderToStaticMarkup(
    <Regels
      rules={[{ id: "r1", match: "albert heijn", category: "Boodschappen" }]}
      txs={[]}
      accounts={[ACCOUNT]}
      busy={false}
      onSaveRules={() => {}}
    />,
  );
  expect(html).toContain("Je eigen regels hieronder gaan vóór die automatische categorieën");
  expect(html).toContain("eerste");
  expect(html).toContain("albert heijn");
  expect(html).toContain("<input");
});
