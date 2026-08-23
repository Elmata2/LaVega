import { useMemo } from "react";
import type { Account, Invoice, OwnAccounts, Rule, Tx, ScheduledFlow, VatSettings } from "@lavega/core";
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
import FacturenWidget from "../components/blocks/FacturenWidget";
import BtwWidget from "../components/blocks/BtwWidget";
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
 *   BTW                 (2) + Facturen (1)
 *                                 — het paar dat er op 22 augustus bij kwam:
 *                                   "dan moet de factuur ook in het overzicht
 *                                   komen, als de gebruiker dat wilt, doe
 *                                   default wel btw". BTW staat standaard aan,
 *                                   Facturen standaard uit, en de spans zijn
 *                                   daarom variabel — zie hieronder.
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
  /** De ondernemingen die dit scherm toont — DEZELFDE lijst die Belasting
   *  krijgt, zodat de btw-kaart hier en het scherm daar over dezelfde
   *  ondernemingen gaan. */
  entities: string[];
  vatSettings: VatSettings[];
  invoices: Invoice[];
  /** Het land uit het profiel; bepaalt welke belastingregels gelden. */
  country: string;
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
  entities,
  vatSettings,
  invoices,
  country,
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

  /* De spans van het nieuwe paar. Zelfde afweging als Saldo/Positie hierboven:
   * een afwezige kaart hoort een BREDERE buur op te leveren, geen gat. BTW staat
   * standaard aan en Facturen standaard uit, dus die situatie (BTW alleen, over
   * de volle breedte) is de gewone en niet de uitzondering. Alleen deze view
   * weet wat er verder op de pagina staat, dus de span wordt hier bepaald en
   * niet in de kaarten zelf. Staan ze allebei uit, dan renderen ze allebei niets
   * en verdwijnt de rij vanzelf. */
  const facturenOn = useWidgetEnabled("facturen-open");
  const btwOn = useWidgetEnabled("btw-stand");

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

      <BtwWidget
        span={facturenOn ? 2 : 3}
        entities={entities}
        txs={txs}
        accounts={accounts}
        asOf={asOf}
        vatSettings={vatSettings}
        invoices={invoices}
        country={country}
        onNavigate={onNavigate}
      />
      <FacturenWidget span={btwOn ? 1 : 3} invoices={invoices} entities={entities} asOf={asOf} onNavigate={onNavigate} />

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
