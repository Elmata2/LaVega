import { decodeSyncRunState, type SyncRefreshState, type SyncRunStateView } from "@lavega/core";

/** A run row in `investing.sync_state` under `broker = 'run'`. */
export type SyncRunOutcome = "done" | "stopped-at-hop-limit" | "failed";
export type SyncRunRow = {
  lease: { id: string; heartbeatAt: string } | null;
  runId: string | null;
  hop: number;
  startedAt: string | null;
  resumeAt: string | null;
  finishedAt: string | null;
  outcome: SyncRunOutcome | null;
  force: boolean;
};

export type SyncRunStore = {
  get(): Promise<SyncRunRow | null>;
  /** Atomic claim; null when this call claimed, the live row otherwise. */
  claim(candidate: SyncRunRow, staleBefore: string): Promise<SyncRunRow | null>;
  /** Writes while `leaseId` still owns the row. False when the lease was lost. */
  put(row: SyncRunRow, leaseId: string): Promise<boolean>;
};

export const RUN_HEARTBEAT_MS = 10_000;
export const RUN_LEASE_STALE_MS = 60_000;
export const MAX_HOPS = 20;
export const MAX_CONTINUE_WAIT_MS = 240_000;
const LANE_MARGIN_MS = 15_000;

/** What one lane call proved. `pending` means work remains inside the lane. */
export type LaneOutcome = {
  status: "idle" | "running" | "completed" | "waiting" | "paused" | "problem";
  /** Epoch ms before which a retry is useless. */
  waitUntilMs?: number | null;
  problems?: readonly string[];
  pending: boolean;
};

export type SyncRunLanes = {
  holdings: (deadlineMs: number | undefined) => Promise<LaneOutcome>;
  history: (deadlineMs: number | undefined) => Promise<LaneOutcome>;
  prices: (deadlineMs: number | undefined) => Promise<LaneOutcome>;
  /** Never fails the run. */
  letter: () => Promise<void>;
};

export type SyncRunLaneReads = {
  vault: SyncRunStateView["vault"];
  holdings: SyncRunStateView["holdings"];
  history: SyncRunStateView["history"];
  prices: SyncRunStateView["prices"];
  problems: readonly string[];
};

export type SyncRunDependencies = {
  store: SyncRunStore;
  lanes: SyncRunLanes;
  readLanes: () => Promise<SyncRunLaneReads>;
  /** Sends one POST /api/sync/continue and awaits only its 202. */
  continueRun: (hop: number, origin: string | undefined, runId: string) => Promise<void>;
  /** Registers the promise as background work. Rejects when the host cannot. */
  background: (work: Promise<unknown>) => Promise<void>;
  reportProblem: (message: string, error?: unknown) => void;
  now?: () => number;
  newId?: () => string;
  env?: (name: string) => string | undefined;
};

const EMPTY_ROW = (): SyncRunRow => ({
  lease: null,
  runId: null,
  hop: 0,
  startedAt: null,
  resumeAt: null,
  finishedAt: null,
  outcome: null,
  force: false,
});

function parseRow(value: unknown): SyncRunRow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<SyncRunRow> & { lease?: unknown };
  const lease =
    raw.lease && typeof raw.lease === "object" && "id" in raw.lease && "heartbeatAt" in raw.lease
      ? {
          id: String((raw.lease as { id: unknown }).id),
          heartbeatAt: String((raw.lease as { heartbeatAt: unknown }).heartbeatAt),
        }
      : null;
  return {
    lease,
    runId: typeof raw.runId === "string" ? raw.runId : null,
    hop: typeof raw.hop === "number" ? raw.hop : 0,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    resumeAt: typeof raw.resumeAt === "string" ? raw.resumeAt : null,
    finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : null,
    outcome:
      raw.outcome === "done" || raw.outcome === "stopped-at-hop-limit" || raw.outcome === "failed"
        ? raw.outcome
        : null,
    force: raw.force === true,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Turns a stored row into the one state body every caller reads. */
export function toSyncState(
  row: SyncRunRow | null,
  reads: SyncRunLaneReads,
  nowMs: number,
): SyncRunStateView {
  const active =
    row?.lease != null && nowMs - Date.parse(row.lease.heartbeatAt) < RUN_LEASE_STALE_MS;
  return decodeSyncRunState({
    active,
    vault: reads.vault,
    holdings: reads.holdings,
    history: reads.history,
    prices: reads.prices,
    problems: [...new Set(reads.problems)].filter(
      (problem) => !/credentials are not configured/i.test(problem),
    ),
    run: { id: row?.runId ?? null, hop: row?.hop ?? 0, outcome: row?.outcome ?? null },
  });
}

export function createSyncRun(dependencies: SyncRunDependencies) {
  const now = dependencies.now ?? (() => Date.now());
  const newId = dependencies.newId ?? (() => crypto.randomUUID());
  const env = dependencies.env ?? ((name: string) => process.env[name]?.trim() || undefined);
  const budgetMs = () => {
    const raw = env("INVESTING_SYNC_BUDGET_MS");
    const parsed = raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  /* Vercel answers its own 5th self-request with 508 INFINITE_LOOP_DETECTED
   * (issue #306 spike, 2026-11-11), so self-continuation is off unless a
   * deployment explicitly turns it on. One trigger buys one budget of work. */
  const chainEnabled = () => env("INVESTING_SYNC_CHAIN") === "on";

  const store = dependencies.store;

  const readState = async (): Promise<SyncRunStateView> => {
    const [row, reads] = await Promise.all([store.get(), dependencies.readLanes()]);
    return toSyncState(row, reads, now());
  };

  const schedule = async (work: Promise<unknown>): Promise<void> => {
    await dependencies.background(work);
  };

  /** One atomic claim per run. Joining a live run changes nothing and runs no work. */
  const claimRun = async (
    force = false,
  ): Promise<{ claimed: true; row: SyncRunRow } | { claimed: false; state: SyncRefreshState }> => {
    const nowMs = now();
    const staleBefore = new Date(nowMs - RUN_LEASE_STALE_MS).toISOString();
    const current = await store.get();
    const live =
      current?.lease != null && nowMs - Date.parse(current.lease.heartbeatAt) < RUN_LEASE_STALE_MS;
    if (live && current?.outcome === null) {
      const reads = await dependencies.readLanes();
      return {
        claimed: false,
        state: { ...toSyncState(current, reads, nowMs), claimed: false },
      };
    }
    // A fresh run continues the same durable cursors; only the lease changes.
    const candidate: SyncRunRow = {
      ...(current ?? EMPTY_ROW()),
      lease: { id: newId(), heartbeatAt: new Date(nowMs).toISOString() },
      runId: newId(),
      hop: 0,
      startedAt: new Date(nowMs).toISOString(),
      resumeAt: null,
      finishedAt: null,
      outcome: null,
      force,
    };
    const holder = await store.claim(candidate, staleBefore);
    if (holder !== null) {
      const reads = await dependencies.readLanes();
      return { claimed: false, state: { ...toSyncState(holder, reads, nowMs), claimed: false } };
    }
    return { claimed: true, row: candidate };
  };

  const requestRefresh = async (
    force = false,
    origin?: string,
  ): Promise<{ state: SyncRefreshState; claimed: boolean }> => {
    const claimed = await claimRun(force);
    if (!claimed.claimed) return { state: claimed.state, claimed: false };
    await schedule(
      drive({ runId: claimed.row.runId!, leaseId: claimed.row.lease!.id, hop: 0, origin }),
    );
    const reads = await dependencies.readLanes();
    return {
      state: { ...toSyncState(claimed.row, reads, now()), claimed: true },
      claimed: true,
    };
  };

  /** Cron/local use: claim and run the work in this invocation, awaited.
   *  `deadlineMs` is the caller's own budget end (the cron pass), so one tenant
   *  can never consume the next tenant's time. */
  const runNow = async (
    force = false,
    deadlineMs?: number,
  ): Promise<"done" | "continue" | "failed" | "running"> => {
    const claimed = await claimRun(force);
    if (!claimed.claimed) {
      const row = await store.get();
      const live =
        row?.lease != null && now() - Date.parse(row.lease.heartbeatAt) < RUN_LEASE_STALE_MS;
      if (live && row?.outcome === null) return "running";
      // The race loser can claim a released row on the next step.
      const retry = await claimRun(force);
      if (!retry.claimed) return "running";
      return drive({
        runId: retry.row.runId!,
        leaseId: retry.row.lease!.id,
        hop: retry.row.hop,
        deadlineMs,
      });
    }
    return drive({
      runId: claimed.row.runId!,
      leaseId: claimed.row.lease!.id,
      hop: claimed.row.hop,
      deadlineMs,
    });
  };

  const finish = async (row: SyncRunRow, leaseId: string, outcome: SyncRunOutcome) => {
    await store.put(
      {
        ...row,
        lease: null,
        finishedAt: new Date(now()).toISOString(),
        outcome,
        resumeAt: null,
      },
      leaseId,
    );
  };

  const releaseKeepingState = async (row: SyncRunRow, leaseId: string) => {
    await store.put({ ...row, lease: null }, leaseId);
  };

  /**
   * Drives all lanes in order until done or until the budget ends. The lease
   * identifies the invocation: a stale or replaced lease does no work.
   */
  const drive = async (input: {
    runId: string;
    leaseId: string;
    hop: number;
    origin?: string;
    /** The caller's deadline (a cron pass); the run's own budget can only tighten it. */
    deadlineMs?: number;
  }): Promise<"done" | "continue" | "failed"> => {
    const startedAt = now();
    const budget = budgetMs();
    const ownDeadline = budget === undefined ? undefined : startedAt + budget;
    const deadlineMs =
      ownDeadline === undefined
        ? input.deadlineMs
        : input.deadlineMs === undefined
          ? ownDeadline
          : Math.min(ownDeadline, input.deadlineMs);
    const laneMargin = () => (deadlineMs ?? Number.POSITIVE_INFINITY) - LANE_MARGIN_MS;
    const loaded = await store.get();
    if (loaded === null || loaded.runId !== input.runId || loaded.lease?.id !== input.leaseId)
      return "done";
    let row: SyncRunRow = loaded;
    const problems: string[] = [];
    let lastHeartbeat = startedAt;
    const heartbeat = async (patch: Partial<Omit<SyncRunRow, "lease">> = {}) => {
      row = {
        ...row,
        ...patch,
        lease: { id: input.leaseId, heartbeatAt: new Date(now()).toISOString() },
      } as SyncRunRow;
      lastHeartbeat = now();
      if (!(await store.put(row, input.leaseId))) throw new Error("sync run lease lost");
    };
    const report = (message: string) => {
      if (message && !problems.includes(message)) problems.push(message);
    };
    const laneOnce = async (lane: () => Promise<LaneOutcome>): Promise<LaneOutcome> => {
      try {
        return await lane();
      } catch (error) {
        report(error instanceof Error ? error.message : "sync lane failed");
        return { status: "problem", pending: false, problems: [] };
      }
    };
    const waitOrContinue = async (waitUntilMs: number): Promise<boolean> => {
      // true: slept and the lane can run again in this invocation.
      if (waitUntilMs <= laneMargin()) {
        await sleep(Math.max(0, waitUntilMs - now()));
        return true;
      }
      row = { ...row, resumeAt: new Date(waitUntilMs).toISOString() };
      await heartbeat();
      return false;
    };

    try {
      const lanes: Array<[string, () => Promise<LaneOutcome>]> = [
        ["holdings", () => dependencies.lanes.holdings(deadlineMs)],
        ["history", () => dependencies.lanes.history(deadlineMs)],
        ["prices", () => dependencies.lanes.prices(deadlineMs)],
      ];
      for (const [name, lane] of lanes) {
        for (;;) {
          if (now() >= laneMargin()) {
            await releaseKeepingState(row, input.leaseId);
            return "continue";
          }
          if (now() - lastHeartbeat >= RUN_HEARTBEAT_MS) await heartbeat();
          const outcome = await laneOnce(lane);
          for (const problem of outcome.problems ?? []) report(`${name}: ${problem}`);
          await heartbeat();
          if (!outcome.pending) break;
          if (outcome.waitUntilMs != null) {
            const canSleep = await waitOrContinue(outcome.waitUntilMs);
            if (!canSleep) {
              const resumeAt = Date.parse(row.resumeAt ?? "");
              const waitMs = Number.isFinite(resumeAt)
                ? resumeAt - now()
                : Number.POSITIVE_INFINITY;
              if (waitMs > 0 && waitMs <= MAX_CONTINUE_WAIT_MS && chainEnabled()) {
                if (input.hop >= MAX_HOPS) {
                  await finish(row, input.leaseId, "stopped-at-hop-limit");
                  return "done";
                }
                await dependencies.continueRun(input.hop + 1, input.origin, input.runId);
              }
              await releaseKeepingState(row, input.leaseId);
              return "continue";
            }
            continue;
          }
          // No stated wait: retry while the budget allows, once per slice.
          if (now() >= laneMargin()) {
            await releaseKeepingState(row, input.leaseId);
            return "continue";
          }
          await sleep(1_000);
        }
        if (name === "holdings" || name === "history") await heartbeat();
      }
      await dependencies.lanes.letter().catch((error: unknown) => {
        dependencies.reportProblem("Portfolio letter failed", error);
      });
      await finish(row, input.leaseId, "done");
      return "done";
    } catch (error) {
      dependencies.reportProblem("Sync run failed", error);
      await finish(row, input.leaseId, "failed").catch(() => undefined);
      return "failed";
    }
  };

  /** Accepts one continuation request; it does no work when the run is gone. */
  const acceptContinue = async (input: { runId: string; hop: number }): Promise<boolean> => {
    const nowMs = now();
    const staleBefore = new Date(nowMs - RUN_LEASE_STALE_MS).toISOString();
    const current = await store.get();
    if (current?.runId !== input.runId || current.outcome !== null) return false;
    if (
      current.lease !== null &&
      nowMs - Date.parse(current.lease.heartbeatAt) < RUN_LEASE_STALE_MS
    )
      return false;
    const candidate: SyncRunRow = {
      ...current,
      lease: { id: newId(), heartbeatAt: new Date(nowMs).toISOString() },
      hop: input.hop,
      resumeAt: null,
    };
    const holder = await store.claim(candidate, staleBefore);
    if (holder !== null) return false;
    const work = nodeDrive(candidate, input.hop);
    await schedule(work);
    return true;
  };

  const nodeDrive = (row: SyncRunRow, hop: number) =>
    drive({ runId: row.runId!, leaseId: row.lease!.id, hop });

  return { requestRefresh, drive, readState, acceptContinue, runNow };
}

export type SyncRun = ReturnType<typeof createSyncRun>;

/** Parse a stored row from a JSONB read. Exported for the wiring and tests. */
export const parseSyncRunRow = parseRow;

/** In-process store for tests and the Docker/local tier (one tenant, one process). */
export function createMemorySyncRunStore(): SyncRunStore {
  let row: SyncRunRow | null = null;
  return {
    async get() {
      return row;
    },
    async claim(candidate, staleBefore) {
      if (row !== null) {
        const live =
          row.lease !== null && Date.parse(row.lease.heartbeatAt) >= Date.parse(staleBefore);
        if (live) return row;
      }
      row = candidate;
      return null;
    },
    async put(next, leaseId) {
      if (row?.lease?.id !== leaseId) return false;
      row = next;
      return true;
    },
  };
}
