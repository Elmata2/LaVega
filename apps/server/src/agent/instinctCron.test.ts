import { readFileSync } from "node:fs";
import { amsterdamDay, type Account } from "@lavega/core";
import {
  createAgentRepository,
  listAgentDueUsers,
  type AgentSettings,
  type Database,
} from "@lavega/database";
import { migratedTestDatabase } from "@lavega/database/testing";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { CONSENT_VERSION } from "../instinctConsent.js";
import { runForUser, type InstinctDeps } from "./instinct.js";
import { amsterdamHour, runInstinctCron, type CronDeps } from "./instinctCron.js";

const SECRET = "cron-secret";
const T0 = Date.parse("2026-11-11T07:00:00Z"); // 08:00 in Amsterdam

const due = (userId: string, day = "2026-11-11") => ({ userId, day });

const request = (token?: string) =>
  new Request("https://lavega.test/api/cron/instinct", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

function fakeDeps(over: Partial<CronDeps> = {}): CronDeps {
  return {
    now: () => new Date(T0),
    assertConfig: () => undefined,
    listDue: async () => [],
    run: async () => "sent",
    purge: async () => 0,
    purgeLinkAttempts: async () => 0,
    budgetMs: 240_000,
    ...over,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
});

test("no or a wrong bearer gives 401 and lists nobody", async () => {
  const listDue = vi.fn(async () => [due("a")]);
  for (const token of [undefined, "nope"]) {
    const res = await runInstinctCron(request(token), fakeDeps({ listDue }));
    expect(res.status).toBe(401);
  }
  expect(listDue).not.toHaveBeenCalled();
});

test("a missing CRON_SECRET refuses everything", async () => {
  delete process.env.CRON_SECRET;
  const listDue = vi.fn(async () => []);
  expect((await runInstinctCron(request(""), fakeDeps({ listDue }))).status).toBe(401);
  expect(listDue).not.toHaveBeenCalled();
});

test("a misconfigured agent fails the run cleanly, naming no secret", async () => {
  const logs: unknown[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a));
  const listDue = vi.fn(async () => [due("a")]);
  const res = await runInstinctCron(
    request(SECRET),
    fakeDeps({
      listDue,
      assertConfig: () => {
        throw new Error("AGENT_DEDUPE_HMAC_KEY is required");
      },
    }),
  );
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({
    problems: ["Agent is not configured"],
    code: "agent-not-configured",
  });
  expect(listDue).not.toHaveBeenCalled();
  expect(JSON.stringify(logs)).not.toContain(SECRET);
});

test.each([
  // Spring forward 2026-03-29: 01:00 UTC is 03:00 CEST.
  ["2026-03-29T00:59:00Z", 1, "2026-03-29"],
  ["2026-03-29T01:00:00Z", 3, "2026-03-29"],
  // Fall back 2026-10-25: 00:59 UTC is 02:59 CEST, 01:00 UTC is 02:00 CET.
  ["2026-10-25T00:59:00Z", 2, "2026-10-25"],
  ["2026-10-25T01:00:00Z", 2, "2026-10-25"],
  ["2026-10-24T22:30:00Z", 0, "2026-10-25"],
  ["2026-10-25T22:30:00Z", 23, "2026-10-25"],
  ["2026-11-11T07:00:00Z", 8, "2026-11-11"],
])("at %s the Amsterdam hour is %i on %s", async (iso, hour, day) => {
  expect(amsterdamHour(new Date(iso))).toBe(hour);
  const listDue = vi.fn(async () => []);
  await runInstinctCron(request(SECRET), fakeDeps({ now: () => new Date(iso), listDue }));
  expect(listDue).toHaveBeenCalledWith(hour, 2, day);
});

test("one throwing user does not stop the next, and the log holds the id and the error name only", async () => {
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
  const run = vi.fn(async (id: string) => {
    if (id === "a")
      throw Object.assign(new Error("SENTINEL-MERCHANT 12.34"), { name: "BankError" });
    return "sent" as const;
  });
  const purge = vi.fn(async () => 0);
  const res = await runInstinctCron(
    request(SECRET),
    fakeDeps({ listDue: async () => [due("a"), due("b")], run, purge }),
  );
  expect(await res.json()).toEqual({ due: 2, results: { sent: 1 }, failed: 1, skipped: 0 });
  expect(run).toHaveBeenCalledTimes(2);
  expect(purge).toHaveBeenCalledWith("b");
  expect(logs.join()).toContain('"userId":"a"');
  expect(logs.join()).toContain("BankError");
  expect(logs.join()).not.toContain("SENTINEL");
});

test("the link-attempt purge runs once per run, even with nobody due, and a failure only logs (F6)", async () => {
  const logs: unknown[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
  const purgeLinkAttempts = vi.fn(async () => 3);
  await runInstinctCron(request(SECRET), fakeDeps({ purgeLinkAttempts }));
  expect(purgeLinkAttempts).toHaveBeenCalledTimes(1);
  await runInstinctCron(
    request(SECRET),
    fakeDeps({ listDue: async () => [due("a"), due("b"), due("c")], purgeLinkAttempts }),
  );
  expect(purgeLinkAttempts).toHaveBeenCalledTimes(2);
  const failing = vi.fn(async () => {
    throw Object.assign(new Error("secret detail"), { name: "PgError" });
  });
  const res = await runInstinctCron(
    request(SECRET),
    fakeDeps({ listDue: async () => [due("a")], purgeLinkAttempts: failing }),
  );
  expect(res.status).toBe(200);
  expect(logs.join()).toContain("instinct.purge_attempts_failed");
  expect(logs.join()).toContain("PgError");
  expect(logs.join()).not.toContain("secret detail");
});

test("the run stops starting users once 80 percent of the function limit is used", async () => {
  let clock = T0;
  const run = vi.fn(async () => {
    clock += 100_000;
    return "sent" as const;
  });
  const res = await runInstinctCron(
    request(SECRET),
    fakeDeps({
      now: () => new Date(clock),
      listDue: async () => [due("a"), due("b"), due("c"), due("d")],
      run,
      budgetMs: 240_000,
    }),
  );
  expect(run).toHaveBeenCalledTimes(3);
  expect((await res.json()).skipped).toBe(1);
});

test("the route is registered on a cron entry that runs every hour", () => {
  const build = readFileSync(
    new URL("../../../../scripts/vercel-build.mjs", import.meta.url),
    "utf8",
  );
  expect(build).toContain('{ path: "/api/cron/instinct", schedule: "0 * * * *" }');
});

/* Two overlapping runs against the real database: the day claim is what makes
 * one send per user. */
let pglite: Awaited<ReturnType<typeof migratedTestDatabase>>["pglite"];
let db: Database;

beforeAll(async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "22".repeat(32);
  process.env.AGENT_DEDUPE_HMAC_KEY = "33".repeat(32);
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);
afterAll(async () => {
  await pglite.close();
});

const settings: AgentSettings = {
  enabled: true,
  channels: ["feed"],
  sendHour: 8,
  locale: "nl",
  email: null,
  consentVersion: CONSENT_VERSION,
  consentedAt: "2026-11-01T00:00:00.000Z",
};
const account: Account = {
  key: "NL01INGB0000000001",
  iban: "NL01INGB0000000001",
  name: "Betaalrekening",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: 1000,
};

test("two overlapping cron runs send once per user", async () => {
  await pglite.exec("RESET ROLE;");
  for (const t of ["events", "mirror", "state", "settings"])
    await pglite.exec(`DELETE FROM personal.agent_${t};`);
  await pglite.exec("SELECT set_config('app.user_id', '', false); SET ROLE lavega_runtime;");
  for (const user of ["u1", "u2"]) {
    const repo = createAgentRepository(db, user);
    await repo.putSettings(settings);
    await repo.putMirror({
      rules: [],
      dueDates: [{ kind: "vat", label: "BTW", date: "2026-11-14" }],
      cardOffer: null,
    });
  }
  const sends: string[] = [];
  const instinct: InstinctDeps = {
    db,
    now: () => new Date(T0),
    fetchSessions: async () => [
      {
        sessionId: "s1",
        payload: { aspsp: "ING", accounts: [] },
        createdAt: "2026-11-01T00:00:00.000Z",
      },
    ],
    rates: [],
    send: {
      feed: async (userId) => (sends.push(userId), "sent"),
      push: async () => "failed",
      email: async () => "failed",
      whatsapp: async () => "failed",
    },
    fetchOutcome: async () => ({
      status: "ok",
      txs: [],
      accounts: [account],
      balances: [],
      consentExpiresAt: new Date(T0 + 60 * 86_400_000).toISOString(),
      banks: [{ bank: "ING", state: "ok" }],
    }),
  };
  const deps = fakeDeps({
    listDue: (hour, retry, today) => listAgentDueUsers(db, hour, retry, today),
    run: (userId) => runForUser(instinct, userId),
  });

  const [first, second] = await Promise.all([
    runInstinctCron(request(SECRET), deps),
    runInstinctCron(request(SECRET), deps),
  ]);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(sends.sort()).toEqual(["u1", "u2"]);
  // Everyone has today's claim: a third run finds nobody due.
  expect(await listAgentDueUsers(db, 8, 2, "2026-11-11")).toEqual([]);
});

test("a failing due listing still purges the link attempts, answers 503 and logs the name only (W7)", async () => {
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
  const purgeLinkAttempts = vi.fn(async () => 1);
  const res = await runInstinctCron(
    request(SECRET),
    fakeDeps({
      purgeLinkAttempts,
      listDue: async () => {
        throw Object.assign(new Error("db down at 10.0.0.1"), { name: "NeonError" });
      },
    }),
  );
  expect(res.status).toBe(503);
  expect(purgeLinkAttempts).toHaveBeenCalledTimes(1);
  expect(logs.join()).toContain("instinct.list_failed");
  expect(logs.join()).not.toContain("10.0.0.1");
});

test("a failing purge and a failing listing both only log their error names (W7)", async () => {
  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
  const res = await runInstinctCron(
    request(SECRET),
    fakeDeps({
      purgeLinkAttempts: async () => {
        throw Object.assign(new Error("purge secret detail"), { name: "PgError" });
      },
      listDue: async () => {
        throw new Error("list detail");
      },
    }),
  );
  expect(res.status).toBe(503);
  expect(logs.join()).toContain("instinct.purge_attempts_failed");
  expect(logs.join()).toContain("PgError");
  expect(logs.join()).not.toContain("secret detail");
  expect(logs.join()).not.toContain("list detail");
});

/* Every hour across the two DST changes, against the real listing and claim: each local
 * date gets exactly one claim, whatever the send hour, including the hours that do not
 * exist (spring) or happen twice (autumn), and the wrapped retries after midnight. */
test.each([
  // Spring forward 2026-03-29 (02:00 -> 03:00 in Amsterdam).
  ["2026-03-27T12:00:00Z", "2026-03-31T12:00:00Z", 23, ["03-27", "03-28", "03-29", "03-30"]],
  ["2026-03-27T12:00:00Z", "2026-03-31T12:00:00Z", 22, ["03-27", "03-28", "03-29", "03-30"]],
  ["2026-03-27T12:00:00Z", "2026-03-31T12:00:00Z", 2, ["03-28", "03-29", "03-30", "03-31"]],
  ["2026-03-27T12:00:00Z", "2026-03-31T12:00:00Z", 0, ["03-28", "03-29", "03-30", "03-31"]],
  // Fall back 2026-10-25 (03:00 -> 02:00; the hour 02 happens twice).
  ["2026-10-23T12:00:00Z", "2026-10-27T12:00:00Z", 23, ["10-23", "10-24", "10-25", "10-26"]],
  ["2026-10-23T12:00:00Z", "2026-10-27T12:00:00Z", 22, ["10-23", "10-24", "10-25", "10-26"]],
  ["2026-10-23T12:00:00Z", "2026-10-27T12:00:00Z", 2, ["10-24", "10-25", "10-26", "10-27"]],
  ["2026-10-23T12:00:00Z", "2026-10-27T12:00:00Z", 0, ["10-24", "10-25", "10-26", "10-27"]],
])(
  "hourly runs from %s to %s with send hour %i claim each date exactly once (W5)",
  async (from, to, sendHour, days) => {
    await pglite.exec("RESET ROLE;");
    for (const t of ["events", "mirror", "state", "settings"])
      await pglite.exec(`DELETE FROM personal.agent_${t};`);
    await pglite.exec("SELECT set_config('app.user_id', '', false); SET ROLE lavega_runtime;");
    await createAgentRepository(db, "dst").putSettings({ ...settings, sendHour });

    const fetched: string[] = [];
    let at = Date.parse(from);
    const instinct: InstinctDeps = {
      db,
      now: () => new Date(at),
      fetchSessions: async () => [
        {
          sessionId: "s1",
          payload: { aspsp: "ING", accounts: [] },
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ],
      rates: [],
      send: {
        feed: async () => "sent",
        push: async () => "failed",
        email: async () => "failed",
        whatsapp: async () => "failed",
      },
      fetchOutcome: async () => {
        fetched.push(amsterdamDay(new Date(at)));
        return {
          status: "ok",
          txs: [],
          accounts: [account],
          balances: [],
          consentExpiresAt: new Date(at + 60 * 86_400_000).toISOString(),
          banks: [{ bank: "ING", state: "ok" }],
        };
      },
    };
    const deps = fakeDeps({
      now: () => new Date(at),
      listDue: (hour, retry, today) => listAgentDueUsers(db, hour, retry, today),
      run: (userId) => runForUser(instinct, userId),
    });
    for (; at <= Date.parse(to); at += 3_600_000) {
      // Reset the fetch counter every hour: only the day claim is under test here.
      await pglite.exec(
        "RESET ROLE; UPDATE personal.agent_state SET fetches_today = 0; SET ROLE lavega_runtime;",
      );
      await runInstinctCron(request(SECRET), deps);
    }
    const year = from.slice(0, 4);
    expect(fetched).toEqual(days.map((d) => `${year}-${d}`));
  },
);

/* A2: whatever the user does to the send hour, the day claim never moves backwards and at most
 * one message goes out per real Amsterdam calendar date. Hourly for 48 hours. */
test.each([
  ["0 -> 23", 0, 23, "2026-11-11T23:00:00Z"],
  ["23 -> 0", 23, 0, "2026-11-11T22:00:00Z"],
  ["8 -> 9", 8, 9, "2026-11-11T07:00:00Z"],
  ["9 -> 8", 9, 8, "2026-11-11T08:00:00Z"],
  ["22 -> 1", 22, 1, "2026-11-11T23:00:00Z"],
])(
  "send hour %s changed mid-run: claim never goes back, at most one message per real date (A2)",
  async (_name, before, after, changeAfter) => {
    await pglite.exec("RESET ROLE;");
    for (const t of ["events", "mirror", "state", "settings"])
      await pglite.exec(`DELETE FROM personal.agent_${t};`);
    await pglite.exec("SELECT set_config('app.user_id', '', false); SET ROLE lavega_runtime;");
    const repo = createAgentRepository(db, "sim");
    await repo.putSettings({ ...settings, sendHour: before });
    await repo.putMirror({
      rules: [],
      dueDates: ["12", "13", "14", "15", "16"].map((d) => ({
        kind: "other" as const,
        label: `Deadline ${d}`,
        date: `2026-11-${d}`,
      })),
      cardOffer: null,
    });

    let at = Date.parse("2026-11-10T12:00:00Z");
    const perDate = new Map<string, number>();
    const instinct: InstinctDeps = {
      db,
      now: () => new Date(at),
      fetchSessions: async () => [
        {
          sessionId: "s1",
          payload: { aspsp: "ING", accounts: [] },
          createdAt: "2026-11-01T00:00:00.000Z",
        },
      ],
      rates: [],
      send: {
        feed: async () => {
          const day = amsterdamDay(new Date(at));
          perDate.set(day, (perDate.get(day) ?? 0) + 1);
          return "sent";
        },
        push: async () => "failed",
        email: async () => "failed",
        whatsapp: async () => "failed",
      },
      fetchOutcome: async () => ({
        status: "ok",
        txs: [],
        accounts: [account],
        balances: [],
        consentExpiresAt: new Date(at + 60 * 86_400_000).toISOString(),
        banks: [{ bank: "ING", state: "ok" }],
      }),
    };
    const deps = fakeDeps({
      now: () => new Date(at),
      listDue: (hour, retry, today) => listAgentDueUsers(db, hour, retry, today),
      run: (userId) => runForUser(instinct, userId),
    });
    const claims: (string | null)[] = [];
    for (const end = at + 48 * 3_600_000; at <= end; at += 3_600_000) {
      await pglite.exec(
        "RESET ROLE; UPDATE personal.agent_state SET fetches_today = 0; SET ROLE lavega_runtime;",
      );
      await runInstinctCron(request(SECRET), deps);
      claims.push((await repo.getState()).lastSentDate);
      if (at === Date.parse(changeAfter))
        await repo.putSettings({ ...settings, sendHour: after as number });
    }
    const seen = claims.filter((c): c is string => c !== null);
    expect(seen.length).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i]! >= seen[i - 1]!, `claim ${i}`).toBe(true);
    for (const [day, n] of perDate) expect(n, day).toBeLessThanOrEqual(1);
    expect(perDate.size).toBeGreaterThanOrEqual(2);
  },
);
