import { useState, type FormEvent } from "react";
import {
  accountTypeKind,
  goalAnchorEventOf,
  type Goal,
  type GoalRow,
  type GoalsFigures,
} from "@lavega/core";
import Button from "../../components/ui/Button.js";
import { goalsCopy, learnShortHorizonText } from "../../copy/plan/index.js";
import { nowIso } from "../clock.js";
import SectionCard from "../SectionCard.js";
import {
  CalcList,
  Group,
  Lines,
  Sources,
  StatusBody,
  ValueInput,
  useSectionCopy,
} from "./common.js";
import { centsText, parseEuros, parseNumber, parseWholeNumber, type Parsed } from "./parse.js";
import { applyGoalEdit, dropKey, saveProfile } from "./profileEdits.js";
import type { PlanCtx, SectionProps } from "./types.js";

/** One goal's own figures: the accounts linked to it, what is saved so far and
 *  what is planned each month. Each change is stored as a confirmed edit. */
function GoalEditor({ row, goal, ctx }: { row: GoalRow; goal: Goal; ctx: PlanCtx }) {
  const { a } = useSectionCopy();
  const [linkError, setLinkError] = useState(false);
  const refs = goal.accountRefs.filter((r) => r.kind === "bank").map((r) => r.id);
  const offered = ctx.accounts.filter((acc) => {
    const k = accountTypeKind(acc);
    return k === "savings" || k === "current";
  });
  const orphans = refs.filter((id) => !offered.some((acc) => acc.key === id));
  const hasForeign = offered.some((acc) => !/^eur$/i.test(acc.currency));
  const edit = (change: (g: Goal) => Goal) =>
    saveProfile(ctx, (p) => applyGoalEdit(p, goal.id, change, ctx.asOf));
  /** Editing saved-so-far moves the schedule's start to (now, that amount):
   *  date and amount are re-anchored together, so the line does not jump. */
  const reanchor = async (startCents: number) =>
    ctx.plan.appendPlanEvent(
      goalAnchorEventOf({
        goalId: goal.id,
        at: await nowIso(),
        startCents,
        first: false,
        nonce: String(Math.random()).slice(2, 10),
      }),
    );
  const toggle = async (id: string, on: boolean) => {
    try {
      await edit((g) => ({
        ...g,
        accountRefs: on
          ? [...g.accountRefs, { kind: "bank", id }]
          : g.accountRefs.filter((r) => !(r.kind === "bank" && r.id === id)),
      }));
      setLinkError(false);
    } catch {
      setLinkError(true);
    }
  };
  const box = (key: string, label: string) => (
    <li key={key}>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={refs.includes(key)}
          data-testid={`plan-goal-link-${goal.id}-${key}`}
          onChange={(e) => void toggle(key, e.target.checked)}
        />
        <span>{label}</span>
      </label>
    </li>
  );

  return (
    <fieldset className="m-0 mb-3 border-0 p-0" data-testid={`plan-goal-editor-${goal.id}`}>
      <legend className="mb-1 p-0 font-semibold">{a.goals.editTitle(row.purpose)}</legend>
      <p className="m-0 mb-1 text-[0.85rem] text-muted">{a.goals.linkLegend}</p>
      <ul className="m-0 mb-1 grid list-none gap-1 p-0">
        {offered.map((acc) => box(acc.key, a.goals.linkAccount(acc.name, acc.bank, acc.currency)))}
        {orphans.map((id) => box(id, a.goals.unknownAccount(id)))}
      </ul>
      {hasForeign && <p className="m-0 mb-2 text-muted text-[0.85rem]">{a.goals.foreignNote}</p>}
      {linkError && (
        <p role="alert" className="m-0 mb-2 text-warn text-[0.85rem]">
          {a.saveFailed}
        </p>
      )}
      <ValueInput
        name={`goal-saved-${goal.id}`}
        label={a.goals.savedLabel(row.purpose)}
        hint={a.goals.savedHint}
        stored={goal.startingBalanceCents === undefined ? "" : centsText(goal.startingBalanceCents)}
        parse={(t) => parseEuros(t, { allowZero: true })}
        onSave={async (cents) => {
          await edit((g) => ({ ...g, startingBalanceCents: cents }));
          await reanchor(cents);
        }}
        onClear={async () => {
          await edit((g) => dropKey(g, "startingBalanceCents") as Goal);
          await reanchor(0);
        }}
      />
      <ValueInput
        name={`goal-monthly-${goal.id}`}
        label={a.goals.monthlyLabel(row.purpose)}
        hint={a.goals.monthlyHint}
        stored={goal.plannedMonthlyCents === undefined ? "" : centsText(goal.plannedMonthlyCents)}
        parse={(t) => parseEuros(t, { allowZero: true })}
        onSave={(cents) => edit((g) => ({ ...g, plannedMonthlyCents: cents }))}
        onClear={() => edit((g) => dropKey(g, "plannedMonthlyCents") as Goal)}
      />
    </fieldset>
  );
}

type StudyDraft = { monthlyCost: string; months: string; tuition: string; inflation: string };
const EMPTY_STUDY: StudyDraft = { monthlyCost: "", months: "", tuition: "", inflation: "" };

/** The study-cost template: four figures, all the person's own. Stored only
 *  when all four are valid. */
function StudyForm({ ctx }: { ctx: PlanCtx }) {
  const { a } = useSectionCopy();
  const stored = ctx.plan.preferences.studyCostAssumptions;
  const fromStored = (): StudyDraft =>
    stored === null
      ? EMPTY_STUDY
      : {
          monthlyCost: centsText(stored.monthlyCostCents),
          months: String(stored.months),
          tuition: centsText(stored.tuitionCents),
          inflation: String(stored.inflationPct),
        };
  const key = JSON.stringify(stored);
  const [seen, setSeen] = useState(key);
  const [draft, setDraft] = useState<StudyDraft>(fromStored);
  const [error, setError] = useState<string | null>(null);
  if (seen !== key) {
    setSeen(key);
    setDraft(fromStored());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const m = parseEuros(draft.monthlyCost, { allowZero: true });
    const n = parseWholeNumber(draft.months, { min: 0, max: 600 });
    const t = parseEuros(draft.tuition, { allowZero: true });
    const i = parseNumber(draft.inflation, { min: -5, max: 50, maxDecimals: 2 });
    const bad = [m, n, t, i].find((x): x is Extract<Parsed<number>, { ok: false }> => !x.ok);
    if (bad !== undefined || !m.ok || !n.ok || !t.ok || !i.ok) {
      setError(a.errors[bad?.error ?? "required"]);
      return;
    }
    try {
      await ctx.plan.setPreference({
        studyCostAssumptions: {
          monthlyCostCents: m.value,
          months: n.value,
          tuitionCents: t.value,
          inflationPct: i.value,
          at: ctx.asOf,
        },
      });
      setError(null);
    } catch {
      setError(a.saveFailed);
    }
  }
  const field = (k: keyof StudyDraft, label: string, mode: "decimal" | "numeric") => (
    <label className="flex flex-col gap-1 text-muted">
      {label}
      <input
        type="text"
        inputMode={mode}
        autoComplete="off"
        value={draft[k]}
        data-testid={`plan-input-study-${k}`}
        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
        className="max-w-[10rem]"
      />
    </label>
  );
  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      data-testid="plan-study-form"
      className="mb-3"
    >
      <h5 className="m-0 mb-1 text-[0.85rem] font-semibold">{a.goals.study.title}</h5>
      <p className="m-0 mb-2 text-muted text-[0.85rem]">{a.goals.study.hint}</p>
      <div className="flex flex-wrap items-end gap-2">
        {field("monthlyCost", a.goals.study.monthlyCost, "decimal")}
        {field("months", a.goals.study.months, "numeric")}
        {field("tuition", a.goals.study.tuition, "decimal")}
        {field("inflation", a.goals.study.inflation, "decimal")}
        <Button type="submit" data-testid="plan-save-study">
          {a.save}
        </Button>
        {stored !== null && (
          <Button
            data-testid="plan-clear-study"
            onClick={() =>
              void ctx.plan.setPreference({ studyCostAssumptions: null }).then(
                () => setError(null),
                () => setError(a.saveFailed),
              )
            }
          >
            {a.clear}
          </Button>
        )}
      </div>
      <p
        role={error === null ? undefined : "alert"}
        data-testid="plan-error-study"
        className="m-0 text-warn text-[0.85rem]"
      >
        {error}
      </p>
    </form>
  );
}

/** Section 7: goals, what is saved against each, and what is not allocated.
 *  Order is the order the person entered the goals. The fixed scenario table
 *  stays its own card on the page; the one general short-horizon note shows
 *  here only from a verified source. */
export default function GoalsSection({ result, ctx }: SectionProps<GoalsFigures>) {
  const { locale, fmt, a } = useSectionCopy();
  const copy = goalsCopy[locale];
  const f = result.figures;
  const goals = ctx.profile.store?.current.goals ?? [];
  const learn = learnShortHorizonText(locale, ctx.publicFacts);
  const showStudy =
    f.rows.some((r) => r.kind === "child") || ctx.plan.preferences.studyCostAssumptions !== null;

  return (
    <SectionCard section="goals" result={result}>
      {{
        figures: (
          <div>
            <StatusBody section="goals" result={result} ctx={ctx} />
            <Lines
              lines={[
                f.unallocated.kind === "computed"
                  ? copy.unallocatedLine(f.unallocated, fmt)
                  : f.rows.length > 0
                    ? copy.unallocatedStopped(f.unallocated.missing)
                    : null,
                f.rows.length > 0 ? copy.capacityLine(f.capacity.score, f.toleranceScore) : null,
                f.rows.length > 0 ? copy.disagreement[f.disagreement] : null,
              ]}
            />
            {f.rows.length > 0 && (
              <ul className="m-0 mb-2 grid list-none gap-3 p-0" data-testid="plan-goal-rows">
                {f.rows.map((r) => (
                  <li key={r.goalId}>
                    <Lines
                      lines={[
                        copy.goal.savedLine(r, fmt),
                        r.savedSource === "stated" && r.scheduleFrom !== null
                          ? copy.goal.statedAsOf(r.scheduleFrom, fmt)
                          : null,
                        copy.goal.gapLine(r, fmt),
                        copy.goal.scheduleLine(r, fmt) ?? copy.goal.undated,
                        copy.goal.scheduleSpan(r, fmt),
                        ...copy.goal.requiredLine(r, fmt),
                        copy.goal.sharedLine(r.sharedWithGoals, r.savedCents, fmt),
                        copy.goal.excludedLine(r.linkedExcludedCount),
                        copy.goal.brokerLine(r.brokerRefsNotCounted),
                      ]}
                    />
                  </li>
                ))}
              </ul>
            )}
            {f.study !== null && <Lines lines={[copy.studyLine(f.study, fmt)]} />}
          </div>
        ),
        assumptions:
          f.rows.length === 0 && !showStudy ? null : (
            <div>
              {f.rows.length === 0 ? (
                <p className="m-0 mb-2">{a.goals.noRows}</p>
              ) : (
                <Group title={a.groups.yourFigures}>
                  {f.rows.map((r) => {
                    const goal = goals.find((g) => g.value.id === r.goalId)?.value;
                    return goal === undefined ? null : (
                      <GoalEditor key={r.goalId} row={r} goal={goal} ctx={ctx} />
                    );
                  })}
                </Group>
              )}
              {showStudy && <StudyForm ctx={ctx} />}
            </div>
          ),
        howCalculated: <CalcList section="goals" result={result} />,
        sources:
          learn === null ? null : (
            <div data-testid="plan-learn-short-horizon">
              <p className="m-0 font-semibold">{copy.learnShortHorizon.title}</p>
              <Sources lines={[learn]} />
            </div>
          ),
      }}
    </SectionCard>
  );
}
