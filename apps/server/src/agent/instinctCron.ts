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
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import { SESSION_TTL_MS } from "../eb-routes.js";
import { authorizedCronRequest } from "../investing-mount.js";
import { authBaseUrl } from "../auth.js";
import { getRates } from "../rates.js";
import { sendAgentEmail } from "./emailChannel.js";
import { sendWhatsAppDaily } from "../whatsapp/channel.js";
import { sendPush } from "./pushChannel.js";
import { runForUser, type InstinctDeps, type RunResult } from "./instinct.js";

/* The hourly agent cron. It asks the database which opted-in users are due at
 * this Amsterdam hour (send time up to RETRY_HOURS ago, counted round midnight, and no
 * claim yet for that send day), then runs each one on its own: one user's failure
 * never stops the next. The listing's day only decides who is due; the claim is the real date.
 * Logs carry the user id and the error's name, nothing from the bank. */

export const RETRY_HOURS = 2;
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

/** The local hour (0-23) in Europe/Amsterdam; follows the CET/CEST change. */
export function amsterdamHour(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Number(parts.find((p) => p.type === "hour")?.value);
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
        push: (userId, msg) => sendPush(userId, msg, createAgentRepository(database, userId)),
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
    due = await deps.listDue(amsterdamHour(instant), RETRY_HOURS, amsterdamDay(instant));
  } catch (error) {
    log("list_failed", { kind: kindOf(error) });
    return Response.json({ problems: ["Could not list due users"] }, { status: 503 });
  }

  const results: Record<string, number> = {};
  let failed = 0;
  let reached = 0;
  for (const { userId } of due) {
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
  return Response.json({ due: due.length, results, failed, skipped: due.length - reached });
}
