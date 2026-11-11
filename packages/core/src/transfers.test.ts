import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import type { EntityProfile } from "./entities.js";
import { assignTxIds } from "./hash.js";
import { mergeAccounts } from "./accounts.js";
import { categoryComparison, categoryTotals } from "./views.js";
import { crossScopeTransfers } from "./crossScope.js";
import {
  TRANSFER_CATEGORY,
  applyTransferDecisions,
  autoConfirmTransfers,
  confirmTransfer,
  confirmedTransferTxIds,
  deriveTransferKind,
  isInvestmentAccount,
  isInvestmentContribution,
  reconcileTransfers,
  rejectTransfer,
  suggestTransfers,
  summarizeConfirmedTransfers,
  transferPairId,
  type TransferMatchInput,
  type TransferPair,
} from "./transfers.js";

/* Sure's transfer matcher, ported. Every test here pins one of the ways a pair
 * can be wrong: a same-amount coincidence taken as proof, a real move missed by
 * the window, an FX guess invented from a missing rate, or a confirmed pair
 * silently orphaned by an account merge. */

const ASOF = "2026-03-31";

let sequence = 0;
function tx(accountKey: string, date: string, amount: number, over: Partial<Tx> = {}): Tx {
  sequence += 1;
  return {
    id: `tx-${sequence}`,
    accountKey,
    date,
    amount,
    currency: "EUR",
    counterparty: "",
    description: "",
    category: "",
    manual: false,
    ...over,
  };
}

function acc(key: string, over: Partial<Account> = {}): Account {
  return {
    key,
    iban: "",
    name: key,
    bank: "ING",
    entity: "Privé",
    currency: "EUR",
    balance: null,
    ...over,
  };
}

const A = acc("a");
const B = acc("b");
const C = acc("c");

const pair = (
  outflowTxId: string,
  inflowTxId: string,
  over: Partial<TransferPair> = {},
): TransferPair => ({
  id: transferPairId(outflowTxId, inflowTxId),
  outflowTxId,
  inflowTxId,
  status: "suggested",
  kind: "funds_movement",
  amountCents: 10_000,
  currency: "EUR",
  createdAt: ASOF,
  ...over,
});

const match = (txs: Tx[], over: Partial<TransferMatchInput> = {}) =>
  suggestTransfers({ txs, accounts: [A, B, C], asOf: ASOF, ...over });
const auto = (txs: Tx[], over: Partial<TransferMatchInput> = {}) =>
  autoConfirmTransfers({ txs, accounts: [A, B, C], asOf: ASOF, ...over });

/** `date` shifted by whole days, so a window edge is stated as a number. */
function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

// --- identity ---------------------------------------------------------------

test("transferPairId is order-insensitive and separates different legs", () => {
  expect(transferPairId("x1", "y1")).toBe(transferPairId("y1", "x1"));
  expect(transferPairId("x1", "y1")).not.toBe(transferPairId("x1", "y2"));
});

// --- exact matching ---------------------------------------------------------

test("an equal amount leaving one own account and entering another is one exact pair", () => {
  const out = tx("a", "2026-03-10", -100, { id: "o1" });
  const inflow = tx("b", "2026-03-10", 100, { id: "i1" });

  const candidates = match([out, inflow]);

  expect(candidates).toHaveLength(1);
  const { pair: found, ambiguous } = candidates[0];
  expect(ambiguous).toBe(false);
  expect(found).toMatchObject({
    id: transferPairId("o1", "i1"),
    outflowTxId: "o1",
    inflowTxId: "i1",
    status: "suggested",
    kind: "funds_movement",
    amountCents: 10_000,
    currency: "EUR",
    createdAt: ASOF,
  });
  expect(found.decidedAt).toBeUndefined();
  expect(found.evidence).toEqual({
    rank: "exact",
    dateDiffDays: 0,
    amountDeltaCents: 0,
    crossRate: null,
  });
});

test("same-currency matching is cent-exact on both signs", () => {
  const exact = match([
    tx("a", "2026-03-10", -100.01, { id: "o1" }),
    tx("b", "2026-03-10", 100.01, { id: "i1" }),
  ]);
  expect(exact).toHaveLength(1);

  const offByACent = match([
    tx("a", "2026-03-10", -100.01, { id: "o1" }),
    tx("b", "2026-03-10", 100.02, { id: "i1" }),
  ]);
  expect(offByACent).toEqual([]);
});

test("the four-day window is inclusive on both sides and applies backwards too", () => {
  const at = (days: number) =>
    match([
      tx("a", "2026-03-10", -100, { id: "o1" }),
      tx("b", shift("2026-03-10", days), 100, { id: "i1" }),
    ]).length;

  expect(at(0)).toBe(1);
  expect(at(4)).toBe(1); // later inflow: same-day/next-day SEPA plus card lag
  expect(at(5)).toBe(0);
  expect(at(-4)).toBe(1); // both banks date the two sides differently
  expect(at(-5)).toBe(0);

  // A caller may widen the window (Sure's confirmed/manual path allows more).
  const wide = match(
    [tx("a", "2026-03-10", -100, { id: "o1" }), tx("b", "2026-03-18", 100, { id: "i1" })],
    { windowDays: 10 },
  );
  expect(wide).toHaveLength(1);
  expect(wide[0].pair.evidence?.dateDiffDays).toBe(8);
});

test("a transfer needs two DIFFERENT accounts, so a same-account wash never pairs", () => {
  expect(
    match([tx("a", "2026-03-10", -100, { id: "o1" }), tx("a", "2026-03-10", 100, { id: "i1" })]),
  ).toEqual([]);
  // Two rows with the same sign are never a pair either.
  expect(
    match([tx("a", "2026-03-10", 100, { id: "i1" }), tx("b", "2026-03-10", 100, { id: "i2" })]),
  ).toEqual([]);
});

test("the same tx id can never be both legs of one pair", () => {
  expect(
    match([tx("a", "2026-03-10", -100, { id: "dup" }), tx("b", "2026-03-10", 100, { id: "dup" })]),
  ).toEqual([]);
});

test("matching needs two account KEYS, not the account rows; a torn vault still pairs", () => {
  // The accountKey is the identity; only the KIND needs the account row. Losing
  // the row must not lose the money, so the pair falls back to a funds movement.
  const candidates = match([
    tx("a", "2026-03-10", -100, { id: "o1" }),
    tx("ghost", "2026-03-10", 100, { id: "i1" }),
  ]);
  expect(candidates).toHaveLength(1);
  expect(candidates[0].pair.kind).toBe("funds_movement");
});

test("a blank currency reads as EUR, not as a third currency", () => {
  expect(
    match([
      tx("a", "2026-03-10", -100, { id: "o1", currency: "" }),
      tx("b", "2026-03-10", 100, { id: "i1", currency: "eur" }),
    ]),
  ).toHaveLength(1);
});

// --- decisions and rejection memory ----------------------------------------

test("legs already carried by a stored decision are never proposed again", () => {
  const txs = [tx("a", "2026-03-10", -100, { id: "o1" }), tx("b", "2026-03-10", 100, { id: "i1" })];
  expect(match(txs, { pairs: [confirmTransfer(pair("o1", "i1"), ASOF)] })).toEqual([]);
  expect(match(txs, { pairs: [rejectTransfer(pair("o1", "i1"), ASOF)] })).toEqual([]);
});

test("rejection memory suppresses exactly that pair, not the rows it names", () => {
  const txs = [
    tx("a", "2026-03-10", -100, { id: "o1" }),
    tx("b", "2026-03-10", 100, { id: "i1" }),
    tx("c", "2026-03-11", 100, { id: "i2" }),
  ];
  // Two equal inflows compete, so the owner must decide: a suggestion only.
  expect(match(txs)[0].ambiguous).toBe(true);

  // Sure stores a rejection per PAIR (`rejected_transfers` is joined on both
  // legs), so the rejected pairing disappears and the outflow is free for the
  // other candidate — now unambiguously, and still a suggestion.
  const after = match(txs, { pairs: [rejectTransfer(pair("o1", "i1"), ASOF)] });
  expect(after).toHaveLength(1);
  expect(after[0].pair.inflowTxId).toBe("i2");
  expect(after[0].ambiguous).toBe(false);
  expect(auto(txs, { pairs: [rejectTransfer(pair("o1", "i1"), ASOF)] }).added).toHaveLength(1);
});

// --- ambiguity and greedy consumption --------------------------------------

test("two candidate inflows make the pair ambiguous, and ambiguity is never auto-confirmed", () => {
  const txs = [
    tx("a", "2026-03-10", -100, { id: "o1" }),
    tx("b", "2026-03-10", 100, { id: "i1" }),
    tx("c", "2026-03-11", 100, { id: "i2" }),
  ];
  const candidates = match(txs);
  expect(candidates).toHaveLength(1); // one suggestion per leg, greedy
  expect(candidates[0].ambiguous).toBe(true);
  expect(auto(txs).added).toEqual([]);
});

test("the greedy consume uses every leg at most once", () => {
  const txs = [
    tx("a", "2026-03-10", -100, { id: "o1" }),
    tx("a", "2026-03-11", -100, { id: "o2" }),
    tx("b", "2026-03-10", 100, { id: "i1" }),
    tx("c", "2026-03-11", 100, { id: "i2" }),
  ];
  const candidates = match(txs);
  expect(candidates).toHaveLength(2);
  const usedLegs = candidates.flatMap((c) => [c.pair.outflowTxId, c.pair.inflowTxId]);
  expect(new Set(usedLegs).size).toBe(4);
  expect(new Set(candidates.map((c) => c.pair.inflowTxId))).toEqual(new Set(["i1", "i2"]));
  expect(new Set(candidates.map((c) => c.pair.outflowTxId))).toEqual(new Set(["o1", "o2"]));
  // Every leg has a competitor, so nothing is safe to confirm automatically.
  expect(candidates.every((c) => c.ambiguous)).toBe(true);
  expect(auto(txs).added).toEqual([]);
});

test("ranking is exact before FX, then the smaller date gap, then stable ids", () => {
  const fxHistory = { USD: { "2026-03-10": 1.1 } };
  // The FX candidate lands sooner, but the exact one still wins.
  const exactFirst = match(
    [
      tx("a", "2026-03-10", -100, { id: "o1" }),
      tx("b", "2026-03-14", 100, { id: "i-exact" }),
      tx("c", "2026-03-11", 110, { id: "i-fx", currency: "USD" }),
    ],
    { fxHistory },
  );
  expect(exactFirst).toHaveLength(1);
  expect(exactFirst[0].pair.evidence?.rank).toBe("exact");
  expect(exactFirst[0].pair.inflowTxId).toBe("i-exact");

  // Disjoint pairs: the one-day gap sorts before the three-day gap.
  const byDateGap = match([
    tx("a", "2026-03-10", -100, { id: "o1" }),
    tx("b", "2026-03-11", 100, { id: "i1" }),
    tx("c", "2026-03-10", -200, { id: "o2" }),
    tx("b", "2026-03-13", 200, { id: "i2" }),
  ]);
  expect(byDateGap.map((c) => c.pair.outflowTxId)).toEqual(["o1", "o2"]);
});

// --- cross-currency branch --------------------------------------------------

test("an FX pair is proposed only within the tolerance band", () => {
  const fxHistory = { USD: { "2026-03-10": 1.1 } }; // 1 EUR = 1.10 USD
  const run = (usd: number) =>
    match(
      [
        tx("a", "2026-03-10", -100, { id: "o1" }),
        tx("b", "2026-03-11", usd, { id: "i1", currency: "USD" }),
      ],
      { fxHistory },
    );

  const within = run(105); // EUR 95.45, 4.5% off — inside the default 10%
  expect(within).toHaveLength(1);
  expect(within[0].pair.evidence?.rank).toBe("fx");
  expect(within[0].pair.evidence?.dateDiffDays).toBe(1);
  expect(within[0].pair.evidence?.amountDeltaCents).toBe(455);
  expect(within[0].pair.evidence?.crossRate).toBeCloseTo(1.05, 10);
  expect(within[0].pair.currency).toBe("EUR"); // the outflow leg's currency
  expect(within[0].pair.amountCents).toBe(10_000);

  expect(run(130)).toEqual([]); // EUR 118.18, 18% off — outside 10%

  // A missing rate is a gap, never a 1:1 guess (ADR 0011 §9).
  expect(
    match(
      [
        tx("a", "2026-03-10", -100, { id: "o1" }),
        tx("b", "2026-03-11", 110, { id: "i1", currency: "CHF" }),
      ],
      { fxHistory },
    ),
  ).toEqual([]);
  // And no history at all means no FX candidates whatsoever.
  expect(
    match([
      tx("a", "2026-03-10", -100, { id: "o1" }),
      tx("b", "2026-03-11", 100, { id: "i1", currency: "USD" }),
    ]),
  ).toEqual([]);
});

test("the configured FX tolerance clamps at Sure's 50% ceiling", () => {
  const fxHistory = { USD: { "2026-03-10": 1.1 } };
  const at = (usd: number, tolerance?: number) =>
    match(
      [
        tx("a", "2026-03-10", -100, { id: "o1" }),
        tx("b", "2026-03-11", usd, { id: "i1", currency: "USD" }),
      ],
      { fxHistory, fxTolerance: tolerance },
    );

  expect(at(130)).toEqual([]); // 18% off: outside the default 10%
  expect(at(130, 99)).toHaveLength(1); // configured tolerance raises the band...
  expect(at(200, 99)).toEqual([]); // ...but is capped at 50%, not 9,900%
});

// --- kind derivation --------------------------------------------------------

test("the transfer kind follows the destination account (Sure transfer.rb:31-47)", () => {
  const source = acc("src");
  const kindOf = (destination: Account, from: Account = source) =>
    deriveTransferKind(tx(from.key, "2026-03-10", -100), tx(destination.key, "2026-03-10", 100), [
      from,
      destination,
    ]);

  expect(kindOf(acc("d", { type: "Creditcard" }))).toBe("cc_payment");
  expect(kindOf(acc("d", { type: "Beleggingsrekening" }))).toBe("investment_contribution");
  expect(kindOf(acc("d", { type: "Spaarrekening" }))).toBe("funds_movement");
  expect(kindOf(acc("d", { type: "Overig", name: "Lening" }))).toBe("loan_payment");
  expect(kindOf(acc("d", { type: "Overig", name: "Hypotheek" }))).toBe("loan_payment");
  expect(kindOf(acc("d", { type: "Overig", name: "Krediet" }))).toBe("loan_payment");
  expect(kindOf(acc("d", { type: "Overig", name: "Overig" }))).toBe("funds_movement");
  // A name alone is not a kind: a current account called "Lening" is still current.
  expect(kindOf(acc("d", { type: "Betaalrekening", name: "Lening" }))).toBe("funds_movement");
  // Investment → investment is moving money between pots, not contributing.
  expect(
    kindOf(acc("d", { type: "Beleggingsrekening" }), acc("src", { type: "Beleggingsrekening" })),
  ).toBe("funds_movement");
  // A destination outside the ledger says nothing about its kind.
  expect(
    deriveTransferKind(tx("src", "2026-03-10", -100), tx("ghost", "2026-03-10", 100), [source]),
  ).toBe("funds_movement");
});

// --- lifecycle --------------------------------------------------------------

test("confirm and reject are decisions, not mutations of the suggestion", () => {
  const suggestion = pair("o1", "i1");
  const confirmed = confirmTransfer(suggestion, "2026-04-01");
  expect(confirmed).toMatchObject({ status: "confirmed", decidedAt: "2026-04-01" });
  expect(confirmed.createdAt).toBe(ASOF);
  expect(confirmed.id).toBe(suggestion.id);
  expect(suggestion.status).toBe("suggested"); // input untouched

  const rejected = rejectTransfer(suggestion, "2026-04-02");
  expect(rejected).toMatchObject({ status: "rejected", decidedAt: "2026-04-02" });
});

test("autoConfirmTransfers adds only unambiguous exact pairs, and is idempotent", () => {
  const txs = [tx("a", "2026-03-10", -100, { id: "o1" }), tx("b", "2026-03-10", 100, { id: "i1" })];

  const stale = confirmTransfer(pair("x1", "y1"), "2026-03-01");
  const first = auto(txs, { pairs: [stale] });
  expect(first.added).toHaveLength(1);
  expect(first.added[0].status).toBe("confirmed");
  expect(first.added[0].decidedAt).toBe(ASOF);
  expect(first.pairs).toEqual([stale, first.added[0]]); // existing decisions stay

  const second = auto(txs, { pairs: first.pairs });
  expect(second.added).toEqual([]);
  expect(second.pairs).toEqual(first.pairs);
});

test("autoConfirmTransfers leaves FX and ambiguous exact pairs as suggestions", () => {
  const fxHistory = { USD: { "2026-03-10": 1.1 } };
  expect(
    auto(
      [
        tx("a", "2026-03-10", -100, { id: "o1" }),
        tx("b", "2026-03-11", 110, { id: "i1", currency: "USD" }),
      ],
      { fxHistory },
    ).added,
  ).toEqual([]);

  expect(
    auto([
      tx("a", "2026-03-10", -100, { id: "o1" }),
      tx("b", "2026-03-10", 100, { id: "i1" }),
      tx("c", "2026-03-11", 100, { id: "i2" }),
    ]).added,
  ).toEqual([]);
});

test("a stored suggestion is derived state: it claims nothing and is not carried forward", () => {
  const txs = [tx("a", "2026-03-10", -100, { id: "o1" }), tx("b", "2026-03-10", 100, { id: "i1" })];
  const suggestion = match(txs)[0].pair;
  const result = auto(txs, { pairs: [suggestion] });
  expect(result.added).toHaveLength(1);
  expect(result.pairs.map((p) => p.status)).toEqual(["confirmed"]);
});

// --- merge / delete reconciliation -----------------------------------------

test("reconcileTransfers follows a merge: re-keyed legs keep the decision, absorbed legs drop it", () => {
  const survivor = acc("123456789", { bank: "ING" });
  const duplicate = acc("NL12INGB0123456789", { bank: "ING" });
  const survivorTxs = assignTxIds([
    {
      accountKey: survivor.key,
      date: "2026-08-01",
      amount: -10,
      currency: "EUR",
      counterparty: "Albert Heijn",
      description: "",
      category: "",
      manual: false,
    },
  ]);
  const duplicateTxs = assignTxIds([
    {
      accountKey: duplicate.key,
      date: "2026-08-01", // the overlap: absorbed by the survivor's copy
      amount: -10,
      currency: "EUR",
      counterparty: "Albert Heijn",
      description: "",
      category: "",
      manual: false,
    },
    {
      accountKey: duplicate.key,
      date: "2026-07-15", // only the duplicate has it: re-keyed, survives
      amount: -20,
      currency: "EUR",
      counterparty: "Shell",
      description: "",
      category: "",
      manual: false,
    },
  ]);
  const merged = mergeAccounts(
    [survivor, duplicate],
    [...survivorTxs, ...duplicateTxs],
    survivor.key,
    duplicate.key,
  );
  const rekeyed = merged.txs.find((t) => t.counterparty === "Shell")!;
  const overlapping = duplicateTxs[0];
  const unchanged = survivorTxs[0];

  const survives = pair(unchanged.id, duplicateTxs[1].id, {
    status: "confirmed",
    kind: "cc_payment",
    decidedAt: "2026-08-10",
  });
  const absorbed = pair(overlapping.id, unchanged.id, { status: "confirmed" });

  const result = reconcileTransfers([survives, absorbed], merged.txIdRemap);

  expect(result.pairs).toHaveLength(1);
  const kept = result.pairs[0];
  expect(kept.outflowTxId).toBe(unchanged.id); // untouched id survives as is
  expect(kept.inflowTxId).toBe(rekeyed.id); // merge re-keyed the other leg
  expect(kept.id).toBe(transferPairId(unchanged.id, rekeyed.id));
  expect(kept.status).toBe("confirmed");
  expect(kept.kind).toBe("cc_payment");
  expect(kept.decidedAt).toBe("2026-08-10");
  expect(result.dropped).toEqual([absorbed]);
});

test("reconcileTransfers drops a pair when a fee leg was absorbed by the merge", () => {
  const survives = pair("o1", "i1", { status: "confirmed", feeTxIds: ["fee-ok"] });
  const lostFee = pair("o2", "i2", { status: "confirmed", feeTxIds: ["fee-lost"] });
  const remap = new Map<string, string | null>([
    ["fee-lost", null],
    ["fee-ok", "fee-ok-new"],
  ]);
  const result = reconcileTransfers([survives, lostFee], remap);
  expect(result.pairs).toHaveLength(1);
  expect(result.pairs[0].feeTxIds).toEqual(["fee-ok-new"]);
  expect(result.dropped).toEqual([lostFee]);
});

test("reconcileTransfers treats delete ids as vanished rows and reports the pair", () => {
  const pairA = pair("o1", "i1", { status: "confirmed" });
  const pairB = pair("o2", "i2", { status: "rejected" });
  const remap = new Map<string, string | null>([["i2", null]]);

  const result = reconcileTransfers([pairA, pairB], remap);
  expect(result.pairs).toEqual([pairA]);
  expect(result.dropped).toEqual([pairB]);
});

// --- read-model projection --------------------------------------------------

test("applyTransferDecisions marks only CONFIRMED legs, and never the fee rows", () => {
  const out = tx("a", "2026-03-10", -100, { id: "o1" });
  const inflow = tx("b", "2026-03-10", 100, { id: "i1" });
  const other = tx("a", "2026-03-11", -12.5, { id: "x1", counterparty: "Albert Heijn" });
  const fee = tx("a", "2026-03-10", -2, { id: "fee1", counterparty: "Kosten overboeking" });
  const rejectedOut = tx("a", "2026-03-12", -50, { id: "o2" });
  const rejectedIn = tx("b", "2026-03-12", 50, { id: "i2" });

  const confirmed = confirmTransfer(pair("o1", "i1", { feeTxIds: ["fee1"] }), ASOF);
  const rejected = rejectTransfer(pair("o2", "i2"), ASOF);
  const projected = applyTransferDecisions(
    [out, inflow, other, fee, rejectedOut, rejectedIn],
    [confirmed, rejected],
  );

  expect(projected[0].category).toBe(TRANSFER_CATEGORY);
  expect(projected[1].category).toBe(TRANSFER_CATEGORY);
  expect(projected[2]).toBe(other); // untouched row keeps its identity
  expect(projected[3]).toBe(fee); // a fee is a charged row, not the internal move
  expect(projected[4]).toBe(rejectedOut);
  expect(projected[5]).toBe(rejectedIn);
  // Derived on read: the input ledger is not rewritten.
  expect(out.category).toBe("");
  expect(fee.category).toBe("");
});

test("confirmedTransferTxIds is the predicate for confirmed pairs only", () => {
  const ids = confirmedTransferTxIds([
    confirmTransfer(pair("o1", "i1", { feeTxIds: ["fee1"] }), ASOF),
    rejectTransfer(pair("o2", "i2"), ASOF),
    pair("o3", "i3"),
  ]);
  expect(ids).toEqual(new Set(["o1", "i1"]));
});

// --- spend regression: the pair is authoritative, the crossing is not lost --

test("confirmed transfer legs leave spend, while the BV↔private crossing is still reported", () => {
  const bv = acc("bv", { entity: "BV1", name: "BV1", iban: "NL01BANK0000000001" });
  const prive = acc("prive", { entity: "Privé", name: "Privé", iban: "NL02BANK0000000002" });
  const bvOpening = tx(bv.key, "2026-02-01", 5000, { id: "bv-feb" });
  const priveRent = tx(prive.key, "2026-02-02", -1000, {
    id: "prive-feb",
    counterparty: "Verhuurder",
  });
  const internalOut = tx(bv.key, "2026-03-10", -5000, { id: "bv-uit" });
  const internalIn = tx(prive.key, "2026-03-10", 5000, { id: "prive-in" });
  const groceries = tx(prive.key, "2026-03-12", -100, {
    id: "ah",
    counterparty: "Albert Heijn",
  });
  const txs = [bvOpening, priveRent, internalOut, internalIn, groceries];

  const confirmed = autoConfirmTransfers({ txs, accounts: [bv, prive], asOf: ASOF });
  expect(confirmed.added).toHaveLength(1);
  const pairRecord = confirmed.added[0];

  const projected = applyTransferDecisions(txs, [pairRecord]);

  // Spend: the two € 5.000 legs are no longer expenses.
  const spend = (rows: { out: number }[]) => rows.reduce((n, r) => n + r.out, 0);
  expect(spend(categoryComparison(txs, []).rows)).toBeCloseTo(5100, 2);
  const after = categoryComparison(projected, []);
  expect(spend(after.rows)).toBeCloseTo(100, 2);
  expect(after.rows.some((r) => r.category === TRANSFER_CATEGORY)).toBe(false);

  const totals = categoryTotals(projected, []);
  expect(totals[TRANSFER_CATEGORY]).toEqual({ in: 5000, out: -5000 });

  // The boundary module must still MEASURE the crossing; a confirmed pair is
  // exactly the two-legged proof it wants, not something to swallow.
  const profiles: EntityProfile[] = [
    { entity: "BV1", scope: "business" },
    { entity: "Privé", scope: "personal" },
  ];
  const report = crossScopeTransfers({
    accounts: [bv, prive],
    txs,
    profiles,
    asOf: ASOF,
    transfers: [pairRecord],
  });
  if (report.state !== "gemeten") throw new Error(`verwacht "gemeten", kreeg "${report.state}"`);
  expect(report.crossings).toHaveLength(1);
  expect(report.crossings[0].matched).toBe(true);
  expect(report.crossings[0].evidence).toBe("twee-benen");
  expect(report.crossings[0].legs.map((l) => l.txId).sort()).toEqual(["bv-uit", "prive-in"]);
  expect(report.totalCents).toBe(500_000); // crossings, never legs
  expect(report.matchedCents).toBe(500_000);
});

// --- investment contribution classification (WS4.7, #298) -------------------

test("a personal -> investment pair is an investment contribution and leaves spending", () => {
  const checking = acc("checking", { type: "Betaalrekening", entity: "Privé" });
  const broker = acc("broker", { type: "Beleggingsrekening", entity: "Privé" });
  const txs = [
    tx("checking", "2026-03-10", -1000, { id: "contribution-out" }),
    tx("broker", "2026-03-10", 1000, { id: "contribution-in" }),
  ];

  const added = autoConfirmTransfers({ txs, accounts: [checking, broker], asOf: ASOF }).added;
  expect(added).toHaveLength(1);
  const contribution = added[0]!;
  expect(contribution.kind).toBe("investment_contribution");
  expect(isInvestmentContribution(contribution)).toBe(true);

  // The same two legs the kind derivation saw are the ones the spend surface
  // excludes, so contribution and spending cannot disagree.
  const projected = applyTransferDecisions(txs, [contribution]);
  expect(projected.map((row) => row.category)).toEqual([TRANSFER_CATEGORY, TRANSFER_CATEGORY]);
  expect(categoryComparison(projected, []).rows).toHaveLength(0);
  expect(summarizeConfirmedTransfers([contribution]).contributionCents).toBe(100_000);
});

test("an investment -> investment move is funds movement: no contribution and no spending", () => {
  const first = acc("first", { type: "Beleggingsrekening" });
  const second = acc("second", { type: "Beleggingsrekening" });
  const txs = [
    tx("first", "2026-03-10", -500, { id: "move-out" }),
    tx("second", "2026-03-10", 500, { id: "move-in" }),
  ];

  const added = autoConfirmTransfers({ txs, accounts: [first, second], asOf: ASOF }).added;
  expect(added).toHaveLength(1);
  expect(added[0]!.kind).toBe("funds_movement");
  expect(isInvestmentContribution(added[0]!)).toBe(false);
  expect(summarizeConfirmedTransfers(added)).toMatchObject({ contributionCents: 0 });
  expect(
    applyTransferDecisions(txs, added).every((row) => row.category === TRANSFER_CATEGORY),
  ).toBe(true);
});

test("only confirmed pairs move the contribution total, and a non-EUR leg is never converted 1:1", () => {
  const suggested = pair("s-out", "s-in", {
    kind: "investment_contribution",
    amountCents: 700_00,
  });
  expect(isInvestmentContribution(suggested)).toBe(false);
  expect(summarizeConfirmedTransfers([suggested])).toEqual({
    contributionCents: 0,
    fundsMovementCents: 0,
    ccPaymentCents: 0,
    loanPaymentCents: 0,
    unconvertedPairIds: [],
  });

  const eur = confirmTransfer(
    pair("o1", "i1", { kind: "investment_contribution", amountCents: 500_00 }),
    ASOF,
  );
  const usd = confirmTransfer(
    pair("o2", "i2", { kind: "investment_contribution", amountCents: 400_00, currency: "USD" }),
    ASOF,
  );
  const summary = summarizeConfirmedTransfers([eur, usd]);
  expect(summary.contributionCents).toBe(500_00);
  expect(summary.unconvertedPairIds).toEqual([usd.id]);
});

test("an account whose explicit type names crypto is in the investment scope", () => {
  const checking = acc("checking", { type: "Betaalrekening" });
  const wallet = acc("wallet", { type: "Crypto" });
  expect(isInvestmentAccount(wallet)).toBe(true);
  expect(isInvestmentAccount(checking)).toBe(false);

  expect(
    deriveTransferKind(tx("checking", "2026-03-10", -250), tx("wallet", "2026-03-10", 250), [
      checking,
      wallet,
    ]),
  ).toBe("investment_contribution");
  // Two wallets are still moving money inside the investment scope.
  const exchange = acc("exchange", { type: "Crypto exchange" });
  expect(
    deriveTransferKind(tx("wallet", "2026-03-10", -250), tx("exchange", "2026-03-10", 250), [
      wallet,
      exchange,
    ]),
  ).toBe("funds_movement");
});
