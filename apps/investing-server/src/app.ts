import { Hono } from "hono";
import { Schema, type Layer } from "effect";
import {
  confirmCashFlowSuggestion,
  emptyInvestingDashboard,
  GICS_SECTOR_LABELS,
  InvestingDashboardDataSchema,
  InvestingLayoutSchema,
  LOCAL_TENANT_ID,
  PersonalNetWorthTotalsSchema,
  validateAccountWrapperMap,
  validateBenchmarkSymbols,
  validateInvestingLayout,
  RealizedIncomeReportSchema,
  suggestionSignChange,
  type CashFlowSuggestion,
  emptyRealizedReport,
  type BenchmarkInstrument,
  type BenchmarkSelectionStore,
  type InvestingDashboardData,
  type InvestingLayout,
  type InvestingLayoutStore,
  type RiskRange,
  type AccountWrapperStore,
} from "@lavega/core";
import { createProblemReporter, type ProblemReporter } from "./observability.js";
import {
  createMemoryCashFlowStore,
  isRuleKind,
  type CashFlowStore,
} from "./cashFlowSuggestions.js";
import { createMemorySyncRunStore, createSyncRun, MAX_HOPS, type SyncRunStore } from "./syncRun.js";
import {
  LocalKeySource,
  createInMemoryBenchmarkSelectionStore,
  createInMemoryInvestingLayoutStore,
  createInMemorySharedPriceStore,
  createYahooPriceProvider,
  createFrankfurterFxProvider,
  createOpenFigiIdentifierProvider,
  getYahooSymbolForKnownExchange,
  firstProviderResult,
  hasProblems,
  searchYahooBenchmarks,
  syncPrices,
  type IdentifierCandidateSelector,
  type SharedPriceStore,
  type ScheduledBroker,
  type YahooPriceRequest,
} from "@lavega/adapters";
import type { BrokerSyncLane } from "@lavega/adapters";
import {
  createInMemoryPriceSyncProgressStore,
  createPriceOrchestrator,
  instrumentKeys,
  priceSyncDeadlineMs,
  type PriceSyncProgress,
  type PriceSyncProgressStore,
  type PriceSyncTarget,
} from "./priceOrchestrator.js";
import {
  createInMemoryMarketDataConsentStore,
  YAHOO_DISCLOSURE_VERSION,
  type MarketDataConsentStore,
} from "./marketDataConsent.js";
import {
  createInMemoryPersonalNetWorthStore,
  type PersonalNetWorthStore,
} from "./personalNetWorthStore.js";
import {
  createPartnerBudgetClient,
  isPartnerBudgetStop,
  fetchYahooSectorProfile,
  PartnerBudget,
  YahooHttpClient,
  type IdentifierRequest,
  type PartnerBudgetClient,
  type SectorProfile,
} from "@lavega/adapters";
import {
  createInMemorySectorProfileStore,
  type SectorProfileStore,
} from "./inMemorySectorProfileStore.js";
import {
  resolvePortfolioSectors,
  resolveSectorListing,
  resolvedStockSector,
  UNKNOWN_SECTOR,
} from "./sectorResolution.js";
import {
  inferSectorBatch,
  MAX_SECTOR_INFERENCE_EXCLUDE,
  SECTOR_INFERENCE_BATCH_SIZE,
} from "./sectorInferenceBatch.js";
import type { SectorClassifier } from "./sectorClassifier.js";
import {
  createInMemorySectorCorrectionStore,
  type SectorCorrectionStore,
} from "./sectorCorrectionStore.js";
import {
  createInMemorySectorInferenceSettingStore,
  type SectorInferenceSettingStore,
} from "./sectorInferenceSetting.js";
import { createInMemorySectorRevisionStore, type SectorRevisionStore } from "./sectorRevision.js";
import { createSectorReader, type SectorReader } from "./sectorRead.js";
import { effectiveBenchmarkSymbols } from "./defaultBenchmark.js";
import { createServerTiming, type ServerTiming } from "./serverTiming.js";
import {
  createInMemoryIdentifierOverrideStore,
  createInMemoryIdentifierSelectionSettingStore,
  validateIdentifierOverrides,
  type IdentifierOverrideMap,
  type IdentifierOverrideStore,
  type IdentifierSelectionSettingStore,
} from "./identifierSelectionStore.js";
import { createInMemoryAccountWrapperStore } from "./accountWrapperStore.js";

/** The read model crosses the wire through its shared schema, so a field the
 *  contract declares is always present in the response. */
const encodeDashboard = (dashboard: InvestingDashboardData) =>
  Schema.encodeSync(InvestingDashboardDataSchema)(dashboard);

const encodeLayout = (layout: InvestingLayout) => Schema.encodeSync(InvestingLayoutSchema)(layout);
export type InvestingDashboardReader = (input: {
  symbol?: string;
  timing?: ServerTiming;
}) => Promise<InvestingDashboardData>;
export type BrokerCredentialInput = {
  broker: "ibkr" | "trading212";
  token: string;
  queryId?: string;
  secret?: string;
  passphrase?: string;
};
/** Whether the vault behind this runtime is unlocked by a passphrase the user types. */
export type PassphraseMode = "required" | "unused";
export type BrokerSyncProgress = {
  status: "idle" | "running" | "waiting" | "completed" | "problem";
  pages: number;
  ordersRead: number;
  positionsRead: number;
  waitUntil: string | null;
  remaining: number | null;
  updatedAt: string | null;
  message: string | null;
  /** Read back from the durable sync state, so it survives the serverless
   *  invocation that the counters above do not. Without it a mounted deployment
   *  can only ever report "idle" and never says whether history finished. */
  history: BrokerHistoryProgress | null;
};

/** Per broker, whether each paginated history ran to its last page. */
export type BrokerHistoryProgress = Record<
  ScheduledBroker,
  {
    lastSyncedAt: string | null;
    retryAfter: string | null;
    ordersComplete: boolean;
    transactionsComplete: boolean;
    dividendsComplete: boolean;
  }
>;
export type InvestingHealth = {
  status: "ok" | "degraded" | "down";
  storage: "neon" | "file";
  checks: {
    database: "ok" | "not-configured" | "down";
    migrationLedger: "ok" | "not-applicable" | "down";
    /** Whether Postgres itself keeps tenants apart: a role that bypasses RLS
     *  leaves only application code between one user's rows and another's. */
    tenantIsolation: "enforced" | "not-applicable" | "down";
    vault: "ok" | "empty" | "locked" | "down";
    trading212Credentials: "configured" | "missing" | "down";
    trading212Sync: "fresh" | "stale" | "never" | "problem" | "down";
    snapshot: "loaded" | "empty" | "down";
  };
  trading212: { lastSyncedAt: string | null; positions: number };
};
type BrokerVaultStatus = "empty" | "locked" | "unlocked";
type BrokerReadability = Record<"ibkr" | "trading212", "empty" | "readable" | "unreadable">;
type PriceDependencies = {
  /** The shared, instrument-keyed price store (issue #307). One series per
   *  instrument for the whole installation. */
  store: SharedPriceStore;
  /** True when the store is the shared database one: one user must not be able
   *  to delete prices every user reads, so the cache route answers 405. */
  sharedPriceStore?: boolean;
  /** Clears a local (file) shared store. Absent on the database store, where
   *  the route answers 405 instead. */
  clearPriceCache?: () => Promise<void>;
  provider: ReturnType<typeof createYahooPriceProvider>;
  fxProvider: ReturnType<typeof createFrankfurterFxProvider>;
  identifierProvider: ReturnType<typeof createOpenFigiIdentifierProvider>;
  /** Build the Jev selector for one tenant, or undefined when the deployment
   *  has no TypeSafe key. The provider only calls it on ambiguity and only
   *  when the caller passed consent + the owner's enable setting (#136). */
  identifierSelectorForTenant?: (tenantId: string) => IdentifierCandidateSelector | undefined;
  identifierSelectionSettingStore: IdentifierSelectionSettingStore;
  identifierOverrideStore: IdentifierOverrideStore;
  benchmarkSelectionStore: BenchmarkSelectionStore;
  investingLayoutStore: InvestingLayoutStore;
  accountWrapperStore: AccountWrapperStore;
  benchmarkSearch: (
    query: string,
  ) => Promise<{ results: BenchmarkInstrument[]; fallback: boolean; problems: string[] }>;
  brokerSync: (
    force: boolean,
    lanes: readonly BrokerSyncLane[],
    deadlineMs?: number,
    rebuildOrders?: boolean,
  ) => Promise<{ outcomes: unknown[]; problems: string[] }>;
  brokerSyncStatus: () => BrokerSyncProgress | Promise<BrokerSyncProgress>;
  priceSyncTargets: (tenantId: string) => Promise<PriceSyncTarget[]> | PriceSyncTarget[];
  /** Where partner request slots come from; one runtime is built from it. Defaults to memory. */
  partnerBudget: Layer.Layer<PartnerBudget>;
  /** A budget the caller already bridged. Wins over `partnerBudget`, so a caller can
   *  share one budget between the app and the broker adapters it builds. */
  partnerBudgetClient: PartnerBudgetClient;
  priceSyncBenchmarkRecheckEveryMs: number;
  priceSyncProgressStore: PriceSyncProgressStore;
  priceSyncDeadline: () => number | undefined;
  /** Owner-confirmed cash-flow rules and pending suggestions (issue #137). */
  cashFlowStore?: CashFlowStore;
  /** Durable row for the server-owned run (Neon on hosted, memory locally). */
  syncRunStore?: SyncRunStore;
  /** Registers the run as background work. Rejects on a host with no such port. */
  syncRunBackground?: (work: Promise<unknown>) => Promise<void>;
  syncRunContinue?: (hop: number, origin: string | undefined, runId: string) => Promise<void>;
  syncRunNow?: () => number;
  configureBroker: (input: BrokerCredentialInput) => Promise<void>;
  credentialStatus: () => Promise<BrokerVaultStatus>;
  brokerReadability: () => Promise<BrokerReadability | undefined>;
  unlockCredentials: (passphrase: string) => Promise<boolean>;
  problemReporter: ProblemReporter;
  dashboardReader: InvestingDashboardReader;
  onPriceDataChanged: () => void;
  /** Raised when an account label changes: the report's grouping is part of
   *  the read model, so the cached dashboard must be rebuilt. */
  onAccountWrappersChanged?: () => void;
  marketDataConsentStore: MarketDataConsentStore;
  personalNetWorthStore: PersonalNetWorthStore;
  sectorProfile: (
    symbol: string,
    options?: { deadlineMs?: number },
  ) => Promise<SectorProfile | null>;
  sectorStore: SectorProfileStore;
  sectorCorrectionStore: SectorCorrectionStore;
  sectorInferenceSettingStore: SectorInferenceSettingStore;
  /** Raised by a correction or inference-setting write; the sector read keys
   *  its resolution cache on it, independently of `dataVersion`. */
  sectorRevisionStore: SectorRevisionStore;
  /** The tenant-scoped sector read seam. Built from the stores above when the
   *  caller does not inject one. */
  sectorReader: SectorReader;
  sectorClassifier?: SectorClassifier;
  resolveTenantId: () => string | Promise<string>;
  passphraseMode: () => PassphraseMode;
  healthCheck: () => Promise<InvestingHealth>;
};
/** What a request-path Yahoo call may spend on partner slots. A slot after it
 *  fails with `PartnerWait` instead of holding the request. */
const REQUEST_PARTNER_BUDGET_MS = 10_000;

export function createApp(dependencies: Partial<PriceDependencies> = {}) {
  const store = dependencies.store ?? createInMemorySharedPriceStore();
  const sharedPriceStore = dependencies.sharedPriceStore ?? false;
  const accountWrapperStore =
    dependencies.accountWrapperStore ?? createInMemoryAccountWrapperStore();
  /* One budget for every partner call this app makes. Hosted, it is Neon's, so
   * the limit holds across invocations and users; elsewhere it is this process's. */
  const partnerBudget =
    dependencies.partnerBudgetClient ??
    createPartnerBudgetClient(dependencies.partnerBudget ?? PartnerBudget.memoryLayer);
  /* One provider per tenant when selection is possible: the selector needs the
   * tenant for consent, the enable switch and usage billing, while the partner
   * budget (rate limiting) stays shared. Without selection, one provider is
   * enough and keeps the cache shared exactly as before. */
  const identifierProvidersByTenant = new Map<
    string,
    ReturnType<typeof createOpenFigiIdentifierProvider>
  >();
  const identifierProviderFor = (tenantId: string) => {
    if (dependencies.identifierProvider) return dependencies.identifierProvider;
    const known = identifierProvidersByTenant.get(tenantId);
    if (known) return known;
    const selector = dependencies.identifierSelectorForTenant?.(tenantId);
    const provider = createOpenFigiIdentifierProvider({
      partnerBudget,
      ...(selector ? { selector } : {}),
    });
    identifierProvidersByTenant.set(tenantId, provider);
    return provider;
  };
  /* One client per app: its crumb and cookie are negotiated once and reused. A
   * price run takes a view of it with the run's own deadline, so a slot after the
   * deadline ends the slice instead of sleeping past it. */
  const yahooClient = new YahooHttpClient(undefined, undefined, undefined, { partnerBudget });
  const resolveMissingListing = async (
    request: { isin?: string; ticker: string; currency?: string },
    deadline: number | undefined,
    tenantId: string,
  ) => {
    if (!request.isin || !request.ticker.endsWith("_EQ")) return null;
    const isin = request.isin.trim().toUpperCase();
    const identifier = await mapIdentifier(
      {
        isin,
        deadlineMs: deadline,
        instrument: {
          name: request.ticker,
          ...(request.currency ? { currency: request.currency } : {}),
        },
      },
      tenantId,
    ).then((resolved) => resolved?.value);
    if (
      !identifier ||
      identifier.problems.length ||
      identifier.match.isin.trim().toUpperCase() !== isin ||
      !identifier.match.exchange
    )
      return null;
    return getYahooSymbolForKnownExchange(identifier.match.ticker, identifier.match.exchange);
  };
  const priceProviderFor = (deadline: number | undefined, tenantId: string) =>
    dependencies.provider ??
    createYahooPriceProvider({
      client: yahooClient.withDeadline(deadline),
      resolveMissingListing: (request) => resolveMissingListing(request, deadline, tenantId),
    });
  const identifierSelectionSettingStore =
    dependencies.identifierSelectionSettingStore ?? createInMemoryIdentifierSelectionSettingStore();
  const identifierOverrideStore =
    dependencies.identifierOverrideStore ?? createInMemoryIdentifierOverrideStore();
  const fxProvider = dependencies.fxProvider ?? createFrankfurterFxProvider();
  const brokerSync = dependencies.brokerSync ?? (async () => ({ outcomes: [], problems: [] }));
  const configureBroker = dependencies.configureBroker;
  const problemReporter = dependencies.problemReporter ?? createProblemReporter();
  const dashboardReader = dependencies.dashboardReader ?? (async () => emptyInvestingDashboard());
  const benchmarkSelectionStore =
    dependencies.benchmarkSelectionStore ?? createInMemoryBenchmarkSelectionStore();
  const investingLayoutStore =
    dependencies.investingLayoutStore ?? createInMemoryInvestingLayoutStore();
  const benchmarkSearch =
    dependencies.benchmarkSearch ??
    ((query: string) =>
      searchYahooBenchmarks(query, {
        client: yahooClient.withDeadline(Date.now() + REQUEST_PARTNER_BUDGET_MS),
      }));
  const marketDataConsentStore =
    dependencies.marketDataConsentStore ?? createInMemoryMarketDataConsentStore();
  const personalNetWorthStore =
    dependencies.personalNetWorthStore ?? createInMemoryPersonalNetWorthStore();
  /* Sector reads share the one client, and so its crumb (see
   * YahooHttpClient.ensureCrumb) and its budget key: the pool of 8 concurrent
   * reads queues on the same slots as a price run. */
  const sectorProfile =
    dependencies.sectorProfile ??
    ((symbol: string, options?: { deadlineMs?: number }) =>
      fetchYahooSectorProfile(symbol, yahooClient.withDeadline(options?.deadlineMs)));
  const sectorStore = dependencies.sectorStore ?? createInMemorySectorProfileStore();
  const sectorCorrectionStore =
    dependencies.sectorCorrectionStore ?? createInMemorySectorCorrectionStore();
  const sectorInferenceSettingStore =
    dependencies.sectorInferenceSettingStore ?? createInMemorySectorInferenceSettingStore();
  /* Who the request belongs to. Standalone and local runs have a single tenant;
   * mounted behind the personal server this resolves to the signed-in user. */
  const resolveTenantId = dependencies.resolveTenantId ?? (() => LOCAL_TENANT_ID);
  /* The file vault derives its key from a passphrase, so it needs one. A vault
   * the server holds the key to has nothing to ask for. */
  const passphraseMode = dependencies.passphraseMode ?? (() => "required" as const);
  const fxProviders = [fxProvider];
  /* The identifier seam, per tenant: the owner's override wins, then the
   * provider's answer, then a model selection when consent AND the enable
   * setting allow it (issue #136). */
  const mapIdentifier = async (request: IdentifierRequest, tenantId: string) => {
    const isin = request.isin.trim().toUpperCase();
    const [overrides, consent, selectionEnabled] = await Promise.all([
      identifierOverrideStore.get(tenantId).catch((): IdentifierOverrideMap => ({})),
      marketDataConsentStore.get(tenantId).catch(() => ({ accepted: false })),
      identifierSelectionSettingStore.get(tenantId).catch(() => false),
    ]);
    const override = overrides[isin];
    return firstProviderResult(
      [identifierProviderFor(tenantId)],
      {
        ...request,
        isin,
        allowModelSelection: consent.accepted && selectionEnabled,
        ...(override ? { override } : {}),
      },
      undefined,
      hasProblems,
    );
  };
  /* One invocation's worth of time. Anchored where the request starts, so a
   * route that already spent the host budget on a broker sync hands the price
   * run a deadline that has passed and it pauses instead of overrunning. */
  const priceSyncDeadline =
    dependencies.priceSyncDeadline ??
    (() => priceSyncDeadlineMs((name) => process.env[name]?.trim() || undefined));
  const priceOrchestrator = createPriceOrchestrator({
    discover: dependencies.priceSyncTargets ?? (() => []),
    benchmarkRecheckEveryMs: dependencies.priceSyncBenchmarkRecheckEveryMs,
    progressStore: dependencies.priceSyncProgressStore ?? createInMemoryPriceSyncProgressStore(),
    sync: async (target, tenantId, { deadline, leaseId }) => {
      const priceProviders = [priceProviderFor(deadline, tenantId)];
      let request: Omit<YahooPriceRequest, "from" | "to"> & {
        today?: string;
        backfillFrom?: string;
      } = target;
      let identifierProblems: string[] = [];
      // Yahoo decodes Trading 212 tickers and uses their ISIN itself. An
      // arbitrary OpenFIGI listing would discard the broker's venue hint.
      if (target.isin && !target.ticker.endsWith("_EQ")) {
        const identifier = await mapIdentifier(
          {
            isin: target.isin,
            deadlineMs: deadline,
            instrument: {
              name: target.symbol,
              ...(target.currency ? { currency: target.currency } : {}),
            },
          },
          tenantId,
        );
        if (
          identifier &&
          identifier.value.problems.length === 0 &&
          identifier.value.match.ticker &&
          identifier.value.match.exchange
        ) {
          request = {
            ...target,
            ticker: identifier.value.match.ticker,
            exchange: identifier.value.match.exchange,
          };
        } else {
          identifierProblems = identifier?.value.problems ?? ["Could not resolve ISIN"];
        }
      }
      const result = await syncPrices({
        store,
        key: target.instrumentKey,
        ...(target.instrumentAlias ? { alias: target.instrumentAlias } : {}),
        owner: leaseId,
        priceProviders,
        request,
      });
      if (result.fetched) dependencies.onPriceDataChanged?.();
      return result.problems.length === 0
        ? result
        : { ...result, problems: [...identifierProblems, ...result.problems] };
    },
  });
  const investingApp = new Hono();
  const hasYahooConsent = async (tenantId: string) =>
    (await marketDataConsentStore.get(tenantId)).accepted;
  /* The shared price series is keyed by instrument, not by the broker's
   * ticker (issue #307): the position's ISIN and currency decide the key. */
  const resolveSectorListingFor = (position: {
    symbol: string;
    isin?: string;
    currency?: string;
  }) => {
    const keys = instrumentKeys({
      symbol: position.symbol,
      ...(position.isin ? { isin: position.isin } : {}),
      currency: position.currency ?? "EUR",
    });
    return resolveSectorListing(store, { key: keys.key });
  };
  /* A per-symbol route has no position in hand; the sync targets are the one
   * place that already knows this tenant's symbol-to-series mapping. A symbol
   * with no target falls back to the `sym:` key, exactly what an ISIN-less
   * series uses. */
  const resolveSectorListingSymbol = async (tenantId: string, symbol: string) => {
    try {
      const targets = (await dependencies.priceSyncTargets?.(tenantId)) ?? [];
      const match = targets.find((target) => target.symbol.toUpperCase() === symbol.toUpperCase());
      if (match)
        return resolveSectorListing(store, {
          key: match.instrumentKey,
          ...(match.instrumentAlias ? { alias: match.instrumentAlias } : {}),
        });
    } catch {
      // Discovery is a convenience here, never a reason for the route to fail.
    }
    return resolveSectorListing(store, { key: instrumentKeys({ symbol, currency: "EUR" }).key });
  };
  const sectorRevisionStore =
    dependencies.sectorRevisionStore ?? createInMemorySectorRevisionStore();
  /* The sector read is a sibling of the dashboard read (portfolioRead.ts):
   * one tenant-scoped method, keyed on the sector-store revision, so a
   * correction appears at once and no component needs the summary endpoint. */
  const sectorReader =
    dependencies.sectorReader ??
    createSectorReader({
      dashboard: async () => dashboardReader({}),
      store: sectorStore,
      fetchProfile: sectorProfile,
      corrections: sectorCorrectionStore,
      inferenceSetting: sectorInferenceSettingStore,
      consent: marketDataConsentStore,
      revision: (tenantId) => sectorRevisionStore.get(tenantId),
      resolveListing: (_tenantId, position) => resolveSectorListingFor(position),
    });
  const runPriceSyncIfConsented = async (tenantId: string, deadline: number | undefined) => {
    if (await hasYahooConsent(tenantId)) return priceOrchestrator.run(tenantId, deadline);
  };
  const cashFlowStore = dependencies.cashFlowStore ?? createMemoryCashFlowStore();
  const syncRunClock = dependencies.syncRunNow ?? (() => Date.now());
  const brokerProgress = async () =>
    dependencies.brokerSyncStatus
      ? await dependencies.brokerSyncStatus()
      : {
          status: "idle" as const,
          pages: 0,
          ordersRead: 0,
          positionsRead: 0,
          waitUntil: null,
          remaining: null,
          updatedAt: null,
          message: null,
          history: null,
        };
  const laneStatus = (status: string): "idle" | "running" | "waiting" | "completed" | "problem" =>
    status === "completed" || status === "problem" || status === "running" || status === "waiting"
      ? status
      : "idle";
  const syncRun = createSyncRun({
    store: dependencies.syncRunStore ?? createMemorySyncRunStore(),
    now: syncRunClock,
    lanes: {
      holdings: async (deadlineMs) => {
        const result = await brokerSync(false, ["holdings"], deadlineMs);
        const progress = await brokerProgress();
        return {
          status: laneStatus(progress.status),
          waitUntilMs: progress.waitUntil ? Date.parse(progress.waitUntil) : null,
          pending: progress.status === "waiting",
          problems: result.problems,
        };
      },
      history: async (deadlineMs) => {
        const result = await brokerSync(false, ["history"], deadlineMs);
        const progress = await brokerProgress();
        const pending = progress.status === "waiting" || progress.history != null;
        return {
          status: laneStatus(progress.status),
          waitUntilMs: progress.waitUntil ? Date.parse(progress.waitUntil) : null,
          pending,
          problems: result.problems,
        };
      },
      prices: async (deadlineMs) => {
        const tenantId = await resolveTenantId();
        if (!(await hasYahooConsent(tenantId))) return { status: "completed", pending: false };
        const progress = await priceOrchestrator.run(tenantId, deadlineMs);
        return {
          status: laneStatus(progress.status),
          waitUntilMs: progress.waitUntil ? Date.parse(progress.waitUntil) : null,
          pending:
            progress.status === "running" ||
            progress.status === "waiting" ||
            progress.status === "paused",
          problems: progress.problems,
        };
      },
      letter: async () => {
        /* The letter is a side effect, never part of the run outcome. */
      },
    },
    readLanes: async () => {
      const [broker, price, vault] = await Promise.all([
        brokerProgress(),
        priceOrchestrator.status(await resolveTenantId()),
        dependencies.credentialStatus
          ? dependencies.credentialStatus()
          : Promise.resolve({ status: "empty" as const }),
      ]);
      const brokerLane = (status: string, syncedAt: string | null) => ({
        status: laneStatus(status),
        syncedAt,
        waitUntil: broker.waitUntil,
        message: broker.message,
      });
      return {
        vault:
          (vault as { status?: string }).status === "unlocked"
            ? "unlocked"
            : (vault as { status?: string }).status === "locked"
              ? "locked"
              : "empty",
        holdings: {
          ...brokerLane(broker.status, broker.updatedAt),
          positionsRead: broker.positionsRead,
        },
        history: {
          ...brokerLane(broker.status, broker.updatedAt),
          pages: broker.pages,
          ordersRead: broker.ordersRead,
          historyProgress: broker.history,
        },
        prices: {
          status: laneStatus(price.status),
          syncedAt: price.updatedAt,
          waitUntil: price.waitUntil,
          message: price.message,
          total: price.total,
          completed: price.completed,
          currentSymbol: price.currentSymbol,
          remainingSymbols: price.remainingSymbols ?? [],
        },
        problems: [...brokerProblems(await brokerProgress()), ...(price.problems ?? [])],
      };
    },
    continueRun:
      dependencies.syncRunContinue ??
      (async (hop, origin, runId) => {
        const secret = process.env.CRON_SECRET?.trim();
        if (!origin || !secret) return;
        await fetch(`${origin}/api/sync/continue`, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: JSON.stringify({ tenantId: "local", runId, hop }),
        });
      }),
    background:
      dependencies.syncRunBackground ??
      ((work) => {
        void work.catch((error: unknown) =>
          problemReporter({
            source: "broker-sync",
            problems: [error instanceof Error ? error.message : "Background sync run failed"],
          }),
        );
        return Promise.resolve();
      }),
    reportProblem: (message, error) =>
      problemReporter({
        source: "broker-sync",
        problems: [message, ...(error instanceof Error ? [error.message] : [])],
      }),
  });
  const brokerProblems = (_progress: { message?: string | null }) => [];
  const visiblePriceProgress = (progress: PriceSyncProgress): PriceSyncProgress => {
    const visible = { ...progress };
    delete visible.leaseId;
    return visible;
  };
  /* A run that stopped on the budget is not finished, and the caller is the
   * one who can continue it. 202 is that difference, stated in the status
   * line rather than only in the body. */
  const priceSyncStatusCode = (progress: PriceSyncProgress) =>
    progress.status === "completed" || progress.status === "problem" ? 200 : 202;
  /* Twice, on purpose. `/health` is what a container health check and the
   * standalone server ask for; `/api/investing/health` is the same answer on a
   * path the mount forwards, because everything outside /api/ belongs to the
   * SPA there and never reaches this app. */
  const health = (c: { json: (body: unknown) => Response }) =>
    c.json({ ok: true, service: "investing-server", sharedPriceStore });
  investingApp.get("/health", health);
  investingApp.get("/api/investing/health", health);
  investingApp.get("/api/investing/health/detail", async (c) => {
    if (!dependencies.healthCheck)
      return c.json({ problems: ["Detailed health is not available"] }, 503);
    try {
      const report = await dependencies.healthCheck();
      return c.json(report, report.status === "ok" ? 200 : 503);
    } catch {
      return c.json({ problems: ["Detailed health check failed"] }, 503);
    }
  });
  /* This app never mounts real auth (single local tenant, no session).
   * apps/server signals that with 503 on /api/auth/* when DATABASE_URL /
   * BETTER_AUTH_SECRET are unset; match that here so investing-web's
   * RequireAuth renders unguarded on standalone instead of reading the
   * default Hono 404 as "anonymous" and redirecting to /sign-in. */
  investingApp.all("/api/auth/*", (c) =>
    c.json({ message: "Authentication is not configured" }, 503),
  );
  investingApp.get("/api/investing/summary", async (c) => {
    try {
      const requestedRange = c.req.query("range") ?? "1Y";
      if (requestedRange !== "6M" && requestedRange !== "1Y" && requestedRange !== "All")
        return c.json({ message: "Invalid risk range" }, 400);
      const range = requestedRange as RiskRange;
      const data = await dashboardReader({});
      const benchmark = c.req.query("benchmark");
      if (benchmark && !data.benchmarks.some((item) => item.symbol === benchmark))
        return c.json({ message: "Select a configured benchmark" }, 400);
      /* Risk is a projection of the read model (#216): read the entry the
       * dashboard already carries instead of re-running the metrics pass. */
      const riskKey = benchmark ?? data.risk.defaultBenchmark ?? "";
      /* Composition is a projection of the read model (#223): the top
       * positions and the priced/missing/estimated counts ride the dashboard
       * snapshot, so this route never recomputes them. */
      const composition = data.composition;
      /* Same classification rule as the portfolio-agent snapshot: stored
       * profiles only. This route never calls Yahoo (#309); fetching a
       * missing profile belongs to GET /api/investing/sectors, which bounds
       * it. classifier is never passed here either: classification runs off
       * this critical path, only from POST /api/investing/sectors/infer. */
      const tenantId = await resolveTenantId();
      const consented = await hasYahooConsent(tenantId);
      /* A cached inferred profile is a global fact (no tenantId on
       * sector_profiles), so it's visible here only when this tenant has
       * both consented to Yahoo/AI data use and turned inference on —
       * otherwise it displays as Unknown, same as never having been
       * classified (I1, #135 final review). Two cheap reads, no network. */
      const inferenceEnabled = await sectorInferenceSettingStore.get(tenantId);
      const corrections = await sectorCorrectionStore.getAll(tenantId);
      const { exposure, coverage } = await resolvePortfolioSectors(data.positions, {
        store: sectorStore,
        correction: async (symbol) => corrections[symbol.toUpperCase()] ?? null,
        showInferred: consented && inferenceEnabled,
        resolveListing: (position) => resolveSectorListingFor(position),
      });
      return c.json({
        ...data.risk.byBenchmark[riskKey]?.[range],
        sectors: exposure,
        sectorCoverage: coverage,
        topPositions: composition.topPositions,
        composition: {
          pricedHoldings: composition.pricedHoldings,
          missingHoldings: composition.missingHoldings,
          estimatedHoldings: composition.estimatedHoldings,
        },
      });
    } catch {
      return c.json({ problems: ["Portfolio summary could not be assembled"] }, 503);
    }
  });
  investingApp.get("/api/investing/sectors", async (c) => {
    const tenantId = await resolveTenantId();
    try {
      return c.json(await sectorReader({ tenantId }));
    } catch {
      return c.json({ problems: ["Sector data could not be assembled"] }, 503);
    }
  });
  investingApp.get("/api/investing/positions/:symbol/sector", async (c) => {
    const symbol = c.req.param("symbol");
    const tenantId = await resolveTenantId();
    /* Same precedence as resolveWeights: read the cached profile before the
     * correction, so a fund always wins. Read-only — no fetchProfile, no
     * classifier, no store write. Looked up under the same resolved-listing
     * key resolveWeights caches under, so a renamed broker code (fetched and
     * cached elsewhere under its live Yahoo ticker) is found here too. */
    const listing = await resolveSectorListingSymbol(tenantId, symbol);
    const profile = await sectorStore.get(listing ?? symbol);
    if (profile?.kind === "fund")
      return c.json({ kind: "fund" as const, sector: null, source: "provider" as const });
    const corrected = await sectorCorrectionStore.get(tenantId, symbol);
    if (corrected)
      return c.json({ kind: "stock" as const, sector: corrected, source: "correction" as const });
    if (!profile)
      return c.json({
        kind: "unknown" as const,
        sector: UNKNOWN_SECTOR,
        source: "unknown" as const,
      });
    /* Same visibility rule as the summary route (I1, #135 final review): an
     * inferred profile this tenant isn't allowed to see reads as Unknown. */
    const consented = await hasYahooConsent(tenantId);
    const inferenceEnabled = await sectorInferenceSettingStore.get(tenantId);
    const resolved = resolvedStockSector(profile, { showInferred: consented && inferenceEnabled });
    return c.json({
      kind: "stock" as const,
      sector: resolved.sector,
      source: resolved.source,
      ...(resolved.confidence !== undefined ? { confidence: resolved.confidence } : {}),
    });
  });
  investingApp.put("/api/investing/positions/:symbol/sector", async (c) => {
    const symbol = c.req.param("symbol");
    const body: { sector?: unknown } = await c.req.json().catch(() => ({}));
    if (typeof body.sector !== "string" || !GICS_SECTOR_LABELS.includes(body.sector as never))
      return c.json({ message: "sector must be one of the GICS sector labels" }, 400);
    const tenantId = await resolveTenantId();
    const listing = await resolveSectorListingSymbol(tenantId, symbol);
    const profile = await sectorStore.get(listing ?? symbol);
    if (profile?.kind === "fund")
      return c.json(
        { message: "A fund's sector is its look-through weight vector, not a single correction" },
        422,
      );
    await sectorCorrectionStore.set(tenantId, symbol, body.sector);
    await sectorRevisionStore.raise(tenantId);
    return c.body(null, 204);
  });
  investingApp.delete("/api/investing/positions/:symbol/sector", async (c) => {
    const tenantId = await resolveTenantId();
    await sectorCorrectionStore.clear(tenantId, c.req.param("symbol"));
    await sectorRevisionStore.raise(tenantId);
    return c.body(null, 204);
  });
  investingApp.get("/api/investing/sector-inference", async (c) =>
    c.json({
      enabled: await sectorInferenceSettingStore.get(await resolveTenantId()),
      /* The switch is per-tenant, but a classifier is per-deployment (a
       * configured TypeSafe key). Without this the Profile page could let
       * an owner turn inference "on" on a server that can never run it. */
      available: dependencies.sectorClassifier !== undefined,
    }),
  );
  investingApp.put("/api/investing/sector-inference", async (c) => {
    const body: { enabled?: unknown } = await c.req.json().catch(() => ({}));
    if (typeof body.enabled !== "boolean")
      return c.json({ message: "enabled must be boolean" }, 400);
    await sectorInferenceSettingStore.set(await resolveTenantId(), body.enabled);
    await sectorRevisionStore.raise(await resolveTenantId());
    return c.json({ enabled: body.enabled });
  });
  /* Identifier candidate selection (Jev-03, issue #136): the owner's switch
   * for sending an instrument's identity to Jev on ambiguity, and the owner's
   * own symbol choice per ISIN (the most trusted resolution tier). */
  investingApp.get("/api/investing/identifier-selection", async (c) =>
    c.json({
      enabled: await identifierSelectionSettingStore.get(await resolveTenantId()),
      available: dependencies.identifierSelectorForTenant !== undefined,
    }),
  );
  investingApp.put("/api/investing/identifier-selection", async (c) => {
    const body: { enabled?: unknown } = await c.req.json().catch(() => ({}));
    if (typeof body.enabled !== "boolean")
      return c.json({ message: "enabled must be boolean" }, 400);
    const tenantId = await resolveTenantId();
    await identifierSelectionSettingStore.set(tenantId, body.enabled);
    return c.json({ enabled: body.enabled });
  });
  investingApp.get("/api/investing/identifier-overrides", async (c) =>
    c.json({
      overrides: await identifierOverrideStore.get(await resolveTenantId()),
    }),
  );
  investingApp.put("/api/investing/identifier-overrides", async (c) => {
    const body: { overrides?: unknown } = await c.req.json().catch(() => ({}));
    const overrides = validateIdentifierOverrides(body.overrides);
    const tenantId = await resolveTenantId();
    await identifierOverrideStore.set(tenantId, overrides);
    return c.json({ overrides });
  });
  investingApp.post("/api/investing/sectors/infer", async (c) => {
    const tenantId = await resolveTenantId();
    if (!(await hasYahooConsent(tenantId)))
      return c.json({ problems: ["Yahoo Finance consent required"] }, 428);
    if (!(await sectorInferenceSettingStore.get(tenantId)))
      return c.json({ problems: ["Sector inference is not enabled"] }, 428);
    if (!dependencies.sectorClassifier)
      return c.json({ classified: 0, failed: 0, failedSymbols: [], remaining: 0 });
    const body: { exclude?: unknown } = await c.req.json().catch(() => ({}));
    let excluded = new Set<string>();
    if (body.exclude !== undefined) {
      if (
        !Array.isArray(body.exclude) ||
        !body.exclude.every((symbol) => typeof symbol === "string")
      )
        return c.json({ problems: ["exclude must be a string array"] }, 400);
      excluded = new Set(
        body.exclude.slice(0, MAX_SECTOR_INFERENCE_EXCLUDE).map((symbol) => symbol.toUpperCase()),
      );
    }
    const data = await dashboardReader({});
    const priced = data.positions.filter(
      (position): position is typeof position & { marketValue: number } =>
        position.marketValue !== null && position.marketValue > 0,
    );
    const corrections = await sectorCorrectionStore.getAll(tenantId);
    return c.json(
      await inferSectorBatch({
        tenantId,
        priced,
        exclude: excluded,
        corrections,
        resolveListing: (position) => resolveSectorListingFor(position),
        store: sectorStore,
        classifier: dependencies.sectorClassifier,
        batchSize: SECTOR_INFERENCE_BATCH_SIZE,
      }),
    );
  });
  investingApp.get("/api/investing/dashboard", async (c) => {
    const timing = createServerTiming();
    try {
      const symbol = c.req.query("symbol")?.trim() || undefined;
      const dashboard = await timing.measure("total", () => dashboardReader({ symbol, timing }));
      c.header("Server-Timing", timing.header());
      if (!dependencies.brokerReadability) return c.json(encodeDashboard(dashboard));
      try {
        const readability = await dependencies.brokerReadability();
        const unreadable = (["ibkr", "trading212"] as const).filter(
          (broker) => readability?.[broker] === "unreadable",
        );
        return c.json(
          encodeDashboard({
            ...dashboard,
            problems: [
              ...dashboard.problems,
              ...unreadable.map(
                (broker) =>
                  `${broker === "ibkr" ? "IBKR" : "Trading 212"} credentials cannot be read. Reconnect broker to restore data.`,
              ),
            ],
          }),
        );
      } catch {
        return c.json(
          encodeDashboard({
            ...dashboard,
            problems: [
              ...dashboard.problems,
              "Broker connection status could not be checked. Showing available data.",
            ],
          }),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dashboard data could not be loaded";
      problemReporter({ source: "dashboard-read", problems: [message] });
      c.header("Server-Timing", timing.header());
      return c.json(
        encodeDashboard({
          ...emptyInvestingDashboard(),
          problems: ["Dashboard data could not be loaded"],
        }),
      );
    }
  });
  /* Realised-gain + income report (plan §3 WS4.3/WS4.4, #296). It rides the
   * dashboard read model: the report is built from the same broker snapshot,
   * FX rates and price bars, so this route only serves the section. A
   * dashboard stored before the report existed answers with an empty report
   * and a problem line rather than an error, so the surface still renders. */
  investingApp.get("/api/investing/reports/realized", async (c) => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const dashboard = await dashboardReader({});
      const report =
        dashboard.realized ??
        emptyRealizedReport(dashboard.presentationCurrency, today, [
          "The realised report is not built for this snapshot yet. Refresh the dashboard.",
        ]);
      return c.json(Schema.encodeSync(RealizedIncomeReportSchema)(report));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Report read failed";
      problemReporter({ source: "realized-report-read", problems: [message] });
      return c.json(
        emptyRealizedReport("EUR", today, ["The realised report could not be loaded."]),
      );
    }
  });
  /* Account tax-treatment labels (WS4.4). The map is account metadata only:
   * it decides which treatment bucket the report groups a row under. Unknown
   * labels are dropped, exactly like the layout's unknown ids, so a stored
   * map and a PUT body agree on what valid means. */
  investingApp.get("/api/investing/account-wrappers", async (c) => {
    const tenantId = await resolveTenantId();
    return c.json({ tenantId, entries: await accountWrapperStore.get(tenantId) });
  });
  investingApp.put("/api/investing/account-wrappers", async (c) => {
    const body: { entries?: unknown } = await c.req.json<{ entries?: unknown }>().catch(() => ({}));
    if (!Array.isArray(body.entries))
      return c.json({ problems: ["entries must be an array"] }, 400);
    const tenantId = await resolveTenantId();
    const selection = { tenantId, entries: validateAccountWrapperMap(body.entries) };
    await accountWrapperStore.set(selection);
    dependencies.onAccountWrappersChanged?.();
    return c.json(selection);
  });
  /* Jev-04 (#137): cash-flow vocabulary suggestions and owner-confirmed rules.
   *
   * A suggestion has no effect on any figure until the owner confirms it; the
   * confirmation creates a broker+type rule the sync applies at the same point
   * as the adapter's switch. Sign is never suggested — a kind that would flip
   * the observed sign must be acknowledged with the before/after first. */
  const cashFlowKey = (broker: string, typeKey: string) =>
    `${broker.trim().toLowerCase()}|${typeKey.trim().toUpperCase()}`;
  const publicSuggestion = (suggestion: CashFlowSuggestion) => ({
    broker: suggestion.broker,
    typeKey: suggestion.typeKey,
    rawType: suggestion.rawType,
    kind: suggestion.kind,
    confidence: suggestion.confidence,
    amount: suggestion.amount,
    sign: suggestion.sign,
    currency: suggestion.currency,
    description: suggestion.description,
    createdAt: suggestion.createdAt,
    signChange: suggestionSignChange(suggestion),
  });

  investingApp.get("/api/investing/cash-flow-suggestions", async (c) => {
    const [enabled, suggestions] = await Promise.all([
      cashFlowStore.suggestionsEnabled(),
      cashFlowStore.listSuggestions(),
    ]);
    const pending = suggestions
      .filter((suggestion) => suggestion.state === "pending")
      .map(publicSuggestion);
    return c.json({ enabled, count: pending.length, pending });
  });

  investingApp.post("/api/investing/cash-flow-suggestions/confirm", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      broker?: unknown;
      typeKey?: unknown;
      kind?: unknown;
      acknowledgeSignChange?: unknown;
    } | null;
    if (
      !body ||
      typeof body.broker !== "string" ||
      typeof body.typeKey !== "string" ||
      !isRuleKind(body.kind)
    )
      return c.json({ problems: ["Invalid confirmation"] }, 400);
    const suggestions = await cashFlowStore.listSuggestions();
    const decision = confirmCashFlowSuggestion({
      suggestions,
      broker: body.broker,
      typeKey: body.typeKey,
      kind: body.kind,
      acknowledgeSignChange: body.acknowledgeSignChange === true,
      confirmedAt: new Date().toISOString(),
    });
    if (!decision.ok) {
      if (decision.reason === "not-found")
        return c.json({ problems: ["No suggestion for that type"] }, 404);
      return c.json(
        { reason: "sign-change-unacknowledged", before: decision.before, after: decision.after },
        409,
      );
    }
    const key = cashFlowKey(decision.rule.broker, decision.rule.typeKey);
    const rules = await cashFlowStore.listRules();
    const nextRules = [
      ...rules.filter((rule) => cashFlowKey(rule.broker, rule.typeKey) !== key),
      decision.rule,
    ];
    await cashFlowStore.saveRules(nextRules);
    await cashFlowStore.saveSuggestions(
      suggestions.map((suggestion) =>
        cashFlowKey(suggestion.broker, suggestion.typeKey) === key
          ? { ...suggestion, state: "confirmed" as const, kind: decision.rule.kind }
          : suggestion,
      ),
    );
    return c.json({ rule: decision.rule, rules: nextRules });
  });

  investingApp.post("/api/investing/cash-flow-suggestions/reject", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      broker?: unknown;
      typeKey?: unknown;
    } | null;
    if (!body || typeof body.broker !== "string" || typeof body.typeKey !== "string")
      return c.json({ problems: ["Invalid rejection"] }, 400);
    const key = cashFlowKey(body.broker, body.typeKey);
    const suggestions = await cashFlowStore.listSuggestions();
    if (
      !suggestions.some((suggestion) => cashFlowKey(suggestion.broker, suggestion.typeKey) === key)
    )
      return c.json({ problems: ["No suggestion for that type"] }, 404);
    await cashFlowStore.saveSuggestions(
      suggestions.map((suggestion) =>
        cashFlowKey(suggestion.broker, suggestion.typeKey) === key
          ? { ...suggestion, state: "rejected" as const }
          : suggestion,
      ),
    );
    return c.json({ ok: true });
  });

  /* Rules are owner data: this GET is the exportable shape. */
  investingApp.get("/api/investing/cash-flow-rules", async (c) => {
    const [enabled, rules] = await Promise.all([
      cashFlowStore.suggestionsEnabled(),
      cashFlowStore.listRules(),
    ]);
    return c.json({ enabled, rules });
  });

  investingApp.post("/api/investing/cash-flow-rules/remove", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      broker?: unknown;
      typeKey?: unknown;
    } | null;
    if (!body || typeof body.broker !== "string" || typeof body.typeKey !== "string")
      return c.json({ problems: ["Invalid removal"] }, 400);
    const key = cashFlowKey(body.broker, body.typeKey);
    const rules = await cashFlowStore.listRules();
    const nextRules = rules.filter((rule) => cashFlowKey(rule.broker, rule.typeKey) !== key);
    await cashFlowStore.saveRules(nextRules);
    /* Removing a rule re-opens its vocabulary word for a future suggestion. */
    await cashFlowStore.saveSuggestions(
      (await cashFlowStore.listSuggestions()).filter(
        (suggestion) => cashFlowKey(suggestion.broker, suggestion.typeKey) !== key,
      ),
    );
    return c.json({ rules: nextRules });
  });

  investingApp.get("/api/investing/cash-flow-suggestions/settings", async (c) =>
    c.json({ enabled: await cashFlowStore.suggestionsEnabled() }),
  );

  investingApp.put("/api/investing/cash-flow-suggestions/settings", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (!body || typeof body.enabled !== "boolean")
      return c.json({ problems: ["enabled must be a boolean"] }, 400);
    await cashFlowStore.setSuggestionsEnabled(body.enabled);
    return c.json({ enabled: body.enabled });
  });

  investingApp.get("/api/investing/benchmarks", async (c) => {
    const tenantId = await resolveTenantId();
    return c.json({
      tenantId,
      symbols: await effectiveBenchmarkSymbols(benchmarkSelectionStore, tenantId),
    });
  });
  investingApp.put("/api/investing/benchmarks", async (c) => {
    const body: { symbols?: unknown } = await c.req.json<{ symbols?: unknown }>().catch(() => ({}));
    const symbols = body.symbols;
    if (!Array.isArray(symbols) || !symbols.every((symbol: unknown) => typeof symbol === "string"))
      return c.json({ problems: ["symbols must be a string array"] }, 400);
    try {
      const tenantId = await resolveTenantId();
      const selection = { tenantId, symbols: validateBenchmarkSymbols(symbols as string[]) };
      await benchmarkSelectionStore.set(selection);
      return c.json(selection);
    } catch (error) {
      return c.json(
        { problems: [error instanceof Error ? error.message : "Benchmark selection is invalid"] },
        400,
      );
    }
  });
  investingApp.get("/api/investing/benchmarks/search", async (c) => {
    const query = c.req.query("q")?.trim() ?? "";
    if (!(await hasYahooConsent(await resolveTenantId())))
      return c.json({ consentRequired: true, problems: ["Yahoo Finance consent required"] }, 428);
    return c.json(await benchmarkSearch(query));
  });
  investingApp.get("/api/investing/layout", async (c) =>
    c.json(encodeLayout(await investingLayoutStore.get(await resolveTenantId()))),
  );
  investingApp.put("/api/investing/layout", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return c.json({ problems: ["layout must be a JSON object"] }, 400);
    const layout = validateInvestingLayout(body);
    const tenantId = await resolveTenantId();
    await investingLayoutStore.set({ tenantId, ...layout });
    return c.json(encodeLayout(layout));
  });
  /* The owner's opt-in Personal totals, read-only here — Personal owns the
   * only write, through apps/server's PUT/DELETE /api/personal/net-worth-total.
   * Deliberately outside the cached dashboard: it is one small per-user table,
   * cheap to read fresh on every request, and folding it into the dashboard's
   * cache/version machinery would risk a stale total surviving a new one. */
  investingApp.get("/api/investing/personal-net-worth", async (c) =>
    c.json(
      Schema.encodeSync(PersonalNetWorthTotalsSchema)({
        totals: await personalNetWorthStore.list(await resolveTenantId()),
      }),
    ),
  );
  investingApp.get("/api/market-data/consent", async (c) =>
    c.json(await marketDataConsentStore.get(await resolveTenantId())),
  );
  investingApp.put("/api/market-data/consent", async (c) => {
    const body: { accepted?: unknown } = await c.req
      .json<{ accepted?: unknown }>()
      .catch(() => ({}));
    if (typeof body.accepted !== "boolean")
      return c.json({ problems: ["accepted must be boolean"] }, 400);
    const tenantId = await resolveTenantId();
    const decision = {
      tenantId,
      accepted: body.accepted,
      decidedAt: new Date().toISOString(),
      disclosureVersion: YAHOO_DISCLOSURE_VERSION,
    };
    await marketDataConsentStore.set(decision);
    return c.json(decision);
  });
  investingApp.get("/api/config/status", (c) => {
    const keys = new LocalKeySource();
    return c.json({
      keys: { llm: keys.getStatus("llm"), marketData: keys.getStatus("market-data") },
    });
  });
  investingApp.get("/api/brokers/sync/status", async (c) => {
    if (!dependencies.brokerSyncStatus)
      return c.json({ problems: ["Broker synchronization status is not available"] }, 503);
    return c.json(await dependencies.brokerSyncStatus());
  });
  /* --- server-owned sync run (#306) ------------------------------------- */

  const bearerIsCron = (c: { req: { header: (name: string) => string | undefined } }) => {
    const secret = process.env.CRON_SECRET?.trim();
    return secret !== undefined && c.req.header("authorization") === `Bearer ${secret}`;
  };
  const validContinueBody = (
    body: unknown,
  ): body is { tenantId: string; runId: string; hop: number } => {
    if (!body || typeof body !== "object") return false;
    const value = body as { tenantId?: unknown; runId?: unknown; hop?: unknown };
    return (
      typeof value.tenantId === "string" &&
      value.tenantId.length > 0 &&
      typeof value.runId === "string" &&
      value.runId.length > 0 &&
      typeof value.hop === "number" &&
      Number.isInteger(value.hop) &&
      value.hop >= 1 &&
      value.hop <= MAX_HOPS
    );
  };

  investingApp.post("/api/sync/refresh", async (c) => {
    if (process.env.VERCEL !== undefined && !process.env.CRON_SECRET?.trim())
      return c.json(
        { problems: ["CRON_SECRET is not set; a server-owned run cannot continue"] },
        500,
      );
    const body = (await c.req.json().catch(() => null)) as { force?: unknown } | null;
    try {
      const result = await syncRun.requestRefresh(body?.force === true, new URL(c.req.url).origin);
      return c.json(result.state, 202);
    } catch (error) {
      // No background port (no request context): do not fake it with a
      // detached promise that the host may freeze.
      return c.json(
        {
          problems: [
            error instanceof Error ? error.message : "Background execution is not available",
          ],
        },
        500,
      );
    }
  });

  investingApp.get("/api/sync/state", async (c) => c.json(await syncRun.readState()));

  investingApp.post("/api/sync/continue", async (c) => {
    if (!bearerIsCron(c)) return c.json({ problems: ["Unauthorized"] }, 401);
    const body: unknown = await c.req.json().catch(() => null);
    if (!validContinueBody(body)) return c.json({ problems: ["Invalid continue request"] }, 400);
    return c.json(
      { accepted: await syncRun.acceptContinue({ runId: body.runId, hop: body.hop }) },
      202,
    );
  });

  /* The daily cron's worker: claim or resume the run and await it in this
   * invocation. Bearer secret only; never reachable with a user session. */
  investingApp.post("/api/sync/drive", async (c) => {
    if (!bearerIsCron(c)) return c.json({ problems: ["Unauthorized"] }, 401);
    const body = (await c.req.json().catch(() => null)) as {
      force?: unknown;
      deadlineMs?: unknown;
    } | null;
    const deadlineMs =
      typeof body?.deadlineMs === "number" && Number.isFinite(body.deadlineMs)
        ? body.deadlineMs
        : undefined;
    return c.json({ result: await syncRun.runNow(body?.force === true, deadlineMs) });
  });

  investingApp.post("/api/brokers/sync", async (c) => {
    const requestedLane = c.req.query("lane");
    if (requestedLane !== undefined && requestedLane !== "holdings" && requestedLane !== "history")
      return c.json({ problems: [`Unknown lane: ${requestedLane}`] }, 400);
    // Absent lane = both, which is what a caller that predates lanes means.
    const lanes: readonly BrokerSyncLane[] =
      requestedLane === "holdings"
        ? ["holdings"]
        : requestedLane === "history"
          ? ["history"]
          : ["holdings", "history"];
    const deadline = priceSyncDeadline();
    try {
      const result = await brokerSync(
        c.req.query("force") === "true",
        lanes,
        deadline,
        c.req.query("rebuildOrders") === "true",
      );
      problemReporter({ source: "broker-sync", problems: result.problems });
      /* Awaited, not detached. Work started after the response is not
       * guaranteed to run at all on a serverless host, which is how prices
       * went months without a bar while every call looked successful. The
       * holdings lane never starts it: two broker requests must answer in
       * under the 5 s dashboard budget, and a price slice is not what the
       * user opened the app for. */
      if (lanes.includes("history"))
        await runPriceSyncIfConsented(await resolveTenantId(), deadline);
      return c.json(result);
    } catch {
      const result = { outcomes: [], problems: ["Broker synchronization failed"] };
      problemReporter({ source: "broker-sync", problems: result.problems });
      return c.json(result, 503);
    }
  });
  investingApp.post("/api/brokers/credentials", async (c) => {
    if (!configureBroker)
      return c.json(
        { problems: ["Broker credentials are not available in this server mode"] },
        503,
      );
    const body: Partial<BrokerCredentialInput> = await c.req
      .json<Partial<BrokerCredentialInput>>()
      .catch(() => ({}) as Partial<BrokerCredentialInput>);
    const broker = body.broker;
    if (broker !== "ibkr" && broker !== "trading212")
      return c.json({ problems: ["broker must be ibkr or trading212"] }, 400);
    if (!body.token?.trim()) return c.json({ problems: ["token is required"] }, 400);
    if (passphraseMode() === "required" && !body.passphrase?.trim())
      return c.json({ problems: ["passphrase is required"] }, 400);
    if (broker === "ibkr" && !body.queryId?.trim())
      return c.json({ problems: ["queryId is required for ibkr"] }, 400);
    /* TRADING 212 GEBRUIKT EEN SLEUTELPAAR, en dat is hier eerder verkeerd
     * gelezen. Hun documentatie is er eenduidig over: "You must provide your
     * API Key as the username and your API Secret as the password, formatted
     * as an HTTP Basic Authentication header."
     *
     * Deze eis stond er dus terecht. Hij is één ronde lang weggehaald op de
     * aanname dat Trading 212 één credential uitgeeft — die aanname was fout,
     * en het gevolg was erger dan de oorspronkelijke wrijving: je kon opslaan
     * met een leeg geheim, wat `base64("key:")` oplevert, en dat kan per
     * definitie nooit authenticeren. Een 401 waar het formulier zelf de oorzaak
     * van was. */
    if (broker === "trading212" && !body.secret?.trim())
      return c.json({ problems: ["secret is required for trading212"] }, 400);
    try {
      await configureBroker({
        broker,
        token: body.token.trim(),
        queryId: body.queryId?.trim(),
        secret: body.secret?.trim(),
        passphrase: body.passphrase?.trim(),
      });
      return new Response(null, { status: 204 });
    } catch {
      return c.json({ problems: ["Broker credentials could not be stored"] }, 500);
    }
  });
  investingApp.get("/api/brokers/credentials/status", async (c) => {
    if (!dependencies.credentialStatus)
      return c.json({ problems: ["Broker credential vault is not available"] }, 503);
    try {
      return c.json({
        status: await dependencies.credentialStatus(),
        passphrase: passphraseMode(),
        ...(dependencies.brokerReadability
          ? { brokers: await dependencies.brokerReadability() }
          : {}),
      });
    } catch {
      return c.json({ problems: ["Broker credential vault status could not be read"] }, 500);
    }
  });
  investingApp.post("/api/brokers/credentials/unlock", async (c) => {
    if (!dependencies.unlockCredentials)
      return c.json({ problems: ["Broker credential vault is not available"] }, 503);
    const body: { passphrase?: string } = await c.req
      .json<{ passphrase?: string }>()
      .catch(() => ({}));
    const passphrase = body.passphrase?.trim();
    if (!passphrase) return c.json({ problems: ["passphrase is required"] }, 400);
    try {
      if (!(await dependencies.unlockCredentials(passphrase)))
        return c.json({ problems: ["Vault could not be unlocked"] }, 401);
      return new Response(null, { status: 204 });
    } catch {
      return c.json({ problems: ["Vault could not be unlocked"] }, 500);
    }
  });
  investingApp.delete("/api/prices/cache", async (c) => {
    /* Prices are public reference data now (issue #307): with a database one
     * user must not delete what every user reads. A local file store serves one
     * installation, so clearing it stays available there. */
    if (sharedPriceStore)
      return c.json({ problems: ["Shared price data cannot be cleared from one account"] }, 405);
    if (!dependencies.clearPriceCache)
      return c.json({ problems: ["Price cache cannot be cleared"] }, 405);
    await dependencies.clearPriceCache();
    dependencies.onPriceDataChanged?.();
    return c.json({ deleted: true });
  });
  investingApp.get("/api/prices/sync/status", async (c) =>
    c.json(visiblePriceProgress(await priceOrchestrator.status(await resolveTenantId()))),
  );
  investingApp.get("/api/market-data/fx", async (c) => {
    const from = c.req.query("from")?.trim().toUpperCase();
    const to = c.req.query("to")?.trim().toUpperCase();
    if (!from || !to)
      return c.json({ rate: null, problems: ["from and to currencies are required"] }, 400);
    const result = await firstProviderResult(fxProviders, { from, to }, undefined, hasProblems);
    if (!result) return c.json({ rate: null, problems: ["No FX provider returned data"] }, 503);
    return c.json({ ...result.value, source: result.sourceKey });
  });
  investingApp.get("/api/market-data/identifier", async (c) => {
    const isin = c.req.query("isin")?.trim().toUpperCase();
    if (!isin) return c.json({ match: null, problems: ["isin is required"] }, 400);
    const name = c.req.query("name")?.trim();
    const currency = c.req.query("currency")?.trim().toUpperCase();
    let result;
    try {
      result = await mapIdentifier(
        {
          isin,
          ...(name || currency
            ? {
                instrument: {
                  ...(name ? { name } : {}),
                  ...(currency ? { currency } : {}),
                },
              }
            : {}),
        },
        await resolveTenantId(),
      );
    } catch (error) {
      if (!isPartnerBudgetStop(error)) throw error;
      return c.json(
        { match: null, problems: ["The request budget has no slot for OpenFIGI now"] },
        503,
      );
    }
    if (!result)
      return c.json({ match: null, problems: ["No identifier provider returned data"] }, 503);
    return c.json({ ...result.value, source: result.sourceKey });
  });
  investingApp.post("/api/prices/sync", async (c) => {
    const tenantId = await resolveTenantId();
    if (!(await hasYahooConsent(tenantId)))
      return c.json({ consentRequired: true, problems: ["Yahoo Finance consent required"] }, 428);
    const progress = await priceOrchestrator.run(tenantId, priceSyncDeadline());
    return c.json(visiblePriceProgress(progress), priceSyncStatusCode(progress));
  });
  return investingApp;
}
export const app = createApp();
