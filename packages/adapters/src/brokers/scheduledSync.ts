import type { BrokerCredentials, CredentialBroker, CredentialStore } from "@lavega/core";
import {
  cashBalancesComplete,
  historyPending,
  positionsComplete,
  tradesComplete,
  type BrokerAccessAdapter,
  type BrokerResult,
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

export interface BrokerSyncStateStore {
  get(broker: ScheduledBroker): Promise<BrokerSyncState>;
  put(broker: ScheduledBroker, state: BrokerSyncState): Promise<void>;
}

export function createMemoryBrokerSyncStateStore(): BrokerSyncStateStore {
  const states = new Map<ScheduledBroker, BrokerSyncState>();
  return {
    async get(broker) {
      return states.get(broker) ?? { lastSyncedAt: null, retryAfter: null };
    },
    async put(broker, state) {
      states.set(broker, state);
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
};

const DAY_MS = 24 * 60 * 60 * 1000;

function readableError(error: unknown, broker: ScheduledBroker): string {
  return error instanceof Error ? error.message : `${broker} sync failed`;
}

export async function syncScheduledBrokers(input: {
  adapters: ScheduledBrokerAdapter[];
  credentials: CredentialStore;
  state: BrokerSyncStateStore;
  tenantId: string;
  entity: string;
  force?: boolean;
  now?: Date;
}): Promise<ScheduledSyncResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const outcomes: BrokerSyncOutcome[] = [];
  const problems: string[] = [];

  for (const entry of input.adapters) {
    const previous = await input.state.get(entry.broker);
    const lastSyncedAt = previous.lastSyncedAt;
    const retryAfter = previous.retryAfter ?? null;
    // A provider cooldown outranks `force`. Forcing through it only spends more
    // rejected requests and pushes the window further out.
    if (retryAfter != null && now.getTime() < new Date(retryAfter).getTime()) {
      problems.push(`${entry.broker}: rate-limited by the broker until ${retryAfter}`);
      outcomes.push({ broker: entry.broker, status: "skipped", lastSyncedAt, result: null });
      continue;
    }
    const recent =
      lastSyncedAt != null && now.getTime() - new Date(lastSyncedAt).getTime() < DAY_MS;
    if (!input.force && recent) {
      outcomes.push({ broker: entry.broker, status: "skipped", lastSyncedAt, result: null });
      continue;
    }

    let credentials: BrokerCredentials | null;
    try {
      credentials = await input.credentials.getCredentials(input.tenantId, entry.broker);
    } catch (error) {
      const problem = `${entry.broker}: ${readableError(error, entry.broker)}`;
      problems.push(problem);
      outcomes.push({ broker: entry.broker, status: "problem", lastSyncedAt, result: null });
      continue;
    }
    if (credentials == null) {
      const problem = `${entry.broker}: credentials are not configured`;
      problems.push(problem);
      outcomes.push({ broker: entry.broker, status: "problem", lastSyncedAt, result: null });
      continue;
    }

    let result: BrokerResult;
    try {
      result = await entry.adapter.sync({
        entity: input.entity,
        resume: previous.resume ?? undefined,
      });
    } catch (error) {
      const problem = `${entry.broker}: ${readableError(error, entry.broker)}`;
      problems.push(problem);
      outcomes.push({ broker: entry.broker, status: "problem", lastSyncedAt, result: null });
      continue;
    }
    const resume = historyPending(result.resume) ? (result.resume ?? null) : null;
    if (result.problems.length > 0) {
      problems.push(...result.problems.map((problem) => `${entry.broker}: ${problem}`));
      // Only a rate limit gets a cooldown. Every other problem (missing
      // credentials above all) must stay retryable, or saving credentials would
      // not be able to trigger the sync that follows it.
      if (result.retryAfter) {
        await input.state.put(entry.broker, {
          lastSyncedAt,
          retryAfter: result.retryAfter,
          resume,
        });
        outcomes.push({ broker: entry.broker, status: "problem", lastSyncedAt, result });
        continue;
      }
      // A run that delivered a complete data set is done, even if single rows
      // were unreadable. Leaving `lastSyncedAt` unset over a row problem made
      // the next app open replay the entire Trading 212 order history — six
      // requests per minute, restarting the moment it finished.
      // Unfinished pagination is not "delivered": the next run must continue
      // the cursor instead of waiting 24 hours.
      const delivered =
        tradesComplete(result) &&
        positionsComplete(result) &&
        cashBalancesComplete(result) &&
        !resume &&
        (result.positions.length > 0 ||
          result.trades.length > 0 ||
          (result.cashBalances?.length ?? 0) > 0);
      if (delivered)
        await input.state.put(entry.broker, {
          lastSyncedAt: nowIso,
          retryAfter: null,
          resume: null,
        });
      else
        await input.state.put(entry.broker, {
          lastSyncedAt,
          retryAfter: result.retryAfter ?? null,
          resume,
        });
      outcomes.push({
        broker: entry.broker,
        status: "problem",
        lastSyncedAt: delivered ? nowIso : lastSyncedAt,
        result,
      });
      continue;
    }
    if (resume) {
      await input.state.put(entry.broker, {
        lastSyncedAt,
        retryAfter: result.retryAfter ?? null,
        resume,
      });
      outcomes.push({ broker: entry.broker, status: "problem", lastSyncedAt, result });
      continue;
    }
    await input.state.put(entry.broker, { lastSyncedAt: nowIso, retryAfter: null, resume: null });
    outcomes.push({ broker: entry.broker, status: "synced", lastSyncedAt: nowIso, result });
  }

  return { outcomes, problems };
}
