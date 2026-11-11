import {
  createAgentRunRepository,
  createBrokerSyncOperationRepository,
  createPersonalNetWorthRepository,
  createPreferencesRepository,
  createPartnerBudgetRepository,
  createPriceSyncStateRepository,
  createSharedPriceRepository,
  createSyncStateRepository,
  type Database,
} from "@lavega/database";
import type { Layer } from "effect";
import { PartnerBudget } from "@lavega/adapters";
import type { PersonalNetWorthStore, PersonalNetWorthTotal } from "./personalNetWorthStore.js";
import {
  validateAccountWrapperMap,
  validateBenchmarkSymbols,
  validateInvestingLayout,
  type AccountWrapperStore,
  type BenchmarkSelectionStore,
  type InvestingLayoutStore,
} from "@lavega/core";
import {
  YAHOO_DISCLOSURE_VERSION,
  type MarketDataConsentDecision,
  type MarketDataConsentStore,
} from "./marketDataConsent.js";
import type { SectorCorrectionStore } from "./sectorCorrectionStore.js";
import type { SectorInferenceSettingStore } from "./sectorInferenceSetting.js";
import {
  validateIdentifierOverrides,
  type IdentifierOverrideStore,
  type IdentifierSelectionSettingStore,
} from "./identifierSelectionStore.js";
import type { AgentRunRecord, AgentRunStore } from "./fileAgentRunStore.js";
import type {
  BrokerAccountSnapshot,
  BrokerSyncOperationStore,
  ScheduledBroker,
  SharedPriceBar,
  SharedPriceCoverage,
  SharedPriceStore,
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

/**
 * The shared, instrument-keyed price store (issue #307). The SQL lives in
 * `@lavega/database`; this maps a stored row to the contract's row shape, which
 * carries no instrument key and no symbol (the series is the key; the reader
 * supplies its own symbol).
 */
export function createNeonSharedPriceStore(db: Database): SharedPriceStore {
  const repository = createSharedPriceRepository(db);
  const bar = ({ instrumentKey: _key, ...rest }: { instrumentKey: string } & SharedPriceBar) =>
    rest;
  return {
    async getRange(key, from, to) {
      return (await repository.getRange(key, from, to)).map(bar);
    },
    async getRanges(keys) {
      const grouped = await repository.getRanges(keys);
      return new Map([...grouped].map(([key, rows]) => [key, rows.map(bar)]));
    },
    lastDate: (key) => repository.lastDate(key),
    upsert: (instrumentKey, bars) =>
      repository.upsert(
        instrumentKey,
        bars.map((row) => ({ ...row, instrumentKey })),
      ),
    replaceRange: (instrumentKey, bars, from, to) =>
      repository.replaceRange(
        instrumentKey,
        bars.map((row) => ({ ...row, instrumentKey })),
        from,
        to,
      ),
    async getCoverage(key): Promise<SharedPriceCoverage | null> {
      const row = await repository.getCoverage(key);
      if (!row) return null;
      const { instrumentKey: _key, ...coverage } = row;
      return coverage;
    },
    putCoverage: (instrumentKey, coverage) =>
      repository.putCoverage(instrumentKey, { ...coverage, instrumentKey }),
    latestChange: (instrumentKeys) => repository.latestChange(instrumentKeys),
    adoptAlias: (key, alias) => repository.adoptAlias(key, alias),
    claim: (key, owner, ttlMs) => repository.claim(key, owner, ttlMs),
    release: (key, owner) => repository.release(key, owner),
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

/** Investing's read side only — Personal owns every write to this table
 *  (personal.net_worth_totals), through apps/server's own repository call. */
export function createNeonPersonalNetWorthStore(db: Database): PersonalNetWorthStore {
  return {
    list: async (tenantId) =>
      (await createPersonalNetWorthRepository(db, tenantId).list()).map((row) => ({
        date: row.date,
        totalCents: row.totalCents,
        /* Stored rows are validated before they are written (#300 WS5.5); this
         * is a trust-the-database cast, not a second decode. */
        ...(row.provenance
          ? { provenance: row.provenance as PersonalNetWorthTotal["provenance"] }
          : {}),
      })),
  };
}

export function createNeonInvestingLayoutStore(db: Database): InvestingLayoutStore {
  return {
    async get(tenantId) {
      const stored = await createPreferencesRepository(db, tenantId).getLayout();
      return validateInvestingLayout(stored);
    },
    async set(selection) {
      await createPreferencesRepository(db, selection.tenantId).setLayout(
        validateInvestingLayout(selection),
      );
    },
  };
}

/** Account tax-treatment labels (plan §3 WS4.4, #296). They ride the same
 *  per-tenant preferences row as the layout, so the existing RLS policy scopes
 *  them and an unknown label is dropped on read instead of trusted. */
export function createNeonAccountWrapperStore(db: Database): AccountWrapperStore {
  return {
    async get(tenantId) {
      const stored = await createPreferencesRepository(db, tenantId).getAccountWrappers();
      return validateAccountWrapperMap(stored);
    },
    async set(selection) {
      await createPreferencesRepository(db, selection.tenantId).setAccountWrappers(
        validateAccountWrapperMap(selection.entries),
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

export function createNeonSectorCorrectionStore(db: Database): SectorCorrectionStore {
  const key = (symbol: string) => symbol.toUpperCase();
  return {
    async get(tenantId, symbol) {
      const corrections = await createPreferencesRepository(db, tenantId).getSectorCorrections();
      return corrections[key(symbol)] ?? null;
    },
    getAll: (tenantId) => createPreferencesRepository(db, tenantId).getSectorCorrections(),
    set: (tenantId, symbol, sector) =>
      createPreferencesRepository(db, tenantId).setSectorCorrection(symbol, sector),
    clear: (tenantId, symbol) =>
      createPreferencesRepository(db, tenantId).clearSectorCorrection(symbol),
  };
}

export function createNeonSectorInferenceSettingStore(db: Database): SectorInferenceSettingStore {
  return {
    get: (tenantId) => createPreferencesRepository(db, tenantId).getSectorInferenceEnabled(),
    set: (tenantId, enabled) =>
      createPreferencesRepository(db, tenantId).setSectorInferenceEnabled(enabled),
  };
}

/** The identifier-selection switch and the owner's symbol overrides (Jev-03,
 *  issue #136), on the same per-tenant preferences row as the other switches. */
export function createNeonIdentifierSelectionSettingStore(
  db: Database,
): IdentifierSelectionSettingStore {
  return {
    get: (tenantId) => createPreferencesRepository(db, tenantId).getIdentifierSelectionEnabled(),
    set: (tenantId, enabled) =>
      createPreferencesRepository(db, tenantId).setIdentifierSelectionEnabled(enabled),
  };
}

export function createNeonIdentifierOverrideStore(db: Database): IdentifierOverrideStore {
  return {
    async get(tenantId) {
      const stored = await createPreferencesRepository(db, tenantId).getIdentifierOverrides();
      return validateIdentifierOverrides(stored);
    },
    async set(tenantId, map) {
      await createPreferencesRepository(db, tenantId).setIdentifierOverrides(
        validateIdentifierOverrides(map),
      );
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

export function createNeonAgentRunStore(db: Database, tenantId: string): AgentRunStore {
  const repository = createAgentRunRepository(db, tenantId);
  return {
    async get(): Promise<AgentRunRecord | null> {
      return repository.get();
    },
    start: (record) => repository.start(record),
    finish: (record) => repository.finish(record),
  };
}

/** The hosted partner request budget: slots come from `investing.partner_budgets`,
 *  so every invocation and every tenant counts against the same partner limits.
 *  Built per request from the request-scoped pool, like the stores above. */
export function createNeonPartnerBudget(db: Database): Layer.Layer<PartnerBudget> {
  return PartnerBudget.storeLayer(createPartnerBudgetRepository(db));
}
