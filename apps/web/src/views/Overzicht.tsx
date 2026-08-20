import { useMemo } from "react";
import type { Account, OwnAccounts, Rule, Tx, ScheduledFlow } from "@lavega/core";
import { forecastCashflow, computeAlerts } from "@lavega/core";
import type { View } from "../App";
import ModuleGrid from "../components/ModuleGrid";
import { AandachtWidget } from "../components/blocks/AandachtBlock";
import SaldoBlock from "../components/blocks/SaldoBlock";
import StatistiekBlock from "../components/blocks/StatistiekBlock";
import { PositieWidget } from "../components/blocks/PositieBlock";
import { useWidgetEnabled } from "../components/moduleRegistry";
import CashflowBlock from "../components/blocks/CashflowBlock";
import RecenteTransactiesBlock from "../components/blocks/RecenteTransactiesBlock";
import BetaalschemaBlock from "../components/blocks/BetaalschemaBlock";
import TopUitgavenBlock from "../components/blocks/TopUitgavenBlock";
import KaartenBlock from "../components/blocks/KaartenBlock";
import TravelBlock, { type TravelBlockProps } from "../components/blocks/TravelBlock";

/* The homescreen: a grid of modules, nothing else.
 *
 * Every block lives in its own file under components/blocks/ and takes only
 * props, so a block can later be switched off per user (the module picker)
 * without touching any other block. This view does two things: derive the two
 * values more than one block needs (the forecast, and the alerts computed from
 * it), and declare the order and spans.
 *
 * The order is Alexander's priority order from the 2026-08-16 review, not the
 * order the blocks were built in:
 *
 *   Aandacht                 (3)  — anything wrong comes first
 *   Totale positie   (2) + Positie per bedrijf (1)
 *                                 — the most important number, with its graph;
 *                                   the per-BV split shrunk to a small block
 *   Statistieken             (3)  — the major block, both reference views
 *   Recente transacties (2) + Betaalagenda (1)
 *   Cashflow            (2) + Top uitgaven (1)
 *   Je kaarten               (3)  — presentational, "which cards are connected"
 *   Op reis                  (3)
 *
 * Every row fills exactly, and the grid collapses to 2 then 1 column.
 *
 * "Verandering per categorie" is gone: it and Statistieken asked the same
 * question twice, so the comparison moved INTO Statistieken as its per-category
 * per-month view. */

type OverzichtProps = {
  accounts: Account[];
  txs: Tx[];
  rules: Rule[];
  own: OwnAccounts;
  asOf: string;
  bufferCents: number;
  scheduledFlows: ScheduledFlow[];
  onBufferChange: (cents: number) => void;
  onNavigate: (view: View) => void;
  onSelectCategory: (category: string) => void;
  /** Push a pre-filled question into the LaVega assistant (used by the
   *  per-category "vs. gemiddelde" benchmark button). */
  /** Everything the travel module needs, passed straight through. */
  travel: TravelBlockProps;
};

export default function Overzicht({
  accounts,
  txs,
  rules,
  own,
  asOf,
  bufferCents,
  scheduledFlows,
  onBufferChange,
  onNavigate,
  onSelectCategory,
  travel,
}: OverzichtProps) {
  const forecast = useMemo(
    () => forecastCashflow(txs, accounts, { asOf, bufferCents, scheduledFlows }).consolidated,
    [txs, accounts, asOf, bufferCents, scheduledFlows],
  );

  // The alert centre: shortfall (vs. buffer) + overdue recurring payments +
  // accounts missing a saldo, ranked by severity. Needs the forecast, so it is
  // derived here rather than inside the block.
  const alerts = useMemo(
    () => computeAlerts({ accounts, forecast, asOf, bufferCents, scheduledFlows }),
    [accounts, forecast, asOf, bufferCents, scheduledFlows],
  );

  const positieOn = useWidgetEnabled("positie");

  return (
    <ModuleGrid label="Overzicht">
      <AandachtWidget alerts={alerts} bufferCents={bufferCents} onBufferChange={onBufferChange} />

      {/* Saldo is span-2 with Positie beside it and span-3 without: an absent
          widget should leave a wider card, not a gap. Only this view knows what
          else is on the page, which is why the span is decided here rather than
          inside either block. */}
      <SaldoBlock
        span={positieOn ? 2 : 3}
        accounts={accounts}
        txs={txs}
        scheduledFlows={scheduledFlows}
        asOf={asOf}
        onNavigate={onNavigate}
      />
      <PositieWidget accounts={accounts} onNavigate={onNavigate} />

      <StatistiekBlock txs={txs} rules={rules} own={own} onSelectCategory={onSelectCategory} />

      <RecenteTransactiesBlock
        txs={txs}
        accounts={accounts}
        rules={rules}
        own={own}
        onNavigate={onNavigate}
        onSelectCategory={onSelectCategory}
      />
      <BetaalschemaBlock scheduledFlows={scheduledFlows} txs={txs} asOf={asOf} />

      <CashflowBlock forecast={forecast} bufferCents={bufferCents} onNavigate={onNavigate} />
      <TopUitgavenBlock
        txs={txs}
        rules={rules}
        own={own}
        onSelectCategory={onSelectCategory}
      />

      <KaartenBlock accounts={accounts} onNavigate={onNavigate} />

      <TravelBlock {...travel} />
    </ModuleGrid>
  );
}
