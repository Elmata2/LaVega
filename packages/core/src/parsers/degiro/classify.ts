import type { CashFlowKind } from "../../investing/model.js";

/** Which owner a row belongs to: this issue's cash flows, #316 dividends, #317 trades, or nothing. */
export type AccountBucket = "cash-flow" | "dividend" | "trade" | "skip";

/** The columns classification is allowed to look at. */
export type AccountRowRef = {
  /** `Omschrijving`, trimmed. */
  description: string;
  /** `Order Id`, trimmed; "" when the cell is empty. */
  orderId: string;
  /** False when the `Mutatie` amount cell is empty: an information line. */
  hasAmount: boolean;
};

export type AccountClassification = {
  bucket: AccountBucket;
  /** The cash-flow kind; non-null exactly when bucket is "cash-flow". */
  kind: CashFlowKind | null;
  /** Which dividend line this is; non-null exactly when bucket is "dividend".
   *  `tax` is the withholding line, `gross` the dividend it belongs to. */
  dividendKind: "gross" | "tax" | null;
  /** False when the description matched nothing known. Such a row is still a
   *  cash flow of kind "other" — never dropped — and the caller reports a
   *  problem naming the text. */
  recognised: boolean;
  /** False for rows that stay out of the Saldo walk: the cash sweep (its Saldo
   *  reports the flatex-bank leg) and information lines (no amount at all). */
  saldoWalk: boolean;
};

/* The description vocabulary #317 reads back out of the rows it receives. The
 * table and `./trades.ts` must agree on it: one source of truth, so a wording
 * change cannot make classification and the trade parser disagree. */
export const EXECUTION_DESCRIPTION = /^(koop|verkoop|buy|sell)\b/i;
export const COMMISSION_DESCRIPTION = /^degiro transactiekosten en\/of kosten van derden\b/i;
export const FX_LEG_DESCRIPTION = /^valuta (?:creditering|debitering)\b/i;

/**
 * One table entry: a description prefix and the bucket it belongs to.
 *
 * `saldoWalk` defaults to true. Only the cash sweep opts out, because its
 * `Saldo` reports the flatex-bank leg and would break the walk.
 */
type ClassificationRule = {
  readonly description: RegExp;
  readonly bucket: AccountBucket;
  readonly kind: CashFlowKind | null;
  /** Only dividend rules carry it; the caller requires it on a dividend row. */
  readonly dividendKind?: "gross" | "tax";
  readonly saldoWalk?: boolean;
};

/*
 * The classification table. First match wins, so the specific pattern comes
 * before the pattern that would swallow it: `Dividendbelasting` before
 * `Dividend`, and `Flatex Interest Income` before the flatex money rules.
 *
 * Only `Omschrijving` vocabulary lives here. Two structural rules stay in
 * `classifyAccountRow` because `Order Id` and `Mutatie` presence decide them,
 * not wording: an empty `Mutatie` is an information line, and a row with an
 * `Order Id` belongs to #317's trade group unless it is a dividend. Keeping
 * those out of the table is what makes the table safe to extend: a new
 * description cannot accidentally capture a trade's commission row.
 */
const CLASSIFICATION_TABLE: readonly ClassificationRule[] = [
  // #316 owns dividends. Both tax rules sit before the gross rule: the wording
  // starts with "Dividend"/"dividend", so the looser gross rule must never see
  // it. The EN rule is forward-looking for the day an English statement appears
  // (no EN account signature exists yet).
  // Both carry no Order Id; the structural rule keeps them a dividend even if
  // one ever did.
  { description: /^dividendbelasting\b/i, bucket: "dividend", kind: null, dividendKind: "tax" },
  { description: /^dividend tax\b/i, bucket: "dividend", kind: null, dividendKind: "tax" },
  { description: /^dividend\b/i, bucket: "dividend", kind: null, dividendKind: "gross" },

  // #317 owns executions. Without an Order Id they are still trade rows, never
  // cash flows: the execution's cash is the trade's own settlement.
  { description: EXECUTION_DESCRIPTION, bucket: "trade", kind: null },

  // External money: the only rows that are a deposit. The flatex deposit names
  // are written with the broker prefix as DeGiro emits it.
  { description: /^flatex storting\b/i, bucket: "cash-flow", kind: "deposit" },
  { description: /^ideal deposit\b/i, bucket: "cash-flow", kind: "deposit" },

  // External money leaving the account.
  { description: /^processed flatex withdrawal\b/i, bucket: "cash-flow", kind: "withdrawal" },
  { description: /^flatex terugstorting\b/i, bucket: "cash-flow", kind: "withdrawal" },

  // Interest before the flatex deposit names: "Flatex Interest Income" shares
  // the `flatex` word, and a broader flatex prefix would call it a deposit. The
  // sign comes from `Mutatie`; classification never flips it, so a negative
  // interest row stays kind "interest" and the caller reads it as a charge.
  { description: /^flatex interest income\b/i, bucket: "cash-flow", kind: "interest" },
  { description: /^rente\b/i, bucket: "cash-flow", kind: "interest" },

  // Exchange connection fee. A prefix match, because the text carries a year and
  // an exchange: "DEGIRO Aansluitingskosten 2026 (Xetra - XET)".
  { description: /^degiro aansluitingskosten\b/i, bucket: "cash-flow", kind: "fee" },

  // A commission row without an Order Id cannot belong to a trade. With one, the
  // structural rule above has already taken it as that trade's commission.
  {
    description: COMMISSION_DESCRIPTION,
    bucket: "cash-flow",
    kind: "fee",
  },

  /* The sweep only moves cash between the DeGiro account and the flatex bank;
   * its `Saldo` reports the flatex-bank leg, so it is not a movement of the
   * imported account and must not be a cash flow. Emitting it as one would make
   * core's date-based cash walk wrong on every date before it (the walk sums the
   * cash-flow and dividend events it is given, and that -23.24 never belonged to
   * the balance the `Saldo` column shows). It is a skip row: nothing to emit. */
  {
    description: /^(?:degiro )?cash sweep transfer\b/i,
    bucket: "skip",
    kind: null,
    saldoWalk: false,
  },

  // An FX leg belongs to #317 only while it carries the trade's Order Id. A
  // standalone currency credit/debit is a real ledger movement, so it stays a
  // cash flow and keeps its description.
  { description: FX_LEG_DESCRIPTION, bucket: "cash-flow", kind: "other" },

  // A reservation moves real cash but is not external money arriving: its
  // amount does not mirror a later deposit (the fixture holds +76.76 and later
  // -73.24 around a separate +21.76 `iDEAL Deposit`). It is a ledger movement of
  // kind "other", and it must never be `deposit`, or a reservation plus its
  // later deposit would double-count the deposit.
  {
    description: /^reservation ideal \/ sofort deposit\b/i,
    bucket: "cash-flow",
    kind: "other",
  },

  /* EN descriptions are forward-looking. The account statement has been
   * observed in NL only (DEGIRO.md: "An account statement has been observed in
   * NL only"), so no EN account export exists and none of these names carries
   * test pressure beyond a smoke test. Add only names the issue names. */
  { description: /^flatex deposit\b/i, bucket: "cash-flow", kind: "deposit" },
  { description: /^deposit\b/i, bucket: "cash-flow", kind: "deposit" },
  { description: /^withdrawal\b/i, bucket: "cash-flow", kind: "withdrawal" },
  { description: /^currency credit\b/i, bucket: "cash-flow", kind: "other" },
  { description: /^currency debit\b/i, bucket: "cash-flow", kind: "other" },
];

function firstRule(description: string): ClassificationRule | undefined {
  return CLASSIFICATION_TABLE.find((rule) => rule.description.test(description));
}

/**
 * Assign one account-statement row to exactly one bucket before any domain
 * mapping. Never throws and never drops a row with an amount: an unknown
 * description is a cash flow of kind "other" with `recognised: false`, so the
 * caller can report the text instead of guessing a kind.
 *
 * The checks are ordered, and the order is the contract:
 *
 * 1. no `Mutatie` amount → information line, nothing emitted;
 * 2. an `Order Id` → #317 trade group (dividend excepted), never a cash flow;
 * 3. otherwise the description table decides;
 * 4. nothing matched → cash flow of kind "other", unrecognised.
 */
export function classifyAccountRow(row: AccountRowRef): AccountClassification {
  // 1. An empty `Mutatie` means no cash moved, whatever the row says. This is
  // the `Overboeking … flatexDEGIRO Bank` and `Splitsing` shape.
  if (!row.hasAmount) {
    return { bucket: "skip", kind: null, dividendKind: null, recognised: true, saldoWalk: false };
  }

  const description = row.description.trim();
  const rule = firstRule(description);

  // 2. The Order Id itself identifies a trade's cash movement: an execution, its
  // commission row, or one of its AutoFX legs. It stays a trade even when the
  // wording is unknown, so it is recognised; #317 parses quantity and price and
  // reports its own problem if the text does not parse.
  if (row.orderId.trim() !== "") {
    if (rule?.bucket === "dividend") {
      return {
        bucket: "dividend",
        kind: null,
        dividendKind: rule.dividendKind ?? "gross",
        recognised: true,
        saldoWalk: true,
      };
    }
    return { bucket: "trade", kind: null, dividendKind: null, recognised: true, saldoWalk: true };
  }

  // No table rule matched: never drop an unknown movement — it still moves cash,
  // so it walks. The caller reports the unrecognised text, which is why this is
  // not a throw and not a guessed kind.
  if (rule === undefined) {
    return {
      bucket: "cash-flow",
      kind: "other",
      dividendKind: null,
      recognised: false,
      saldoWalk: true,
    };
  }

  // The table matched: its bucket, kind and walk flag win. A dividend rule that
  // forgot its kind falls back to "gross", so `dividendKind` stays non-null for
  // every dividend row.
  return {
    bucket: rule.bucket,
    kind: rule.kind,
    dividendKind: rule.bucket === "dividend" ? (rule.dividendKind ?? "gross") : null,
    recognised: true,
    saldoWalk: rule.saldoWalk ?? true,
  };
}
