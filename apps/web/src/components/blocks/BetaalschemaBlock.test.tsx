import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Tx } from "@lavega/core";
import { formatEuro } from "../../format.js";
import BetaalschemaBlock, { agendaRows, cadenceLabel, nextOccurrence } from "./BetaalschemaBlock";
import { ASOF, scheduledFlows } from "./fixtures";

/** A monthly subscription core's detector will recognise: same counterparty,
 *  same amount, ~30 days apart, three occurrences. */
const recurring: Tx[] = ["2026-05-18", "2026-06-17", "2026-07-17"].map((date, i) => ({
  id: `sub${i}`,
  accountKey: "A1",
  date,
  amount: -14.99,
  currency: "EUR",
  counterparty: "Spotify",
  description: "Premium",
  category: "",
  manual: false,
}));

test("BetaalschemaBlock lists the planned flows by due date, overdue flagged", () => {
  const html = renderToStaticMarkup(
    <BetaalschemaBlock scheduledFlows={scheduledFlows} txs={[]} asOf={ASOF} />,
  );
  expect(html).toContain("Betaalagenda");
  // Sorted ascending by date: 31 jul (overdue) before 28 aug before 31 okt.
  expect(html.indexOf("BTW Q2 2026")).toBeLessThan(html.indexOf("Factuur Klant BV"));
  expect(html.indexOf("Factuur Klant BV")).toBeLessThan(html.indexOf("BTW Q3 2026"));
  expect(html).toContain(">31<");
  expect(html).toContain(">jul<");
  expect(html).toContain("pay-date-overdue");
  expect(html).toContain("te laat");
  expect(html).toContain("1 datum al verstreken.");
  // sign drives the amount's direction: -1 out, +1 in.
  expect(html).toContain(formatEuro(-4_125));
  expect(html).toContain(formatEuro(1_200));
  // A paid flow is not part of the agenda any more.
  expect(html).not.toContain("Al betaald");
  expect(html).toContain("Alle regels zijn ingeplande bedragen.");
});

test("BetaalschemaBlock adds detected recurring payments and marks them as predictions", () => {
  const html = renderToStaticMarkup(
    <BetaalschemaBlock scheduledFlows={scheduledFlows} txs={recurring} asOf={ASOF} />,
  );
  expect(html).toContain("Spotify");
  expect(html).toContain("voorspeld");
  expect(html).toContain("maandelijks · 3× gezien");
  expect(html).toContain("1 regel voorspeld uit je eigen geschiedenis, niet bevestigd.");
  expect(html).toContain(formatEuro(-14.99));
});

test("BetaalschemaBlock renders an empty state when nothing is scheduled or detected", () => {
  const html = renderToStaticMarkup(<BetaalschemaBlock scheduledFlows={[]} txs={[]} asOf={ASOF} />);
  expect(html).toContain("Niets ingepland");
  expect(html).not.toContain("pay-row");
});

test("nextOccurrence rolls a stream forward past today, never back", () => {
  // Last seen 17 jul, monthly: the next one after 16 aug is 16 aug itself.
  expect(nextOccurrence("2026-07-17", 30, ASOF)).toBe("2026-08-16");
  // A stream whose last occurrence is already in the future just steps once.
  expect(nextOccurrence("2026-09-01", 30, ASOF)).toBe("2026-10-01");
  // Several cadences behind: it lands on or after asOf, not on the first step.
  expect(nextOccurrence("2026-01-05", 30, ASOF) >= ASOF).toBe(true);
});

test("cadenceLabel names the cadences core snaps to", () => {
  expect(cadenceLabel(7)).toBe("wekelijks");
  expect(cadenceLabel(14)).toBe("elke 2 weken");
  expect(cadenceLabel(30)).toBe("maandelijks");
  expect(cadenceLabel(91)).toBe("elk kwartaal");
  expect(cadenceLabel(365)).toBe("jaarlijks");
});

test("agendaRows keeps a prediction distinguishable from a committed date", () => {
  const rows = agendaRows(scheduledFlows, recurring, ASOF);
  const spotify = rows.find((r) => r.label === "Spotify");
  expect(spotify?.predicted).toBe(true);
  expect(rows.find((r) => r.label === "BTW Q2 2026")?.predicted).toBe(false);
  // Sorted by date, oldest first.
  expect([...rows].map((r) => r.date)).toEqual([...rows].map((r) => r.date).sort());
});
