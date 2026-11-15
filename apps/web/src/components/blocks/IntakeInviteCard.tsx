import { riskDue, type AdvisorProfileStore } from "@lavega/core";
import { useAppLocale } from "../../appLocale.js";
import { intakeCopy } from "../../copy/intake.js";
import { useProfileCommit } from "../../intake/useProfileCommit.js";
import {
  isFinishedIntake,
  pendingNewQuestions,
  reopenRisk,
  resumeScreen,
  round2Due,
  round2Pending,
  type ScreenId,
} from "../../intake/wizard/screens.js";
import Module from "../Module.js";
import { useWidgetEnabled } from "../moduleRegistry";
import Button from "../ui/Button.js";

export type ResumeAt = ScreenId | null;

export type IntakeInviteCardProps = {
  onStart: () => void;
  resumeAt: ResumeAt;
  /** The intake is done but the risk answers are due again; resumes at the first risk screen. */
  riskDue?: boolean;
  /** How many new questions a finished user has not answered yet. */
  newQuestions?: number;
  /** How many round 2 questions are still unanswered. */
  round2Questions?: number;
};

export function IntakeInviteCard({
  onStart,
  resumeAt,
  riskDue: due = false,
  newQuestions,
  round2Questions,
}: IntakeInviteCardProps) {
  const [locale] = useAppLocale();
  const c = intakeCopy[locale].home.invite;
  if (newQuestions !== undefined) {
    return (
      <Module title={c.newQuestions.title} span={3}>
        <div data-testid="intake-invite">
          <p className="m-0">{c.newQuestions.count(newQuestions)}</p>
          <div className="mt-3">
            <Button variant="primary" onClick={onStart}>
              {c.start}
            </Button>
          </div>
        </div>
      </Module>
    );
  }
  if (round2Questions !== undefined) {
    return (
      <Module title={c.round2.title} span={3}>
        <div data-testid="intake-invite">
          <p className="m-0">{c.round2.count(round2Questions)}</p>
          <div className="mt-3">
            <Button variant="primary" onClick={onStart}>
              {c.start}
            </Button>
          </div>
        </div>
      </Module>
    );
  }
  const resuming = due || resumeAt !== null;
  return (
    <Module title={c.title} span={3}>
      <div data-testid="intake-invite">
        <p className="m-0">{c.intro}</p>
        {resuming && (
          <p className="text-muted text-[0.85rem]" data-testid="intake-invite-resume">
            {due ? c.riskDue : c.resumed}
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
export type InviteState =
  | { kind: "intake"; resumeAt: ResumeAt; riskDue: boolean }
  | { kind: "new-questions"; count: number }
  | { kind: "round2"; count: number };

export function inviteState(
  store: AdvisorProfileStore | null,
  asOf: string,
  hasTransactions = false,
): InviteState | null {
  if (store === null) return { kind: "intake", resumeAt: null, riskDue: false };
  const p = store.current;
  if (p.intake.blocksDone < 3) {
    const at = resumeScreen(p);
    const started = p.intake.lastScreen !== undefined || p.intake.blocksDone > 0;
    return { kind: "intake", resumeAt: started && at !== "done" ? at : null, riskDue: false };
  }
  if (!isFinishedIntake(p)) {
    // Stopped between the last risk screen and the end: pick up there.
    const at = resumeScreen(p);
    if (at !== "done") return { kind: "intake", resumeAt: at, riskDue: false };
  }
  // One card at a time: the new questions, then round 2, then the risk review.
  const count = isFinishedIntake(p) ? pendingNewQuestions(p).length : 0;
  if (count > 0) return { kind: "new-questions", count };
  const left = round2Pending(p).length;
  if (left > 0 && round2Due(p, hasTransactions)) return { kind: "round2", count: left };
  if (p.risk !== undefined && riskDue(p.risk.at, asOf, [])) {
    const at = resumeScreen(reopenRisk(p));
    return { kind: "intake", resumeAt: at === "done" ? null : at, riskDue: true };
  }
  return null;
}

export type IntakeInviteWidgetProps = {
  store: AdvisorProfileStore | null;
  asOf: string;
  onSave: (next: AdvisorProfileStore) => Promise<void>;
  onOpenIntake: () => void;
  /** Opens the wizard in round 2; falls back to onOpenIntake. */
  onOpenRound2?: () => void;
  /** The vault holds at least one transaction; round 2 waits for it. */
  hasTransactions?: boolean;
  now?: () => string;
};

function InviteInner(props: IntakeInviteWidgetProps) {
  const now = props.now ?? (() => new Date().toISOString());
  const { store, update } = useProfileCommit(props.store, props.onSave, now);
  const state = inviteState(props.store === null ? null : store, props.asOf, props.hasTransactions === true);
  if (state === null) return null;
  if (state.kind === "new-questions") {
    return <IntakeInviteCard resumeAt={null} newQuestions={state.count} onStart={props.onOpenIntake} />;
  }
  if (state.kind === "round2") {
    return (
      <IntakeInviteCard
        resumeAt={null}
        round2Questions={state.count}
        onStart={props.onOpenRound2 ?? props.onOpenIntake}
      />
    );
  }
  return (
    <IntakeInviteCard
      resumeAt={state.resumeAt}
      riskDue={state.riskDue}
      onStart={() => {
        if (!state.riskDue) return props.onOpenIntake();
        // Same mechanism as "Redo these questions": the risk screens reopen, answers stay.
        void update(reopenRisk).then((saved) => {
          if (saved) props.onOpenIntake();
        });
      }}
    />
  );
}

export function IntakeInviteWidget(props: IntakeInviteWidgetProps) {
  return useWidgetEnabled("intake-invite") ? <InviteInner {...props} /> : null;
}
