import { expect, test } from "vitest";

export type Progress = {
  status: "idle" | "running" | "waiting" | "paused" | "completed" | "problem";
  leaseId?: string;
  updatedAt: string | null;
  total: number;
  completed: number;
  remainingSymbols: string[];
  currentSymbol: string | null;
  waitUntil: string | null;
  message: string | null;
  problems: string[];
};
export type LeaseStore = {
  get(tenantId: string): Promise<Progress | null>;
  claim(tenantId: string, progress: Progress, staleBefore: string): Promise<Progress | null>;
  put(tenantId: string, progress: Progress, leaseId: string): Promise<boolean>;
};

const at = (milliseconds: number) => new Date(milliseconds).toISOString();
const progress = (leaseId: string, updatedAt = at(1_000)): Progress => ({
  status: "running",
  leaseId,
  updatedAt,
  total: 1,
  completed: 0,
  remainingSymbols: ["ONE"],
  currentSymbol: "ONE",
  waitUntil: null,
  message: null,
  problems: [],
});

/** Run identical observable lease behavior against memory and SQL backed stores. */
export function priceSyncLeaseContract(name: string, createStore: () => LeaseStore) {
  test(`${name}: fresh owner blocks claim and foreign writes`, async () => {
    const store = createStore();
    const first = progress("first");
    expect(await store.claim("tenant", first, at(0))).toBeNull();
    expect(await store.claim("tenant", progress("second", at(2_000)), at(500))).toEqual(first);
    expect(await store.put("tenant", { ...first, status: "completed" }, "second")).toBe(false);
    expect(await store.get("tenant")).toEqual(first);
  });

  test(`${name}: owner can commit and completed row can be claimed`, async () => {
    const store = createStore();
    const first = progress("first");
    expect(await store.claim("tenant", first, at(0))).toBeNull();
    const completed = { ...first, status: "completed" as const };
    expect(await store.put("tenant", completed, "first")).toBe(true);
    expect(await store.get("tenant")).toEqual(completed);
    const second = progress("second", at(2_000));
    expect(await store.claim("tenant", second, at(500))).toBeNull();
    expect(await store.get("tenant")).toEqual(second);
  });

  test(`${name}: stale takeover rejects old owner even after new owner commits`, async () => {
    const store = createStore();
    const first = progress("first");
    expect(await store.claim("tenant", first, at(0))).toBeNull();
    const second = progress("second", at(40_000));
    expect(await store.claim("tenant", second, at(10_000))).toBeNull();
    expect(await store.put("tenant", { ...first, status: "completed" }, "first")).toBe(false);
    const updated = { ...second, status: "waiting" as const };
    expect(await store.put("tenant", updated, "second")).toBe(true);
    expect(await store.get("tenant")).toEqual(updated);
  });
}
