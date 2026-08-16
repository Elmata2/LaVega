import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { monthlyTotals } from "@lavega/core";
import { formatEuro } from "../../format.js";
import StatistiekBlock, { statSummary } from "./StatistiekBlock";
import { txs } from "./fixtures";

test("StatistiekBlock renders a bar pair and a month label per month", () => {
  const html = renderToStaticMarkup(<StatistiekBlock txs={txs} />);
  expect(html).toContain("Statistieken");
  expect(html).toContain("Inkomsten");
  expect(html).toContain("Uitgaven");
  // Three months in the fixture (jun/jul/aug 2026), two bars each. The bars are
  // HTML boxes, not SVG <rect>s (see components/CategoryBars.tsx), so labels
  // and axis ticks stay at their real size when the grid collapses to one
  // column on a phone.
  expect(html.match(/class="lv-bar"/g)?.length).toBe(6);
  expect(html).toContain('class="lv-bars-xaxis"');
  expect(html).toContain(">jun<");
  expect(html).toContain(">jul<");
  expect(html).toContain(">aug<");
  expect(html).toContain("Gem. inkomsten p/m");
  expect(html).toContain(formatEuro((12_000 + 9_500) / 3));
});

test("StatistiekBlock renders an empty state instead of a chart with no transactions", () => {
  const html = renderToStaticMarkup(<StatistiekBlock txs={[]} />);
  expect(html).toContain("Nog geen transacties");
  expect(html).not.toContain("lv-bar");
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
