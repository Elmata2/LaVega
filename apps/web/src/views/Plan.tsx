import { useMemo, useState } from "react";
import {
  SECTION_IDS,
  personalView,
  planProfileOf,
  type Account,
  type AdvisorProfileStore,
  type EntityProfile,
  type ProfileRead,
  type PublicFact,
  type RewardsBalance,
  type SectionId,
} from "@lavega/core";
import type { View } from "../App";
import { useAppLocale } from "../appLocale.js";
import { inviteState } from "../components/blocks/IntakeInviteCard.js";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import { intakeCopy } from "../copy/intake.js";
import { useProfileCommit } from "../intake/useProfileCommit.js";
import { planFmt, planShellCopy } from "../copy/plan/index.js";
import BackboneStrip from "../plan/BackboneStrip.js";
import CashflowCard from "../plan/CashflowCard.js";
import FromAnswers from "../plan/FromAnswers.js";
import ChangeLog from "../plan/ChangeLog.js";
import PlanHeader, { ASSUMPTIONS_ANCHOR } from "../plan/PlanHeader.js";
import ScenarioTable from "../plan/ScenarioTable.js";
import BufferSection from "../plan/sections/BufferSection.js";
import CardsSection from "../plan/sections/CardsSection.js";
import DebtsSection from "../plan/sections/DebtsSection.js";
import GoalsSection from "../plan/sections/GoalsSection.js";
import MonthSection from "../plan/sections/MonthSection.js";
import SpendingSection from "../plan/sections/SpendingSection.js";
import SubscriptionsSection from "../plan/sections/SubscriptionsSection.js";
import type { PlanCtx } from "../plan/sections/types.js";
import { useGoalAnchors } from "../plan/sections/useGoalAnchors.js";
import type { UsePlan } from "../plan/usePlan.js";

export type PlanProps = {
  plan: UsePlan;
  store: AdvisorProfileStore | null;
  /** Never "loading" or "error": the route shows those before it mounts this. */
  profileRead: ProfileRead;
  asOf: string;
  onSaveProfile: (next: AdvisorProfileStore) => Promise<void>;
  onNavigate: (view: View) => void;
  /** The manual points balances and how to store them (the Punten store). */
  rewards?: readonly RewardsBalance[];
  onSaveRewards?: (next: RewardsBalance[]) => Promise<void>;
  /** UNSCOPED accounts and the entity profiles that scope them; a goal can be
   *  linked only to a personal account. */
  accounts?: readonly Account[];
  entityProfiles?: readonly EntityProfile[];
  /** Test seam: the verified public facts to read. Default is PUBLIC_FACTS. */
  publicFacts?: readonly PublicFact[];
};

/** The seven section bodies, each mounted in its own card. */
function SectionBody({ section, ctx }: { section: SectionId; ctx: PlanCtx }) {
  const r = ctx.plan.result.sections;
  switch (section) {
    case "month":
      return <MonthSection result={r.month} ctx={ctx} />;
    case "buffer":
      return <BufferSection result={r.buffer} ctx={ctx} />;
    case "debts":
      return <DebtsSection result={r.debts} ctx={ctx} />;
    case "spending":
      return <SpendingSection result={r.spending} ctx={ctx} />;
    case "subscriptions":
      return <SubscriptionsSection result={r.subscriptions} ctx={ctx} />;
    case "cards":
      return <CardsSection result={r.cards} ctx={ctx} />;
    case "goals":
      return <GoalsSection result={r.goals} ctx={ctx} />;
  }
}

/** Your plan: header, the four-part strip, what changed, seven closed cards in
 *  a fixed order, the public scenario illustration, and a footer. A corrupt
 *  profile gets the notice and no way to start over it; a profile without a
 *  finished first block gets the invitation and nothing else. */
export default function Plan({
  plan,
  store,
  profileRead,
  asOf,
  onNavigate,
  onSaveProfile,
  accounts = [],
  entityProfiles = [],
  publicFacts,
  rewards,
  onSaveRewards,
}: PlanProps) {
  const [locale] = useAppLocale();
  const shell = planShellCopy[locale];
  const profile = useProfileCommit(store, onSaveProfile, () => new Date().toISOString());
  useGoalAnchors(plan, store);
  const personalAccounts = useMemo(
    () => personalView([...accounts], [], [...entityProfiles]).accounts,
    [accounts, entityProfiles],
  );
  const [recomputeFailed, setRecomputeFailed] = useState(false);
  const [recomputing, setRecomputing] = useState(false);

  if (profileRead.kind === "corrupt") {
    return (
      <p role="status" className="text-warn" data-testid="plan-corrupt">
        {intakeCopy[locale].aboutYou.corruptNotice}
      </p>
    );
  }
  if (planProfileOf(store).intakeBlocksDone < 1) {
    const invite = inviteState(store, asOf);
    const steps = intakeCopy[locale].home.invite;
    const resume =
      invite === null
        ? null
        : invite.riskDue
          ? steps.riskDue
          : invite.resumeAt === null
            ? null
            : steps.resumed;
    return (
      <Card as="section" aria-label={shell.title} data-testid="intake-invite">
        <h2>{shell.title}</h2>
        <p className="m-0">{shell.invitation.sentence}</p>
        {resume !== null && (
          <p className="text-muted text-[0.85rem]" data-testid="intake-invite-resume">
            {resume}
          </p>
        )}
        <div className="mt-3">
          <Button variant="primary" onClick={() => onNavigate("intake")}>
            {shell.invitation.start}
          </Button>
        </div>
      </Card>
    );
  }

  const fmt = planFmt(locale);
  const recompute = async () => {
    setRecomputeFailed(false);
    setRecomputing(true);
    try {
      await plan.recompute();
    } catch {
      setRecomputeFailed(true);
    } finally {
      setRecomputing(false);
    }
  };
  const computedOn = plan.result.asOf;
  const ctx: PlanCtx = {
    plan,
    asOf: plan.result.asOf,
    accounts: personalAccounts,
    profile: {
      store: profile.store,
      update: profile.update,
      saveFailed: profile.saveFailed,
    },
    publicFacts,
    onNavigate,
    ...(rewards === undefined ? {} : { rewards }),
    ...(onSaveRewards === undefined ? {} : { saveRewards: onSaveRewards }),
  };

  return (
    <div role="region" aria-label={shell.title} className="max-w-[48rem]" data-testid="plan-page">
      <PlanHeader result={plan.result} onOpenAboutYou={() => onNavigate("about-you")} />
      {plan.stateError && (
        <p role="alert" className="text-warn" data-testid="plan-error-state">
          {shell.errors.state}
        </p>
      )}
      {plan.writeError && (
        <p role="alert" className="text-warn" data-testid="plan-error-write">
          {shell.errors.write}
        </p>
      )}
      <FromAnswers
        store={profile.store}
        hasAccounts={personalAccounts.length > 0}
        month={plan.result.sections.month}
        onNavigate={onNavigate}
      />
      <BackboneStrip backbone={plan.result.backbone} publicFacts={publicFacts} />
      <ChangeLog diff={plan.changes} since={plan.changesSince} />
      {SECTION_IDS.map((id) => (
        <SectionBody key={id} section={id} ctx={ctx} />
      ))}
      {plan.result.cashflow !== null && <CashflowCard cashflow={plan.result.cashflow} ctx={ctx} />}
      <ScenarioTable id={ASSUMPTIONS_ANCHOR} />
      <footer className="text-muted text-[0.85rem]" data-testid="plan-footer">
        <p className="m-0 mb-2">{shell.footer.notice}</p>
        <p className="m-0 mb-2">{shell.footer.computedAt(fmt.date(computedOn))}</p>
        <Button
          data-testid="plan-recompute"
          disabled={recomputing}
          onClick={() => void recompute()}
        >
          {shell.footer.recompute}
        </Button>
        {recomputeFailed && (
          <p role="alert" className="text-warn" data-testid="plan-error-recompute">
            {shell.errors.recompute}
          </p>
        )}
      </footer>
    </div>
  );
}
