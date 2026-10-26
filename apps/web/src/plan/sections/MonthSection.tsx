import type { MonthFigures } from "@lavega/core";
import { DASH, factLine, monthCopy } from "../../copy/plan/index.js";
import SectionCard from "../SectionCard.js";
import { CalcList, Rows, Sources, StatusBody, useSectionCopy } from "./common.js";
import type { SectionProps } from "./types.js";

/** Section 1: the user's own last months. Figures only: nothing in it is a
 *  setting, so there are no assumptions to edit. */
export default function MonthSection({ result, ctx }: SectionProps<MonthFigures>) {
  const { locale, fmt } = useSectionCopy();
  const copy = monthCopy[locale];
  const f = result.figures;
  const l = copy.labels;
  const room = f.room;
  const rows = [
    {
      key: "room",
      label: l.room,
      value: copy.headline(f, fmt) === DASH ? null : copy.headline(f, fmt),
    },
    ...(room.kind === "computed"
      ? [
          { key: "low", label: l.lowMonth, value: fmt.eur(room.lowCents) },
          { key: "middle", label: l.middleMonth, value: fmt.eur(room.middleCents) },
          { key: "high", label: l.highMonth, value: fmt.eur(room.highCents) },
        ]
      : []),
    { key: "fixed", label: l.fixed, value: f.fixedCents === null ? null : fmt.eur(f.fixedCents) },
    {
      key: "variable",
      label: l.variable,
      value: f.variableCents === null ? null : fmt.eur(f.variableCents),
    },
    {
      key: "rate",
      label: l.savingsRate,
      value: f.savingsRate === null ? null : fmt.pct(f.savingsRate),
    },
    {
      key: "moved",
      label: l.savingsMoved,
      value: f.savingsMovedCents === null ? null : fmt.eur(f.savingsMovedCents),
    },
  ];
  const guidance = factLine("nibud-save-10pct", copy.facts.nibudGuidance, ctx.publicFacts);
  return (
    <SectionCard section="month" result={result}>
      {{
        figures: (
          <div>
            <StatusBody section="month" result={result} ctx={ctx} />
            <Rows rows={result.status === "not-enough-data" && room.kind === "none" ? [] : rows} />
          </div>
        ),
        assumptions: null,
        howCalculated: <CalcList section="month" result={result} />,
        sources: <Sources lines={[guidance]} />,
      }}
    </SectionCard>
  );
}
