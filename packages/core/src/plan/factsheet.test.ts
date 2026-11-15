import { expect, test } from "vitest";
import {
  FactSheetError,
  PLAN_ENGINE_VERSION,
  bucketOf,
  buildFactSheet,
} from "./factsheet.js";
import type { PlanFact } from "./types.js";

test("bucketOf boundaries: cents 0, 24999/25000, negative; months 0.99/1/3/6", () => {
  expect(bucketOf("cents", -1)).toBe("<0");
  expect(bucketOf("cents", 0)).toBe("0-250");
  expect(bucketOf("cents", 24_999)).toBe("0-250");
  expect(bucketOf("cents", 25_000)).toBe("250-500");
  expect(bucketOf("cents", 99_999)).toBe("500-1k");
  expect(bucketOf("cents", 100_000)).toBe("1k-2.5k");
  expect(bucketOf("cents", 250_000)).toBe("2.5k-5k");
  expect(bucketOf("cents", 500_000)).toBe("5k-10k");
  expect(bucketOf("cents", 1_000_000)).toBe("10k+");
  expect(bucketOf("months", 0.99)).toBe("<1");
  expect(bucketOf("months", 1)).toBe("1-3");
  expect(bucketOf("months", 3)).toBe("3-6");
  expect(bucketOf("months", 6)).toBe("6+");
  expect(bucketOf("years", 0.5)).toBe("<1");
  expect(bucketOf("years", 3)).toBe("3-10");
  expect(bucketOf("years", 10)).toBe("10+");
  expect(bucketOf("count", 5)).toBe("5");
  expect(bucketOf("count", 6)).toBe("6+");
  expect(bucketOf("ratio", 0.05)).toBe("0.0-0.1");
  expect(bucketOf("date", "2027-05-14")).toBe("2027-Q2");
  expect(bucketOf("date", "2027-01-01")).toBe("2027-Q1");
});

const fact = (o: Partial<PlanFact> = {}): PlanFact => ({
  factId: "month_room",
  section: "month",
  exact: 41_250,
  unit: "cents",
  polarity: "positive",
  mustMention: true,
  ...o,
});

test("hash is stable when generatedAt changes, changes when any exact/polarity/mustMention changes", () => {
  const base = buildFactSheet([fact()], { locale: "nl", asOf: "2026-10-24" });
  const later = buildFactSheet([fact()], { locale: "nl", asOf: "2026-11-30" });
  expect(later.hash).toBe(base.hash);
  expect(later.id).toBe(base.id);
  expect(base.id).toBe(`fs-${base.hash}`);
  expect(base.engineVersion).toBe(PLAN_ENGINE_VERSION);
  const h = (f: Partial<PlanFact>, locale: "nl" | "en" = "nl") =>
    buildFactSheet([fact(f)], { locale, asOf: "2026-10-24" }).hash;
  expect(h({ exact: 41_251 })).not.toBe(base.hash);
  expect(h({ polarity: "negative" })).not.toBe(base.hash);
  expect(h({ mustMention: false })).not.toBe(base.hash);
  expect(h({}, "en")).not.toBe(base.hash);
  expect(
    buildFactSheet([fact()], {
      locale: "nl",
      asOf: "2026-10-24",
      taskType: "digest",
    }).hash,
  ).not.toBe(base.hash);
});

test("ratio: tenth bands, 1.0+ above, <0 below; boundaries", () => {
  expect(bucketOf("ratio", 0)).toBe("0.0-0.1");
  expect(bucketOf("ratio", 0.1)).toBe("0.1-0.2");
  expect(bucketOf("ratio", 0.9999)).toBe("0.9-1.0");
  expect(bucketOf("ratio", 0.99999999995)).toBe("1.0+"); // rounds to 1, never an invalid 1.0-1.1 band
  expect(bucketOf("ratio", 1)).toBe("1.0+");
  expect(bucketOf("ratio", -0.01)).toBe("<0");
});

test("pct is percentage points with its own bands", () => {
  expect(bucketOf("pct", -0.1)).toBe("<0");
  expect(bucketOf("pct", 0)).toBe("0-1");
  expect(bucketOf("pct", 0.99)).toBe("0-1");
  expect(bucketOf("pct", 1)).toBe("1-2");
  expect(bucketOf("pct", 2.5)).toBe("2-3");
  expect(bucketOf("pct", 3)).toBe("3-5");
  expect(bucketOf("pct", 5)).toBe("5-10");
  expect(bucketOf("pct", 10)).toBe("10+");
});

test("count: negative or non-integer is not exact", () => {
  expect(bucketOf("count", -1)).toBe("<0");
  expect(bucketOf("count", 2.5)).toBe("unknown");
  expect(bucketOf("count", 0)).toBe("0");
});

const sheet = (facts: PlanFact[]) =>
  buildFactSheet(facts, { locale: "nl", asOf: "2026-10-24" });

test("buildFactSheet rejects a factId built from a merchant name or IBAN", () => {
  expect(() =>
    sheet([fact({ factId: "subscriptions.increase.Netflix" })]),
  ).toThrow(FactSheetError);
  expect(() => sheet([fact({ factId: "cards.NL91ABNA0417164300" })])).toThrow(
    FactSheetError,
  );
  expect(() => sheet([fact({ factId: "albert heijn" })])).toThrow(
    FactSheetError,
  );
  expect(() =>
    sheet([fact({ factId: "subscriptions:increase:k9x" })]),
  ).not.toThrow();
});

test("buildFactSheet allows a string exact only for unit date", () => {
  expect(() => sheet([fact({ exact: "Albert Heijn" })])).toThrow(
    FactSheetError,
  );
  expect(() => sheet([fact({ exact: "Albert Heijn", unit: "date" })])).toThrow(
    FactSheetError,
  );
  expect(() =>
    sheet([fact({ exact: "2027-06-01", unit: "date" })]),
  ).not.toThrow();
});

test("buildFactSheet rejects a duplicate factId", () => {
  expect(() => sheet([fact(), fact({ exact: 5 })])).toThrow(FactSheetError);
});

test("hash and fact order do not depend on input order; factId change changes hash", () => {
  const a = fact({ factId: "a_one" });
  const b = fact({ factId: "b_two", exact: 7 });
  const ab = sheet([a, b]);
  const ba = sheet([b, a]);
  expect(ba.hash).toBe(ab.hash);
  expect(ba.facts.map((f) => f.factId)).toEqual(["a_one", "b_two"]);
  expect(sheet([fact({ factId: "a_other" }), b]).hash).not.toBe(ab.hash);
});
