import { expect, test } from "vitest";
import type { CatalogField, CatalogValue } from "./catalog.js";
import { coverageForRun, nextHeldSince, sweptFieldFor, weeksSince } from "./catalogCoverage.js";
import type { GuardVerdict } from "./catalogGuard.js";
import type { FieldVerdict } from "./catalogGuardRun.js";
import type { MergeEntry } from "./catalogMerge.js";

const val = (value: number, over: Partial<CatalogValue> = {}): CatalogValue => ({
  value,
  route: "provider-page",
  sourceUrl: "https://www.bank.test/tarieven",
  checkedAt: "2026-06-15",
  conditions: null,
  conditionsKnown: true,
  ...over,
});

const entry = (id: string, fields: MergeEntry["fields"]): MergeEntry => ({
  id,
  product: `Product ${id}`,
  fields,
});

const fv = (id: string, field: CatalogField, verdict: GuardVerdict): FieldVerdict => ({
  id,
  product: `Product ${id}`,
  field,
  verdict,
  before: val(1),
  found: val(1),
});

const FX: ReadonlySet<CatalogField> = new Set<CatalogField>(["fxFeePct", "interestPct"]);

type In = Parameters<typeof coverageForRun>[0];
const run = (over: Partial<In> = {}) =>
  coverageForRun({
    entries: [entry("a", { fxFeePct: val(1) })],
    expected: [{ id: "a", product: "Product a", field: "fxFeePct" }],
    verdicts: [],
    sweptFields: FX,
    sweptIds: new Set(["a"]),
    watchedIds: new Set(["a"]),
    reached: new Map([["a", { fetched: true, reason: null }]]),
    stoppedEarlyIds: new Set(),
    uncheckedSince: {},
    modelOn: true,
    today: "2026-11-23",
    ...over,
  });

const only = (r: ReturnType<typeof coverageForRun>) => r.figures[0];

test("confirm verdict is confirmed, with how", () => {
  const r = run({
    verdicts: [fv("a", "fxFeePct", { kind: "confirm" })],
    confirmedBy: new Map([["a.fxFeePct", "quote-check"]]),
  });
  expect(only(r)).toMatchObject({ status: "confirmed", detail: "quote check", uncheckedWeeks: 0 });
});

test("confirm without a recorded route reads as read again", () => {
  const r = run({ verdicts: [fv("a", "fxFeePct", { kind: "confirm" })] });
  expect(only(r).detail).toBe("read again");
});

test("a conditions-only publish is confirmed with detail conditions updated", () => {
  const r = run({
    verdicts: [fv("a", "fxFeePct", { kind: "publish", viaPending: false, conditionsOnly: true })],
  });
  expect(only(r)).toMatchObject({
    status: "confirmed",
    detail: "conditions updated",
    uncheckedWeeks: 0,
  });
});

test("publish verdict is changed", () => {
  const r = run({ verdicts: [fv("a", "fxFeePct", { kind: "publish", viaPending: false })] });
  expect(only(r).status).toBe("changed");
});

test("pending verdict is waiting, detail is the waiting value", () => {
  const r = run({
    verdicts: [fv("a", "fxFeePct", { kind: "pending", pending: { value: 2.5, seenAt: "x" } })],
  });
  expect(only(r)).toMatchObject({ status: "waiting", detail: "2.5" });
});

test("hold verdict is held, detail is the reason", () => {
  const r = run({ verdicts: [fv("a", "fxFeePct", { kind: "hold", reason: "unknown-host" })] });
  expect(only(r)).toMatchObject({ status: "held", detail: "unknown-host" });
});

test("unjudged verdict is not checked", () => {
  const r = run({ verdicts: [fv("a", "fxFeePct", { kind: "unjudged" })] });
  expect(only(r)).toMatchObject({ status: "not-checked", cause: "not-found-on-page" });
});

test("cause: field not swept", () => {
  const r = run({ entries: [entry("a", { accountFee: val(10) })], expected: [] });
  expect(only(r).cause).toBe("field-not-swept");
});

test("cause: not in this run", () => {
  const r = run({ sweptIds: new Set(), reached: new Map() });
  expect(only(r).cause).toBe("not-in-this-run");
});

test("cause: no source when the stored source is not a web address", () => {
  const r = run({
    entries: [entry("a", { fxFeePct: val(1, { sourceUrl: "owner-stated" }) })],
    reached: new Map([["a", { fetched: false, reason: "no route wired (x)" }]]),
    modelOn: false,
  });
  expect(only(r).cause).toBe("no-source");
});

test("cause: model off when a web source exists, no rung ran and the model was off", () => {
  const r = run({
    reached: new Map([["a", { fetched: false, reason: "no route wired (x)" }]]),
    modelOn: false,
  });
  expect(only(r).cause).toBe("model-off");
});

test("no route wired with the model on is no source", () => {
  const r = run({
    reached: new Map([["a", { fetched: false, reason: "no route wired (x)" }]]),
  });
  expect(only(r).cause).toBe("no-source");
});

test("cause: fetch failed", () => {
  const r = run({ reached: new Map([["a", { fetched: false, reason: "timeout" }]]) });
  expect(only(r).cause).toBe("fetch-failed");
});

test("cause: not found on page", () => {
  expect(only(run()).cause).toBe("not-found-on-page");
});

test("cause: stopped early", () => {
  const r = run({ reached: new Map(), stoppedEarlyIds: new Set(["a"]) });
  expect(only(r).cause).toBe("stopped-early");
});

test("two causes: field not swept wins over not in this run", () => {
  const r = run({
    entries: [entry("a", { cashbackPct: val(1) })],
    expected: [],
    sweptIds: new Set(),
    reached: new Map(),
  });
  expect(only(r).cause).toBe("field-not-swept");
});

test("two causes: not in this run wins over stopped early", () => {
  const r = run({ sweptIds: new Set(), reached: new Map(), stoppedEarlyIds: new Set(["a"]) });
  expect(only(r).cause).toBe("not-in-this-run");
});

test("two causes: model off wins over stopped early", () => {
  const r = run({
    reached: new Map([["a", { fetched: false, reason: "no route wired" }]]),
    stoppedEarlyIds: new Set(["a"]),
    modelOn: false,
  });
  expect(only(r).cause).toBe("model-off");
});

test("a catalogue product missing from the watch list is not-tracked on a full run", () => {
  const r = run({
    entries: [entry("a", { fxFeePct: val(1) }), entry("z", { fxFeePct: val(1) })],
    expected: [{ id: "a", product: "Product a", field: "fxFeePct" }],
    fullRun: true,
  });
  const z = r.figures.find((f) => f.id === "z")!;
  expect(z).toMatchObject({ status: "not-checked", cause: "not-tracked", uncheckedWeeks: 1 });
  expect(r.uncheckedSince["z.fxFeePct"]).toBe("2026-11-23");
});

test("a product with no figure on file gets a row", () => {
  const r = run({
    entries: [entry("a", {})],
    reached: new Map([["a", { fetched: true, reason: null }]]),
  });
  expect(r.figures).toHaveLength(1);
  expect(only(r)).toMatchObject({
    id: "a",
    field: "fxFeePct",
    status: "not-checked",
    cause: "no-figure-yet",
  });
});

test("a product absent from the catalogue still gets a row", () => {
  const r = run({ entries: [] });
  expect(r.figures).toHaveLength(1);
  expect(only(r).cause).toBe("no-figure-yet");
});

test("a first figure published this run is changed", () => {
  const r = run({
    entries: [entry("a", {})],
    verdicts: [fv("a", "fxFeePct", { kind: "publish", viaPending: false })],
  });
  expect(r.figures).toHaveLength(1);
  expect(only(r).status).toBe("changed");
});

test("duplicate ids yield one row", () => {
  const r = run({
    entries: [entry("a", { fxFeePct: val(1) }), entry("a", { fxFeePct: val(2) })],
    expected: [
      { id: "a", product: "Product a", field: "fxFeePct" },
      { id: "a", product: "Product a", field: "fxFeePct" },
    ],
  });
  expect(r.figures).toHaveLength(1);
});

test("every catalogue figure appears exactly once", () => {
  const entries = [
    entry("a", { fxFeePct: val(1), accountFee: val(5), pointsPerEuro: val(1) }),
    entry("b", { interestPct: val(2) }),
    entry("c", { fxFeePct: val(1), cashbackPct: val(1) }),
  ];
  const r = run({
    entries,
    expected: [
      { id: "a", product: "Product a", field: "fxFeePct" },
      { id: "b", product: "Product b", field: "interestPct" },
      { id: "c", product: "Product c", field: "fxFeePct" },
    ],
    sweptIds: new Set(["a", "b"]),
    watchedIds: new Set(["a", "b", "c"]),
    verdicts: [fv("a", "fxFeePct", { kind: "confirm" })],
    stoppedEarlyIds: new Set(["b"]),
  });
  const keys = r.figures.map((f) => `${f.id}.${f.field}`).sort();
  expect(keys).toEqual(
    [
      "a.fxFeePct",
      "a.accountFee",
      "a.pointsPerEuro",
      "b.interestPct",
      "c.fxFeePct",
      "c.cashbackPct",
    ].sort(),
  );
});

test("a figure unchecked today shows 1 week", () => {
  const r = run();
  expect(only(r).uncheckedWeeks).toBe(1);
  expect(r.uncheckedSince).toEqual({ "a.fxFeePct": "2026-11-23" });
});

test("seven days later shows 2 weeks", () => {
  const r = run({ today: "2026-11-30", uncheckedSince: { "a.fxFeePct": "2026-11-23" } });
  expect(only(r).uncheckedWeeks).toBe(2);
  expect(r.uncheckedSince).toEqual({ "a.fxFeePct": "2026-11-23" });
});

test("after a missed or refused week (14 days) shows 3 weeks", () => {
  const r = run({ today: "2026-12-07", uncheckedSince: { "a.fxFeePct": "2026-11-23" } });
  expect(only(r).uncheckedWeeks).toBe(3);
});

test("a manual run two days later still shows 1 week", () => {
  const r = run({ today: "2026-11-25", uncheckedSince: { "a.fxFeePct": "2026-11-23" } });
  expect(only(r).uncheckedWeeks).toBe(1);
});

test("a checked figure loses its entry and shows 0", () => {
  const r = run({
    verdicts: [fv("a", "fxFeePct", { kind: "confirm" })],
    uncheckedSince: { "a.fxFeePct": "2026-11-09" },
  });
  expect(only(r).uncheckedWeeks).toBe(0);
  expect(r.uncheckedSince).toEqual({});
});

test("waiting and held lose their entry", () => {
  for (const verdict of [
    { kind: "pending", pending: { value: 2, seenAt: "x" } },
    { kind: "hold", reason: "out-of-range" },
  ] as const) {
    const r = run({
      verdicts: [fv("a", "fxFeePct", verdict)],
      uncheckedSince: { "a.fxFeePct": "2026-11-09" },
    });
    expect(only(r).uncheckedWeeks).toBe(0);
    expect(r.uncheckedSince).toEqual({});
  }
});

test("a refused run computes weeks from the stored dates and changes no dates", () => {
  const stored = { "a.fxFeePct": "2026-11-09" };
  const r = run({
    today: "2026-11-23",
    uncheckedSince: stored,
    stoppedEarlyIds: new Set(["a"]),
    reached: new Map(),
  });
  expect(only(r).uncheckedWeeks).toBe(3);
  expect(r.uncheckedSince).toEqual({ "a.fxFeePct": "2026-11-09" });
  expect(stored).toEqual({ "a.fxFeePct": "2026-11-09" });
});

test("an --only run leaves the dates untouched", () => {
  const stored = { "a.fxFeePct": "2026-11-09", "gone.fxFeePct": "2026-10-01" };
  const r = run({
    sweptIds: new Set(),
    reached: new Map(),
    uncheckedSince: stored,
    fullRun: false,
    verdicts: [],
  });
  expect(only(r)).toMatchObject({ cause: "not-in-this-run", uncheckedWeeks: 3 });
  expect(r.uncheckedSince).toEqual(stored);
});

test("a figure removed from the catalogue loses its entry", () => {
  const r = run({ uncheckedSince: { "a.fxFeePct": "2026-11-23", "gone.fxFeePct": "2026-11-09" } });
  expect(r.uncheckedSince).toEqual({ "a.fxFeePct": "2026-11-23" });
});

const held = (...f: CatalogField[]): ReadonlySet<CatalogField> => new Set(f);

test("sweptFieldFor: a savings account is asked for interest", () => {
  expect(sweptFieldFor("spaarrekening", held())).toBe("interestPct");
  expect(sweptFieldFor("spaarrekening", held("fxFeePct"))).toBe("interestPct");
});

test("sweptFieldFor: cards and prepaid are asked for the FX fee", () => {
  for (const kind of ["creditcard", "betaalpas", "prepaid"]) {
    expect(sweptFieldFor(kind, held())).toBe("fxFeePct");
    expect(sweptFieldFor(kind, held("interestPct"))).toBe("fxFeePct");
  }
});

test("sweptFieldFor: a broker product is swept for interest even with no figure on file", () => {
  expect(sweptFieldFor("beleggingsrekening", held())).toBe("interestPct");
  expect(sweptFieldFor("beleggingsrekening", held("interestPct"))).toBe("interestPct");
  expect(sweptFieldFor("beleggingsrekening", held("fxFeePct"))).toBe("interestPct");
});

test("sweptFieldFor: another kind that holds an FX fee is swept for it", () => {
  expect(sweptFieldFor("crypto", held("fxFeePct", "cashbackPct"))).toBe("fxFeePct");
});

test("sweptFieldFor: an account package with only an account fee is not swept", () => {
  expect(sweptFieldFor("betaalpakket", held("accountFee"))).toBeNull();
  expect(sweptFieldFor("betaalrekening", held())).toBeNull();
  expect(sweptFieldFor(undefined, held("pointsPerEuro"))).toBeNull();
});

test("weeksIfNotSaved ignores this run's verdict", () => {
  const r = run({
    today: "2026-11-23",
    verdicts: [fv("a", "fxFeePct", { kind: "confirm" })],
    uncheckedSince: { "a.fxFeePct": "2026-11-08" },
  });
  expect(only(r).uncheckedWeeks).toBe(0);
  expect(only(r).weeksIfNotSaved).toBe(3);
});

test("weeksIfNotSaved is 1 when there is no stored date", () => {
  const r = run({ verdicts: [fv("a", "fxFeePct", { kind: "confirm" })] });
  expect(only(r).weeksIfNotSaved).toBe(1);
});

test("weeksIfNotSaved equals uncheckedWeeks for a not-checked figure", () => {
  const r = run({ today: "2026-11-30", uncheckedSince: { "a.fxFeePct": "2026-11-23" } });
  expect(only(r)).toMatchObject({ uncheckedWeeks: 2, weeksIfNotSaved: 2 });
});

test("cause: not asked, a swept field that is not the product's question", () => {
  const r = run({
    entries: [entry("a", { fxFeePct: val(1), interestPct: val(2) })],
    expected: [{ id: "a", product: "Product a", field: "interestPct" }],
  });
  const fx = r.figures.find((f) => f.field === "fxFeePct")!;
  expect(fx.cause).toBe("not-asked");
  expect(r.figures.find((f) => f.field === "interestPct")!.cause).toBe("not-found-on-page");
});

test("two causes: field not swept wins over not asked", () => {
  const r = run({
    entries: [entry("a", { accountFee: val(1) })],
    expected: [{ id: "a", product: "Product a", field: "interestPct" }],
  });
  expect(r.figures.find((f) => f.field === "accountFee")!.cause).toBe("field-not-swept");
});

test("first hold is 1 week", () => {
  expect(nextHeldSince({}, ["a.fxFeePct"], "2026-11-22")).toEqual({ "a.fxFeePct": "2026-11-22" });
  expect(weeksSince("2026-11-22", "2026-11-22")).toBe(1);
});

test("still held 14 days later is 3 weeks", () => {
  const since = nextHeldSince({ "a.fxFeePct": "2026-11-22" }, ["a.fxFeePct"], "2026-12-06");
  expect(since).toEqual({ "a.fxFeePct": "2026-11-22" });
  expect(weeksSince(since["a.fxFeePct"]!, "2026-12-06")).toBe(3);
});

test("a figure no longer held loses its date", () => {
  expect(
    nextHeldSince(
      { "a.fxFeePct": "2026-11-22", "b.fxFeePct": "2026-11-01" },
      ["b.fxFeePct"],
      "2026-12-06",
    ),
  ).toEqual({ "b.fxFeePct": "2026-11-01" });
});

test("a held figure carries heldWeeks from the held-since map", () => {
  const verdicts = [fv("a", "fxFeePct", { kind: "hold", reason: "held-for-person" })];
  expect(only(run({ verdicts, heldSince: { "a.fxFeePct": "2026-11-09" } }))).toMatchObject({
    status: "held",
    heldWeeks: 3,
  });
  expect(only(run({ verdicts }))).toMatchObject({ status: "held", heldWeeks: 1 });
});
