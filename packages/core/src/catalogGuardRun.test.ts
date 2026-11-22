import { expect, test } from "vitest";
import type { CatalogValue } from "./catalog.js";
import { guardRun, type PendingMap } from "./catalogGuardRun.js";
import { mergeCatalogEntries, type MergeEntry } from "./catalogMerge.js";

const TODAY = "2026-11-23";

const val = (value: number, over: Partial<CatalogValue> = {}): CatalogValue => ({
  value,
  route: "provider-page",
  sourceUrl: "https://www.bank.test/tarieven",
  checkedAt: "2026-06-15",
  conditions: "A",
  conditionsKnown: true,
  ...over,
});

const entry = (
  id: string,
  fields: MergeEntry["fields"],
  over: Partial<MergeEntry> = {},
): MergeEntry => ({ id, product: id, issuer: "bank", fields, ...over });

const hosts = new Map([["bank", new Set(["www.bank.test"])]]);

const run = (
  prev: MergeEntry[],
  rows: MergeEntry[],
  pending: PendingMap = {},
  knownHosts = hosts,
) => guardRun({ prev, rows, knownHosts, pending, today: TODAY });

test("confirm keeps the old value and stamps confirmedAt", () => {
  const prev = [entry("p", { fxFeePct: val(1.4, { conditions: "A" }) })];
  const rows = [entry("p", { fxFeePct: val(1.4, { conditions: "B", checkedAt: TODAY }) })];
  const out = run(prev, rows);
  expect(out.rows[0]!.fields.fxFeePct).toEqual({
    ...val(1.4, { conditions: "A", checkedAt: "2026-06-15" }),
    confirmedAt: TODAY,
  });
});

test("publish writes the found value with confirmedAt", () => {
  const prev = [entry("p", { fxFeePct: val(1.4) })];
  const found = val(1.6, { checkedAt: TODAY, conditions: "B" });
  const out = run(prev, [entry("p", { fxFeePct: found })]);
  expect(out.rows[0]!.fields.fxFeePct).toEqual({ ...found, confirmedAt: TODAY });
  expect(out.verdicts[0]!.verdict).toEqual({ kind: "publish", viaPending: false });
});

test("hold omits the field and merge keeps the old value", () => {
  const old = val(1.4);
  const prev = [entry("p", { fxFeePct: old })];
  const found = val(1.5, { sourceUrl: "https://evil.test/x" });
  const out = run(prev, [entry("p", { fxFeePct: found })]);
  expect(out.rows[0]!.fields.fxFeePct).toBeUndefined();
  const merged = mergeCatalogEntries(prev, out.rows, ["p"]);
  expect(merged.entries[0]!.fields.fxFeePct).toEqual(old);
});

test("pending omits the field and records productId.field", () => {
  const prev = [entry("p", { fxFeePct: val(1.4) })];
  const out = run(prev, [entry("p", { fxFeePct: val(3, { checkedAt: TODAY }) })]);
  expect(out.rows[0]!.fields.fxFeePct).toBeUndefined();
  expect(out.pending).toEqual({ "p.fxFeePct": { value: 3, seenAt: TODAY } });
});

test("publish via pending clears the pending key", () => {
  const prev = [entry("p", { fxFeePct: val(1.4) })];
  const pending: PendingMap = { "p.fxFeePct": { value: 3, seenAt: "2026-11-16" } };
  const out = run(prev, [entry("p", { fxFeePct: val(3, { checkedAt: TODAY }) })], pending);
  expect(out.verdicts[0]!.verdict).toEqual({ kind: "publish", viaPending: true });
  expect(out.rows[0]!.fields.fxFeePct!.value).toBe(3);
  expect(out.pending).toEqual({});
});

test("hold clears a pending key for that field", () => {
  const prev = [entry("p", { fxFeePct: val(1.4) })];
  const pending: PendingMap = { "p.fxFeePct": { value: 3, seenAt: "2026-11-16" } };
  const found = val(3, { sourceUrl: "https://evil.test/x" });
  const out = run(prev, [entry("p", { fxFeePct: found })], pending);
  expect(out.verdicts[0]!.verdict.kind).toBe("hold");
  expect(out.pending).toEqual({});
});

test("confirm clears a pending key for that field", () => {
  const prev = [entry("p", { fxFeePct: val(1.4) })];
  const pending: PendingMap = { "p.fxFeePct": { value: 3, seenAt: "2026-11-16" } };
  const out = run(prev, [entry("p", { fxFeePct: val(1.4) })], pending);
  expect(out.pending).toEqual({});
});

test("pending for a product this run did not sweep is kept", () => {
  const prev = [entry("p", { fxFeePct: val(1.4) }), entry("q", { fxFeePct: val(1.4) })];
  const pending: PendingMap = { "q.fxFeePct": { value: 3, seenAt: "2026-11-16" } };
  const out = run(prev, [entry("p", { fxFeePct: val(1.4) })], pending);
  expect(out.pending).toEqual(pending);
});

test("unjudged field passes through untouched", () => {
  const prev = [entry("p", { fxFeePct: val(1.4) })];
  const found = val(2, { conditionsKnown: false });
  const out = run(prev, [entry("p", { fxFeePct: found })]);
  expect(out.rows[0]!.fields.fxFeePct).toEqual(found);
  expect(out.verdicts[0]!.verdict).toEqual({ kind: "unjudged" });
});

test("every measured field yields one FieldVerdict with before and found", () => {
  const before = val(1.4);
  const prev = [entry("p", { fxFeePct: before })];
  const found = val(1.4, { checkedAt: TODAY });
  const out = run(prev, [entry("p", { fxFeePct: found, interestPct: val(2) })]);
  expect(out.verdicts).toHaveLength(2);
  const fx = out.verdicts.find((v) => v.field === "fxFeePct")!;
  expect(fx).toMatchObject({ id: "p", product: "p", before, found, verdict: { kind: "confirm" } });
  const ir = out.verdicts.find((v) => v.field === "interestPct")!;
  expect(ir.before).toBeUndefined();
});

test("a row left with no fields is still returned", () => {
  const prev = [entry("p", { fxFeePct: val(1.4) })];
  const out = run(prev, [entry("p", { fxFeePct: val(1.5, { sourceUrl: "https://evil.test/x" }) })]);
  expect(out.rows).toHaveLength(1);
  expect(out.rows[0]!.fields).toEqual({});
});

test("hosts are looked up by the row's issuer, falling back to its id", () => {
  const map = new Map([
    ["bank", new Set(["www.bank.test"])],
    ["solo", new Set(["www.solo.test"])],
  ]);
  const a = entry("a", { fxFeePct: val(1.5) }, { issuer: "bank" });
  const b = entry(
    "solo",
    { fxFeePct: val(1.5, { sourceUrl: "https://www.solo.test/x" }) },
    {
      issuer: undefined,
    },
  );
  const c = entry("c", { fxFeePct: val(1.5) }, { issuer: "other" });
  const out = run([], [a, b, c], {}, map);
  expect(out.verdicts.map((v) => v.verdict.kind)).toEqual(["publish", "publish", "hold"]);
});

const ARCHIVE_URL = "https://web.archive.org/web/20250301000000/https://www.bank.test/tarieven";

test("archive read publishes with the snapshot date as confirmedAt", () => {
  const prev = [entry("p", { fxFeePct: val(1.4) })];
  const found = val(1.6, { sourceUrl: ARCHIVE_URL, checkedAt: "2025-03-01" });
  const out = run(prev, [entry("p", { fxFeePct: found })]);
  expect(out.rows[0]!.fields.fxFeePct).toEqual({ ...found, confirmedAt: "2025-03-01" });
});

test("archive read of the same value does not refresh confirmedAt past the snapshot date", () => {
  const prev = [entry("p", { fxFeePct: val(1.4, { confirmedAt: "2025-03-01" }) })];
  const found = val(1.4, { sourceUrl: ARCHIVE_URL, checkedAt: "2025-03-01" });
  const out = run(prev, [entry("p", { fxFeePct: found })]);
  expect(out.rows[0]!.fields.fxFeePct!.confirmedAt).toBe("2025-03-01");
});

test("confirm never moves confirmedAt backwards", () => {
  const prev = [entry("p", { fxFeePct: val(1.4, { confirmedAt: "2026-10-01" }) })];
  const found = val(1.4, { sourceUrl: ARCHIVE_URL, checkedAt: "2025-03-01" });
  const out = run(prev, [entry("p", { fxFeePct: found })]);
  expect(out.rows[0]!.fields.fxFeePct!.confirmedAt).toBe("2026-10-01");
});

test("confirm from an archive read with no earlier confirmedAt uses checkedAt as the floor", () => {
  const prev = [entry("p", { fxFeePct: val(1.4, { checkedAt: "2026-06-15" }) })];
  const found = val(1.4, { sourceUrl: ARCHIVE_URL, checkedAt: "2025-03-01" });
  const out = run(prev, [entry("p", { fxFeePct: found })]);
  expect(out.rows[0]!.fields.fxFeePct!.confirmedAt).toBe("2026-06-15");
});

test("uncovered equal read keeps stored conditions and source", () => {
  const stored = val(0, {
    conditions: "tot € 1.000 per maand",
    sourceUrl: "https://www.bank.test/a",
  });
  const prev = [entry("p", { fxFeePct: stored })];
  const found = val(0, {
    conditions: null,
    conditionsKnown: false,
    route: "agent",
    sourceUrl: "https://www.bank.test/b",
    checkedAt: TODAY,
  });
  const out = run(prev, [entry("p", { fxFeePct: found })]);
  expect(out.verdicts[0]!.verdict).toEqual({ kind: "confirm" });
  expect(out.rows[0]!.fields.fxFeePct).toEqual({ ...stored, confirmedAt: TODAY });
});

test("a conflicting read does not create or keep a pending entry", () => {
  const prev = [entry("p", { fxFeePct: val(0) })];
  const found = val(2, { checkedAt: TODAY });
  const out = guardRun({
    prev,
    rows: [entry("p", { fxFeePct: found })],
    knownHosts: hosts,
    pending: { "p.fxFeePct": { value: 2, seenAt: "2026-11-10" } },
    storedChecks: new Map([["p.fxFeePct", "still-stated" as const]]),
    today: TODAY,
  });
  expect(out.verdicts[0]!.verdict).toEqual({ kind: "hold", reason: "conflicting-read" });
  expect(out.pending["p.fxFeePct"]).toBeUndefined();
  expect(out.rows[0]!.fields.fxFeePct).toBeUndefined();
});

test("an unresolved cross-check does not create or keep a pending entry", () => {
  const out = guardRun({
    prev: [entry("p", { fxFeePct: val(0) })],
    rows: [entry("p", { fxFeePct: val(2, { checkedAt: TODAY }) })],
    knownHosts: hosts,
    pending: { "p.fxFeePct": { value: 2, seenAt: "2026-11-10" } },
    storedChecks: new Map([["p.fxFeePct", "unresolved" as const]]),
    today: TODAY,
  });
  expect(out.verdicts[0]!.verdict).toEqual({ kind: "hold", reason: "change-not-cross-checked" });
  expect(out.pending["p.fxFeePct"]).toBeUndefined();
});

test("text to null at the same value leaves the stored conditions in the row", () => {
  const prev = [entry("p", { fxFeePct: val(1.4, { conditions: "max 500 per month" }) })];
  const rows = [entry("p", { fxFeePct: val(1.4, { conditions: null, checkedAt: TODAY }) })];
  const out = run(prev, rows);
  expect(out.verdicts[0]!.verdict).toEqual({ kind: "confirm" });
  expect(out.rows[0]!.fields.fxFeePct!.conditions).toBe("max 500 per month");
});

test("a manual hold clears the pending figure and keeps the stored value", () => {
  const prev = [entry("p", { fxFeePct: val(1) })];
  const out = guardRun({
    prev,
    rows: [entry("p", { fxFeePct: val(1.5, { checkedAt: TODAY }) })],
    knownHosts: hosts,
    pending: { "p.fxFeePct": { value: 1.5, seenAt: "2026-11-10" } },
    manualHolds: new Set(["p.fxFeePct"]),
    today: TODAY,
  });
  expect(out.verdicts[0]!.verdict).toEqual({ kind: "hold", reason: "held-for-person" });
  expect(out.pending["p.fxFeePct"]).toBeUndefined();
  expect(out.rows[0]!.fields.fxFeePct).toBeUndefined();
});

test("a manual hold on one key leaves other keys alone", () => {
  const out = guardRun({
    prev: [entry("p", { fxFeePct: val(1) })],
    rows: [entry("p", { fxFeePct: val(1.2, { checkedAt: TODAY }) })],
    knownHosts: hosts,
    pending: {},
    manualHolds: new Set(["q.fxFeePct"]),
    today: TODAY,
  });
  expect(out.verdicts[0]!.verdict.kind).toBe("publish");
});

test("a conditions-only update from an archive copy older than the last confirmation is a confirm", () => {
  const stored = val(1.4, { conditions: null, confirmedAt: "2026-10-01" });
  const found = val(1.4, {
    conditions: "alleen buiten de euro",
    route: "wayback",
    sourceUrl: "https://web.archive.org/web/20250301000000id_/https://www.bank.test/tarieven",
    checkedAt: "2025-03-01",
  });
  const out = run([entry("p", { fxFeePct: stored })], [entry("p", { fxFeePct: found })]);
  expect(out.verdicts[0]!.verdict).toEqual({ kind: "confirm" });
  expect(out.rows[0]!.fields.fxFeePct).toEqual({ ...stored, confirmedAt: "2026-10-01" });
});

test("a conditions-only update from an archive copy newer than the last confirmation still publishes", () => {
  const stored = val(1.4, { conditions: null, confirmedAt: "2025-01-01" });
  const found = val(1.4, {
    conditions: "alleen buiten de euro",
    route: "wayback",
    sourceUrl: "https://web.archive.org/web/20250301000000id_/https://www.bank.test/tarieven",
    checkedAt: "2025-03-01",
  });
  const out = run([entry("p", { fxFeePct: stored })], [entry("p", { fxFeePct: found })]);
  expect(out.verdicts[0]!.verdict).toMatchObject({ kind: "publish", conditionsOnly: true });
});
