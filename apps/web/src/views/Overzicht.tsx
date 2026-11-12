import { useMemo } from "react";
import type {
  Account,
  AdvisorProfileStore,
  Bill,
  BillDecisions,
  BillOccurrence,
  Invoice,
  OwnAccounts,
  RoomResult,
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
import type { VaultStorage } from "@lavega/adapters";
import { AssistantPanel } from "../assistant/AssistantPanel.js";
import type { ConversionMode } from "../settings.js";
import { useAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";
import ModuleGrid from "../components/ModuleGrid";
import { IntakeInviteWidget } from "../components/blocks/IntakeInviteCard";
import { ConnectChecklistWidget } from "../components/blocks/ConnectChecklist";
import { RoomCardWidget } from "../components/blocks/RoomCard";
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
  onSelectCategory: (category: string) => void;
  /** Push a pre-filled question into the LaVega assistant (used by the
   *  per-category "vs. gemiddelde" benchmark button). */
  /** The assistant panel needs the unlocked vault (WS5.8, issue #301). Absent
   *  in a test or a caller without storage, and then the panel is not shown. */
  storage?: VaultStorage;
  /** Everything the travel module needs, passed straight through. */
  travel: TravelBlockProps;
  /** The adviser profile and the room worked out from it; absent while the
   *  profile is still being read, in which case neither intake card shows. */
  intake?: {
    store: AdvisorProfileStore | null;
    room: RoomResult;
    statedInputs?: {
      income: { lowCents: number; highCents: number };
      spend: { lowCents: number; highCents: number };
    };
    onSave: (next: AdvisorProfileStore) => Promise<void>;
    /** Opens the wizard in round 2 (the coaching questions). */
    onOpenRound2?: () => void;
  };
};

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
  onSelectCategory,
  storage,
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
    <>
      {storage && (
        <div className="mb-5">
          <AssistantPanel storage={storage} asOf={asOf} />
        </div>
      )}
      <ModuleGrid label={c.overzicht.gridLabel}>
        <AandachtWidget alerts={alerts} bufferCents={bufferCents} onBufferChange={onBufferChange} />

        {intake && (
          <>
            <IntakeInviteWidget
              store={intake.store}
              asOf={asOf}
              onSave={intake.onSave}
              onOpenIntake={() => onNavigate("intake")}
              {...(intake.onOpenRound2 ? { onOpenRound2: intake.onOpenRound2 } : {})}
              hasTransactions={txs.length > 0}
            />
            <RoomCardWidget
              store={intake.store}
              result={intake.room}
              accounts={accounts}
              {...(intake.statedInputs ? { statedInputs: intake.statedInputs } : {})}
              onOpenIntake={() => onNavigate("intake")}
              onImport={() => onNavigate("profiel")}
              onOpenPlan={() => onNavigate("plan")}
            />
            <ConnectChecklistWidget
              store={intake.store}
              accounts={accounts}
              onOpenAccounts={() => onNavigate("accounts")}
            />
          </>
        )}

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
          fxHistory={fxHistory}
          mode={mode}
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
          txs={txs}
          accounts={accounts}
          rules={rules}
          own={own}
          onNavigate={onNavigate}
          onSelectCategory={onSelectCategory}
        />
        <BetaalschemaBlock
          scheduledFlows={scheduledFlows}
          txs={txs}
          asOf={asOf}
          {...(paycheck ? { paycheck } : {})}
        />

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
        <FacturenWidget
          span={btwOn ? 1 : 3}
          invoices={invoices}
          entities={entities}
          asOf={asOf}
          onNavigate={onNavigate}
        />

        <CashflowBlock forecast={forecast} bufferCents={bufferCents} onNavigate={onNavigate} />
        <TopUitgavenBlock txs={txs} rules={rules} own={own} onSelectCategory={onSelectCategory} />

        <KaartenBlock accounts={accounts} onNavigate={onNavigate} />

        <TravelBlock {...travel} />
      </ModuleGrid>
    </>
  );
}
