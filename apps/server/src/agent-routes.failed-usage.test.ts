import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Hono } from "hono";

/* A failed MODEL call must become a failed ledger row (#300, WS5.7 leftover).
 *
 * Kept in its own file: module-mocking ./agent/budget.js here would otherwise
 * apply to every test in agent-routes.test.ts. The budget module is mocked so
 * the test observes the WIRING — which route, which error code and which HTTP
 * status reach recordFailure — without a database. The row shape itself is
 * proven against PGlite in packages/database/src/aiUsageOps.test.ts. */

const { checkBudgetMock, recordUsageMock, recordFailureMock, releaseReservationMock } = vi.hoisted(
  () => ({
    checkBudgetMock: vi.fn(async () => ({
      ok: true as const,
      reservation: {
        kind: "memory" as const,
        userId: "unscoped",
        day: "2026-11-11",
        month: "2026-11",
        amount: 25,
        settled: false,
      },
    })),
    recordUsageMock: vi.fn(async () => undefined),
    recordFailureMock: vi.fn(async () => undefined),
    releaseReservationMock: vi.fn(async () => undefined),
  }),
);

vi.mock("./agent/budget.js", async () => {
  const actual = await vi.importActual<typeof import("./agent/budget.js")>("./agent/budget.js");
  return {
    ...actual,
    checkBudget: checkBudgetMock,
    recordUsage: recordUsageMock,
    recordFailure: recordFailureMock,
    releaseReservation: releaseReservationMock,
  };
});

const { registerAgentRoutes } = await import("./agent-routes.js");
const { MistralHttpError } = await import("./agent/mistral.js");

beforeEach(() => {
  vi.stubEnv("LAVEGA_CHAT_ENABLED", "true");
  vi.stubEnv("MISTRAL_API_KEY", "sk-ant-test");
  checkBudgetMock.mockClear();
  recordUsageMock.mockClear();
  recordFailureMock.mockClear();
  releaseReservationMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
});

test("a failed extract-invoice model call is recorded as a failure with code and HTTP status", async () => {
  const app = new Hono();
  registerAgentRoutes(app, {
    extract: async () => {
      throw new MistralHttpError(429, "chat", "spend cap reached");
    },
  });

  const res = await app.request("/api/agent/extract-invoice", jsonPost({ text: "factuur" }));
  expect(res.status).toBe(502);
  expect(recordFailureMock).toHaveBeenCalledTimes(1);
  expect(recordFailureMock).toHaveBeenCalledWith(
    {
      route: "extract-invoice",
      model: "mistral-small-latest",
      errorCode: "ai-upstream-limit",
      httpStatus: 429,
    },
    expect.objectContaining({ kind: "memory" }),
  );
});

test("a failed categorize model call is recorded, and a timeout carries no HTTP status", async () => {
  const app = new Hono();
  registerAgentRoutes(app, {
    categorize: async () => {
      throw new Error("mistral chat timeout after 60000ms");
    },
  });

  const res = await app.request(
    "/api/agent/categorize",
    jsonPost({ items: [{ id: "t1", text: "Albert Heijn", sign: "out" }] }),
  );
  expect(res.status).toBe(502);
  expect(recordFailureMock).toHaveBeenCalledWith(
    {
      route: "categorize",
      model: "mistral-small-latest",
      errorCode: "ai-timeout",
    },
    expect.anything(),
  );
});

test("a failed chat turn is recorded as a failure, and still answers with an SSE error frame", async () => {
  const app = new Hono();
  registerAgentRoutes(app, {
    chat: async function* () {
      yield "";
      throw new MistralHttpError(500, "conversation", "upstream fault");
    },
  });

  const res = await app.request(
    "/api/agent/chat",
    jsonPost({ tab: "overzicht", messages: [{ role: "user", content: "hoi" }] }),
  );
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("event: error");
  expect(recordFailureMock).toHaveBeenCalledWith(
    {
      route: "chat",
      model: "mistral-medium-latest",
      errorCode: "ai-fault",
      httpStatus: 500,
    },
    expect.anything(),
  );
});

test("an input-validation failure releases the reservation and records no model failure", async () => {
  const app = new Hono();
  registerAgentRoutes(app, { extract: async () => ({ fields: {}, confidence: null }) as never });

  const res = await app.request("/api/agent/extract-invoice", jsonPost({ text: 42 }));
  expect(res.status).toBe(400);
  expect(recordFailureMock).not.toHaveBeenCalled();
  expect(releaseReservationMock).toHaveBeenCalled();
});
