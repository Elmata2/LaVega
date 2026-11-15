import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { Account, Tx } from "../model.js";
import type { Bill } from "./model.js";
import { billOccurrenceId } from "./model.js";
import { generateBillOccurrences } from "./occurrences.js";
import { applyBillAction, runBillMatcher } from "./allocate.js";
import { suggestBillMatches } from "./match.js";

/* WS2.4 acceptance, measured: on a real-shaped vault, >= 95% of CONFIRMED
 * payments land on the occurrence they were meant for.
 *
 * The vault is the labelled fixture `__fixtures__/real-shaped-vault.json`: a
 * Dutch household with 12 months of history, 9 series (one income, one yearly,
 * one installment paid in two parts), groceries/restaurants/transfers as noise,
 * a pending row, a price change that stays inside the amount band, one
 * overpayment, and an ambiguous same-amount twin. Every bill payment row carries
 * `groundTruth: { billId, originalDueOn }`, so the intended occurrence is known
 * by construction. It is shaped like the owner's real ING data (same bank
 * columns, NP-payee spellings, SEPA date jitter), not a copy of it: the real
 * vault is local-first and never enters the repo.
 *
 * How the number is measured:
 *  1. materialize 12 months of occurrences (the matcher half of the plan
 *     enables history backfill);
 *  2. run the matcher's exact tier over the whole vault;
 *  3. for every ground-truth row it did not auto-confirm, take the matcher's
 *     best remaining suggestion and treat it as the owner confirming it;
 *  4. count a confirmed row as LANDED when its occurrence id is
 *     `billOccurrenceId(billId, originalDueOn)` from the label.
 *
 * "Confirmed" is therefore exactly the set the plan names: auto links plus the
 * owner's confirmations. A row the matcher never proposed is a recall gap, not
 * a confirmed payment, and is reported separately. */

type Fixture = {
  asOf: string;
  accounts: Account[];
  bills: Bill[];
  txs: Array<Tx & { groundTruth?: { billId: string; originalDueOn: string } }>;
};

const fixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/real-shaped-vault.json", import.meta.url), "utf8"),
) as Fixture;

function measure(): {
  labeled: number;
  accepted: number;
  landed: number;
  autoAccepted: number;
  autoLanded: number;
  missed: string[];
  priceChanges: number;
} {
  const { asOf, accounts, bills, txs } = fixture;
  const occurrences = generateBillOccurrences(bills, [], asOf, { historyMonths: 13 }).occurrences;
  let state = runBillMatcher({ bills, occurrences, txs, accounts, asOf });

  const confirmed = new Map<string, { occurrenceId: string; source: "auto" | "user" }>();
  for (const match of state.decisions.matches) {
    confirmed.set(match.txId, { occurrenceId: match.occurrenceId, source: match.source });
  }

  const labeled = txs.filter((tx) => tx.groundTruth != null);
  const missed: string[] = [];
  for (const tx of labeled) {
    if (confirmed.has(tx.id)) continue;
    const suggestions = suggestBillMatches({
      bills: state.bills,
      occurrences: state.occurrences,
      txs,
      decisions: state.decisions,
      accounts,
      asOf,
    });
    const top = suggestions.find((candidate) => candidate.txId === tx.id);
    if (top == null) {
      missed.push(`${tx.id} ${tx.counterparty} ${tx.date}`);
      continue;
    }
    const outcome = applyBillAction({
      bills: state.bills,
      occurrences: state.occurrences,
      decisions: state.decisions,
      txs,
      accounts,
      asOf,
      action: { kind: "confirm-match", candidate: top, source: "user" },
    });
    state = {
      ...state,
      bills: outcome.bills,
      occurrences: outcome.occurrences,
      decisions: outcome.decisions,
    };
    confirmed.set(tx.id, { occurrenceId: top.occurrenceId, source: "user" });
  }

  let accepted = 0;
  let landed = 0;
  let autoAccepted = 0;
  let autoLanded = 0;
  for (const tx of labeled) {
    const truth = tx.groundTruth as { billId: string; originalDueOn: string };
    const decision = confirmed.get(tx.id);
    if (decision == null) continue;
    accepted += 1;
    const intended = billOccurrenceId(truth.billId, truth.originalDueOn);
    const correct = decision.occurrenceId === intended;
    if (correct) landed += 1;
    if (decision.source === "auto") {
      autoAccepted += 1;
      if (correct) autoLanded += 1;
    }
  }
  return {
    labeled: labeled.length,
    accepted,
    landed,
    autoAccepted,
    autoLanded,
    missed,
    priceChanges: state.decisions.priceChanges.length,
  };
}

describe("real-shaped vault: match quality", () => {
  const result = measure();

  test("at least 95% of confirmed payments land on the intended occurrence", () => {
    expect(result.accepted).toBeGreaterThan(0);
    const landRate = result.landed / result.accepted;
    // eslint-disable-next-line no-console
    console.log(
      `[#287] confirmed ${result.accepted}/${result.labeled} labeled payments (${(
        (result.accepted / result.labeled) *
        100
      ).toFixed(
        1,
      )}%); landed ${result.landed}/${result.accepted} = ${(landRate * 100).toFixed(1)}%; auto ${result.autoLanded}/${result.autoAccepted}`,
    );
    expect(landRate).toBeGreaterThanOrEqual(0.95);
  });

  test("every auto-confirmed payment also lands on the intended occurrence", () => {
    expect(result.autoAccepted).toBeGreaterThan(0);
    expect(result.autoLanded).toBe(result.autoAccepted);
  });
});
