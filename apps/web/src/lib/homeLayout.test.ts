import { describe, expect, it } from "vitest";
import { isArchivedWidget } from "../archive";
import type { WidgetId } from "../components/moduleRegistry";
import { homeSpans } from "./homeLayout";

const HEAD: readonly (WidgetId | "chart")[] = ["chart", "positie"];
const OPTIONAL_IDS: readonly WidgetId[] = [
  "recente-transacties",
  "betaalagenda",
  "btw-stand",
  "facturen-open",
  "top-uitgaven",
];
const SIX: readonly WidgetId[] = ["positie", ...OPTIONAL_IDS];

function subsets<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 0; mask < 1 << items.length; mask += 1) {
    out.push(items.filter((_, i) => (mask & (1 << i)) !== 0));
  }
  return out;
}

/** Walk the ids in page order and check every row sums to 3. */
function expectFullRows(spans: Record<string, number | undefined>, order: readonly string[]) {
  let row = 0;
  for (const id of order) {
    const span = spans[id];
    if (span === undefined) continue;
    row += span;
    if (row === 3) row = 0;
    expect(row, `row overflow at ${id}`).toBeLessThan(3);
  }
  expect(row, "last row is not full").toBe(0);
}

describe("homeSpans", () => {
  it("gives the chart the full width when nothing is on", () => {
    expect(homeSpans([])).toEqual({ chart: 3 });
  });

  it("packs every row to 3 for every subset of the optional widgets", () => {
    for (const enabled of subsets(SIX)) {
      const spans = homeSpans(enabled);
      expectFullRows(spans, HEAD);
      expectFullRows(spans, OPTIONAL_IDS);
    }
  });

  it("never returns a span for an archived or a disabled id", () => {
    for (const enabled of subsets(SIX)) {
      const spans = homeSpans(enabled);
      for (const id of Object.keys(spans)) {
        if (id === "chart") continue;
        expect(enabled).toContain(id);
        expect(isArchivedWidget(id)).toBe(false);
      }
    }
  });

  it("puts positie beside the chart unless it is archived", () => {
    if (isArchivedWidget("positie")) {
      expect(homeSpans(["positie"])).toEqual({ chart: 3 });
    } else {
      expect(homeSpans(["positie"])).toEqual({ chart: 2, positie: 1 });
    }
  });

  it("pairs recente transacties with betaalagenda as 2 + 1", () => {
    expect(homeSpans(["recente-transacties", "betaalagenda"])).toEqual({
      chart: 3,
      "recente-transacties": 2,
      betaalagenda: 1,
    });
  });

  it("gives a lone card the full width", () => {
    expect(homeSpans(["recente-transacties"])).toEqual({ chart: 3, "recente-transacties": 3 });
  });

  it("pairs btw with facturen as 2 + 1 unless they are archived", () => {
    const spans = homeSpans(["btw-stand", "facturen-open"]);
    if (isArchivedWidget("btw-stand")) {
      expect(spans).toEqual({ chart: 3 });
    } else {
      expect(spans).toEqual({ chart: 3, "btw-stand": 2, "facturen-open": 1 });
    }
  });

  it("pairs two unrelated singles as 2 + 1 in page order", () => {
    expect(homeSpans(["betaalagenda", "top-uitgaven"])).toEqual({
      chart: 3,
      betaalagenda: 2,
      "top-uitgaven": 1,
    });
  });

  it("leaves a single before a preferred pair at full width", () => {
    if (isArchivedWidget("btw-stand")) return;
    expect(
      homeSpans(["recente-transacties", "btw-stand", "facturen-open", "top-uitgaven"]),
    ).toEqual({
      chart: 3,
      "recente-transacties": 3,
      "btw-stand": 2,
      "facturen-open": 1,
      "top-uitgaven": 3,
    });
  });
});
