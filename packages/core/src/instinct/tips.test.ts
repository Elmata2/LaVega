import { describe, expect, it } from "vitest";
import { TIPS, TIP_COOLDOWN_DAYS, REPEAT_WINDOW_DAYS } from "./tips.js";
import { INSTINCT_COPY } from "./copy.js";

describe("TIPS", () => {
  it("has 5 to 8 tips", () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(5);
    expect(TIPS.length).toBeLessThanOrEqual(8);
  });
  it("each tip has id, review metadata and a source", () => {
    for (const t of TIPS) {
      expect(t.id).not.toBe("");
      expect(t.reviewedAt === null || /^\d{4}-\d{2}-\d{2}$/.test(t.reviewedAt)).toBe(true);
      expect(t.reviewedBy === null || t.reviewedBy !== "").toBe(true);
      expect(t.source).not.toBe("");
    }
  });
  it("no tip claims a review before the owner has done one", () => {
    for (const t of TIPS) {
      expect(t.reviewedAt).toBeNull();
      expect(t.reviewedBy).toBeNull();
    }
  });
  it("ids are unique", () => {
    expect(new Set(TIPS.map((t) => t.id)).size).toBe(TIPS.length);
  });
  it("every tip has NL and EN text", () => {
    for (const loc of ["nl", "en"] as const)
      for (const t of TIPS) {
        const x = INSTINCT_COPY[loc].tips[t.id];
        expect(x.title && x.short && x.long).toBeTruthy();
      }
  });
  it("constants", () => {
    expect(TIP_COOLDOWN_DAYS).toBe(3);
    expect(REPEAT_WINDOW_DAYS).toBe(30);
  });
});
