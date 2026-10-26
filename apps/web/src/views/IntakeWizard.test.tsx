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
import { applyChildren, applyGoals, applyHousehold } from "../intake/state";
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
const nextBtn = (c: HTMLElement) =>
  c.querySelector<HTMLButtonElement>(".wz-next")!;

test("fresh store opens on household and shows 1 / 17", () => {
  const { c } = mount();
  expect(counter(c)).toBe("1 / 17");
  expect(h1(c)).toBe("Do you live alone or together?");
});

test("tapping Samen saves household together with partnerIncomeInScope and words income for the household", async () => {
  const { c, saved } = mount();
  await tap(c, "Together");
  expect(saved().current.household?.value).toEqual({
    kind: "together",
    partnerIncomeInScope: true,
  });
  expect(counter(c)).toBe("2 / 17");
  await tap(c, "No");
  expect(h1(c)).toBe("What do you earn together, net per month?");
});

test("income Verder is disabled when empty and saves a zero-width range", async () => {
  const { c, saved } = mount();
  await tap(c, "Alone");
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
  expect(counter(c)).toBe("4 / 16");
});

test("Nee on children skips child-years and the counter shows 16", async () => {
  const { c } = mount();
  await tap(c, "Alone");
  await tap(c, "No");
  expect(counter(c)).toBe("3 / 16");
  expect(h1(c)).toBe("What do you earn, net per month?");
});

test("Ja on children goes to child-years, and Back then Ja again still does", async () => {
  const { c } = mount();
  await tap(c, "Alone");
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
  expect(h1(c)).toBe("Do you have children?");
  expect(c.querySelector('[role="alert"]')).toBeNull();
});

test("goal with a past date cannot be saved; Nog geen doel advances without a goal", async () => {
  let s = emptyProfileStore(NOW());
  s = { ...s, current: markDone(s.current, "savings") };
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
  expect(onFinish).toHaveBeenCalledTimes(1);
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
  expect(all.length).toBe(17);
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
    fromScreen("savings", (p) => applyGoals(p, [old], AS_OF)),
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
    fromScreen("savings", (p) => ({
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
  await tap(c, "No");
  await type(c.querySelector("input")!, "3250");
  await submitForm(c);
  expect(saved().current.statedRanges?.value?.income?.lowCents).toBe(325000);
  expect(counter(c)).toBe("4 / 16");
});

test("S3: Enter does nothing while Verder is disabled", async () => {
  const { c, onSave } = mount();
  await tap(c, "Alone");
  await tap(c, "No");
  const before = onSave.mock.calls.length;
  await submitForm(c);
  expect(onSave.mock.calls.length).toBe(before);
});

test("S4: spend accepts 0, income does not", async () => {
  const { c, saved } = mount();
  await tap(c, "Alone");
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
