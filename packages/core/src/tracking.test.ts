import { expect, test } from "vitest";
import { makeRewardsBalance, type RewardsBalance } from "./rewards.js";
import {
  DEFAULT_TRACKING_INTERVAL_DAYS,
  TRACKING_OVERDUE_AFTER_DAYS,
  applyRewardsReply,
  dueRewards,
  dueTrackers,
  parseBalanceReply,
  rewardsTracked,
  snoozeTracker,
  trackingQuestion,
  trackingStatus,
  type TrackedBalance,
} from "./tracking.js";

const amex = makeRewardsBalance({
  program: "American Express Membership Rewards",
  points: 240_000,
  updatedAt: "2026-01-10",
});
const flyingBlue = makeRewardsBalance({
  program: "Flying Blue (KLM/Air France)",
  points: 12_000,
  updatedAt: "2026-08-01",
});

const tracked = (over: Partial<TrackedBalance> = {}): TrackedBalance => ({
  id: "t1",
  source: "rewards",
  label: "American Express Membership Rewards",
  unit: "punten",
  updatedAt: "2026-01-10",
  ...over,
});

test("staleness ladder: fresh -> due at the interval -> overdue once far past it", () => {
  expect(DEFAULT_TRACKING_INTERVAL_DAYS).toBe(90);
  const t = tracked();
  expect(trackingStatus(t, "2026-04-09").state).toBe("fresh"); // day 89
  expect(trackingStatus(t, "2026-04-10").state).toBe("due"); // day 90 = the due date
  expect(trackingStatus(t, "2026-04-10").dueDate).toBe("2026-04-10");
  expect(trackingStatus(t, "2026-05-10").state).toBe("due"); // 30 days past = still just due
  expect(trackingStatus(t, "2026-05-11").state).toBe("overdue"); // 31 days past
  expect(TRACKING_OVERDUE_AFTER_DAYS).toBe(30);

  const s = trackingStatus(t, "2026-05-11");
  expect(s.daysOverdue).toBe(31);
  expect(s.ageDays).toBe(121);
  expect(s.updatedAt).toBe("2026-01-10");
  expect(trackingStatus(t, "2026-02-01").daysOverdue).toBe(0); // never negative
});

test("a per-programme interval overrides the default; a nonsensical one falls back to it", () => {
  expect(trackingStatus(tracked({ intervalDays: 30 }), "2026-02-08").state).toBe("fresh");
  expect(trackingStatus(tracked({ intervalDays: 30 }), "2026-02-09").state).toBe("due"); // 10 Jan + 30d

  expect(trackingStatus(tracked({ intervalDays: 0 }), "2026-04-09").state).toBe("fresh"); // 0 -> default 90
  expect(trackingStatus(tracked({ intervalDays: -5 }), "2026-04-09").state).toBe("fresh");
});

test("a snooze silences a due number until its date, and never invents freshness", () => {
  const t = tracked({ snoozedUntil: "2026-06-01" });
  expect(trackingStatus(t, "2026-05-31").state).toBe("snoozed");
  expect(trackingStatus(t, "2026-06-01").state).toBe("overdue"); // asks again ON the date
  expect(trackingStatus(t, "2026-02-01").state).toBe("fresh"); // a snooze on a fresh row changes nothing
  // The age is still reported honestly while snoozed — the number IS old.
  expect(trackingStatus(t, "2026-05-31").ageDays).toBe(141);
  expect(trackingStatus(t, "2026-05-31").snoozedUntil).toBe("2026-06-01");
});

test("the question names the programme, says 'alleen het getal', and never contains a balance", () => {
  const q = trackingQuestion({ label: "American Express Membership Rewards", unit: "punten" });
  expect(q).toBe(
    "Hoeveel punten staan er nu bij American Express Membership Rewards? Stuur alleen het getal.",
  );
  expect(q).not.toMatch(/\d/); // no number of any kind can leak into the ask
  expect(trackingQuestion({ label: "bunq cashback", unit: "€" })).toBe(
    "Wat is het huidige saldo van bunq cashback (€)? Stuur alleen het getal.",
  );
});

test("dueTrackers returns only what to ask now, most overdue first", () => {
  const list = [
    tracked({ id: "fresh", label: "Flying Blue", updatedAt: "2026-08-01" }),
    tracked({ id: "due", label: "Avios", updatedAt: "2026-05-01" }), // 92 days -> due
    tracked({ id: "old", label: "Amex", updatedAt: "2026-01-10" }), // 214 days -> overdue
    tracked({ id: "snoozed", label: "Hyatt", updatedAt: "2026-01-10", snoozedUntil: "2026-09-01" }),
  ];
  const due = dueTrackers(list, "2026-08-12");
  expect(due.map((d) => d.id)).toEqual(["old", "due"]);
  expect(due[0].state).toBe("overdue");
  expect(due[1].state).toBe("due");
});

test("rewards are the first source: the Punten balances map straight onto the detector", () => {
  const list = rewardsTracked([amex, flyingBlue]);
  expect(list[0]).toEqual({
    id: amex.id,
    source: "rewards",
    label: "American Express Membership Rewards",
    unit: "punten",
    updatedAt: "2026-01-10",
  });
  const due = dueRewards([amex, flyingBlue], "2026-08-12");
  expect(due.map((d) => d.label)).toEqual(["American Express Membership Rewards"]);
  expect(due[0].question).toContain("Stuur alleen het getal");
});

test("parseBalanceReply reads what a person actually types", () => {
  expect(parseBalanceReply("245000")).toBe(245_000);
  expect(parseBalanceReply("245.000")).toBe(245_000); // NL thousands
  expect(parseBalanceReply("245,000")).toBe(245_000); // EN thousands
  expect(parseBalanceReply("245 000")).toBe(245_000); // spaced thousands
  expect(parseBalanceReply("1 234 567")).toBe(1_234_567);
  expect(parseBalanceReply("1.234.567")).toBe(1_234_567);
  expect(parseBalanceReply("1.234,56")).toBe(1234.56); // NL decimal
  expect(parseBalanceReply("1,234.56")).toBe(1234.56); // EN decimal
  expect(parseBalanceReply("12,50")).toBe(12.5);
  expect(parseBalanceReply("245k")).toBe(245_000);
  expect(parseBalanceReply("1,2 mln")).toBe(1_200_000);
  expect(parseBalanceReply("1.2M")).toBe(1_200_000);
  expect(parseBalanceReply("ongeveer 245.000 punten")).toBe(245_000);
  expect(parseBalanceReply("€ 12,50")).toBe(12.5);
  expect(parseBalanceReply(" 0 ")).toBe(0);
  expect(parseBalanceReply("-40")).toBe(-40); // sign kept; the source decides
});

test("parseBalanceReply refuses to guess: no number, or more than one, is null", () => {
  expect(parseBalanceReply("geen idee")).toBeNull();
  expect(parseBalanceReply("")).toBeNull();
  expect(parseBalanceReply("weet ik niet, kijk ik morgen")).toBeNull();
  expect(parseBalanceReply("245.000 (was 240.000)")).toBeNull(); // two numbers = a sentence
  expect(parseBalanceReply("op 12-08 was het 245000")).toBeNull();
  expect(parseBalanceReply("245 mooi")).toBe(245); // "m" is only a multiplier when the word ends there
});

test("applying a reply is the whole low-trust loop: one number in, the row is fresh again", () => {
  const balances: RewardsBalance[] = [amex, flyingBlue];
  expect(dueRewards(balances, "2026-08-12")).toHaveLength(1);

  const next = applyRewardsReply(balances, amex.id, "252.500", "2026-08-12");
  expect(next).not.toBeNull();
  const updated = next!.find((b) => b.id === amex.id)!;
  expect(updated.points).toBe(252_500);
  expect(updated.updatedAt).toBe("2026-08-12");
  expect(next!.find((b) => b.id === flyingBlue.id)).toEqual(flyingBlue); // untouched
  expect(balances[0].points).toBe(240_000); // input never mutated
  expect(dueRewards(next!, "2026-08-12")).toEqual([]); // nothing left to ask
});

test("a reply that isn't a single sensible number changes NOTHING (the caller re-asks)", () => {
  const balances: RewardsBalance[] = [amex];
  expect(applyRewardsReply(balances, amex.id, "weet ik niet", "2026-08-12")).toBeNull();
  expect(applyRewardsReply(balances, amex.id, "245.000 of 250.000", "2026-08-12")).toBeNull();
  expect(applyRewardsReply(balances, amex.id, "-5", "2026-08-12")).toBeNull(); // points can't be negative
  expect(applyRewardsReply(balances, "onbekend-programma", "245000", "2026-08-12")).toBeNull();
});

test("answering clears a snooze; snoozing silences the ask without touching the number", () => {
  const snoozed = snoozeTracker([amex], amex.id, "2026-09-01");
  expect(snoozed[0].snoozedUntil).toBe("2026-09-01");
  expect(snoozed[0].points).toBe(240_000);
  expect(dueRewards(snoozed, "2026-08-12")).toEqual([]);
  expect(snoozeTracker([amex], "onbekend", "2026-09-01")).toEqual([amex]);

  const answered = applyRewardsReply(snoozed, amex.id, "250000", "2026-08-12")!;
  expect(answered[0].snoozedUntil).toBeUndefined();
  expect(answered[0].points).toBe(250_000);
});

test("a decimal reply is rounded — points are whole", () => {
  const next = applyRewardsReply([amex], amex.id, "245.000,6", "2026-08-12")!;
  expect(next[0].points).toBe(245_001);
});
