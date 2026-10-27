// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  AdvisorProfile,
  SECTION_IDS,
  computePlan,
  emptyPlanPreferences,
  emptyProfileStore,
  findAdviceLanguage,
  ownAccounts,
  planProfileOf,
  type AdvisorProfileStore,
  type PlanDiff,
  type PlanResult,
  type PlanStatus,
  type SectionId,
} from "@lavega/core";
import Plan, { type PlanProps } from "./Plan";
import ScenarioTable from "../plan/ScenarioTable";
import SectionCard from "../plan/SectionCard";
import { planFmt, planShellCopy } from "../copy/plan";
import { formatFigure } from "../plan/planFormat";
import { richResult } from "../plan/richInput";
import type { UsePlan } from "../plan/usePlan";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-10-24";
let root: Root | null = null;
let container: HTMLElement | null = null;
const setLocale = (l: "nl" | "en") => {
  document.cookie = `lavega_locale=${l}`;
};
beforeEach(() => {
  localStorage.clear();
  setLocale("en");
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
});

const storeWith = (
  blocksDone: number,
  extra: Record<string, unknown> = {},
): AdvisorProfileStore => ({
  ...emptyProfileStore("2026-10-01"),
  current: new AdvisorProfile({ removed: [], intake: { blocksDone, step0: null }, ...extra }),
});

const resultOf = (store: AdvisorProfileStore | null): PlanResult =>
  computePlan({
    profile: planProfileOf(store),
    txs: [],
    accounts: [],
    entityProfiles: [],
    rules: [],
    own: ownAccounts([]),
    rewards: [],
    catalogue: [],
    rates: [],
    heldCards: [],
    preferences: emptyPlanPreferences(),
    events: [],
    mode: "separate",
    fxHistory: {},
    movedCategories: new Set(),
    asOf: AS_OF,
  });

const NO_DIFF: PlanDiff = { changes: [], statusChanges: [], material: false, baseline: false };

const planOf = (result: PlanResult, over: Partial<UsePlan> = {}): UsePlan => ({
  result,
  preferences: emptyPlanPreferences(),
  events: [],
  changes: NO_DIFF,
  changesSince: null,
  loaded: true,
  stateError: false,
  writeError: false,
  recompute: vi.fn(async () => {}),
  setPreference: vi.fn(async () => {}),
  appendPlanEvent: vi.fn(async () => {}),
  ...over,
});

function mount(node: ReactNode): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const props = (over: Partial<PlanProps> = {}): PlanProps => {
  const store = over.store === undefined ? storeWith(1) : over.store;
  return {
    plan: planOf(resultOf(store)),
    store,
    profileRead: store === null ? { kind: "absent" } : { kind: "ok", store },
    asOf: AS_OF,
    onSaveProfile: vi.fn(async () => {}),
    onNavigate: vi.fn(),
    ...over,
  };
};

const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);
const sectionsInOrder = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-testid^="plan-card-"]')].map((e) =>
    e.getAttribute("data-testid")!.replace("plan-card-", ""),
  );
const openAll = (c: HTMLElement) =>
  act(() => {
    c.querySelectorAll<HTMLButtonElement>("button[aria-expanded]").forEach((b) => b.click());
  });

test("store null or blocksDone 0 -> invitation card with Start and one sentence; no section rendered", () => {
  for (const store of [null, storeWith(0)]) {
    const onNavigate = vi.fn();
    const c = mount(<Plan {...props({ store, onNavigate })} />);
    expect(q(c, "intake-invite")).not.toBeNull();
    expect(c.textContent).toContain(planShellCopy.en.invitation.sentence);
    expect(c.querySelectorAll('[data-testid^="plan-card-"]').length).toBe(0);
    act(() => c.querySelector("button")!.click());
    expect(onNavigate).toHaveBeenCalledWith("intake");
    act(() => root!.unmount());
    container!.remove();
    root = null;
  }
});

test("blocksDone 1 with no bank data -> seven cards in the fixed order, each not-enough-data with its missing-input action, nothing estimated", () => {
  const p = props();
  const c = mount(<Plan {...p} />);
  expect(sectionsInOrder(c)).toEqual([...SECTION_IDS]);
  openAll(c);
  for (const id of SECTION_IDS) {
    const card = q(c, `plan-card-${id}`)!;
    const section = p.plan.result.sections[id];
    if (section.status === "not-enough-data" && section.missing.length > 0) {
      const actions = [...card.querySelectorAll("[data-testid='plan-missing-action']")];
      expect(actions.length).toBe(section.missing.length);
      expect(actions[0]!.textContent).toBe(planShellCopy.en.actions[section.missing[0]!.action]);
    }
  }
  expect(SECTION_IDS.some((id) => p.plan.result.sections[id].status === "not-enough-data")).toBe(
    true,
  );
});

test("a missing-input action navigates", () => {
  const onNavigate = vi.fn();
  const c = mount(<Plan {...props({ onNavigate })} />);
  openAll(c);
  const first = c.querySelector<HTMLButtonElement>("[data-testid='plan-missing-action']")!;
  act(() => first.click());
  expect(onNavigate).toHaveBeenCalledTimes(1);
});

test("chips show word AND symbol for every status; cards start closed; headers are buttons", () => {
  const base = resultOf(storeWith(1));
  const statuses: PlanStatus[] = ["on-track", "attention", "not-enough-data"];
  const sections = { ...base.sections } as Record<SectionId, (typeof base.sections)[SectionId]>;
  SECTION_IDS.forEach((id, i) => {
    sections[id] = { ...sections[id], status: statuses[i % 3]! } as never;
  });
  const result = { ...base, sections: sections as PlanResult["sections"] };
  const c = mount(<Plan {...props({ plan: planOf(result) })} />);
  SECTION_IDS.forEach((id, i) => {
    const chip = q(c, `plan-status-${id}`)!;
    const s = planShellCopy.en.status[statuses[i % 3]!];
    expect(chip.textContent).toContain(s.word);
    expect(chip.textContent).toContain(s.symbol);
    expect(chip.querySelector("[aria-hidden='true']")?.textContent).toBe(s.symbol);
  });
  const buttons = c.querySelectorAll<HTMLButtonElement>("button[aria-expanded]");
  expect(buttons.length).toBe(7);
  buttons.forEach((b) => expect(b.getAttribute("aria-expanded")).toBe("false"));
  expect(c.querySelector("[data-testid='plan-card-body']")).toBeNull();
  act(() => buttons[0]!.click());
  expect(buttons[0]!.getAttribute("aria-expanded")).toBe("true");
  expect(q(c, "plan-card-body")).not.toBeNull();
});

test("backbone strip: identical general sentence for two profiles, own facts only, no 'next' marker", () => {
  const a = resultOf(storeWith(1));
  const b = resultOf(storeWith(2));
  const withBackbone = (r: PlanResult, months: number, interest: number): PlanResult => ({
    ...r,
    backbone: {
      buffer: { unit: "months", value: months },
      debtInterestPerYear: { unit: "cents", value: interest },
      goalsGap: null,
      investingUnallocated: null,
    },
  });
  const render = (r: PlanResult) => {
    const c = mount(<Plan {...props({ plan: planOf(r) })} />);
    const text = q(c, "plan-backbone")!.textContent!;
    const sentence = q(c, "plan-backbone-neutral")!.textContent;
    act(() => root!.unmount());
    container!.remove();
    root = null;
    return { text, sentence };
  };
  const one = render(withBackbone(a, 2, 120000));
  const two = render(withBackbone(b, 5, 30000));
  expect(one.sentence).toBe(planShellCopy.en.backbone.neutral);
  expect(two.sentence).toBe(one.sentence);
  expect(one.text).not.toBe(two.text);
  expect(one.text).toContain("€1,200");
  expect(one.text).toContain(planShellCopy.en.backbone.steps.goals.empty);
  expect(one.text.toLowerCase()).not.toMatch(/\bnext\b|\bfirst\b|\bthen\b|volgende|eerst/);
});

test("change log lists figure, before, after and the reason; status change shows old and new chip; nothing material says so", () => {
  const diff: PlanDiff = {
    baseline: false,
    material: true,
    changes: [
      {
        section: "buffer",
        figureId: "buffer_months",
        unit: "months",
        before: 2,
        after: 1.5,
        reason: { key: "buffer-below-wish" },
      },
    ],
    statusChanges: [{ section: "buffer", before: "on-track", after: "attention" }],
  };
  const c = mount(<Plan {...props({ plan: planOf(resultOf(storeWith(1)), { changes: diff }) })} />);
  const log = q(c, "plan-changelog")!.textContent!;
  expect(log).toContain("2 months");
  expect(log).toContain("1.5 months");
  expect(log).toContain(planShellCopy.en.changes.reasons["buffer-below-wish"]({}));
  expect(log).toContain(planShellCopy.en.status["on-track"].word);
  expect(log).toContain(planShellCopy.en.status.attention.word);
  act(() => root!.unmount());
  container!.remove();
  root = null;
  const c2 = mount(<Plan {...props()} />);
  expect(q(c2, "plan-changelog")!.textContent).toContain(planShellCopy.en.changes.none);
  act(() => root!.unmount());
  container!.remove();
  root = null;
  const c3 = mount(
    <Plan
      {...props({
        plan: planOf(resultOf(storeWith(1)), { changes: { ...NO_DIFF, baseline: true } }),
      })}
    />,
  );
  expect(q(c3, "plan-changelog")!.textContent).toContain(planShellCopy.en.changes.firstPlan);
});

test("the change-log heading says which plan it compares with", () => {
  const head = (c: HTMLElement) => q(c, "plan-changelog-heading")!.textContent;
  const c1 = mount(
    <Plan
      {...props({
        plan: planOf(resultOf(storeWith(1)), {
          changesSince: { kind: "earlier-month", month: "2026-09" },
        }),
      })}
    />,
  );
  expect(head(c1)).toBe(
    planShellCopy.en.changes.headingSinceMonth(planFmt("en").monthLabel("2026-09")),
  );
  act(() => root!.unmount());
  container!.remove();
  root = null;
  const c2 = mount(
    <Plan
      {...props({
        plan: planOf(resultOf(storeWith(1)), { changesSince: { kind: "first-this-month" } }),
      })}
    />,
  );
  expect(head(c2)).toBe(planShellCopy.en.changes.headingSinceFirst);
});

test("scenario table has no input and identical cells for two different users", () => {
  const cells = (store: AdvisorProfileStore) => {
    const c = mount(<Plan {...props({ store })} />);
    const t = q(c, "plan-scenario")!;
    expect(t.querySelectorAll("input, select, textarea").length).toBe(0);
    expect(t.textContent!.toLowerCase()).toContain(
      "an illustration with stated assumptions, not a forecast and not a choice for you",
    );
    const html = t.innerHTML;
    act(() => root!.unmount());
    container!.remove();
    root = null;
    return html;
  };
  expect(cells(storeWith(1))).toBe(cells(storeWith(3)));
  const alone = mount(<ScenarioTable />);
  expect(alone.querySelectorAll("td").length).toBe(6);
});

test("SectionCard renders a passed explanation slot instead of the template one, and the template one has no AI disclosure", () => {
  const base = resultOf(storeWith(1));
  const result = {
    ...base,
    sections: {
      ...base.sections,
      month: {
        ...base.sections.month,
        figures: {
          ...base.sections.month.figures,
          room: { kind: "stated", lowCents: 10000, highCents: 20000 },
        },
      },
    },
  } as PlanResult;
  const mk = (explanation?: ReactNode) => (
    <SectionCard section="month" result={result.sections.month}>
      {{
        figures: <p>fig</p>,
        assumptions: <p>ass</p>,
        explanation,
        howCalculated: <p>how</p>,
        sources: <p>src</p>,
      }}
    </SectionCard>
  );
  const c = mount(mk(<p data-testid="ai-block">AI BLOCK</p>));
  openAll(c);
  expect(q(c, "ai-block")).not.toBeNull();
  expect(q(c, "plan-template-explanation")).toBeNull();
  act(() => root!.unmount());
  container!.remove();
  root = null;
  const c2 = mount(mk());
  openAll(c2);
  expect(q(c2, "ai-block")).toBeNull();
  const t = q(c2, "plan-template-explanation");
  expect(t).not.toBeNull();
  expect(t!.textContent).toContain(planShellCopy.en.explainControls.helped);
  expect(t!.textContent).not.toMatch(/\bAI\b|\bKI\b|assistant|generated|gegenereerd/i);
  const order = [...c2.querySelectorAll("[data-testid^='plan-part-']")].map((e) =>
    e.getAttribute("data-testid"),
  );
  expect(order).toEqual([
    "plan-part-figures",
    "plan-part-assumptions",
    "plan-part-explanation",
    "plan-part-howCalculated",
    "plan-part-sources",
  ]);
});

test("renders in NL and EN; no advice language in the rendered text, cards open", () => {
  for (const locale of ["nl", "en"] as const) {
    setLocale(locale);
    const c = mount(<Plan {...props()} />);
    openAll(c);
    const text = c.textContent!;
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain(planShellCopy[locale].title);
    expect(findAdviceLanguage(text, locale)).toEqual([]);
    act(() => root!.unmount());
    container!.remove();
    root = null;
  }
});

test("unverified public facts (empty PUBLIC_FACTS): no gift-tax, Nibud 10% or SPIVA text in the DOM", () => {
  for (const locale of ["nl", "en"] as const) {
    setLocale(locale);
    const c = mount(<Plan {...props()} />);
    openAll(c);
    expect(c.textContent).not.toMatch(/gift|schenk|Nibud|SPIVA|AFM/i);
    act(() => root!.unmount());
    container!.remove();
    root = null;
  }
});

test("a showable AFM backbone fact renders only through fromFact", () => {
  const fact = {
    id: "afm-backbone",
    textKey: "afm-backbone",
    value: "an AFM sentence",
    source: "AFM",
    sourceUrl: "https://example.org",
    verifiedOn: "2026-10-01",
    verifiedBy: "owner",
  };
  const c = mount(<Plan {...props({ publicFacts: [fact] as never })} />);
  expect(q(c, "plan-backbone")!.textContent).toContain("an AFM sentence (AFM)");
});

test("<script> in a debt lender name or subscription name renders as literal text", () => {
  const evil = "<script>alert(1)</script>";
  const store = storeWith(1, {
    debts: [
      {
        id: "d1",
        lender: evil,
        balanceCents: 100000,
        monthlyCents: 5000,
        ratePct: 5,
        source: "confirmed",
        at: "2026-10-01",
      },
    ],
  });
  const c = mount(
    <SectionCard section="debts" result={resultOf(store).sections.debts}>
      {{
        figures: <p data-testid="evil">{evil}</p>,
        assumptions: null,
        howCalculated: null,
        sources: null,
      }}
    </SectionCard>,
  );
  openAll(c);
  expect(c.querySelector("script")).toBeNull();
  expect(q(c, "evil")!.textContent).toBe(evil);
  const page = mount(<Plan {...props({ store })} />);
  expect(page.querySelector("script")).toBeNull();
});

test("a failed write, an unreadable stored plan and a failed recompute each show a plain error line", async () => {
  const c = mount(
    <Plan
      {...props({ plan: planOf(resultOf(storeWith(1)), { writeError: true, stateError: true }) })}
    />,
  );
  expect(q(c, "plan-error-write")).not.toBeNull();
  expect(q(c, "plan-error-state")).not.toBeNull();
  act(() => root!.unmount());
  container!.remove();
  root = null;
  const recompute = vi.fn(async () => {
    throw new Error("no");
  });
  const c2 = mount(<Plan {...props({ plan: planOf(resultOf(storeWith(1)), { recompute }) })} />);
  await act(async () => {
    q(c2, "plan-recompute")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(recompute).toHaveBeenCalled();
  expect(q(c2, "plan-error-recompute")).not.toBeNull();
});

test("a corrupt profile still shows the notice and no way to start", () => {
  const c = mount(<Plan {...props({ profileRead: { kind: "corrupt" } })} />);
  expect(q(c, "plan-corrupt")).not.toBeNull();
  expect(c.querySelector("button")).toBeNull();
});

// ---- fix round 1 ----

test("rich fixture: most sections have figures, every card open and in detail mode, no advice language in NL or EN", () => {
  const result = richResult();
  const withFigures = SECTION_IDS.filter((id) => result.sections[id].status !== "not-enough-data");
  expect(withFigures.length).toBeGreaterThanOrEqual(4);
  for (const locale of ["nl", "en"] as const) {
    setLocale(locale);
    const c = mount(<Plan {...props({ plan: planOf(result) })} />);
    openAll(c);
    act(() => {
      c.querySelectorAll<HTMLButtonElement>("[data-testid='plan-explain-toggle']").forEach((b) =>
        b.click(),
      );
    });
    expect(
      c.querySelectorAll("[data-testid='plan-template-explanation']").length,
    ).toBeGreaterThanOrEqual(3);
    for (const id of withFigures) {
      expect(q(c, `plan-card-${id}`)!.textContent!.length).toBeGreaterThan(40);
    }
    expect(findAdviceLanguage(c.textContent!, locale)).toEqual([]);
    act(() => root!.unmount());
    container!.remove();
    root = null;
  }
});

test("the simpler / more detail toggle has no aria-pressed (its label already says the action)", () => {
  const c = mount(<Plan {...props({ plan: planOf(richResult()) })} />);
  openAll(c);
  const t = q(c, "plan-explain-toggle")!;
  expect(t.hasAttribute("aria-pressed")).toBe(false);
  expect(q(c, "plan-explain-helped")!.hasAttribute("aria-pressed")).toBe(true);
});

test("every flat figure the plan emits has a label in both locales; the change log uses it", () => {
  const result = richResult();
  const keys = new Set(SECTION_IDS.flatMap((id) => Object.keys(result.sections[id].flat)));
  expect(keys.size).toBeGreaterThanOrEqual(30);
  for (const locale of ["nl", "en"] as const) {
    const labels = planShellCopy[locale].figureLabels as Record<string, string>;
    expect([...keys].filter((k) => !labels[k])).toEqual([]);
    expect(Object.values(labels).every((l) => /^[^_]+$/.test(l))).toBe(true);
  }
  const diff: PlanDiff = {
    baseline: false,
    material: true,
    changes: [
      {
        section: "spending",
        figureId: "spend_last_month_total",
        unit: "cents",
        before: 100000,
        after: 120000,
        reason: { key: "figure-changed" },
      },
    ],
    statusChanges: [],
  };
  const c = mount(<Plan {...props({ plan: planOf(result, { changes: diff }) })} />);
  const log = q(c, "plan-changelog")!.textContent!;
  expect(log).toContain(planShellCopy.en.figureLabels.spend_last_month_total);
  expect(log).not.toContain("spend last month total");
});

test("figure formatting by unit, including years with its unit", () => {
  const fmt = planFmt("en");
  expect(formatFigure(2.4, "years", fmt, "-")).toBe("2.4 years");
  expect(formatFigure(1, "years", fmt, "-")).toBe("1 year");
  expect(formatFigure(2, "years", planFmt("nl"), "-")).toBe("2 jaar");
  expect(formatFigure(null, "cents", fmt, "-")).toBe("-");
  expect(formatFigure(0.25, "ratio", fmt, "-")).toBe("25%");
});

test("intake-question missing action opens the intake", () => {
  const onNavigate = vi.fn();
  const base = resultOf(storeWith(1));
  const result = {
    ...base,
    sections: {
      ...base.sections,
      buffer: {
        ...base.sections.buffer,
        missing: [{ kind: "fixed-costs", action: "intake-question" }],
      },
    },
  } as PlanResult;
  const c = mount(<Plan {...props({ plan: planOf(result), onNavigate })} />);
  openAll(c);
  const link = [
    ...q(c, "plan-card-buffer")!.querySelectorAll<HTMLButtonElement>(
      "[data-testid='plan-missing-action']",
    ),
  ][0]!;
  act(() => link.click());
  expect(onNavigate).toHaveBeenCalledWith("intake");
});

test("the Assumptions link moves focus to the scenario card", () => {
  const c = mount(<Plan {...props()} />);
  const target = document.getElementById("plan-assumptions")!;
  expect(target.getAttribute("tabindex")).toBe("-1");
  act(() => (q(c, "plan-link-assumptions") as HTMLButtonElement).click());
  expect(document.activeElement).toBe(target);
});

test("the answers block sits under the header and above the backbone strip, and shows the stated figures", () => {
  const stated = (value: unknown) => ({ value, source: "stated", at: "2026-10-01" });
  const store = storeWith(1, {
    household: stated({ kind: "together" }),
    work: stated(["freelance"]),
    statedRanges: stated({ income: { lowCents: 450000, highCents: 450000 } }),
  });
  const c = mount(<Plan {...props({ store })} />);
  const block = q(c, "plan-from-answers")!;
  expect(block).not.toBeNull();
  const header = q(c, "plan-header")!;
  const backbone = q(c, "plan-backbone")!;
  expect(header.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(block.compareDocumentPosition(backbone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(block.textContent).toContain("€4,500");
});
