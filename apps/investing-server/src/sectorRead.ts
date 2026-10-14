import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import {
  buildSectorCoverage,
  buildSectorExposure,
  type InvestingDashboardData,
  type SectorCoverage,
  type SectorExposure,
  type SectorWeight,
} from "@lavega/core";
import { resolvePortfolioSectors, type SectorProfileLookup } from "./sectorResolution.js";
import type { SectorProfileStore } from "./inMemorySectorProfileStore.js";
import type { SectorCorrectionStore } from "./sectorCorrectionStore.js";
import type { SectorInferenceSettingStore } from "./sectorInferenceSetting.js";
import type { MarketDataConsentStore } from "./marketDataConsent.js";

/** The whole input one sector read takes. */
export type SectorReadInput = { tenantId: string };

export type SectorReadResult = {
  /** Value-weighted sector exposure over the current positions. */
  sectors: SectorExposure[];
  /** Share of priced value by source: provider, inferred, correction, unknown. */
  sectorCoverage: SectorCoverage;
  /** The sector-store revision the resolution was keyed on. A correction or
   *  inference-setting write raises it; a price or broker write does not. */
  revision: number;
};

export class SectorReadError extends Schema.TaggedError<SectorReadError>()("SectorReadError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

/**
 * What the read needs from its runtime. Every one of these is injected, so the
 * module holds no pool and no runtime of its own (see docs/investing/STACK.md
 * "Neon request lifecycle"). The gates — market-data consent, the inference
 * setting and the correction precedence — are applied here exactly as the
 * summary route applies them, so an inferred profile a tenant may not see still
 * reads as Unknown.
 */
export type SectorReadSources = {
  /** The tenant's current read model; the sector weights are value-weighted
   *  over the positions it carries. */
  dashboard: (tenantId: string) => Promise<InvestingDashboardData>;
  store: SectorProfileStore;
  /** Provider fallback, persisted for next time. Only ever reached when the
   *  tenant has given market-data consent. */
  fetchProfile: SectorProfileLookup;
  corrections: SectorCorrectionStore;
  inferenceSetting: SectorInferenceSettingStore;
  consent: MarketDataConsentStore;
  /** The sector-store revision, raised by correction and inference-setting writes. */
  revision: (tenantId: string) => Promise<number>;
  resolveListing: (tenantId: string, symbol: string) => Promise<string | null>;
};

export class SectorReadDashboard extends Context.Service<
  SectorReadDashboard,
  (tenantId: string) => Promise<InvestingDashboardData>
>()("lavega/investing/SectorRead/Dashboard") {}

export class SectorReadStore extends Context.Service<SectorReadStore, SectorProfileStore>()(
  "lavega/investing/SectorRead/Store",
) {}

export class SectorReadFetchProfile extends Context.Service<
  SectorReadFetchProfile,
  SectorProfileLookup
>()("lavega/investing/SectorRead/FetchProfile") {}

export class SectorReadCorrections extends Context.Service<
  SectorReadCorrections,
  SectorCorrectionStore
>()("lavega/investing/SectorRead/Corrections") {}

export class SectorReadInferenceSetting extends Context.Service<
  SectorReadInferenceSetting,
  SectorInferenceSettingStore
>()("lavega/investing/SectorRead/InferenceSetting") {}

export class SectorReadConsent extends Context.Service<SectorReadConsent, MarketDataConsentStore>()(
  "lavega/investing/SectorRead/Consent",
) {}

export class SectorReadRevision extends Context.Service<
  SectorReadRevision,
  (tenantId: string) => Promise<number>
>()("lavega/investing/SectorRead/Revision") {}

export class SectorReadListing extends Context.Service<
  SectorReadListing,
  (tenantId: string, symbol: string) => Promise<string | null>
>()("lavega/investing/SectorRead/Listing") {}

type SectorReadRequirements =
  | SectorReadDashboard
  | SectorReadStore
  | SectorReadFetchProfile
  | SectorReadCorrections
  | SectorReadInferenceSetting
  | SectorReadConsent
  | SectorReadRevision
  | SectorReadListing;

/** One tenant's cached resolution: the per-symbol weight vectors keyed on the
 *  revision (and the visibility flag) they were resolved under. */
type ResolvedCacheEntry = {
  key: string;
  weightsBySymbol: Map<string, SectorWeight[]>;
};

/** A sector read whose resolution cache is keyed by the sector-store revision,
 *  not by `dataVersion`. A correction or setting change raises the revision and
 *  forces a re-resolution; a price or broker write re-weights the exposure over
 *  the current positions while reusing the resolution it already holds. */
export class SectorRead extends Context.Service<
  SectorRead,
  { readonly read: (input: SectorReadInput) => Effect.Effect<SectorReadResult, SectorReadError> }
>()("lavega/investing/SectorRead") {
  static readonly layer: Layer.Layer<SectorRead, never, SectorReadRequirements> = Layer.effect(
    SectorRead,
    Effect.gen(function* () {
      const dashboard = yield* SectorReadDashboard;
      const store = yield* SectorReadStore;
      const fetchProfile = yield* SectorReadFetchProfile;
      const corrections = yield* SectorReadCorrections;
      const inferenceSetting = yield* SectorReadInferenceSetting;
      const consent = yield* SectorReadConsent;
      const revision = yield* SectorReadRevision;
      const resolveListing = yield* SectorReadListing;

      const cache = new Map<string, ResolvedCacheEntry>();

      const resolveWeights = async (
        tenantId: string,
        positions: readonly { symbol: string; marketValue: number | null; description?: string }[],
        gates: { consented: boolean; corrections: Record<string, string> },
      ): Promise<Map<string, SectorWeight[]>> => {
        const result = await resolvePortfolioSectors(positions, {
          store,
          correction: async (symbol) => gates.corrections[symbol.toUpperCase()] ?? null,
          showInferred: gates.consented,
          resolveListing: (symbol) => resolveListing(tenantId, symbol),
          ...(gates.consented ? { fetchProfile } : {}),
        });
        return result.weightsBySymbol;
      };

      const executeRead = async ({ tenantId }: SectorReadInput): Promise<SectorReadResult> => {
        const data = await dashboard(tenantId);
        const positions = data.positions;
        const current = await revision(tenantId);
        const consented = (await consent.get(tenantId)).accepted;
        const inferenceEnabled = await inferenceSetting.get(tenantId);
        const showInferred = consented && inferenceEnabled;
        const key = `${current}:${showInferred ? "1" : "0"}`;
        const cached = cache.get(tenantId);
        let weightsBySymbol: Map<string, SectorWeight[]>;
        if (cached && cached.key === key) {
          /* The revision (and visibility) held. Resolve only a symbol the
           * positions have gained since — a broker write can add a holding
           * without moving the sector revision. */
          const unseen = positions.filter(
            (position) =>
              position.marketValue !== null &&
              position.marketValue > 0 &&
              !cached.weightsBySymbol.has(position.symbol.toUpperCase()),
          );
          if (unseen.length === 0) {
            weightsBySymbol = cached.weightsBySymbol;
          } else {
            const correctionsForTenant = await corrections.getAll(tenantId);
            const resolved = await resolveWeights(tenantId, unseen, {
              consented,
              corrections: correctionsForTenant,
            });
            weightsBySymbol = new Map([...cached.weightsBySymbol, ...resolved]);
            cache.set(tenantId, { key, weightsBySymbol });
          }
        } else {
          const correctionsForTenant = await corrections.getAll(tenantId);
          weightsBySymbol = await resolveWeights(tenantId, positions, {
            consented,
            corrections: correctionsForTenant,
          });
          cache.set(tenantId, { key, weightsBySymbol });
        }
        return {
          sectors: buildSectorExposure(positions, weightsBySymbol),
          sectorCoverage: buildSectorCoverage(positions, weightsBySymbol),
          revision: current,
        };
      };

      const read = Effect.fn("SectorRead.read")(function* (input: SectorReadInput) {
        return yield* Effect.tryPromise({
          try: () => executeRead(input),
          catch: (cause) =>
            new SectorReadError({
              message: cause instanceof Error ? cause.message : "Sector data could not be loaded",
              cause,
            }),
        });
      });

      return SectorRead.of({ read });
    }),
  );
}

/** Provide the module's layer for one runtime's already-built sources. */
export function sectorReadLayer(
  sources: SectorReadSources,
): Layer.Layer<SectorRead, never, never> {
  return SectorRead.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(SectorReadDashboard, sources.dashboard),
        Layer.succeed(SectorReadStore, sources.store),
        Layer.succeed(SectorReadFetchProfile, sources.fetchProfile),
        Layer.succeed(SectorReadCorrections, sources.corrections),
        Layer.succeed(SectorReadInferenceSetting, sources.inferenceSetting),
        Layer.succeed(SectorReadConsent, sources.consent),
        Layer.succeed(SectorReadRevision, sources.revision),
        Layer.succeed(SectorReadListing, sources.resolveListing),
      ),
    ),
  );
}

/** Run the sector read for one tenant from an imperative boundary. */
export function createSectorReader(sources: SectorReadSources) {
  const runtime = ManagedRuntime.make(sectorReadLayer(sources));
  return (input: SectorReadInput): Promise<SectorReadResult> =>
    runtime.runPromise(SectorRead.use((read) => read.read(input)));
}

/** The read's type as an imperative boundary sees it. */
export type SectorReader = ReturnType<typeof createSectorReader>;

