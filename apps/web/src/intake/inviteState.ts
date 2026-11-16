import { riskDue, type AdvisorProfileStore } from "@lavega/core";
import {
  isFinishedIntake,
  pendingNewQuestions,
  reopenRisk,
  resumeScreen,
  round2Due,
  round2Pending,
  type ScreenId,
} from "./wizard/screens.js";

export type ResumeAt = ScreenId | null;

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
  // One at a time: the new questions, then round 2, then the risk review.
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

export type InviteKind = "intake" | "new-questions" | "round2" | "risk";

/** The pop-up kind: a due risk review is its own kind, so dismissing "start the
 *  intake" does not silence it. */
export function inviteKindOf(state: InviteState | null): InviteKind | null {
  if (state === null) return null;
  if (state.kind === "intake" && state.riskDue) return "risk";
  return state.kind;
}
