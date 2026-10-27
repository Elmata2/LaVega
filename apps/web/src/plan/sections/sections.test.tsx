// @vitest-environment jsdom
import { act, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  SECTION_IDS,
  computePlan,
  emptyPlanPreferences,
  findAdviceLanguage,
  goalAnchorEventOf,
  goalAnchorsOf,
  mergeEvents,
  planEventOf,
  type Account,
  type AdvisorProfileStore,
  type CardCriteriaRow,
  type BufferFigures,
  type CardsFigures,
  type DebtFigures,
  type EntityProfile,
  type MonthFigures,
  type PlanDiff,
  type SpendingFigures,
  type PlanEvent,
  type PlanPreferences,
  type PlanResult,
  type SectionResult,
  type Tx,
  type VaultEvent,
} from "@lavega/core";
import Plan from "../../views/Plan";
import { CATALOGUE_ENTRIES } from "../../catalogue-rates";
import { buildHeldCards } from "../heldCards";
import ChangeLog from "../ChangeLog";
import { richAccounts, richPlanInput, richStore } from "../richInput";
import type { UsePlan } from "../usePlan";
import BufferSection from "./BufferSection";
import CardsSection from "./CardsSection";
import DebtsSection from "./DebtsSection";
import MonthSection from "./MonthSection";
import SpendingSection from "./SpendingSection";
import type { PlanCtx } from "./types";

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

function mount(node: React.ReactNode): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}
const unmount = () => {
  act(() => root!.unmount());
  container!.remove();
  root = null;
};

const q = (c: ParentNode, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const qa = (c: ParentNode, id: string) => [
  ...c.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const openAll = (c: HTMLElement) =>
  act(() => {
    c.querySelectorAll<HTMLButtonElement>("button[aria-expanded='false']").forEach((b) =>
      b.click(),
    );
  });
const typeInto = (el: HTMLElement, value: string) =>
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
  });
};

type Spy = {
  result: PlanResult;
  prefs: PlanPreferences;
  events: VaultEvent[];
  store: AdvisorProfileStore;
  saved: AdvisorProfileStore[];
  setPreference: ReturnType<typeof vi.fn>;
};

const record = (spy: Spy, now: Pick<Spy, "result" | "prefs" | "events" | "store">): void => {
  Object.assign(spy, now);
};

/** The whole page with in-memory state standing in for the vault: preferences,
 *  events and the profile store change, and the plan is recomputed from them. */
function Harness({
  spy,
  entityProfiles = [],
  accounts = richAccounts(),
  initialPrefs,
  initialEvents,
  mapTxs,
}: {
  spy: Spy;
  initialEvents?: VaultEvent[];
  mapTxs?: (txs: Tx[]) => Tx[];
  entityProfiles?: EntityProfile[];
  accounts?: Account[];
  initialPrefs?: PlanPreferences;
}) {
  const [store, setStore] = useState(spy.store);
  const [prefs, setPrefs] = useState(initialPrefs ?? emptyPlanPreferences());
  const [events, setEvents] = useState<VaultEvent[]>(initialEvents ?? []);
  const planEvents = useMemo(
    () => events.flatMap((e) => planEventOf(e) ?? []) as PlanEvent[],
    [events],
  );
  const result = useMemo(
    () =>
      computePlan(
        richPlanInput(store, {
          preferences: prefs,
          events: planEvents,
          entityProfiles,
          accounts,
          mapTxs,
        }),
      ),
    [store, prefs, planEvents, entityProfiles, accounts, mapTxs],
  );
  useEffect(
    () => record(spy, { result, prefs, events, store }),
    [spy, result, prefs, events, store],
  );
  const plan: UsePlan = {
    result,
    preferences: prefs,
    events,
    changes: { changes: [], statusChanges: [], material: false, baseline: false },
    changesSince: null,
    loaded: true,
    stateError: false,
    writeError: false,
    recompute: async () => {},
    setPreference: async (patch) => {
      spy.setPreference(patch);
      setPrefs((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) }));
    },
    appendPlanEvent: async (e) => {
      setEvents((ev) => mergeEvents(ev, [e]));
    },
  };
  return (
    <Plan
      plan={plan}
      store={store}
      profileRead={{ kind: "ok", store }}
      asOf={AS_OF}
      accounts={accounts}
      entityProfiles={entityProfiles}
      onSaveProfile={async (next) => {
        spy.saved.push(next);
        setStore(next);
      }}
      onNavigate={vi.fn()}
    />
  );
}

const newSpy = (store = richStore()): Spy => ({
  result: undefined as never,
  prefs: emptyPlanPreferences(),
  events: [],
  store,
  saved: [],
  setPreference: vi.fn(),
});

const cardEl = (c: HTMLElement, id: string) => q(c, `plan-card-${id}`)!;
const headlines = (c: HTMLElement) =>
  SECTION_IDS.map((id) => q(c, `plan-headline-${id}`)!.textContent);

test("seeded fixture: all seven sections render headline and figures; expanded order is figures, assumptions, explanation, how-we-calculated, sources", () => {
  const spy = newSpy();
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  const canonical = [
    "plan-part-figures",
    "plan-part-assumptions",
    "plan-part-explanation",
    "plan-part-howCalculated",
    "plan-part-sources",
  ];
  for (const id of SECTION_IDS) {
    const card = cardEl(c, id);
    expect(q(c, `plan-headline-${id}`)!.textContent!.length).toBeGreaterThan(0);
    expect(q(card, "plan-part-figures")).not.toBeNull();
    const order = [...card.querySelectorAll("[data-testid^='plan-part-']")].map((e) =>
      e.getAttribute("data-testid")!,
    );
    expect(order).toEqual(canonical.filter((k) => order.includes(k)));
  }
  expect(q(cardEl(c, "buffer"), "plan-part-assumptions")).not.toBeNull();
  expect(q(cardEl(c, "debts"), "plan-part-assumptions")).not.toBeNull();
  expect(q(cardEl(c, "goals"), "plan-part-assumptions")).not.toBeNull();
});

const crit = (name: string, fee: number | null): CardCriteriaRow => ({
  cardKey: name.toLowerCase(),
  name,
  held: false,
  annualFee: { cents: fee, known: fee !== null, asOf: "2026-09-01", sourceUrl: null },
  cashbackPct: { value: 1, tier: "measured", asOf: "2026-09-01", sourceUrl: null },
  fxFeePct: { value: null, tier: "unknown", asOf: null, sourceUrl: null },
  pointsPerEuro: { value: null, tier: "unknown", asOf: null, sourceUrl: null },
  earnByCategory: "unknown",
  pointsExpiry: null,
  transferRatio: "unknown",
  insurance: "unknown",
});

function cardsCtx(): { ctx: PlanCtx; result: SectionResult<CardsFigures> } {
  const base = computePlan(richPlanInput(richStore()));
  const result = {
    ...base.sections.cards,
    figures: {
      ...base.sections.cards.figures,
      criteria: [crit("Zeta", 9000), crit("Alpha", 30000), crit("Mid", null)],
    },
  } as SectionResult<CardsFigures>;
  const plan: UsePlan = {
    result: base,
    preferences: emptyPlanPreferences(),
    events: [],
    changes: { changes: [], statusChanges: [], material: false, baseline: false },
    changesSince: null,
    loaded: true,
    stateError: false,
    writeError: false,
    recompute: async () => {},
    setPreference: vi.fn(async () => {}),
    appendPlanEvent: vi.fn(async () => {}),
  };
  const ctx: PlanCtx = {
    plan,
    asOf: AS_OF,
    accounts: [],
    profile: { store: richStore(), update: vi.fn(async () => true), saveFailed: false },
    onNavigate: vi.fn(),
  };
  return { ctx, result };
}

const rowNames = (c: HTMLElement) =>
  qa(c, "plan-cards-row").map((r) => r.querySelector("th,td")!.textContent!.trim());

test("cards table: default sorted by name, clicking a column sorts, no element has a highlight/selected/best class; Keep/Review/Cancel start unselected", () => {
  const { ctx, result } = cardsCtx();
  const c = mount(<CardsSection result={result} ctx={ctx} />);
  openAll(c);
  expect(rowNames(c).map((n) => n.replace(/\(.*\)/, "").trim())).toEqual(["Alpha", "Mid", "Zeta"]);
  const feeHeader = q(c, "plan-cards-sort-annualFee")!;
  act(() => feeHeader.click());
  expect(rowNames(c).map((n) => n.replace(/\(.*\)/, "").trim())).toEqual(["Zeta", "Alpha", "Mid"]);
  act(() => feeHeader.click());
  expect(rowNames(c).map((n) => n.replace(/\(.*\)/, "").trim())).toEqual(["Alpha", "Zeta", "Mid"]);
  const bad = /highlight|selected|best|beste|winner|recommend|top-pick|bg-accent/i;
  for (const el of c.querySelectorAll("*")) {
    expect(el.getAttribute("class") ?? "").not.toMatch(bad);
    expect(el.getAttribute("aria-selected")).toBeNull();
  }
  expect(c.textContent!.toLowerCase()).not.toMatch(/\bbest\b|\bbeste\b/);

  // Keep / Review / Cancel start unselected.
  const spy = newSpy();
  const page = mount(<Harness spy={spy} />);
  openAll(page);
  const buttons = [
    ...qa(page, "plan-sub-decision-keep"),
    ...qa(page, "plan-sub-decision-review"),
    ...qa(page, "plan-sub-decision-cancel"),
  ];
  expect(buttons.length).toBeGreaterThanOrEqual(3);
  for (const b of buttons) expect(b.getAttribute("aria-pressed")).toBe("false");
});

test("editing a category limit and an extra debt payment persists via setPreference and changes the figures", async () => {
  const spy = newSpy();
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  const spendingBefore = cardEl(c, "spending").textContent;
  const debtsBefore = cardEl(c, "debts").textContent;

  typeInto(q(c, "plan-input-limit-Boodschappen")!, "500");
  await click(q(c, "plan-save-limit-Boodschappen")!);
  expect(spy.prefs.categoryLimits["Boodschappen"]?.cents).toBe(50000);
  expect(spy.setPreference).toHaveBeenCalled();
  expect(cardEl(c, "spending").textContent).not.toBe(spendingBefore);
  const row = spy.result.sections.spending.figures.rows.find((r) => r.category === "Boodschappen")!;
  expect(row.limitCents).toBe(50000);

  typeInto(q(c, "plan-input-debt-extra-d1")!, "100,50");
  await click(q(c, "plan-save-debt-extra-d1")!);
  expect(spy.prefs.extraDebtPayment["d1"]?.cents).toBe(10050);
  expect(spy.result.sections.debts.figures.rows[0]!.withExtra?.extraCents).toBe(10050);
  expect(cardEl(c, "debts").textContent).not.toBe(debtsBefore);
});

test("invalid figures show an inline error and save nothing", async () => {
  const spy = newSpy();
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  await act(async () => {});
  const written = spy.setPreference.mock.calls.length;
  for (const bad of ["abc", "-5", "1.234", "99999999999", ""]) {
    typeInto(q(c, "plan-input-debt-extra-d1")!, bad);
    await click(q(c, "plan-save-debt-extra-d1")!);
    expect(q(c, "plan-error-debt-extra-d1")!.textContent!.length).toBeGreaterThan(0);
  }
  expect(spy.setPreference.mock.calls.length).toBe(written);
  expect(spy.prefs.extraDebtPayment).toEqual({});
  typeInto(q(c, "plan-input-buffer-target")!, "100");
  await click(q(c, "plan-save-buffer-target")!);
  expect(q(c, "plan-error-buffer-target")!.textContent!.length).toBeGreaterThan(0);
  expect(spy.saved).toEqual([]);
});

test("inputs are never pre-filled with a default", () => {
  const spy = newSpy();
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  const inputs = [...c.querySelectorAll<HTMLInputElement>("input[type='text']")];
  expect(inputs.length).toBeGreaterThan(4);
  for (const i of inputs) expect(i.value).toBe("");
});

test("buffer target is saved through the profile save path as a stated field", async () => {
  const spy = newSpy();
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  typeInto(q(c, "plan-input-buffer-target")!, "4");
  await click(q(c, "plan-save-buffer-target")!);
  expect(spy.saved).toHaveLength(1);
  const field = spy.saved[0]!.current.buffer!;
  expect(field.value.months).toBe(4);
  expect(field.source).toBe("stated");
  expect(spy.result.sections.buffer.figures.targetMonths).toBe(4);
  // an unchanged value is a no-op for the store
  typeInto(q(c, "plan-input-buffer-target")!, "4");
  await click(q(c, "plan-save-buffer-target")!);
  expect(spy.saved).toHaveLength(1);
});

test("'used this month' appends one UsageLog; clicking twice in the same month leaves one logged month", async () => {
  const spy = newSpy();
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  expect(spy.result.sections.subscriptions.figures.rows.length).toBeGreaterThan(0);
  const btn = () => q(c, "plan-sub-used")!;
  await click(btn());
  await click(btn());
  const usage = spy.events.filter((e) => e.kind === "usage-log");
  expect(usage).toHaveLength(1);
  expect(usage[0]!["month"]).toBe("2026-10");
  const row = spy.result.sections.subscriptions.figures.rows[0]!;
  expect(row.usage).not.toBe("unknown");
  if (row.usage !== "unknown") expect(row.usage.loggedMonths).toBe(1);
});

test("a decision button appends a decision event and pressing it again clears it", async () => {
  const spy = newSpy();
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  await click(q(c, "plan-sub-decision-review")!);
  expect(spy.result.sections.subscriptions.figures.rows[0]!.decision).toBe("review");
  expect(q(c, "plan-sub-decision-review")!.getAttribute("aria-pressed")).toBe("true");
  expect(q(c, "plan-sub-decision-keep")!.getAttribute("aria-pressed")).toBe("false");
  await click(q(c, "plan-sub-decision-review")!);
  expect(spy.result.sections.subscriptions.figures.rows[0]!.decision).toBeNull();
});

test("linking a bank account to a goal moves its balance from buffer savings to goal saved (no double count) after recompute", async () => {
  const spy = newSpy();
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  const liquidBefore = spy.result.sections.buffer.figures.liquidSavingsCents!;
  expect(spy.result.sections.goals.figures.rows[0]!.savedCents).toBe(0);
  const box = q(c, "plan-goal-link-g1-S1") as HTMLInputElement;
  expect(box.checked).toBe(false);
  await click(box);
  expect(spy.saved).toHaveLength(1);
  const goal = spy.saved[0]!.current.goals![0]!;
  expect(goal.source).toBe("confirmed");
  expect(goal.value.accountRefs).toEqual([{ kind: "bank", id: "S1" }]);
  const g = spy.result.sections.goals.figures.rows.find((r) => r.goalId === "g1")!;
  expect(g.savedCents).toBe(500000);
  expect(spy.result.sections.buffer.figures.liquidSavingsCents).toBe(liquidBefore - 500000);
  await click(q(c, "plan-goal-link-g1-S1")!);
  expect(spy.result.sections.buffer.figures.liquidSavingsCents).toBe(liquidBefore);
});

test("goal edits: saved so far and planned monthly go through the profile save as confirmed edits", async () => {
  const spy = newSpy();
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  typeInto(q(c, "plan-input-goal-saved-g1")!, "1200");
  await click(q(c, "plan-save-goal-saved-g1")!);
  typeInto(q(c, "plan-input-goal-monthly-g1")!, "150");
  await click(q(c, "plan-save-goal-monthly-g1")!);
  const goal = spy.store.current.goals![0]!;
  expect(goal.source).toBe("confirmed");
  expect(goal.value.startingBalanceCents).toBe(120000);
  expect(goal.value.plannedMonthlyCents).toBe(15000);
  expect(spy.result.sections.goals.figures.rows[0]!.plannedMonthlyCents).toBe(15000);
});

test("goal anchors: the first one is written once per goal (never over an existing one); a saved-so-far edit adds a new (date, amount) anchor", async () => {
  const spy = newSpy();
  const existing = goalAnchorEventOf({
    goalId: "g1",
    at: "2020-05-05",
    startCents: 1234,
    first: true,
  });
  const c = mount(<Harness spy={spy} initialEvents={[existing]} />);
  await act(async () => {});
  const anchors = () => goalAnchorsOf(spy.events);
  expect(anchors()["g1"]).toEqual({ at: "2020-05-05", startCents: 1234 });
  expect(anchors()["g2"]).toMatchObject({ at: "2026-02-01" });
  const count = () => spy.events.filter((e) => e.kind === "goal-anchor").length;
  expect(count()).toBe(2);
  // an unrelated goal edit (its Field.at moves) adds no anchor
  openAll(c);
  typeInto(q(c, "plan-input-goal-monthly-g2")!, "100");
  await click(q(c, "plan-save-goal-monthly-g2")!);
  expect(count()).toBe(2);
  expect(anchors()["g2"]).toMatchObject({ at: "2026-02-01" });
  // typing the saved-so-far re-anchors both date and amount
  typeInto(q(c, "plan-input-goal-saved-g2")!, "1500");
  await click(q(c, "plan-save-goal-saved-g2")!);
  expect(count()).toBe(3);
  expect(anchors()["g2"]!.startCents).toBe(150000);
  expect(anchors()["g2"]!.at > "2026-02-01").toBe(true);
  expect(spy.result.sections.goals.figures.rows.find((r) => r.goalId === "g2")!.scheduleFrom).toBe(
    anchors()["g2"]!.at.slice(0, 10),
  );
});

test("simpler / more detail switches between template levels; no AI-disclosure element is rendered", () => {
  const spy = newSpy();
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  const goals = cardEl(c, "goals");
  const before = q(goals, "plan-template-explanation")!.textContent!;
  act(() => q(goals, "plan-explain-toggle")!.click());
  const after = q(goals, "plan-template-explanation")!.textContent!;
  expect(after.length).toBeGreaterThan(before.length);
  act(() => q(goals, "plan-explain-toggle")!.click());
  expect(q(goals, "plan-template-explanation")!.textContent).toBe(before);
  expect(c.textContent).not.toMatch(/\bAI\b|\bKI\b|assistant|generated|gegenereerd/i);
});

test("business-entity accounts present: displayed figures equal those without them", () => {
  const withoutSpy = newSpy();
  const without = mount(<Harness spy={withoutSpy} />);
  const base = headlines(without);
  unmount();
  const business = richAccounts().concat([
    {
      key: "B1",
      iban: "",
      name: "Zakelijk",
      bank: "ING",
      entity: "Acme BV",
      currency: "EUR",
      balance: 123456,
      balanceDate: "2026-10-20",
    },
  ]);
  const spy = newSpy();
  const c = mount(
    <Harness
      spy={spy}
      accounts={business}
      entityProfiles={[{ entity: "Acme BV", scope: "business" }]}
    />,
  );
  expect(headlines(c)).toEqual(base);
  openAll(c);
  expect(q(c, "plan-goal-link-g1-B1")).toBeNull();
  expect(q(c, "plan-goal-link-g1-S1")).not.toBeNull();
});

test("copy scan on the rendered seeded fixture in NL and EN: findAdviceLanguage empty, cards open, detail on", () => {
  for (const locale of ["nl", "en"] as const) {
    setLocale(locale);
    const spy = newSpy();
    const c = mount(<Harness spy={spy} />);
    openAll(c);
    act(() => {
      c.querySelectorAll<HTMLElement>("[data-testid='plan-explain-toggle']").forEach((b) =>
        b.click(),
      );
    });
    const text = c.textContent!;
    expect(text.length).toBeGreaterThan(1500);
    expect(findAdviceLanguage(text, locale)).toEqual([]);
    expect(text).not.toMatch(/gift|schenk|Nibud|SPIVA|AFM/i);
    unmount();
  }
});

const asClass = (
  store: AdvisorProfileStore,
  patch: Record<string, unknown>,
): AdvisorProfileStore => ({
  ...store,
  current: new (store.current.constructor as new (x: unknown) => typeof store.current)({
    ...store.current,
    ...patch,
  }),
});
const evil = "<script>alert(1)</script>";
const hostileTxs = (txs: Tx[]): Tx[] =>
  txs.map((t) => (t.counterparty === "Netflix" ? { ...t, counterparty: evil } : t));

test("<script> in a lender name and a subscription name renders as literal text, in the real section bodies", () => {
  const base = richStore();
  const hostile = asClass(base, {
    debts: [{ ...base.current.debts![0]!, lender: evil }],
  });
  const spy = newSpy(hostile);
  const mapTxs = hostileTxs;
  const c = mount(<Harness spy={spy} mapTxs={mapTxs} />);
  openAll(c);
  expect(
    spy.result.sections.subscriptions.figures.rows.some((r) => r.name.includes("script")),
  ).toBe(true);
  expect(c.querySelector("script")).toBeNull();
  expect(cardEl(c, "debts").textContent).toContain(evil);
  expect(cardEl(c, "subscriptions").textContent).toContain(evil);
  expect(q(c, "plan-input-debt-extra-d1")!.closest("form")!.textContent).toContain(evil);
});

test("goal links: an orphan link to an account that no longer exists can be removed", async () => {
  const store = richStore();
  const goals = [...store.current.goals!];
  goals[0] = {
    ...goals[0]!,
    value: { ...goals[0]!.value, accountRefs: [{ kind: "bank", id: "GONE" }] },
  };
  const edited = asClass(store, { goals });
  const spy = newSpy(edited);
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  const orphan = q(c, "plan-goal-link-g1-GONE") as HTMLInputElement;
  expect(orphan.checked).toBe(true);
  await click(orphan);
  expect(spy.store.current.goals![0]!.value.accountRefs).toEqual([]);
});

test("redemption examples and points expiry: validated, stored through setPreference, removable", async () => {
  const { ctx, result } = cardsCtx();
  const withProgram = {
    ...result,
    figures: {
      ...result.figures,
      balances: [
        { programId: "prog", points: 1000, stale: false, expiresOn: null, valueRange: null },
      ],
    },
  } as SectionResult<CardsFigures>;
  const setPref = vi.fn(async () => {});
  ctx.plan.setPreference = setPref;
  const c = mount(<CardsSection result={withProgram} ctx={ctx} />);
  openAll(c);
  const select = q(c, "plan-input-redeem-program") as unknown as HTMLSelectElement;
  expect(select.value).toBe("");
  // an incomplete or invalid entry stores nothing
  await click(q(c, "plan-save-redeem")!);
  typeInto(q(c, "plan-input-redeem-points")!, "12.5");
  await click(q(c, "plan-save-redeem")!);
  expect(q(c, "plan-error-redeem")!.textContent!.length).toBeGreaterThan(0);
  expect(setPref).not.toHaveBeenCalled();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(
      select,
      "prog",
    );
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  typeInto(q(c, "plan-input-redeem-points")!, "5000");
  typeInto(q(c, "plan-input-redeem-cash")!, "40,50");
  await click(q(c, "plan-save-redeem")!);
  expect(setPref).toHaveBeenCalledTimes(1);
  const patch = (
    setPref.mock.calls[0] as unknown as [(p: PlanPreferences) => Partial<PlanPreferences>]
  )[0];
  const stored = patch(emptyPlanPreferences()).redemptionExamples!;
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    programId: "prog",
    pointsSpent: 5000,
    cashPriceSavedCents: 4050,
    at: AS_OF,
  });

  typeInto(q(c, "plan-input-expiry-prog")!, "2027-02-30");
  await click(q(c, "plan-save-expiry-prog")!);
  expect(q(c, "plan-error-expiry-prog")!.textContent!.length).toBeGreaterThan(0);
  expect(setPref).toHaveBeenCalledTimes(1);
  typeInto(q(c, "plan-input-expiry-prog")!, "2027-03-01");
  await click(q(c, "plan-save-expiry-prog")!);
  expect(setPref).toHaveBeenCalledTimes(2);
});

test("study template: all four figures are needed, none is pre-filled, then it changes the goals figures", async () => {
  const spy = newSpy();
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  const names = ["monthlyCost", "months", "tuition", "inflation"] as const;
  for (const n of names) expect((q(c, `plan-input-study-${n}`) as HTMLInputElement).value).toBe("");
  typeInto(q(c, "plan-input-study-monthlyCost")!, "900");
  await click(q(c, "plan-save-study")!);
  expect(q(c, "plan-error-study")!.textContent!.length).toBeGreaterThan(0);
  expect(spy.prefs.studyCostAssumptions).toBeNull();
  typeInto(q(c, "plan-input-study-months")!, "48");
  typeInto(q(c, "plan-input-study-tuition")!, "9000");
  typeInto(q(c, "plan-input-study-inflation")!, "2,5");
  await click(q(c, "plan-save-study")!);
  expect(spy.prefs.studyCostAssumptions).toMatchObject({
    monthlyCostCents: 90000,
    months: 48,
    tuitionCents: 900000,
    inflationPct: 2.5,
  });
  expect(spy.result.sections.goals.figures.study?.totalCents).toBe(90000 * 48 + 900000);
  await click(q(c, "plan-clear-study")!);
  expect(spy.prefs.studyCostAssumptions).toBeNull();
});

/* ---- final fix wave, part B ---- */

const richSections = () => computePlan(richPlanInput(richStore())).sections;

test("R6: the debts card shows the user's own savings rate and no free-rate line, in both languages", () => {
  const base = richSections().debts;
  const result: SectionResult<DebtFigures> = {
    ...base,
    figures: { ...base.figures, savingsRatePct: 2.1 },
  };
  for (const locale of ["en", "nl"] as const) {
    setLocale(locale);
    const c = mount(<DebtsSection result={result} ctx={cardsCtx().ctx} />);
    openAll(c);
    expect(c.textContent).toContain(locale === "en" ? "2.1%" : "2,1%");
    expect(c.textContent).not.toMatch(/highest|hoogste|withdraw freely|vrij opneembaar sparen/i);
    expect(c.textContent).not.toMatch(/catalogue|catalogus|vergelijkingsbron|comparison source/i);
    unmount();
  }
});

test("B11: a debt without a rate gets an inline rate input that saves through the profile and then computes its cost; same for a missing balance", async () => {
  const noRate = asClass(richStore(), {
    debts: [
      {
        id: "d1",
        lender: "Lender",
        monthlyCents: 30000,
        balanceCents: 900000,
        source: "derived",
        evidence: ["tx-1"],
        at: "2026-10-01",
      },
    ],
  });
  const spy = newSpy(noRate);
  const c = mount(<Harness spy={spy} />);
  openAll(c);
  expect(q(c, "plan-input-debt-balance-d1")).toBeNull();
  expect((q(c, "plan-input-debt-rate-d1") as HTMLInputElement).value).toBe("");
  expect(spy.result.sections.debts.figures.rows[0]!.interestPerYearCents).toBeNull();
  typeInto(q(c, "plan-input-debt-rate-d1")!, "abc");
  await click(q(c, "plan-save-debt-rate-d1")!);
  expect(q(c, "plan-error-debt-rate-d1")!.textContent!.length).toBeGreaterThan(0);
  expect(spy.saved).toHaveLength(0);
  typeInto(q(c, "plan-input-debt-rate-d1")!, "4,5");
  await click(q(c, "plan-save-debt-rate-d1")!);
  const debt = spy.store.current.debts![0]!;
  expect(debt.ratePct).toBe(4.5);
  expect(debt.source).toBe("confirmed");
  expect(debt.evidence).toEqual(["tx-1"]);
  expect(spy.result.sections.debts.figures.rows[0]!.interestPerYearCents).toBe(40500);
  expect(q(c, "plan-input-debt-rate-d1")).toBeNull();
  unmount();

  const noBalance = asClass(richStore(), {
    debts: [
      {
        id: "d1",
        lender: "Lender",
        monthlyCents: 30000,
        ratePct: 9.5,
        source: "stated",
        at: "2026-10-01",
      },
    ],
  });
  const spy2 = newSpy(noBalance);
  const c2 = mount(<Harness spy={spy2} />);
  openAll(c2);
  expect(q(c2, "plan-input-debt-rate-d1")).toBeNull();
  typeInto(q(c2, "plan-input-debt-balance-d1")!, "5000");
  await click(q(c2, "plan-save-debt-balance-d1")!);
  expect(spy2.store.current.debts![0]!.balanceCents).toBe(500000);
  expect(spy2.result.sections.debts.figures.rows[0]!.interestPerYearCents).toBe(47500);
});

test("B12: points per euro is shown as a plain number, cashback keeps its percent sign", () => {
  const { ctx, result } = cardsCtx();
  const row = {
    ...result.figures.criteria[0]!,
    pointsPerEuro: { value: 1.5, tier: "measured", asOf: "2026-09-01", sourceUrl: null },
  } as CardCriteriaRow;
  const withPoints = { ...result, figures: { ...result.figures, criteria: [row] } };
  const c = mount(<CardsSection result={withPoints} ctx={ctx} />);
  openAll(c);
  const cells = [...c.querySelectorAll("tbody td")].map((t) => t.textContent!);
  expect(cells.some((t) => t.startsWith("1.5") && !t.startsWith("1.5%"))).toBe(true);
  expect(cells.some((t) => t.startsWith("1%"))).toBe(true);
});

test("B8: the month card has no habits list", () => {
  for (const locale of ["en", "nl"] as const) {
    setLocale(locale);
    const c = mount(<MonthSection result={richSections().month} ctx={cardsCtx().ctx} />);
    openAll(c);
    expect(c.textContent).not.toMatch(/Habits|Gewoontes|pay yourself|jezelf betalen/i);
    unmount();
  }
});

test("B5: the spending reference line renders only from a verified public fact", () => {
  const base = richSections().spending as SectionResult<SpendingFigures>;
  const { ctx } = cardsCtx();
  const fact = {
    id: "spending-reference-budget",
    textKey: "x",
    value: "€400 for groceries",
    source: "Reference source",
    sourceUrl: "https://example.org",
    verifiedOn: "2026-10-01",
    verifiedBy: "owner",
  };
  const without = mount(<SpendingSection result={base} ctx={ctx} />);
  openAll(without);
  expect(without.textContent).not.toMatch(/Reference budget|reference source/i);
  unmount();
  const withFact = mount(<SpendingSection result={base} ctx={{ ...ctx, publicFacts: [fact] }} />);
  openAll(withFact);
  expect(withFact.textContent).toContain("Reference budget: €400 for groceries (Reference source)");
  expect(findAdviceLanguage(withFact.textContent!, "en")).toEqual([]);
});

test("B7/B13: the buffer card shows a worked example, not a 'time to close' row, and the stated-overlap note only when it applies", () => {
  const base = richSections().buffer;
  const fig = (over: Partial<BufferFigures>): SectionResult<BufferFigures> => ({
    ...base,
    figures: {
      ...base.figures,
      gapCents: 270000,
      closeMonths: { low: 4, high: 4 },
      closeRoom: { lowCents: 70000, highCents: 70000 },
      statedOverlapGoalCount: 0,
      ...over,
    },
  });
  const c = mount(<BufferSection result={fig({})} ctx={cardsCtx().ctx} />);
  openAll(c);
  const t = q(c, "plan-part-figures")!.textContent!;
  expect(t).toMatch(
    /Worked example: if €700 each month went to your buffer, the difference would close in 4 months/,
  );
  expect(t).not.toMatch(/Time to close|4 months – 4|4 – 4/);
  expect(t).not.toMatch(/same money/);
  unmount();
  const c2 = mount(
    <BufferSection result={fig({ statedOverlapGoalCount: 1 })} ctx={cardsCtx().ctx} />,
  );
  openAll(c2);
  expect(q(c2, "plan-part-figures")!.textContent).toMatch(/same money/);
  unmount();
  const c3 = mount(
    <BufferSection
      result={fig({ closeMonths: "not-reachable", closeRoom: null })}
      ctx={cardsCtx().ctx}
    />,
  );
  openAll(c3);
  expect(q(c3, "plan-part-figures")!.textContent).not.toMatch(/Worked example/);
});

test("A7/B14: a month section that rests on stale data says so and asks for the account's data", () => {
  const base = richSections().month;
  const stale: SectionResult<MonthFigures> = {
    ...base,
    status: "not-enough-data",
    statusReason: { key: "data-stale" },
    missing: [{ kind: "account-stale", action: "connect-bank", ref: "A1" }],
  };
  for (const locale of ["en", "nl"] as const) {
    setLocale(locale);
    const c = mount(<MonthSection result={stale} ctx={cardsCtx().ctx} />);
    openAll(c);
    expect(c.textContent).toMatch(locale === "en" ? /rest on older months/ : /oudere maanden/);
    expect(c.textContent).toMatch(
      locale === "en" ? /Nothing has been estimated/ : /Er is niets geschat/,
    );
    unmount();
  }
});

test("B4: a change in the unshown free-rate figure is not listed in the change log", () => {
  const diff: PlanDiff = {
    baseline: false,
    material: true,
    statusChanges: [],
    changes: [
      {
        section: "debts",
        figureId: "best_free_rate_pct",
        unit: "pct",
        before: 2,
        after: 3,
        reason: { key: "figure-changed" },
      },
      {
        section: "debts",
        figureId: "debt_count",
        unit: "count",
        before: 1,
        after: 2,
        reason: { key: "debt-added" },
      },
    ],
  } as unknown as PlanDiff;
  const c = mount(<ChangeLog diff={diff} since={null} />);
  expect(qa(c, "plan-change")).toHaveLength(1);
  expect(c.textContent).not.toMatch(/Rate on savings you can withdraw freely/);
});

test("B1: the whole rendered page, in both languages, never calls anything investing", () => {
  for (const locale of ["en", "nl"] as const) {
    setLocale(locale);
    const c = mount(<Harness spy={newSpy()} />);
    openAll(c);
    act(() => {
      c.querySelectorAll<HTMLElement>("[data-testid='plan-explain-toggle']").forEach((b) =>
        b.click(),
      );
    });
    expect(c.textContent).not.toMatch(/invest|beleg/i);
    expect(q(c, "plan-headline-goals")).not.toBeNull();
    expect(cardEl(c, "goals").textContent).toContain(locale === "en" ? "Goals" : "Doelen");
    unmount();
  }
});

test("CardsSection lists stated cards when no card account", () => {
  const { ctx, result } = cardsCtx();
  const store = richStore();
  ctx.profile.store = asClass(store, {
    statedCards: { value: ["ing-creditcard", "other"], source: "stated", at: AS_OF },
  });
  const c = mount(<CardsSection result={result} ctx={ctx} />);
  openAll(c);
  const t = q(c, "plan-cards-stated")!.textContent!;
  expect(t).toContain("ING creditcard");
  expect(t).toContain("Another card");
  unmount();
});

const currentAccount: Account = {
  key: "ing-pas",
  iban: "",
  name: "Betaalrekening",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: null,
};

/** The cards section as the app builds it: a real held-card list from `accounts`. */
function cardsFor(accounts: Account[], patch: Record<string, unknown>) {
  const store = asClass(richStore(), patch);
  const rich = richPlanInput(store);
  const input = {
    ...rich,
    accounts: [...rich.accounts, ...accounts],
    heldCards: buildHeldCards({
      accounts,
      facts: [],
      entries: CATALOGUE_ENTRIES,
      rewards: [],
      assumptionOn: false,
    }),
  };
  const base = computePlan(input);
  const { ctx } = cardsCtx();
  ctx.accounts = accounts;
  ctx.profile.store = store;
  return { ctx, result: base.sections.cards };
}

const statedPatch = {
  statedCards: { value: ["ing-creditcard"], source: "stated", at: AS_OF },
};

test("M2: a real betaalrekening (no creditcard account) still shows the stated card and no contradicting note", () => {
  const { ctx, result } = cardsFor([currentAccount], statedPatch);
  expect(result.figures.criteria.some((r) => r.held)).toBe(true);
  const c = mount(<CardsSection result={result} ctx={ctx} />);
  openAll(c);
  expect(q(c, "plan-cards-stated")!.textContent).toContain("ING creditcard");
  expect(c.textContent).not.toContain("No card has been entered");
  expect(c.textContent).not.toContain("is not known, so there is nothing to compare");
  expect(c.textContent).not.toContain("There is no card data");
  expect(c.textContent).toContain("not in your bank data");
  unmount();
});

test("S3: with no bank data at all, the stated list is not followed by 'no card entered'", () => {
  const { ctx, result } = cardsFor([], statedPatch);
  const c = mount(<CardsSection result={result} ctx={ctx} />);
  openAll(c);
  expect(q(c, "plan-cards-stated")).not.toBeNull();
  expect(c.textContent).not.toContain("No card has been entered");
  expect(c.textContent).not.toContain("There is no card data");
  expect(c.textContent).not.toContain("There are no cards to show");
  unmount();
});

test("M2: a real creditcard account hides the stated list (the bank data is the source)", () => {
  const cc: Account = { ...currentAccount, key: "abn-cc", name: "Creditcard", type: "Creditcard" };
  const { ctx, result } = cardsFor([cc], statedPatch);
  const c = mount(<CardsSection result={result} ctx={ctx} />);
  openAll(c);
  expect(q(c, "plan-cards-stated")).toBeNull();
  unmount();
});
