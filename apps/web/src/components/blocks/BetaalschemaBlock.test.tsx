import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { formatEuro } from "../../format.js";
import BetaalschemaBlock from "./BetaalschemaBlock";
import { ASOF, scheduledFlows } from "./fixtures";

test("BetaalschemaBlock lists the unpaid flows by due date, overdue first", () => {
  const html = renderToStaticMarkup(<BetaalschemaBlock scheduledFlows={scheduledFlows} asOf={ASOF} />);
  expect(html).toContain("Betaalschema");
  // Sorted ascending by dueDate: 31 jul (overdue) before 28 aug before 31 okt.
  expect(html.indexOf("BTW Q2 2026")).toBeLessThan(html.indexOf("Factuur Klant BV"));
  expect(html.indexOf("Factuur Klant BV")).toBeLessThan(html.indexOf("BTW Q3 2026"));
  // The date tile.
  expect(html).toContain(">31<");
  expect(html).toContain(">jul<");
  // A due date before asOf is flagged, once in the row and once in the footer.
  expect(html).toContain("pay-date-overdue");
  expect(html).toContain("te laat");
  expect(html).toContain("1 datum al verstreken.");
  // sign drives the amount's direction: -1 out, +1 in.
  expect(html).toContain(formatEuro(-4_125));
  expect(html).toContain(formatEuro(1_200));
  // A paid flow is not part of the schedule any more.
  expect(html).not.toContain("Al betaald");
});

test("BetaalschemaBlock renders an empty state when nothing is scheduled", () => {
  const html = renderToStaticMarkup(<BetaalschemaBlock scheduledFlows={[]} asOf={ASOF} />);
  expect(html).toContain("Niets ingepland");
  expect(html).not.toContain("pay-row");
});
