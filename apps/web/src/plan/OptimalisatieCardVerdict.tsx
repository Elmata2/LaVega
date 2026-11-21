import { CARD_ADVICE_MIN_GAIN_CENTS, type CardAdvice } from "@lavega/core";
import type { ReactNode } from "react";
import { cardAdviceCopy } from "../copy/cardAdvice.js";
import { optimiseCopy } from "../copy/optimise.js";
import { formatEuroIn } from "../format.js";
import { CardCaveats, CardInterest, CardVerdictLines, Identify } from "./sections/CardAdvice.js";
import { useSectionCopy } from "./sections/common.js";

/** The credit-card part of Optimalisatie. It prints the plan's own card advice
 *  (`plan.sections.cards.figures.advice`) and computes nothing: the same card,
 *  the same euro figure and the same lines as "Jouw plan". */
export default function OptimalisatieCardVerdict({
  advice,
  onIdentify,
  moreLink,
}: {
  advice: CardAdvice;
  /** Stores the card the user names on a connected account. Absent: no question. */
  onIdentify?: (accountKey: string, cardId: string) => Promise<void> | void;
  /** A link to where more data is connected; shown when there is no spend. */
  moreLink?: ReactNode;
}) {
  const { locale, fmt } = useSectionCopy();
  const c = cardAdviceCopy[locale];
  const o = optimiseCopy[locale].optimalisatie.cashback;
  const v = advice.verdict;
  const hasOptions = advice.state === "ok" && advice.options.length > 0;
  const toIdentify =
    onIdentify === undefined || advice.baseline.kind !== "unknown"
      ? []
      : advice.baseline.blockers.flatMap((b) =>
          b.accountKey === undefined ? [] : [{ accountKey: b.accountKey, label: b.name ?? "" }],
        );

  const statedLine = hasOptions && advice.basis === "stated" && (
    <p className="cell-sub" data-testid="plan-card-basis-stated">
      {c.basisStated}
    </p>
  );
  let body: ReactNode;
  if (!hasOptions || v.kind === "no-options") {
    body = (
      <p className="block-empty" data-testid="plan-card-verdict">
        {c.noAdvice(advice, fmt)}
        {(advice.state === "no-spend" || advice.state === "short-history") && moreLink}
      </p>
    );
  } else if (v.kind === "switch") {
    body = (
      <>
        <p className="m-0 font-body text-[1.25rem] text-ink" data-testid="plan-card-verdict">
          {c.verdict(advice, fmt)}
        </p>
        {statedLine}
        <CardVerdictLines verdict={v} locale={locale} />
      </>
    );
  } else if (v.kind === "no-card-worth-it") {
    body = (
      <>
        <p className="block-empty" data-testid="plan-card-verdict">
          {o.stated.firstCard.notWorthIt(formatEuroIn(locale, CARD_ADVICE_MIN_GAIN_CENTS / 100))}
        </p>
        {statedLine}
      </>
    );
  } else {
    // keep, unknown-baseline: the plan's own sentence.
    body = (
      <>
        <p className="block-empty" data-testid="plan-card-verdict">
          {c.verdict(advice, fmt)}
        </p>
        {statedLine}
      </>
    );
  }

  return (
    <div data-testid="optimalisatie-card-verdict" style={{ marginTop: "var(--sp-4)" }}>
      {advice.ignoresInterest && <CardInterest advice={advice} />}
      {body}
      {advice.ignoresInterest && hasOptions && (
        <p className="cell-sub" data-testid="plan-card-interest-ignored">
          {c.interestIgnored}
        </p>
      )}
      {/* The "geen financieel advies" line is the page's own footer (Optimalisatie.tsx,
          `optimalisatie-disclaimer`); it is not repeated here. */}
      {hasOptions && <CardCaveats />}
      {toIdentify.map((u) => (
        <Identify key={u.accountKey} {...u} onIdentify={onIdentify!} />
      ))}
    </div>
  );
}
