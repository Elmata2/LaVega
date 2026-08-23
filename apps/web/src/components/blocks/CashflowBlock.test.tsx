import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { formatEuro } from "../../format.js";
import CashflowBlock from "./CashflowBlock";
import { forecast } from "./fixtures";

test("CashflowBlock draws the forecast it is given and reports no shortfall", () => {
  const html = renderToStaticMarkup(
    <CashflowBlock forecast={forecast} bufferCents={250_000} onNavigate={() => {}} />,
  );
  expect(html).toContain("Cashflow");
  expect(html).toContain("Verwachte kaspositie komende 13 weken");
  expect(html).toContain("<path"); // the smoothed median line
  expect(html).toContain("Geen tekort verwacht in de komende 13 weken.");
  expect(html).not.toContain("lv-chart-mark"); // the shortfall marker
  // The chart starts at today's real position, not at week 1, and the readout
  // opens on the last point — the number the card is actually about.
  expect(html).toContain(">nu<");
  expect(html).toContain("Verwacht · week 3");
});

test("CashflowBlock names the tightest week when the forecast dips below the buffer", () => {
  const shortfall = {
    ...forecast,
    shortfall: { date: forecast.points[1].date, balanceCents: 120_000 },
  };
  const html = renderToStaticMarkup(
    <CashflowBlock forecast={shortfall} bufferCents={250_000} onNavigate={() => {}} />,
  );
  expect(html).toContain("Krapste week:");
  expect(html).toContain("week 2");
  expect(html).toContain(formatEuro(1_200));
  // Week 2 is index 2 of [nu, week 1, week 2, week 3] — the marker sits there.
  expect(html).toContain('class="lv-chart-mark" style="left:66.67%');
});

test("CashflowBlock says why it cannot forecast instead of drawing an empty chart", () => {
  // The engine still emits weekly points with a null opening position, so the
  // footer must not claim "no shortfall" over a body that says it can't tell.
  const unknown = { ...forecast, openingCents: null };
  const html = renderToStaticMarkup(
    <CashflowBlock forecast={unknown} bufferCents={0} onNavigate={() => {}} />,
  );
  expect(html).toContain("Positie onbekend");
  expect(html).not.toContain("<svg");
  expect(html).not.toContain("module-foot");
});
