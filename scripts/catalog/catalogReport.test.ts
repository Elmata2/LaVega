import { describe, expect, it } from "vitest";
import type {
  CatalogField,
  CatalogValue,
  FieldVerdict,
  FigureCoverage,
  GuardVerdict,
} from "@lavega/core";
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

  describe("conditions-only publish", () => {
    const condOnly = (
      n: number,
      over: { before?: CatalogValue; found?: CatalogValue } = {},
    ): FieldVerdict =>
      verdict(
        { kind: "publish", viaPending: false, conditionsOnly: true },
        {
          product: `Card ${n}`,
          before: over.before ?? value(2),
          found:
            over.found ??
            value(2, { route: "agent", conditions: "applies to foreign currency payments" }),
        },
      );

    it("is not in the Changed section or the title count", () => {
      const r = buildReport(summary({ verdicts: [condOnly(1)] }))!;
      expect(r.title).toBe("Catalogue report 2026-11-21: 0 changed, 0 held");
      expect(r.body).not.toContain("## Changed");
    });

    it("is listed under Conditions text updated with the new text", () => {
      const r = buildReport(
        summary({
          verdicts: [
            condOnly(1),
            verdict({ kind: "publish", viaPending: false }, { product: "Card Z" }),
          ],
        }),
      )!;
      expect(r.title).toContain("1 changed");
      const body = r.body;
      expect(body).toContain("## Conditions text updated (figure unchanged)");
      const sec = body.split("## Conditions text updated (figure unchanged)")[1]!;
      expect(sec).toContain("Card 1");
      expect(sec).toContain("2%");
      expect(sec).toContain("Read by the model from: <https://www.example-bank.nl/tarieven>");
      expect(sec).toContain(
        "was listed as unconditional; now: applies to foreign currency payments",
      );
      expect(body.indexOf("## Changed")).toBeLessThan(body.indexOf("## Conditions text updated"));
      expect(sec).not.toContain("Card Z");
    });

    it("cuts the new text to 200 characters", () => {
      const long = "x".repeat(300);
      const r = buildReport(
        summary({ verdicts: [condOnly(1, { found: value(2, { conditions: long }) })] }),
      )!;
      expect(r.body).toContain("x".repeat(200));
      expect(r.body).not.toContain("x".repeat(201));
    });

    it("is capped at 30", () => {
      const many = Array.from({ length: 35 }, (_, i) => condOnly(i));
      const r = buildReport(summary({ verdicts: many }))!;
      const sec = r.body.split("## Conditions text updated (figure unchanged)")[1]!;
      expect(sec.split("\n").filter((l) => l.startsWith("- Card")).length).toBe(30);
      expect(sec).toContain("- and 5 more");
    });
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

  it("a written run with nothing changed still reports", () => {
    const r = buildReport(
      summary({ verdicts: [verdict({ kind: "confirm" }), verdict({ kind: "unjudged" })] }),
    );
    expect(r).not.toBeNull();
    expect(r!.title).toBe("Catalogue report 2026-11-21: 0 changed, 0 held");
  });

  it("a written run with failures alone still reports", () => {
    const r = buildReport(summary({ failures: [{ product: "Card B", reason: "page not found" }] }));
    expect(r!.body).toContain("## No figure this run");
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
    const reasons = [
      "out-of-range",
      "unknown-host",
      "comparison-route",
      "bad-source-url",
      "conflicting-read",
      "change-not-cross-checked",
      "held-for-person",
    ] as const;
    const r = buildReport(
      summary({ verdicts: reasons.map((reason) => verdict({ kind: "hold", reason })) }),
    )!;
    expect(r.title).toBe("Catalogue report 2026-11-21: 0 changed, 7 held");
    expect(r.body).toContain("the value is outside the range that is possible for this field");
    expect(r.body).toContain("the figure came from a website not seen before for this provider");
    expect(r.body).toContain("the figure came from a comparison site, not the provider");
    expect(r.body).toContain("the source link is missing or broken");
    expect(r.body).toContain(
      "the page showed a different value, and the check on the stored value did not give a clear answer; the stored value stays and the next run checks again",
    );
    expect(r.body).toContain(
      "the page shows both the stored value and a different one; the stored value stays until a person or a later run settles it",
    );
    expect(r.body.match(/old figure stays/gi)?.length).toBe(1);
  });

  it("older than 12 months section lists the figures", () => {
    const r = buildReport(
      summary({
        crossedAgeLine: [{ product: "Card C", field: "cashbackPct", lastConfirmed: "2025-11-01" }],
      }),
    )!;
    expect(r.body).toContain("## Passed the 12-month line this week");
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
    expect(r.body).toContain(
      "This run stopped early or its results could not be saved. Nothing from it was published.",
    );
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

  it("prints the run time after the Spend section when the summary carries it", () => {
    const r = buildReport(
      summary({
        verdicts: [verdict({ kind: "publish", viaPending: false })],
        spendLines: ["agent: $0.42"],
        durationMinutes: 47,
        concurrency: 4,
      }),
    )!;
    expect(r.body).toContain("Run time: 47 minutes.");
    expect(r.body.indexOf("Run time:")).toBeGreaterThan(r.body.indexOf("agent: $0.42"));
  });

  it("prints no run time line when the summary has none", () => {
    const r = buildReport(
      summary({ verdicts: [verdict({ kind: "publish", viaPending: false })] }),
    )!;
    expect(r.body).not.toContain("Run time");
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

const fig = (over: Partial<FigureCoverage> = {}): FigureCoverage => ({
  id: "card-a",
  product: "Card A",
  field: "fxFeePct",
  status: "confirmed",
  detail: "read again",
  uncheckedWeeks: 0,
  ...over,
  weeksIfNotSaved: over.weeksIfNotSaved ?? over.uncheckedWeeks ?? 0,
});

describe("coverage in the report", () => {
  it("header counts by status", () => {
    const r = buildReport(
      summary({
        coverage: [
          fig({ status: "confirmed" }),
          fig({ status: "confirmed" }),
          fig({ status: "changed" }),
          fig({ status: "waiting" }),
          fig({ status: "held" }),
          fig({ status: "not-checked", cause: "not-in-this-run", uncheckedWeeks: 0 }),
        ],
      }),
    )!;
    expect(r.body).toContain(
      "Checked this run: 5 of 6 figures (2 confirmed, 1 changed, 1 waiting, 1 held).",
    );
    expect(r.body).not.toContain("quote check or a same-number read");
    expect(r.body).not.toContain("older than 12 months.\n\nChecked");
  });

  it("prints the model call line after the Checked lines, and omits it when absent", () => {
    const r = buildReport(
      summary({ coverage: [fig()], modelCallsNew: 12, modelCallsReused: 188 }),
    )!;
    expect(r.body).toContain(
      "Model calls: 12 new, 188 reused because the page and the question were unchanged.",
    );
    expect(r.body.indexOf("Checked this run")).toBeLessThan(r.body.indexOf("Model calls:"));
    expect(buildReport(summary({ coverage: [fig()] }))!.body).not.toContain("Model calls:");
  });

  it("adds the fallback part only when there were fallbacks", () => {
    const withF = buildReport(
      summary({ coverage: [fig()], modelCallsNew: 5, modelCallsReused: 1, modelFallbacks: 2 }),
    )!;
    expect(withF.body).toContain(
      "Model calls: 5 new, 1 reused because the page and the question were unchanged, 2 answered by the faster fallback model after a timeout.",
    );
    const none = buildReport(
      summary({ coverage: [fig()], modelCallsNew: 5, modelCallsReused: 1, modelFallbacks: 0 }),
    )!;
    expect(none.body).not.toContain("fallback");
  });

  it("prints a Warnings section right under the header when there are warnings", () => {
    const r = buildReport(
      summary({ coverage: [fig()], warnings: ["No fresh model call was made this run."] }),
    )!;
    expect(r.body).toContain("## Warnings\n- No fresh model call was made this run.");
    expect(r.body.indexOf("Checked this run")).toBeLessThan(r.body.indexOf("## Warnings"));
    expect(buildReport(summary({ coverage: [fig()] }))!.body).not.toContain("## Warnings");
  });

  it("says how many confirmations were weaker than a full re-read", () => {
    const r = buildReport(
      summary({
        coverage: [
          fig({ detail: "quote check" }),
          fig({ detail: "same number read" }),
          fig({ detail: "read again" }),
        ],
      }),
    )!;
    expect(r.body).toContain(
      "Of the confirmed figures, 2 were confirmed by a quote check or a same-number read, not by a full re-read.",
    );
  });

  it("not checked is grouped by cause with weeks, longest first", () => {
    const r = buildReport(
      summary({
        coverage: [
          fig({ status: "not-checked", cause: "fetch-failed", product: "Zeta", uncheckedWeeks: 2 }),
          fig({
            status: "not-checked",
            cause: "fetch-failed",
            product: "Alpha",
            uncheckedWeeks: 2,
          }),
          fig({ status: "not-checked", cause: "fetch-failed", product: "Mid", uncheckedWeeks: 5 }),
          fig({ status: "not-checked", cause: "no-source", product: "Hand", uncheckedWeeks: 1 }),
        ],
      }),
    )!;
    expect(r.body).toContain("## Not checked");
    expect(r.body).toContain("The provider's page or document could not be read");
    expect(r.body).toContain("No web source on file (figure was entered by hand)");
    const lines = r.body.split("\n");
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at("Mid")).toBeLessThan(at("Alpha"));
    expect(at("Alpha")).toBeLessThan(at("Zeta"));
    expect(r.body).toContain("- Mid, foreign currency fee: 5 weeks");
    expect(r.body).toContain("- Hand, foreign currency fee: 1 week");
  });

  it("field-not-swept is one line", () => {
    const r = buildReport(
      summary({
        coverage: Array.from({ length: 12 }, (_, i) =>
          fig({
            id: `c${i}`,
            product: `Card ${i}`,
            field: "accountFee",
            status: "not-checked",
            cause: "field-not-swept",
            uncheckedWeeks: 1,
          }),
        ),
      }),
    )!;
    expect(r.body).toContain(
      "Not checked yet by the weekly run: account fees, points and cashback (planned): 12 figures",
    );
    expect(r.body).not.toContain("Card 3");
  });

  it("cap of 40 per cause", () => {
    const r = buildReport(
      summary({
        coverage: Array.from({ length: 50 }, (_, i) =>
          fig({
            id: `c${i}`,
            product: `Card ${String(i).padStart(2, "0")}`,
            status: "not-checked",
            cause: "fetch-failed",
            uncheckedWeeks: 1,
          }),
        ),
      }),
    )!;
    expect(r.body.split("\n").filter((l) => l.startsWith("- Card "))).toHaveLength(40);
    expect(r.body).toContain("- and 10 more");
  });

  it("product names in not checked are neutralised", () => {
    const r = buildReport(
      summary({
        coverage: [
          fig({ status: "not-checked", cause: "no-source", product: "@bob [x](http://e.vil) *b*" }),
        ],
      }),
    )!;
    expect(r.body).not.toContain("@bob");
    expect(r.body).not.toContain("[x](");
  });

  it("not part of this run shows no weeks, and a count line past 40", () => {
    const few = buildReport(
      summary({
        coverage: [fig({ status: "not-checked", cause: "not-in-this-run", product: "Solo" })],
      }),
    )!;
    expect(few.body).toContain("- Solo, foreign currency fee");
    expect(few.body).not.toContain("Solo, foreign currency fee:");
    const many = buildReport(
      summary({
        coverage: Array.from({ length: 41 }, (_, i) =>
          fig({
            id: `c${i}`,
            product: `Card ${i}`,
            status: "not-checked",
            cause: "not-in-this-run",
          }),
        ),
      }),
    )!;
    expect(many.body).toContain("- 41 figures");
    expect(many.body).not.toContain("Card 3,");
  });

  it("not asked has a plain sentence", () => {
    const r = buildReport(
      summary({
        coverage: [fig({ status: "not-checked", cause: "not-asked", uncheckedWeeks: 1 })],
      }),
    )!;
    expect(r.body).toContain(
      "This product is checked for a different figure; this one is not asked yet",
    );
  });

  it("the new causes have plain sentences", () => {
    const r = buildReport(
      summary({
        coverage: [
          fig({ status: "not-checked", cause: "model-off", uncheckedWeeks: 1 }),
          fig({ id: "b", status: "not-checked", cause: "not-tracked", uncheckedWeeks: 1 }),
          fig({ id: "c", status: "not-checked", cause: "no-figure-yet", uncheckedWeeks: 1 }),
        ],
      }),
    )!;
    expect(r.body).toContain(
      "The model step did not run (no API key, or switched off), and no other route can read this product",
    );
    expect(r.body).toContain("In the catalogue but not on the weekly run's watch list");
    expect(r.body).toContain("No figure on file yet for this product");
    const heads = r.body.split("\n").filter((l) => l.startsWith("### "));
    expect(heads.map((h) => h.slice(4))).toEqual([
      "In the catalogue but not on the weekly run's watch list",
      "The model step did not run (no API key, or switched off), and no other route can read this product",
      "No figure on file yet for this product",
    ]);
  });

  it("the weaker-route sentence has correct grammar for one and many", () => {
    const one = buildReport(summary({ coverage: [fig({ detail: "quote check" })] }))!;
    expect(one.body).toContain("Of the confirmed figures, 1 was confirmed by a quote check");
    const two = buildReport(
      summary({ coverage: [fig({ detail: "quote check" }), fig({ detail: "same number read" })] }),
    )!;
    expect(two.body).toContain("Of the confirmed figures, 2 were confirmed by a quote check");
  });

  it("the agent route reads as read by the model", () => {
    const r = buildReport(
      summary({
        verdicts: [
          verdict(
            { kind: "publish", viaPending: false },
            { found: value(0.5, { route: "agent" }) },
          ),
        ],
      }),
    )!;
    expect(r.body).toContain("Read by the model from: <https://www.example-bank.nl/tarieven>");
    expect(r.body).not.toContain("research agent");
  });

  const refusedCoverage = [
    fig({ status: "changed" }),
    fig({ id: "b", status: "confirmed", detail: "read again" }),
    fig({
      id: "c",
      status: "not-checked",
      cause: "fetch-failed",
      product: "Old",
      uncheckedWeeks: 3,
    }),
    fig({
      id: "d",
      status: "not-checked",
      cause: "fetch-failed",
      product: "Fresh",
      uncheckedWeeks: 1,
    }),
  ];
  const refusedSummary = (over: Partial<RunSummary> = {}) =>
    summary({
      status: "refused",
      refusedReason: "STOPPING: ceiling",
      runUrl: "https://github.com/x/y/actions/runs/1",
      verdicts: [
        verdict({ kind: "publish", viaPending: false }),
        verdict({ kind: "confirm" }),
        verdict({ kind: "unjudged" }),
      ],
      coverage: refusedCoverage,
      spendLines: ["model: $0.10"],
      ...over,
    });

  it("a refused report shows no status counts", () => {
    const r = buildReport(refusedSummary())!;
    expect(r.body).not.toContain("Checked this run");
    expect(r.body).not.toMatch(/\d+ (confirmed|changed|waiting|held)/);
    expect(r.body).not.toContain("## Changed");
    expect(r.body).toContain(
      "This run stopped early or its results could not be saved. Nothing from it was published.",
    );
    expect(r.body).toContain("STOPPING: ceiling");
    expect(r.body).toContain(
      "It had read 2 of 4 figures before it stopped. All 4 figures count as not checked this week.",
    );
    expect(r.body.indexOf("Run log:")).toBeLessThan(r.body.indexOf("Nothing from it"));
    expect(r.body).toContain("## Spend");
  });

  it("a push-failed report shows no status counts", () => {
    const r = buildReport({
      ...refusedSummary(),
      status: "refused",
      refusedReason: "the commit or push failed",
    })!;
    expect(r.body).not.toMatch(/\d+ (confirmed|changed|waiting|held)/);
    expect(r.body).toContain("the commit or push failed");
  });

  it("a refused report lists only figures unchecked for two weeks or more", () => {
    const r = buildReport(refusedSummary())!;
    expect(r.body).toContain("- Old, foreign currency fee: 3 weeks");
    expect(r.body).not.toContain("Fresh");
  });

  it("a figure with a verdict in a refused run is listed when its stored date is two weeks old", () => {
    const r = buildReport(
      refusedSummary({
        coverage: [
          fig({
            id: "v",
            product: "Verdict Card",
            status: "confirmed",
            detail: "read again",
            uncheckedWeeks: 0,
            weeksIfNotSaved: 3,
          }),
        ],
      }),
    )!;
    expect(r.body).toContain("- Verdict Card, foreign currency fee: 3 weeks");
    expect(r.body).toContain("The run stopped before it reached this product");
    expect(r.body).not.toMatch(/\d+ (confirmed|changed)/);
  });

  it("a figure checked last week is not listed in a refused report (1 week)", () => {
    const r = buildReport(
      refusedSummary({
        coverage: [
          fig({ id: "v", product: "Verdict Card", status: "changed", weeksIfNotSaved: 1 }),
        ],
      }),
    )!;
    expect(r.body).not.toContain("Verdict Card");
  });

  it("a refused report without coverage omits the read sentence", () => {
    const r = buildReport(refusedSummary({ coverage: undefined }))!;
    expect(r.body).not.toContain("It had read");
  });
});

describe("final fix wave", () => {
  it("a manual hold shows its text and the reason from the list, cut and neutralised", () => {
    const r = buildReport(
      summary({
        verdicts: [verdict({ kind: "hold", reason: "held-for-person" }, { product: "Tria" })],
        manualHoldReasons: {
          "card-a.fxFeePct": `Page says 1% *plus* 0.5% @bob ${"x".repeat(400)}`,
        },
      }),
    )!;
    expect(r.body).toContain("a person must decide this figure; it is on the manual hold list");
    expect(r.body).toContain("Page says 1% \\*plus\\* 0.5% @\u200Bbob");
    expect(r.body).not.toContain("x".repeat(301));
  });

  it("a held figure shows how long it has been held", () => {
    const r = buildReport(
      summary({
        verdicts: [verdict({ kind: "hold", reason: "out-of-range" })],
        coverage: [fig({ status: "held", detail: "out-of-range", heldWeeks: 3 })],
      }),
    )!;
    expect(r.body).toContain("held for 3 weeks");
    const one = buildReport(
      summary({
        verdicts: [verdict({ kind: "hold", reason: "out-of-range" })],
        coverage: [fig({ status: "held", detail: "out-of-range", heldWeeks: 1 })],
      }),
    )!;
    expect(one.body).toContain("held for 1 week)");
  });

  it("Changed and Waiting lines carry the evidence quote, cut to 200 characters", () => {
    const long = `Koersopslag 0,5% ${"y".repeat(300)}`;
    const r = buildReport(
      summary({
        verdicts: [
          verdict({ kind: "publish", viaPending: false }),
          verdict(
            { kind: "pending", pending: { value: 0.5, seenAt: "2026-11-14" } },
            { product: "Card B" },
          ),
        ],
        evidenceQuotes: { "card-a.fxFeePct": long },
      }),
    )!;
    const sec = r.body.split("## Changed")[1]!.split("## Waiting")[0]!;
    expect(sec).toContain('Quote: "Koersopslag 0,5% ');
    expect(sec).not.toContain("y".repeat(201));
    const noQuote = buildReport(
      summary({ verdicts: [verdict({ kind: "publish", viaPending: false })] }),
    )!;
    expect(noQuote.body).not.toContain("Quote:");
  });

  it("lists the weaker confirmations after Held, sorted, capped at 30", () => {
    const weak = Array.from({ length: 32 }, (_, i) =>
      fig({
        id: `p${String(i).padStart(2, "0")}`,
        product: `Prod ${String(31 - i).padStart(2, "0")}`,
        detail: i % 2 ? "quote check" : "same number read",
      }),
    );
    const r = buildReport(
      summary({
        verdicts: [verdict({ kind: "hold", reason: "out-of-range" })],
        coverage: [...weak, fig({ id: "z", product: "Full", detail: "read again" })],
      }),
    )!;
    const title = "## Confirmed by quote check or same-number read (weaker than a full re-read)";
    expect(r.body).toContain(title);
    expect(r.body.indexOf("## Held back")).toBeLessThan(r.body.indexOf(title));
    const sec = r.body.split(title)[1]!.split("\n## ")[0]!;
    expect(sec.match(/^- /gm)?.length).toBe(31);
    expect(sec).toContain("- and 2 more");
    expect(sec.indexOf("Prod 00")).toBeLessThan(sec.indexOf("Prod 01"));
    expect(sec).not.toContain("Full");
    expect(buildReport(summary({ coverage: [fig()] }))!.body).not.toContain(title);
  });
});
