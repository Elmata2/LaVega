import { mkAccount, mkTx } from "../../advisor/testkit.js";
import type { CatalogueEntryLike } from "../../catalogRates.js";
import type { Account, Tx } from "../../model.js";
import catalogueFile from "../../../../../docs/catalog/catalog.json";
import { planInput } from "../testkit.js";
import type { HeldCardInput, PlanInput } from "../types.js";
import type { PlanProfile } from "../profileView.js";

/* Whole-verdict cases for the one card engine. Each case is a full plan input
 * built on the committed catalogue (docs/catalog/catalog.json), plus what the
 * verdict, the held ids and the Instinct offer must be. This is a TypeScript
 * module, not JSON: the inputs need date and transaction builders.
 * `cardVerdictAgreement.test.ts` runs every case through `computePlan`. */

export const CATALOGUE: readonly CatalogueEntryLike[] = (
  catalogueFile as unknown as { entries: CatalogueEntryLike[] }
).entries;

export type VerdictKind = "switch" | "keep" | "no-card-worth-it" | "unknown-baseline" | "no-options";

export type CardVerdictCase = {
  name: string;
  input: PlanInput;
  expect: {
    verdictKind: VerdictKind;
    bestCardId: string | null;
    gainCents: number | null;
    basis: "history" | "stated";
    heldIds: string[];
    offer: { name: string; yearlyGainCents: number } | null;
  };
};

/** The date the Instinct offer is computed on. */
export const TODAY = "2026-10-24";

const FULL_YEAR = [
  "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
  "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
];
const TWO_MONTHS = ["2026-08", "2026-09"];

const account = (key: string, o: Partial<Account> = {}): Account =>
  mkAccount(key, { balance: 0, balanceDate: "2026-10-20", ...o });

/** One grocery spend of `perMonthCents` per month on the account, plus a salary
 *  line so the month counts as covered. */
const spendOn = (key: string, perMonthCents: number, months: readonly string[]): Tx[] =>
  months.flatMap((m) => [
    mkTx("Start", `${m}-01`, 1, { accountKey: key, category: "Salaris" }),
    mkTx("Shop", `${m}-15`, -perMonthCents / 100, {
      accountKey: key,
      category: "Boodschappen",
    }),
  ]);

/** A held card the way the web layer hands it over: the catalogue id is already
 *  resolved (`buildHeldCards`); the figures come from the catalogue in the engine. */
const held = (accountKey: string, label: string, catalogueId: string | null): HeldCardInput => ({
  accountKey,
  label,
  catalogueId,
  cashback: { tier: "onbekend", reason: "soort-onbekend" },
  fee: null,
  fxFeePct: null,
  pointsPerEuro: null,
  programId: null,
});

const build = (
  over: Omit<Partial<PlanInput>, "profile"> & { profile?: Partial<PlanProfile> },
): PlanInput => planInput({ catalogue: CATALOGUE, ...over });

const creditAccount = (key: string, name: string, bank: string, o: Partial<Account> = {}) =>
  account(key, { name, bank, type: "Creditcard", ...o });

export const CARD_VERDICT_CASES: CardVerdictCase[] = [
  {
    name: "ICS Mastercard Classic holder",
    input: build({
      accounts: [creditAccount("ICS", "ICS Mastercard Classic", "ICS")],
      txs: spendOn("ICS", 100_000, FULL_YEAR),
      heldCards: [held("ICS", "ICS Mastercard Classic", "ics-mastercard-classic")],
    }),
    expect: {
      verdictKind: "switch",
      bestCardId: "american-express-blue-card",
      gainCents: 5695,
      basis: "history",
      heldIds: ["ics-mastercard-classic"],
      offer: { name: "American Express Blue Card", yearlyGainCents: 5695 },
    },
  },
  {
    name: "ING creditcard holder",
    input: build({
      accounts: [creditAccount("ING", "ING creditcard", "ING")],
      txs: spendOn("ING", 100_000, FULL_YEAR),
      heldCards: [held("ING", "ING creditcard", "ing-creditcard")],
    }),
    expect: {
      verdictKind: "switch",
      bestCardId: "american-express-blue-card",
      gainCents: 4200,
      basis: "history",
      heldIds: ["ing-creditcard"],
      offer: { name: "American Express Blue Card", yearlyGainCents: 4200 },
    },
  },
  {
    name: "American Express Gold holder",
    input: build({
      accounts: [creditAccount("AMEX", "American Express Gold Card", "American Express")],
      txs: spendOn("AMEX", 100_000, FULL_YEAR),
      heldCards: [held("AMEX", "American Express Gold Card", "american-express-gold-card")],
    }),
    expect: {
      verdictKind: "switch",
      bestCardId: "american-express-blue-card",
      gainCents: 22200,
      basis: "history",
      heldIds: ["american-express-gold-card"],
      offer: { name: "American Express Blue Card", yearlyGainCents: 22200 },
    },
  },
  {
    name: "unidentified connected credit card",
    input: build({
      accounts: [creditAccount("MYS", "Mystery Visa", "Onbekende Bank")],
      txs: spendOn("MYS", 100_000, FULL_YEAR),
      heldCards: [held("MYS", "Mystery Visa", null)],
    }),
    expect: {
      verdictKind: "unknown-baseline",
      bestCardId: null,
      gainCents: null,
      basis: "history",
      heldIds: [],
      offer: null,
    },
  },
  {
    name: "file-fed card with statedCardId",
    input: build({
      accounts: [
        creditAccount("FILE", "Kaart import", "Onbekende Bank", {
          statedCardId: "ics-visa-world-card",
        }),
      ],
      txs: spendOn("FILE", 100_000, FULL_YEAR),
      // The web layer resolves the stated id to the catalogue row before the plan.
      heldCards: [held("FILE", "Kaart import", "ics-visa-world-card")],
    }),
    expect: {
      verdictKind: "switch",
      bestCardId: "american-express-blue-card",
      gainCents: 6095,
      basis: "history",
      heldIds: ["ics-visa-world-card"],
      offer: { name: "American Express Blue Card", yearlyGainCents: 6095 },
    },
  },
  {
    name: "card debt carried while a switch is otherwise available",
    input: build({
      accounts: [creditAccount("AMEX", "American Express Gold Card", "American Express")],
      txs: spendOn("AMEX", 100_000, FULL_YEAR),
      heldCards: [held("AMEX", "American Express Gold Card", "american-express-gold-card")],
      profile: { cardRepayment: "sometimes" },
    }),
    expect: {
      verdictKind: "switch",
      bestCardId: "american-express-blue-card",
      gainCents: 22200,
      basis: "history",
      heldIds: ["american-express-gold-card"],
      offer: null,
    },
  },
  {
    name: "short history (2 months) with wizard spend answers",
    input: build({
      accounts: [account("CUR")],
      txs: spendOn("CUR", 100_000, TWO_MONTHS),
      profile: {
        statedCardIds: ["ics-mastercard-classic"],
        spendStatedRange: { lowCents: 100_000, highCents: 100_000 },
        foreignSpend: "never",
      },
    }),
    expect: {
      verdictKind: "switch",
      bestCardId: "american-express-blue-card",
      gainCents: 5695,
      basis: "stated",
      heldIds: ["ics-mastercard-classic"],
      offer: null,
    },
  },
  {
    name: "American Express Blue Card holder (nothing better)",
    input: build({
      accounts: [creditAccount("AMEX", "American Express Blue Card", "American Express")],
      txs: spendOn("AMEX", 100_000, FULL_YEAR),
      heldCards: [held("AMEX", "American Express Blue Card", "american-express-blue-card")],
    }),
    expect: {
      verdictKind: "keep",
      bestCardId: null,
      gainCents: 0,
      basis: "history",
      heldIds: ["american-express-blue-card"],
      offer: null,
    },
  },
  {
    name: "no card, domestic spend: a first-card switch, no unprompted offer",
    input: build({
      accounts: [account("CUR")],
      txs: spendOn("CUR", 500_000, FULL_YEAR),
    }),
    expect: {
      verdictKind: "switch",
      bestCardId: "american-express-green-card",
      gainCents: 10_200,
      basis: "history",
      heldIds: [],
      offer: null,
    },
  },
  {
    name: "no card, with foreign-currency card spend",
    input: (() => {
      const usd = FULL_YEAR.map((m) =>
        mkTx("Hotel", `${m}-20`, -330, { accountKey: "CUR", currency: "USD", category: "Reizen" }),
      );
      return build({
        accounts: [account("CUR")],
        txs: [...spendOn("CUR", 100_000, FULL_YEAR), ...usd],
        mode: "convert",
        fxHistory: { USD: Object.fromEntries(FULL_YEAR.map((m) => [`${m}-20`, 1.1])) },
      });
    })(),
    expect: {
      verdictKind: "no-card-worth-it",
      bestCardId: null,
      gainCents: null,
      basis: "history",
      heldIds: [],
      offer: null,
    },
  },
];
