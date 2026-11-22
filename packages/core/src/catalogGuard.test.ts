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

test("same value, conditions go from null to text -> publish", () => {
  const out = judge("fxFeePct", val(0), val(0, { conditions: "max 500 per month" }));
  expect(out).toEqual({ kind: "publish", viaPending: false });
});

test("same value, text to null -> publish", () => {
  const out = judge("fxFeePct", val(0, { conditions: "max 500 per month" }), val(0));
  expect(out).toEqual({ kind: "publish", viaPending: false });
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
