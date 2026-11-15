import { useId, useState, type ReactNode } from "react";
import type { SectionId, SectionResult } from "@lavega/core";
import { useAppLocale } from "../appLocale.js";
import CardLink from "../components/ui/CardLink.js";
import Card from "../components/ui/Card.js";
import { planFmt, planShellCopy } from "../copy/plan/index.js";
import { frameCopyOf } from "./sectionCopy.js";
import StatusChip from "./StatusChip.js";

export type SectionCardParts = {
  figures: ReactNode;
  assumptions: ReactNode;
  /** SEAM FOR THE AI LAYER: when given, this replaces the template
   *  explanation. Nothing else in the frame changes. */
  explanation?: ReactNode;
  howCalculated: ReactNode;
  sources: ReactNode;
};

export type SectionCardProps = {
  section: SectionId;
  result: SectionResult<unknown>;
  children: SectionCardParts;
};

const filled = (n: ReactNode): boolean => n !== null && n !== undefined && n !== false;

/** The same plain explanation for everyone, written from the figures by the
 *  section's copy. Simple or detailed, and a way to say whether it helped.
 *  No AI involved, so no AI disclosure. */
export function TemplateExplanation({
  section,
  figures,
}: {
  section: SectionId;
  figures: unknown;
}) {
  const [locale] = useAppLocale();
  const shell = planShellCopy[locale];
  const copy = frameCopyOf(locale, section);
  const fmt = planFmt(locale);
  const [detailed, setDetailed] = useState(false);
  const [vote, setVote] = useState<"helped" | "not" | null>(null);
  const lines = (detailed ? copy.explain.detailed : copy.explain.simple)(figures, fmt);
  if (lines.length === 0) return null;
  return (
    <div data-testid="plan-template-explanation">
      {lines.map((l, i) => (
        <p key={`${i}-${l}`} className="m-0 mb-2">
          {l}
        </p>
      ))}
      <div className="flex flex-wrap gap-4 text-[0.85rem]">
        <CardLink data-testid="plan-explain-toggle" onClick={() => setDetailed((d) => !d)}>
          {detailed ? shell.explainControls.simpler : shell.explainControls.moreDetail}
        </CardLink>
        <CardLink
          aria-pressed={vote === "helped"}
          data-testid="plan-explain-helped"
          onClick={() => setVote("helped")}
        >
          {shell.explainControls.helped}
        </CardLink>
        <CardLink
          aria-pressed={vote === "not"}
          data-testid="plan-explain-not-helped"
          onClick={() => setVote("not")}
        >
          {shell.explainControls.notHelped}
        </CardLink>
      </div>
    </div>
  );
}

/** One section of the plan: a closed card with title, status chip and headline
 *  figure. Cards start CLOSED whatever the status (builder choice, spec 17):
 *  the page is a list a reader scans first, and an open card per attention
 *  status would push the other six below the fold. The expanded order is
 *  fixed here: figures, assumptions, explanation, how we calculated, sources.
 *  No motion: the body appears and disappears. */
export default function SectionCard({ section, result, children }: SectionCardProps) {
  const [locale] = useAppLocale();
  const shell = planShellCopy[locale];
  const copy = frameCopyOf(locale, section);
  const fmt = planFmt(locale);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const title = shell.sectionTitles[section];

  const templateLines = copy.explain.simple(result.figures, fmt);
  const explanation = filled(children.explanation) ? (
    children.explanation
  ) : templateLines.length > 0 ? (
    <TemplateExplanation section={section} figures={result.figures} />
  ) : null;

  const parts: [keyof typeof shell.cardParts, ReactNode][] = [
    ["figures", children.figures],
    ["assumptions", children.assumptions],
    ["explanation", explanation],
    ["howCalculated", children.howCalculated],
    ["sources", children.sources],
  ];

  return (
    <Card as="section" aria-label={title} data-testid={`plan-card-${section}`}>
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-none bg-transparent p-0 text-left font-[inherit] text-[inherit]"
        >
          <span className="font-semibold">{title}</span>
          <span className="flex items-baseline gap-3">
            <span className="text-muted" data-testid={`plan-headline-${section}`}>
              {copy.headline(result.figures, fmt)}
            </span>
            <StatusChip status={result.status} shell={shell} testId={`plan-status-${section}`} />
          </span>
        </button>
      </h3>
      <div id={bodyId} hidden={!open}>
        {open && (
          <div data-testid="plan-card-body" className="mt-4 grid gap-4">
            {parts.map(([key, node]) =>
              filled(node) ? (
                <div key={key} data-testid={`plan-part-${key}`}>
                  <h4 className="m-0 mb-1 text-[0.8rem] font-semibold uppercase tracking-[0.03em] text-muted">
                    {shell.cardParts[key]}
                  </h4>
                  {node}
                </div>
              ) : null,
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
