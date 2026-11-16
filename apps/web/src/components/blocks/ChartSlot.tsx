import { useId, useState } from "react";
import { useAppLocale } from "../../appLocale.js";
import { shellCopy } from "../../copy/shell.js";
import { readHomeChart, writeHomeChart, type HomeChart } from "../../lib/homeChart.js";
import Module from "../Module.js";
import { useCashflowParts, type CashflowBlockProps } from "./CashflowBlock";
import { useSaldoParts, type SaldoBlockProps } from "./SaldoBlock";

/* The Home chart slot: one module that shows either Totale positie or Cashflow.
 * The slot owns the Module, so the radio group in its header is one element for
 * the life of the slot and keeps keyboard focus when the choice changes. The two
 * blocks keep their own calculations; they hand over title, menu, footer and
 * body (`useSaldoParts`, `useCashflowParts`) and the slot places the chosen set.
 * Both hooks run every render, as both blocks did before the slot existed. The choice is a
 * preference of this browser (lib/homeChart). Switching swaps the body at once,
 * with no motion. */

/* The slot sits in one half of the fixed 2 x 2 group on Home (`.home-fixed`), so
 * its Module is span 1. The chart still gets its y-axis: the span the Saldo parts
 * take is a "this is a wide card" hint for the axis, not a grid placement. */
const CHART_SPAN = 2;

type ChartSlotProps = {
  saldo: Omit<SaldoBlockProps, "span" | "headerControl">;
  cashflow: Omit<CashflowBlockProps, "span" | "headerControl">;
};

export default function ChartSlot({ saldo, cashflow }: ChartSlotProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale].overzicht.chart;
  const name = useId();
  const [chart, setChart] = useState<HomeChart>(readHomeChart);

  const choose = (next: HomeChart) => {
    setChart(next);
    writeHomeChart(next);
  };

  const options: { value: HomeChart; label: string }[] = [
    { value: "position", label: c.position },
    { value: "cashflow", label: c.cashflow },
  ];

  const control = (
    <div role="radiogroup" aria-label={c.groupLabel} className="module-tabs">
      {options.map((o) => (
        <label
          key={o.value}
          className={`module-tab chart-option${chart === o.value ? " module-tab-on" : ""}`}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={chart === o.value}
            onChange={() => choose(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );

  const saldoParts = useSaldoParts({ ...saldo, span: CHART_SPAN });
  const cashflowParts = useCashflowParts(cashflow);
  const parts = chart === "cashflow" ? cashflowParts : saldoParts;

  return (
    <Module
      title={parts.title}
      span={1}
      height="tall"
      period={control}
      menu={parts.menu}
      footer={parts.footer}
    >
      {parts.body}
    </Module>
  );
}
