import { describe, expect, it } from "vitest";
import type { CatalogField, CatalogValue, FieldVerdict, GuardVerdict } from "@lavega/core";
import { buildCrashReport, buildReport, REPORT_LABEL, type RunSummary } from "./catalogReport.js";

const TODAY = "2026-11-21";

const value = (v: number, over: Partial<CatalogValue> = {}): CatalogValue => ({
  value: v,
  route: "provider-page",
  sourceUrl: "https://www.example-bank.nl/tarieven",
  checkedAt: "2026-11-01",
  conditions: null,
  conditionsKnown: true,
  ...over,
});

const verdict = (
  v: GuardVerdict,
  over: {
    product?: string;
    field?: CatalogField;
    before?: CatalogValue;
    found?: CatalogValue;
  } = {},
): FieldVerdict => ({
  id: "card-a",
  product: over.product ?? "Card A",
  field: over.field ?? "fxFeePct",
  verdict: v,
  before: "before" in over ? over.before : value(1.5),
  found: over.found ?? value(0.5),
});

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  today: TODAY,
  status: "written",
  refusedReason: null,
  verdicts: [],
  kept: [],
  failures: [],
  crossedAgeLine: [],
  spendLines: [],
  runUrl: null,
  figuresTotal: 300,
  figuresJudged: 280,
  figuresOlderThan12Months: 3,
  ...over,
});

describe("buildReport", () => {
  it("exports the issue label", () => {
    expect(REPORT_LABEL).toBe("catalog-report");
  });

  it("report starts with the checked line", () => {
    const r = buildReport(
      summary({
        runUrl: "https://github.com/x/y/actions/runs/1",
        verdicts: [verdict({ kind: "publish", viaPending: false })],
      }),
    )!;
    const checked = "Checked this run: 280 of 300 figures. 3 figures are older than 12 months.";
    expect(r.body.split("\n").slice(0, 3)).toEqual([
      "Run log: <https://github.com/x/y/actions/runs/1>",
      "",
      checked,
    ]);
    const noLink = buildReport(
      summary({ verdicts: [verdict({ kind: "publish", viaPending: false })] }),
    )!;
    expect(noLink.body.startsWith(checked)).toBe(true);
  });

  it("section is titled No figure this run", () => {
    const r = buildReport(
      summary({
        verdicts: [verdict({ kind: "publish", viaPending: false })],
        failures: [{ product: "Card B", reason: "page not found" }],
      }),
    )!;
    expect(r.body).toContain("## No figure this run");
    expect(r.body).not.toContain("Not reachable");
  });

  it("summary without the counts omits the line", () => {
    const old = summary({ verdicts: [verdict({ kind: "publish", viaPending: false })] });
    delete old.figuresTotal;
    delete old.figuresJudged;
    delete old.figuresOlderThan12Months;
    const r = buildReport(old)!;
    expect(r.body).not.toContain("Checked this run");
  });

  it("nothing to say returns null", () => {
    expect(
      buildReport(
        summary({ verdicts: [verdict({ kind: "confirm" }), verdict({ kind: "unjudged" })] }),
      ),
    ).toBeNull();
  });

  it("failures alone return null", () => {
    expect(
      buildReport(summary({ failures: [{ product: "Card B", reason: "page not found" }] })),
    ).toBeNull();
  });

  it("a changed figure lists old, new, route and source", () => {
    const r = buildReport(
      summary({
        verdicts: [verdict({ kind: "publish", viaPending: false })],
      }),
    )!;
    expect(r.title).toBe("Catalogue report 2026-11-21: 1 changed, 0 held");
    expect(r.body).toContain("Changed");
    expect(r.body).toContain("Card A");
    expect(r.body).toContain("foreign currency fee");
    expect(r.body).toContain("1,5% → 0,5%");
    expect(r.body).toContain("provider page");
    expect(r.body).toContain("https://www.example-bank.nl/tarieven");
    expect(r.body).not.toContain("after second read");
  });

  it("first-time figures show a dash for the old value and units per field", () => {
    const r = buildReport(
      summary({
        verdicts: [
          verdict(
            { kind: "publish", viaPending: false },
            { field: "accountFee", before: undefined, found: value(36) },
          ),
          verdict(
            { kind: "publish", viaPending: false },
            { field: "pointsPerEuro", before: value(1), found: value(2) },
          ),
        ],
      }),
    )!;
    expect(r.body).toContain("— → €36,00 per year");
    expect(r.body).toContain("1 point per euro → 2 points per euro");
  });

  it("publish after pending is marked as second read", () => {
    const r = buildReport(summary({ verdicts: [verdict({ kind: "publish", viaPending: true })] }))!;
    expect(r.body).toContain("after second read");
  });

  it("waiting figures show first seen date and the go-live line", () => {
    const r = buildReport(
      summary({
        verdicts: [verdict({ kind: "pending", pending: { value: 0.5, seenAt: "2026-11-14" } })],
      }),
    )!;
    expect(r.title).toBe("Catalogue report 2026-11-21: 0 changed, 0 held");
    expect(r.body).toContain("Waiting for a second read");
    expect(r.body).toContain("2026-11-14");
    expect(r.body).toContain("1,5% → 0,5%");
    expect(r.body).toContain("Goes live if next week's run reads the same value.");
    expect(r.body.match(/old figure stays/gi)?.length).toBe(1);
  });

  it("held figures carry a plain reason for each HoldReason", () => {
    const reasons = ["out-of-range", "unknown-host", "comparison-route", "bad-source-url"] as const;
    const r = buildReport(
      summary({ verdicts: reasons.map((reason) => verdict({ kind: "hold", reason })) }),
    )!;
    expect(r.title).toBe("Catalogue report 2026-11-21: 0 changed, 4 held");
    expect(r.body).toContain("the value is outside the range that is possible for this field");
    expect(r.body).toContain("the figure came from a website not seen before for this provider");
    expect(r.body).toContain("the figure came from a comparison site, not the provider");
    expect(r.body).toContain("the source link is missing or broken");
    expect(r.body.match(/old figure stays/gi)?.length).toBe(1);
  });

  it("older than 12 months section lists the figures", () => {
    const r = buildReport(
      summary({
        crossedAgeLine: [{ product: "Card C", field: "cashbackPct", lastConfirmed: "2025-11-01" }],
      }),
    )!;
    expect(r.body).toContain("Older than 12 months");
    expect(r.body).toContain("Card C");
    expect(r.body).toContain("cashback");
    expect(r.body).toContain("2025-11-01");
    expect(r.body).toContain("stay in the ranking");
  });

  it("refused run always reports and lists nothing as changed", () => {
    const r = buildReport(
      summary({
        status: "refused",
        refusedReason: "REFUSING TO WRITE: 40 changes",
        verdicts: [verdict({ kind: "publish", viaPending: false })],
        runUrl: "https://github.com/x/y/actions/runs/1",
      }),
    )!;
    expect(r.title).toBe("Catalogue report 2026-11-21: run refused, nothing published");
    expect(r.body).toContain("REFUSING TO WRITE: 40 changes");
    expect(r.body).toContain("https://github.com/x/y/actions/runs/1");
    expect(r.body).not.toContain("Changed");
    expect(r.body).toContain("This run wrote nothing. The catalogue is as it was before the run.");
  });

  it("refused run with pending and held verdicts lists neither", () => {
    const r = buildReport(
      summary({
        status: "refused",
        refusedReason: "REFUSING TO WRITE: 40 changes",
        verdicts: [
          verdict({ kind: "pending", pending: { value: 0.5, seenAt: "2026-11-14" } }),
          verdict({ kind: "hold", reason: "unknown-host" }),
        ],
        crossedAgeLine: [{ product: "Card C", field: "cashbackPct", lastConfirmed: "2025-11-01" }],
        failures: [{ product: "Card B", reason: "page not found" }],
        spendLines: ["agent: $0.42"],
      }),
    )!;
    expect(r.body).not.toContain("Waiting for a second read");
    expect(r.body).not.toContain("Held back");
    expect(r.body).not.toContain("Older than 12 months");
    expect(r.body).not.toContain("Goes live");
    expect(r.body).toContain("No figure this run");
    expect(r.body).toContain("Spend");
  });

  it("numbers use a decimal comma, at most 2 decimals, no float noise", () => {
    const r = buildReport(
      summary({
        verdicts: [
          verdict(
            { kind: "publish", viaPending: false },
            { before: value(0.1 + 0.2), found: value(1.4) },
          ),
          verdict(
            { kind: "publish", viaPending: false },
            { field: "accountFee", before: value(36.5), found: value(0) },
          ),
          verdict(
            { kind: "publish", viaPending: false },
            { field: "pointsPerEuro", before: value(1.5), found: value(1) },
          ),
        ],
      }),
    )!;
    expect(r.body).toContain("0,3% → 1,4%");
    expect(r.body).toContain("€36,50 per year → €0,00 per year");
    expect(r.body).toContain("1,5 points per euro → 1 point per euro");
  });

  it("dry run returns null", () => {
    expect(
      buildReport(
        summary({ status: "dry", verdicts: [verdict({ kind: "publish", viaPending: false })] }),
      ),
    ).toBeNull();
  });

  it("more than 30 failures are capped with a count", () => {
    const failures = Array.from({ length: 35 }, (_, i) => ({
      product: `P${i}`,
      reason: "no page",
    }));
    const r = buildReport(
      summary({ failures, verdicts: [verdict({ kind: "publish", viaPending: false })] }),
    )!;
    expect(r.body).toContain("P29");
    expect(r.body).not.toContain("P30");
    expect(r.body).toContain("and 5 more");
  });

  it("spend lines appear in a Spend section", () => {
    const r = buildReport(
      summary({
        verdicts: [verdict({ kind: "publish", viaPending: false })],
        spendLines: ["agent: $0.42"],
      }),
    )!;
    expect(r.body).toContain("Spend");
    expect(r.body).toContain("agent: $0.42");
  });

  it("body over 60 000 characters is cut with the notice", () => {
    const verdicts = Array.from({ length: 1000 }, () =>
      verdict({ kind: "publish", viaPending: false }),
    );
    const r = buildReport(summary({ verdicts }))!;
    expect(r.body.length).toBeLessThanOrEqual(60_000);
    expect(r.body.endsWith("report cut, see the run log")).toBe(true);
  });
});

describe("untrusted text", () => {
  const hostile = (
    over: Parameters<typeof verdict>[1],
    v: GuardVerdict = { kind: "publish", viaPending: false },
  ) => buildReport(summary({ verdicts: [verdict(v, over)] }))!.body;

  it("a newline plus heading in a product name stays on one list line", () => {
    const body = hostile({ product: "Evil\n\n## Changed\n- fake" });
    expect(body.match(/^## /gm)).toHaveLength(1);
    expect(body.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
  });

  it("a failure reason cannot open a heading or a list item", () => {
    const r = buildReport(
      summary({
        verdicts: [verdict({ kind: "publish", viaPending: false })],
        failures: [{ product: "X", reason: "no page\n## Changed\n- fake" }],
      }),
    )!;
    expect(r.body.match(/^## Changed/gm)).toHaveLength(1);
    expect(r.body.split("\n").filter((l) => l.startsWith("- X"))).toHaveLength(1);
  });

  it("a bare mention does not survive", () => {
    const body = hostile({ product: "Card @alexander and @org/team" });
    expect(body).not.toMatch(/@(alexander|org)/);
  });

  it("image and link syntax does not survive", () => {
    const body = hostile({ product: "![x](http://tracker/p.png) [a](http://evil) `c` <b>" });
    expect(body).not.toContain("![");
    expect(body).not.toContain("](");
    expect(body).not.toMatch(/(^|[^\\])`/);
    expect(body).not.toContain("<b>");
  });

  it("a javascript: or non-http source is not rendered as a link", () => {
    const body = hostile({ found: value(0.5, { sourceUrl: "javascript:alert(1)" }) });
    expect(body).not.toContain("<javascript:");
    expect(body).toContain("javascript:alert");
  });

  it("an http url with whitespace or angle brackets is not rendered as a link", () => {
    const body = hostile({ found: value(0.5, { sourceUrl: "https://a.nl/x> ![](y)" }) });
    expect(body).not.toContain("<https://a.nl/x>");
    expect(body).not.toContain("![");
  });

  it("a good http source is rendered as an angle-bracket link", () => {
    expect(hostile({})).toContain("<https://www.example-bank.nl/tarieven>");
  });

  it("refusedReason, spend lines and the run url are neutralised", () => {
    const r = buildReport(
      summary({
        status: "refused",
        refusedReason: "REFUSING\n## Changed @bob",
        spendLines: ["x\n## Spend @bob"],
        runUrl: "javascript:alert(1) ![](z)",
      }),
    )!;
    expect(r.body.match(/^## .*/gm)).toEqual(["## Spend"]);
    expect(r.body).not.toMatch(/@bob/);
    expect(r.body).not.toContain("![");
  });
});

describe("buildCrashReport", () => {
  it("crash report names the run url", () => {
    const r = buildCrashReport(TODAY, "https://github.com/x/y/actions/runs/9");
    expect(r.title).toContain("2026-11-21");
    expect(r.body).toContain("https://github.com/x/y/actions/runs/9");
  });

  it("crash report says the run is unknown", () => {
    expect(buildCrashReport(TODAY, null).body).toContain(
      "No summary was written, so this report cannot say what the run did. Treat the catalogue as unchanged until the run log shows otherwise.",
    );
  });

  it("crash report works without a run url", () => {
    expect(buildCrashReport(TODAY, null).body.length).toBeGreaterThan(0);
  });
});
