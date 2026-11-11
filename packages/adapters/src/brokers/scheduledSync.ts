import type { BrokerCredentials, CredentialBroker, CredentialStore } from "@lavega/core";
import {
  createBrokerDataCache,
  type BrokerAccountSnapshot,
  type BrokerDataSnapshot,
} from "./brokerSnapshot.js";
import {
  historyPending,
  type BrokerAccessAdapter,
  type BrokerHistoryStream,
  type BrokerResult,
  type BrokerSyncLane,
  type BrokerSyncRequest,
  type BrokerSyncResume,
} from "./BrokerAccessAdapter.js";
import { TAIL_READ_STREAMS } from "./trading212/adapter.js";
import { isBrokerLeaseStale } from "./brokerSyncLease.js";

/** The brokers a scheduled sync knows how to drive. The type is derived from
 *  this list so a broker can only be added in one place. */
export const SCHEDULED_BROKERS = [
  "ibkr",
  "trading212",
] as const satisfies readonly CredentialBroker[];
export type ScheduledBroker = (typeof SCHEDULED_BROKERS)[number];
export type BrokerSyncState = {
  /** Kept: the last complete history run. Read by existing callers. */
  lastSyncedAt: string | null;
  /** Last complete holdings read (positions + cash), in the same row. */
  holdingsSyncedAt?: string | null;
  /** Last complete full read, per stream. */
  fullReadAt?: Partial<Record<BrokerHistoryStream, string>>;
  /** ISO timestamp the provider rate-limited us until. Survives `force`. */
  retryAfter?: string | null;
  /** Unfinished Trading 212 (or similar) pagination. Survives `force`. */
  resume?: BrokerSyncResume | null;
};

/** Holdings are cheap (two requests) and must be current when the user opens
 *  the dashboard, so they have their own short interval. `force` still keeps a
 *  5 s floor, because the account-summary endpoint allows 1 request / 5 s. */
export const HOLDINGS_MIN_INTERVAL_MS = 60_000;
export const HOLDINGS_FORCE_FLOOR_MS = 5_000;
/** A tail run reads one page per stream; it is cheap enough to run often. */
export const HISTORY_TAIL_INTERVAL_MS = 15 * 60_000;
/** A full history replay is expensive; once a month per stream is enough. */
export const HISTORY_FULL_INTERVAL_MS = 30 * 24 * 60 * 60_000;
export const IBKR_INTERVAL_MS = 24 * 60 * 60_000;
const HISTORY_STREAMS: readonly BrokerHistoryStream[] = ["orders", "transactions", "dividends"];

/** What a run tells the other instances about itself, durably. */
export type BrokerSyncStatus = "idle" | "running" | "waiting" | "completed" | "problem";
export type BrokerSyncProgressRecord = {
  status: BrokerSyncStatus;
  message: string | null;
  updatedAt: string | null;
  leaseId: string | null;
};

export type BrokerSyncClaim = {
  claimed: boolean;
  /** The committed cursor, read under the same claim that grants the right to move it. */
  state: BrokerSyncState;
  /** The committed broker data the run merges into. */
  data: BrokerAccountSnapshot | null;
  /** Which connection the credentials belong to, as of the claim. */
  credentialGeneration: number;
};

export type BrokerSyncCommit = {
  leaseId: string;
  credentialGeneration: number;
  state: BrokerSyncState;
  progress: BrokerSyncProgressRecord;
  data: BrokerAccountSnapshot | null;
};

/**
 * Broker synchronization as one operation a tenant owns.
 *
 * A run claims the broker, works, and commits broker data and cursor together
 * or not at all. The store is what makes that durable, so a second instance
 * sees the claim, an expired run cannot commit over a newer one, and a status
 * request answered anywhere reports the run that is actually happening.
 */
export interface BrokerSyncOperationStore {
  get(broker: ScheduledBroker): Promise<BrokerSyncState>;
  claim(
    broker: ScheduledBroker,
    input: { leaseId: string; staleBefore: string; progress: BrokerSyncProgressRecord },
  ): Promise<BrokerSyncClaim>;
  /** Heartbeat and status in one write. False once the lease is gone. */
  publish(
    broker: ScheduledBroker,
    leaseId: string,
    progress: BrokerSyncProgressRecord,
  ): Promise<boolean>;
  progress(broker: ScheduledBroker): Promise<BrokerSyncProgressRecord | null>;
  commit(broker: ScheduledBroker, input: BrokerSyncCommit): Promise<boolean>;
  release(
    broker: ScheduledBroker,
    leaseId: string,
    progress: BrokerSyncProgressRecord,
  ): Promise<void>;
}

/** A lease this old belonged to a worker that is not coming back. */
export const BROKER_SYNC_LEASE_TTL_MS = 15 * 60 * 1000;

/** A slow broker read is still alive. Renewing the lease while the adapter
 *  works closes the takeover gap: another instance cannot decide this run is
 *  dead 15 minutes in while it is merely paginating a large history. */
export const BROKER_SYNC_HEARTBEAT_MS = 10_000;

/** The whole store for a single process that keeps its state in memory. */
export function createMemoryBrokerSyncStateStore(): BrokerSyncOperationStore {
  const states = new Map<ScheduledBroker, BrokerSyncState>();
  const data = new Map<ScheduledBroker, BrokerAccountSnapshot | null>();
  const leases = new Map<ScheduledBroker, { id: string; heartbeatAt: string }>();
  const reports = new Map<ScheduledBroker, BrokerSyncProgressRecord>();
  return {
    async get(broker) {
      return states.get(broker) ?? { lastSyncedAt: null, retryAfter: null };
    },
    async claim(broker, input) {
      const held = leases.get(broker);
      const live = held != null && !isBrokerLeaseStale(held.heartbeatAt, input.staleBefore);
      if (!live) {
        leases.set(broker, {
          id: input.leaseId,
          heartbeatAt: input.progress.updatedAt ?? new Date().toISOString(),
        });
        reports.set(broker, input.progress);
      }
      return {
        claimed: !live,
        state: states.get(broker) ?? { lastSyncedAt: null, retryAfter: null },
        data: data.get(broker) ?? null,
        credentialGeneration: 1,
      };
    },
    async publish(broker, leaseId, progress) {
      if (leases.get(broker)?.id !== leaseId) return false;
      leases.set(broker, {
        id: leaseId,
        heartbeatAt: progress.updatedAt ?? new Date().toISOString(),
      });
      reports.set(broker, progress);
      return true;
    },
    async progress(broker) {
      return reports.get(broker) ?? null;
    },
    async commit(broker, input) {
      if (leases.get(broker)?.id !== input.leaseId) return false;
      if (input.data !== null) data.set(broker, input.data);
      states.set(broker, input.state);
      reports.set(broker, input.progress);
      leases.delete(broker);
      return true;
    },
    async release(broker, leaseId, progress) {
      if (leases.get(broker)?.id !== leaseId) return;
      leases.delete(broker);
      reports.set(broker, progress);
    },
  };
}

export type ScheduledBrokerAdapter = {
  broker: ScheduledBroker;
  adapter: BrokerAccessAdapter;
};

export type BrokerSyncOutcome = {
  broker: ScheduledBroker;
  status: "synced" | "skipped" | "problem";
  lastSyncedAt: string | null;
  result: BrokerResult | null;
};

export type ScheduledSyncResult = {
  outcomes: BrokerSyncOutcome[];
  problems: string[];
  /** What this run stored, per broker, for a caller that keeps a copy in memory.
   *  A broker nobody committed to is absent rather than empty. */
  committed: BrokerDataSnapshot;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function readableError(error: unknown, broker: ScheduledBroker): string {
  return error instanceof Error ? error.message : `${broker} sync failed`;
}

function ageMs(iso: string | null | undefined, now: Date): number | null {
  if (iso == null) return null;
  const parsed = new Date(iso).getTime();
  return Number.isFinite(parsed) ? now.getTime() - parsed : null;
}

function olderThan(iso: string | null | undefined, intervalMs: number, now: Date): boolean {
  const age = ageMs(iso, now);
  return age === null || age >= intervalMs;
}

function streamComplete(
  resume: BrokerSyncResume | undefined,
  stream: BrokerHistoryStream,
): boolean {
  if (stream === "orders") return resume?.ordersComplete === true;
  if (stream === "transactions") return resume?.transactionsComplete === true;
  return resume?.dividendsComplete === true;
}

function streamCursor(
  resume: BrokerSyncResume | undefined,
  stream: BrokerHistoryStream,
): string | null {
  if (stream === "orders") return resume?.ordersNextPagePath ?? null;
  if (stream === "transactions") return resume?.transactionsNextPagePath ?? null;
  return resume?.dividendsNextPagePath ?? null;
}

function streamStatus(result: BrokerResult, stream: BrokerHistoryStream) {
  if (stream === "orders") return result.sections.trades.status;
  if (stream === "transactions") return result.sections.cashFlows.status;
  return result.sections.dividends.status;
}

/** What one claimed broker produced: the report, and the cursor to store with it. */
type ClaimedRun = { outcome: BrokerSyncOutcome; state: BrokerSyncState | null };

function progressFor(
  leaseId: string,
  updatedAt: string,
  run: ClaimedRun,
  problem: string | null,
): BrokerSyncProgressRecord {
  const waiting = run.state?.retryAfter != null || run.state?.resume != null;
  // A skip with nothing to report (recently synced, or never configured) is
  // not a problem: only a run that actually pushed a problem message earns
  // that status, so the store never carries "problem" with `message: null`.
  const status: BrokerSyncStatus = waiting ? "waiting" : problem == null ? "completed" : "problem";
  return { status, message: problem, updatedAt, leaseId };
}

/** The committed broker data with this run's sections merged into it. */
function mergeIntoClaim(claim: BrokerSyncClaim, outcome: BrokerSyncOutcome) {
  if (outcome.result === null) return claim.data;
  const cache = createBrokerDataCache(claim.data ? { [outcome.broker]: claim.data } : {});
  cache.apply({ outcomes: [outcome], problems: [] });
  return cache.snapshot()[outcome.broker] ?? null;
}

export async function syncScheduledBrokers(input: {
  adapters: ScheduledBrokerAdapter[];
  credentials: CredentialStore;
  operations: BrokerSyncOperationStore;
  tenantId: string;
  entity: string;
  /** Which freshness lanes this run may read. Required: every caller states
   *  its intent, so an app open cannot accidentally replay full history. */
  lanes: readonly BrokerSyncLane[];
  force?: boolean;
  rebuildOrders?: boolean;
  now?: Date;
  deadlineMs?: BrokerSyncRequest["deadlineMs"];
  leaseId?: () => string;
}): Promise<ScheduledSyncResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - BROKER_SYNC_LEASE_TTL_MS).toISOString();
  const outcomes: BrokerSyncOutcome[] = [];
  const problems: string[] = [];
  const committed: BrokerDataSnapshot = {};

  /* Everything between the claim and the commit. Kept separate so the loop
   * below can commit or release on every exit, including the early ones. */
  async function work(entry: ScheduledBrokerAdapter, claim: BrokerSyncClaim): Promise<ClaimedRun> {
    const broker = entry.broker;
    const prior = claim.state;
    const lastSyncedAt = prior.lastSyncedAt;
    const retryAfter = prior.retryAfter ?? null;
    const skipped = (): ClaimedRun => ({
      outcome: { broker, status: "skipped", lastSyncedAt, result: null },
      state: null,
    });
    const failed = (message: string): ClaimedRun => {
      problems.push(`${broker}: ${message}`);
      return { outcome: { broker, status: "problem", lastSyncedAt, result: null }, state: null };
    };

    // A provider cooldown outranks `force`. Forcing through it only spends more
    // rejected requests and pushes the window further out.
    if (retryAfter != null && now.getTime() < new Date(retryAfter).getTime()) {
      problems.push(`${broker}: rate-limited by the broker until ${retryAfter}`);
      return skipped();
    }

    // One Flex statement carries holdings and history together, so the
    // holdings lane alone has nothing to read for IBKR.
    if (broker === "ibkr" && !input.lanes.includes("history")) return skipped();

    const dueLanes: BrokerSyncLane[] = [];
    if (broker === "ibkr") {
      if (
        input.lanes.includes("history") &&
        (input.force || olderThan(lastSyncedAt, IBKR_INTERVAL_MS, now))
      )
        dueLanes.push("history");
    } else {
      const holdingsAge = ageMs(prior.holdingsSyncedAt, now);
      const holdingsFloor = input.force ? HOLDINGS_FORCE_FLOOR_MS : HOLDINGS_MIN_INTERVAL_MS;
      if (
        input.lanes.includes("holdings") &&
        (holdingsAge === null || holdingsAge >= holdingsFloor)
      )
        dueLanes.push("holdings");
      // A resume cursor means unfinished pagination, which is always due: the
      // data is half-read and waiting the tail interval would leave it so.
      if (
        input.lanes.includes("history") &&
        (prior.resume != null ||
          input.force ||
          olderThan(lastSyncedAt, HISTORY_TAIL_INTERVAL_MS, now))
      )
        dueLanes.push("history");
    }
    if (dueLanes.length === 0) return skipped();

    let credentials: BrokerCredentials | null;
    try {
      credentials = await input.credentials.getCredentials(input.tenantId, broker);
    } catch (error) {
      return failed(readableError(error, broker));
    }
    // No credentials means this broker was never set up: not a sync failure,
    // so it must not appear in `problems`. A broker that WAS configured and
    // then became unreadable (corrupted row, lost decryption key) does not
    // reach here — `getCredentials` throws instead of returning null, and
    // that throw is caught above as a real, retryable `failed`.
    if (credentials == null) return skipped();

    const historical = dueLanes.includes("history");
    const resumeFromState = prior.resume ?? undefined;
    const resume = input.rebuildOrders
      ? (resumeFromState ?? {
          ordersComplete: false,
          transactionsComplete: true,
          dividendsComplete: true,
        })
      : resumeFromState;
    let fullReadStreams: readonly BrokerHistoryStream[] | undefined;
    let knownHistory: BrokerSyncRequest["knownHistory"];
    if (historical) {
      if (input.rebuildOrders) {
        fullReadStreams = ["orders"];
      } else {
        fullReadStreams = HISTORY_STREAMS.filter((stream) => {
          // A resumed stream continues its cursor; the full/tail decision for
          // it was made when that read started.
          if (streamComplete(resume, stream) || streamCursor(resume, stream)) return false;
          const interval = TAIL_READ_STREAMS.includes(stream) ? HISTORY_FULL_INTERVAL_MS : DAY_MS;
          return olderThan(prior.fullReadAt?.[stream], interval, now);
        });
      }
      if (claim.data && fullReadStreams.length < HISTORY_STREAMS.length) {
        knownHistory = {
          tradeIds: new Set((claim.data.trades ?? []).map((trade) => trade.id)),
          cashFlowIds: new Set((claim.data.cashFlows ?? []).map((flow) => flow.id)),
          dividendIds: new Set((claim.data.dividends ?? []).map((dividend) => dividend.id)),
        };
      }
    }

    let result: BrokerResult;
    try {
      result = await entry.adapter.sync({
        entity: input.entity,
        lanes: dueLanes,
        ...(historical
          ? {
              resume,
              ...(fullReadStreams ? { fullReadStreams } : {}),
              ...(knownHistory ? { knownHistory } : {}),
            }
          : {}),
        deadlineMs: input.deadlineMs,
      });
    } catch (error) {
      return failed(readableError(error, broker));
    }

    const holdingsDelivered =
      dueLanes.includes("holdings") &&
      result.sections.positions.status === "complete" &&
      result.sections.cashBalances.status === "complete";
    const requestedStreams = historical
      ? input.rebuildOrders
        ? (["orders"] as const)
        : HISTORY_STREAMS.filter((stream) => !streamComplete(resume, stream))
      : [];
    const historyDelivered =
      historical && requestedStreams.every((stream) => streamStatus(result, stream) === "complete");
    const nextResume = historyPending(result.resume) ? (result.resume ?? null) : null;
    const delivered = historyDelivered && !nextResume;

    const nextHoldings = holdingsDelivered ? nowIso : (prior.holdingsSyncedAt ?? null);
    const nextFullReadAt: Partial<Record<BrokerHistoryStream, string>> = {
      ...prior.fullReadAt,
    };
    for (const stream of result.fullStreams ?? []) nextFullReadAt[stream] = nowIso;
    const advanced: BrokerSyncState = {
      lastSyncedAt: delivered ? nowIso : lastSyncedAt,
      ...(nextHoldings !== null ? { holdingsSyncedAt: nextHoldings } : {}),
      ...(Object.keys(nextFullReadAt).length > 0 ? { fullReadAt: nextFullReadAt } : {}),
    };

    if (result.problems.length > 0) {
      problems.push(...result.problems.map((problem) => `${broker}: ${problem}`));
      // Only a rate limit gets a cooldown. Every other problem (missing
      // credentials above all) must stay retryable, or saving credentials would
      // not be able to trigger the sync that follows it.
      // Unfinished pagination is not "delivered": the next run must continue
      // the cursor instead of waiting for the lane interval.
      return {
        outcome: {
          broker,
          status: "problem",
          lastSyncedAt: delivered ? nowIso : lastSyncedAt,
          result,
        },
        state: {
          ...(delivered
            ? advanced
            : {
                lastSyncedAt,
                ...(nextHoldings !== null ? { holdingsSyncedAt: nextHoldings } : {}),
              }),
          retryAfter: result.retryAfter ?? null,
          resume: nextResume,
        },
      };
    }
    if (nextResume)
      return {
        outcome: { broker, status: "problem", lastSyncedAt, result },
        state: { ...advanced, retryAfter: result.retryAfter ?? null, resume: nextResume },
      };
    return {
      outcome: {
        broker,
        status: "synced",
        lastSyncedAt: historyDelivered ? nowIso : lastSyncedAt,
        result,
      },
      state: { ...advanced, retryAfter: null, resume: null },
    };
  }

  for (const entry of input.adapters) {
    const leaseId = input.leaseId?.() ?? crypto.randomUUID();
    const claim = await input.operations.claim(entry.broker, {
      leaseId,
      staleBefore,
      progress: { status: "running", message: null, updatedAt: nowIso, leaseId },
    });
    if (!claim.claimed) {
      // Not a failure: another run owns this broker, and its progress is what a
      // status request should report.
      const held = await input.operations.progress(entry.broker);
      problems.push(
        `${entry.broker}: a synchronization is already running${
          held?.message ? ` (${held.message})` : ""
        }`,
      );
      outcomes.push({
        broker: entry.broker,
        status: "skipped",
        lastSyncedAt: claim.state.lastSyncedAt,
        result: null,
      });
      continue;
    }

    const before = problems.length;
    /* The claim is held across the whole read, so heartbeat it while the
     * adapter works. A publish that loses the lease is not an error here: the
     * commit below reports it and the result is discarded. */
    const heartbeat = setInterval(() => {
      void input.operations
        .publish(entry.broker, leaseId, {
          status: "running",
          message: null,
          updatedAt: new Date().toISOString(),
          leaseId,
        })
        .catch(() => undefined);
    }, BROKER_SYNC_HEARTBEAT_MS);
    (heartbeat as { unref?: () => void }).unref?.();
    let run: ClaimedRun;
    try {
      run = await work(entry, claim).catch((error): ClaimedRun => {
        problems.push(`${entry.broker}: ${readableError(error, entry.broker)}`);
        return {
          outcome: {
            broker: entry.broker,
            status: "problem",
            lastSyncedAt: claim.state.lastSyncedAt,
            result: null,
          },
          state: null,
        };
      });
    } finally {
      clearInterval(heartbeat);
    }
    const progress = progressFor(leaseId, nowIso, run, problems[before] ?? null);

    if (run.state === null) {
      await input.operations.release(entry.broker, leaseId, progress);
      outcomes.push(run.outcome);
      continue;
    }
    const data = mergeIntoClaim(claim, run.outcome);
    const stored = await input.operations.commit(entry.broker, {
      leaseId,
      credentialGeneration: claim.credentialGeneration,
      state: run.state,
      progress,
      data,
    });
    if (!stored) {
      // The lease expired, or the broker was reconnected while this ran. The
      // result belongs to a run or an account that is no longer current.
      await input.operations.release(entry.broker, leaseId, progress);
      problems.push(`${entry.broker}: the result was discarded, this run is no longer current`);
      outcomes.push({
        broker: entry.broker,
        status: "skipped",
        lastSyncedAt: claim.state.lastSyncedAt,
        result: null,
      });
      continue;
    }
    if (data) committed[entry.broker] = data;
    outcomes.push(run.outcome);
  }

  return { outcomes, problems, committed };
}
