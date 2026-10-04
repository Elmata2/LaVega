import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createAgentMemoryRepository, eraseUserData, type Database } from "./index.js";
import { databaseOver, migratedTestDatabase } from "./testing.js";

/* Deletion rules and tenant isolation live in foreign keys and RLS policies,
 * so these run the real migrations on real Postgres as the runtime role. */

let pglite: PGlite;
let db: Database;

const THREAD_A = "00000000-0000-4000-8000-00000000000a";
const THREAD_B = "00000000-0000-4000-8000-00000000000b";
const thesis = (why: string) => ({ why, worth: "€400", entry: null, wrongIf: null });
const userMessage = (text: string) => ({ id: text, role: "user", parts: [{ type: "text", text }] });

const letter = (snapshotHash: string, id = crypto.randomUUID()) => ({
  id,
  snapshotHash,
  holdingsHash: "holdings",
  verdict: "Concentrated, but in quality.",
  observations: [{ title: "ASML", body: "ASML is 30% of the book.", figures: ["30%"] }],
});

beforeAll(async () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "22".repeat(32);
  ({ pglite, db } = await migratedTestDatabase());
}, 60_000);

afterAll(async () => {
  delete process.env.LAVEGA_ENCRYPTION_KEY;
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec(
    `RESET ROLE;
     DELETE FROM investing.portfolio_letters; DELETE FROM investing.agent_observations; DELETE FROM investing.agent_messages;
     DELETE FROM investing.goals; DELETE FROM investing.theses;
     DELETE FROM investing.agent_threads; DELETE FROM investing.preferences;
     SET ROLE lavega_runtime;`,
  );
});

test("one user never sees or touches another user's memory", async () => {
  const alice = createAgentMemoryRepository(db, "alice");
  const bob = createAgentMemoryRepository(db, "bob");
  await alice.appendMessages(THREAD_A, "charlie_munger", "ASML", [userMessage("hi")]);
  await alice.confirmThesis("asml", thesis("Lithography monopoly"));
  const goal = await alice.confirmGoal({ symbol: null, text: "€500/month", sourceThreadId: null });
  await alice.setRiskTolerance("balanced");

  expect(await bob.listThreads("charlie_munger")).toEqual([]);
  expect(await bob.getThread(THREAD_A)).toBeNull();
  expect(await bob.listTheses()).toEqual([]);
  expect(await bob.listGoals()).toEqual([]);
  expect(await bob.getRiskTolerance()).toBeNull();
  expect(await bob.deleteThread(THREAD_A)).toBe(false);
  expect(await bob.editGoal(goal.id, { symbol: null, text: "hijack" })).toBeNull();
  expect(await bob.editThesis("ASML", thesis("hijack"))).toBeNull();
  /* The same thread id is a different row for Bob, not a way into Alice's. */
  await bob.appendMessages(THREAD_A, "charlie_munger", "mine", [userMessage("bob")]);
  await expect(
    bob.addObservation({ agentId: "charlie_munger", threadId: THREAD_B, symbol: null, text: "x" }),
  ).rejects.toThrow();

  const aliceThread = await alice.getThread(THREAD_A);
  expect(aliceThread?.title).toBe("ASML");
  expect(aliceThread?.messages).toEqual([userMessage("hi")]);
  expect((await alice.listTheses())[0]?.why).toBe("Lithography monopoly");
  expect((await alice.listGoals())[0]?.text).toBe("€500/month");
});

test("free text is encrypted at rest", async () => {
  const alice = createAgentMemoryRepository(db, "alice");
  await alice.confirmThesis("ASML", thesis("Lithography monopoly"));
  await pglite.exec("RESET ROLE;");
  const stored = await pglite.query<{ body_blob: Uint8Array }>(
    "SELECT body_blob FROM investing.theses",
  );
  await pglite.exec("SET ROLE lavega_runtime;");
  expect(Buffer.from(stored.rows[0]!.body_blob).toString("utf8")).not.toContain("Lithography");
});

test("messages reload in order and a thread stays with its agent", async () => {
  const memory = createAgentMemoryRepository(db, "alice");
  await memory.appendMessages(THREAD_A, "charlie_munger", "First", [userMessage("one")]);
  await memory.appendMessages(THREAD_A, "charlie_munger", "ignored", [
    { id: "r1", role: "assistant", parts: [{ type: "text", text: "two" }] },
    userMessage("three"),
  ]);

  expect((await memory.getThread(THREAD_A))?.messages.map((m) => (m as { id: string }).id)).toEqual(
    ["one", "r1", "three"],
  );
  expect((await memory.listThreads("charlie_munger")).map((t) => t.title)).toEqual(["First"]);
  expect(await memory.listThreads("warren_buffett")).toEqual([]);
  await expect(
    memory.appendMessages(THREAD_A, "warren_buffett", "steal", [userMessage("x")]),
  ).rejects.toThrow("Thread belongs to another agent");
});

test("deleting a thread removes its messages and observations but keeps theses and goals", async () => {
  const memory = createAgentMemoryRepository(db, "alice");
  await memory.appendMessages(THREAD_A, "charlie_munger", "ASML", [userMessage("hi")]);
  await memory.appendMessages(THREAD_B, "charlie_munger", "Other", [userMessage("other")]);
  await memory.confirmThesis("ASML", thesis("Monopoly"));
  const goal = await memory.confirmGoal({
    symbol: "ASML",
    text: "Trim above 15%",
    sourceThreadId: THREAD_A,
  });
  await memory.addObservation({
    agentId: "charlie_munger",
    threadId: THREAD_A,
    symbol: "ASML",
    text: "Worried about China",
  });
  const kept = await memory.addObservation({
    agentId: "charlie_munger",
    threadId: THREAD_B,
    symbol: null,
    text: "Likes dividends",
  });

  expect(await memory.deleteThread(THREAD_A)).toBe(true);

  expect(await memory.getThread(THREAD_A)).toBeNull();
  const observations = await memory.recall({ kind: "observations", agentId: "charlie_munger" }, 20);
  expect(observations).toEqual({ kind: "observations", observations: [kept] });
  expect((await memory.listTheses()).map((t) => t.symbol)).toEqual(["ASML"]);
  expect(await memory.listGoals()).toEqual([
    expect.objectContaining({ id: goal.id, text: "Trim above 15%", sourceThreadId: null }),
  ]);
});

test("the turn summary is one round trip with risk tolerance, goals and the theses that matter", async () => {
  const memory = createAgentMemoryRepository(db, "alice");
  await memory.setRiskTolerance("aggressive");
  await memory.confirmGoal({ symbol: null, text: "€500/month", sourceThreadId: null });
  await memory.confirmThesis("ASML", thesis("Monopoly"));
  await memory.confirmThesis("KO", thesis("Brand"));
  await memory.confirmThesis("AAPL", thesis("Ecosystem"));

  let roundTrips = 0;
  const counted = databaseOver(async () => {
    roundTrips += 1;
    return {
      query: (text: string, params?: unknown[]) => pglite.query(text, params as never[]),
      release: () => undefined,
    };
  });
  const summary = await createAgentMemoryRepository(counted, "alice").summary({
    held: ["ASML", "KO", "MSFT"],
    named: ["asml", "MSFT"],
    closeUnheld: true,
  });

  expect(roundTrips).toBe(1);
  expect(summary.riskTolerance).toBe("aggressive");
  expect(summary.goals.map((goal) => goal.text)).toEqual(["€500/month"]);
  /* KO is held but not named; AAPL is not held and was closed by this turn. */
  expect(summary.theses.map((t) => [t.symbol, t.status, t.why])).toEqual([
    ["ASML", "active", "Monopoly"],
  ]);
  expect((await memory.listTheses()).find((t) => t.symbol === "AAPL")?.status).toBe("dormant");
});

test("a dormant thesis is not read by agents until the symbol is held again", async () => {
  const memory = createAgentMemoryRepository(db, "alice");
  await memory.confirmThesis("AAPL", thesis("Ecosystem"));
  await memory.summary({ held: ["KO"], named: [], closeUnheld: true });

  expect(await memory.recall({ kind: "theses" }, 20)).toEqual({ kind: "theses", theses: [] });
  expect(await memory.recall({ kind: "theses", symbol: "AAPL" }, 20)).toEqual({
    kind: "theses",
    theses: [],
  });
  expect(
    (await memory.summary({ held: ["KO"], named: ["AAPL"], closeUnheld: true })).theses,
  ).toEqual([]);

  /* Rebought: the summary carries it, still dormant, whether or not it is named. */
  const rebought = await memory.summary({ held: ["AAPL", "KO"], named: [], closeUnheld: true });
  expect(rebought.theses.map((t) => [t.symbol, t.status])).toEqual([["AAPL", "dormant"]]);

  await memory.confirmThesis("AAPL", thesis("Ecosystem, still"));
  expect(await memory.recall({ kind: "theses", symbol: "aapl" }, 20)).toEqual({
    kind: "theses",
    theses: [expect.objectContaining({ symbol: "AAPL", status: "active" })],
  });
});

test("an unguarded turn leaves theses alone", async () => {
  const memory = createAgentMemoryRepository(db, "alice");
  await memory.confirmThesis("AAPL", thesis("Ecosystem"));
  await memory.summary({ held: [], named: [], closeUnheld: false });
  expect((await memory.listTheses())[0]?.status).toBe("active");
});

test("recall filters by agent, symbol and time", async () => {
  const memory = createAgentMemoryRepository(db, "alice");
  await memory.appendMessages(THREAD_A, "charlie_munger", "Munger", [userMessage("m")]);
  await memory.appendMessages(THREAD_B, "warren_buffett", "Buffett", [userMessage("b")]);
  await memory.addObservation({
    agentId: "charlie_munger",
    threadId: THREAD_A,
    symbol: "ASML",
    text: "asml note",
  });
  await memory.addObservation({
    agentId: "charlie_munger",
    threadId: THREAD_A,
    symbol: null,
    text: "general note",
  });
  await memory.addObservation({
    agentId: "warren_buffett",
    threadId: THREAD_B,
    symbol: "ASML",
    text: "buffett note",
  });
  await memory.confirmGoal({ symbol: "ASML", text: "trim", sourceThreadId: THREAD_A });
  await memory.confirmGoal({ symbol: null, text: "income", sourceThreadId: null });

  const texts = async (query: Parameters<typeof memory.recall>[0]) => {
    const result = await memory.recall(query, 20);
    return result.kind === "observations"
      ? result.observations.map((o) => o.text).sort()
      : result.kind === "goals"
        ? result.goals.map((g) => g.text).sort()
        : result.kind === "threads"
          ? result.threads.map((t) => t.title).sort()
          : result.theses.map((t) => t.symbol);
  };

  expect(await texts({ kind: "observations", agentId: "charlie_munger" })).toEqual([
    "asml note",
    "general note",
  ]);
  expect(await texts({ kind: "observations", agentId: "charlie_munger", symbol: "asml" })).toEqual([
    "asml note",
  ]);
  expect(
    await texts({ kind: "observations", agentId: "charlie_munger", since: "2999-01-01" }),
  ).toEqual([]);
  expect(await texts({ kind: "threads", agentId: "warren_buffett" })).toEqual(["Buffett"]);
  expect(await texts({ kind: "goals", symbol: "ASML" })).toEqual(["trim"]);
  expect(await texts({ kind: "goals" })).toEqual(["income", "trim"]);
  const limited = await memory.recall({ kind: "observations", agentId: "charlie_munger" }, 1);
  expect(limited.kind === "observations" && limited.observations).toHaveLength(1);
});

test("editing keeps a thesis's status and a goal's source", async () => {
  const memory = createAgentMemoryRepository(db, "alice");
  await memory.appendMessages(THREAD_A, "charlie_munger", "t", [userMessage("m")]);
  await memory.confirmThesis("AAPL", thesis("Ecosystem"));
  await memory.summary({ held: ["KO"], named: [], closeUnheld: true });
  const goal = await memory.confirmGoal({ symbol: null, text: "income", sourceThreadId: THREAD_A });

  expect(await memory.editThesis("aapl", thesis("Services"))).toEqual(
    expect.objectContaining({ symbol: "AAPL", status: "dormant", why: "Services" }),
  );
  expect(await memory.editGoal(goal.id, { symbol: "ko", text: "more income" })).toEqual(
    expect.objectContaining({ symbol: "KO", text: "more income", sourceThreadId: THREAD_A }),
  );
  expect(await memory.editThesis("MSFT", thesis("none"))).toBeNull();
});

test("the export holds every memory table and erase-all-data removes them", async () => {
  const memory = createAgentMemoryRepository(db, "alice");
  await memory.appendMessages(THREAD_A, "charlie_munger", "ASML", [userMessage("hi")]);
  await memory.confirmThesis("ASML", thesis("Monopoly"));
  await memory.confirmGoal({ symbol: null, text: "income", sourceThreadId: THREAD_A });
  await memory.addObservation({
    agentId: "charlie_munger",
    threadId: THREAD_A,
    symbol: null,
    text: "note",
  });
  await memory.setRiskTolerance("conservative");
  await memory.saveLetter(letter("snap-1"));
  await createAgentMemoryRepository(db, "bob").confirmThesis("KO", thesis("Brand"));

  const exported = await memory.exportAll();
  expect(exported.riskTolerance).toBe("conservative");
  expect(exported.threads).toEqual([
    expect.objectContaining({ id: THREAD_A, title: "ASML", messages: [userMessage("hi")] }),
  ]);
  expect(exported.theses.map((t) => t.symbol)).toEqual(["ASML"]);
  expect(exported.goals.map((g) => g.text)).toEqual(["income"]);
  expect(exported.observations.map((o) => o.text)).toEqual(["note"]);
  expect(exported.letters.map((l) => l.snapshotHash)).toEqual(["snap-1"]);

  await eraseUserData(db, "alice");

  expect(await memory.exportAll()).toEqual({
    riskTolerance: null,
    threads: [],
    theses: [],
    goals: [],
    observations: [],
    letters: [],
  });
  expect(await createAgentMemoryRepository(db, "bob").listTheses()).toHaveLength(1);
});

test("a letter is stored once per snapshot, encrypted, and private to its owner", async () => {
  const alice = createAgentMemoryRepository(db, "alice");
  expect(await alice.latestLetter()).toBeNull();

  const first = await alice.saveLetter(letter("snap-1"));
  const again = await alice.saveLetter(letter("snap-1"));
  expect(again).toEqual(first);
  expect(first.observations).toEqual(letter("snap-1").observations);

  const second = await alice.saveLetter(letter("snap-2"));
  expect((await alice.latestLetter())?.id).toBe(second.id);
  expect(await createAgentMemoryRepository(db, "bob").latestLetter()).toBeNull();
  /* Another user may hold a letter for the same snapshot hash. */
  const bobs = await createAgentMemoryRepository(db, "bob").saveLetter(letter("snap-1"));
  expect(bobs.id).not.toBe(first.id);

  await pglite.exec("RESET ROLE;");
  const stored = await pglite.query<{ body_blob: Uint8Array }>(
    "SELECT body_blob FROM investing.portfolio_letters WHERE user_id = 'alice'",
  );
  await pglite.exec("SET ROLE lavega_runtime;");
  expect(Buffer.from(stored.rows[0]!.body_blob).toString("utf8")).not.toContain("quality");
});
