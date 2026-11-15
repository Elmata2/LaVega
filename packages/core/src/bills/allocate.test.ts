import { describe, expect, test } from "vitest";
import type { Bill, BillDecisions, BillOccurrence, BillMatchDecision } from "./model.js";
import type { Tx } from "../model.js";
import { billOccurrenceId } from "./model.js";
import { makeBillOccurrence } from "./occurrences.js";
import type { BillMatchCandidate } from "./match.js";
import { suggestBillMatches } from "./match.js";
import {
  BILL_CENT_EPSILON,
  applyBillAction,
  billCloseRule,
  billSettlement,
  reconcileBillDecisions,
  runBillMatcher,
} from "./allocate.js";

/* WS2.5 acceptance: partial payments, cent epsilon, price changes, learned
 * tolerance, aliases, mark-paid without a transaction, user close that never
 * auto-reopens, and the repair pass for a replaced entry. */

const AS_OF = "2026-11-11";

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
    anchorDate: "2026-01-01",
    weekendAdjust: "none",
    endMode: "never",
    tags: [],
    accountKey: "betaal",
    ...overrides,
  };
}

function occurrence(
  series: Bill,
  dueOn: string,
  overrides: Partial<BillOccurrence> = {},
): BillOccurrence {
  return { ...makeBillOccurrence(series, { originalDueOn: dueOn, dueOn }), ...overrides };
}

function tx(overrides: Partial<Tx> & { id: string }): Tx {
  return {
    accountKey: "betaal",
    date: "2026-11-01",
    amount: -1000,
    currency: "EUR",
    counterparty: "Woonstad Verhuur",
    description: "Huur",
    category: "",
    manual: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<BillMatchCandidate> = {}): BillMatchCandidate {
  return {
    occurrenceId: billOccurrenceId("huur", "2026-11-01"),
    billId: "huur",
    txId: "t1",
    amountCents: 100_000,
    currency: "EUR",
    txDate: "2026-11-01",
    txName: "Woonstad Verhuur",
    confidence: 0.9,
    tier: "suggest",
    ambiguous: false,
    evidence: {
      matchedOn: "name",
      amountDeltaCents: 0,
      dateDiffDays: 0,
      pending: false,
      partyWeight: 0.35,
      amountWeight: 0.3,
    },
    ...overrides,
  };
}

const decisionsWith = (overrides: Partial<BillDecisions>): BillDecisions => ({
  matches: [],
  marks: [],
  rejections: [],
  priceChanges: [],
  ...overrides,
});

const match = (overrides: Partial<BillMatchDecision> = {}): BillMatchDecision => ({
  id: "m1",
  occurrenceId: billOccurrenceId("huur", "2026-11-01"),
  billId: "huur",
  txId: "t1",
  amountCents: 50_000,
  currency: "EUR",
  source: "user",
  confidence: 1,
  decidedAt: AS_OF,
  ...overrides,
});

describe("partial payments", () => {
  test("a payment below the band leaves the occurrence open with a remainder", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const outcome = applyBillAction({
      bills: [series],
      occurrences: [row],
      txs: [tx({ id: "t1", amount: -400 })],
      asOf: AS_OF,
      action: { kind: "confirm-match", candidate: candidate({ amountCents: 40_000 }) },
    });
    expect(outcome.changed).toBe(true);
    const settlement = billSettlement(series, row, [row], outcome.decisions);
    expect(settlement.state).toBe("partial");
    expect(settlement.allocatedCents).toBe(40_000);
    expect(settlement.remainingCents).toBe(60_000);
    expect(outcome.occurrences[0].status).toBe("scheduled");
    expect(outcome.priceChange).toBeNull();
  });

  test("a second payment finishes the same occurrence", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const first = applyBillAction({
      bills: [series],
      occurrences: [row],
      txs: [tx({ id: "t1", amount: -400 })],
      asOf: AS_OF,
      action: { kind: "confirm-match", candidate: candidate({ amountCents: 40_000 }) },
    });
    const second = applyBillAction({
      bills: first.bills,
      occurrences: first.occurrences,
      decisions: first.decisions,
      txs: [tx({ id: "t1", amount: -400 }), tx({ id: "t2", amount: -610 })],
      asOf: AS_OF,
      action: {
        kind: "confirm-match",
        candidate: candidate({ occurrenceId: row.id, txId: "t2", amountCents: 61_000 }),
      },
    });
    expect(second.occurrences[0].status).toBe("paid");
    expect(second.occurrences[0].paidAmountCents).toBe(101_000);
    expect(second.priceChange).toBeNull(); // two payments are not one new price
  });
});

describe("close rules", () => {
  test("the cent epsilon settles a sum one cent short", () => {
    const short = billCloseRule(
      100_000,
      [match({ amountCents: 50_000 }), match({ id: "m2", txId: "t2", amountCents: 49_999 })],
      7_500,
    );
    expect(short.close).toBe(true);
    expect(short.paidAmountCents).toBe(99_999);
    expect(BILL_CENT_EPSILON).toBe(1);
  });

  test("two cents short stays partial", () => {
    const short = billCloseRule(
      100_000,
      [match({ amountCents: 50_000 }), match({ id: "m2", txId: "t2", amountCents: 49_998 })],
      7_500,
    );
    expect(short.close).toBe(false);
  });

  test("an overpayment settles the occurrence for its full amount", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const outcome = applyBillAction({
      bills: [series],
      occurrences: [row],
      txs: [tx({ id: "t1", amount: -1200 })],
      asOf: AS_OF,
      action: { kind: "confirm-match", candidate: candidate({ amountCents: 120_000 }) },
    });
    expect(outcome.occurrences[0].status).toBe("paid");
    expect(outcome.occurrences[0].paidAmountCents).toBe(120_000);
  });
});

describe("price changes", () => {
  test("a settled different amount records the change and moves the series price", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const outcome = applyBillAction({
      bills: [series],
      occurrences: [row],
      txs: [tx({ id: "t1", amount: -1200 })],
      asOf: AS_OF,
      action: { kind: "confirm-match", candidate: candidate({ amountCents: 120_000 }) },
    });
    expect(outcome.priceChange).not.toBeNull();
    expect(outcome.priceChange?.oldAmountCents).toBe(100_000);
    expect(outcome.priceChange?.newAmountCents).toBe(120_000);
    expect(outcome.bills[0].amountCents).toBe(120_000);
    // Future open occurrences inherit the new price through the strategy.
    const next = occurrence(series, "2026-12-01");
    const settlement = billSettlement(outcome.bills[0], next, [next], outcome.decisions);
    expect(settlement.expectedCents).toBe(120_000);
  });

  test("an average/last strategy keeps its own amount; history still records the change", () => {
    const series = bill({ amountStrategy: "last" });
    const row = occurrence(series, "2026-11-01");
    const outcome = applyBillAction({
      bills: [series],
      occurrences: [row],
      txs: [tx({ id: "t1", amount: -1200 })],
      asOf: AS_OF,
      action: { kind: "confirm-match", candidate: candidate({ amountCents: 120_000 }) },
    });
    expect(outcome.priceChange?.newAmountCents).toBe(120_000);
    expect(outcome.bills[0].amountCents).toBe(100_000);
  });
});

describe("learning and aliases", () => {
  test("a manual match outside the band widens the tolerance (max 25%)", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const outcome = applyBillAction({
      bills: [series],
      occurrences: [row],
      txs: [tx({ id: "t1", amount: -1100 })],
      asOf: AS_OF,
      action: { kind: "confirm-match", candidate: candidate({ amountCents: 110_000 }) },
    });
    expect(outcome.bills[0].learnedTolerancePct).toBe(10);
    // A larger outlier is capped at Sure's 25.
    const capped = applyBillAction({
      bills: [series],
      occurrences: [row],
      txs: [tx({ id: "t1", amount: -1300 })],
      asOf: AS_OF,
      action: { kind: "confirm-match", candidate: candidate({ amountCents: 130_000 }) },
    });
    expect(capped.bills[0].learnedTolerancePct).toBe(25);
  });

  test("a manual match teaches the counterparty spelling as an alias", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const outcome = applyBillAction({
      bills: [series],
      occurrences: [row],
      txs: [tx({ id: "t1", counterparty: "Woonstad Verhuur B.V." })],
      asOf: AS_OF,
      action: { kind: "confirm-match", candidate: candidate({}) },
    });
    expect(outcome.bills[0].aliases).toEqual(["Woonstad Verhuur B.V."]);
  });
});

describe("mark paid without a transaction", () => {
  test("a mark closes the occurrence, keeps a decision, and is never reopened", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-15");
    const marked = applyBillAction({
      bills: [series],
      occurrences: [row],
      asOf: AS_OF,
      action: { kind: "mark-paid", occurrenceId: row.id },
    });
    expect(marked.occurrences[0].status).toBe("paid");
    expect(marked.occurrences[0].closedSource).toBe("user");
    expect(marked.occurrences[0].paidAmountCents).toBe(100_000);
    expect(marked.decisions.marks).toHaveLength(1);

    // A matching transaction afterwards does not touch a user close, and the
    // repair pass leaves it alone.
    const later = runBillMatcher({
      bills: marked.bills,
      occurrences: marked.occurrences,
      decisions: marked.decisions,
      txs: [tx({ id: "t1", date: "2026-11-15" })],
      asOf: AS_OF,
    });
    expect(later.occurrences[0].status).toBe("paid");
    expect(later.decisions.matches).toEqual([]);

    const repaired = reconcileBillDecisions({
      bills: marked.bills,
      occurrences: marked.occurrences,
      decisions: marked.decisions,
      txs: [],
    });
    expect(repaired.occurrences[0].status).toBe("paid");
    expect(repaired.reopened).toEqual([]);
  });
});

describe("repair of replaced entries", () => {
  test("a row closed before decisions existed is not reopened", () => {
    const series = bill();
    const row: BillOccurrence = {
      ...occurrence(series, "2026-10-01"),
      status: "paid",
      paidOn: "2026-10-01",
      paidAmountCents: 100_000,
      closedAt: AS_OF,
      closedSource: "auto",
    };
    const repaired = reconcileBillDecisions({
      bills: [series],
      occurrences: [row],
      decisions: decisionsWith({}),
      txs: [],
    });
    expect(repaired.reopened).toEqual([]);
    expect(repaired.occurrences[0].status).toBe("paid");
    expect(repaired.changed).toBe(false);
  });

  test("an auto-closed row whose transaction disappeared is reopened", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const paid: BillOccurrence = {
      ...row,
      status: "paid",
      paidOn: "2026-11-01",
      paidAmountCents: 100_000,
      closedAt: AS_OF,
      closedSource: "auto",
    };
    const decisions = decisionsWith({ matches: [match({ amountCents: 100_000 })] });
    const repaired = reconcileBillDecisions({
      bills: [series],
      occurrences: [paid],
      decisions,
      txs: [],
    });
    expect(repaired.reopened).toHaveLength(1);
    expect(repaired.occurrences[0].status).toBe("scheduled");
    expect(repaired.occurrences[0].paidAmountCents).toBeUndefined();
    expect(repaired.decisions.matches).toEqual([]);
    expect(repaired.changed).toBe(true);
  });
});

describe("rejection memory and the matcher pass", () => {
  test("rejecting a candidate records the series/transaction pair", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const outcome = applyBillAction({
      bills: [series],
      occurrences: [row],
      asOf: AS_OF,
      action: { kind: "reject-match", candidate: candidate({ tier: "suggest" }) },
    });
    expect(outcome.decisions.rejections).toHaveLength(1);
    expect(outcome.occurrences[0].status).toBe("scheduled");
    expect(
      suggestBillMatches({
        bills: [series],
        occurrences: [row],
        txs: [tx({ id: "t1" })],
        decisions: outcome.decisions,
        asOf: AS_OF,
      }),
    ).toEqual([]);
  });

  test("the exact tier writes itself once and the second pass is a no-op", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const first = runBillMatcher({
      bills: [series],
      occurrences: [row],
      txs: [tx({ id: "t1" })],
      asOf: AS_OF,
    });
    expect(first.added).toHaveLength(1);
    expect(first.occurrences[0].status).toBe("paid");
    expect(first.occurrences[0].closedSource).toBe("auto");
    const second = runBillMatcher({
      bills: first.bills,
      occurrences: first.occurrences,
      decisions: first.decisions,
      txs: [tx({ id: "t1" })],
      asOf: AS_OF,
    });
    expect(second.added).toEqual([]);
    expect(second.changed).toBe(false);
    expect(second.decisions.matches).toHaveLength(1);
  });

  test("the exact tier does not write an ambiguous or pending match", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-15");
    const twin = [
      tx({ id: "twin-a", date: "2026-11-15" }),
      tx({ id: "twin-b", date: "2026-11-15" }),
    ];
    const ambiguous = runBillMatcher({
      bills: [series],
      occurrences: [row],
      txs: twin,
      asOf: AS_OF,
    });
    expect(ambiguous.added).toEqual([]);
    expect(ambiguous.occurrences[0].status).toBe("scheduled");

    const pending = runBillMatcher({
      bills: [series],
      occurrences: [row],
      txs: [tx({ id: "t1", date: "2026-11-15", pending: true })],
      asOf: AS_OF,
    });
    expect(pending.added).toEqual([]);
  });
});
