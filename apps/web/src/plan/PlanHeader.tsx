import type { PlanResult } from "@lavega/core";
import { useAppLocale } from "../appLocale.js";
import CardLink from "../components/ui/CardLink.js";
import { planFmt, planShellCopy } from "../copy/plan/index.js";

export const ASSUMPTIONS_ANCHOR = "plan-assumptions";

/** Title, the date the plan is as of, how fresh its inputs are, and two links:
 *  to what LaVega knows about you and to the assumptions. */
export default function PlanHeader({
  result,
  onOpenAboutYou,
}: {
  result: PlanResult;
  onOpenAboutYou: () => void;
}) {
  const [locale] = useAppLocale();
  const shell = planShellCopy[locale];
  const fmt = planFmt(locale);
  const { bankDataTo, profileConfirmedAt } = result.freshness;
  return (
    <header className="mb-[var(--sp-5)]" data-testid="plan-header">
      <h2 className="m-0 mb-1">{shell.title}</h2>
      <p className="m-0" data-testid="plan-date">
        {shell.header.planDate(fmt.date(result.asOf))}
      </p>
      <p className="m-0 text-muted text-[0.85rem]" data-testid="plan-freshness">
        {shell.header.freshness(
          bankDataTo === null ? null : fmt.date(bankDataTo),
          profileConfirmedAt === null ? null : fmt.date(profileConfirmedAt),
        )}
      </p>
      <p className="m-0 mt-2 flex flex-wrap gap-4">
        <CardLink data-testid="plan-link-about-you" onClick={onOpenAboutYou}>
          {shell.header.knowsLink}
        </CardLink>
        <CardLink
          data-testid="plan-link-assumptions"
          onClick={() => {
            const target = document.getElementById(ASSUMPTIONS_ANCHOR);
            target?.scrollIntoView?.();
            target?.focus();
          }}
        >
          {shell.header.assumptionsLink}
        </CardLink>
      </p>
    </header>
  );
}
