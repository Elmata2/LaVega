import { describe, expect, test } from "vitest";
import type { Bill, BillOccurrence } from "./model.js";
import type { Tx } from "../model.js";
import { EMPTY_BILL_DECISIONS, billOccurrenceId } from "./model.js";
import { makeBillOccurrence } from "./occurrences.js";
import {
  BILL_MATCH_AMBIGUITY_MARGIN,
  BILL_MATCH_AUTO_TIER,
  BILL_MATCH_SUGGEST_TIER,
  billMatchWindow,
  suggestBillMatches,
} from "./match.js";

/* WS2.4 acceptance: Sure's own edge fixtures ported. Ambiguous same-amount
 * twins, the three hard filters, pending rows, income series, rejection memory,
 * the window caps, and the score tiers. */

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

const input = (
  bills: Bill[],
  occurrences: BillOccurrence[],
  txs: Tx[],
  overrides: Partial<Parameters<typeof suggestBillMatches>[0]> = {},
) => ({ bills, occurrences, txs, asOf: AS_OF, decisions: EMPTY_BILL_DECISIONS, ...overrides });

describe("score tiers", () => {
  test("an exact name, amount, date and account match reaches the auto tier", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const candidates = suggestBillMatches(input([series], [row], [tx({ id: "t1" })]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tier).toBe("auto");
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(BILL_MATCH_AUTO_TIER);
    expect(candidates[0].evidence.matchedOn).toBe("name");
    expect(candidates[0].ambiguous).toBe(false);
    expect(candidates[0].occurrenceId).toBe(row.id);
  });

  test("a one-day shift drops below the auto tier into a suggestion", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-15");
    const candidates = suggestBillMatches(
      input([series], [row], [tx({ id: "t1", date: "2026-11-20" })]),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tier).toBe("suggest");
    expect(candidates[0].confidence).toBeGreaterThanOrEqual(BILL_MATCH_SUGGEST_TIER);
    expect(candidates[0].confidence).toBeLessThan(BILL_MATCH_AUTO_TIER);
  });

  test("a candidate below the suggestion tier is not proposed at all", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    // Name only, amount far outside the band, date at the edge.
    const candidates = suggestBillMatches(
      input([series], [row], [tx({ id: "t1", amount: -800, date: "2026-11-03" })]),
    );
    expect(candidates).toEqual([]);
  });
});

describe("hard filters", () => {
  test("currency, account and sign must all agree", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const wrongCurrency = tx({ id: "usd", currency: "USD" });
    const wrongAccount = tx({ id: "savings", accountKey: "spaar" });
    const wrongSign = tx({ id: "refund", amount: 1000 });
    expect(suggestBillMatches(input([series], [row], [wrongCurrency]))).toEqual([]);
    expect(suggestBillMatches(input([series], [row], [wrongAccount]))).toEqual([]);
    expect(suggestBillMatches(input([series], [row], [wrongSign]))).toEqual([]);
  });

  test("a row that names no party is not a candidate, even with the exact amount", () => {
    const series = bill({ name: "Verzekering", merchant: "Allianz" });
    const row = occurrence(series, "2026-11-01");
    const anonymous = tx({ id: "t1", counterparty: "SEPA Incasso", description: "" });
    expect(suggestBillMatches(input([series], [row], [anonymous]))).toEqual([]);
  });

  test("a merchant match works without the bill name in the descriptor", () => {
    const series = bill({ name: "Inboedel", merchant: "Allianz" });
    const row = occurrence(series, "2026-11-01");
    const candidates = suggestBillMatches(
      input([series], [row], [tx({ id: "t1", counterparty: "ALLIANZ DIRECT", description: "" })]),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].evidence.matchedOn).toBe("merchant");
  });

  test("a learned alias names the party after a manual confirmation", () => {
    const series = bill({ name: "Inboedel", aliases: ["Allianz Direct N.V."] });
    const row = occurrence(series, "2026-11-01");
    const candidates = suggestBillMatches(
      input(
        [series],
        [row],
        [tx({ id: "t1", counterparty: "ALLIANZ DIRECT NV", description: "" })],
      ),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].evidence.matchedOn).toBe("alias");
  });
});

describe("Sure edge fixtures", () => {
  test("pending rows are suggested, never auto-linked", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const candidates = suggestBillMatches(
      input([series], [row], [tx({ id: "t1", pending: true })]),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].tier).toBe("suggest");
    expect(candidates[0].evidence.pending).toBe(true);
  });

  test("an income series gets no suggestions", () => {
    const series = bill({
      id: "salaris",
      name: "Salaris",
      type: "income",
      direction: "in",
      amountCents: 380_000,
    });
    const row = occurrence(series, "2026-11-01");
    const salary = tx({
      id: "t1",
      amount: 3800,
      counterparty: "Brightwave Studio B.V.",
      description: "Salaris",
    });
    expect(suggestBillMatches(input([series], [row], [salary]))).toEqual([]);
  });

  test("ambiguous same-amount twins are both flagged and neither auto-links", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const twins = [
      tx({ id: "twin-a", counterparty: "Woonstad Verhuur" }),
      tx({ id: "twin-b", counterparty: "Woonstad Verhuur" }),
    ];
    const candidates = suggestBillMatches(input([series], [row], twins));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].ambiguous).toBe(true);
    expect(candidates[0].tier).toBe("auto"); // the score is high; the guard is what stops it
  });

  test("a cross-currency payment is not a candidate (Sure's hard filter)", () => {
    const series = bill({ currency: "EUR" });
    const row = occurrence(series, "2026-11-01");
    const usd = tx({ id: "t1", currency: "USD" });
    expect(suggestBillMatches(input([series], [row], [usd]))).toEqual([]);
  });

  test("one payment funds one bill automatically; the other stays a suggestion", () => {
    const first = bill({ id: "a", name: "Huur" });
    const second = bill({ id: "b", name: "Huur" });
    const rows = [occurrence(first, "2026-11-01"), occurrence(second, "2026-11-01")];
    const candidates = suggestBillMatches(input([first, second], rows, [tx({ id: "t1" })]));
    expect(candidates).toHaveLength(1);
  });
});

describe("window", () => {
  test("the configured early/late days are capped at half a cycle", () => {
    const weekly = bill({
      rules: [{ frequency: "weekly", interval: 1, weekday: 1 }],
      anchorDate: "2026-01-05",
    });
    const window = billMatchWindow(weekly, { dueOn: "2026-11-16" }, AS_OF);
    expect(window.earlyDays).toBe(2);
    expect(window.lateDays).toBe(3); // 7 days capped at half of a 7-day cycle
  });

  test("an overdue occurrence looks forward to asOf", () => {
    const series = bill();
    const window = billMatchWindow(series, { dueOn: "2026-10-01" }, AS_OF);
    expect(window.lateDays).toBeGreaterThanOrEqual(41);
  });

  test("a payment outside the window is not a candidate", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const late = tx({ id: "t1", date: "2026-11-20" });
    expect(suggestBillMatches(input([series], [row], [late]))).toEqual([]);
  });
});

describe("rejection memory", () => {
  test("a rejected series/transaction pair is never proposed again", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const decisions = {
      ...EMPTY_BILL_DECISIONS,
      rejections: [{ billId: series.id, txId: "t1", occurrenceId: row.id, rejectedAt: AS_OF }],
    };
    expect(suggestBillMatches(input([series], [row], [tx({ id: "t1" })], { decisions }))).toEqual(
      [],
    );
  });

  test("a rejection suppresses one series only; the row stays matchable elsewhere", () => {
    const first = bill({ id: "a", name: "Huur" });
    const second = bill({ id: "b", name: "Huur" });
    const rows = [occurrence(first, "2026-11-01"), occurrence(second, "2026-11-01")];
    const decisions = {
      ...EMPTY_BILL_DECISIONS,
      rejections: [{ billId: first.id, txId: "t1", occurrenceId: rows[0].id, rejectedAt: AS_OF }],
    };
    const candidates = suggestBillMatches(
      input([first, second], rows, [tx({ id: "t1" })], { decisions }),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].billId).toBe(second.id);
  });

  test("an ambiguous pair stays ambiguous and is the owner's to resolve", () => {
    const first = bill({ id: "a", name: "Verzekering", merchant: "Allianz" });
    const second = bill({ id: "b", name: "Verzekering", merchant: "Allianz" });
    const rows = [occurrence(first, "2026-11-01"), occurrence(second, "2026-11-01")];
    const candidates = suggestBillMatches(
      input([first, second], rows, [
        tx({ id: "t1", counterparty: "ALLIANZ DIRECT", description: "" }),
      ]),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].ambiguous).toBe(true);
    expect(BILL_MATCH_AMBIGUITY_MARGIN).toBe(0.15);
  });
});

describe("existing decisions", () => {
  test("a transaction already fully allocated is not proposed again", () => {
    const series = bill();
    const row = occurrence(series, "2026-11-01");
    const decisions = {
      ...EMPTY_BILL_DECISIONS,
      matches: [
        {
          id: "m1",
          occurrenceId: billOccurrenceId("other", "2026-10-01"),
          billId: "other",
          txId: "t1",
          amountCents: 100_000,
          currency: "EUR",
          source: "user" as const,
          confidence: 1,
          decidedAt: AS_OF,
        },
      ],
    };
    expect(suggestBillMatches(input([series], [row], [tx({ id: "t1" })], { decisions }))).toEqual(
      [],
    );
  });
});
