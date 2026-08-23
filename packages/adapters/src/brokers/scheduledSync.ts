import type { BrokerCredentials, CredentialBroker, CredentialStore } from "@lavega/core";
import type { BrokerAccessAdapter, BrokerResult } from "./BrokerAccessAdapter.js";

export type ScheduledBroker = Extract<CredentialBroker, "ibkr" | "trading212">;
export type BrokerSyncState = {
  lastSyncedAt: string | null;
  /** ISO timestamp the provider rate-limited us until. Survives `force`. */
  retryAfter?: string | null;
};

export interface BrokerSyncStateStore {
  get(broker: ScheduledBroker): Promise<BrokerSyncState>;
  put(broker: ScheduledBroker, state: BrokerSyncState): Promise<void>;
}

export function createMemoryBrokerSyncStateStore(): BrokerSyncStateStore {
  const states = new Map<ScheduledBroker, BrokerSyncState>();
  return {
    async get(broker) { return states.get(broker) ?? { lastSyncedAt: null, retryAfter: null }; },
    async put(broker, state) { states.set(broker, state); },
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
    const recent = lastSyncedAt != null && now.getTime() - new Date(lastSyncedAt).getTime() < DAY_MS;
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
      result = await entry.adapter.sync({ entity: input.entity });
    } catch (error) {
      const problem = `${entry.broker}: ${readableError(error, entry.broker)}`;
      problems.push(problem);
      outcomes.push({ broker: entry.broker, status: "problem", lastSyncedAt, result: null });
      continue;
    }
    if (result.problems.length > 0) {
      problems.push(...result.problems.map((problem) => `${entry.broker}: ${problem}`));
      // Only a rate limit gets a cooldown. Every other problem (missing
      // credentials above all) must stay retryable, or saving credentials would
      // not be able to trigger the sync that follows it.
      if (result.retryAfter) await input.state.put(entry.broker, { lastSyncedAt, retryAfter: result.retryAfter });
      outcomes.push({ broker: entry.broker, status: "problem", lastSyncedAt, result });
      continue;
    }
    await input.state.put(entry.broker, { lastSyncedAt: nowIso, retryAfter: null });
    outcomes.push({ broker: entry.broker, status: "synced", lastSyncedAt: nowIso, result });
  }

  return { outcomes, problems };
}
