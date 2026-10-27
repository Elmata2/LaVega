// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  computePlan,
  emptyPlanPreferences,
  findAdviceLanguage,
  type AdvisorProfileStore,
  type PlanResult,
  type Tx,
} from "@lavega/core";
import { fromAnswersCopy, planFmt } from "../copy/plan/index.js";
import FromAnswers from "./FromAnswers";
import { richPlanInput, richStore } from "./richInput";
import BufferSection from "./sections/BufferSection";
import MonthSection from "./sections/MonthSection";
import type { PlanCtx } from "./sections/types";
import type { UsePlan } from "./usePlan";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-10-24";
let root: Root | null = null;
let container: HTMLElement | null = null;
const setLocale = (l: "nl" | "en") => {
  document.cookie = `lavega_locale=${l}`;
};
beforeEach(() => {
  localStorage.clear();
  setLocale("nl");
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
});
function mount(node: React.ReactNode): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}
const q = (c: ParentNode, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const withProfile = (patch: Record<string, unknown>): AdvisorProfileStore => {
  const store = richStore();
  return {
    ...store,
    current: new (store.current.constructor as new (x: unknown) => typeof store.current)({
      ...store.current,
      ...patch,
    }),
  };
};
const stated = <T,>(value: T) => ({
  value,
  source: "stated",
  at: "2026-10-01",
});

const resultFor = (store: AdvisorProfileStore, noBank = false): PlanResult =>
  computePlan(richPlanInput(store, noBank ? { mapTxs: () => [], accounts: [] } : { asOf: AS_OF }));

function ctxFor(store: AdvisorProfileStore, result: PlanResult): PlanCtx {
  const plan: UsePlan = {
    result,
    preferences: emptyPlanPreferences(),
    events: [],
    changes: {
      changes: [],
      statusChanges: [],
      material: false,
      baseline: false,
    },
    changesSince: null,
    loaded: true,
    stateError: false,
    writeError: false,
    recompute: async () => {},
    setPreference: vi.fn(async () => {}),
    appendPlanEvent: vi.fn(async () => {}),
  };
  return {
    plan,
    asOf: AS_OF,
    accounts: [],
    profile: { store, update: vi.fn(async () => true), saveFailed: false },
    onNavigate: vi.fn(),
  };
}

const answers = {
  household: stated({ kind: "together", partnerIncomeInScope: true }),
  work: stated(["employed", "freelance"]),
  statedRanges: stated({
    income: { lowCents: 450000, highCents: 450000 },
    spend: { lowCents: 350000, highCents: 500000 },
  }),
};

test("no bank data shows stated only", () => {
  const store = withProfile(answers);
  const onNavigate = vi.fn();
  const c = mount(
    <FromAnswers
      store={store}
      hasAccounts={false}
      month={resultFor(store, true).sections.month}
      onNavigate={onNavigate}
    />,
  );
  const t = c.textContent!;
  expect(q(c, "plan-from-answers-income-stated")!.textContent).toBe("€4.500");
  expect(q(c, "plan-from-answers-spend-stated")!.textContent).toBe("€3.500 – €5.000");
  expect(q(c, "plan-from-answers-income-measured")!.textContent).toContain(
    "Nog geen rekeningen gekoppeld of geïmporteerd",
  );
  expect(q(c, "plan-from-answers-spend-measured")!.textContent).toContain("Nog geen rekeningen");
  expect(t).not.toMatch(/NaN|undefined|null|Infinity/);
  act(() => q(c, "plan-from-answers-import")!.click());
  expect(onNavigate).toHaveBeenCalledWith("profiel");
  act(() => q(c, "plan-from-answers-change-income")!.click());
  expect(onNavigate).toHaveBeenCalledWith("about-you");
});

test("band shows as range with household label", () => {
  const store = withProfile(answers);
  const c = mount(
    <FromAnswers
      store={store}
      hasAccounts={true}
      month={resultFor(store).sections.month}
      onNavigate={vi.fn()}
    />,
  );
  expect(q(c, "plan-from-answers-spend")!.textContent).toContain("opgegeven, voor jullie samen");
  expect(q(c, "plan-from-answers-spend-stated")!.textContent).toBe("€3.500 – €5.000");
  expect(q(c, "plan-from-answers-income")!.textContent).toContain(
    "binnengekomen op je gekoppelde rekeningen",
  );
  expect(q(c, "plan-from-answers-spend")!.textContent).toContain(
    "uitgegeven op je gekoppelde rekeningen",
  );
  expect(c.textContent).not.toContain("gemeten op");
  expect(q(c, "plan-from-answers-partial")!.textContent).toBe(
    "Staan niet al jullie rekeningen in LaVega, dan is dit bedrag lager.",
  );
  expect(q(c, "plan-from-answers-household")!.textContent).toBe("Samen");
  expect(q(c, "plan-from-answers-children")!.textContent).toBe("1 kind (geboortejaar 2020)");
  expect(
    [...c.querySelectorAll('[data-testid="plan-from-answers-work"]')].map((e) => e.textContent),
  ).toEqual(["Loondienst", "Freelance / zzp"]);

  const alone = withProfile({
    ...answers,
    household: stated({ kind: "alone" }),
  });
  unmountAll();
  const c2 = mount(
    <FromAnswers
      store={alone}
      hasAccounts={true}
      month={resultFor(alone).sections.month}
      onNavigate={vi.fn()}
    />,
  );
  expect(q(c2, "plan-from-answers-spend")!.textContent).not.toContain("voor jullie samen");
});

function unmountAll() {
  act(() => root!.unmount());
  container!.remove();
  root = null;
}

test("measured shows the middle month value and month", () => {
  const store = withProfile(answers);
  const result = resultFor(store);
  const f = result.sections.month.figures;
  expect(f.room.kind).toBe("computed");
  if (f.room.kind !== "computed") return;
  const c = mount(
    <FromAnswers
      store={store}
      hasAccounts={true}
      month={result.sections.month}
      onNavigate={vi.fn()}
    />,
  );
  const income = q(c, "plan-from-answers-income-measured")!.textContent!;
  const spend = q(c, "plan-from-answers-spend-measured")!.textContent!;
  // the same figures Je maand uses: income of the middle month, and income minus what was left
  const fmt = planFmt("nl");
  // fixture months: Sep out 2.311,79 / Aug out 2.301,79 (the middle net) / Jul out 2.289,99, each in 3.001,00
  expect(income).toBe("€3.001middelste maand: aug 2026");
  expect(spend).toBe("€2.302middelste maand: aug 2026");
  expect(fmt.eur(f.room.middleIncomeCents)).toBe("€3.001");
  expect(c.textContent).not.toMatch(/ander bedrag|different amount/);
});

test("freelance note in Je maand", () => {
  const store = withProfile({ work: stated(["freelance"]) });
  const result = resultFor(store);
  const c = mount(<MonthSection result={result.sections.month} ctx={ctxFor(store, result)} />);
  act(() => {
    c.querySelectorAll<HTMLButtonElement>("button[aria-expanded='false']").forEach((b) =>
      b.click(),
    );
  });
  expect(c.textContent).toContain(fromAnswersCopy.nl.notes.month);
});

test("jobseeking note in Buffer only", () => {
  const store = withProfile({ work: stated(["jobseeking"]) });
  const result = resultFor(store);
  const b = mount(<BufferSection result={result.sections.buffer} ctx={ctxFor(store, result)} />);
  act(() => {
    b.querySelectorAll<HTMLButtonElement>("button[aria-expanded='false']").forEach((x) =>
      x.click(),
    );
  });
  expect(b.textContent).toContain(fromAnswersCopy.nl.notes.buffer);
  unmountAll();
  const m = mount(<MonthSection result={result.sections.month} ctx={ctxFor(store, result)} />);
  act(() => {
    m.querySelectorAll<HTMLButtonElement>("button[aria-expanded='false']").forEach((x) =>
      x.click(),
    );
  });
  expect(m.textContent).not.toContain(fromAnswersCopy.nl.notes.month);
});

test("employed shows no notes", () => {
  const store = withProfile({ work: stated(["employed"]) });
  const result = resultFor(store);
  const ctx = ctxFor(store, result);
  const m = mount(<MonthSection result={result.sections.month} ctx={ctx} />);
  act(() => {
    m.querySelectorAll<HTMLButtonElement>("button[aria-expanded='false']").forEach((x) =>
      x.click(),
    );
  });
  expect(m.textContent).not.toContain(fromAnswersCopy.nl.notes.month);
  unmountAll();
  const b = mount(<BufferSection result={result.sections.buffer} ctx={ctx} />);
  act(() => {
    b.querySelectorAll<HTMLButtonElement>("button[aria-expanded='false']").forEach((x) =>
      x.click(),
    );
  });
  expect(b.textContent).not.toContain(fromAnswersCopy.nl.notes.buffer);
});

test("the block and the notes pass the advice-language scan in both locales", () => {
  for (const l of ["nl", "en"] as const) {
    const c = fromAnswersCopy[l];
    const texts = [
      c.title,
      c.household.alone,
      c.household.together,
      c.children(1, "2020"),
      c.children(2, "2020, 2022"),
      c.noChildren,
      c.workLabel,
      c.rows.income,
      c.rows.spend,
      c.statedAlone,
      c.statedTogether,
      c.measured.income,
      c.measured.spend,
      c.togetherPartial,
      c.measuredIn("juni 2026"),
      c.measuredMean("mei, juni 2026"),
      c.notStated,
      c.noBankData,
      c.importLink,
      c.change,
      c.notes.month,
      c.notes.buffer,
    ];
    for (const t of texts) expect(findAdviceLanguage(t, l)).toEqual([]);
  }
});

test("English labels say what the measured figure is; alone has no household caution", () => {
  setLocale("en");
  const together = withProfile(answers);
  const c = mount(
    <FromAnswers
      store={together}
      hasAccounts={true}
      month={resultFor(together).sections.month}
      onNavigate={vi.fn()}
    />,
  );
  expect(q(c, "plan-from-answers-income")!.textContent).toContain(
    "received on your linked accounts",
  );
  expect(q(c, "plan-from-answers-spend")!.textContent).toContain("spent on your linked accounts");
  expect(q(c, "plan-from-answers-partial")!.textContent).toBe(
    "If not all your accounts are in LaVega, this amount is lower.",
  );
  unmountAll();
  const alone = withProfile({ ...answers, household: stated({ kind: "alone" }) });
  const c2 = mount(
    <FromAnswers
      store={alone}
      hasAccounts={true}
      month={resultFor(alone).sections.month}
      onNavigate={vi.fn()}
    />,
  );
  expect(q(c2, "plan-from-answers-partial")).toBeNull();
});

const shortHistoryTxs = (txs: Tx[]) => txs.filter((t) => t.date >= "2026-10-01");
const oneMonthTxs = (txs: Tx[]) => txs.filter((t) => t.date.startsWith("2026-09"));

test("short history with accounts says so, not 'no accounts'", () => {
  const store = withProfile(answers);
  const result = computePlan(richPlanInput(store, { mapTxs: shortHistoryTxs }));
  expect(result.sections.month.figures.room.kind).not.toBe("computed");
  const c = mount(
    <FromAnswers
      store={store}
      hasAccounts={true}
      month={result.sections.month}
      onNavigate={vi.fn()}
    />,
  );
  const t = q(c, "plan-from-answers-income-measured")!.textContent!;
  expect(t).toContain("Te weinig historie: nog geen drie volle maanden");
  expect(t).not.toContain("Nog geen rekeningen");
  expect(q(c, "plan-from-answers-import")).toBeNull();
  expect(q(c, "plan-from-answers-income-stated")!.textContent).toBe("€4.500");
  unmountAll();
  setLocale("en");
  const c2 = mount(
    <FromAnswers
      store={store}
      hasAccounts={true}
      month={result.sections.month}
      onNavigate={vi.fn()}
    />,
  );
  expect(q(c2, "plan-from-answers-spend-measured")!.textContent).toContain(
    "Not enough history yet: fewer than three full months",
  );
});

test("a stated range equal to a wizard spend band shows the band label", () => {
  const store = withProfile({
    statedRanges: stated({
      income: { lowCents: 450000, highCents: 450000 },
      spend: { lowCents: 75000, highCents: 150000 },
    }),
  });
  const month = resultFor(store).sections.month;
  const nl = mount(
    <FromAnswers store={store} hasAccounts={true} month={month} onNavigate={vi.fn()} />,
  );
  expect(q(nl, "plan-from-answers-spend-stated")!.textContent).toBe("Minder dan €1.500");
  unmountAll();
  setLocale("en");
  const en = mount(
    <FromAnswers store={store} hasAccounts={true} month={month} onNavigate={vi.fn()} />,
  );
  expect(q(en, "plan-from-answers-spend-stated")!.textContent).toBe("Less than €1,500");
});

test("one computed month is named neutrally, not as a mean or a middle month", () => {
  const store = withProfile({
    statedRanges: stated({ income: { lowCents: 450000, highCents: 450000 } }),
  });
  const result = computePlan(richPlanInput(store, { mapTxs: oneMonthTxs }));
  const room = result.sections.month.figures.room;
  expect(room.kind === "computed" && room.months.length).toBe(1);
  const c = mount(
    <FromAnswers
      store={store}
      hasAccounts={true}
      month={result.sections.month}
      onNavigate={vi.fn()}
    />,
  );
  const t = q(c, "plan-from-answers-income-measured")!.textContent!;
  expect(t).toMatch(/maand: \S+ 2026/);
  expect(t).not.toMatch(/middelste|gemiddelde/);
});

test("two computed months are a mean and three are the middle month", () => {
  const store = withProfile({
    statedRanges: stated({ income: { lowCents: 450000, highCents: 450000 } }),
  });
  const two = computePlan(
    richPlanInput(store, {
      mapTxs: (txs) =>
        txs.filter((t) => t.date.startsWith("2026-08") || t.date.startsWith("2026-09")),
    }),
  );
  expect(
    two.sections.month.figures.room.kind === "computed" &&
      two.sections.month.figures.room.months.length,
  ).toBe(2);
  const c = mount(
    <FromAnswers
      store={store}
      hasAccounts={true}
      month={two.sections.month}
      onNavigate={vi.fn()}
    />,
  );
  expect(q(c, "plan-from-answers-income-measured")!.textContent).toMatch(/gemiddelde van/);
});
