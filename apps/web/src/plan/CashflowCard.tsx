import { useId, useState, type ReactNode } from "react";
import { PLAN_THRESHOLDS, type CashflowResult } from "@lavega/core";
import Card from "../components/ui/Card.js";
import Button from "../components/ui/Button.js";
import CardLink from "../components/ui/CardLink.js";
import { cashflowCopy } from "../copy/plan/index.js";
import { applyChargesVat } from "../intake/state.js";
import { parseNumber } from "./sections/parse.js";
import { saveProfile } from "./sections/profileEdits.js";
import { Lines, Rows, Sources, ValueInput, useSectionCopy } from "./sections/common.js";
import type { PlanCtx } from "./sections/types.js";

/** The cash-flow card for irregular income: not one of the seven sections
 *  (it has no status or change-log entry), but it follows their frame: a
 *  headline, figures, a recommendation, the person's own inputs, and the
 *  calculation in plain sentences. Open by default: it is the reason the
 *  person sees it. */
export default function CashflowCard({ cashflow, ctx }: { cashflow: CashflowResult; ctx: PlanCtx }) {
  const { locale, fmt } = useSectionCopy();
  const copy = cashflowCopy[locale];
  const f = cashflow.figures;
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const eur = (c: number | null): string | null => (c === null ? null : fmt.eur(c));

  const part = (key: keyof typeof copy.parts, node: ReactNode, id: string) =>
    node === null ? null : (
      <div key={key} data-testid={`plan-cashflow-${id}`}>
        <h4 className="m-0 mb-1 text-[0.8rem] font-semibold uppercase tracking-[0.03em] text-muted">
          {copy.parts[key]}
        </h4>
        {node}
      </div>
    );

  let body: ReactNode;
  if (!f.enough) {
    body = (
      <div className="mt-4 grid gap-4" data-testid="plan-cashflow-body">
        <p className="m-0">{copy.why}</p>
        <p className="m-0" data-testid="plan-cashflow-not-enough">
          {copy.notEnough}{" "}
          <CardLink data-testid="plan-cashflow-import" onClick={() => ctx.onNavigate("profiel")}>
            {copy.importLink}
          </CardLink>
        </p>
      </div>
    );
  } else {
    const c = f.client;
    const fw = f.forward;
    const adv = copy.advice;
    const t = f.setAside.incomeTax;
    const vat = f.setAside.vat;
    const b = f.buffer;
    const bufferLine =
      b.targetCents === null
        ? adv.bufferNoFixed(fmt.months(b.months))
        : adv.buffer(
            fmt.months(b.months),
            fmt.eur(b.targetCents),
            b.gapCents !== null && b.gapCents > 0 ? fmt.eur(b.gapCents) : null,
            b.ownTargetMonths === null ? null : fmt.monthsLabel(b.ownTargetMonths),
          );
    const frequency = copy.frequency[vat.frequency] ?? vat.frequency;
    body = (
      <div className="mt-4 grid gap-4" data-testid="plan-cashflow-body">
        <p className="m-0">{copy.why}</p>
        {part(
          "figures",
          <div>
            <Rows
              testId="plan-cashflow-rows"
              rows={[
                { key: "mean", label: copy.labels.clientMean, value: fmt.eur(c.meanCents) },
                {
                  key: "range",
                  label: copy.labels.clientRange,
                  value: copy.clientRange(fmt.eur(c.minCents), fmt.eur(c.medianCents), fmt.eur(c.maxCents)),
                },
                {
                  key: "empty",
                  label: copy.labels.emptyMonths,
                  value: copy.emptyMonths(c.emptyMonths, f.months.length),
                },
                {
                  key: "gap",
                  label: copy.labels.longestGap,
                  value: c.longestGapDays === null ? null : copy.days(c.longestGapDays),
                },
                {
                  key: "var",
                  label: copy.labels.variability,
                  value: c.variability === null ? null : copy.variability(c.variability),
                },
                { key: "steady", label: copy.labels.steady, value: fmt.eur(f.steadyMonthlyCents) },
                { key: "spend", label: copy.labels.spend, value: fmt.eur(f.spendMonthlyCents) },
                { key: "quiet", label: copy.labels.quietMonth, value: fmt.eur(f.quietNetCents) },
                {
                  key: "cover",
                  label: copy.labels.quietCover,
                  value:
                    f.quietNetCents >= 0
                      ? copy.noDeficit
                      : f.quietCoverMonths === null
                        ? null
                        : copy.quietCover(f.quietCoverMonths),
                },
                {
                  key: "low-typical",
                  label: copy.labels.lowestTypical,
                  value:
                    fw === null
                      ? null
                      : copy.lowest(fmt.eur(fw.typical.lowest.cents), fmt.monthLabel(fw.typical.lowest.month)),
                },
                {
                  key: "low-quiet",
                  label: copy.labels.lowestQuiet,
                  value:
                    fw === null
                      ? null
                      : copy.lowest(fmt.eur(fw.quiet.lowest.cents), fmt.monthLabel(fw.quiet.lowest.month)),
                },
              ]}
            />
            {f.startSource === "stated" && (
              <p className="m-0 mb-1 text-muted text-[0.85rem]" data-testid="plan-cashflow-start-stated">
                {copy.labels.startStated}
              </p>
            )}
            {fw !== null && cashflow.warnings.length === 0 && (
              <p className="m-0 text-[0.9rem]" data-testid="plan-cashflow-ok">
                {copy.noWarning(fw.quietMonths, fw.points)}
              </p>
            )}
            {fw !== null &&
              cashflow.warnings.map((w) => (
                <p
                  key={w.kind}
                  role="alert"
                  className="m-0 mb-1 text-warn text-[0.9rem]"
                  data-testid={`plan-cashflow-warning-${w.kind}`}
                >
                  {copy.warning(w, fmt, fw.quietMonths)}
                </p>
              ))}
          </div>,
          "figures",
        )}
        {part(
          "advice",
          <div data-testid="plan-cashflow-advice">
            <Lines
              lines={
                f.noClientPayments
                  ? [bufferLine, adv.noClient]
                  : [
                      bufferLine,
                      t.cents === null
                        ? adv.taxNeedsPct
                        : adv.tax(fmt.eur(t.cents), `${fmt.plain(t.pct ?? 0)}%`, vat.chargesVat !== null),
                      vat.chargesVat === true && vat.cents !== null && vat.deadline !== null
                        ? adv.vat(fmt.eur(vat.cents), fmt.date(vat.deadline), eur(vat.periodCents))
                        : vat.chargesVat === null
                          ? adv.vatUnknown
                          : null,
                      f.setAside.leftCents === null ? null : adv.left(eur(f.setAside.leftCents) ?? ""),
                    ]
              }
            />
          </div>,
          "advice",
        )}
        {part(
          "assumptions",
          <div>
            {vat.chargesVat === null && <VatChoice ctx={ctx} />}
            <ValueInput
              name="income-tax-pct"
              label={copy.inputs.taxLabel}
              hint={copy.inputs.taxHint}
              stored={t.pct === null ? "" : String(t.pct)}
              parse={(text) => parseNumber(text, { min: 0, max: 60, maxDecimals: 1 })}
              onSave={(pct) => ctx.plan.setPreference({ incomeTaxSetAsidePct: { pct, at: ctx.asOf } })}
              onClear={() => ctx.plan.setPreference({ incomeTaxSetAsidePct: null })}
            />
          </div>,
          "assumptions",
        )}
        {part(
          "howCalculated",
          <div>
            <ul className="m-0 grid list-none gap-1 p-0 text-[0.9rem]" data-testid="plan-cashflow-calc">
              {cashflow.calc.map((step, i) => (
                <li key={`${step.id}-${i}`}>{copy.howCalculated[step.id as keyof typeof copy.howCalculated](step, fmt)}</li>
              ))}
            </ul>
            {c.paymentList.length > 0 && (
              <div className="mt-2" data-testid="plan-cashflow-payments">
                <p className="m-0 mb-1 text-[0.9rem]">{copy.labels.payments}</p>
                <ul className="m-0 grid list-none gap-1 p-0 text-[0.9rem]">
                  {c.paymentList.map((p, k) => (
                    <li key={`${p.date}-${k}`}>{copy.payment(fmt.date(p.date), p.counterparty, fmt.eur(p.cents))}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>,
          "calc",
        )}
        {part(
          "sources",
          <Sources
            lines={[
              copy.sources.bufferRule(PLAN_THRESHOLDS.cashflow.bufferBaseMonths, PLAN_THRESHOLDS.cashflow.bufferMaxMonths),
              vat.chargesVat === true ? copy.sources.vat(vat.ratePct, fmt.date(vat.rulesAsOf), frequency) : null,
              copy.sources.tax,
              copy.sources.notAdvice,
            ]}
          />,
          "sources",
        )}
      </div>
    );
  }

  return (
    <Card as="section" aria-label={copy.title} data-testid="plan-cashflow">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-none bg-transparent p-0 text-left font-[inherit] text-[inherit]"
        >
          <span className="font-semibold">{copy.title}</span>
          <span className="text-muted" data-testid="plan-headline-cashflow">
            {copy.headline(f, fmt)}
          </span>
        </button>
      </h3>
      <div id={bodyId} hidden={!open}>
        {open && body}
      </div>
    </Card>
  );
}

/** The VAT question, asked here for people who work for themselves but were
 *  never asked (they finished the intake before it had this question). */
function VatChoice({ ctx }: { ctx: PlanCtx }) {
  const { locale } = useSectionCopy();
  const copy = cashflowCopy[locale];
  const [failed, setFailed] = useState(false);
  const pick = async (charges: boolean) => {
    setFailed(false);
    try {
      await saveProfile(ctx, (p) => applyChargesVat(p, charges, ctx.asOf));
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="mb-3" role="group" aria-label={copy.inputs.vatLabel} data-testid="plan-cashflow-vat-choice">
      <p className="m-0 mb-1">{copy.inputs.vatLabel}</p>
      <div className="flex gap-3">
        <Button data-testid="plan-cashflow-vat-yes" onClick={() => void pick(true)}>
          {copy.inputs.yes}
        </Button>
        <Button data-testid="plan-cashflow-vat-no" onClick={() => void pick(false)}>
          {copy.inputs.no}
        </Button>
      </div>
      {failed && (
        <p role="alert" className="m-0 text-warn text-[0.85rem]">
          {copy.inputs.vatSaveFailed}
        </p>
      )}
    </div>
  );
}
