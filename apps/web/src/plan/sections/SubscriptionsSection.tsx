import { useState } from "react";
import {
  hash,
  isoMonth,
  subscriptionStateOf,
  type SubRow,
  type SubscriptionDecision,
  type SubsFigures,
  type UsageLog,
} from "@lavega/core";
import Button from "../../components/ui/Button.js";
import { subscriptionsCopy } from "../../copy/plan/index.js";
import { nowIso } from "../clock.js";
import SectionCard from "../SectionCard.js";
import { CalcList, Lines, Rows, StatusBody, useSectionCopy } from "./common.js";
import type { PlanCtx, SectionProps } from "./types.js";

const DECISIONS = ["keep", "review", "cancel"] as const;

const unique = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

/** One recognised subscription. The three notes start unselected and show only
 *  what the event log says; "used this month" adds at most one entry a month. */
function SubRowView({ row, ctx, group }: { row: SubRow; ctx: PlanCtx; group: SubRow[] }) {
  const { locale, fmt, a } = useSectionCopy();
  const copy = subscriptionsCopy[locale];
  const [failed, setFailed] = useState(false);
  const month = isoMonth(ctx.asOf);
  const logged =
    subscriptionStateOf(ctx.plan.events).get(row.key)?.usedMonths.includes(month) ?? false;

  async function append(make: (at: string) => SubscriptionDecision | UsageLog) {
    try {
      await ctx.plan.appendPlanEvent(make(await nowIso()));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  const decide = (d: SubscriptionDecision["decision"]) =>
    append((at) => ({
      id: `dec-${hash(row.key)}-${unique()}`,
      kind: "subscription-decision",
      at,
      streamKey: row.key,
      decision: d,
    }));
  const useNow = () =>
    logged
      ? Promise.resolve()
      : append((at) => ({
          id: `use-${hash(row.key)}-${month}`,
          kind: "usage-log",
          at,
          streamKey: row.key,
          month,
        }));

  const fn = a.subs.functions[row.function] ?? a.subs.otherFunction;
  return (
    <li data-testid="plan-sub-row">
      <p className="m-0 font-semibold">{row.name}</p>
      <Rows
        rows={[
          { key: "m", label: copy.labels.perMonth, value: fmt.eurExact(row.monthlyCents) },
          { key: "y", label: copy.labels.perYear, value: fmt.eur(row.yearlyCents) },
          { key: "a", label: copy.labels.monthsActive, value: fmt.count(row.monthsActive) },
        ]}
      />
      <Lines
        lines={[
          copy.priceUp(row, fmt),
          row.overlapGroup !== null && row.overlapCombinedMonthlyCents !== null
            ? copy.overlap(group.length, fn, fmt.eur(row.overlapCombinedMonthlyCents))
            : null,
          row.facts.includes("no-use-logged") ? copy.noUseLogged(fmt.eur(row.yearlyCents)) : null,
          row.facts.includes("missed-payment") ? copy.missedPayment(row.skippedCycles) : null,
          copy.usageLine(row, fmt),
        ]}
      />
      <div
        role="group"
        aria-label={a.subs.decisionGroup(row.name)}
        className="mt-1 flex flex-wrap gap-2"
      >
        {DECISIONS.map((d) => (
          <Button
            key={d}
            aria-pressed={row.decision === d}
            data-testid={`plan-sub-decision-${d}`}
            className="aria-pressed:border-accent"
            onClick={() => void decide(row.decision === d ? "clear" : d)}
          >
            {copy.decisions[d]}
          </Button>
        ))}
        <Button data-testid="plan-sub-used" disabled={logged} onClick={() => void useNow()}>
          {logged ? a.subs.usedLogged : a.subs.usedThisMonth}
        </Button>
      </div>
      {failed && (
        <p role="alert" className="m-0 text-warn text-[0.85rem]">
          {a.saveFailed}
        </p>
      )}
    </li>
  );
}

/** Section 5: recognised subscriptions, listed by name. The person's own notes
 *  come only from the event log; none is pre-selected. */
export default function SubscriptionsSection({ result, ctx }: SectionProps<SubsFigures>) {
  const { locale, fmt, a } = useSectionCopy();
  const copy = subscriptionsCopy[locale];
  const f = result.figures;
  const rows = [...f.rows].sort((x, y) => x.name.localeCompare(y.name, locale));
  return (
    <SectionCard section="subscriptions" result={result}>
      {{
        figures: (
          <div>
            <StatusBody section="subscriptions" result={result} ctx={ctx} />
            {rows.length > 0 && (
              <>
                <Rows
                  rows={[
                    {
                      key: "m",
                      label: `${copy.labels.total}, ${copy.labels.perMonth}`,
                      value: fmt.eur(f.totalMonthlyCents),
                    },
                    {
                      key: "y",
                      label: `${copy.labels.total}, ${copy.labels.perYear}`,
                      value: fmt.eur(f.totalYearlyCents),
                    },
                  ]}
                />
                <ul className="m-0 mb-2 grid list-none gap-4 p-0" data-testid="plan-sub-rows">
                  {rows.map((r) => (
                    <SubRowView
                      key={r.key}
                      row={r}
                      ctx={ctx}
                      group={rows.filter(
                        (x) => r.overlapGroup !== null && x.overlapGroup === r.overlapGroup,
                      )}
                    />
                  ))}
                </ul>
                <Lines
                  lines={[
                    f.whatIfCancelYearlyCents > 0
                      ? copy.whatIf(
                          fmt.eur(f.whatIfCancelMonthlyCents),
                          fmt.eur(f.whatIfCancelYearlyCents),
                        )
                      : null,
                    f.excludedForeignCount > 0
                      ? a.subs.foreignExcluded(f.excludedForeignCount)
                      : null,
                    copy.manualAdd,
                  ]}
                />
              </>
            )}
          </div>
        ),
        assumptions: null,
        howCalculated: <CalcList section="subscriptions" result={result} />,
        sources: null,
      }}
    </SectionCard>
  );
}
