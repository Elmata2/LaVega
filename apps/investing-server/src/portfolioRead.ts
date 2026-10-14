import { Context, Effect, Layer, Schema } from "effect";
import {
  benchmarkDisplayName,
  buildCompositionProjection,
  buildInvestingDashboard,
  type InvestingDashboardData,
} from "@lavega/core";
import {
  resolveTrading212CashHistory,
  SCHEDULED_BROKERS,
  type BrokerSyncOperationStore,
  type PriceStore,
} from "@lavega/adapters";
import type { FrankfurterFxProvider } from "@lavega/adapters";
import type { DashboardSnapshotRepository } from "@lavega/database";
import type { DashboardCache } from "./dashboardCache.js";
import { readPriceBars } from "./priceReader.js";
import { untimed, type ServerTiming } from "./serverTiming.js";
import type { createBrokerSnapshotReader } from "./brokerSnapshotReader.js";
import type { createBrokerDataCache } from "@lavega/adapters";

type BrokerDataCache = ReturnType<typeof createBrokerDataCache>;
type BrokerSnapshotReader = ReturnType<typeof createBrokerSnapshotReader>;
type FxProvider = Pick<FrankfurterFxProvider, "getLatestRate" | "getHistoricalRates">;
type SyncStateReader = Pick<BrokerSyncOperationStore, "get" | "progress">;

/** The whole input one dashboard read takes. `tenantId` names whose data the
 *  read is for; the module never guesses it from a module-level value. */
export type PortfolioReadInput = {
  tenantId: string;
  symbol?: string;
  timing?: ServerTiming;
};

export class PortfolioReadError extends Schema.TaggedError<PortfolioReadError>()(
  "PortfolioReadError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/**
 * What the read needs from its runtime. Every one of these is injected, so the
 * module holds no Neon pool and no runtime of its own: the loader and the
 * snapshot reader are the runtime's, built per request (see
 * docs/investing/STACK.md "Neon request lifecycle").
 */
export type PortfolioReadSources = {
  priceStore: PriceStore;
  /** The runtime's lazy vault load, shared with the health check and the
   *  agent paths so one request reads the vault at most once. */
  loadBrokerData: () => Promise<void>;
  brokerData: BrokerDataCache;
  brokerSnapshot: Pick<BrokerSnapshotReader, "read" | "restore">;
  dashboardSnapshots: Pick<DashboardSnapshotRepository, "get" | "put"> | null;
  dashboardCache: DashboardCache;
  syncState: SyncStateReader;
  fxProvider: FxProvider;
  benchmarks: (tenantId: string) => Promise<readonly string[]> | readonly string[];
  priceDataVersion: () => number;
};

export class PortfolioReadPriceStore extends Context.Service<PortfolioReadPriceStore, PriceStore>()(
  "lavega/investing/PortfolioRead/PriceStore",
) {}

export class PortfolioReadLoader extends Context.Service<
  PortfolioReadLoader,
  () => Promise<void>
>()("lavega/investing/PortfolioRead/Loader") {}

export class PortfolioReadBrokerData extends Context.Service<
  PortfolioReadBrokerData,
  BrokerDataCache
>()("lavega/investing/PortfolioRead/BrokerData") {}

export class PortfolioReadBrokerSnapshot extends Context.Service<
  PortfolioReadBrokerSnapshot,
  Pick<BrokerSnapshotReader, "read" | "restore">
>()("lavega/investing/PortfolioRead/BrokerSnapshot") {}

export class PortfolioReadDashboardSnapshots extends Context.Service<
  PortfolioReadDashboardSnapshots,
  Pick<DashboardSnapshotRepository, "get" | "put"> | null
>()("lavega/investing/PortfolioRead/DashboardSnapshots") {}

export class PortfolioReadDashboardCache extends Context.Service<
  PortfolioReadDashboardCache,
  DashboardCache
>()("lavega/investing/PortfolioRead/DashboardCache") {}

export class PortfolioReadSyncState extends Context.Service<
  PortfolioReadSyncState,
  SyncStateReader
>()("lavega/investing/PortfolioRead/SyncState") {}

export class PortfolioReadFx extends Context.Service<PortfolioReadFx, FxProvider>()(
  "lavega/investing/PortfolioRead/Fx",
) {}

export class PortfolioReadBenchmarks extends Context.Service<
  PortfolioReadBenchmarks,
  (tenantId: string) => Promise<readonly string[]> | readonly string[]
>()("lavega/investing/PortfolioRead/Benchmarks") {}

export class PortfolioReadPriceVersion extends Context.Service<
  PortfolioReadPriceVersion,
  () => number
>()("lavega/investing/PortfolioRead/PriceVersion") {}

type PortfolioReadRequirements =
  | PortfolioReadPriceStore
  | PortfolioReadLoader
  | PortfolioReadBrokerData
  | PortfolioReadBrokerSnapshot
  | PortfolioReadDashboardSnapshots
  | PortfolioReadDashboardCache
  | PortfolioReadSyncState
  | PortfolioReadFx
  | PortfolioReadBenchmarks
  | PortfolioReadPriceVersion;

/** A dashboard stored before the composition projection existed still carries
 *  the fields the web app now requires. Returns the same reference when the
 *  projection is already there, so a current snapshot is not rebuilt. */
function withComposition(dashboard: InvestingDashboardData): InvestingDashboardData {
  if (dashboard.composition) return dashboard;
  return { ...dashboard, composition: buildCompositionProjection(dashboard.positions) };
}

/**
 * The investing dashboard read, as one module with one method.
 *
 * Everything the per-request closure used to inline lives here: the stored
 * snapshot lookup and its version check, the vault load, the Trading 212 cash
 * reconciliation, the price and FX reads, the symbol dedupe, the build, the
 * snapshot write-back and the in-process cache. Callers cross one seam, and so
 * do tests, which is why the read is unit-tested from fixtures and the HTTP
 * tests only keep route wiring (docs/CONTEXT.md "One contract, one test owner").
 */
export class PortfolioRead extends Context.Service<
  PortfolioRead,
  {
    readonly read: (
      input: PortfolioReadInput,
    ) => Effect.Effect<InvestingDashboardData, PortfolioReadError>;
  }
>()("lavega/investing/PortfolioRead") {
  static readonly layer: Layer.Layer<PortfolioRead, never, PortfolioReadRequirements> =
    Layer.effect(
      PortfolioRead,
      Effect.gen(function* () {
        const priceStore = yield* PortfolioReadPriceStore;
        const loadBrokerData = yield* PortfolioReadLoader;
        const brokerData = yield* PortfolioReadBrokerData;
        const brokerSnapshot = yield* PortfolioReadBrokerSnapshot;
        const dashboardSnapshots = yield* PortfolioReadDashboardSnapshots;
        const dashboardCache = yield* PortfolioReadDashboardCache;
        const syncState = yield* PortfolioReadSyncState;
        const fxProvider = yield* PortfolioReadFx;
        const benchmarks = yield* PortfolioReadBenchmarks;
        const priceDataVersion = yield* PortfolioReadPriceVersion;

        const executeRead = async ({
          tenantId,
          symbol,
          timing = untimed,
        }: PortfolioReadInput): Promise<InvestingDashboardData> => {
          const storedKey = symbol?.trim().toUpperCase() ?? "";
          const stored = await timing.measure("stored", () =>
            dashboardSnapshots?.get(storedKey).catch(() => null),
          );
          if (stored?.dashboard) return withComposition(stored.dashboard as InvestingDashboardData);
          const refreshProblems: string[] = [];
          try {
            await timing.measure("broker", async () => {
              await loadBrokerData();
              await brokerSnapshot.read("cached");
            });
          } catch (error) {
            const snapshot = brokerData.read();
            if (
              snapshot.positions.length +
                snapshot.trades.length +
                snapshot.dividends.length +
                snapshot.cashBalances.length +
                snapshot.cashFlows.length ===
              0
            )
              throw error;
            refreshProblems.push(
              "Broker data could not be refreshed. Showing the last loaded data.",
            );
          }
          const {
            positions,
            trades,
            dividends,
            cashBalances,
            cashFlows,
            cashCoverage,
            problems,
            dataVersion,
          } = brokerData.read();
          // `problems` above lives only in this invocation's in-memory cache: a sync's
          // row-level problem (an unclassifiable transaction, say) never reaches a
          // later invocation that did not run that sync. The sync's own durable
          // progress record does survive, so a stored "problem" status is read back
          // here the same way `/api/brokers/sync/status` already reads it.
          const storedBrokerProblems = (
            await Promise.all(SCHEDULED_BROKERS.map((broker) => syncState.progress(broker)))
          ).flatMap((entry) =>
            entry?.status === "problem" && entry.message ? [entry.message] : [],
          );
          const version = dataVersion + priceDataVersion();
          const selectedBenchmarks = await benchmarks(tenantId);
          const cacheKey = `${symbol?.trim().toUpperCase() ?? ""}\u0000${selectedBenchmarks.join("\u0000")}`;
          const cached = dashboardCache.get({ tenantId, key: cacheKey });
          if (cached) {
            if (refreshProblems.length > 0)
              return { ...cached, problems: [...cached.problems, ...refreshProblems] };
            return cached;
          }
          const buildDashboard = async () => {
            const symbols = [
              ...new Set([
                ...positions.map((position) => position.symbol),
                ...trades.map((trade) => trade.symbol),
              ]),
            ];
            const [prices, benches] = await timing.measure("prices", async () => [
              await readPriceBars(priceStore, tenantId, symbols),
              await readPriceBars(priceStore, tenantId, selectedBenchmarks),
            ]);
            const priceProblems =
              prices.failed + benches.failed > 0 ? ["Price data could not be fully loaded"] : [];
            const today = new Date().toISOString().slice(0, 10);
            const historyDates = [
              ...positions.map((position) => position.asOf),
              ...trades.map((trade) => trade.date),
              ...dividends.map((dividend) => dividend.date),
              ...cashBalances.map((balance) => balance.asOf),
              ...cashFlows.map((flow) => flow.date),
              ...prices.bars.map((bar) => bar.date),
            ].filter((date) => date <= today);
            const historyFrom = historyDates.sort()[0] ?? today;
            const [latestFx, historicalFx] = await timing.measure("fx", () =>
              Promise.all([
                fxProvider
                  .getLatestRate()
                  .catch(() => ({ rate: undefined, problems: ["FX rate could not be loaded"] })),
                fxProvider
                  .getHistoricalRates(historyFrom, today)
                  .catch(() => ({ rates: [], problems: ["Historical FX could not be loaded"] })),
              ]),
            );
            /* Trading 212 reports no statement period, so its cash window is proven
             * from the merged history here, where every resumed page has landed.
             * The adapter sees one page-set per invocation and cannot reconcile.
             * Only a finished pagination may prove: a short read can look complete. */
            const trading212SyncState = await syncState.get("trading212");
            const trading212Balances = cashBalances.filter(
              (balance) => balance.broker === "trading212",
            );
            const trading212Flows = cashFlows.filter((flow) => flow.broker === "trading212");
            const trading212Dividends = dividends.filter(
              (dividend) => dividend.broker === "trading212",
            );
            const trading212Trades = trades.filter((trade) => trade.broker === "trading212");
            const trading212 =
              trading212Balances.length +
                trading212Flows.length +
                trading212Dividends.length +
                trading212Trades.length ===
              0
                ? null
                : resolveTrading212CashHistory({
                    entity:
                      trading212Balances[0]?.entity ??
                      trading212Flows[0]?.entity ??
                      trading212Dividends[0]?.entity ??
                      trading212Trades[0]!.entity,
                    historyComplete:
                      trading212SyncState.lastSyncedAt != null &&
                      trading212SyncState.resume == null,
                    balance: trading212Balances[0] ?? null,
                    cashFlows: trading212Flows,
                    dividends: trading212Dividends,
                    trades: trading212Trades,
                    fxRates: [...historicalFx.rates, ...(latestFx.rate ? [latestFx.rate] : [])],
                  });
            const effectiveCashFlows = trading212
              ? [
                  ...cashFlows.filter((flow) => flow.broker !== "trading212"),
                  ...trading212.cashFlows,
                ]
              : cashFlows;
            const effectiveCashCoverage = trading212
              ? [
                  ...cashCoverage.filter((entry) => entry.broker !== "trading212"),
                  trading212.coverage,
                ]
              : cashCoverage;
            const dashboard = await timing.measure("build", () =>
              buildInvestingDashboard({
                positions,
                trades,
                dividends,
                cashBalances,
                cashFlows: effectiveCashFlows,
                cashCoverage: effectiveCashCoverage,
                priceBars: prices.bars,
                benchmarkBars: benches.bars,
                benchmarkInstruments: selectedBenchmarks.map((benchmark) => ({
                  symbol: benchmark,
                  name: benchmarkDisplayName(benchmark),
                  exchange: "Yahoo Finance",
                  currency: benches.bars.find((bar) => bar.symbol === benchmark)?.currency ?? "EUR",
                })),
                presentationCurrency: "EUR",
                fxRates: [...historicalFx.rates, ...(latestFx.rate ? [latestFx.rate] : [])],
                selectedSymbol: symbol,
                problems: [
                  ...new Set([...problems, ...storedBrokerProblems]),
                  ...(trading212?.coverage.status === "unknown"
                    ? [`Trading 212 cash history unproven: ${trading212.coverage.reason}`]
                    : []),
                  ...refreshProblems,
                  ...priceProblems,
                  ...latestFx.problems,
                  ...historicalFx.problems,
                ],
                dataVersion: version,
              }),
            );
            /* A failed price or FX read is a problem of this moment, not of the
             * data; storing it would show it until the next sync. */
            const transientProblems =
              refreshProblems.length +
              priceProblems.length +
              latestFx.problems.length +
              historicalFx.problems.length;
            if (stored && transientProblems === 0)
              await timing.measure("store", () =>
                dashboardSnapshots
                  ?.put(storedKey, stored.version, dashboard)
                  .catch(() => undefined),
              );
            return dashboard;
          };
          return refreshProblems.length > 0
            ? buildDashboard()
            : dashboardCache.load({ tenantId, key: cacheKey }, buildDashboard);
        };

        const read = Effect.fn("PortfolioRead.read")(function* (input: PortfolioReadInput) {
          return yield* Effect.tryPromise({
            try: () => executeRead(input),
            catch: (cause) =>
              new PortfolioReadError({
                message:
                  cause instanceof Error ? cause.message : "Dashboard data could not be loaded",
                cause,
              }),
          });
        });

        return PortfolioRead.of({ read });
      }),
    );
}

/** Provide the module's layer for one runtime's already-built sources. */
export function portfolioReadLayer(
  sources: PortfolioReadSources,
): Layer.Layer<PortfolioRead, never, never> {
  return PortfolioRead.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(PortfolioReadPriceStore, sources.priceStore),
        Layer.succeed(PortfolioReadLoader, sources.loadBrokerData),
        Layer.succeed(PortfolioReadBrokerData, sources.brokerData),
        Layer.succeed(PortfolioReadBrokerSnapshot, sources.brokerSnapshot),
        Layer.succeed(PortfolioReadDashboardSnapshots, sources.dashboardSnapshots),
        Layer.succeed(PortfolioReadDashboardCache, sources.dashboardCache),
        Layer.succeed(PortfolioReadSyncState, sources.syncState),
        Layer.succeed(PortfolioReadFx, sources.fxProvider),
        Layer.succeed(PortfolioReadBenchmarks, sources.benchmarks),
        Layer.succeed(PortfolioReadPriceVersion, sources.priceDataVersion),
      ),
    ),
  );
}
