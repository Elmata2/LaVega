import { useMemo } from "react";
import type {
  Account,
  AdvisorProfileStore,
  Bill,
  BillDecisions,
  BillOccurrence,
  Invoice,
  OwnAccounts,
  Rule,
  Tx,
  ScheduledFlow,
  VatSettings,
} from "@lavega/core";
import {
  billForecastProjection,
  cashOnHandCents,
  forecastCashflow,
  computeAlerts,
  paycheckOverview,
} from "@lavega/core";
import type { View } from "../App";
import type { ConversionMode } from "../settings.js";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import ModuleGrid from "../components/ModuleGrid";
import HomeAddArea from "../components/HomeAddArea";
import { AandachtWidget } from "../components/blocks/AandachtBlock";
import ChartSlot from "../components/blocks/ChartSlot";
import StatistiekBlock from "../components/blocks/StatistiekBlock";
import { PositieWidget } from "../components/blocks/PositieBlock";
import { useOverviewWidgets } from "../components/moduleRegistry";
import { homeSpans } from "../lib/homeLayout";
import RecenteTransactiesBlock from "../components/blocks/RecenteTransactiesBlock";
import BetaalschemaBlock from "../components/blocks/BetaalschemaBlock";
import FacturenWidget from "../components/blocks/FacturenWidget";
import BtwWidget from "../components/blocks/BtwWidget";
import TopUitgavenBlock from "../components/blocks/TopUitgavenBlock";
import KaartenBlock from "../components/blocks/KaartenBlock";
import TravelBlock, { type TravelBlockProps } from "../components/blocks/TravelBlock";

/* Home: a grid of modules, nothing else.
 *
 * Every block lives in its own file under components/blocks/ and takes only
 * props. This view derives the two values more than one block needs (the
 * forecast, and the alerts computed from it) and declares the order and spans.
 *
 * Home starts with four fixed full-width blocks: the chart slot (Totale positie
 * or Cashflow), Statistieken, Je kaarten and Travel. Every other block is a
 * widget the user switches on; `homeSpans` decides how the widgets that are on
 * share a row, so a row never has a hole. Order, top to bottom:
 *
 *   Aandacht, chart slot (+ Positie), Statistieken, Recente transacties,
 *   Betaalagenda, BTW, Facturen, Top uitgaven, Je kaarten, Op reis, and last the
 *   add area (components/HomeAddArea.tsx). */

type OverzichtProps = {
  accounts: Account[];
  txs: Tx[];
  rules: Rule[];
  own: OwnAccounts;
  asOf: string;
  bufferCents: number;
  scheduledFlows: ScheduledFlow[];
  /** The bills lane (#286/#287/#288), threaded so the Betaalagenda can show the
   *  paycheck preview. Absent on an older caller; the agenda then stays as-is. */
  bills?: Bill[];
  billOccurrences?: BillOccurrence[];
  billDecisions?: BillDecisions;
  /** De ondernemingen die dit scherm toont — DEZELFDE lijst die Belasting
   *  krijgt, zodat de btw-kaart hier en het scherm daar over dezelfde
   *  ondernemingen gaan. */
  entities: string[];
  vatSettings: VatSettings[];
  invoices: Invoice[];
  /** Het land uit het profiel; bepaalt welke belastingregels gelden. */
  country: string;
  /** ECB daily rates, and whether non-EUR balances/transactions convert into
   *  the totals or stay out of them — threaded to every block that touches an
   *  amount in a foreign currency. */
  fxHistory: Record<string, Record<string, number>>;
  mode: ConversionMode;
  onBufferChange: (cents: number) => void;
  onNavigate: (view: View) => void;
  /** Opens the widget picker in Profiel (the "Alle widgets" link). */
  onAddWidget: () => void;
  onSelectCategory: (category: string) => void;
  /** Everything the travel module needs, passed straight through. */
  travel: TravelBlockProps;
  /** The profile store, for the card list. Absent while the profile is still
   *  being read. */
  intake?: { store: AdvisorProfileStore | null };
};

const NO_STATED: readonly string[] = [];

export default function Overzicht({
  accounts,
  txs,
  rules,
  own,
  asOf,
  bufferCents,
  scheduledFlows,
  bills,
  billOccurrences,
  billDecisions,
  entities,
  vatSettings,
  invoices,
  country,
  fxHistory,
  mode,
  onBufferChange,
  onNavigate,
  onAddWidget,
  onSelectCategory,
  travel,
  intake,
}: OverzichtProps) {
  const [locale] = useAppLocale();
  const c = shellCopy[locale];
  // WS2.10 (#290): bills occurrences are forecast drivers on this card too, so
  // the Overzicht position and the Forecast screen cannot disagree. An absent
  // bills lane yields the empty projection and the pre-#290 call.
  const forecastProjection = useMemo(
    () =>
      billForecastProjection({
        bills: bills ?? [],
        occurrences: billOccurrences ?? [],
        decisions: billDecisions,
        txs,
        accounts,
        asOf,
      }),
    [bills, billOccurrences, billDecisions, txs, accounts, asOf],
  );
  const forecast = useMemo(
    () =>
      forecastCashflow(txs, accounts, {
        asOf,
        bufferCents,
        scheduledFlows,
        fxHistory,
        mode,
        commitments: forecastProjection.commitments,
        claimedStreams: forecastProjection.claimedStreams,
      }).consolidated,
    [txs, accounts, asOf, bufferCents, scheduledFlows, fxHistory, mode, forecastProjection],
  );

  // The alert centre: shortfall (vs. buffer) + overdue recurring payments +
  // accounts missing a saldo, ranked by severity. Needs the forecast, so it is
  // derived here rather than inside the block.
  const alerts = useMemo(
    () => computeAlerts({ accounts, forecast, asOf, bufferCents, scheduledFlows }),
    [accounts, forecast, asOf, bufferCents, scheduledFlows],
  );

  // The declared-income paycheck preview for the Betaalagenda (#288). Accounts
  // here are already rolled forward to `asOf`, so no tx walk is needed.
  const paycheck = useMemo(() => {
    if (bills == null || billOccurrences == null) return undefined;
    return paycheckOverview({
      bills,
      occurrences: billOccurrences,
      decisions: billDecisions,
      asOf,
      cashCents: cashOnHandCents(accounts),
    }).preview;
  }, [bills, billOccurrences, billDecisions, asOf, accounts]);

  const [enabled] = useOverviewWidgets();
  const spans = homeSpans(enabled);

  return (
    <>
      <ModuleGrid label={c.overzicht.gridLabel} className="home-grid">
        <AandachtWidget alerts={alerts} bufferCents={bufferCents} onBufferChange={onBufferChange} />

        <ChartSlot
          span={spans.chart === 2 ? 2 : 3}
          saldo={{
            accounts,
            txs,
            scheduledFlows,
            asOf,
            onNavigate,
            fxHistory,
            mode,
          }}
          cashflow={{ forecast, bufferCents, onNavigate }}
        />
        <PositieWidget
          accounts={accounts}
          onNavigate={onNavigate}
          asOf={asOf}
          fxHistory={fxHistory}
          mode={mode}
        />

        <StatistiekBlock
          txs={txs}
          rules={rules}
          own={own}
          onSelectCategory={onSelectCategory}
          fxHistory={fxHistory}
          mode={mode}
        />

        <RecenteTransactiesBlock
          span={spans["recente-transacties"] ?? 3}
          txs={txs}
          accounts={accounts}
          rules={rules}
          own={own}
          onNavigate={onNavigate}
          onSelectCategory={onSelectCategory}
        />
        <BetaalschemaBlock
          span={spans.betaalagenda ?? 3}
          scheduledFlows={scheduledFlows}
          txs={txs}
          asOf={asOf}
          {...(paycheck ? { paycheck } : {})}
        />

        <BtwWidget
          span={spans["btw-stand"] ?? 3}
          entities={entities}
          txs={txs}
          accounts={accounts}
          asOf={asOf}
          vatSettings={vatSettings}
          invoices={invoices}
          country={country}
          onNavigate={onNavigate}
        />
        <FacturenWidget
          span={spans["facturen-open"] ?? 3}
          invoices={invoices}
          entities={entities}
          asOf={asOf}
          onNavigate={onNavigate}
        />

        <TopUitgavenBlock
          span={spans["top-uitgaven"] ?? 3}
          txs={txs}
          rules={rules}
          own={own}
          onSelectCategory={onSelectCategory}
        />

        <KaartenBlock
          accounts={accounts}
          onNavigate={onNavigate}
          statedCredit={intake?.store?.current.statedCards?.value ?? NO_STATED}
          statedDebit={intake?.store?.current.statedDebitCards?.value ?? NO_STATED}
        />

        <TravelBlock {...travel} />

        <HomeAddArea onOpenPicker={onAddWidget} />
      </ModuleGrid>
    </>
  );
}
