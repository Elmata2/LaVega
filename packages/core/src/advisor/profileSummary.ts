import { Schema } from "effect";
import {
  CardRepayment,
  CheckInCadence,
  CutTarget,
  IncomeRegularity,
  MoneySharing,
  PointsGoal,
  Priority,
  SpendArea,
} from "./profile.js";

/** The only slice of the advisor profile that may reach the AI chat: enum
 *  answers and nothing else. No birth year, banks, cards, amounts or names, and
 *  no free text (a `Schema.String` here would be a leak). */
export type ProfileSummary = {
  priorities: Priority[];
  cutTargets: CutTarget[];
  checkInCadence: CheckInCadence | null;
  confidence: 1 | 2 | 3 | 4 | null;
  household: "alone" | "together" | null;
  moneySharing: MoneySharing | null;
  incomeRegularity: IncomeRegularity | null;
  spendMix: SpendArea[];
  cardRepayment: CardRepayment | null;
  pointsGoal: PointsGoal | null;
};

const Household = Schema.Literals(["alone", "together"]);
const Confidence = Schema.Literals([1, 2, 3, 4]);

const scalar = <T>(is: (u: unknown) => u is T, v: unknown): T | null => (is(v) ? v : null);
const list = <T>(is: (u: unknown) => u is T, v: unknown): T[] =>
  Array.isArray(v) ? Array.from(new Set(v.filter(is))) : [];

/** The one gate for the summary, used on both sides of the wire. Anything that
 *  is not a known enum literal is dropped (arrays) or nulled (scalars); keys
 *  outside the summary never survive. Total: garbage in, empty summary out. */
export function sanitizeProfileSummary(raw: unknown): ProfileSummary {
  const r = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    priorities: list(Schema.is(Priority), r.priorities),
    cutTargets: list(Schema.is(CutTarget), r.cutTargets),
    checkInCadence: scalar(Schema.is(CheckInCadence), r.checkInCadence),
    confidence: scalar(Schema.is(Confidence), r.confidence),
    household: scalar(Schema.is(Household), r.household),
    moneySharing: scalar(Schema.is(MoneySharing), r.moneySharing),
    incomeRegularity: scalar(Schema.is(IncomeRegularity), r.incomeRegularity),
    spendMix: list(Schema.is(SpendArea), r.spendMix),
    cardRepayment: scalar(Schema.is(CardRepayment), r.cardRepayment),
    pointsGoal: scalar(Schema.is(PointsGoal), r.pointsGoal),
  };
}
