import { amsterdamDay, type RateBenchmark } from "@lavega/core";
import {
  assertAgentConfig,
  createAgentRepository,
  createEbFlowRepository,
  EVENT_RETENTION_DAYS,
  listAgentDueUsers,
  purgeLinkAttempts,
  type DueUser,
} from "@lavega/database";
import { runtimeDatabase } from "@lavega/database";
import { SESSION_TTL_MS } from "../eb-routes.js";
import { authorizedCronRequest } from "../secrets.js";
import { authBaseUrl } from "../auth.js";
import { getRates } from "../rates.js";
import { sendAgentEmail } from "./emailChannel.js";
import { sendWhatsAppDaily } from "../whatsapp/channel.js";
import { sendPush } from "./pushChannel.js";
import { runForUser, type InstinctDeps, type RunResult } from "./instinct.js";

/* The daily agent cron (Vercel cron, 07:00 UTC = 08:00 Amsterdam in winter, 09:00 in summer).
 * One run a day sends to every opted-in user who has no claim for today's Amsterdam date,
 * whatever send hour they stored. The listing function (migration 0040) is reused as is: with
 * local hour 23 and 23 retry hours every send hour is inside the window ((23 - h + 24) % 24 <= 23
 * for all h in 0..23) and the message day is today (23 >= h). The claim stays the real once-a-day
 * guard: a second call the same day lists nobody. A failed send releases the claim as before.
 * Each user runs on its own: one failure never stops the next. Logs carry the user id and the
 * error's name, nothing from the bank. */

/** Local hour and retry hours passed to the listing: a window that covers the whole day. */
export const FULL_DAY_HOUR = 23;
export const FULL_DAY_RETRY_HOURS = 23;
/** `maxDuration` in scripts/vercel-build.mjs. */
export const FUNCTION_LIMIT_MS = 300_000;
export const BUDGET_SHARE = 0.8;

export type CronDeps = {
  now: () => Date;
  assertConfig: () => void;
  listDue: (hour: number, retryHours: number, today: string) => Promise<DueUser[]>;
  run: (userId: string) => Promise<RunResult>;
  purge: (userId: string) => Promise<unknown>;
  /** Link-attempt rows older than 15 minutes; once per run, not per user. */
  purgeLinkAttempts: () => Promise<unknown>;
  budgetMs: number;
};

/** The listing is ordered by user id. When the time budget runs out the tail is skipped, so the
 *  list starts at a different user each day (days since 1970 modulo the length): over a few days
 *  everyone is reached first once. The same day always gives the same order. */
function rotateByDay<T>(list: readonly T[], day: string): T[] {
  if (list.length === 0) return [];
  const [y, m, d] = day.split("-").map(Number);
  const days = Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
  const offset = days % list.length;
  return [...list.slice(offset), ...list.slice(0, offset)];
}

const log = (event: string, fields: Record<string, string | number> = {}) =>
  console.log(JSON.stringify({ event: `instinct.${event}`, ...fields }));
const kindOf = (error: unknown) => (error instanceof Error ? error.name : "UnknownError");

function defaultDeps(): CronDeps {
  const database = runtimeDatabase();
  if (!database) throw new Error("geen database in dit verzoek");
  const flow = createEbFlowRepository(database);
  let rates: Promise<readonly RateBenchmark[]> | undefined;
  const instinct = (): Promise<InstinctDeps> =>
    (rates ??= getRates().then((r) => r.rates)).then((r) => ({
      db: database,
      now: () => new Date(),
      fetchSessions: (userId) => flow.listSessions(userId, SESSION_TTL_MS),
      rates: r,
      send: {
        // The stored event is the feed; `deliver` writes it after the sends.
        feed: async () => "sent",
        push: (userId, msg, settings) =>
          sendPush(userId, msg, createAgentRepository(database, userId), {
            locale: settings.locale,
          }),
        email: async (_userId, msg, settings) =>
          settings.email
            ? sendAgentEmail(settings.email, msg, settings.locale, authBaseUrl())
            : "failed",
        whatsapp: (userId, msg, settings) =>
          sendWhatsAppDaily(userId, msg, settings.locale, createAgentRepository(database, userId)),
      },
    }));
  return {
    now: () => new Date(),
    assertConfig: assertAgentConfig,
    listDue: (hour, retry, today) => listAgentDueUsers(database, hour, retry, today),
    run: async (userId) => runForUser(await instinct(), userId),
    purge: (userId) => createAgentRepository(database, userId).purgeOlderThan(EVENT_RETENTION_DAYS),
    purgeLinkAttempts: () => purgeLinkAttempts(database),
    budgetMs: FUNCTION_LIMIT_MS * BUDGET_SHARE,
  };
}

export async function runInstinctCron(request: Request, given?: CronDeps): Promise<Response> {
  if (!authorizedCronRequest(request))
    return Response.json({ problems: ["Unauthorized cron request"] }, { status: 401 });

  let deps: CronDeps;
  try {
    deps = given ?? defaultDeps();
    deps.assertConfig();
  } catch (error) {
    // assertAgentConfig names the missing variable, never its value.
    log("misconfigured", { kind: kindOf(error) });
    return Response.json(
      { problems: ["Agent is not configured"], code: "agent-not-configured" },
      { status: 503 },
    );
  }

  const started = deps.now().getTime();
  const instant = deps.now();

  /* Housekeeping comes first and does not depend on the listing: a failing or slow listing
   * must not leave the attempt rows (a hash of a phone number each) past their window. A
   * failure only logs the error's name. (The 90-day event purge is per user, after that
   * user's run, so there is nothing of it to run without a listing.) */
  try {
    await deps.purgeLinkAttempts();
  } catch (error) {
    log("purge_attempts_failed", { kind: kindOf(error) });
  }

  let due: DueUser[];
  try {
    due = await deps.listDue(FULL_DAY_HOUR, FULL_DAY_RETRY_HOURS, amsterdamDay(instant));
  } catch (error) {
    log("list_failed", { kind: kindOf(error) });
    return Response.json({ problems: ["Could not list due users"] }, { status: 503 });
  }

  const results: Record<string, number> = {};
  let failed = 0;
  let reached = 0;
  for (const { userId } of rotateByDay(due, amsterdamDay(instant))) {
    if (deps.now().getTime() - started >= deps.budgetMs) break;
    reached += 1;
    try {
      const result = await deps.run(userId);
      results[result] = (results[result] ?? 0) + 1;
    } catch (error) {
      failed += 1;
      log("user_failed", { userId, kind: kindOf(error) });
    }
    try {
      await deps.purge(userId);
    } catch (error) {
      log("purge_failed", { userId, kind: kindOf(error) });
    }
  }
  const skipped = due.length - reached;
  log("run_done", { due: due.length, failed, skipped });
  return Response.json({ due: due.length, results, failed, skipped });
}
