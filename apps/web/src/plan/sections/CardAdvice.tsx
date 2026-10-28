import type { CardAdvice, CardOption, SourceRef } from "@lavega/core";
import { cardAdviceCopy } from "../../copy/cardAdvice.js";
import { useSectionCopy } from "./common.js";

/** How many ranked cards are listed; the user's own cards are always listed too. */
const SHOWN = 5;

function Sources({ sources }: { sources: readonly SourceRef[] }) {
  const { locale, fmt } = useSectionCopy();
  const c = cardAdviceCopy[locale];
  if (sources.length === 0) return null;
  return (
    <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-muted text-[0.8rem]">
      {sources.map((s) => (
        <li key={`${s.field}-${s.sourceUrl ?? ""}`}>
          {c.sourceLine(s, fmt)}
          {s.sourceUrl === null ? null : (
            <>
              {", "}
              <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">
                {c.sourceLink}
              </a>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function Calc({ lines, children }: { lines: readonly string[]; children?: React.ReactNode }) {
  const { locale } = useSectionCopy();
  const c = cardAdviceCopy[locale];
  return (
    <details className="mt-1 text-[0.85rem]" data-testid="plan-card-how">
      <summary>{c.howTitle}</summary>
      <ul className="m-0 mt-1 grid list-none gap-1 p-0">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {children}
    </details>
  );
}

function Ranked({ advice }: { advice: CardAdvice }) {
  const { locale, fmt } = useSectionCopy();
  const c = cardAdviceCopy[locale];
  const top = advice.options.slice(0, SHOWN);
  const heldExtra = advice.options.slice(SHOWN).filter((o) => o.held);
  const rows: CardOption[] = [...top, ...heldExtra];
  return (
    <>
      <h5 className="m-0 mt-2 mb-1 text-[0.85rem] font-semibold">{c.rankedTitle}</h5>
      <ol className="m-0 grid gap-2 pl-5 text-[0.9rem]" data-testid="plan-card-ranking">
        {rows.map((o) => (
          <li key={o.cardId} data-testid="plan-card-option">
            <span>{c.optionLine(o, advice, fmt)}</span>
            {o.pointsUnvalued && (
              <span className="block text-muted text-[0.8rem]">{c.unvaluedPoints}</span>
            )}
            <Calc lines={[c.spendCalc(advice, fmt), ...c.optionCalc(o, advice, fmt)]}>
              <Sources sources={o.sources} />
              {o.feeConditions !== null && o.feeNote !== null && (
                <details className="mt-1 text-muted text-[0.75rem]">
                  <summary>{c.conditionsTitle}</summary>
                  <span lang="nl" className="block">
                    {o.feeConditions}
                  </span>
                </details>
              )}
            </Calc>
          </li>
        ))}
      </ol>
      <ul className="m-0 mt-2 grid list-none gap-1 p-0 text-muted text-[0.8rem]">
        {c.caveats.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {advice.notComparable.length > 0 && (
        <details className="mt-2 text-[0.85rem]" data-testid="plan-card-not-comparable">
          <summary>{c.notComparableTitle(advice.notComparable.length)}</summary>
          <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-muted">
            {advice.notComparable.map((o) => (
              <li key={o.cardId}>{c.notComparableLine(o)}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** The recommendations of "Kaarten en punten": which card nets most at the
 *  user's own spending, what a revolving balance costs, what the points are
 *  worth. Everything comes from `advice`; nothing is computed here. */
export default function CardAdviceBlock({ advice }: { advice: CardAdvice }) {
  const { locale, fmt } = useSectionCopy();
  const c = cardAdviceCopy[locale];
  const hasOptions = advice.state === "ok" && advice.options.length > 0;
  return (
    <div data-testid="plan-card-advice" className="mb-3">
      <h4 className="m-0 mb-1 text-[0.9rem] font-semibold">{c.title}</h4>
      {hasOptions ? (
        <>
          <p className="m-0 text-[0.95rem] font-semibold" data-testid="plan-card-verdict">
            {c.verdict(advice, fmt)}
          </p>
          {advice.ignoresInterest && (
            <p className="m-0 mt-1 text-[0.85rem]" data-testid="plan-card-interest-ignored">
              {c.interestIgnored}
            </p>
          )}
          <Ranked advice={advice} />
        </>
      ) : (
        <p className="m-0 text-[0.9rem]" data-testid="plan-card-verdict">
          {c.noAdvice(advice, fmt)}
        </p>
      )}
      {advice.interest.map((i) => (
        <div key={i.cardId} className="mt-3" data-testid="plan-card-interest">
          <h5 className="m-0 mb-1 text-[0.85rem] font-semibold">{c.interestTitle(i)}</h5>
          {c.interestLines(i, fmt).map((l) => (
            <p key={l} className="m-0 mb-1 text-[0.9rem]">
              {l}
            </p>
          ))}
          <Calc lines={c.interestCalc(i, fmt)}>
            {i.savingsRate?.sourceUrl ? (
              <ul className="m-0 mt-1 list-none p-0 text-muted text-[0.8rem]">
                <li>
                  <a href={i.savingsRate.sourceUrl} target="_blank" rel="noopener noreferrer">
                    {i.savingsRate.bank} {i.savingsRate.product}
                  </a>
                  {i.savingsRate.asOf === null ? "" : `, ${fmt.date(i.savingsRate.asOf)}`}
                </li>
              </ul>
            ) : null}
          </Calc>
        </div>
      ))}
      {advice.points.length > 0 && (
        <div className="mt-3" data-testid="plan-card-points">
          <h5 className="m-0 mb-1 text-[0.85rem] font-semibold">{c.pointsTitle}</h5>
          {advice.points.map((p) => (
            <div key={p.programId} className="mb-2">
              {c.pointsLines(p, fmt).map((l) => (
                <p key={l} className="m-0 mb-1 text-[0.9rem]">
                  {l}
                </p>
              ))}
              <Calc lines={c.pointsCalc(p, fmt)}>
                {p.valuation?.sourceUrl ? (
                  <ul className="m-0 mt-1 list-none p-0 text-muted text-[0.8rem]">
                    <li>
                      <a href={p.valuation.sourceUrl} target="_blank" rel="noopener noreferrer">
                        {c.pointsLinkNote}
                      </a>
                      {p.valuation.asOf === null ? "" : `, ${fmt.date(p.valuation.asOf)}`}
                    </li>
                  </ul>
                ) : null}
              </Calc>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
