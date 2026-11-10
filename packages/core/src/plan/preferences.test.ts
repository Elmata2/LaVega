import { expect, test } from "vitest";
import { mergeEvents, type PlanSection, type VaultEvent } from "../advisor/vaultSections.js";
import {
  PlanDecodeError,
  addSnapshot,
  changeBaseline,
  decodePlanState,
  emptyPlanPreferences,
  encodePlanState,
  subscriptionStateOf,
  goalAnchorsOf,
  goalAnchorEventOf,
  planEventOf,
  type PlanSnapshot,
} from "./preferences.js";

const dec = (id: string, at: string, streamKey: string, decision: string): VaultEvent => ({
  id,
  kind: "subscription-decision",
  at,
  streamKey,
  decision,
});
const use = (id: string, at: string, streamKey: string, month: string): VaultEvent => ({
  id,
  kind: "usage-log",
  at,
  streamKey,
  month,
});

test("subscriptionStateOf: latest decision wins, clear resets, usage months unique and sorted", () => {
  const events = [
    dec("b", "2026-10-02", "netflix", "cancel"),
    dec("a", "2026-10-01", "netflix", "keep"),
    dec("c", "2026-10-03", "spotify", "review"),
    dec("d", "2026-10-04", "spotify", "clear"),
    use("u1", "2026-10-05", "netflix", "2026-09"),
    use("u2", "2026-10-06", "netflix", "2026-08"),
    use("u3", "2026-10-07", "netflix", "2026-09"),
    // same `at`: the higher id wins
    dec("x2", "2026-10-09", "ziggo", "cancel"),
    dec("x1", "2026-10-09", "ziggo", "keep"),
  ];
  const s = subscriptionStateOf(events);
  expect(s.get("netflix")).toEqual({
    decision: "cancel",
    usedMonths: ["2026-08", "2026-09"],
  });
  expect(s.get("spotify")).toEqual({ decision: null, usedMonths: [] });
  expect(s.get("ziggo")?.decision).toBe("cancel");
});

test("mergeEvents of two devices holding the same event id yields one event; state identical both orders", () => {
  const a = [dec("1", "2026-10-01", "n", "keep"), use("2", "2026-10-02", "n", "2026-09")];
  const b = [dec("1", "2026-10-01", "n", "keep"), dec("3", "2026-10-03", "n", "review")];
  const ab = mergeEvents(a, b);
  const ba = mergeEvents(b, a);
  expect(ab.filter((e) => e.id === "1")).toHaveLength(1);
  expect(subscriptionStateOf(ab)).toEqual(subscriptionStateOf(ba));
  expect(subscriptionStateOf(ab).get("n")).toEqual({
    decision: "review",
    usedMonths: ["2026-09"],
  });
});

test("decision for a streamKey that no longer exists is kept in state but never throws", () => {
  const s = subscriptionStateOf([dec("1", "2026-10-01", "gone-key", "cancel")]);
  expect(s.get("gone-key")?.decision).toBe("cancel");
});

test("unknown kinds and malformed plan events are ignored", () => {
  const events: VaultEvent[] = [
    { id: "e1", kind: "explanation", at: "2026-10-01", text: "x" },
    { id: "e2", kind: "outcome", at: "2026-10-02", ok: true },
    {
      id: "e3",
      kind: "subscription-decision",
      at: "2026-10-03",
      streamKey: "n",
      decision: "zzz",
    },
    {
      id: "e4",
      kind: "usage-log",
      at: "2026-10-03",
      streamKey: "n",
      month: "oct",
    },
    dec("e5", "2026-10-04", "n", "keep"),
  ];
  expect(subscriptionStateOf(events)).toEqual(
    new Map([["n", { decision: "keep", usedMonths: [] }]]),
  );
});

test("decodePlanState(undefined) and an empty section are empty", () => {
  expect(decodePlanState(undefined)).toEqual({
    preferences: emptyPlanPreferences(),
    snapshots: [],
  });
  expect(decodePlanState({ preferences: null, snapshots: {} })).toEqual({
    preferences: emptyPlanPreferences(),
    snapshots: [],
  });
});

const snap = (asOf: string): PlanSnapshot => ({
  asOf,
  thresholdsVersion: "plan-thresholds-1",
  engineVersion: "plan-1",
  profileHash: "h",
  trigger: "manual",
  sections: Object.fromEntries(
    ["month", "buffer", "debts", "spending", "subscriptions", "cards", "goals"].map((id) => [
      id,
      {
        status: "on-track",
        statusReason: { key: "room-ok" },
        flat: { x: { unit: "cents", value: 100 } },
      },
    ]),
  ) as unknown as PlanSnapshot["sections"],
  markers: {
    incomeMedianCents: null,
    incomeStreamIds: [],
    flaggedIncreaseKeys: [],
    goalsWithin12m: [],
    debtIds: [],
    childCount: 0,
    cardKeys: [],
    pointsProgramIds: [],
    bufferBelowWish: false,
  },
});

test("addSnapshot keeps 13, one per month, and the first snapshot of a month is never replaced", () => {
  let list: PlanSnapshot[] = [];
  for (let i = 0; i < 15; i++) {
    const y = 2025 + Math.floor((i + 8) / 12);
    const m = ((i + 8) % 12) + 1;
    list = addSnapshot(list, snap(`${y}-${String(m).padStart(2, "0")}-05`));
  }
  expect(list).toHaveLength(13);
  expect(list[0]!.asOf).toBe("2025-11-05");
  const again = addSnapshot(list, {
    ...snap("2026-11-20"),
    profileHash: "second",
  });
  expect(again).toHaveLength(13);
  expect(again.at(-1)).toMatchObject({ asOf: "2026-11-05", profileHash: "h" });
  expect(again.some((s) => s.profileHash === "second")).toBe(false);
});

test("addSnapshot does not store a snapshot dated before the newest stored one (lagging clock)", () => {
  const list = [snap("2026-09-05"), snap("2026-10-16")];
  const out = addSnapshot(list, { ...snap("2026-09-28"), profileHash: "late" });
  expect(out.map((s) => s.asOf)).toEqual(["2026-09-05", "2026-10-16"]);
  expect(out.some((s) => s.profileHash === "late")).toBe(false);
  // a later day in the newest month changes nothing: the month keeps its first
  expect(addSnapshot(list, snap("2026-10-20")).map((s) => s.asOf)).toEqual([
    "2026-09-05",
    "2026-10-16",
  ]);
  expect(addSnapshot(list, snap("2026-11-01")).map((s) => s.asOf)).toEqual([
    "2026-09-05",
    "2026-10-16",
    "2026-11-01",
  ]);
});

test("changeBaseline: the newest snapshot from an earlier month, else this month's first", () => {
  const list = [snap("2026-08-05"), snap("2026-09-05"), snap("2026-10-02")];
  const earlier = changeBaseline(list, "2026-10-16");
  expect(earlier?.snapshot.asOf).toBe("2026-09-05");
  expect(earlier?.kind).toBe("earlier-month");
  const first = changeBaseline(list.slice(2), "2026-10-16");
  expect(first?.snapshot.asOf).toBe("2026-10-02");
  expect(first?.kind).toBe("first-this-month");
  expect(changeBaseline([], "2026-10-16")).toBeNull();
  expect(changeBaseline(list, "2026-11-01")?.snapshot.asOf).toBe("2026-10-02");
  // nothing stored for this month or earlier (a clock behind every snapshot)
  expect(changeBaseline(list.slice(2), "2026-09-28")).toBeNull();
});

test("state round-trips through the vault section and JSON", () => {
  const prefs = {
    ...emptyPlanPreferences(),
    categoryLimits: { Boodschappen: { cents: 40000, at: "2026-10-01" } },
  };
  const section = encodePlanState(
    { preferences: prefs, snapshots: [snap("2026-10-05")] },
    "2026-10-24",
  );
  const viaJson = JSON.parse(JSON.stringify(section)) as PlanSection;
  const back = decodePlanState(viaJson);
  expect(back.preferences).toEqual(prefs);
  expect(back.snapshots).toEqual([snap("2026-10-05")]);
  expect(Object.keys(section.snapshots)).toEqual(["2026-10"]);
});

test("PlanPreferences decode rejects non-integer cents", () => {
  const bad: PlanSection = {
    preferences: {
      at: "2026-10-01",
      value: {
        ...emptyPlanPreferences(),
        categoryLimits: { A: { cents: 10.5, at: "2026-10-01" } },
      },
    },
    snapshots: {},
  };
  expect(() => decodePlanState(bad)).toThrow(PlanDecodeError);
});

test("one undecodable snapshot is dropped, preferences and other snapshots survive", () => {
  const good = encodePlanState(
    {
      preferences: emptyPlanPreferences(),
      snapshots: [snap("2026-09-05"), snap("2026-10-05")],
    },
    "2026-10-24",
  );
  const broken: PlanSection = {
    ...good,
    snapshots: {
      ...good.snapshots,
      "2026-08": { at: "2026-08-05", value: { nonsense: true } },
    },
  };
  const back = decodePlanState(broken);
  expect(back.snapshots.map((s) => s.asOf)).toEqual(["2026-09-05", "2026-10-05"]);
  expect(back.preferences).toEqual(emptyPlanPreferences());
});

test("goal anchors: the latest (at, id) per goal wins, order does not matter, other kinds are ignored", () => {
  const a = goalAnchorEventOf({ goalId: "g1", at: "2026-01-05", startCents: 0, first: true });
  const b = goalAnchorEventOf({
    goalId: "g1",
    at: "2026-10-20",
    startCents: 900_000,
    first: false,
    nonce: "x",
  });
  const other = goalAnchorEventOf({
    goalId: "g2",
    at: "2026-03-01",
    startCents: 5_000,
    first: true,
  });
  const noise = dec("d1", "2026-12-01", "k", "keep");
  const forward = goalAnchorsOf([a, b, other, noise]);
  expect(forward).toEqual({
    g1: { at: "2026-10-20", startCents: 900_000 },
    g2: { at: "2026-03-01", startCents: 5_000 },
  });
  expect(goalAnchorsOf([noise, other, b, a])).toEqual(forward);
  expect(goalAnchorsOf(mergeEvents([a], [b, a]))).toEqual(goalAnchorsOf([a, b]));
});

test("goal-anchor events survive planEventOf; a malformed one does not", () => {
  const e = goalAnchorEventOf({ goalId: "g1", at: "2026-01-05", startCents: 100, first: true });
  expect(planEventOf(e)).toMatchObject({ kind: "goal-anchor", goalId: "g1", startCents: 100 });
  expect(planEventOf({ ...e, startCents: 1.5 })).toBeNull();
  expect(planEventOf({ ...e, goalId: "" })).toBeNull();
});

test("subscription state ignores goal-anchor events", () => {
  const e = goalAnchorEventOf({ goalId: "g1", at: "2026-01-05", startCents: 100, first: true });
  expect(subscriptionStateOf([e, dec("d1", "2026-02-01", "k", "keep")]).get("k")?.decision).toBe(
    "keep",
  );
  expect(subscriptionStateOf([e]).size).toBe(0);
});
