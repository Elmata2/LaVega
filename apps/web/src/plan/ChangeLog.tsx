import type { PlanDiff } from "@lavega/core";
import { useAppLocale } from "../appLocale.js";
import Card from "../components/ui/Card.js";
import { planFmt, planShellCopy } from "../copy/plan/index.js";
import type { FlatId } from "../copy/plan/shell.js";
import { formatFigure } from "./planFormat.js";
import StatusChip from "./StatusChip.js";
import type { ChangesSince } from "./usePlan.js";

/** What moved since the previous stored plan: each changed figure with its
 *  before and after and the reason, each status change with the old and the
 *  new chip. Says so when nothing material moved. */
/** A figure the plan no longer holds: a snapshot stored before it was removed
 *  still carries it, and that must not read as a change. */
const UNSHOWN_FIGURES: readonly string[] = ["best_free_rate_pct"];

export default function ChangeLog({ diff: full, since }: { diff: PlanDiff; since: ChangesSince }) {
  const diff: PlanDiff = {
    ...full,
    changes: full.changes.filter((c) => !UNSHOWN_FIGURES.includes(c.figureId)),
  };
  const [locale] = useAppLocale();
  const shell = planShellCopy[locale];
  const c = shell.changes;
  const fmt = planFmt(locale);
  const empty = diff.changes.length === 0 && diff.statusChanges.length === 0;
  return (
    <Card as="section" aria-label={c.heading} data-testid="plan-changelog">
      <h3 className="m-0 mb-2" data-testid="plan-changelog-heading">
        {diff.baseline || since === null
          ? c.heading
          : since.kind === "earlier-month"
            ? c.headingSinceMonth(fmt.monthLabel(since.month))
            : c.headingSinceFirst}
      </h3>
      {diff.baseline ? (
        <p className="m-0">{c.firstPlan}</p>
      ) : empty ? (
        <p className="m-0">{c.none}</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 text-[0.9rem]">
          {diff.statusChanges.map((s) => (
            <li key={`status-${s.section}`} data-testid="plan-change-status">
              <strong>{shell.sectionTitles[s.section]}</strong>{" "}
              <StatusChip status={s.before} shell={shell} /> {" → "}
              <StatusChip status={s.after} shell={shell} />
              <div className="text-muted">
                {c.statusChange(shell.status[s.before].word, shell.status[s.after].word)}
              </div>
            </li>
          ))}
          {diff.changes.map((ch) => (
            <li key={`${ch.section}-${ch.figureId}`} data-testid="plan-change">
              <div>
                {c.line(
                  `${shell.sectionTitles[ch.section]} (${shell.figureLabels[ch.figureId as FlatId] ?? ch.figureId})`,
                  formatFigure(ch.before, ch.unit, fmt, shell.noFigure),
                  formatFigure(ch.after, ch.unit, fmt, shell.noFigure),
                )}
              </div>
              <div className="text-muted">{c.reasons[ch.reason.key](ch.reason.params ?? {})}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
