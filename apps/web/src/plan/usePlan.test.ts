// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  AdvisorProfile,
  decodePlanState,
  emptyPlanPreferences,
  emptyPlanSection,
  emptyProfileStore,
  goalAnchorsOf,
  mergeEvents,
  ownAccounts,
  type Account,
  type AdvisorProfileStore,
  type PlanSection,
  type Tx,
  type VaultEvent,
} from "@lavega/core";
import { usePlan, type PlanStorage, type UsePlanInput } from "./usePlan";
import { useGoalAnchors } from "./sections/useGoalAnchors";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-10-24";

const account: Account = {
  key: "A1",
  iban: "",
  name: "A1",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: null,
};
let n = 0;
const tx = (counterparty: string, date: string, amount: number): Tx => ({
  id: `t${n++}`,
  accountKey: "A1",
  date,
  amount,
  currency: "EUR",
  counterparty,
  description: "",
  category: "",
  manual: false,
});
/** One Netflix charge on the 5th of each month from 2026-04. */
const netflix = (amounts: number[]): Tx[] =>
  amounts.map((a, k) => tx("Netflix", `2026-${String(4 + k).padStart(2, "0")}-05`, -a));
const FLAT = netflix([9.99, 9.99, 9.99, 9.99, 9.99, 9.99, 9.99]);
const UP = netflix([9.99, 9.99, 9.99, 9.99, 11.79, 11.79, 11.79]);

function memStorage(init: { plan?: PlanSection; events?: VaultEvent[] } = {}) {
  let plan = init.plan ?? emptyPlanSection();
  let events = init.events ?? [];
  const puts: PlanSection[] = [];
  const storage = {
    getSection: vi.fn(async (name: string) => structuredClone(name === "plan" ? plan : events)),
    putSection: vi.fn(async (_name: string, value: PlanSection) => {
      plan = structuredClone(value);
      puts.push(structuredClone(value));
    }),
    appendEvents: vi.fn(async (e: readonly VaultEvent[]) => {
      events = mergeEvents(events, e);
    }),
  };
  return {
    storage: storage as unknown as PlanStorage,
    puts,
    plan: () => plan,
    events: () => events,
  };
}

const baseInput = (storage: PlanStorage, over: Partial<UsePlanInput> = {}): UsePlanInput => ({
  store: null,
  storage,
  accounts: [account],
  txs: FLAT,
  entityProfiles: [],
  rules: [],
  own: ownAccounts([account]),
  rewards: [],
  facts: [],
  catalogue: [],
  rates: [],
  mode: "separate",
  fxHistory: {},
  asOf: AS_OF,
  ...over,
});

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

function mount(input: UsePlanInput) {
  const out = { current: null as unknown as ReturnType<typeof usePlan> };
  function Probe(p: { input: UsePlanInput }) {
    const value = usePlan(p.input);
    useEffect(() => {
      out.current = value;
    });
    return null;
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(Probe, { input })));
  return {
    out,
    rerender: (next: UsePlanInput) =>
      act(() => root!.render(createElement(Probe, { input: next }))),
    unmount: () => {
      act(() => root!.unmount());
      root = null;
    },
  };
}
const settle = () =>
  act(async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  });

const debtStore = (balanceCents: number): AdvisorProfileStore => ({
  ...emptyProfileStore("2026-10-01"),
  current: new AdvisorProfile({
    removed: [],
    intake: { blocksDone: 2, step0: null },
    debts: [
      {
        id: "d1",
        lender: "Bank",
        monthlyCents: 30_000,
        balanceCents,
        ratePct: 9.5,
        source: "confirmed",
        at: "2026-10-01",
      },
    ],
  }),
});

test("legacy vault: empty preferences, no crash, first open stores one new-month snapshot", async () => {
  const mem = memStorage();
  const h = mount(baseInput(mem.storage));
  await settle();
  expect(h.out.current.preferences).toEqual(emptyPlanPreferences());
  expect(h.out.current.result.asOf).toBe(AS_OF);
  expect(mem.puts).toHaveLength(1);
  const state = decodePlanState(mem.puts[0]);
  expect(state.snapshots).toHaveLength(1);
  expect(state.snapshots[0]!.trigger).toBe("new-month");
  expect(mem.puts[0]!.preferences).toBeNull();
});

test("nothing is stored before the app data is ready", async () => {
  const mem = memStorage();
  const h = mount(baseInput(mem.storage, { ready: false }));
  await settle();
  expect(mem.puts).toHaveLength(0);
  h.rerender(baseInput(mem.storage, { ready: true }));
  await settle();
  expect(mem.puts).toHaveLength(1);
});

test("opening again in the same month stores nothing, and a mid-month input change does not replace the stored snapshot", async () => {
  const mem = memStorage();
  const first = mount(baseInput(mem.storage));
  await settle();
  expect(mem.puts).toHaveLength(1);
  first.unmount();

  const second = mount(baseInput(mem.storage));
  await settle();
  expect(mem.puts).toHaveLength(1);

  second.rerender(baseInput(mem.storage, { txs: UP }));
  await settle();
  expect(mem.puts).toHaveLength(1);
  const snaps = decodePlanState(mem.puts[0]).snapshots;
  expect(snaps).toHaveLength(1);
  expect(snaps[0]!.trigger).toBe("new-month");
});

test("recompute() moves the plan to today without replacing the month's first snapshot", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-27T09:00:00Z") });
  const mem = memStorage();
  const h = mount(baseInput(mem.storage));
  await settle();
  expect(mem.puts).toHaveLength(1);
  await act(async () => {
    await h.out.current.recompute();
  });
  await settle();
  expect(mem.puts).toHaveLength(1);
  expect(decodePlanState(mem.puts[0]).snapshots.map((s) => s.asOf)).toEqual([AS_OF]);
  expect(h.out.current.result.asOf).toBe("2026-10-27");
});

test("appendPlanEvent twice with the same id results in one event", async () => {
  const mem = memStorage();
  const h = mount(baseInput(mem.storage));
  await settle();
  const e = {
    id: "e1",
    kind: "subscription-decision" as const,
    at: "2026-10-24T10:00:00Z",
    streamKey: "netflix|out|999",
    decision: "keep" as const,
  };
  await act(async () => {
    await h.out.current.appendPlanEvent(e);
    await h.out.current.appendPlanEvent(e);
  });
  expect(h.out.current.events).toHaveLength(1);
  expect(mem.events()).toHaveLength(1);
});

test("fresh vault: an edit shows as a change since the first plan this month, and a reload shows the same", async () => {
  const mem = memStorage();
  const h = mount(baseInput(mem.storage, { store: debtStore(1_200_000) }));
  await settle();
  expect(mem.puts).toHaveLength(1);
  expect(h.out.current.changes.baseline).toBe(true); // the first plan: nothing yet to compare
  h.rerender(baseInput(mem.storage, { store: debtStore(800_000) }));
  await settle();
  // the stored snapshot stays the month's first
  expect(mem.puts).toHaveLength(1);
  const live = h.out.current.changes;
  expect(live.baseline).toBe(false);
  expect(live.changes.some((c) => c.section === "debts" && c.reason.key === "profile-edited")).toBe(
    true,
  );
  expect(h.out.current.changesSince).toEqual({ kind: "first-this-month" });
  h.unmount();
  const again = mount(baseInput(mem.storage, { store: debtStore(800_000) }));
  await settle();
  expect(again.out.current.changes).toEqual(live);
  expect(again.out.current.changesSince).toEqual({ kind: "first-this-month" });
});

test("next month the change log compares with last month's snapshot, live and after a reload", async () => {
  const mem = memStorage();
  const h = mount(baseInput(mem.storage, { store: debtStore(1_200_000), asOf: "2026-09-20" }));
  await settle();
  h.rerender(baseInput(mem.storage, { store: debtStore(1_200_000) }));
  await settle();
  expect(decodePlanState(mem.plan()).snapshots.map((s) => s.asOf.slice(0, 7))).toEqual([
    "2026-09",
    "2026-10",
  ]);
  h.rerender(baseInput(mem.storage, { store: debtStore(800_000) }));
  await settle();
  const live = h.out.current.changes;
  expect(live.baseline).toBe(false);
  expect(live.changes.some((c) => c.section === "debts" && c.reason.key === "profile-edited")).toBe(
    true,
  );
  expect(h.out.current.changesSince).toEqual({ kind: "earlier-month", month: "2026-09" });
  // October's stored snapshot is still the first one of October
  const stored = decodePlanState(mem.plan()).snapshots;
  expect(stored).toHaveLength(2);
  expect(stored[1]!.asOf).toBe(AS_OF);
  h.unmount();
  const again = mount(baseInput(mem.storage, { store: debtStore(800_000) }));
  await settle();
  expect(again.out.current.changes).toEqual(live);
});

test("explanation and outcome events in the log do not break subscription state", async () => {
  const mem = memStorage({
    events: [
      { id: "x1", kind: "explanation", at: "2026-10-01T00:00:00Z", text: "hi" },
      { id: "x2", kind: "outcome", at: "2026-10-02T00:00:00Z" },
    ],
  });
  const h = mount(baseInput(mem.storage));
  await settle();
  const key = h.out.current.result.sections.subscriptions.figures.rows[0]!.key;
  await act(async () => {
    await h.out.current.appendPlanEvent({
      id: "d1",
      kind: "subscription-decision",
      at: "2026-10-24T10:00:00Z",
      streamKey: key,
      decision: "keep",
    });
  });
  await settle();
  expect(h.out.current.events).toHaveLength(3);
  expect(h.out.current.result.sections.subscriptions.figures.rows[0]!.decision).toBe("keep");
});

test("setPreference merges, keeps the rest and stamps the preferences", async () => {
  const mem = memStorage();
  const h = mount(baseInput(mem.storage));
  await settle();
  await act(async () => {
    await h.out.current.setPreference({ bufferTopUpMonths: { months: 2, at: AS_OF } });
  });
  expect(h.out.current.preferences.bufferTopUpMonths).toEqual({ months: 2, at: AS_OF });
  expect(h.out.current.preferences.categoryLimits).toEqual({});
  const stored = mem.plan();
  expect(stored.preferences).not.toBeNull();
  expect(decodePlanState(stored).preferences.bufferTopUpMonths?.months).toBe(2);
});

test("a stored plan section that cannot be decoded is not overwritten", async () => {
  const bad: PlanSection = {
    preferences: { at: "2026-10-01", value: { categoryLimits: 5 } },
    snapshots: {},
  };
  const mem = memStorage({ plan: bad });
  const h = mount(baseInput(mem.storage));
  await settle();
  expect(h.out.current.stateError).toBe(true);
  expect(mem.puts).toHaveLength(0);
  await act(async () => {
    await expect(
      h.out.current.setPreference({ bufferTopUpMonths: { months: 1, at: AS_OF } }),
    ).rejects.toThrow();
  });
  expect(mem.puts).toHaveLength(0);
  expect(h.out.current.preferences.bufferTopUpMonths).toBeNull();
});

test("two un-awaited setPreference calls both persist, in the UI and in the stored section", async () => {
  const mem = memStorage();
  const h = mount(baseInput(mem.storage));
  await settle();
  await act(async () => {
    await Promise.all([
      h.out.current.setPreference({ pointsExpiry: { p: "2027-01-01" } }),
      h.out.current.setPreference({ bufferTopUpMonths: { months: 2, at: AS_OF } }),
    ]);
  });
  await settle();
  for (const prefs of [h.out.current.preferences, decodePlanState(mem.plan()).preferences]) {
    expect(prefs.pointsExpiry).toEqual({ p: "2027-01-01" });
    expect(prefs.bufferTopUpMonths?.months).toBe(2);
  }
});

test("setPreference during the first snapshot store keeps both", async () => {
  const mem = memStorage();
  const input = baseInput(mem.storage, { ready: false });
  const h = mount(input);
  await settle();
  let pending: Promise<void> = Promise.resolve();
  act(() => {
    h.rerender(baseInput(mem.storage, { ready: true }));
  });
  await act(async () => {
    pending = h.out.current.setPreference({ pointsExpiry: { p: "2027-01-01" } });
    await pending;
  });
  await settle();
  const state = decodePlanState(mem.plan());
  expect(state.snapshots).toHaveLength(1);
  expect(state.preferences.pointsExpiry).toEqual({ p: "2027-01-01" });
});

test("a failed write rolls the state back, sets the error flag and leaves no unhandled rejection", async () => {
  const mem = memStorage();
  (mem.storage.putSection as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
    new Error("locked"),
  );
  const h = mount(baseInput(mem.storage));
  await settle();
  expect(h.out.current.writeError).toBe(true);
  (mem.storage.putSection as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
    new Error("locked"),
  );
  await act(async () => {
    await expect(
      h.out.current.setPreference({ pointsExpiry: { p: "2027-01-01" } }),
    ).rejects.toThrow("locked");
  });
  expect(h.out.current.preferences.pointsExpiry).toEqual({});
  expect(h.out.current.writeError).toBe(true);
});

test("a failed appendEvents drops the local event again", async () => {
  const mem = memStorage();
  const h = mount(baseInput(mem.storage));
  await settle();
  (mem.storage.appendEvents as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
    new Error("locked"),
  );
  await act(async () => {
    await expect(
      h.out.current.appendPlanEvent({
        id: "e9",
        kind: "usage-log",
        at: "2026-10-24T10:00:00Z",
        streamKey: "k",
        month: "2026-10",
      }),
    ).rejects.toThrow("locked");
  });
  expect(h.out.current.events).toHaveLength(0);
});

test("a getSection rejection on load is a stateError, not an unhandled rejection", async () => {
  const mem = memStorage();
  (mem.storage.getSection as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
    new Error("locked"),
  );
  const h = mount(baseInput(mem.storage));
  await settle();
  expect(h.out.current.stateError).toBe(true);
  expect(mem.puts).toHaveLength(0);
  await act(async () => {
    await expect(h.out.current.setPreference({ pointsExpiry: {} })).rejects.toThrow();
  });
});

test("recompute() with an undecodable plan section writes nothing and rejects", async () => {
  const bad: PlanSection = {
    preferences: { at: "2026-10-01", value: { categoryLimits: 5 } },
    snapshots: {},
  };
  const mem = memStorage({ plan: bad });
  const h = mount(baseInput(mem.storage));
  await settle();
  await act(async () => {
    await expect(h.out.current.recompute()).rejects.toThrow();
  });
  expect(mem.puts).toHaveLength(0);
});

test("an op queued for the old storage is dropped when the storage changed", async () => {
  const a = memStorage();
  const b = memStorage();
  const h = mount(baseInput(a.storage));
  await settle();
  let pending: Promise<void> = Promise.resolve();
  act(() => {
    pending = h.out.current.setPreference({ pointsExpiry: { p: "2027-01-01" } });
    pending.catch(() => {});
  });
  h.rerender(baseInput(b.storage));
  await settle();
  await expect(pending).rejects.toThrow();
  expect(a.puts.filter((p) => p.preferences !== null)).toHaveLength(0);
  expect(b.puts.some((p) => p.preferences !== null)).toBe(false);
});

test("a failed snapshot write keeps nothing: no stored snapshot, no change log", async () => {
  const mem = memStorage();
  (mem.storage.putSection as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
    new Error("x"),
  );
  const h = mount(baseInput(mem.storage, { store: debtStore(1_200_000) }));
  await settle();
  expect(h.out.current.writeError).toBe(true);
  expect(h.out.current.changes.baseline).toBe(true);
  expect(h.out.current.changesSince).toBeNull();
});

// ---- Task 12 fix round: function patches, empty patch, loaded, goalSince on the real hook ----

test("loaded is false before the stored state is read and true after", async () => {
  const mem = memStorage();
  const h = mount(baseInput(mem.storage));
  expect(h.out.current.loaded).toBe(false);
  await settle();
  expect(h.out.current.loaded).toBe(true);
});

test("two function patches queued back to back both land: the second sees the first", async () => {
  const mem = memStorage();
  const h = mount(baseInput(mem.storage));
  await settle();
  await act(async () => {
    const a = h.out.current.setPreference((cur) => ({
      pointsExpiry: { ...cur.pointsExpiry, p1: "2027-01-01" },
    }));
    const b = h.out.current.setPreference((cur) => ({
      pointsExpiry: { ...cur.pointsExpiry, p2: "2027-02-02" },
    }));
    await Promise.all([a, b]);
  });
  await settle();
  expect(h.out.current.preferences.pointsExpiry).toEqual({ p1: "2027-01-01", p2: "2027-02-02" });
  expect(decodePlanState(mem.plan()).preferences.pointsExpiry).toEqual({
    p1: "2027-01-01",
    p2: "2027-02-02",
  });
});

test("a patch that returns {} writes nothing", async () => {
  const mem = memStorage();
  const h = mount(baseInput(mem.storage));
  await settle();
  const before = mem.puts.length;
  await act(async () => {
    await h.out.current.setPreference(() => ({}));
    await h.out.current.setPreference({});
  });
  expect(mem.puts.length).toBe(before);
  expect(h.out.current.preferences).toEqual(emptyPlanPreferences());
});

test("useGoalAnchors on the real hook appends one first anchor per goal across re-renders and never overwrites", async () => {
  const goalStore = (at: string): AdvisorProfileStore => ({
    ...emptyProfileStore("2026-10-01"),
    current: new AdvisorProfile({
      removed: [],
      intake: { blocksDone: 3, step0: null },
      goals: [
        {
          value: {
            id: "g1",
            purpose: "Car",
            kind: "general",
            targetCents: 100000,
            targetDate: "2027-03-01",
            priority: "important",
            accountRefs: [],
          },
          source: "stated",
          at,
        },
      ],
    }),
  });
  const mem = memStorage();
  function Probe({ input }: { input: UsePlanInput }) {
    const plan = usePlan(input);
    useGoalAnchors(plan, input.store);
    return null;
  }
  const renderWith = (input: UsePlanInput) =>
    act(() => root!.render(createElement(Probe, { input })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  renderWith(baseInput(mem.storage, { store: goalStore("2026-01-01") }));
  await settle();
  const anchorEvents = () => mem.events().filter((e) => e.kind === "goal-anchor");
  expect(goalAnchorsOf(mem.events())).toEqual({ g1: { at: "2026-01-01", startCents: 0 } });
  expect(anchorEvents()).toHaveLength(1);
  // no preference was written for it: nothing to win a newest-wins merge
  expect(mem.puts.some((p) => p.preferences !== null)).toBe(false);
  // the goal is edited later (its Field.at moves) and the page re-renders
  renderWith(baseInput(mem.storage, { store: goalStore("2026-10-20") }));
  await settle();
  renderWith(baseInput(mem.storage, { store: goalStore("2026-10-20"), txs: UP }));
  await settle();
  expect(anchorEvents()).toHaveLength(1);
  expect(goalAnchorsOf(mem.events())).toEqual({ g1: { at: "2026-01-01", startCents: 0 } });
});
