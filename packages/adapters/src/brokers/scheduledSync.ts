import type { BrokerCredentials, CredentialBroker, CredentialStore } from "@lavega/core";
import {
  createBrokerDataCache,
  type BrokerAccountSnapshot,
  type BrokerDataSnapshot,
} from "./brokerSnapshot.js";
import {
  historyPending,
  type BrokerAccessAdapter,
  type BrokerResult,
  type BrokerSyncRequest,
  type BrokerSyncResume,
} from "./BrokerAccessAdapter.js";

/** The brokers a scheduled sync knows how to drive. The type is derived from
 *  this list so a broker can only be added in one place. */
export const SCHEDULED_BROKERS = [
  "ibkr",
  "trading212",
] as const satisfies readonly CredentialBroker[];
export type ScheduledBroker = (typeof SCHEDULED_BROKERS)[number];
export type BrokerSyncState = {
  lastSyncedAt: string | null;
  /** ISO timestamp the provider rate-limited us until. Survives `force`. */
  retryAfter?: string | null;
  /** Unfinished Trading 212 (or similar) pagination. Survives `force`. */
  resume?: BrokerSyncResume | null;
};

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
      /* Compared as instants: ISO strings only sort correctly while every one
       * of them has four digits of year and the same zone. */
      const live = held != null && Date.parse(held.heartbeatAt) >= Date.parse(input.staleBefore);
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

/** What one claimed broker produced: the report, and the cursor to store with it. */
type ClaimedRun = { outcome: BrokerSyncOutcome; state: BrokerSyncState | null };

function progressFor(
  leaseId: string,
  updatedAt: string,
  run: ClaimedRun,
  problem: string | null,
): BrokerSyncProgressRecord {
  const waiting = run.state?.retryAfter != null || run.state?.resume != null;
  const status: BrokerSyncStatus =
    run.outcome.status === "synced" ? "completed" : waiting ? "waiting" : "problem";
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
  force?: boolean;
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
    const lastSyncedAt = claim.state.lastSyncedAt;
    const retryAfter = claim.state.retryAfter ?? null;
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
    const recent =
      lastSyncedAt != null && now.getTime() - new Date(lastSyncedAt).getTime() < DAY_MS;
    if (!input.force && recent) return skipped();

    let credentials: BrokerCredentials | null;
    try {
      credentials = await input.credentials.getCredentials(input.tenantId, broker);
    } catch (error) {
      return failed(readableError(error, broker));
    }
    if (credentials == null) return failed("credentials are not configured");

    let result: BrokerResult;
    try {
      result = await entry.adapter.sync({
        entity: input.entity,
        resume: claim.state.resume ?? undefined,
        deadlineMs: input.deadlineMs,
      });
    } catch (error) {
      return failed(readableError(error, broker));
    }

    const resume = historyPending(result.resume) ? (result.resume ?? null) : null;
    if (result.problems.length > 0) {
      problems.push(...result.problems.map((problem) => `${broker}: ${problem}`));
      // Only a rate limit gets a cooldown. Every other problem (missing
      // credentials above all) must stay retryable, or saving credentials would
      // not be able to trigger the sync that follows it.
      if (result.retryAfter)
        return {
          outcome: { broker, status: "problem", lastSyncedAt, result },
          state: { lastSyncedAt, retryAfter: result.retryAfter, resume },
        };
      // A run that delivered a complete data set is done, even if single rows
      // were unreadable. Leaving `lastSyncedAt` unset over a row problem made
      // the next app open replay the entire Trading 212 order history — six
      // requests per minute, restarting the moment it finished.
      // Unfinished pagination is not "delivered": the next run must continue
      // the cursor instead of waiting 24 hours.
      const delivered =
        Object.values(result.sections).every((section) => section.status !== "unavailable") &&
        result.sections.trades.status !== "partial" &&
        !resume;
      return {
        outcome: {
          broker,
          status: "problem",
          lastSyncedAt: delivered ? nowIso : lastSyncedAt,
          result,
        },
        state: delivered
          ? { lastSyncedAt: nowIso, retryAfter: null, resume: null }
          : { lastSyncedAt, retryAfter: result.retryAfter ?? null, resume },
      };
    }
    if (resume)
      return {
        outcome: { broker, status: "problem", lastSyncedAt, result },
        state: { lastSyncedAt, retryAfter: result.retryAfter ?? null, resume },
      };
    return {
      outcome: { broker, status: "synced", lastSyncedAt: nowIso, result },
      state: { lastSyncedAt: nowIso, retryAfter: null, resume: null },
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
    const run = await work(entry, claim).catch((error): ClaimedRun => {
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
