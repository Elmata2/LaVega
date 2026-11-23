import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  createAgentRepository,
  createEbFlowRepository,
  erasePersonalData,
  eraseUserData,
  type Database,
} from "./index.js";
import { migratedTestDatabase } from "./testing.js";

let pglite: PGlite;
let db: Database;

beforeAll(async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "11".repeat(32);
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec(`
    RESET ROLE;
    DELETE FROM personal.eb_daily_reads;
    DELETE FROM personal.agent_settings;
    DELETE FROM personal.agent_state;
    DELETE FROM public."user";
    SET ROLE lavega_runtime;
  `);
});

test("web refresh, WhatsApp, and Instinct cron share one daily read counter per user", async () => {
  const ebRepo = createEbFlowRepository(db);
  const agentRepo = createAgentRepository(db, "user-a");
  await agentRepo.putSettings({
    enabled: true,
    channels: ["feed"],
    sendHour: 8,
    locale: "nl",
    consentVersion: "v1",
    consentedAt: "2026-11-11T00:00:00.000Z",
    email: null,
  });

  const day = "2026-11-11";
  // 2 web refreshes
  expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(true);
  expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(true);
  // 1 WhatsApp read (cap 3) -> total 3
  expect(await agentRepo.takeFetchBudget(day, 3)).toBe(true);
  // WhatsApp cannot take a 4th (cap 3)
  expect(await agentRepo.takeFetchBudget(day, 3)).toBe(false);
  // Cron takes the 4th and final read (cap 4) -> total 4
  expect(await agentRepo.takeFetchBudget(day, 4)).toBe(true);
  // Web refresh is now also blocked for the rest of the day
  expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(false);
  expect(await agentRepo.takeFetchBudget(day, 4)).toBe(false);

  // Next day resets the shared counter
  expect(await ebRepo.takeFetchBudget("user-a", "2026-11-12", 4)).toBe(true);
});

test("web refresh counts reads even when the Instinct agent was never enabled", async () => {
  const ebRepo = createEbFlowRepository(db);
  const day = "2026-11-11";
  const results = [];
  for (let i = 0; i < 5; i++) {
    results.push(await ebRepo.takeFetchBudget("web-only-user", day, 4));
  }
  expect(results).toEqual([true, true, true, true, false]);
});

test("a disabled Instinct agent cannot increment a counter already created by web refresh", async () => {
  const ebRepo = createEbFlowRepository(db);
  const agentRepo = createAgentRepository(db, "user-a");
  const day = "2026-11-11";

  expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(true);
  expect(await agentRepo.takeFetchBudget(day, 4)).toBe(false);

  // Still 3 web reads left (agent did not consume one)
  expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(true);
  expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(true);
  expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(true);
  expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(false);
});

test("daily read counters are isolated per user under RLS", async () => {
  const ebRepo = createEbFlowRepository(db);
  const day = "2026-11-11";
  for (let i = 0; i < 4; i++) {
    expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(true);
  }
  expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(false);
  expect(await ebRepo.takeFetchBudget("user-b", day, 4)).toBe(true);
});

test("GDPR erasure deletes personal.eb_daily_reads while personal reset preserves the daily cap", async () => {
  const ebRepo = createEbFlowRepository(db);
  const day = "2026-11-11";
  for (let i = 0; i < 4; i++) {
    expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(true);
  }

  // Personal reset keeps the cap intact (same as personal.ai_usage)
  await erasePersonalData(db, "user-a");
  expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(false);

  // Full GDPR erasure removes the row
  const report = await eraseUserData(db, "user-a");
  expect(report.map((entry) => entry.table)).toContain("personal.eb_daily_reads");
  expect(await ebRepo.takeFetchBudget("user-a", day, 4)).toBe(true);
});
