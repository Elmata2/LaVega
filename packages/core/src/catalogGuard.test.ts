import { expect, test } from "vitest";
import {
  isArchiveUrl,
  judgeField,
  knownHostsByIssuer,
  MIN_DAYS_BETWEEN_READS,
  sourceHost,
  type PendingFigure,
} from "./catalogGuard.js";
import type { CatalogField, CatalogValue } from "./catalog.js";
import type { MergeEntry } from "./catalogMerge.js";

const val = (value: number, over: Partial<CatalogValue> = {}): CatalogValue => ({
  value,
  route: "provider-page",
  sourceUrl: "https://www.bank.test/tarieven",
  checkedAt: "2026-01-01",
  conditions: null,
  conditionsKnown: true,
  ...over,
});

const hosts = new Set(["www.bank.test"]);

const judge = (
  field: CatalogField,
  current: CatalogValue | undefined,
  found: CatalogValue,
  extra: { pending?: PendingFigure; today?: string } = {},
) =>
  judgeField({
    field,
    current,
    found,
    knownHosts: hosts,
    pending: extra.pending,
    today: extra.today ?? "2026-11-23",
  });

test("uncovered found is unjudged", () => {
  expect(judge("fxFeePct", val(1.4), val(1.5, { conditionsKnown: false }))).toEqual({
    kind: "unjudged",
  });
});

test("same value confirms", () => {
  expect(judge("fxFeePct", val(1.4), val(1.4000000001))).toEqual({ kind: "confirm" });
});

test("same value confirms even from an unknown host", () => {
  const found = val(1.4, { sourceUrl: "https://other.test/x" });
  expect(judge("fxFeePct", val(1.4), found)).toEqual({ kind: "confirm" });
});

test("small change publishes", () => {
  expect(judge("fxFeePct", val(1.4), val(1.5))).toEqual({ kind: "publish", viaPending: false });
});

test("comparison route is held", () => {
  expect(judge("fxFeePct", val(1.4), val(1.5, { route: "comparison" }))).toEqual({
    kind: "hold",
    reason: "comparison-route",
  });
});

test("unknown host is held", () => {
  const found = val(1.5, { sourceUrl: "https://vergelijk.test/x" });
  expect(judge("fxFeePct", val(1.4), found)).toEqual({ kind: "hold", reason: "unknown-host" });
});

test("archive snapshot of a known host passes", () => {
  const found = val(1.5, {
    sourceUrl: "https://web.archive.org/web/20260101000000/https://www.bank.test/t",
  });
  expect(judge("fxFeePct", val(1.4), found)).toEqual({ kind: "publish", viaPending: false });
});

test("malformed source url is held, not thrown", () => {
  const found = val(1.5, { sourceUrl: "not a url" });
  expect(judge("fxFeePct", val(1.4), found)).toEqual({ kind: "hold", reason: "bad-source-url" });
});

test("out of range is held", () => {
  expect(judge("interestPct", val(2), val(25))).toEqual({ kind: "hold", reason: "out-of-range" });
  expect(judge("fxFeePct", val(1.4), val(-1))).toEqual({ kind: "hold", reason: "out-of-range" });
});

test("first figure publishes without a jump test", () => {
  expect(judge("interestPct", undefined, val(4.25))).toEqual({
    kind: "publish",
    viaPending: false,
  });
});

test("large jump goes pending", () => {
  expect(judge("interestPct", val(2), val(4))).toEqual({
    kind: "pending",
    pending: { value: 4, seenAt: "2026-11-23" },
  });
});

test("exactly at the limit is not a jump", () => {
  expect(judge("interestPct", val(2), val(3.5))).toEqual({ kind: "publish", viaPending: false });
});

test("drop to zero is a jump for fx and interest", () => {
  expect(judge("fxFeePct", val(1.4), val(0)).kind).toBe("pending");
  expect(judge("interestPct", val(2), val(0)).kind).toBe("pending");
  expect(judge("cashbackPct", val(0.5), val(0))).toEqual({ kind: "publish", viaPending: false });
});

test("second equal read in a later run publishes", () => {
  const pending = { value: 4, seenAt: "2026-11-23" };
  expect(judge("interestPct", val(2), val(4), { pending, today: "2026-11-30" })).toEqual({
    kind: "publish",
    viaPending: true,
  });
});

test("second equal read 5 days later stays pending", () => {
  const pending = { value: 4, seenAt: "2026-11-23" };
  expect(judge("interestPct", val(2), val(4), { pending, today: "2026-11-28" })).toEqual({
    kind: "pending",
    pending: { value: 4, seenAt: "2026-11-23" },
  });
});

test("6 days later publishes", () => {
  expect(MIN_DAYS_BETWEEN_READS).toBe(6);
  const pending = { value: 4, seenAt: "2026-11-23" };
  expect(judge("interestPct", val(2), val(4), { pending, today: "2026-11-29" })).toEqual({
    kind: "publish",
    viaPending: true,
  });
});

test("day count crosses a month and a year end", () => {
  const pending = { value: 4, seenAt: "2026-12-28" };
  expect(judge("interestPct", val(2), val(4), { pending, today: "2027-01-03" }).kind).toBe(
    "publish",
  );
  expect(judge("interestPct", val(2), val(4), { pending, today: "2027-01-02" }).kind).toBe(
    "pending",
  );
});

test("unparseable seenAt or today stays pending and keeps seenAt", () => {
  const bad = { value: 4, seenAt: "last week" };
  expect(judge("interestPct", val(2), val(4), { pending: bad, today: "2026-11-30" })).toEqual({
    kind: "pending",
    pending: { value: 4, seenAt: "last week" },
  });
  const ok = { value: 4, seenAt: "2026-11-23" };
  expect(judge("interestPct", val(2), val(4), { pending: ok, today: "soon" })).toEqual({
    kind: "pending",
    pending: { value: 4, seenAt: "2026-11-23" },
  });
});

test("same value, conditions null to text publishes as conditionsOnly", () => {
  const out = judge("fxFeePct", val(0), val(0, { conditions: "max 500 per month" }));
  expect(out).toEqual({ kind: "publish", viaPending: false, conditionsOnly: true });
});

test("same value, conditions text to null confirms and keeps the stored conditions", () => {
  const out = judge("fxFeePct", val(0, { conditions: "max 500 per month" }), val(0));
  expect(out).toEqual({ kind: "confirm" });
});

test("a changed value is not conditionsOnly", () => {
  const out = judge("fxFeePct", val(1.4), val(1.5, { conditions: "cap" }));
  expect(out).toEqual({ kind: "publish", viaPending: false });
});

test("fx fee from zero to non-zero goes pending", () => {
  expect(judge("fxFeePct", val(0), val(1)).kind).toBe("pending");
  expect(judge("convertFeePct", val(0), val(0.5)).kind).toBe("pending");
});

test("interest from zero to non-zero goes pending", () => {
  expect(judge("interestPct", val(0), val(0.5)).kind).toBe("pending");
});

test("cashback from zero is not a jump by that rule", () => {
  expect(judge("cashbackPct", val(0), val(0.5))).toEqual({ kind: "publish", viaPending: false });
});

test("same value, wording differs -> confirm", () => {
  const out = judge("fxFeePct", val(1.4, { conditions: "A" }), val(1.4, { conditions: "B" }));
  expect(out).toEqual({ kind: "confirm" });
});

test("same value with flipped conditions from an unknown host is held", () => {
  const found = val(1.4, { conditions: "cap", sourceUrl: "https://other.test/x" });
  expect(judge("fxFeePct", val(1.4), found)).toEqual({ kind: "hold", reason: "unknown-host" });
});

test("second read on the same day stays pending", () => {
  const pending = { value: 4, seenAt: "2026-11-23" };
  expect(judge("interestPct", val(2), val(4), { pending, today: "2026-11-23" })).toEqual({
    kind: "pending",
    pending: { value: 4, seenAt: "2026-11-23" },
  });
});

test("second read with another value restarts pending", () => {
  const pending = { value: 4, seenAt: "2026-11-23" };
  expect(judge("interestPct", val(2), val(4.5), { pending, today: "2026-11-30" })).toEqual({
    kind: "pending",
    pending: { value: 4.5, seenAt: "2026-11-30" },
  });
});

test("ratio jump", () => {
  expect(judge("accountFee", val(24), val(60)).kind).toBe("pending");
  expect(judge("accountFee", val(24), val(40))).toEqual({ kind: "publish", viaPending: false });
  expect(judge("accountFee", val(24), val(10)).kind).toBe("pending");
});

test("zero baseline on a ratio field is a jump", () => {
  expect(judge("accountFee", val(0), val(24)).kind).toBe("pending");
  expect(judge("pointsPerEuro", val(0), val(1)).kind).toBe("pending");
});

test("knownHostsByIssuer gathers state urls and catalogue sources per issuer", () => {
  const products = {
    "ing-betaalpas": {
      issuer: "ING",
      termsUrl: "https://www.ing.test/tarieven",
      pdfUrl: "https://assets.ing.test/t.pdf",
      foundUrl: null,
    },
    "ing-credit": { issuer: "ING", foundUrl: "https://Cards.ING.test/x" },
    solo: { termsUrl: "https://solo.test/t" },
  };
  const entries: MergeEntry[] = [
    {
      id: "ing-betaalpas",
      product: "p",
      issuer: "ING",
      fields: {
        fxFeePct: val(1, {
          sourceUrl: "https://web.archive.org/web/2026/https://old.ing.test/p",
        }),
      },
    },
    {
      id: "solo",
      product: "s",
      fields: { fxFeePct: val(1, { sourceUrl: "https://solo.test/y" }) },
    },
  ];
  const map = knownHostsByIssuer(products, entries);
  expect([...(map.get("ING") ?? [])].sort()).toEqual([
    "assets.ing.test",
    "cards.ing.test",
    "old.ing.test",
    "www.ing.test",
  ]);
  expect([...(map.get("solo") ?? [])]).toEqual(["solo.test"]);
});

test("docUrl host is known", () => {
  const map = knownHostsByIssuer({ a: { issuer: "A", docUrl: "https://docs.a.test/t.pdf" } }, []);
  expect([...(map.get("A") ?? [])]).toEqual(["docs.a.test"]);
});

test("state urls that are proxied or archived contribute their real host", () => {
  const map = knownHostsByIssuer(
    {
      a: {
        issuer: "A",
        termsUrl: "https://r.jina.ai/https://www.a.test/t",
        foundUrl: "https://web.archive.org/web/2026/https://old.a.test/p",
      },
    },
    [],
  );
  expect([...(map.get("A") ?? [])].sort()).toEqual(["old.a.test", "www.a.test"]);
});

test("jina proxy url resolves to the proxied host", () => {
  expect(sourceHost("https://r.jina.ai/https://www.Bank.test/a")).toBe("www.bank.test");
  expect(sourceHost("https://r.jina.ai/http://www.bank.test/a")).toBe("www.bank.test");
});

test("a bare r.jina.ai url with no target is null", () => {
  expect(sourceHost("https://r.jina.ai/")).toBeNull();
  expect(sourceHost("https://r.jina.ai")).toBeNull();
  expect(sourceHost("https://r.jina.ai/not-a-url")).toBeNull();
});

test("isArchiveUrl", () => {
  expect(isArchiveUrl("https://web.archive.org/web/20260101000000/https://www.bank.test/t")).toBe(
    true,
  );
  expect(isArchiveUrl("https://www.bank.test/t")).toBe(false);
  expect(isArchiveUrl("https://web.archive.org/")).toBe(false);
});

test("sourceHost reads plain and archived urls, null on rubbish", () => {
  expect(sourceHost("https://www.Bank.test/a")).toBe("www.bank.test");
  expect(sourceHost("https://web.archive.org/web/20260101000000/https://www.bank.test/t")).toBe(
    "www.bank.test",
  );
  expect(sourceHost("not a url")).toBeNull();
});

const uncovered = (value: number, over: Partial<CatalogValue> = {}) =>
  val(value, { conditions: null, conditionsKnown: false, ...over });

test("uncovered read of the same number from a known host confirms", () => {
  expect(judge("fxFeePct", val(1.4), uncovered(1.4))).toEqual({ kind: "confirm" });
});

test("an uncovered equal regex read from a different url is unjudged", () => {
  const found = uncovered(1.4, {
    route: "provider-page",
    sourceUrl: "https://www.bank.test/other",
  });
  expect(judge("fxFeePct", val(1.4), found)).toEqual({ kind: "unjudged" });
});

test("an uncovered equal regex read from the stored url confirms", () => {
  expect(judge("fxFeePct", val(1.4), uncovered(1.4, { route: "provider-page" }))).toEqual({
    kind: "confirm",
  });
});

test("uncovered read of the same number from an unknown host is unjudged", () => {
  const found = uncovered(1.4, { sourceUrl: "https://other.test/x" });
  expect(judge("fxFeePct", val(1.4), found)).toEqual({ kind: "unjudged" });
});

test("uncovered read of a different number is unjudged", () => {
  expect(judge("fxFeePct", val(1.4), uncovered(1.5))).toEqual({ kind: "unjudged" });
});

test("uncovered equal read with a malformed source url is unjudged", () => {
  const found = uncovered(1.4, { sourceUrl: "not a url" });
  expect(judge("fxFeePct", val(1.4), found)).toEqual({ kind: "unjudged" });
});

test("uncovered equal read without a covered current value is unjudged", () => {
  expect(judge("fxFeePct", undefined, uncovered(1.4))).toEqual({ kind: "unjudged" });
  expect(judge("fxFeePct", uncovered(1.4), uncovered(1.4))).toEqual({ kind: "unjudged" });
});

test("a different covered value while the stored value is still stated is held as conflicting-read", () => {
  const out = judgeField({
    field: "fxFeePct",
    current: val(0),
    found: val(2, { checkedAt: "2026-11-22" }),
    knownHosts: hosts,
    pending: undefined,
    today: "2026-11-23",
    storedCheck: "still-stated" as const,
  });
  expect(out).toEqual({ kind: "hold", reason: "conflicting-read" });
});

test("without the flag the same read goes pending or publishes as before", () => {
  expect(judge("fxFeePct", val(0), val(2)).kind).toBe("pending");
  expect(judge("fxFeePct", val(1.4), val(1.6)).kind).toBe("publish");
});

test("conflicting-read does not hide an unknown host or an out-of-range value", () => {
  const base = {
    field: "fxFeePct" as const,
    current: val(0),
    knownHosts: hosts,
    pending: undefined,
    today: "2026-11-23",
    storedCheck: "still-stated" as const,
  };
  expect(judgeField({ ...base, found: val(2, { sourceUrl: "https://evil.test/x" }) })).toEqual({
    kind: "hold",
    reason: "unknown-host",
  });
  expect(judgeField({ ...base, found: val(9) })).toEqual({ kind: "hold", reason: "out-of-range" });
});

const chk = (
  found: CatalogValue,
  storedCheck?: "still-stated" | "gone" | "unresolved",
  cur = val(0),
) =>
  judgeField({
    field: "fxFeePct",
    current: cur,
    found,
    knownHosts: hosts,
    pending: undefined,
    today: "2026-11-23",
    storedCheck,
  });

test("a different covered value with an unresolved cross-check is held as change-not-cross-checked", () => {
  expect(chk(val(0.5), "unresolved")).toEqual({ kind: "hold", reason: "change-not-cross-checked" });
  expect(chk(val(9), "unresolved")).toEqual({ kind: "hold", reason: "out-of-range" });
});

test("gone lets the guard decide (publish for a small change, pending for a large jump)", () => {
  expect(chk(val(1.6), "gone", val(1.4)).kind).toBe("publish");
  expect(chk(val(2), "gone", val(0)).kind).toBe("pending");
});

test("still-stated holds as conflicting-read", () => {
  expect(chk(val(1.6), "still-stated", val(1.4))).toEqual({
    kind: "hold",
    reason: "conflicting-read",
  });
});

test("no cross-check behaves as before", () => {
  expect(chk(val(1.6), undefined, val(1.4)).kind).toBe("publish");
  expect(chk(val(2), undefined, val(0)).kind).toBe("pending");
});

test("an equal covered value is a confirm whatever the cross-check says", () => {
  expect(chk(val(1.4), "unresolved", val(1.4))).toEqual({ kind: "confirm" });
});

const held = (
  found: CatalogValue,
  cur: CatalogValue | undefined = val(1),
  manualHold: boolean | undefined = true,
) =>
  judgeField({
    field: "fxFeePct",
    current: cur,
    found,
    knownHosts: hosts,
    pending: undefined,
    today: "2026-11-23",
    manualHold,
  });

test("a manual hold blocks a changed value", () => {
  expect(held(val(1.5))).toEqual({ kind: "hold", reason: "held-for-person" });
  expect(held(val(1.5), val(1), false).kind).toBe("publish");
});

test("a manual hold blocks a conditions-only publish", () => {
  expect(held(val(1, { conditions: "alleen buiten de euro" }))).toEqual({
    kind: "hold",
    reason: "held-for-person",
  });
});

test("a manual hold lets an equal read confirm", () => {
  expect(held(val(1))).toEqual({ kind: "confirm" });
});

test("a manual hold blocks a first figure", () => {
  expect(held(val(1.5), undefined)).toEqual({ kind: "hold", reason: "held-for-person" });
  expect(held(val(1.5), val(1, { conditionsKnown: false }))).toEqual({
    kind: "hold",
    reason: "held-for-person",
  });
});
