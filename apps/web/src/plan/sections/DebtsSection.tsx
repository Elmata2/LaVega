import type { DebtFigures } from "@lavega/core";
import { debtsCopy, factLine } from "../../copy/plan/index.js";
import SectionCard from "../SectionCard.js";
import {
  CalcList,
  Group,
  Lines,
  Rows,
  Sources,
  StatusBody,
  ValueInput,
  useSectionCopy,
} from "./common.js";
import { centsText, parseEuros, parseNumber } from "./parse.js";
import { applyDebtEdit, dropKey, saveProfile } from "./profileEdits.js";
import type { SectionProps } from "./types.js";

/** Section 3: the debts in the profile, their cost and the effect of an extra
 *  payment the person types. Lender names are the person's own text. */
export default function DebtsSection({ result, ctx }: SectionProps<DebtFigures>) {
  const { locale, fmt, a } = useSectionCopy();
  const copy = debtsCopy[locale];
  const f = result.figures;
  const extra = ctx.plan.preferences.extraDebtPayment;
  const duo = factLine("duo-rules", copy.facts.duoRules, ctx.publicFacts);

  return (
    <SectionCard section="debts" result={result}>
      {{
        figures: (
          <div>
            <StatusBody section="debts" result={result} ctx={ctx} />
            {f.totalInterestPerYearCents !== null && f.rows.length > 0 && (
              <Rows
                rows={[
                  {
                    key: "interest",
                    label: copy.labels.interestPerYear,
                    value: fmt.eur(f.totalInterestPerYearCents),
                  },
                ]}
              />
            )}
            {f.rows.length > 0 && (
              <ul className="m-0 mb-2 grid list-none gap-3 p-0" data-testid="plan-debt-rows">
                {f.rows.map((r) => (
                  <li key={r.id}>
                    <Lines
                      lines={[
                        copy.rowCost(r, fmt),
                        r.balanceCents === null
                          ? null
                          : `${copy.labels.balance}: ${fmt.eur(r.balanceCents)}.`,
                        r.payoffReason === null
                          ? copy.rowPayoff(r, fmt)
                          : copy.payoffReason[r.payoffReason],
                        copy.rowExtra(r, fmt),
                        r.rateSource === null ? null : copy.rateSource[r.rateSource],
                        copy.kindLabel[r.kind],
                        r.kind === "duo" ? duo : null,
                      ]}
                    />
                    {r.ratePct === null && (
                      <ValueInput
                        name={`debt-rate-${r.id}`}
                        label={a.debts.rateLabel(r.lender)}
                        hint={a.debts.rateHint}
                        stored=""
                        parse={(t) => parseNumber(t, { min: 0, max: 100, maxDecimals: 2 })}
                        onSave={(ratePct) =>
                          saveProfile(ctx, (p) => applyDebtEdit(p, r.id, { ratePct }, ctx.asOf))
                        }
                      />
                    )}
                    {r.balanceCents === null && (
                      <ValueInput
                        name={`debt-balance-${r.id}`}
                        label={a.debts.balanceLabel(r.lender)}
                        hint={a.debts.balanceHint}
                        stored=""
                        parse={(t) => parseEuros(t)}
                        onSave={(balanceCents) =>
                          saveProfile(ctx, (p) =>
                            applyDebtEdit(p, r.id, { balanceCents }, ctx.asOf),
                          )
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Lines
              lines={[
                f.savingsRatePct === null
                  ? null
                  : copy.savingsRateLine(fmt.points(f.savingsRatePct)),
                copy.invisibleDebt,
              ]}
            />
          </div>
        ),
        assumptions:
          f.rows.length === 0 ? null : (
            <Group title={a.groups.yourFigures}>
              {f.rows.map((r) => (
                <ValueInput
                  key={r.id}
                  name={`debt-extra-${r.id}`}
                  label={a.debts.extraLabel(r.lender)}
                  hint={a.debts.extraHint}
                  stored={extra[r.id] === undefined ? "" : centsText(extra[r.id]!.cents)}
                  parse={(t) => parseEuros(t)}
                  onSave={(cents) =>
                    ctx.plan.setPreference((cur) => ({
                      extraDebtPayment: {
                        ...cur.extraDebtPayment,
                        [r.id]: { cents, at: ctx.asOf },
                      },
                    }))
                  }
                  onClear={() =>
                    ctx.plan.setPreference((cur) => ({
                      extraDebtPayment: dropKey(cur.extraDebtPayment, r.id),
                    }))
                  }
                />
              ))}
            </Group>
          ),
        howCalculated: <CalcList section="debts" result={result} />,
        sources: <Sources lines={[duo]} />,
      }}
    </SectionCard>
  );
}
