// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  RISK_SCALE,
  emptyProfileStore,
  findAdviceLanguage,
  type AdvisorProfileStore,
} from "@lavega/core";
import IntakeWizard from "./IntakeWizard";
import {
  applyChildren,
  applyGoals,
  applyHousehold,
  applyStatedCards,
  applyStatedDebitCards,
} from "../intake/state";
import { markDone, screensFor } from "../intake/wizard/screens";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-10-23";
const NOW = () => "2026-10-23T10:00:00Z";
let root: Root | null = null;
let el: HTMLElement | null = null;

beforeEach(() => {
  document.cookie = "lavega_locale=en";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  el?.remove();
  root = null;
  el = null;
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
});

type Mounted = {
  c: HTMLElement;
  onSave: ReturnType<typeof vi.fn>;
  onFinish: ReturnType<typeof vi.fn>;
  saved: () => AdvisorProfileStore;
};
function mount(
  store: AdvisorProfileStore | null = null,
  onSave: (s: AdvisorProfileStore) => Promise<void> = async () => {},
  corrupt = false,
  onImport: (f: File) => Promise<{ ok: true; count: number } | { ok: false }> = async () => ({
    ok: true,
    count: 0,
  }),
): Mounted {
  const spy = vi.fn(onSave);
  const onFinish = vi.fn();
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  act(() =>
    root!.render(
      <IntakeWizard
        store={store}
        corrupt={corrupt}
        asOf={AS_OF}
        onSave={spy}
        onImport={onImport}
        onFinish={onFinish}
        onExit={() => {}}
        now={NOW}
      />,
    ),
  );
  return {
    c: el,
    onSave: spy,
    onFinish,
    saved: () => spy.mock.calls.at(-1)![0],
  };
}
const flush = () => act(async () => {});
const counter = (c: HTMLElement) => c.querySelector(".wz-counter")!.textContent;
const h1 = (c: HTMLElement) => c.querySelector("h1")!.textContent;
const tile = (c: HTMLElement, text: string) =>
  [...c.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (b) => b.textContent === text,
  )!;
async function tap(c: HTMLElement, text: string) {
  await act(async () => tile(c, text).click());
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const box = (c: HTMLElement, text: string) =>
  [...c.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')].find(
    (b) => b.textContent === text,
  )!;
async function pickWork(c: HTMLElement, text = "Employed") {
  await act(async () => box(c, text).click());
  await act(async () => c.querySelector<HTMLButtonElement>(".wz-next")!.click());
}
const nextBtn = (c: HTMLElement) =>
  c.querySelector<HTMLButtonElement>(".wz-next")!;

test("fresh store opens on household and shows 1 / 22", () => {
  const { c } = mount();
  expect(counter(c)).toBe("1 / 22");
  expect(h1(c)).toBe("Do you live alone or together?");
});

test("tapping Samen saves household together with partnerIncomeInScope and words income for the household", async () => {
  const { c, saved } = mount();
  await tap(c, "Together");
  expect(saved().current.household?.value).toEqual({
    kind: "together",
    partnerIncomeInScope: true,
  });
  expect(counter(c)).toBe("2 / 22");
  await pickWork(c);
  expect(counter(c)).toBe("3 / 22");
  await tap(c, "No");
  expect(h1(c)).toBe("What do you earn together, net per month?");
});

test("income Verder is disabled when empty and saves a zero-width range", async () => {
  const { c, saved } = mount();
  await tap(c, "Alone");
  await pickWork(c);
  await tap(c, "No");
  expect(h1(c)).toBe("What do you earn, net per month?");
  expect(nextBtn(c).disabled).toBe(true);
  await type(c.querySelector("input")!, "3250");
  expect(nextBtn(c).disabled).toBe(false);
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedRanges?.value?.income).toEqual({
    lowCents: 325000,
    highCents: 325000,
  });
  expect(counter(c)).toBe("5 / 21");
});

test("Nee on children skips child-years and the counter shows 21", async () => {
  const { c } = mount();
  await tap(c, "Alone");
  await pickWork(c);
  await tap(c, "No");
  expect(counter(c)).toBe("4 / 21");
  expect(h1(c)).toBe("What do you earn, net per month?");
});

test("Ja on children goes to child-years, and Back then Ja again still does", async () => {
  const { c } = mount();
  await tap(c, "Alone");
  await pickWork(c);
  await tap(c, "No");
  await act(async () =>
    c.querySelector<HTMLButtonElement>(".wz-back")!.click(),
  );
  await tap(c, "Yes");
  expect(h1(c)).toBe("What year were they born?");
});

test("failed save on a choice stays on the screen", async () => {
  let fail = true;
  const { c } = mount(null, async () => {
    if (fail) {
      fail = false;
      throw new Error("x");
    }
  });
  await tap(c, "Alone");
  await flush();
  expect(h1(c)).toBe("Do you live alone or together?");
  expect(c.querySelector('[role="alert"]')).not.toBeNull();
  await tap(c, "Alone");
  expect(h1(c)).toBe("What kind of work do you do?");
  expect(c.querySelector('[role="alert"]')).toBeNull();
});

test("goal with a past date cannot be saved; Nog geen doel advances without a goal", async () => {
  let s = emptyProfileStore(NOW());
  s = { ...s, current: markDone(s.current, "cards") };
  const { c, saved } = mount(s);
  expect(h1(c)).toBe("What are you saving for?");
  const [purpose, , date] = [...c.querySelectorAll<HTMLInputElement>("input")];
  await type(purpose!, "Holiday");
  await type(c.querySelectorAll<HTMLInputElement>("input")[1]!, "2000");
  await type(date!, "2020-01-01");
  expect(nextBtn(c).disabled).toBe(true);
  await type(date!, "2027-06-01");
  expect(nextBtn(c).disabled).toBe(false);
  await type(date!, "2020-01-01");
  const skip = [...c.querySelectorAll<HTMLButtonElement>(".wz-link")].find(
    (b) => b.textContent === "No goal yet",
  )!;
  await act(async () => skip.click());
  expect(h1(c)).toBe("Do you have debts we cannot see?");
  expect(saved().current.goals).toBeUndefined();
});

test("the last risk tap then invested calls onFinish with blocksDone 3", async () => {
  let s = emptyProfileStore(NOW());
  s = { ...s, current: markDone(s.current, "buffer") };
  const { c, saved, onFinish } = mount(s);
  for (const item of RISK_SCALE.items) {
    expect(h1(c)).not.toBe("");
    const first = c.querySelector<HTMLButtonElement>('[role="radio"]')!;
    await act(async () => first.click());
    expect(saved().current.risk?.answers?.[item.id]).toBe(item.options[0]!.id);
  }
  expect(h1(c)).toContain("invested before");
  expect(onFinish).not.toHaveBeenCalled();
  await act(async () =>
    c.querySelectorAll<HTMLButtonElement>('[role="radio"]')[0]!.click(),
  );
  expect(saved().current.intake.blocksDone).toBe(3);
  expect(onFinish).not.toHaveBeenCalled();
  expect(h1(c)).toBe("Do you want to add your bank statement?");
});

const pickFile = async (c: HTMLElement) => {
  const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["x"], "a.csv");
  await act(async () => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
};
const laterBtn = (c: HTMLElement, text: string) =>
  [...c.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;

test("Later finishes and marks upload done", async () => {
  const { c, saved, onFinish } = mount(fromScreen("invested"));
  expect(h1(c)).toBe("Do you want to add your bank statement?");
  await act(async () => laterBtn(c, "Later").click());
  expect(saved().current.intake.lastScreen).toBe("upload");
  expect(onFinish).toHaveBeenCalledTimes(1);
});

test("successful import shows the count then finishes", async () => {
  const onImport = vi.fn(async () => ({ ok: true as const, count: 12 }));
  const { c, saved, onFinish } = mount(fromScreen("invested"), undefined, false, onImport);
  await pickFile(c);
  expect(onImport).toHaveBeenCalledTimes(1);
  expect(c.textContent).toContain("12 transactions added");
  expect(onFinish).not.toHaveBeenCalled();
  await act(async () => laterBtn(c, "Go to your plan").click());
  expect(saved().current.intake.lastScreen).toBe("upload");
  expect(onFinish).toHaveBeenCalledTimes(1);
});

test("count 0 shows nothingNew and still finishes", async () => {
  const onImport = vi.fn(async () => ({ ok: true as const, count: 0 }));
  const { c, onFinish } = mount(fromScreen("invested"), undefined, false, onImport);
  await pickFile(c);
  expect(c.textContent).toContain("These transactions were already in.");
  expect(c.textContent).not.toContain("transactions added");
  await act(async () => laterBtn(c, "Go to your plan").click());
  expect(onFinish).toHaveBeenCalledTimes(1);
});

test("failed import stays on upload", async () => {
  const onImport = vi.fn(async () => ({ ok: false as const }));
  const { c, onFinish, onSave } = mount(fromScreen("invested"), undefined, false, onImport);
  await pickFile(c);
  expect(c.querySelector('[role="alert"]')!.textContent).toBe("We could not read this file.");
  expect(h1(c)).toBe("Do you want to add your bank statement?");
  expect(onFinish).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});

test("reopening a half-done store resumes at the saved screen", () => {
  let s = emptyProfileStore(NOW());
  s = {
    ...s,
    current: markDone(
      applyHousehold(s.current, { kind: "alone" }, AS_OF),
      "spend",
    ),
  };
  const { c } = mount(s);
  expect(h1(c)).toBe("Do you rent or own, and what does it cost per month?");
});

test("no rendered screen contains advice language", () => {
  const base = emptyProfileStore(NOW()).current;
  const filled = applyChildren(
    applyHousehold(
      base,
      { kind: "together", partnerIncomeInScope: true },
      AS_OF,
    ),
    [{ id: "c1", birthYear: 2015 }],
    AS_OF,
  );
  const all = screensFor(filled);
  expect(all.length).toBe(22);
  for (const lang of ["en", "nl"] as const) {
    document.cookie = `lavega_locale=${lang}`;
    all.forEach((id, i) => {
      const current = i === 0 ? filled : markDone(filled, all[i - 1]!);
      const { c } = mount({ ...emptyProfileStore(NOW()), current });
      expect(c.querySelector("h1")!.textContent, `${lang} ${id}`).not.toBe("");
      expect(
        findAdviceLanguage(document.body.textContent ?? "", lang),
        `${lang} ${id}`,
      ).toEqual([]);
      act(() => root!.unmount());
      el!.remove();
      root = null;
    });
  }
});

const inputs = (c: HTMLElement) => [
  ...c.querySelectorAll<HTMLInputElement>("input"),
];
const backBtn = (c: HTMLElement) =>
  c.querySelector<HTMLButtonElement>(".wz-back")!;
const fromScreen = (
  id: Parameters<typeof markDone>[1],
  f = (p: AdvisorProfileStore["current"]) => p,
) => {
  const s = emptyProfileStore(NOW());
  return { ...s, current: markDone(f(s.current), id) };
};

test("Nee after Ja removes the wizard debt", async () => {
  const { c, saved } = mount(fromScreen("goal"));
  await tap(c, "Yes");
  await type(inputs(c)[0]!, "Bank");
  await type(inputs(c)[1]!, "100");
  await act(async () => nextBtn(c).click());
  expect(saved().current.debts?.map((d) => d.id)).toEqual(["wizard-debt"]);
  await act(async () => backBtn(c).click());
  await act(async () => backBtn(c).click());
  await tap(c, "No");
  expect(saved().current.debts ?? []).toEqual([]);
  expect(saved().current.intake.noUserDebts).toBe(true);
});

test("Back and resave of the goal replaces wizard-goal and leaves other goals alone", async () => {
  const old = {
    id: "old",
    purpose: "Old",
    kind: "general" as const,
    targetCents: 100,
    targetDate: "2030-01-01",
    priority: "must" as const,
    accountRefs: [],
  };
  const { c, saved } = mount(
    fromScreen("cards", (p) => applyGoals(p, [old], AS_OF)),
  );
  expect(inputs(c)[0]!.value).toBe("");
  await type(inputs(c)[0]!, "Holiday");
  await type(inputs(c)[1]!, "2000");
  await type(inputs(c)[2]!, "2027-06-01");
  await act(async () => nextBtn(c).click());
  await act(async () => backBtn(c).click());
  expect(inputs(c)[0]!.value).toBe("Holiday");
  await type(inputs(c)[0]!, "Trip");
  await act(async () => nextBtn(c).click());
  const goals = saved().current.goals!.map((g) => g.value);
  expect(goals.map((g) => [g.id, g.purpose])).toEqual([
    ["old", "Old"],
    ["wizard-goal", "Trip"],
  ]);
});

test("a corrupt store shows the notice", () => {
  const { c } = mount(null, undefined, true);
  expect(c.querySelector('[role="status"]')).not.toBeNull();
});

test("a child row can be removed but one stays", async () => {
  const { c, saved } = mount(
    fromScreen("children", (p) =>
      applyChildren(p, [{ id: "a", birthYear: 2015 }], AS_OF),
    ),
  );
  expect(h1(c)).toBe("What year were they born?");
  expect(c.querySelectorAll(".wz-link").length).toBe(1);
  await act(async () =>
    c.querySelector<HTMLButtonElement>(".wz-link")!.click(),
  );
  expect(inputs(c).length).toBe(2);
  await type(inputs(c)[1]!, "2018");
  const remove = [...c.querySelectorAll<HTMLButtonElement>(".wz-link")].find(
    (b) => b.textContent === "Remove child 1",
  )!;
  await act(async () => remove.click());
  expect(inputs(c).length).toBe(1);
  expect(
    [...c.querySelectorAll(".wz-link")].some((b) =>
      b.textContent?.startsWith("Remove"),
    ),
  ).toBe(false);
  await act(async () => nextBtn(c).click());
  expect(saved().current.children?.value.map((k) => k.birthYear)).toEqual([
    2018,
  ]);
});

const submitForm = (c: HTMLElement) =>
  act(async () => {
    c.querySelector<HTMLFormElement>("form")!.requestSubmit();
  });

const confirmedDebt = {
  id: "wizard-debt",
  lender: "DUO",
  monthlyCents: 10000,
  balanceCents: 500000,
  ratePct: 2,
  source: "confirmed" as const,
  at: "2026-09-01",
};
const withDebt = (p: AdvisorProfileStore["current"]) => ({
  ...p,
  debts: [confirmedDebt],
});

test("S1: re-saving a plan-confirmed wizard debt keeps one debt and its balance and rate", async () => {
  const { c, saved } = mount(fromScreen("goal", withDebt));
  await tap(c, "Yes");
  expect(inputs(c)[0]!.value).toBe("DUO");
  await type(inputs(c)[1]!, "120");
  await act(async () => nextBtn(c).click());
  const debts = saved().current.debts!;
  expect(debts).toHaveLength(1);
  expect(debts[0]).toMatchObject({
    id: "wizard-debt",
    monthlyCents: 12000,
    balanceCents: 500000,
    ratePct: 2,
  });
});

test("S1: Nee removes the wizard debt even when the plan confirmed it", async () => {
  const { c, saved } = mount(fromScreen("goal", withDebt));
  await tap(c, "No");
  expect(saved().current.debts ?? []).toEqual([]);
  expect(saved().current.intake.noUserDebts).toBe(true);
});

test("S2: saving the goal screen leaves another goal's at and source untouched", async () => {
  const other = {
    id: "old",
    purpose: "Old",
    kind: "general" as const,
    targetCents: 100,
    targetDate: "2030-01-01",
    priority: "must" as const,
    accountRefs: [],
  };
  const { c, saved } = mount(
    fromScreen("cards", (p) => ({
      ...p,
      goals: [{ value: other, source: "confirmed" as const, at: "2026-01-05" }],
    })),
  );
  await type(inputs(c)[0]!, "Holiday");
  await type(inputs(c)[1]!, "2000");
  await type(inputs(c)[2]!, "2027-06-01");
  await act(async () => nextBtn(c).click());
  const goals = saved().current.goals!;
  expect(goals[0]).toEqual({
    value: other,
    source: "confirmed",
    at: "2026-01-05",
  });
  expect(goals.find((g) => g.value.id === "wizard-goal")).toMatchObject({
    source: "stated",
    at: AS_OF,
  });
});

test("S3: submitting the form (Enter) advances an amount screen", async () => {
  const { c, saved } = mount();
  await tap(c, "Alone");
  await pickWork(c);
  await tap(c, "No");
  await type(c.querySelector("input")!, "3250");
  await submitForm(c);
  expect(saved().current.statedRanges?.value?.income?.lowCents).toBe(325000);
  expect(counter(c)).toBe("5 / 21");
});

test("S3: Enter does nothing while Verder is disabled", async () => {
  const { c, onSave } = mount();
  await tap(c, "Alone");
  await pickWork(c);
  await tap(c, "No");
  const before = onSave.mock.calls.length;
  await submitForm(c);
  expect(onSave.mock.calls.length).toBe(before);
});

test("S4: spend accepts 0, income does not", async () => {
  const { c, saved } = mount();
  await tap(c, "Alone");
  await pickWork(c);
  await tap(c, "No");
  await type(c.querySelector("input")!, "0");
  expect(nextBtn(c).disabled).toBe(true);
  await type(c.querySelector("input")!, "3000");
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe("About how much do you spend per month?");
  await type(c.querySelector("input")!, "0");
  expect(nextBtn(c).disabled).toBe(false);
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedRanges?.value?.spend).toEqual({
    lowCents: 0,
    highCents: 0,
  });
});

test("work requires one pick and saves all picks", async () => {
  const { c, saved } = mount(fromScreen("household"));
  expect(h1(c)).toBe("What kind of work do you do?");
  expect(nextBtn(c).disabled).toBe(true);
  await act(async () => box(c, "Student").click());
  await act(async () => box(c, "Freelance / self-employed").click());
  expect(nextBtn(c).disabled).toBe(false);
  await act(async () => nextBtn(c).click());
  expect(saved().current.work).toEqual({
    value: ["freelance", "student"],
    source: "stated",
    at: AS_OF,
  });
  expect(h1(c)).toBe("Do you charge your clients VAT?");
});

test("freelance work asks the VAT question once; Yes is stored and the wizard moves on", async () => {
  const { c, saved } = mount(fromScreen("household"));
  await act(async () => box(c, "Freelance / self-employed").click());
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe("Do you charge your clients VAT?");
  await tap(c, "Yes");
  expect(saved().current.chargesVat).toEqual({ value: true, source: "stated", at: AS_OF });
  expect(h1(c)).toBe("Do you have children?");
});

test("employed-only work skips the VAT question", async () => {
  const { c, saved } = mount(fromScreen("household"));
  await act(async () => box(c, "Employed").click());
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe("Do you have children?");
  expect(saved().current.chargesVat).toBeUndefined();
});

const spendScreen = () => fromScreen("income");
const link = (c: HTMLElement, text: string) =>
  [...c.querySelectorAll<HTMLButtonElement>(".wz-link")].find(
    (b) => b.textContent === text,
  )!;

test("spend band saves its range and advances", async () => {
  const { c, saved } = mount(spendScreen());
  expect(h1(c)).toBe("About how much do you spend per month?");
  await act(async () => link(c, "I don't know").click());
  expect(c.querySelectorAll('[role="radio"]').length).toBe(5);
  await tap(c, "€2,500 – €3,500");
  expect(saved().current.statedRanges?.value?.spend).toEqual({
    lowCents: 250000,
    highCents: 350000,
  });
  expect(h1(c)).toBe("Do you rent or own, and what does it cost per month?");
});

test("band then exact amount replaces the range (and the reverse)", async () => {
  const { c, saved } = mount(spendScreen());
  await act(async () => link(c, "I don't know").click());
  await tap(c, "€2,500 – €3,500");
  await act(async () => backBtn(c).click());
  expect(tile(c, "€2,500 – €3,500").getAttribute("aria-checked")).toBe("true");
  await act(async () => link(c, "Enter an amount instead").click());
  await type(c.querySelector("input")!, "1800");
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedRanges?.value?.spend).toEqual({
    lowCents: 180000,
    highCents: 180000,
  });
  await act(async () => backBtn(c).click());
  expect(c.querySelector("input")!.value).not.toBe("");
  await act(async () => link(c, "I don't know").click());
  await tap(c, "€1,500 – €2,500");
  expect(saved().current.statedRanges?.value?.spend).toEqual({
    lowCents: 150000,
    highCents: 250000,
  });
});

const searchInput = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type="search"]')!;
const boxes = (c: HTMLElement) => [...c.querySelectorAll('[role="checkbox"]')];

const brandTile = (c: HTMLElement, text: RegExp) =>
  [...c.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((b) =>
    text.test(b.textContent ?? ""),
  )!;
const openBrand = (c: HTMLElement, text: RegExp) => act(async () => brandTile(c, text).click());

test("search swaps the brand tiles for a narrowed flat list", async () => {
  const { c } = mount(fromScreen("debit-cards"));
  expect(h1(c)).toBe("Do you have a credit card?");
  await tap(c, "Yes");
  expect(h1(c)).toBe("Which credit cards do you have?");
  expect(c.querySelectorAll("button[aria-expanded]").length).toBeGreaterThan(5);
  expect(boxes(c).length).toBe(1);
  await type(searchInput(c), "american express gold");
  const after = boxes(c)
    .map((b) => b.textContent)
    .filter((t) => t !== "Another card");
  expect(c.querySelectorAll("button[aria-expanded]").length).toBe(0);
  expect(after.every((t) => /american express gold/i.test(t ?? ""))).toBe(true);
  expect(after.length).toBeGreaterThan(0);
});

test("cards saves the picked ids", async () => {
  const { c, saved } = mount(fromScreen("debit-cards"));
  await tap(c, "Yes");
  expect(nextBtn(c).disabled).toBe(true);
  await openBrand(c, /^ING/);
  await act(async () => box(c, "ING creditcard").click());
  await act(async () => box(c, "Another card").click());
  expect(nextBtn(c).disabled).toBe(false);
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedCards).toEqual({
    value: ["ing-creditcard", "other"],
    source: "stated",
    at: AS_OF,
  });
  expect(saved().current.intake.noCards).toBe(false);
});

test("search 'amex' finds the American Express cards and keeps 'Another card' listed", async () => {
  const { c } = mount(fromScreen("debit-cards"));
  await tap(c, "Yes");
  await type(searchInput(c), "amex");
  const labels = boxes(c).map((b) => b.textContent ?? "");
  expect(labels.filter((t) => /american express/i.test(t)).length).toBeGreaterThan(3);
  expect(labels).toContain("Another card");
  expect(c.textContent).not.toContain("No card found");
});

test("opening American Express in the wizard lists its business and corporate cards", async () => {
  const { c } = mount(fromScreen("debit-cards"));
  await tap(c, "Yes");
  await openBrand(c, /American Express/);
  const labels = boxes(c).map((b) => b.textContent ?? "");
  for (const n of ["Blue Card", "Gold Card", "Platinum Card", "Business Gold Card", "Corporate Card"])
    expect(labels).toContain(`American Express ${n}`);
});

test("a query nothing matches says so and still offers 'Another card'", async () => {
  const { c } = mount(fromScreen("debit-cards"));
  await tap(c, "Yes");
  await type(searchInput(c), "zzzzqq");
  expect(boxes(c).map((b) => b.textContent)).toEqual(["Another card"]);
  expect(c.textContent).toContain("No card found");
});

test("a stored card id the catalogue no longer holds survives a resubmit", async () => {
  const { c, saved } = mount(
    fromScreen("debit-cards", (p) => applyStatedCards(p, ["gone-card"], AS_OF)),
  );
  await tap(c, "Yes");
  expect(nextBtn(c).disabled).toBe(false);
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedCards?.value).toEqual(["gone-card"]);
});

test("after Ja then Back, the Ja tile is still selected", async () => {
  const { c } = mount(fromScreen("debit-cards"));
  await tap(c, "Yes");
  await act(async () => backBtn(c).click());
  expect(tile(c, "Yes").getAttribute("aria-checked")).toBe("true");
});

test("Nee after picks stores an empty stated list", async () => {
  const { c, saved } = mount(fromScreen("debit-cards"));
  await tap(c, "Yes");
  await openBrand(c, /^ING/);
  await act(async () => box(c, "ING creditcard").click());
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedCards?.value).toEqual(["ing-creditcard"]);
  await act(async () => backBtn(c).click());
  await act(async () => backBtn(c).click());
  await tap(c, "No");
  expect(saved().current.statedCards).toEqual({ value: [], source: "stated", at: AS_OF });
  expect(saved().current.intake.noCards).toBe(true);
});

test("debit-cards screen: Revolut tiles, needs one pick, saves ids, then asks for a credit card", async () => {
  const { c, saved } = mount(fromScreen("savings"));
  expect(h1(c)).toBe("Which debit cards do you have?");
  expect(nextBtn(c).disabled).toBe(true);
  await openBrand(c, /Revolut/);
  expect(boxes(c).map((b) => b.textContent)).toEqual([
    "Revolut Metal betaalpas",
    "Revolut Plus betaalpas",
    "Revolut Premium betaalpas",
    "Revolut Standard betaalpas",
    "Another card",
  ]);
  await act(async () => box(c, "Revolut Standard betaalpas").click());
  await act(async () => box(c, "Revolut Plus betaalpas").click());
  expect(nextBtn(c).disabled).toBe(false);
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedDebitCards).toEqual({
    value: ["revolut-plus-betaalpas", "revolut-standard-betaalpas"],
    source: "stated",
    at: AS_OF,
  });
  expect(saved().current.intake.lastScreen).toBe("debit-cards");
  expect(h1(c)).toBe("Do you have a credit card?");
});

test("debit-cards screen prefills from the profile", async () => {
  const { c } = mount(
    fromScreen("savings", (p) => applyStatedDebitCards(p, ["ing-betaalpas"], AS_OF)),
  );
  expect(nextBtn(c).disabled).toBe(false);
  expect(brandTile(c, /^ING/).textContent).toContain("1 selected");
});

test("exact mode prefills only an exact stored spend, never a band", async () => {
  const { c } = mount(spendScreen());
  await act(async () => link(c, "I don't know").click());
  await tap(c, "€2,500 – €3,500");
  await act(async () => backBtn(c).click());
  await act(async () => link(c, "Enter an amount instead").click());
  expect(c.querySelector("input")!.value).toBe("");
});
