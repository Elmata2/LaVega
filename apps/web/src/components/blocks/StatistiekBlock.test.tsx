import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { categorize, monthlyTotals } from "@lavega/core";
import { formatEuro } from "../../format.js";
import StatistiekBlock, { monthAxisLabel, statSummary } from "./StatistiekBlock";
import { freshTxs, own, rules, txs } from "./fixtures";

const render = (t = txs) =>
  renderToStaticMarkup(<StatistiekBlock txs={t} rules={rules} own={own} onSelectCategory={() => {}} />);

test("StatistiekBlock leads with the per-category-per-month view from the reference", () => {
  const html = render();
  expect(html).toContain("Statistieken");
  // Both reference views are offered.
  expect(html).toContain("Categorieën");
  expect(html).toContain("Weekdagen");
  // Grouped bars: three months of fixture data × three spend categories.
  expect(html).toContain('class="lv-bars-xaxis"');
  expect(html).toContain(">jun<");
  expect(html).toContain(">jul<");
  expect(html).toContain(">aug<");
  expect(html.match(/class="lv-bar"/g)?.length).toBe(9);
  // The categories are the ones the rules engine derived, not invented labels.
  expect(html).toContain("Inkoop"); // manual label on t3/t6
  expect(html).toContain("Energie"); // user rule on t5
  expect(html).toContain(categorize(txs[1], rules, own)); // Dutch default on t2
  // The averages under the chart survive the merge.
  expect(html).toContain("Gem. inkomsten p/m");
  expect(html).toContain(formatEuro((12_000 + 9_500) / 3));
});

test("StatistiekBlock is the major block and absorbs the category comparison", () => {
  const html = render();
  expect(html).toContain("module-span-3");
  // The old separate "Verandering per categorie" block is gone; its question is
  // this view.
  expect(html).not.toContain("Verandering per categorie");
});

test("StatistiekBlock never draws a month it has no statement for", () => {
  // The default period is twelve months but the fixture holds three, so the
  // axis has three groups — nine empty ones would be nine bars of zero, i.e. a
  // claim that nothing was spent in a month we never saw.
  const html = render();
  expect(html.match(/<span title="[^"]*">/g)?.length).toBeLessThanOrEqual(12);
  expect(html).not.toContain(">mei<");
  expect(html).not.toContain(">jan<");
});

test("StatistiekBlock renders an empty state instead of a chart with no transactions", () => {
  const html = render([]);
  expect(html).toContain("Nog geen transacties");
  expect(html).not.toContain("lv-bar");
});

test("monthAxisLabel keeps month labels unique once the window passes a year", () => {
  expect(monthAxisLabel("2026-08", 12)).toBe("aug");
  expect(monthAxisLabel("2026-08", 18)).toBe("aug '26");
  expect(monthAxisLabel("2025-08", 18)).toBe("aug '25");
});

test("statSummary windows the months and compares the last one to the average", () => {
  const totals = monthlyTotals(txs);
  expect(totals.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08"]);

  const all = statSummary(totals, "alle");
  expect(all.rows).toHaveLength(3);
  expect(all.avgIn).toBeCloseTo((12_000 + 9_500) / 3, 6);
  expect(all.avgOut).toBeCloseTo((420.5 + 1_880 + 250 + 1_100) / 3, 6);
  // August has no income at all, so the last month is 100% below the average.
  expect(all.lastIn).toBe(0);
  expect(all.deltaInPct).toBeCloseTo(-100, 6);

  // A window shorter than the history keeps only the newest months.
  expect(statSummary(totals, "6").rows).toHaveLength(3);
  const one = statSummary(totals.slice(-1), "alle");
  expect(one.rows.map((m) => m.month)).toEqual(["2026-08"]);
});

test("statSummary reports no delta rather than 0% when there is nothing to compare", () => {
  const s = statSummary([], "alle");
  expect(s.rows).toEqual([]);
  expect(s.deltaInPct).toBeNull();
  expect(s.deltaOutPct).toBeNull();
});

test("StatistiekBlock still renders with two days of history", () => {
  // The weekday view is the one that refuses (see statistics.test.ts); the
  // block itself must not crash on a nearly-empty vault.
  const html = render(freshTxs);
  expect(html).toContain("Statistieken");
});
