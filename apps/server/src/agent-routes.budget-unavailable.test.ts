import { expect, test, vi } from "vitest";
import { Hono } from "hono";

/* checkBudget()/spentCents() failing (Neon unreachable) must answer the
 * codebase's Dutch "temporarily unavailable" 503, not fall through to Hono's
 * generic Internal Server Error — and for chat specifically, must surface as
 * an SSE error frame under 200 rather than a top-level 500, matching how
 * every other chat failure already behaves. Kept in its own file (rather than
 * folded into agent-routes.test.ts) because module-mocking `./agent/budget.js`
 * here would otherwise apply to every test in that file. */

const { checkBudgetMock, spentCentsMock } = vi.hoisted(() => ({
  checkBudgetMock: vi.fn(async () => {
    throw new Error("Neon unreachable");
  }),
  spentCentsMock: vi.fn(async () => {
    throw new Error("Neon unreachable");
  }),
}));

vi.mock("./agent/budget.js", async () => {
  const actual = await vi.importActual<typeof import("./agent/budget.js")>("./agent/budget.js");
  return { ...actual, checkBudget: checkBudgetMock, spentCents: spentCentsMock };
});

const { registerAgentRoutes } = await import("./agent-routes.js");

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  };
}

async function withApiKey(fn: () => Promise<void>): Promise<void> {
  const prev = process.env.MISTRAL_API_KEY;
  process.env.MISTRAL_API_KEY = "sk-ant-test";
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = prev;
  }
}

test("extract-invoice returns 503, not a generic 500, when checkBudget() itself throws", async () => {
  await withApiKey(async () => {
    const app = new Hono();
    registerAgentRoutes(app);
    const res = await app.request("/api/agent/extract-invoice", jsonPost({ text: "factuur" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "De AI-dienst is tijdelijk niet beschikbaar." });
  });
});

test("categorize returns 503 when checkBudget() itself throws", async () => {
  await withApiKey(async () => {
    const app = new Hono();
    registerAgentRoutes(app);
    const res = await app.request(
      "/api/agent/categorize",
      jsonPost({ items: [{ id: "t1", text: "x", sign: "out" }] }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "De AI-dienst is tijdelijk niet beschikbaar." });
  });
});

test("travel-facts returns 503 when checkBudget() itself throws, before the request body is even parsed", async () => {
  await withApiKey(async () => {
    const app = new Hono();
    registerAgentRoutes(app);
    const res = await app.request(
      "/api/agent/travel-facts",
      jsonPost({ destination: "US", providers: ["Test Bank"] }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "De AI-dienst is tijdelijk niet beschikbaar." });
  });
});

test("GET /api/agent/budget returns 503 when spentCents() itself throws", async () => {
  const app = new Hono();
  registerAgentRoutes(app);
  const res = await app.request("/api/agent/budget");
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "De AI-dienst is tijdelijk niet beschikbaar." });
});

test("chat: checkBudget() throwing surfaces as an SSE error frame under 200, matching every other chat failure — never a top-level 500", async () => {
  await withApiKey(async () => {
    const app = new Hono();
    let called = false;
    registerAgentRoutes(app, {
      chat: async function* () {
        called = true;
        yield "hoi";
      },
    });
    const res = await app.request(
      "/api/agent/chat",
      jsonPost({ tab: "overview", messages: [{ role: "user", content: "hoi" }] }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("De AI-dienst is tijdelijk niet beschikbaar.");
    expect(called).toBe(false);
  });
});
