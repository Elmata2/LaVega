import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Hono } from "hono";
import { registerAgentRoutes } from "./agent-routes.js";
import { createRateLimiter } from "./agent/rateLimit.js";
import { resetBudgetMemory } from "./agent/budget.js";

/* M8 / #246 (security review 2026-10-17): the per-caller limiter is
 * per-process. On Vercel every instance keeps its own counters and a cold start
 * resets them, so a burst spread across routes or addresses is bounded by the
 * instance count, not by the limiter. Accepted for a single-user app — the real
 * spend cap is the Neon-backed budget — but one process-wide ceiling stops a
 * single instance being drained before the next budget read.
 *
 * This file pins that ceiling by INJECTING a tiny one; the default (120/min) is
 * far above anything a person generates. A separate module registry means the
 * injected limiter cannot disturb the real one other suites exercise. */

beforeEach(() => {
  vi.stubEnv("LAVEGA_CHAT_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetBudgetMemory();
});

const FAKE_RESULT = { fields: {}, confidence: 0.9 };
/** Each request carries a DIFFERENT address, so the per-caller bucket never
 *  fills — exactly the rotating-caller shape the global cap exists for. */
function rotatingPost(body: unknown, i: number): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${i}` },
  };
}

test("a rotating caller is stopped by the process-wide ceiling, not the per-caller one", async () => {
  const prev = process.env.MISTRAL_API_KEY;
  process.env.MISTRAL_API_KEY = "sk-ant-test";
  try {
    const app = new Hono();
    registerAgentRoutes(app, {
      extract: (async () => FAKE_RESULT) as never,
      globalLimit: createRateLimiter(3, 60_000),
    });

    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/agent/extract-invoice", rotatingPost({ text: "x" }, i));
      expect(res.status, `request ${i}`).not.toBe(429);
    }
    const blocked = await app.request(
      "/api/agent/extract-invoice",
      rotatingPost({ text: "x" }, 99),
    );
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).code).toBe("ai-rate-limited-global");
  } finally {
    if (prev === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = prev;
  }
});
