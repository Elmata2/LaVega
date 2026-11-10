import { describe, expect, test } from "vitest";
import type { RoomResult } from "./room.js";
import { capacityForParts, resolveRoomRanges } from "./resolve.js";

const computed: RoomResult = {
  kind: "computed",
  months: [],
  middleCents: 50_000,
  middleIncomeCents: 300_000,
  lowCents: 30_000,
  highCents: 60_000,
  partial: false,
  excludedForeignCount: 0,
  blockingAccounts: [],
};
const none: RoomResult = { kind: "none", reason: "no-data" };
const income = { lowCents: 250_000, highCents: 300_000 };
const spend = { lowCents: 200_000, highCents: 220_000 };

describe("resolveRoomRanges", () => {
  test("a computed room wins over stated ranges", () => {
    expect(resolveRoomRanges(computed, income, spend)).toEqual({ room: computed });
  });
  test("no computed room and both ranges: the stated room (low = income low - spend high)", () => {
    const r = resolveRoomRanges(none, income, spend);
    expect(r.room).toEqual({ kind: "stated", lowCents: 30_000, highCents: 100_000, incomeMidCents: 275_000 });
    expect(r.statedInputs).toEqual({ income, spend });
  });
  test("a computed room with under 60 days of history and both ranges: the stated room (one rule for every caller)", () => {
    const r = resolveRoomRanges({ ...computed, coverageDays: 40 }, income, spend);
    expect(r.room).toMatchObject({ kind: "stated", lowCents: 30_000 });
    expect(r.statedInputs).toEqual({ income, spend });
  });
  test("short history without both ranges, or 60 days or more, keeps the computed room", () => {
    const short = { ...computed, coverageDays: 40 };
    expect(resolveRoomRanges(short, income, null)).toEqual({ room: short });
    const enough = { ...computed, coverageDays: 60 };
    expect(resolveRoomRanges(enough, income, spend)).toEqual({ room: enough });
  });
  test("one range missing: the computed result comes back untouched", () => {
    expect(resolveRoomRanges(none, income, null)).toEqual({ room: none });
    expect(resolveRoomRanges(none, null, spend)).toEqual({ room: none });
    expect(resolveRoomRanges(none, undefined, undefined)).toEqual({ room: none });
  });
});

describe("capacityForParts", () => {
  const parts = {
    fixedCostsMonthlyCents: 100_000,
    debtMonthlyCents: [] as number[],
    goals: [] as { targetDate: string }[],
  };
  test("no savings figure leaves the buffer part out; a stated zero is scored", () => {
    const missing = capacityForParts({ ...parts, savingsCents: null }, computed, "2026-10-24");
    expect(missing.parts.buffer).toBeNull();
    expect(missing.missing).toContain("buffer");
    const zero = capacityForParts({ ...parts, savingsCents: 0 }, computed, "2026-10-24");
    expect(zero.parts.buffer).toBe(0);
    expect(zero.missing).not.toContain("buffer");
  });
});
