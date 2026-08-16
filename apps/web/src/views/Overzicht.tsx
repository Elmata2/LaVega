import { useMemo } from "react";
import type { Account, OwnAccounts, Rule, Tx, ScheduledFlow } from "@lavega/core";
import { forecastCashflow, computeAlerts } from "@lavega/core";
import type { View } from "../App";
import ModuleGrid from "../components/ModuleGrid";
import AandachtBlock from "../components/blocks/AandachtBlock";
import SaldoBlock from "../components/blocks/SaldoBlock";
import StatistiekBlock from "../components/blocks/StatistiekBlock";
import PositieBlock from "../components/blocks/PositieBlock";
import CashflowBlock from "../components/blocks/CashflowBlock";
import RecenteTransactiesBlock from "../components/blocks/RecenteTransactiesBlock";
import BetaalschemaBlock from "../components/blocks/BetaalschemaBlock";
import TopUitgavenBlock from "../components/blocks/TopUitgavenBlock";
import CategorieTrendBlock from "../components/blocks/CategorieTrendBlock";
import TravelBlock, { type TravelBlockProps } from "../components/blocks/TravelBlock";

/* The homescreen: a grid of modules, nothing else.
 *
 * Every block lives in its own file under components/blocks/ and takes only
 * props, so a block can later be switched off per user (BACKLOG item 6 — the
 * modules are the point) without touching any other block. This view does two
 * things: derive the two values more than one block needs (the forecast, and
 * the alerts computed from it), and declare the order and spans.
 *
 * Layout, at three columns: Aandacht spans the row; then Saldo + Statistieken,
 * Positie + Cashflow, Verandering per categorie + Top uitgaven, Recente
 * transacties + Betaalschema, and Op reis across the last row. Every row fills
 * exactly, and the grid collapses to 2 then 1 column. */

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
  onAsk: (text: string) => void;
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
  onAsk,
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

  return (
    <ModuleGrid label="Overzicht">
      <AandachtBlock alerts={alerts} bufferCents={bufferCents} onBufferChange={onBufferChange} />

      <SaldoBlock accounts={accounts} scheduledFlows={scheduledFlows} asOf={asOf} onNavigate={onNavigate} />
      <StatistiekBlock txs={txs} />

      <PositieBlock accounts={accounts} txs={txs} onNavigate={onNavigate} />
      <CashflowBlock forecast={forecast} bufferCents={bufferCents} onNavigate={onNavigate} />

      <CategorieTrendBlock txs={txs} rules={rules} own={own} onSelectCategory={onSelectCategory} />
      <TopUitgavenBlock
        txs={txs}
        rules={rules}
        own={own}
        onSelectCategory={onSelectCategory}
        onAsk={onAsk}
      />

      <RecenteTransactiesBlock
        txs={txs}
        accounts={accounts}
        rules={rules}
        own={own}
        onNavigate={onNavigate}
        onSelectCategory={onSelectCategory}
      />
      <BetaalschemaBlock scheduledFlows={scheduledFlows} asOf={asOf} />

      <TravelBlock {...travel} />
    </ModuleGrid>
  );
}
