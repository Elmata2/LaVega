import { expect, test } from "vitest";
import {
  AdvisorProfile,
  commitProfile,
  emptyProfile,
  emptyProfileStore,
  removeDerived,
} from "./profile.js";
import {
  mergeEvents,
  mergeLearning,
  mergePlan,
  mergeProfileStores,
  profileUpdatedAt,
  type VaultEvent,
} from "./vaultSections.js";

const ev = (id: string, at: string, extra: Record<string, unknown> = {}): VaultEvent => ({
  id,
  kind: "plan",
  at,
  ...extra,
});

test("mergeEvents unions by id, is idempotent and order-independent, keeps unknown kinds and payload", () => {
  const a = [ev("1", "2026-10-01"), ev("2", "2026-10-02", { kind: "future-kind", n: 7 })];
  const b = [ev("2", "2026-10-02", { kind: "future-kind", n: 7 }), ev("3", "2026-10-03")];
  const m = mergeEvents(a, b);
  expect(m.map((e) => e.id)).toEqual(["1", "2", "3"]);
  expect(m[1]).toMatchObject({ kind: "future-kind", n: 7 });
  expect(mergeEvents(m, m)).toEqual(m);
  expect(mergeEvents(b, a)).toEqual(m);
  expect(mergeEvents(m, a)).toEqual(m);
});

test("plan: preferences newest wins; snapshots per month newest wins; 13 newest months kept", () => {
  const snaps = (months: string[], at: string) =>
    Object.fromEntries(months.map((m) => [m, { at, value: m + at }]));
  const months = Array.from({ length: 14 }, (_, i) =>
    `2025-${String(i + 1).padStart(2, "0")}`
      .replace("2025-13", "2026-01")
      .replace("2025-14", "2026-02"),
  );
  const a = {
    preferences: { at: "2026-10-01", value: "old" },
    snapshots: snaps(months.slice(0, 8), "2026-10-01"),
  };
  const b = {
    preferences: { at: "2026-10-05", value: "new" },
    snapshots: { ...snaps(months.slice(6), "2026-10-05") },
  };
  const m = mergePlan(a, b);
  expect(m.preferences?.value).toBe("new");
  expect(Object.keys(m.snapshots)).toHaveLength(13);
  expect(Object.keys(m.snapshots)).not.toContain("2025-01");
  expect(m.snapshots["2025-07"]!.at).toBe("2026-10-05");
  expect(mergePlan(b, a)).toEqual(m);
  expect(mergePlan({ preferences: null, snapshots: {} }, a).preferences?.value).toBe("old");
});

test("learning: newest write wins per concept id", () => {
  const m = mergeLearning(
    { x: { at: "2026-10-01", value: 1 }, y: { at: "2026-10-09", value: "keep" } },
    { x: { at: "2026-10-02", value: 2 }, z: { at: "2026-10-01", value: 3 } },
  );
  expect(m).toEqual({
    x: { at: "2026-10-02", value: 2 },
    y: { at: "2026-10-09", value: "keep" },
    z: { at: "2026-10-01", value: 3 },
  });
});

test("profile: newest current wins; histories unite, deduped, newest first, capped at 10", () => {
  const p = (w: string, at: string) =>
    new AdvisorProfile({ ...emptyProfile(), worries: { value: w, source: "stated", at } });
  const day = (i: number) => `2026-10-${String(i + 1).padStart(2, "0")}`;
  let a = emptyProfileStore();
  for (let i = 0; i < 8; i++) a = commitProfile(a, p(`a${i}`, day(i)), `${day(i)}T10:00:00Z`);
  let b = commitProfile(emptyProfileStore(), p("b", day(20)), `${day(20)}T10:00:00Z`);
  b = commitProfile(b, p("b2", day(21)), `${day(21)}T10:00:00Z`);
  const m = mergeProfileStores(a, b);
  expect(m.current.worries?.value).toBe("b2");
  expect(m.versions[0]!.worries?.value).toBe("b");
  expect(m.versions).toHaveLength(10);
  expect(mergeProfileStores(b, a)).toEqual(m);
  expect(mergeProfileStores(m, m)).toEqual(m);
});

test("profile: a remove-only write (no fact `at` changes) wins over an older store", () => {
  const base = new AdvisorProfile({
    ...emptyProfile(),
    worries: { value: "w", source: "stated", at: "2026-10-01" },
  });
  const older = commitProfile(emptyProfileStore(), base, "2026-10-01T10:00:00Z");
  const removed = commitProfile(older, removeDerived(base, "fp1"), "2026-10-05T10:00:00Z");
  const m = mergeProfileStores(older, removed);
  expect(m.current.removed).toEqual(["fp1"]);
  expect(m.updatedAt).toBe("2026-10-05T10:00:00Z");
  expect(mergeProfileStores(removed, older)).toEqual(m);
});

test("profileUpdatedAt sees work and statedCards", () => {
  const base = emptyProfile();
  const w = new AdvisorProfile({
    ...base,
    work: { value: ["employed"], source: "stated", at: "2026-10-20" },
  });
  expect(profileUpdatedAt(w)).toBe("2026-10-20");
  const later = new AdvisorProfile({
    ...w,
    statedCards: { value: ["other"], source: "stated", at: "2026-10-25" },
  });
  expect(profileUpdatedAt(later)).toBe("2026-10-25");
  const laterWork = new AdvisorProfile({
    ...later,
    work: { value: ["student"], source: "stated", at: "2026-10-27" },
  });
  expect(profileUpdatedAt(laterWork)).toBe("2026-10-27");
});
