import {
  createAgentRunRepository,
  createBrokerSyncOperationRepository,
  createPreferencesRepository,
  createPriceBarRepository,
  createPriceSyncStateRepository,
  createSyncStateRepository,
  type Database,
} from "@lavega/database";
import { validateBenchmarkSymbols, type BenchmarkSelectionStore } from "@lavega/core";
import {
  YAHOO_DISCLOSURE_VERSION,
  type MarketDataConsentDecision,
  type MarketDataConsentStore,
} from "./marketDataConsent.js";
import type { AgentRunRecord, AgentRunStore } from "./fileAgentRunStore.js";
import type {
  BrokerAccountSnapshot,
  BrokerSyncOperationStore,
  PriceStore,
  ScheduledBroker,
} from "@lavega/adapters";
import type { PriceSyncProgress, PriceSyncProgressStore } from "./priceOrchestrator.js";

/**
 * The Neon side of the runtime's stores.
 *
 * Each one is thin on purpose: the SQL and the row-level-security contract live
 * in `@lavega/database`, and these only translate between that and the store
 * interfaces the app already had. The stores that take a `tenantId` per call
 * build their repository per call — a repository is a closure over the pool, so
 * that costs nothing and keeps the interfaces unchanged.
 */

export function createNeonPriceStore(
  db: Database,
  resolveTenantId: () => string | Promise<string>,
): PriceStore {
  return {
    getRanges: (tenantId, symbols) => createPriceBarRepository(db, tenantId).getRanges(symbols),
    getRange: (tenantId, symbol, from, to) =>
      createPriceBarRepository(db, tenantId).getRange(symbol, from, to),
    lastDate: (tenantId, symbol) => createPriceBarRepository(db, tenantId).lastDate(symbol),
    upsert: (tenantId, bars) => createPriceBarRepository(db, tenantId).upsert(bars),
    async purgeAll() {
      // No tenant in the signature, so the caller's own is the only safe one.
      await createPriceBarRepository(db, await resolveTenantId()).purgeAll();
    },
  };
}

export function createNeonBenchmarkSelectionStore(db: Database): BenchmarkSelectionStore {
  return {
    async get(tenantId) {
      return {
        tenantId,
        symbols: validateBenchmarkSymbols(
          await createPreferencesRepository(db, tenantId).getBenchmarkSymbols(),
        ),
      };
    },
    async set(selection) {
      await createPreferencesRepository(db, selection.tenantId).setBenchmarkSymbols(
        validateBenchmarkSymbols(selection.symbols),
      );
    },
  };
}

export function createNeonMarketDataConsentStore(db: Database): MarketDataConsentStore {
  return {
    async get(tenantId) {
      const stored = (await createPreferencesRepository(
        db,
        tenantId,
      ).getMarketDataConsent()) as Partial<MarketDataConsentDecision> | null;
      /* Consent is to a specific disclosure. An older version is not consent to
       * this one, so it reads as no decision at all rather than as a yes. */
      return stored?.disclosureVersion === YAHOO_DISCLOSURE_VERSION &&
        typeof stored.accepted === "boolean"
        ? {
            tenantId,
            accepted: stored.accepted,
            decidedAt: stored.decidedAt ?? null,
            disclosureVersion: YAHOO_DISCLOSURE_VERSION,
          }
        : {
            tenantId,
            accepted: false,
            decidedAt: null,
            disclosureVersion: YAHOO_DISCLOSURE_VERSION,
          };
    },
    async set(decision) {
      await createPreferencesRepository(db, decision.tenantId).setMarketDataConsent(decision);
    },
  };
}

export function createNeonBrokerSyncStateStore(
  db: Database,
  tenantId: string,
): BrokerSyncOperationStore {
  const state = createSyncStateRepository(db, tenantId);
  const operations = createBrokerSyncOperationRepository(db, tenantId);
  return {
    get: (broker: ScheduledBroker) => state.get(broker),
    async claim(broker, input) {
      const claim = await operations.claim(broker, input);
      return { ...claim, data: (claim.snapshot as BrokerAccountSnapshot | null) ?? null };
    },
    publish: (broker, leaseId, progress) => operations.publish(broker, leaseId, progress),
    progress: (broker) => operations.progress(broker),
    commit: (broker, input) =>
      operations.commit(broker, {
        leaseId: input.leaseId,
        state: input.state,
        progress: input.progress,
        snapshot: input.data
          ? { value: input.data, credentialGeneration: input.credentialGeneration }
          : undefined,
      }),
    release: (broker, leaseId, progress) => operations.release(broker, leaseId, progress),
  };
}

export function createNeonPriceSyncProgressStore(db: Database): PriceSyncProgressStore {
  return {
    get: async (tenantId) =>
      (await createPriceSyncStateRepository(db, tenantId).get()) as PriceSyncProgress | null,
    put: (tenantId, progress, leaseId) =>
      createPriceSyncStateRepository(db, tenantId).put(progress, progress.status, leaseId),
    claim: async (tenantId, progress, staleBefore) =>
      (await createPriceSyncStateRepository(db, tenantId).claim(
        progress,
        progress.status,
        staleBefore,
      )) as PriceSyncProgress | null,
  };
}

export function createNeonAgentRunStore(
  db: Database,
  resolveTenantId: () => string | Promise<string>,
): AgentRunStore {
  return {
    async get(): Promise<AgentRunRecord | null> {
      return createAgentRunRepository(db, await resolveTenantId()).get();
    },
    async put(record: AgentRunRecord): Promise<void> {
      await createAgentRunRepository(db, await resolveTenantId()).put(record);
    },
  };
}
