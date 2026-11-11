import { describe, expect, test } from "vitest";
import type { Bill, BillOccurrence } from "@lavega/core";
import { billOccurrenceId, billsOutlook, generateBillOccurrences } from "@lavega/core";
import { billsCopy } from "./copy/bills.js";
import {
  cadenceText,
  calendarWeeks,
  historyRows,
  nextDueOnOrAfter,
  seriesRows,
  shiftMonth,
  upcomingRows,
} from "./bills-view.js";

/* The bills screen's derivations. The screen itself is pinned by
 * bills-ui.test.tsx; these pin the date/cadence reasoning behind it, with a
 * fixed `asOf` so nothing depends on the clock. */

const AS_OF = "2026-11-11";
const nl = billsCopy.nl;

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: "huur",
    name: "Huur",
    type: "bill",
    status: "active",
    direction: "out",
    amountCents: 100_000,
    amountStrategy: "fixed",
    currency: "EUR",
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 1 }],
    anchorDate: "2026-11-01",
    weekendAdjust: "none",
    endMode: "never",
    tags: [],
    ...overrides,
  };
}

function occ(
  billId: string,
  dueOn: string,
  status: BillOccurrence["status"] = "scheduled",
): BillOccurrence {
  return {
    id: billOccurrenceId(billId, dueOn),
    billId,
    originalDueOn: dueOn,
    dueOn,
    currency: "EUR",
    expectedAmountCents: null,
    status,
  };
}

describe("cadence text", () => {
  test("monthly, quarterly and yearly read as the owner set them", () => {
    expect(cadenceText(bill(), "nl", nl)).toBe("Elke maand op de 1e");
    expect(
      cadenceText(
        bill({ rules: [{ frequency: "monthly", interval: 3, dayOfMonth: 20 }] }),
        "nl",
        nl,
      ),
    ).toBe("Elk kwartaal op de 20e");
    expect(
      cadenceText(
        bill({ rules: [{ frequency: "monthly", interval: 6, dayOfMonth: 2 }] }),
        "nl",
        nl,
      ),
    ).toBe("Elke 6 maanden op de 2e");
    expect(
      cadenceText(
        bill({ rules: [{ frequency: "yearly", interval: 1, monthOfYear: 3, dayOfMonth: 15 }] }),
        "nl",
        nl,
      ),
    ).toBe("Elk jaar op 15 mrt");
  });

  test("weekly uses the anchor's weekday, and nth/last weekday shapes stay", () => {
    expect(
      cadenceText(bill({ rules: [{ frequency: "weekly", interval: 1, weekday: 1 }] }), "nl", nl),
    ).toBe("Elke maandag");
    expect(
      cadenceText(
        bill({ rules: [{ frequency: "monthly", interval: 1, weekday: 5, weekdayOrdinal: 3 }] }),
        "nl",
        nl,
      ),
    ).toBe("Elke 3e vrijdag van de maand");
    expect(
      cadenceText(
        bill({ rules: [{ frequency: "monthly", interval: 1, weekday: 5, weekdayOrdinal: -1 }] }),
        "nl",
        nl,
      ),
    ).toBe("Elke laatste vrijdag van de maand");
  });

  test("the last calendar day has a phrase of its own", () => {
    expect(
      cadenceText(
        bill({ rules: [{ frequency: "monthly", interval: 1, dayOfMonth: -1 }] }),
        "nl",
        nl,
      ),
    ).toBe("Elke maand op de laatste dag");
  });

  test("more than one rule falls back to the frequency names, never a made-up phrase", () => {
    expect(
      cadenceText(
        bill({
          rules: [
            { frequency: "monthly", interval: 1, dayOfMonth: 2 },
            { frequency: "monthly", interval: 1, dayOfMonth: 16 },
          ],
        }),
        "nl",
        nl,
      ),
    ).toBe("Maandelijks");
  });
});

describe("upcoming rows", () => {
  const bills = [
    bill(),
    bill({
      id: "spotify",
      name: "Spotify",
      amountCents: 1_099,
      anchorDate: "2026-11-20",
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 20 }],
    }),
    bill({
      id: "baan",
      name: "Salaris",
      type: "income",
      direction: "in",
      amountCents: 300_000,
      anchorDate: "2026-11-25",
      rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 25 }],
    }),
    bill({ id: "gepauzeerd", name: "Sportschool", status: "paused" }),
  ];
  const occurrences = generateBillOccurrences(bills, [], AS_OF).occurrences;

  test("next due is on or after asOf", () => {
    expect(nextDueOnOrAfter(bill(), AS_OF)).toBe("2026-12-01");
    expect(nextDueOnOrAfter(bill(), "2026-11-01")).toBe("2026-11-01");
    expect(nextDueOnOrAfter(bill({ endMode: "on_date", endOn: "2026-11-30" }), AS_OF)).toBeNull();
  });

  test("sorted by date, paused series left out, overdue first", () => {
    const rows = upcomingRows(bills, occurrences, AS_OF);
    expect(rows.map((r) => `${r.bill.id}:${r.occurrence.dueOn}`)).toEqual([
      "huur:2026-11-01",
      "spotify:2026-11-20",
      "baan:2026-11-25",
      "huur:2026-12-01",
      "spotify:2026-12-20",
      "baan:2026-12-25",
      "huur:2027-01-01",
      "spotify:2027-01-20",
      "baan:2027-01-25",
      "huur:2027-02-01",
    ]);
    const overdue = rows[0];
    expect(overdue.status).toBe("overdue");
    expect(overdue.past).toBe(true);
    expect(overdue.direction).toBe("out");
    expect(rows.find((r) => r.bill.id === "baan")?.direction).toBe("in");
  });

  test("the horizon clips rows that are further away", () => {
    const far = bill({
      id: "jaar",
      name: "Verzekering",
      anchorDate: "2027-06-01",
      rules: [{ frequency: "yearly", interval: 1, monthOfYear: 6, dayOfMonth: 1 }],
    });
    const generated = generateBillOccurrences([far], [], AS_OF, { horizonDays: 400 }).occurrences;
    expect(upcomingRows([far], generated, AS_OF, 90)).toEqual([]);
    expect(upcomingRows([far], generated, AS_OF, 400)).toHaveLength(1);
  });
});

describe("month grid", () => {
  const bills = [bill()];
  const occurrences = generateBillOccurrences(bills, [], AS_OF).occurrences;

  test("six Monday-first weeks covering the month", () => {
    const weeks = calendarWeeks(bills, occurrences, "2026-11", AS_OF);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0].date).toBe("2026-10-26"); // Monday before 1 November
    expect(weeks.flat().filter((c) => c.inMonth)).toHaveLength(30);
    const today = weeks.flat().find((c) => c.isToday);
    expect(today?.date).toBe(AS_OF);
  });

  test("an occurrence sits on its due date in the grid", () => {
    const cell = calendarWeeks(bills, occurrences, "2026-11", AS_OF)
      .flat()
      .find((c) => c.date === "2026-11-01");
    expect(cell?.rows.map((r) => r.bill.id)).toEqual(["huur"]);
  });

  test("shiftMonth moves whole months, across a year boundary", () => {
    expect(shiftMonth("2026-11", 1)).toBe("2026-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
});

describe("series and history", () => {
  const bills = [
    bill({ id: "b", name: "B", status: "ended" }),
    bill({ id: "a", name: "A" }),
    bill({ id: "c", name: "C", status: "paused" }),
  ];
  const occurrences = [
    occ("a", "2026-11-01"),
    occ("a", "2026-10-01", "paid"),
    occ("b", "2026-09-01", "paid"),
    occ("c", "2026-11-01", "skipped"),
  ];

  test("series order is active, suggested, paused, ended", () => {
    expect(seriesRows(bills, occurrences, AS_OF).map((r) => r.bill.id)).toEqual(["a", "c", "b"]);
  });

  test("history keeps closed rows only, newest first", () => {
    const rows = historyRows(bills, occurrences);
    expect(rows.map((r) => `${r.occurrence.billId}:${r.occurrence.status}`)).toEqual([
      "c:skipped",
      "a:paid",
      "b:paid",
    ]);
  });

  test("the outlook numbers the screen shows come from core, not the view", () => {
    const generated = generateBillOccurrences([bill()], [], AS_OF).occurrences;
    const outlook = billsOutlook([bill()], generated, AS_OF, 50_000);
    expect(outlook.overdueCents).toBe(100_000);
    expect(outlook.shortfallCents).toBeNull(); // no income series
  });
});
