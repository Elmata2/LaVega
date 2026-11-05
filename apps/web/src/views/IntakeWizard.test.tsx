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
import { wizardCopy } from "../copy/wizard";
import {
  applyBirthYear,
  applyCheckInCadence,
  applyConfidence,
  applyCutTargets,
  applyChildren,
  applyForeignSpend,
  applyGoals,
  applyIncomeRegularity,
  applyKnowledge,
  applyPriorities,
  applySpendMix,
  applyStatedBanks,
  applyHousehold,
  applyStatedCards,
  applyStatedRange,
  applyWork,
  applyStatedDebitCards,
  applyStatedHousing,
} from "../intake/state";
import { inviteState } from "../components/blocks/IntakeInviteCard";
import { isAnswered, isFinishedIntake, markDone, resumeScreen, screensFor } from "../intake/wizard/screens";

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
/** Pick a tile and press Verder, which is how every screen moves on. On a
 *  screen that still needs more input, Verder is disabled and nothing moves. */
async function tap(c: HTMLElement, text: string) {
  await act(async () => tile(c, text).click());
  await act(async () => nextBtn(c).click());
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
async function birth(c: HTMLElement, year = "1990") {
  await type(c.querySelector("input")!, year);
  await act(async () => nextBtn(c).click());
}
/** Alone, born 1990, employed, fixed income, no children: lands on income. */
async function reachIncome(c: HTMLElement) {
  await tap(c, "Alone");
  await birth(c);
  await pickWork(c);
  await tap(c, "Yes, the same every month");
  await tap(c, "No");
}

test("fresh store opens on household and shows 1 / 28", () => {
  const { c } = mount();
  expect(counter(c)).toBe("1 / 28");
  expect(h1(c)).toBe("Do you live alone or together?");
});

test("picking a tile only selects it; Verder saves and moves on", async () => {
  const { c, onSave } = mount();
  await act(async () => tile(c, "Together").click());
  expect(tile(c, "Together").getAttribute("aria-checked")).toBe("true");
  expect(onSave).not.toHaveBeenCalled();
  expect(counter(c)).toBe("1 / 28");
  await act(async () => nextBtn(c).click());
  expect(onSave).toHaveBeenCalled();
  expect(counter(c)).toBe("2 / 29");
});

test("Verder is disabled on a choice screen until something is picked", () => {
  const { c } = mount();
  expect(nextBtn(c).disabled).toBe(true);
});

test("tapping Samen saves household together with partnerIncomeInScope and words income for the household", async () => {
  const { c, saved } = mount();
  await tap(c, "Together");
  expect(saved().current.household?.value).toEqual({
    kind: "together",
    partnerIncomeInScope: true,
  });
  expect(counter(c)).toBe("2 / 29");
  await tap(c, "Shared");
  await birth(c);
  await pickWork(c);
  await tap(c, "Yes, the same every month");
  await tap(c, "No");
  expect(h1(c)).toBe("What do you earn together, net per month?");
});

test("income Verder is disabled when empty and saves a zero-width range", async () => {
  const { c, saved } = mount();
  await reachIncome(c);
  expect(h1(c)).toBe("What do you earn, net per month?");
  expect(nextBtn(c).disabled).toBe(true);
  await type(c.querySelector("input")!, "3250");
  expect(nextBtn(c).disabled).toBe(false);
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedRanges?.value?.income).toEqual({
    lowCents: 325000,
    highCents: 325000,
  });
  expect(counter(c)).toBe("7 / 27");
});

test("Nee on children skips child-years and the counter shows 21", async () => {
  const { c } = mount();
  await reachIncome(c);
  expect(counter(c)).toBe("6 / 27");
  expect(h1(c)).toBe("What do you earn, net per month?");
});

test("Ja on children goes to child-years, and Back then Ja again still does", async () => {
  const { c } = mount();
  await reachIncome(c);
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
  expect(h1(c)).toBe("What year were you born?");
  expect(c.querySelector('[role="alert"]')).toBeNull();
});

test("goal with a past date cannot be saved; Nog geen doel advances without a goal", async () => {
  let s = emptyProfileStore(NOW());
  s = { ...s, current: markAt(s.current, "foreign-spend") };
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
  s = { ...s, current: markAt(s.current, "buffer") };
  const { c, saved, onFinish } = mount(s);
  for (const item of RISK_SCALE.items) {
    expect(h1(c)).not.toBe("");
    const first = c.querySelector<HTMLButtonElement>('[role="radio"]')!;
    await act(async () => first.click());
    await act(async () => nextBtn(c).click());
    expect(saved().current.risk?.answers?.[item.id]).toBe(item.options[0]!.id);
  }
  expect(h1(c)).toContain("invested before");
  expect(onFinish).not.toHaveBeenCalled();
  await act(async () =>
    c.querySelectorAll<HTMLButtonElement>('[role="radio"]')[0]!.click(),
  );
  await act(async () => nextBtn(c).click());
  expect(saved().current.intake.blocksDone).toBe(3);
  expect(onFinish).not.toHaveBeenCalled();
  expect(h1(c)).toBe("What do you want LaVega to help you with?");
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
  const { c, saved, onFinish } = mount(fromScreen("summary"));
  expect(h1(c)).toBe("Do you want to add your bank statement?");
  await act(async () => laterBtn(c, "Later").click());
  expect(saved().current.intake.lastScreen).toBe("upload");
  expect(onFinish).toHaveBeenCalledTimes(1);
});

test("successful import shows the count then finishes", async () => {
  const onImport = vi.fn(async () => ({ ok: true as const, count: 12 }));
  const { c, saved, onFinish } = mount(fromScreen("summary"), undefined, false, onImport);
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
  const { c, onFinish } = mount(fromScreen("summary"), undefined, false, onImport);
  await pickFile(c);
  expect(c.textContent).toContain("These transactions were already in.");
  expect(c.textContent).not.toContain("transactions added");
  await act(async () => laterBtn(c, "Go to your plan").click());
  expect(onFinish).toHaveBeenCalledTimes(1);
});

test("failed import stays on upload", async () => {
  const onImport = vi.fn(async () => ({ ok: false as const }));
  const { c, onFinish, onSave } = mount(fromScreen("summary"), undefined, false, onImport);
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
    current: markAt(
      applyHousehold(s.current, { kind: "alone" }, AS_OF),
      "spend",
    ),
  };
  const { c } = mount(s);
  expect(h1(c)).toBe("What does housing cost you per month?");
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
  expect(all.length).toBe(29);
  for (const lang of ["en", "nl"] as const) {
    document.cookie = `lavega_locale=${lang}`;
    all.forEach((id, i) => {
      const current = i === 0 ? filled : markAt(filled, all[i - 1]!);
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
/** The round-1 answers a user who walked the wizard up to `id` has given. A
 *  profile that skipped them would be sent back to them on resume. */
const NEW_ANSWERS: Partial<
  Record<Parameters<typeof markDone>[1], (p: AdvisorProfileStore["current"]) => AdvisorProfileStore["current"]>
> = {
  "birth-year": (p) => applyBirthYear(p, 1990, AS_OF),
  "income-regularity": (p) => applyIncomeRegularity(p, "fixed", AS_OF),
  banks: (p) => applyStatedBanks(p, ["other"], AS_OF),
  "spend-mix": (p) => applySpendMix(p, ["groceries"], AS_OF),
  "foreign-spend": (p) => applyForeignSpend(p, "never", AS_OF),
  priorities: (p) => applyPriorities(p, ["save-more"], AS_OF),
};
const answeredBefore = (p: AdvisorProfileStore["current"], id: Parameters<typeof markDone>[1]) => {
  const order = screensFor(p);
  // card-repayment is not in the order of a profile without a stated card.
  const at = id === "card-repayment" ? order.indexOf("spend-mix") - 1 : order.indexOf(id);
  return order
    .slice(0, at + 1)
    .reduce((acc, s) => (isAnswered(acc, s) ? acc : (NEW_ANSWERS[s]?.(acc) ?? acc)), p);
};
const markAt = (p: AdvisorProfileStore["current"], id: Parameters<typeof markDone>[1]) =>
  markDone(answeredBefore(p, id), id);
const fromScreen = (
  id: Parameters<typeof markDone>[1],
  f = (p: AdvisorProfileStore["current"]) => p,
) => {
  const s = emptyProfileStore(NOW());
  const p = f(s.current);
  return { ...s, current: markAt(p, id) };
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
    fromScreen("foreign-spend", (p) => applyGoals(p, [old], AS_OF)),
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
    fromScreen("foreign-spend", (p) => ({
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
  await reachIncome(c);
  await type(c.querySelector("input")!, "3250");
  await submitForm(c);
  expect(saved().current.statedRanges?.value?.income?.lowCents).toBe(325000);
  expect(counter(c)).toBe("7 / 27");
});

test("S3: Enter does nothing while Verder is disabled", async () => {
  const { c, onSave } = mount();
  await reachIncome(c);
  const before = onSave.mock.calls.length;
  await submitForm(c);
  expect(onSave.mock.calls.length).toBe(before);
});

test("S4: spend accepts 0, income does not", async () => {
  const { c, saved } = mount();
  await reachIncome(c);
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

test("the birth year field shows an example and sits on an underline", async () => {
  const { c } = mount();
  await tap(c, "Alone");
  expect(h1(c)).toBe("What year were you born?");
  const input = c.querySelector("input")!;
  expect(input.getAttribute("placeholder")).toBe("e.g. 1990");
  expect(input.parentElement!.className).toContain("wz-amount-row");
});

test("work requires one pick and saves all picks", async () => {
  const { c, saved } = mount(fromScreen("birth-year"));
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
  const { c, saved } = mount(fromScreen("birth-year"));
  await act(async () => box(c, "Freelance / self-employed").click());
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe("Do you charge your clients VAT?");
  await tap(c, "Yes");
  expect(saved().current.chargesVat).toEqual({ value: true, source: "stated", at: AS_OF });
  expect(h1(c)).toBe("Is your income the same every month?");
});

test("employed-only work skips the VAT question", async () => {
  const { c, saved } = mount(fromScreen("birth-year"));
  await act(async () => box(c, "Employed").click());
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe("Is your income the same every month?");
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
  expect(h1(c)).toBe("What does housing cost you per month?");
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
  expect(h1(c)).toBe("Which credit cards do you have?");
  expect(c.querySelectorAll("button[aria-expanded]").length).toBeGreaterThan(5);
  expect(boxes(c).length).toBe(2);
  await type(searchInput(c), "american express gold");
  const after = boxes(c)
    .map((b) => b.textContent)
    .filter((t) => t !== "Another card" && t !== "I have none");
  expect(c.querySelectorAll("button[aria-expanded]").length).toBe(0);
  expect(after.every((t) => /american express gold/i.test(t ?? ""))).toBe(true);
  expect(after.length).toBeGreaterThan(0);
});

test("cards saves the picked ids", async () => {
  const { c, saved } = mount(fromScreen("debit-cards"));
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
  await type(searchInput(c), "amex");
  const labels = boxes(c).map((b) => b.textContent ?? "");
  expect(labels.filter((t) => /american express/i.test(t)).length).toBeGreaterThan(3);
  expect(labels).toContain("Another card");
  expect(c.textContent).not.toContain("No card found");
});

test("opening American Express in the wizard lists its business and corporate cards", async () => {
  const { c } = mount(fromScreen("debit-cards"));
  await openBrand(c, /American Express/);
  const labels = boxes(c).map((b) => b.textContent ?? "");
  for (const n of ["Blue Card", "Gold Card", "Platinum Card", "Business Gold Card", "Corporate Card"])
    expect(labels).toContain(`American Express ${n}`);
});

test("a query nothing matches says so and still offers 'Another card'", async () => {
  const { c } = mount(fromScreen("debit-cards"));
  await type(searchInput(c), "zzzzqq");
  expect(boxes(c).map((b) => b.textContent)).toEqual(["Another card", "I have none"]);
  expect(c.textContent).toContain("No card found");
});

test("a stored card id the catalogue no longer holds survives a resubmit", async () => {
  const { c, saved } = mount(
    fromScreen("debit-cards", (p) => applyStatedCards(p, ["gone-card"], AS_OF)),
  );
  expect(nextBtn(c).disabled).toBe(false);
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedCards?.value).toEqual(["gone-card"]);
});

test("None on cards stores an empty stated list and skips card-repayment", async () => {
  const { c, saved } = mount(fromScreen("debit-cards"));
  expect(nextBtn(c).disabled).toBe(true);
  await act(async () => box(c, "I have none").click());
  expect(nextBtn(c).disabled).toBe(false);
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedCards).toEqual({ value: [], source: "stated", at: AS_OF });
  expect(saved().current.intake.noCards).toBe(true);
  expect(h1(c)).toBe("Where does most of your money go?");
});

test("a picked card goes on to card-repayment", async () => {
  const { c } = mount(fromScreen("debit-cards"));
  await openBrand(c, /^ING/);
  await act(async () => box(c, "ING creditcard").click());
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe("Do you pay off your credit card in full every month?");
});

test("None clears picked cards and a card pick clears None", async () => {
  const { c } = mount(fromScreen("debit-cards"));
  await openBrand(c, /^ING/);
  await act(async () => box(c, "ING creditcard").click());
  await act(async () => box(c, "I have none").click());
  expect(box(c, "I have none").getAttribute("aria-checked")).toBe("true");
  expect(box(c, "ING creditcard").getAttribute("aria-checked")).toBe("false");
  await act(async () => box(c, "ING creditcard").click());
  expect(box(c, "I have none").getAttribute("aria-checked")).toBe("false");
});

test("debit-cards screen: Revolut tiles, needs one pick, saves ids, then asks for a credit card", async () => {
  const { c, saved } = mount(fromScreen("banks"));
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
  expect(h1(c)).toBe("Which credit cards do you have?");
});

test("debit-cards screen prefills from the profile", async () => {
  const { c } = mount(
    fromScreen("banks", (p) => applyStatedDebitCards(p, ["ing-betaalpas"], AS_OF)),
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

test("together then shared stores moneySharing", async () => {
  const { c, saved } = mount();
  await tap(c, "Together");
  expect(h1(c)).toBe("Do you share your money?");
  await tap(c, "Partly shared");
  expect(saved().current.household?.value).toEqual({
    kind: "together",
    partnerIncomeInScope: true,
    moneySharing: "mixed",
  });
  expect(h1(c)).toBe("What year were you born?");
});

test("Together again after Back keeps the money-sharing answer", async () => {
  const { c, saved } = mount();
  await tap(c, "Together");
  await tap(c, "Shared");
  await act(async () => backBtn(c).click());
  await act(async () => backBtn(c).click());
  await tap(c, "Together");
  expect(saved().current.household?.value.moneySharing).toBe("shared");
});

test("birth year 1890 keeps Verder disabled; 1990 saves", async () => {
  const { c, saved } = mount(fromScreen("household"));
  expect(h1(c)).toBe("What year were you born?");
  expect(nextBtn(c).disabled).toBe(true);
  await type(c.querySelector("input")!, "1890");
  expect(nextBtn(c).disabled).toBe(true);
  await type(c.querySelector("input")!, "2025");
  expect(nextBtn(c).disabled).toBe(true);
  await type(c.querySelector("input")!, "1990");
  expect(nextBtn(c).disabled).toBe(false);
  await act(async () => nextBtn(c).click());
  expect(saved().current.birthYear).toEqual({ value: 1990, source: "stated", at: AS_OF });
  expect(h1(c)).toBe("What kind of work do you do?");
});

test("income regularity saves and moves on", async () => {
  const { c, saved } = mount(fromScreen("work"));
  expect(h1(c)).toBe("Is your income the same every month?");
  await tap(c, "No, it varies");
  expect(saved().current.incomeRegularity?.value).toBe("varies");
  expect(h1(c)).toBe("Do you have children?");
});

test("housing asks only an amount and keeps an existing kind", async () => {
  const { c, saved } = mount(fromScreen("spend"));
  expect(h1(c)).toBe("What does housing cost you per month?");
  expect(c.querySelector(".wz-hint")!.textContent).toBe("Rent or mortgage, including service costs");
  expect(c.querySelectorAll('[role="radio"]').length).toBe(0);
  await type(c.querySelector("input")!, "1200");
  await act(async () => nextBtn(c).click());
  expect(saved().current.housing?.value).toEqual({ kind: "other", monthlyCents: 120000 });
  const again = mount(
    fromScreen("spend", (p) => applyStatedHousing(p, "rent", 90000, AS_OF)),
  );
  expect(inputs(again.c)[0]!.value).not.toBe("");
  await type(inputs(again.c)[0]!, "950");
  await act(async () => nextBtn(again.c).click());
  expect(again.saved().current.housing?.value).toEqual({ kind: "rent", monthlyCents: 95000 });
});

test("banks saves picked brand ids", async () => {
  const { c, saved } = mount(fromScreen("savings"));
  expect(h1(c)).toBe("Which banks are you with?");
  expect(nextBtn(c).disabled).toBe(true);
  await act(async () => box(c, "ING").click());
  await act(async () => box(c, "Revolut").click());
  await act(async () => box(c, "Other").click());
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedBanks).toEqual({
    value: ["ing", "revolut", "other"],
    source: "stated",
    at: AS_OF,
  });
  expect(h1(c)).toBe("Which debit cards do you have?");
});

test("card repayment saves", async () => {
  const { c, saved } = mount(
    fromScreen("cards", (p) => applyStatedCards(p, ["ing-creditcard"], AS_OF)),
  );
  await tap(c, "Sometimes not in full");
  expect(saved().current.cardRepayment?.value).toBe("sometimes");
  expect(h1(c)).toBe("Where does most of your money go?");
});

test("spend mix disables a fourth pick", async () => {
  const { c, saved } = mount(fromScreen("card-repayment"));
  expect(h1(c)).toBe("Where does most of your money go?");
  for (const t of ["Groceries", "Travel", "Online shopping"])
    await act(async () => box(c, t).click());
  expect(box(c, "Fuel and transport").disabled).toBe(true);
  expect(box(c, "Groceries").disabled).toBe(false);
  await act(async () => box(c, "Fuel and transport").click());
  expect(box(c, "Fuel and transport").getAttribute("aria-checked")).toBe("false");
  await act(async () => box(c, "Travel").click());
  expect(box(c, "Fuel and transport").disabled).toBe(false);
  await act(async () => box(c, "Eating out").click());
  await act(async () => nextBtn(c).click());
  expect(saved().current.spendMix?.value).toEqual(["groceries", "online", "eating-out"]);
  expect(h1(c)).toBe("Do you ever pay abroad or in another currency?");
});

test("foreign spend saves and ends the about-you section", async () => {
  const { c, saved } = mount(fromScreen("spend-mix"));
  await tap(c, "Often");
  expect(saved().current.foreignSpend?.value).toBe("often");
  expect(saved().current.intake.blocksDone).toBe(1);
  expect(h1(c)).toBe("What are you saving for?");
});

test("priorities needs one pick and saves them; summary then moves on", async () => {
  // Mid-wizard (risk block still open): the invested screen leads to priorities, summary, upload.
  const lastRisk = `risk:${RISK_SCALE.items.at(-1)!.id}` as const;
  const { c, saved } = mount(fromScreen(lastRisk as Parameters<typeof markDone>[1]));
  await tap(c, "No");
  expect(h1(c)).toBe("What do you want LaVega to help you with?");
  expect(nextBtn(c).disabled).toBe(true);
  await act(async () => box(c, "Save more").click());
  await act(async () => box(c, "Spend less").click());
  await act(async () => nextBtn(c).click());
  expect(saved().current.priorities?.value).toEqual(["spend-less", "save-more"]);
  expect(h1(c)).toBe("This is what LaVega knows about you now");
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe("Do you want to add your bank statement?");
});

/** Finished before round 1 existed: blocksDone 3, lastScreen upload, no new answers. */
const finishedOld = (f = (p: AdvisorProfileStore["current"]) => p) => {
  const s = emptyProfileStore(NOW());
  return { ...s, current: markDone(markDone(f(s.current), "invested"), "upload") };
};

test("a finished user runs only the new questions, then the summary, then exits", async () => {
  const { c, saved, onFinish } = mount(finishedOld());
  expect(h1(c)).toBe("What year were you born?");
  expect(counter(c)).toBe("1 / 7");
  await birth(c);
  expect(h1(c)).toBe("Is your income the same every month?");
  expect(counter(c)).toBe("2 / 7");
  await tap(c, "Yes, the same every month");
  expect(counter(c)).toBe("3 / 7");
  await act(async () => box(c, "Other").click());
  await act(async () => nextBtn(c).click());
  await act(async () => box(c, "Groceries").click());
  await act(async () => nextBtn(c).click());
  await tap(c, "Never");
  expect(h1(c)).toBe("What do you want LaVega to help you with?");
  expect(counter(c)).toBe("6 / 7");
  await act(async () => box(c, "Save more").click());
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe("This is what LaVega knows about you now");
  expect(counter(c)).toBe("7 / 7");
  expect(onFinish).not.toHaveBeenCalled();
  await act(async () => nextBtn(c).click());
  expect(onFinish).toHaveBeenCalledTimes(1);
  expect(saved().current.intake.lastScreen).toBe("upload");
  expect(isFinishedIntake(saved().current)).toBe(true);
  expect(resumeScreen(saved().current)).toBe("done");
  expect(inviteState(saved(), AS_OF)).toBeNull();
  expect(c.textContent).not.toContain("bank statement");
});

test("a finished user who stopped at the summary continues to upload (mid-wizard)", async () => {
  const s = emptyProfileStore(NOW());
  const done = applyPriorities(
    applyForeignSpend(
      applySpendMix(
        applyStatedBanks(
          applyIncomeRegularity(applyBirthYear(s.current, 1990, AS_OF), "fixed", AS_OF),
          ["other"],
          AS_OF,
        ),
        ["groceries"],
        AS_OF,
      ),
      "never",
      AS_OF,
    ),
    ["save-more"],
    AS_OF,
  );
  const { c, onFinish } = mount({ ...s, current: markAt(markAt(done, "invested"), "priorities") });
  expect(h1(c)).toBe("This is what LaVega knows about you now");
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe("Do you want to add your bank statement?");
  expect(onFinish).not.toHaveBeenCalled();
});

test("editing outside a finished user's run hides the counter", async () => {
  const { c } = mount(finishedOld((p) => applyHousehold(p, { kind: "alone" }, AS_OF)));
  await birth(c);
  await tap(c, "Yes, the same every month");
  await act(async () => box(c, "Other").click());
  await act(async () => nextBtn(c).click());
  await act(async () => box(c, "Groceries").click());
  await act(async () => nextBtn(c).click());
  await tap(c, "Never");
  await act(async () => box(c, "Save more").click());
  await act(async () => nextBtn(c).click());
  await act(async () => editBtn(c, "household").click());
  expect(h1(c)).toBe("Do you live alone or together?");
  expect(counter(c)).toBe("");
  await act(async () => backBtn(c).click());
  expect(counter(c)).toBe("7 / 7");
});

test("abandoning the run after one answer resumes at the next pending question", async () => {
  const { c, saved } = mount(finishedOld());
  await birth(c);
  const after = saved();
  expect(after.current.intake.lastScreen).toBe("upload");
  expect(resumeScreen(after.current)).toBe("income-regularity");
  expect(inviteState(after, AS_OF)).toEqual({ kind: "new-questions", count: 5 });
});

test("a new user at the summary who edits household and abandons resumes at the summary", async () => {
  const { c, saved } = mount(
    fromScreen("priorities", (p) => applyHousehold(p, { kind: "alone" }, AS_OF)),
  );
  await act(async () => editBtn(c, "household").click());
  await tap(c, "Together");
  expect(h1(c)).not.toBe("Do you live alone or together?");
  expect(saved().current.intake.lastScreen).toBe("priorities");
  // Together adds a question this profile has not answered: resume asks it first.
  expect(resumeScreen(saved().current)).toBe("money-sharing");
});

test("Back inside a finished user's run stays within the new questions", async () => {
  const { c } = mount(finishedOld());
  expect(backBtn(c)).toBeNull();
  await birth(c);
  expect(h1(c)).toBe("Is your income the same every month?");
  await act(async () => backBtn(c).click());
  expect(h1(c)).toBe("What year were you born?");
  expect(backBtn(c)).toBeNull();
});

test("a finished user with lastScreen upload never meets household or the risk block", async () => {
  const { c } = mount(finishedOld((p) => applyHousehold(p, { kind: "alone" }, AS_OF)));
  expect(h1(c)).not.toBe("Do you live alone or together?");
  expect(h1(c)).toBe("What year were you born?");
  expect(c.textContent).not.toContain("risk");
});

test("Wijzig on income opens income and Verder returns to the summary", async () => {
  const { c, saved } = mount(
    fromScreen("priorities", (p) =>
      applyStatedRange(
        applyWork(applyHousehold(p, { kind: "alone" }, AS_OF), ["employed"], AS_OF),
        "income",
        { lowCents: 325000, highCents: 325000 },
        AS_OF,
      ),
    ),
  );
  expect(h1(c)).toBe("This is what LaVega knows about you now");
  expect(c.querySelectorAll(".wz-summary-row")).toHaveLength(9);
  const change = c.querySelector<HTMLButtonElement>('.wz-summary-row button[data-screen="income"]')!;
  await act(async () => change.click());
  expect(h1(c)).toBe("What do you earn, net per month?");
  await type(c.querySelector("input")!, "4000");
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedRanges?.value?.income).toEqual({
    lowCents: 400000,
    highCents: 400000,
  });
  expect(h1(c)).toBe("This is what LaVega knows about you now");
  expect(c.textContent).toContain("4,000");
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe("Do you want to add your bank statement?");
});

test("an edit from the summary keeps lastScreen on priorities", async () => {
  const { c, saved } = mount(
    fromScreen("priorities", (p) =>
      applyStatedRange(
        applyWork(applyHousehold(p, { kind: "alone" }, AS_OF), ["employed"], AS_OF),
        "income",
        { lowCents: 325000, highCents: 325000 },
        AS_OF,
      ),
    ),
  );
  await act(async () =>
    c.querySelector<HTMLButtonElement>('.wz-summary-row button[data-screen="income"]')!.click(),
  );
  await type(c.querySelector("input")!, "4000");
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe("This is what LaVega knows about you now");
  expect(saved().current.statedRanges?.value?.income?.lowCents).toBe(400000);
  expect(saved().current.intake.lastScreen).toBe("priorities");
});

test("the summary has a line for the invested-before answer", async () => {
  const { c } = mount(
    fromScreen("priorities", (p) =>
      applyKnowledge(applyHousehold(p, { kind: "alone" }, AS_OF), {}, true, AS_OF),
    ),
  );
  const row = c.querySelector('.wz-summary-row button[data-screen="invested"]')!.closest(".wz-summary-row")!;
  expect(row.textContent).toContain("Invested before");
  expect(row.textContent).toContain("Yes");
});

test("Back from an edit returns to the summary", async () => {
  const { c } = mount(
    fromScreen("priorities", (p) => applyHousehold(p, { kind: "alone" }, AS_OF)),
  );
  await act(async () =>
    c.querySelector<HTMLButtonElement>('.wz-summary-row button[data-screen="household"]')!.click(),
  );
  expect(h1(c)).toBe("Do you live alone or together?");
  await act(async () => backBtn(c).click());
  expect(h1(c)).toBe("This is what LaVega knows about you now");
});

const editBtn = (c: HTMLElement, screen: string) =>
  c.querySelector<HTMLButtonElement>(`.wz-summary-row button[data-screen="${screen}"]`)!;
const summaryProfile = (p: AdvisorProfileStore["current"]) =>
  applyWork(applyHousehold(p, { kind: "alone" }, AS_OF), ["employed"], AS_OF);

test("editing work to freelance from the summary asks vat, then returns with a vat line", async () => {
  const { c, saved } = mount(fromScreen("priorities", summaryProfile));
  await act(async () => editBtn(c, "work").click());
  await act(async () => box(c, "Employed").click());
  await act(async () => box(c, "Freelance / self-employed").click());
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe(wizardCopy.en.questions.vat);
  await tap(c, "Yes");
  expect(saved().current.chargesVat?.value).toBe(true);
  expect(h1(c)).toBe("This is what LaVega knows about you now");
  expect(editBtn(c, "vat")).not.toBeNull();
});

test("editing household to together asks money sharing, then returns to the summary", async () => {
  const { c } = mount(fromScreen("priorities", summaryProfile));
  await act(async () => editBtn(c, "household").click());
  await tap(c, "Together");
  expect(h1(c)).toBe(wizardCopy.en.questions.moneySharing);
  await tap(c, "Shared");
  expect(h1(c)).toBe("This is what LaVega knows about you now");
});

const incomeRegularityStored = (v: "fixed" | "varies") =>
  (p: AdvisorProfileStore["current"]) => ({
    ...p,
    incomeRegularity: { value: v, source: "stated" as const, at: AS_OF },
  });

test("freelance preselects varies", async () => {
  const { c, saved, onSave } = mount(fromScreen("birth-year"));
  await act(async () => box(c, "Freelance / self-employed").click());
  await act(async () => nextBtn(c).click());
  await tap(c, "Yes");
  expect(h1(c)).toBe("Is your income the same every month?");
  expect(tile(c, "No, it varies").getAttribute("aria-checked")).toBe("true");
  expect(nextBtn(c).disabled).toBe(false);
  const saves = onSave.mock.calls.length;
  expect(saved().current.incomeRegularity).toBeUndefined();
  await act(async () => nextBtn(c).click());
  expect(saved().current.incomeRegularity).toEqual({ value: "varies", source: "stated", at: AS_OF });
  expect(onSave.mock.calls.length).toBe(saves + 1);
});

test("employed does not preselect", async () => {
  const { c } = mount(fromScreen("birth-year"));
  await act(async () => box(c, "Employed").click());
  await act(async () => nextBtn(c).click());
  expect(h1(c)).toBe("Is your income the same every month?");
  expect(nextBtn(c).disabled).toBe(true);
  expect(c.querySelectorAll('[role="radio"][aria-checked="true"]').length).toBe(0);
});

test("a stored fixed answer is not overridden for a freelancer", () => {
  const { c } = mount(
    fromScreen("vat", (p) => ({
      ...incomeRegularityStored("fixed")(p),
      work: { value: ["freelance"], source: "stated" as const, at: AS_OF },
    })),
  );
  expect(h1(c)).toBe("Is your income the same every month?");
  expect(tile(c, "Yes, the same every month").getAttribute("aria-checked")).toBe("true");
  expect(tile(c, "No, it varies").getAttribute("aria-checked")).toBe("false");
});

test("varies preselects 6 months on buffer", () => {
  const { c } = mount(fromScreen("debt-details", incomeRegularityStored("varies")));
  expect(h1(c)).toBe("How many months of buffer do you want in reserve?");
  expect(tile(c, "6 months").getAttribute("aria-checked")).toBe("true");
  expect(nextBtn(c).disabled).toBe(false);
});

test("a stored buffer of 3 stays 3", () => {
  const { c } = mount(
    fromScreen("debt-details", (p) => ({
      ...incomeRegularityStored("varies")(p),
      buffer: { value: { months: 3 }, source: "stated" as const, at: AS_OF },
    })),
  );
  expect(tile(c, "3 months").getAttribute("aria-checked")).toBe("true");
  expect(tile(c, "6 months").getAttribute("aria-checked")).toBe("false");
});

/** Finished round 1 completely, so the only thing left to ask is round 2. */
const finishedAnswered = () => {
  const s = finishedOld();
  return {
    ...s,
    current: applyPriorities(
      applyForeignSpend(
        applySpendMix(
          applyStatedBanks(
            applyIncomeRegularity(applyBirthYear(s.current, 1990, AS_OF), "fixed", AS_OF),
            ["other"],
            AS_OF,
          ),
          ["groceries"],
          AS_OF,
        ),
        "never",
        AS_OF,
      ),
      ["save-more"],
      AS_OF,
    ),
  };
};
function mountRound2(store: AdvisorProfileStore) {
  const onSave = vi.fn(async (_s: AdvisorProfileStore) => {});
  const onFinish = vi.fn();
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  act(() =>
    root!.render(
      <IntakeWizard
        store={store}
        round={2}
        asOf={AS_OF}
        onSave={onSave}
        onImport={async () => ({ ok: true, count: 0 })}
        onFinish={onFinish}
        onExit={() => {}}
        now={NOW}
      />,
    ),
  );
  return { c: el, onSave, onFinish, saved: () => onSave.mock.calls.at(-1)![0] };
}

test("finishing round 2 sets round2Done and leaves lastScreen alone", async () => {
  const start = finishedAnswered();
  const { c, saved, onFinish } = mountRound2(start);
  expect(h1(c)).toBe("Where do you want to spend less first?");
  expect(counter(c)).toBe("1 / 6");
  expect(nextBtn(c).disabled).toBe(true);
  await act(async () => box(c, "Groceries").click());
  await act(async () => nextBtn(c).click());
  await tap(c, "Every week");
  expect(h1(c)).toBe("How much of an overview do you have of your money right now?");
  await tap(c, "I have a fair overview");
  expect(saved().current.confidence?.value).toBe(3);
  expect(h1(c)).toBe("Which points programmes do you collect in?");
  await act(async () => box(c, "Marriott Bonvoy").click());
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedPrograms?.value).toEqual(["Marriott Bonvoy"]);
  await tap(c, "Flights");
  expect(onFinish).not.toHaveBeenCalled();
  expect(saved().current.intake.round2Done).not.toBe(true);
  await tap(c, "1 to 2");
  expect(onFinish).toHaveBeenCalledTimes(1);
  const p = saved().current;
  expect(p.intake.round2Done).toBe(true);
  expect(p.intake.lastScreen).toBe(start.current.intake.lastScreen);
  expect(p.cutTargets?.value).toEqual(["groceries"]);
  expect(p.checkInCadence?.value).toBe("weekly");
  expect(p.pointsGoal?.value).toBe("flights");
  expect(p.flightsPerYear?.value).toBe("1-2");
  expect(inviteState(saved(), AS_OF, true)).toBeNull();
});

test("programs allows none", async () => {
  const s = finishedAnswered();
  const { c, saved } = mountRound2({
    ...s,
    current: applyCutTargets(applyCheckInCadence(applyConfidence(s.current, 2, AS_OF), "daily", AS_OF), ["travel"], AS_OF),
  });
  expect(h1(c)).toBe("Which points programmes do you collect in?");
  expect(nextBtn(c).disabled).toBe(false);
  await act(async () => nextBtn(c).click());
  expect(saved().current.statedPrograms?.value).toEqual([]);
  expect(h1(c)).toBe("What are you collecting points for?");
});

test("abandoning round 2 keeps answers and reopening resumes at the first unanswered screen", async () => {
  const first = mountRound2(finishedAnswered());
  await act(async () => box(first.c, "Travel").click());
  await act(async () => nextBtn(first.c).click());
  await tap(first.c, "Every day");
  const stored = first.saved();
  expect(stored.current.intake.round2Done).not.toBe(true);
  act(() => root!.unmount());
  el!.remove();
  const again = mountRound2(stored);
  expect(h1(again.c)).toBe("How much of an overview do you have of your money right now?");
  expect(counter(again.c)).toBe("3 / 6");
});
