import { describe, expect, it } from "vitest";
import { childSignal } from "./childSignal.js";
import { mkTx, monthly } from "./testkit.js";

describe("childSignal", () => {
  it("kinderbijslag x3 -> signal with evidence", () => {
    const rows = [
      mkTx("SVB", "2026-01-03", 250, { description: "kinderbijslag" }),
      mkTx("SVB", "2026-04-03", 250, { description: "kinderbijslag" }),
      mkTx("SVB", "2026-07-03", 250, { description: "kinderbijslag" }),
    ];
    const s = childSignal(rows, [], undefined);
    expect(s?.kind).toBe("kinderbijslag");
    expect(s?.evidence.sort()).toEqual(rows.map((r) => r.id).sort());
  });
  it("childcare outflow -> childcare signal", () => {
    const rows = monthly("Kinderopvang Zonnetje", -600, 4, "01");
    expect(childSignal(rows, [], undefined)?.kind).toBe("childcare");
  });
  it("no signal for absence", () => {
    expect(childSignal(monthly("Albert Heijn", -50, 4), [], undefined)).toBeNull();
    expect(childSignal([], [], undefined)).toBeNull();
  });
  it("a single kinderbijslag payment is not a signal", () => {
    const rows = [
      mkTx("SVB", "2026-01-03", 250, { description: "kinderbijslag" }),
      mkTx("Shop", "2026-04-03", -5),
    ];
    expect(childSignal(rows, [], undefined)).toBeNull();
  });
  it("never returns a number of children", () => {
    const rows = monthly("SVB", 250, 4, "03", { description: "kinderbijslag" });
    const s = childSignal(rows, [], undefined);
    expect(Object.keys(s ?? {}).sort()).toEqual(["evidence", "kind"]);
  });
  it("under 60 days -> null", () => {
    const rows = [
      mkTx("SVB", "2026-01-03", 250, { description: "kinderbijslag" }),
      mkTx("SVB", "2026-02-03", 250, { description: "kinderbijslag" }),
    ];
    expect(childSignal(rows, [], undefined)).toBeNull();
  });
});
