import {
  daysFromTo,
  deadlineCandidates,
  offerCandidates,
  spendingCandidate,
} from "./candidates.js";
import { REPEAT_WINDOW_DAYS, TIPS, TIP_COOLDOWN_DAYS, type Tip } from "./tips.js";
import type { Candidate, DailyInput } from "./types.js";

/* At most one message a day. Ranking, first match wins:
 *   1. deadline, soonest first (a date that passes cannot wait)
 *   2. better offer, largest yearly gain first
 *   3. spending against the same weekday last week
 *   4. a REVIEWED library tip, at most one per TIP_COOLDOWN_DAYS, in library order
 * A candidate whose key was sent within the last REPEAT_WINDOW_DAYS is skipped,
 * so the next one in the ranking gets the day. Keys are never logged here. */
export function dailyMessage(input: DailyInput, tips: readonly Tip[] = TIPS): Candidate | null {
  const recent = new Set(
    input.state.sentKeys
      .filter((s) => daysFromTo(s.date, input.today) < REPEAT_WINDOW_DAYS)
      .map((s) => s.key),
  );
  const fresh = (c: Candidate) => !recent.has(c.key);

  const deadline = deadlineCandidates(input).find(fresh);
  if (deadline) return deadline;

  const offer = offerCandidates(input)
    .filter(fresh)
    .sort(
      (a, b) =>
        (b.kind === "better-offer" ? b.figures.yearlyGainCents : 0) -
          (a.kind === "better-offer" ? a.figures.yearlyGainCents : 0) || a.key.localeCompare(b.key),
    )[0];
  if (offer) return offer;

  const spending = spendingCandidate(input);
  if (spending && fresh(spending)) return spending;

  // A tip's condition reads transactions or balances; without them nothing says it applies.
  if (input.noBankData) return null;

  const last = input.state.lastTipDate;
  if (last !== null && daysFromTo(last, input.today) < TIP_COOLDOWN_DAYS) return null;
  for (const tip of tips) {
    if (tip.reviewedAt === null) continue; // unreviewed tips are never sent
    const c: Candidate = { kind: "tip", key: `tip:${tip.id}`, figures: { tipId: tip.id } };
    if (fresh(c) && tip.when(input.answers, input)) return c;
  }
  return null;
}
