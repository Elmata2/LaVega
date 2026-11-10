import { type FigureValue, type PlanBackbone, type PublicFact } from "@lavega/core";
import { useAppLocale } from "../appLocale.js";
import Card from "../components/ui/Card.js";
import { factLine, planFmt, planShellCopy } from "../copy/plan/index.js";
import { formatFigure } from "./planFormat.js";

/** The four parts the page shows figures for. Not an order and not a route:
 *  the same general sentence for everyone, then one line per part from the
 *  user's own section, or "cannot be calculated yet". A sentence about the
 *  order of the parts appears only from the verified AFM fact (`fromFact`),
 *  and only when that fact is showable. */
export default function BackboneStrip({
  backbone,
  publicFacts,
}: {
  backbone: PlanBackbone;
  /** Test seam: the verified facts to read. Default is PUBLIC_FACTS. */
  publicFacts?: readonly PublicFact[];
}) {
  const [locale] = useAppLocale();
  const shell = planShellCopy[locale];
  const b = shell.backbone;
  const fmt = planFmt(locale);
  const fig = (v: FigureValue | null): string | null =>
    v === null || v.value === null ? null : formatFigure(v.value, v.unit, fmt, shell.noFigure);
  const range =
    backbone.investingUnallocated === null
      ? null
      : typeof backbone.investingUnallocated.low.value === "number" &&
          typeof backbone.investingUnallocated.high.value === "number"
        ? fmt.eurRange(
            backbone.investingUnallocated.low.value,
            backbone.investingUnallocated.high.value,
          )
        : null;
  const lines: { key: string; text: string }[] = [
    { key: "buffer", figure: fig(backbone.buffer) },
    { key: "debt", figure: fig(backbone.debtInterestPerYear) },
    { key: "goals", figure: fig(backbone.goalsGap) },
    { key: "investing", figure: range },
  ].map(({ key, figure }) => {
    const step = b.steps[key as keyof typeof b.steps];
    return { key, text: figure === null ? step.empty : step.fact(figure) };
  });
  const fromFact = factLine("afm-backbone", b.fromFact, publicFacts);
  return (
    <Card as="section" aria-label={b.heading} data-testid="plan-backbone">
      <h3 className="m-0 mb-2">{b.heading}</h3>
      <p className="m-0 mb-2" data-testid="plan-backbone-neutral">
        {b.neutral}
      </p>
      {fromFact !== null && (
        <p className="m-0 mb-2" data-testid="plan-backbone-fact">
          {fromFact}
        </p>
      )}
      <ul className="m-0 grid list-none gap-1 p-0 text-[0.9rem]">
        {lines.map((l) => (
          <li key={l.key} data-testid={`plan-backbone-${l.key}`}>
            {l.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}
