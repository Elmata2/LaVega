import type { Account, Rule, Tx } from "../model.js";
import type { LegacyRule } from "../rules/model.js";
import type { RateBenchmark } from "../interest.js";

export type CandidateKind = "deadline" | "better-offer" | "spending" | "tip";

/** Every figure is integer cents or a whole-day count; `weekday` is 0 = Sunday. */
export type Candidate =
  | {
      kind: "spending";
      key: string;
      figures: {
        yesterdayCents: number;
        lastWeekdayCents: number;
        diffCents: number;
        weekday: number;
      };
    }
  | {
      kind: "deadline";
      key: string;
      figures: {
        what: "renewal" | "vat" | "other";
        name: string;
        dueDate: string;
        daysAway: number;
        amountCents: number | null;
      };
    }
  | { kind: "tip"; key: string; figures: { tipId: string } }
  | {
      kind: "better-offer";
      key: string;
      figures: { what: "card" | "rate"; name: string; yearlyGainCents: number };
    };

export const SPEND_MIN_DIFF_CENTS = 2000;
export const SPEND_MIN_DIFF_RATIO = 0.25;
export const DEADLINE_DAYS = 7;
export const OFFER_MIN_YEARLY_CENTS = 5000;
/** A card-offer snapshot older than this is not trusted. */
export const CARD_OFFER_MAX_AGE_DAYS = 90;

/** Same shape as `AgentMirror` in @lavega/database, which core cannot import;
 *  apps/server/src/agentRuleType.test.ts fails tsc if the two drift. */
export type AgentMirror = {
  /** Only legacy `{ id, match, category }` rows are mirrored. A v2 rule (typed
   *  conditions and actions) is not, so the daily message counts its
   *  transactions under the built-in category instead. */
  rules: LegacyRule[];
  dueDates: { kind: "vat" | "other"; label: string; date: string }[];
  cardOffer: { name: string; yearlyGainCents: number; computedAt: string } | null;
};

/** Phase 1: tips key on DailyInput only; intake answers are not mirrored. */
export type TipAnswers = Record<string, never>;

export type DailyInput = {
  /** The user's local calendar day (YYYY-MM-DD, Europe/Amsterdam); see amsterdamDay. */
  today: string;
  txs: Tx[];
  accounts: Account[];
  rules: Rule[];
  mirror: AgentMirror;
  balances: { accountKey: string; cents: number }[];
  rates: readonly RateBenchmark[];
  answers: TipAnswers;
  state: { sentKeys: { key: string; date: string }[]; lastTipDate: string | null };
  /** True when no bank read was possible today: candidates that need transactions or balances
   *  (spending, renewals, rate offers) are off; mirrored due dates and the card offer stay. */
  noBankData?: boolean;
};
