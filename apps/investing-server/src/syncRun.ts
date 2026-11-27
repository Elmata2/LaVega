import { decodeSyncRunState, type SyncRefreshState, type SyncRunStateView } from "@lavega/core";

/** A run row in `investing.sync_state` under `broker = 'run'`. */
export type SyncRunOutcome = "done" | "stopped-at-hop-limit" | "failed";
export type SyncRunLease = { id: string; heartbeatAt: string };

export type IdleSyncRunRow = {
  phase: "idle";
  lease: null;
  runId: null;
  hop: 0;
  startedAt: null;
  resumeAt: null;
  finishedAt: null;
  outcome: null;
  force: false;
};

export type RunningSyncRunRow = {
  phase: "running";
  lease: SyncRunLease;
  runId: string;
  hop: number;
  startedAt: string;
  resumeAt: string | null;
  finishedAt: null;
  outcome: null;
  force: boolean;
};

export type PausedSyncRunRow = {
  phase: "paused";
  lease: null;
  runId: string;
  hop: number;
  startedAt: string | null;
  resumeAt: string | null;
  finishedAt: null;
  outcome: null;
  force: boolean;
};

export type TerminalSyncRunRow = {
  phase: "terminal";
  lease: null;
  runId: string;
  hop: number;
  startedAt: string | null;
  resumeAt: null;
  finishedAt: string;
  outcome: SyncRunOutcome;
  force: boolean;
};

/** Discriminated union making `lease != null && outcome != null` unrepresentable. */
export type SyncRunRow = IdleSyncRunRow | RunningSyncRunRow | PausedSyncRunRow | TerminalSyncRunRow;

export type SyncRunStore = {
  get(): Promise<SyncRunRow | null>;
  /** Atomic claim; null when this call claimed, the live row otherwise. */
  claim(candidate: RunningSyncRunRow, staleBefore: string): Promise<SyncRunRow | null>;
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
  holdings: {
    status: "idle" | "running" | "waiting" | "completed" | "problem";
    syncedAt: string | null;
    waitUntil: string | null;
    message: string | null;
    positionsRead: number;
  };
  history: {
    status: "idle" | "running" | "waiting" | "completed" | "problem";
    syncedAt: string | null;
    waitUntil: string | null;
    message: string | null;
    pages: number;
    ordersRead: number;
    historyProgress: unknown;
  };
  prices: {
    status: "idle" | "running" | "waiting" | "completed" | "problem";
    syncedAt: string | null;
    waitUntil: string | null;
    message: string | null;
    total: number;
    completed: number;
    currentSymbol: string | null;
    remainingSymbols: readonly string[];
  };
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

function isSyncRunOutcome(value: unknown): value is SyncRunOutcome {
  return value === "done" || value === "stopped-at-hop-limit" || value === "failed";
}

function parseRow(value: unknown): SyncRunRow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const lease =
    raw.lease &&
    typeof raw.lease === "object" &&
    "id" in raw.lease &&
    "heartbeatAt" in raw.lease &&
    typeof (raw.lease as { id: unknown }).id === "string" &&
    typeof (raw.lease as { heartbeatAt: unknown }).heartbeatAt === "string"
      ? {
          id: (raw.lease as { id: string }).id,
          heartbeatAt: (raw.lease as { heartbeatAt: string }).heartbeatAt,
        }
      : null;
  const runId = typeof raw.runId === "string" ? raw.runId : null;
  const hop = typeof raw.hop === "number" && Number.isFinite(raw.hop) ? raw.hop : 0;
  const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : null;
  const resumeAt = typeof raw.resumeAt === "string" ? raw.resumeAt : null;
  const finishedAt = typeof raw.finishedAt === "string" ? raw.finishedAt : null;
  const outcome = isSyncRunOutcome(raw.outcome) ? raw.outcome : null;
  const force = raw.force === true;

  if (outcome !== null && runId !== null) {
    return {
      phase: "terminal",
      lease: null,
      runId,
      hop,
      startedAt,
      resumeAt: null,
      finishedAt: finishedAt ?? startedAt ?? new Date(0).toISOString(),
      outcome,
      force,
    };
  }
  if (lease !== null && runId !== null) {
    return {
      phase: "running",
      lease,
      runId,
      hop,
      startedAt: startedAt ?? lease.heartbeatAt,
      resumeAt,
      finishedAt: null,
      outcome: null,
      force,
    };
  }
  if (runId !== null) {
    return {
      phase: "paused",
      lease: null,
      runId,
      hop,
      startedAt,
      resumeAt,
      finishedAt: null,
      outcome: null,
      force,
    };
  }
  return {
    phase: "idle",
    lease: null,
    runId: null,
    hop: 0,
    startedAt: null,
    resumeAt: null,
    finishedAt: null,
    outcome: null,
    force: false,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isLiveRunningRow(row: SyncRunRow | null, nowMs: number): row is RunningSyncRunRow {
  return (
    row !== null &&
    row.phase === "running" &&
    row.outcome === null &&
    nowMs - Date.parse(row.lease.heartbeatAt) < RUN_LEASE_STALE_MS
  );
}

/** Turns a stored row into the one state body every caller reads. */
export function toSyncState(
  row: SyncRunRow | null,
  reads: SyncRunLaneReads,
  nowMs: number,
): SyncRunStateView {
  const active = isLiveRunningRow(row, nowMs);
  const holdings = {
    ...reads.holdings,
    waitUntil: reads.holdings.status === "waiting" ? reads.holdings.waitUntil : null,
  };
  const history = {
    ...reads.history,
    waitUntil: reads.history.status === "waiting" ? reads.history.waitUntil : null,
  };
  const prices = {
    ...reads.prices,
    waitUntil: reads.prices.status === "waiting" ? reads.prices.waitUntil : null,
    currentSymbol: reads.prices.status === "running" ? reads.prices.currentSymbol : null,
  };
  const problems = [...new Set(reads.problems)].filter(
    (problem) => !/credentials are not configured/i.test(problem),
  );
  if (active) {
    return decodeSyncRunState({
      active: true,
      vault: reads.vault,
      holdings,
      history,
      prices,
      problems,
      run: { id: row.runId, hop: row.hop, outcome: null },
    });
  }
  const run =
    row === null || row.phase === "idle"
      ? { id: null, hop: 0 as const, outcome: null }
      : row.phase === "terminal"
        ? { id: row.runId, hop: row.hop, outcome: row.outcome }
        : { id: row.runId, hop: row.hop, outcome: null };
  return decodeSyncRunState({
    active: false,
    vault: reads.vault,
    holdings,
    history,
    prices,
    problems,
    run,
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

  const toUnclaimedRefreshState = (state: SyncRunStateView): SyncRefreshState => ({
    ...state,
    claimed: false,
  });

  /** One atomic claim per run. Joining a live run changes nothing and runs no work. */
  const claimRun = async (
    force = false,
  ): Promise<
    { claimed: true; row: RunningSyncRunRow } | { claimed: false; state: SyncRefreshState }
  > => {
    const nowMs = now();
    const staleBefore = new Date(nowMs - RUN_LEASE_STALE_MS).toISOString();
    const current = await store.get();
    if (isLiveRunningRow(current, nowMs)) {
      const reads = await dependencies.readLanes();
      return {
        claimed: false,
        state: toUnclaimedRefreshState(toSyncState(current, reads, nowMs)),
      };
    }
    const isoNow = new Date(nowMs).toISOString();
    const candidate: RunningSyncRunRow = {
      phase: "running",
      lease: { id: newId(), heartbeatAt: isoNow },
      runId: newId(),
      hop: 0,
      startedAt: isoNow,
      resumeAt: null,
      finishedAt: null,
      outcome: null,
      force,
    };
    const holder = await store.claim(candidate, staleBefore);
    if (holder !== null) {
      const reads = await dependencies.readLanes();
      return {
        claimed: false,
        state: toUnclaimedRefreshState(toSyncState(holder, reads, nowMs)),
      };
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
      drive({ runId: claimed.row.runId, leaseId: claimed.row.lease.id, hop: 0, origin }),
    );
    const reads = await dependencies.readLanes();
    const state = toSyncState(claimed.row, reads, now());
    if (state.active) {
      return {
        state: { ...state, claimed: true },
        claimed: true,
      };
    }
    return {
      state: { ...state, claimed: false },
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
      if (isLiveRunningRow(row, now())) return "running";
      // The race loser can claim a released row on the next step.
      const retry = await claimRun(force);
      if (!retry.claimed) return "running";
      return drive({
        runId: retry.row.runId,
        leaseId: retry.row.lease.id,
        hop: retry.row.hop,
        deadlineMs,
      });
    }
    return drive({
      runId: claimed.row.runId,
      leaseId: claimed.row.lease.id,
      hop: claimed.row.hop,
      deadlineMs,
    });
  };

  const finish = async (row: RunningSyncRunRow, leaseId: string, outcome: SyncRunOutcome) => {
    const terminalRow: TerminalSyncRunRow = {
      phase: "terminal",
      lease: null,
      runId: row.runId,
      hop: row.hop,
      startedAt: row.startedAt,
      resumeAt: null,
      finishedAt: new Date(now()).toISOString(),
      outcome,
      force: row.force,
    };
    await store.put(terminalRow, leaseId);
  };

  const releaseKeepingState = async (row: RunningSyncRunRow, leaseId: string) => {
    const pausedRow: PausedSyncRunRow = {
      phase: "paused",
      lease: null,
      runId: row.runId,
      hop: row.hop,
      startedAt: row.startedAt,
      resumeAt: row.resumeAt,
      finishedAt: null,
      outcome: null,
      force: row.force,
    };
    await store.put(pausedRow, leaseId);
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
    if (
      loaded === null ||
      loaded.phase !== "running" ||
      loaded.runId !== input.runId ||
      loaded.lease.id !== input.leaseId
    )
      return "done";
    let row: RunningSyncRunRow = loaded;
    const problems: string[] = [];
    let lastHeartbeat = startedAt;
    const heartbeat = async (patch: { resumeAt?: string | null } = {}) => {
      row = {
        ...row,
        ...patch,
        lease: { id: input.leaseId, heartbeatAt: new Date(now()).toISOString() },
      };
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
      await heartbeat({ resumeAt: new Date(waitUntilMs).toISOString() });
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
    if (
      current === null ||
      current.phase === "idle" ||
      current.phase === "terminal" ||
      current.runId !== input.runId
    )
      return false;
    if (isLiveRunningRow(current, nowMs)) return false;
    const isoNow = new Date(nowMs).toISOString();
    const candidate: RunningSyncRunRow = {
      phase: "running",
      lease: { id: newId(), heartbeatAt: isoNow },
      runId: current.runId,
      hop: input.hop,
      startedAt: current.startedAt ?? isoNow,
      resumeAt: null,
      finishedAt: null,
      outcome: null,
      force: current.force,
    };
    const holder = await store.claim(candidate, staleBefore);
    if (holder !== null) return false;
    const work = nodeDrive(candidate, input.hop);
    await schedule(work);
    return true;
  };

  const nodeDrive = (row: RunningSyncRunRow, hop: number) =>
    drive({ runId: row.runId, leaseId: row.lease.id, hop });

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
      if (row !== null && row.phase === "running") {
        const live = Date.parse(row.lease.heartbeatAt) >= Date.parse(staleBefore);
        if (live) return row;
      }
      row = candidate;
      return null;
    },
    async put(next, leaseId) {
      if (row?.phase !== "running" || row.lease.id !== leaseId) return false;
      row = next;
      return true;
    },
  };
}
