import type {
  Account,
  AdvisorProfileStore,
  PublicFact,
  RewardsBalance,
  SectionResult,
} from "@lavega/core";
import type { View } from "../../App";
import type { ProfileCommit } from "../../intake/useProfileCommit.js";
import type { UsePlan } from "../usePlan.js";

/** What every section body reads and writes. The sections hold no state of
 *  their own beyond what a person has typed and not yet saved. */
export type PlanCtx = {
  plan: UsePlan;
  /** The plan's day (ISO). Stamps the figures a person enters. */
  asOf: string;
  /** Personal-scope accounts, the only ones a goal can be linked to. */
  accounts: readonly Account[];
  /** The adviser profile and the one way to change it (the intake's). */
  profile: Pick<ProfileCommit, "update" | "saveFailed"> & {
    store: AdvisorProfileStore | null;
  };
  /** The manual points balances (the Punten tab's store) and how to store them.
   *  Without the saver the points are neither asked nor changed here. */
  rewards?: readonly RewardsBalance[];
  saveRewards?: (next: RewardsBalance[]) => Promise<void>;
  /** Test seam: the verified public facts to read. Default is PUBLIC_FACTS. */
  publicFacts?: readonly PublicFact[];
  onNavigate: (view: View) => void;
};

export type SectionProps<F> = { result: SectionResult<F>; ctx: PlanCtx };
