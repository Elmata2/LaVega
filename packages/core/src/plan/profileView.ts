import { Schema } from "effect";
import {
  AdvisorProfile,
  emptyProfile,
  EPOCH,
  type AdvisorProfileStore,
  type Goal,
  type Debt,
} from "../advisor/profile.js";
import { fixedCostsMonthlyCents } from "../advisor/resolve.js";
import { hash } from "../hash.js";

/* The only plan code that reads intake profile internals. */

export type CentsRange = { lowCents: number; highCents: number };

export type PlanGoal = {
  goal: Goal;
  /** Start of the goal's straight-line schedule: the goal's anchor date when
   *  one is recorded, else the goal Field's `at`. */
  since: string;
  /** The amount saved on `since`: the anchor's amount when recorded, else the
   *  goal's typed saved-so-far (absent counts as 0). */
  startCents?: number;
};

export type PlanProfile = {
  incomeStreams: {
    id: string;
    label: string;
    monthlyCents: number;
    regular: boolean;
  }[];
  housingMonthlyCents: number | null;
  /** Housing plus the confirmed fixed costs; null when neither exists. */
  fixedCostsMonthlyCents: number | null;
  debts: Debt[];
  bufferTargetMonths: number | null;
  goals: PlanGoal[];
  children: { id: string; birthYear: number }[];
  tolerance: 1 | 2 | 3 | 4 | 5 | null;
  experience: "beginner" | "some" | "experienced" | null;
  savingsStatedCents: number | null;
  incomeStatedRange: CentsRange | null;
  spendStatedRange: CentsRange | null;
  intakeBlocksDone: number;
  profileHash: string;
  /** When the profile was last written (store.updatedAt); null for no store or
   *  the epoch placeholder. */
  profileUpdatedAt: string | null;
  removed: string[];
};

const emptyHash = (p: AdvisorProfile): string =>
  hash(JSON.stringify(Schema.encodeSync(AdvisorProfile)(p)));

/** The plan's view of the stored profile. `anchors` is `goalAnchorsOf(events)`.
 *  A null store gives the empty profile. */
export function planProfileOf(
  store: AdvisorProfileStore | null,
  anchors: Readonly<Record<string, { at: string; startCents: number }>> = {},
): PlanProfile {
  const p = store?.current ?? null;
  const housing = p?.housing?.value.monthlyCents ?? null;
  const fixed = p?.fixedCosts ?? [];
  return {
    incomeStreams: (p?.incomeStreams ?? []).map((f) => ({ ...f.value })),
    housingMonthlyCents: housing,
    fixedCostsMonthlyCents:
      p === null || (housing === null && fixed.length === 0)
        ? null
        : fixedCostsMonthlyCents(p),
    debts: [...(p?.debts ?? [])],
    bufferTargetMonths: p?.buffer?.value.months ?? null,
    goals: (p?.goals ?? []).map((f) => {
      const a = anchors[f.value.id];
      return a === undefined
        ? { goal: f.value, since: f.at }
        : { goal: f.value, since: a.at, startCents: a.startCents };
    }),
    children: (p?.children?.value ?? []).map((c) => ({
      id: c.id,
      birthYear: c.birthYear,
    })),
    tolerance: (p?.risk?.score ?? null) as PlanProfile["tolerance"],
    experience: p?.experience?.value ?? null,
    savingsStatedCents: p?.savings?.value.totalCents ?? null,
    incomeStatedRange: p?.statedRanges?.value.income ?? null,
    spendStatedRange: p?.statedRanges?.value.spend ?? null,
    intakeBlocksDone: p?.intake.blocksDone ?? 0,
    profileHash: emptyHash(p ?? emptyProfile()),
    profileUpdatedAt:
      store === null || store.updatedAt === EPOCH ? null : store.updatedAt,
    removed: [...(p?.removed ?? [])],
  };
}
