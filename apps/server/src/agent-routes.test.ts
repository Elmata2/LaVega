import { expect, test } from "vitest";
import { Hono } from "hono";
import { registerAgentRoutes } from "./agent-routes.js";
import type { ExtractedInvoice } from "./agent/anthropicExtract.js";

const FAKE_RESULT: { fields: ExtractedInvoice; confidence: number } = {
  fields: {
    counterparty: "Acme BV",
    amount: 121,
    currency: "EUR",
    issueDate: "2026-01-01",
    dueDate: "2026-01-31",
    direction: "out",
    vatAmount: 21,
  },
  confidence: 0.9,
};

/** Set (or clear) ANTHROPIC_API_KEY for the duration of an async body, then
 *  restore it — matches config.test.ts so the env can't leak across tests. */
async function withApiKey(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const prev = process.env.ANTHROPIC_API_KEY;
  try {
    if (value === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = value;
    await fn();
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
}

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } };
}

test("GET /api/agent/status reflects whether the API key is configured", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    registerAgentRoutes(app);
    const res = await app.request("/api/agent/status");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ configured: true });
  });
  await withApiKey(undefined, async () => {
    const app = new Hono();
    registerAgentRoutes(app);
    const res = await app.request("/api/agent/status");
    expect(await res.json()).toEqual({ configured: false });
  });
});

test("POST /api/agent/extract-invoice returns 503 when no API key is configured", async () => {
  await withApiKey(undefined, async () => {
    const app = new Hono();
    let called = false;
    registerAgentRoutes(app, {
      extract: async () => {
        called = true;
        return FAKE_RESULT;
      },
    });
    const res = await app.request("/api/agent/extract-invoice", jsonPost({ text: "factuur" }));
    expect(res.status).toBe(503);
    expect(called).toBe(false); // never reaches the extractor
  });
});

test("with a key set and an injected extractor, returns 200 with the extracted fields", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    registerAgentRoutes(app, { extract: async () => FAKE_RESULT });
    const res = await app.request("/api/agent/extract-invoice", jsonPost({ text: "Factuur van Acme BV" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(FAKE_RESULT);
  });
});

test("only the sanitized input reaches the extractor — transactions/balance are stripped", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    let captured: Record<string, unknown> | undefined;
    registerAgentRoutes(app, {
      extract: async (input) => {
        captured = input as Record<string, unknown>;
        return FAKE_RESULT;
      },
    });
    const res = await app.request(
      "/api/agent/extract-invoice",
      jsonPost({
        pdfBase64: "JVBERi0=",
        mediaType: "application/pdf",
        transactions: [{ amount: 999 }],
        balance: 12345,
      }),
    );
    expect(res.status).toBe(200);
    expect(captured).toBeDefined();
    expect(captured).not.toHaveProperty("transactions");
    expect(captured).not.toHaveProperty("balance");
    expect(captured).toEqual({ pdfBase64: "JVBERi0=", mediaType: "application/pdf" });
  });
});

test("an oversize pdfBase64 payload is rejected with 400 before the extractor", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    let called = false;
    registerAgentRoutes(app, {
      extract: async () => {
        called = true;
        return FAKE_RESULT;
      },
    });
    const res = await app.request("/api/agent/extract-invoice", jsonPost({ pdfBase64: "A".repeat(14_000_001) }));
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});
