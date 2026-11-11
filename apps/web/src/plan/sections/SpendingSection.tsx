import type { BudgetLineState, SpendingFigures } from "@lavega/core";
import { categoryLabel } from "../../copy/money.js";
import { DASH, PLAN_NUMBERS, factLine, spendingCopy } from "../../copy/plan/index.js";
import { Table, TableWrap, Td, Th } from "../../components/ui/Table.js";
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
import { centsText, parseEuros } from "./parse.js";
import type { SectionProps } from "./types.js";

/** Section 4: spending per category against the person's own months and the
 *  limits they typed. Rows are in alphabetical order of the category name as
 *  shown; no row is ranked or marked. */
export default function SpendingSection({ result, ctx }: SectionProps<SpendingFigures>) {
  const { locale, fmt, a } = useSectionCopy();
  const copy = spendingCopy[locale];
  const f = result.figures;
  const limits = ctx.plan.preferences.categoryLimits;
  // The envelope the plan read: allocation, the surplus the previous month left,
  // and what is left in it. Null without an initialized month, so the table does
  // not grow a column for a budget that does not exist.
  const budget = f.budget;
  const budgetLines = new Map<string, BudgetLineState>(
    budget === null
      ? []
      : [...budget.groups.flatMap((g) => g.lines), ...budget.topLevel].map((l) => [l.category, l]),
  );
  /** What the limit input shows: the legacy record when it exists, else the
   *  envelope line the same category already has. Empty when neither exists. */
  const storedLimit = (category: string): string => {
    const cents = limits[category]?.cents ?? budgetLines.get(category)?.allocationCents;
    return cents === undefined ? "" : centsText(cents);
  };
  const rows = f.rows
    .map((r) => ({ r, name: categoryLabel(locale, r.category) }))
    .sort((x, y) => x.name.localeCompare(y.name, locale));
  const reference = factLine(
    "spending-reference-budget",
    copy.facts.referenceBudget,
    ctx.publicFacts,
  );

  return (
    <SectionCard section="spending" result={result}>
      {{
        figures: (
          <div>
            <StatusBody section="spending" result={result} ctx={ctx} />
            {rows.length > 0 && (
              <TableWrap>
                <Table data-testid="plan-spending-table">
                  <thead>
                    <tr>
                      <Th scope="col">{copy.labels.category}</Th>
                      <Th scope="col" numeric>
                        {a.spending.columns.lastMonth}
                      </Th>
                      <Th scope="col" numeric>
                        {a.spending.columns.avg3}
                      </Th>
                      <Th scope="col" numeric>
                        {a.spending.columns.median}
                      </Th>
                      <Th scope="col" numeric>
                        {copy.labels.percentile}
                      </Th>
                      <Th scope="col" numeric>
                        {a.spending.columns.limit}
                      </Th>
                      {budget !== null && (
                        <>
                          <Th scope="col" numeric>
                            {copy.labels.budget}
                          </Th>
                          <Th scope="col" numeric>
                            {copy.labels.carriedIn}
                          </Th>
                          <Th scope="col" numeric>
                            {copy.labels.remaining}
                          </Th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ r, name }) => (
                      <tr key={r.category} data-testid="plan-spending-row">
                        <Th scope="row">{name}</Th>
                        <Td numeric>{fmt.eur(r.lastMonthCents)}</Td>
                        <Td numeric>{fmt.eur(r.avg3Cents)}</Td>
                        <Td numeric>
                          {r.median12Cents === null ? DASH : fmt.eur(r.median12Cents)}
                        </Td>
                        <Td numeric>{r.percentile === null ? DASH : fmt.pct(r.percentile)}</Td>
                        <Td numeric>{r.limitCents === null ? DASH : fmt.eurExact(r.limitCents)}</Td>
                        {budget !== null && (
                          <>
                            <Td numeric>
                              {budgetLines.get(r.category) === undefined
                                ? DASH
                                : fmt.eurExact(budgetLines.get(r.category)!.allocationCents)}
                            </Td>
                            <Td numeric>
                              {budgetLines.get(r.category) === undefined ||
                              budgetLines.get(r.category)!.carryInCents === 0
                                ? DASH
                                : fmt.eurExact(budgetLines.get(r.category)!.carryInCents)}
                            </Td>
                            <Td numeric>
                              {budgetLines.get(r.category) === undefined
                                ? DASH
                                : fmt.eurExact(budgetLines.get(r.category)!.remainingCents)}
                            </Td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            )}
            <Lines
              lines={[
                f.months < PLAN_NUMBERS.spendingMonths && rows.length > 0
                  ? copy.needsSixMonths
                  : null,
                ...rows.flatMap(({ r, name }) => [
                  r.limitCents !== null && r.overLimitMonths > 0
                    ? copy.limitLine(name, fmt.eurExact(r.limitCents), r.overLimitMonths)
                    : null,
                  budgetLines.get(r.category) !== undefined &&
                  budgetLines.get(r.category)!.carryInCents > 0
                    ? copy.carryLine(name, fmt.eurExact(budgetLines.get(r.category)!.carryInCents))
                    : null,
                ]),
                budget === null
                  ? null
                  : copy.budgetLine(
                      fmt.monthLabel(budget.month),
                      fmt.eurExact(budget.budgetedSpendingCents),
                      fmt.eurExact(budget.carryInCents),
                    ),
              ]}
            />
          </div>
        ),
        assumptions:
          rows.length === 0 ? null : (
            <Group title={a.groups.yourFigures}>
              {rows.map(({ r, name }) => (
                <ValueInput
                  key={r.category}
                  name={`limit-${r.category}`}
                  label={a.spending.limitLabel(name)}
                  hint={a.spending.limitHint}
                  stored={storedLimit(r.category)}
                  parse={(t) => parseEuros(t)}
                  onSave={(cents) => ctx.plan.setLimit(r.category, cents)}
                  onClear={() => ctx.plan.setLimit(r.category, null)}
                />
              ))}
            </Group>
          ),
        howCalculated: <CalcList section="spending" result={result} />,
        sources: <Sources lines={[reference]} />,
      }}
    </SectionCard>
  );
}
