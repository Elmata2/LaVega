import type { BufferFigures } from "@lavega/core";
import { applyBuffer } from "../../intake/state.js";
import { bufferCopy, factLine, monthCopy } from "../../copy/plan/index.js";
import { centsText, parseEuros, parseNumber, parseWholeNumber } from "./parse.js";
import { saveProfile } from "./profileEdits.js";
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
import type { SectionProps } from "./types.js";

/** Section 2: two buffers that are never merged. The target and the top-up
 *  are the person's own, entered here; nothing is pre-filled. */
export default function BufferSection({ result, ctx }: SectionProps<BufferFigures>) {
  const { locale, fmt, a } = useSectionCopy();
  const copy = bufferCopy[locale];
  const f = result.figures;
  const l = copy.labels;
  const prefs = ctx.plan.preferences;
  const storedTarget = ctx.profile.store?.current.buffer?.value.months;
  const irregular = (ctx.profile.store?.current.incomeStreams ?? []).some((s) => !s.value.regular);

  const rows = [
    {
      key: "liquid",
      label: l.liquid,
      value: f.liquidSavingsCents === null ? null : fmt.eur(f.liquidSavingsCents),
    },
    {
      key: "fixed",
      label: monthCopy[locale].labels.fixed,
      value: f.fixedCostsMonthlyCents === null ? null : fmt.eur(f.fixedCostsMonthlyCents),
    },
    {
      key: "buffer",
      label: l.incomeBuffer,
      value: f.incomeBufferMonths === null ? null : copy.headline(f, fmt),
    },
    {
      key: "target",
      label: l.target,
      value: f.targetMonths === null ? null : fmt.monthsLabel(f.targetMonths),
    },
    {
      key: "gap",
      label: l.gap,
      value:
        f.gapMonths === null || f.gapCents === null
          ? null
          : `${fmt.monthsLabel(f.gapMonths)} (${fmt.eur(f.gapCents)})`,
    },
    {
      key: "object",
      label: l.objectBuffer,
      value: f.objectBufferCents === null ? null : fmt.eur(f.objectBufferCents),
    },
  ];
  const purpose = factLine("nibud-buffer-purpose", copy.facts.nibudPurpose, ctx.publicFacts);

  return (
    <SectionCard section="buffer" result={result}>
      {{
        figures: (
          <div>
            <StatusBody section="buffer" result={result} ctx={ctx} />
            <Rows rows={rows} />
            <Lines
              lines={[
                f.targetMonths !== null && f.fixedCostsMonthlyCents !== null
                  ? copy.targetInEuros(
                      fmt.months(f.targetMonths),
                      fmt.eur(Math.round(f.targetMonths * f.fixedCostsMonthlyCents)),
                    )
                  : null,
                copy.closeExample(f, fmt),
                copy.statedOverlapNote(f.statedOverlapGoalCount),
                irregular ? copy.irregularIncome : null,
              ]}
            />
          </div>
        ),
        assumptions: (
          <Group title={a.groups.yourFigures}>
            <ValueInput
              name="buffer-target"
              label={a.buffer.targetLabel}
              hint={a.buffer.targetHint}
              stored={storedTarget === undefined ? "" : String(storedTarget)}
              parse={(t) => parseNumber(t, { min: 0, max: 60, maxDecimals: 1 })}
              onSave={(months) => saveProfile(ctx, (p) => applyBuffer(p, months, ctx.asOf))}
            />
            <ValueInput
              name="buffer-topup"
              label={a.buffer.topUpLabel}
              hint={a.buffer.topUpHint}
              stored={
                prefs.bufferTopUpMonths === null ? "" : String(prefs.bufferTopUpMonths.months)
              }
              parse={(t) => parseWholeNumber(t, { min: 1, max: 120 })}
              onSave={(months) =>
                ctx.plan.setPreference({ bufferTopUpMonths: { months, at: ctx.asOf } })
              }
              onClear={() => ctx.plan.setPreference({ bufferTopUpMonths: null })}
            />
            <ValueInput
              name="buffer-calc"
              label={a.buffer.calcLabel}
              hint={a.buffer.calcHint}
              stored={
                prefs.nibudBufferResult === null ? "" : centsText(prefs.nibudBufferResult.cents)
              }
              parse={(t) => parseEuros(t)}
              onSave={(cents) =>
                ctx.plan.setPreference({ nibudBufferResult: { cents, at: ctx.asOf } })
              }
              onClear={() => ctx.plan.setPreference({ nibudBufferResult: null })}
            />
          </Group>
        ),
        howCalculated: <CalcList section="buffer" result={result} />,
        sources: <Sources lines={[purpose]} />,
      }}
    </SectionCard>
  );
}
