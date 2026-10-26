import { riskDue, type AdvisorProfileStore } from "@lavega/core";
import { useAppLocale } from "../../appLocale.js";
import { intakeCopy } from "../../copy/intake.js";
import { reopened } from "../../intake/aboutYouRows.js";
import { resumeStage } from "../../intake/state.js";
import { useProfileCommit } from "../../intake/useProfileCommit.js";
import Module from "../Module.js";
import { useWidgetEnabled } from "../moduleRegistry";
import Button from "../ui/Button.js";

export type ResumeAt = "step0" | "block1" | "block2" | "block3" | null;

export type IntakeInviteCardProps = {
  onStart: () => void;
  resumeAt: ResumeAt;
  /** The intake is done but the risk answers are due again; resumes at block 3. */
  riskDue?: boolean;
};

export function IntakeInviteCard({
  onStart,
  resumeAt,
  riskDue: due = false,
}: IntakeInviteCardProps) {
  const [locale] = useAppLocale();
  const c = intakeCopy[locale].home.invite;
  const resuming = due || resumeAt !== null;
  return (
    <Module title={c.title} span={3}>
      <div data-testid="intake-invite">
        <p className="m-0">{c.intro}</p>
        {resuming && (
          <p className="text-muted text-[0.85rem]" data-testid="intake-invite-resume">
            {due ? c.riskDue : c.resumeStep[resumeAt ?? "step0"]}
          </p>
        )}
        <div className="mt-3">
          <Button variant="primary" onClick={onStart}>
            {resuming ? c.resume : c.start}
          </Button>
        </div>
      </div>
    </Module>
  );
}

/** What the invitation should say for this profile, or null when it has nothing
 *  to ask: the intake is done and the risk answers are not due. No life events
 *  are recorded yet, so only the twelve-month rule can make risk due. */
export function inviteState(
  store: AdvisorProfileStore | null,
  asOf: string,
): { resumeAt: ResumeAt; riskDue: boolean } | null {
  if (store === null) return { resumeAt: null, riskDue: false };
  const p = store.current;
  if (p.intake.blocksDone < 3) {
    const stage = resumeStage(p);
    const resumeAt =
      p.intake.blocksDone === 0 && p.intake.step0 === null ? null : stage === "done" ? null : stage;
    return { resumeAt, riskDue: false };
  }
  if (p.risk !== undefined && riskDue(p.risk.at, asOf, []))
    return { resumeAt: "block3", riskDue: true };
  return null;
}

export type IntakeInviteWidgetProps = {
  store: AdvisorProfileStore | null;
  asOf: string;
  onSave: (next: AdvisorProfileStore) => Promise<void>;
  onOpenIntake: () => void;
  now?: () => string;
};

function InviteInner(props: IntakeInviteWidgetProps) {
  const now = props.now ?? (() => new Date().toISOString());
  const { store, update } = useProfileCommit(props.store, props.onSave, now);
  const state = inviteState(props.store === null ? null : store, props.asOf);
  if (state === null) return null;
  return (
    <IntakeInviteCard
      resumeAt={state.resumeAt}
      riskDue={state.riskDue}
      onStart={() => {
        if (!state.riskDue) return props.onOpenIntake();
        // Same mechanism as "Redo these questions": block 3 reopens, answers stay.
        void update(reopened).then((saved) => {
          if (saved) props.onOpenIntake();
        });
      }}
    />
  );
}

export function IntakeInviteWidget(props: IntakeInviteWidgetProps) {
  return useWidgetEnabled("intake-invite") ? <InviteInner {...props} /> : null;
}
