import type { Account, Tx } from "@lavega/core";
import {
  createAgentRepository,
  type AgentChannel,
  type AgentSettings,
  type Database,
} from "@lavega/database";
import { migratedTestDatabase } from "@lavega/database/testing";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { CONSENT_VERSION } from "../instinctConsent.js";
import { sendWhatsAppDaily } from "../whatsapp/channel.js";
import { CRON_FETCH_CAP, runForUser, WHATSAPP_FETCH_CAP, type InstinctDeps } from "./instinct.js";
import type { FetchOutcome } from "./unattendedFetch.js";

/* Real migrations on PGlite as lavega_runtime. Only the bank and the channels
 * are fakes. The repository is wrapped to record what it is asked to write. */

const writes: unknown[] = [];
let failAppend = false;
vi.mock("@lavega/database", async (importOriginal) => {
  const real = await importOriginal<typeof import("@lavega/database")>();
  return {
    ...real,
    createAgentRepository: (db: unknown, userId: string | null | undefined) => {
      const repo = real.createAgentRepository(db as never, userId);
      return {
        ...repo,
        putState: (patch: unknown) => (writes.push(patch), repo.putState(patch as never)),
        appendEvent: (e: unknown) => {
          if (failAppend) throw new Error("append failed");
          writes.push(e);
          return repo.appendEvent(e as never);
        },
      };
    },
  };
});

const SENTINEL = "SENTINEL-ZORGVERZEKERAAR";
const IBAN = "NL01INGB0000000001";
const DAY = 86_400_000;
const T0 = Date.parse("2026-11-11T07:00:00Z"); // 08:00 in Amsterdam, Wednesday

let pglite: Awaited<ReturnType<typeof migratedTestDatabase>>["pglite"];
let db: Database;
let clock = T0;

beforeAll(async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "22".repeat(32);
  process.env.AGENT_DEDUPE_HMAC_KEY = "33".repeat(32);
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  clock = T0;
  writes.length = 0;
  failAppend = false;
  await pglite.exec("RESET ROLE;");
  for (const t of ["events", "push_subscriptions", "mirror", "state", "settings", "whatsapp"])
    await pglite.exec(`DELETE FROM personal.agent_${t};`);
  await pglite.exec("SELECT set_config('app.user_id', '', false); SET ROLE lavega_runtime;");
});

afterEach(() => vi.restoreAllMocks());

const settings = (over: Partial<AgentSettings> = {}): AgentSettings => ({
  enabled: true,
  channels: ["feed", "email"],
  sendHour: 8,
  locale: "nl",
  email: "user@example.com",
  consentVersion: CONSENT_VERSION,
  consentedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

const account: Account = {
  key: IBAN,
  iban: IBAN,
  name: "Betaalrekening",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: 1000,
};
let n = 0;
const spend = (date: string, amount: number, counterparty: string): Tx => ({
  id: `t${n++}`,
  accountKey: IBAN,
  date,
  amount: -amount,
  currency: "EUR",
  counterparty,
  description: "",
  category: "",
  manual: false,
});

const okOutcome = (over: Partial<Extract<FetchOutcome, { status: "ok" }>> = {}): FetchOutcome => ({
  status: "ok",
  txs: [],
  accounts: [account],
  balances: [],
  consentExpiresAt: new Date(T0 + 60 * DAY).toISOString(),
  banks: [{ bank: "ING", state: "ok" }],
  ...over,
});

function setup(outcome: () => FetchOutcome, sendResult: "sent" | "failed" = "sent") {
  const sent: { channel: AgentChannel; args: unknown[] }[] = [];
  const send = Object.fromEntries(
    (["feed", "push", "email", "whatsapp"] as const).map((channel) => [
      channel,
      async (...args: unknown[]) => (sent.push({ channel, args }), sendResult),
    ]),
  ) as unknown as InstinctDeps["send"];
  const deps: InstinctDeps = {
    db,
    now: () => new Date(clock),
    fetchSessions: async () => [
      {
        sessionId: "s1",
        payload: { aspsp: "ING", accounts: [] },
        createdAt: "2026-11-01T00:00:00.000Z",
      },
    ],
    rates: [],
    send,
    fetchOutcome: async () => outcome(),
  };
  return { deps, sent };
}

const repoFor = (user: string) => createAgentRepository(db, user);

test("sentinel: a merchant name from the bank reaches no write, log line, channel call or prompt", async () => {
  await repoFor("a").putSettings(settings());
  const logs: unknown[] = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
  const { deps, sent } = setup(() =>
    okOutcome({ txs: [spend("2026-11-10", 200, SENTINEL), spend("2026-11-10", 5, IBAN)] }),
  );

  expect(await runForUser(deps, "a")).toBe("sent");

  const everything = JSON.stringify({ writes, logs, sent: sent.map((s) => s.args) });
  expect(sent.length).toBe(2);
  expect(everything).not.toContain(SENTINEL);
  expect(everything).not.toMatch(/[A-Z]{2}\d{2}[A-Z]{4}\d{10}/);
  const rows = await pglite.query("SELECT dedupe_key FROM personal.agent_events");
  expect(JSON.stringify(rows.rows)).not.toContain(SENTINEL);
  expect(writes.some((w) => (w as { type?: string }).type === "message")).toBe(true);
});

test("a disabled user is skipped before any bank call or claim", async () => {
  await repoFor("a").putSettings(settings({ enabled: false }));
  const fetchOutcome = vi.fn();
  const { deps } = setup(okOutcome);
  expect(await runForUser({ ...deps, fetchOutcome }, "a")).toBe("skipped");
  expect(fetchOutcome).not.toHaveBeenCalled();
  expect((await repoFor("a").getState()).lastSentDate).toBeNull();
});

test("a user on an older consent text gets no fetch and no send (F4)", async () => {
  await repoFor("a").putSettings(settings({ consentVersion: "2026-01-v0" }));
  const fetchOutcome = vi.fn();
  const { deps, sent } = setup(okOutcome);
  expect(await runForUser({ ...deps, fetchOutcome }, "a")).toBe("skipped");
  expect(fetchOutcome).not.toHaveBeenCalled();
  expect(sent).toHaveLength(0);
  expect((await repoFor("a").getState()).lastSentDate).toBeNull();
});

test("a refused bank sends nothing and leaves the day unclaimed", async () => {
  await repoFor("a").putSettings(settings());
  const { deps, sent } = setup(() =>
    okOutcome({ banks: [{ bank: "ING", state: "refused" }], consentExpiresAt: null }),
  );
  expect(await runForUser(deps, "a")).toBe("skipped");
  expect(sent).toHaveLength(0);
  expect((await repoFor("a").getState()).lastSentDate).toBeNull();
  expect(await repoFor("a").claimDay("2026-11-11")).toBe(true);
});

test("no bank connected releases the claim and sends nothing", async () => {
  await repoFor("a").putSettings(settings());
  const { deps, sent } = setup(() => ({ status: "no-bank" }));
  expect(await runForUser(deps, "a")).toBe("skipped");
  expect(sent).toHaveLength(0);
  expect((await repoFor("a").getState()).lastSentDate).toBeNull();
});

test("expired consent sends the paused notice once, then stays quiet", async () => {
  await repoFor("a").putSettings(settings());
  const { deps, sent } = setup(() =>
    okOutcome({ banks: [{ bank: "ING", state: "expired" }], consentExpiresAt: null }),
  );
  expect(await runForUser(deps, "a")).toBe("paused");
  expect(sent).toHaveLength(2);
  expect((await repoFor("a").getState()).expiryPausedNoted).toBe(true);

  clock += DAY;
  expect(await runForUser(deps, "a")).toBe("skipped");
  expect(sent).toHaveLength(2);
});

test("the consent reminder fires once, 7 days before expiry, and counts as the day's message", async () => {
  await repoFor("a").putSettings(settings({ channels: ["feed"] }));
  const expiry = new Date(T0 + 7 * DAY).toISOString();
  const { deps, sent } = setup(() => okOutcome({ consentExpiresAt: expiry }));

  expect(await runForUser(deps, "a")).toBe("reminded");
  expect(sent).toHaveLength(1);
  expect((await repoFor("a").getState()).expiryRemindedFor).toBe("2026-11-18");

  // Same day again: the claim holds. Next day: already reminded for this expiry.
  expect(await runForUser(deps, "a")).toBe("skipped");
  clock += DAY;
  expect(await runForUser(deps, "a")).toBe("none");
  expect(sent).toHaveLength(1);
});

test("no reminder 8 days out", async () => {
  await repoFor("a").putSettings(settings({ channels: ["feed"] }));
  const { deps } = setup(() =>
    okOutcome({ consentExpiresAt: new Date(T0 + 8 * DAY).toISOString() }),
  );
  expect(await runForUser(deps, "a")).toBe("none");
});

test("a send that fails on every channel releases the claim, so the next run retries", async () => {
  await repoFor("a").putSettings(settings());
  const { deps, sent } = setup(
    () => okOutcome({ txs: [spend("2026-11-10", 200, "Shop")] }),
    "failed",
  );
  expect(await runForUser(deps, "a")).toBe("skipped");
  expect(sent).toHaveLength(2);
  expect((await repoFor("a").getState()).lastSentDate).toBeNull();
  expect(writes).toEqual([]);
  expect(await repoFor("a").claimDay("2026-11-11")).toBe(true);
});

test("one channel failing still counts as sent; the day stays claimed", async () => {
  await repoFor("a").putSettings(settings());
  const { deps } = setup(() => okOutcome({ txs: [spend("2026-11-10", 200, "Shop")] }));
  deps.send.email = async () => "failed";
  expect(await runForUser(deps, "a")).toBe("sent");
  expect(await repoFor("a").claimDay("2026-11-11")).toBe(false);
});

test("sentKeys keep the same deadline from being sent again tomorrow", async () => {
  await repoFor("a").putSettings(settings({ channels: ["feed"] }));
  await repoFor("a").putMirror({
    rules: [],
    dueDates: [{ kind: "vat", label: "BTW", date: "2026-11-14" }],
    cardOffer: null,
  });
  const { deps, sent } = setup(okOutcome);

  expect(await runForUser(deps, "a")).toBe("sent");
  const state = await repoFor("a").getState();
  expect(state.sentKeys).toEqual([{ key: "deadline:vat:BTW:2026-11-14", date: "2026-11-11" }]);

  clock += DAY;
  expect(await runForUser(deps, "a")).toBe("none");
  expect(sent).toHaveLength(1);
});

test("a throwing fetch releases the claim and rethrows without touching the other user", async () => {
  await repoFor("a").putSettings(settings());
  await repoFor("b").putSettings(settings({ channels: ["feed"] }));
  const { deps } = setup(okOutcome);
  const failing = {
    ...deps,
    fetchOutcome: async () => {
      throw new Error("boom");
    },
  };
  await expect(runForUser(failing, "a")).rejects.toThrow("boom");
  expect(await repoFor("a").claimDay("2026-11-11")).toBe(true);
  expect(await runForUser(deps, "b")).toBe("none");
});

test("a quiet user is read once a day: nothing to say keeps the claim, later runs do not refetch", async () => {
  await repoFor("a").putSettings(settings());
  const { deps } = setup(okOutcome);
  const fetchOutcome = vi.fn(async () => okOutcome());
  expect(await runForUser({ ...deps, fetchOutcome }, "a")).toBe("none");
  for (const hours of [1, 2]) {
    clock = T0 + hours * 3_600_000;
    expect(await runForUser({ ...deps, fetchOutcome }, "a")).toBe("skipped");
  }
  expect(fetchOutcome).toHaveBeenCalledTimes(1);
});

test("a refused bank is retried on the next run but stops at the shared budget of 4 a day", async () => {
  await repoFor("a").putSettings(settings());
  const { deps, sent } = setup(okOutcome);
  const fetchOutcome = vi.fn(async () =>
    okOutcome({ banks: [{ bank: "ING", state: "refused" }], consentExpiresAt: null }),
  );
  for (let hour = 0; hour < 5; hour++) {
    clock = T0 + hour * 3_600_000;
    expect(await runForUser({ ...deps, fetchOutcome }, "a")).toBe("skipped");
  }
  expect(fetchOutcome).toHaveBeenCalledTimes(4);
  expect(sent).toHaveLength(0);
  // A new day resets the budget.
  clock = T0 + DAY;
  await runForUser({ ...deps, fetchOutcome }, "a");
  expect(fetchOutcome).toHaveBeenCalledTimes(5);
});

test("WhatsApp may take 3 fetches a day and the cron still gets its one; the total is 4", async () => {
  await repoFor("a").putSettings(settings());
  const repo = repoFor("a");
  const today = "2026-11-11";
  for (let n = 0; n < 3; n++)
    expect(await repo.takeFetchBudget(today, WHATSAPP_FETCH_CAP)).toBe(true);
  expect(await repo.takeFetchBudget(today, WHATSAPP_FETCH_CAP)).toBe(false);
  const { deps } = setup(() => okOutcome());
  const fetchOutcome = vi.fn(async () => okOutcome());
  await runForUser({ ...deps, fetchOutcome }, "a");
  expect(fetchOutcome).toHaveBeenCalledTimes(1);
});

test("after the cron fetched, WhatsApp gets 2 more and the total never passes 4", async () => {
  await repoFor("a").putSettings(settings());
  const repo = repoFor("a");
  const { deps } = setup(() => okOutcome());
  const fetchOutcome = vi.fn(async () => okOutcome({ txs: [spend("2026-11-10", 200, "Shop")] }));
  await runForUser({ ...deps, fetchOutcome }, "a");
  expect(fetchOutcome).toHaveBeenCalledTimes(1);
  const today = "2026-11-11";
  expect(await repo.takeFetchBudget(today, WHATSAPP_FETCH_CAP)).toBe(true);
  expect(await repo.takeFetchBudget(today, WHATSAPP_FETCH_CAP)).toBe(true);
  expect(await repo.takeFetchBudget(today, WHATSAPP_FETCH_CAP)).toBe(false);
  expect(await repo.takeFetchBudget(today, CRON_FETCH_CAP)).toBe(true); // 4th and last
  expect(await repo.takeFetchBudget(today, CRON_FETCH_CAP)).toBe(false);
  expect(await repo.takeFetchBudget(today, WHATSAPP_FETCH_CAP)).toBe(false);
});

test("state is saved before the event, so a failing event write cannot cause a repeat tomorrow", async () => {
  await repoFor("a").putSettings(settings({ channels: ["feed"] }));
  const { deps, sent } = setup(() => okOutcome({ txs: [spend("2026-11-10", 200, "Shop")] }));
  failAppend = true;
  await expect(runForUser(deps, "a")).rejects.toThrow("append failed");
  expect(sent).toHaveLength(1);
  const state = await repoFor("a").getState();
  expect(state.sentKeys).toEqual([{ key: "spending:2026-11-10", date: "2026-11-11" }]);
  // The claim stays: the message went out, a retry would send it twice.
  expect(await repoFor("a").claimDay("2026-11-11")).toBe(false);
});

/* W5(a): a retry after midnight belongs to the date on which the send hour fell. */
const T_0030 = Date.parse("2026-11-11T23:30:00Z"); // 00:30 on Thursday 2026-11-12 in Amsterdam
const T_2300 = Date.parse("2026-11-12T22:00:00Z"); // 23:00 on 2026-11-12
const fetchedDayOf = async (user: string) => {
  await pglite.exec("RESET ROLE;");
  const rows = await pglite.query<{ fetches_day: string | null; fetches_today: number }>(
    `SELECT to_char(fetches_day, 'YYYY-MM-DD') AS fetches_day, fetches_today
     FROM personal.agent_state WHERE user_id = '${user}'`,
  );
  await pglite.exec("SET ROLE lavega_runtime;");
  return rows.rows[0];
};

test("a retry after midnight claims the real date and judges the content by the real date (W5/A1/A2)", async () => {
  await repoFor("a").putSettings(settings({ channels: ["feed"], sendHour: 23 }));
  // Wednesday 11 Nov was the send day that failed; at 00:30 on Thursday 12 Nov the retry runs.
  clock = T_0030;
  const { deps, sent } = setup(() =>
    okOutcome({ txs: [spend("2026-11-11", 200, "Shop"), spend("2026-11-04", 10, "Shop")] }),
  );

  expect(await runForUser(deps, "a")).toBe("sent");
  expect(sent).toHaveLength(1);
  const state = await repoFor("a").getState();
  // The spending line is about the REAL yesterday (11 Nov), not two days back, and the claim and
  // the no-repeat key carry the real date.
  expect(state.lastSentDate).toBe("2026-11-12");
  expect(state.sentKeys).toEqual([{ key: "spending:2026-11-11", date: "2026-11-12" }]);
  expect(await fetchedDayOf("a")).toEqual({ fetches_day: "2026-11-12", fetches_today: 1 });
  // One message per real date: neither a second run now nor the 23:00 send of the same date.
  expect(await runForUser(deps, "a")).toBe("skipped");
  clock = T_2300;
  expect(await runForUser(deps, "a")).toBe("skipped");
  expect(sent).toHaveLength(1);
  expect(await repoFor("a").claimDay("2026-11-12")).toBe(false);
  expect(await repoFor("a").claimDay("2026-11-11")).toBe(false);
  // The next evening goes out as usual, with a new spending line (about 12 Nov).
  clock = T_2300 + DAY;
  const { deps: next, sent: sentNext } = setup(() =>
    okOutcome({ txs: [spend("2026-11-12", 300, "Shop")] }),
  );
  expect(await runForUser(next, "a")).toBe("sent");
  expect(sentNext).toHaveLength(1);
});

test("a due date on the real date reads as today in a retry after midnight (A1)", async () => {
  await repoFor("a").putSettings(settings({ channels: ["feed"], sendHour: 23 }));
  await repoFor("a").putMirror({
    rules: [],
    dueDates: [{ kind: "vat", label: "BTW", date: "2026-11-12" }],
    cardOffer: null,
  });
  clock = T_0030;
  const { deps, sent } = setup(okOutcome);
  expect(await runForUser(deps, "a")).toBe("sent");
  expect((sent[0]!.args[1] as { long: string }).long).toMatch(/vandaag/i);
  expect((await repoFor("a").getState()).sentKeys).toEqual([
    { key: "deadline:vat:BTW:2026-11-12", date: "2026-11-12" },
  ]);
});

test("without a retry the date of now is used as before", async () => {
  await repoFor("a").putSettings(settings({ channels: ["feed"] }));
  const { deps } = setup(okOutcome);
  await runForUser(deps, "a");
  expect((await repoFor("a").getState()).lastSentDate).toBe("2026-11-11");
});

test("a message from the no-bank-data path keeps the paused-notice flag, so the notice cannot repeat (A6)", async () => {
  await repoFor("a").putSettings(settings({ channels: ["feed"] }));
  await repoFor("a").putState({ expiryPausedNoted: true });
  await repoFor("a").putMirror({
    rules: [],
    dueDates: [{ kind: "vat", label: "BTW", date: "2026-11-14" }],
    cardOffer: null,
  });
  await useUpCap("a", "2026-11-11");
  const { deps } = setup(okOutcome);
  expect(await runForUser(deps, "a")).toBe("sent");
  expect((await repoFor("a").getState()).expiryPausedNoted).toBe(true);
});

/* W5(b): the shared fetch cap is used up. */
const useUpCap = async (user: string, day: string) => {
  for (let i = 0; i < CRON_FETCH_CAP; i++)
    expect(await repoFor(user).takeFetchBudget(day, CRON_FETCH_CAP)).toBe(true);
};

test("cap exhausted and a due date within 7 days: one message from the deadline, no bank call (W5)", async () => {
  await repoFor("a").putSettings(settings({ channels: ["feed"] }));
  await repoFor("a").putMirror({
    rules: [],
    dueDates: [{ kind: "vat", label: "BTW", date: "2026-11-14" }],
    cardOffer: null,
  });
  await useUpCap("a", "2026-11-11");
  const { deps, sent } = setup(okOutcome);
  const fetchOutcome = vi.fn(async () => okOutcome());
  expect(await runForUser({ ...deps, fetchOutcome }, "a")).toBe("sent");
  expect(fetchOutcome).not.toHaveBeenCalled();
  expect(sent).toHaveLength(1);
  expect((sent[0]!.args[1] as { long: string }).long).toContain("BTW");
  expect((await repoFor("a").getState()).sentKeys).toEqual([
    { key: "deadline:vat:BTW:2026-11-14", date: "2026-11-11" },
  ]);
  // Still one a day, and still no bank call.
  expect(await runForUser({ ...deps, fetchOutcome }, "a")).toBe("skipped");
  expect(fetchOutcome).not.toHaveBeenCalled();
});

test("cap exhausted and nothing qualifies: no message, the claim is kept, no bank call (W5)", async () => {
  await repoFor("a").putSettings(settings({ channels: ["feed"] }));
  await useUpCap("a", "2026-11-11");
  const { deps, sent } = setup(okOutcome);
  const fetchOutcome = vi.fn(async () => okOutcome({ txs: [spend("2026-11-10", 200, "Shop")] }));
  expect(await runForUser({ ...deps, fetchOutcome }, "a")).toBe("skipped");
  expect(fetchOutcome).not.toHaveBeenCalled();
  expect(sent).toHaveLength(0);
  expect((await repoFor("a").getState()).lastSentDate).toBe("2026-11-11");
  expect(await repoFor("a").claimDay("2026-11-11")).toBe(false);
  // Spending needs the bank: even if a later run could see it, nothing is sent now.
  clock = T0 + 3_600_000;
  expect(await runForUser({ ...deps, fetchOutcome }, "a")).toBe("skipped");
  expect(fetchOutcome).not.toHaveBeenCalled();
});

/* W4(a): a stale WhatsApp link is dropped by the channel; every other channel still goes out. */
test("a 91-day-idle WhatsApp link is removed, one notice lands in the feed, and email still sends (W4)", async () => {
  process.env.AGENT_PHONE_HMAC_KEY = "44".repeat(32);
  process.env.WHATSAPP_TEMPLATE_DAILY = "lavega_daily";
  try {
    await repoFor("a").putSettings(settings({ channels: ["feed", "email", "whatsapp"] }));
    await repoFor("a").putMirror({
      rules: [],
      dueDates: [{ kind: "vat", label: "BTW", date: "2026-11-14" }],
      cardOffer: null,
    });
    const { encryptBlob } = await import("@lavega/database");
    await pglite.exec("RESET ROLE;");
    await pglite.query(
      `INSERT INTO personal.agent_whatsapp (user_id, phone_hash, phone_blob, linked_at, last_inbound_at)
       VALUES ('a', 'h', $1, $2::timestamptz, $3::timestamptz)`,
      [
        encryptBlob("+31612345678"),
        new Date(T0 - 200 * DAY).toISOString(),
        new Date(T0 - 91 * DAY).toISOString(),
      ],
    );
    await pglite.exec("SET ROLE lavega_runtime;");
    const template = vi.fn(async () => ({ wamid: "w" }));
    const { deps, sent } = setup(okOutcome);
    deps.send.whatsapp = (userId, msg, s) =>
      sendWhatsAppDaily(userId, msg, s.locale, repoFor(userId), {
        client: { sendTemplate: template, sendText: vi.fn(), sendButtons: vi.fn() } as never,
        now: () => clock,
      });

    expect(await runForUser(deps, "a")).toBe("sent");
    expect(template).not.toHaveBeenCalled();
    expect(sent.map((s) => s.channel)).toEqual(["feed", "email"]);
    expect(await repoFor("a").getLink()).toBeNull();
    const events = await repoFor("a").listEvents({ channel: "feed", limit: 10 });
    expect(events.map((e) => e.body.text).filter((t) => t.includes("verlopen"))).toHaveLength(1);
  } finally {
    delete process.env.WHATSAPP_TEMPLATE_DAILY;
  }
});
