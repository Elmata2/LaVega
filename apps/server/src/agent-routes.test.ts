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
  return {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  };
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
    const res = await app.request(
      "/api/agent/extract-invoice",
      jsonPost({ text: "Factuur van Acme BV" }),
    );
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
    const res = await app.request(
      "/api/agent/extract-invoice",
      jsonPost({ pdfBase64: "A".repeat(14_000_001) }),
    );
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});

test("POST /api/agent/chat returns 503 when no API key is configured", async () => {
  await withApiKey(undefined, async () => {
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
    expect(res.status).toBe(503);
    expect(called).toBe(false); // never reaches the chat generator
  });
});

test("with a key set and an injected chat generator, the stream contains the yielded chunk", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    registerAgentRoutes(app, {
      chat: async function* () {
        yield "hoi";
      },
    });
    const res = await app.request(
      "/api/agent/chat",
      jsonPost({ tab: "overview", messages: [{ role: "user", content: "hoi" }] }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("data: hoi");
  });
});

test("only the sanitized context reaches the chat agent — disallowed keys are stripped", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    let captured: Record<string, unknown> | undefined;
    registerAgentRoutes(app, {
      chat: async function* (args) {
        captured = args as unknown as Record<string, unknown>;
        yield "hoi";
      },
    });
    const res = await app.request(
      "/api/agent/chat",
      jsonPost({
        tab: "facturen",
        messages: [{ role: "user", content: "hoi" }],
        context: { invoices: [{ id: 1 }], txs: [1, 2, 3] },
      }),
    );
    expect(res.status).toBe(200);
    await res.text();
    expect(captured).toBeDefined();
    const context = captured?.context as Record<string, unknown>;
    expect(context.txs).toBeUndefined();
    expect(context.invoices).toEqual([{ id: 1 }]);
  });
});

test("POST /api/agent/chat returns 400 when messages is empty", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    let called = false;
    registerAgentRoutes(app, {
      chat: async function* () {
        called = true;
        yield "hoi";
      },
    });
    const res = await app.request("/api/agent/chat", jsonPost({ tab: "overview", messages: [] }));
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});

test("POST /api/agent/categorize returns 503 when no API key is configured", async () => {
  await withApiKey(undefined, async () => {
    const app = new Hono();
    let called = false;
    registerAgentRoutes(app, {
      categorize: async () => {
        called = true;
        return [];
      },
    });
    const res = await app.request(
      "/api/agent/categorize",
      jsonPost({ items: [{ id: "t1", text: "x", sign: "out" }] }),
    );
    expect(res.status).toBe(503);
    expect(called).toBe(false);
  });
});

test("with a key set and an injected categorizer, returns 200 with the results", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    registerAgentRoutes(app, { categorize: async () => [{ id: "t1", category: "Boodschappen" }] });
    const res = await app.request(
      "/api/agent/categorize",
      jsonPost({ items: [{ id: "t1", text: "Albert Heijn", sign: "out" }] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "t1", category: "Boodschappen" }]);
  });
});

test("only the sanitized items reach the categorizer — amount/accountKey are stripped", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    let captured: { items: Record<string, unknown>[] } | undefined;
    registerAgentRoutes(app, {
      categorize: async (input) => {
        captured = input as { items: Record<string, unknown>[] };
        return [];
      },
    });
    const res = await app.request(
      "/api/agent/categorize",
      jsonPost({
        items: [{ id: "t1", text: "Albert Heijn", sign: "out", amount: -20, accountKey: "A1" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(captured?.items).toEqual([{ id: "t1", text: "Albert Heijn", sign: "out" }]);
    expect(captured?.items[0]).not.toHaveProperty("amount");
    expect(captured?.items[0]).not.toHaveProperty("accountKey");
  });
});

test("an oversize categorize batch is rejected with 400 before the categorizer", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    let called = false;
    registerAgentRoutes(app, {
      categorize: async () => {
        called = true;
        return [];
      },
    });
    const items = Array.from({ length: 201 }, (_, i) => ({
      id: String(i),
      text: "x",
      sign: "out",
    }));
    const res = await app.request("/api/agent/categorize", jsonPost({ items }));
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});

/* --- Learning: facts travel up with the request, and the fact boundary is
 * applied at the route, before any agent sees them. --- */

test("the categorize route forwards only namespace-legal facts to the agent", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    let captured: readonly { subject: string; key: string; value: string; agent: string }[] = [];
    registerAgentRoutes(app, {
      categorize: async (_input, _key, facts) => {
        captured = facts ?? [];
        return [];
      },
    });
    const res = await app.request(
      "/api/agent/categorize",
      jsonPost({
        items: [{ id: "t1", text: "x", sign: "out" }],
        facts: [
          {
            subject: "Overboekingen",
            key: "corrigeerNaar",
            value: "Eigen overboeking",
            source: "user",
          },
          { subject: "Albert Heijn", key: "corrigeerNaar", value: "Boodschappen", source: "user" }, // counterparty
          { subject: "Overboekingen", key: "saldo", value: "12450", source: "user" }, // a balance
          { agent: "travel", subject: "ING betaalpas", key: "fxFeePct", value: "1.4" }, // wrong namespace
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      agent: "categorize",
      subject: "Overboekingen",
      value: "Eigen overboeking",
    });
    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain("Albert Heijn");
    expect(serialized).not.toContain("12450");
    expect(serialized).not.toContain("fxFeePct");
  });
});

test("the extract-invoice route forwards only facturen facts, never a counterparty", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    let captured: readonly { subject: string }[] = [];
    registerAgentRoutes(app, {
      extract: async (_input, _key, facts) => {
        captured = facts ?? [];
        return FAKE_RESULT;
      },
    });
    const res = await app.request(
      "/api/agent/extract-invoice",
      jsonPost({
        text: "factuur",
        facts: [
          { subject: "dueDate", key: "voorkeur", value: "issueDate+30", source: "user" },
          { subject: "Acme BV", key: "voorkeur", value: "14 dagen", source: "user" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(captured.map((f) => f.subject)).toEqual(["dueDate"]);
  });
});

test("the chat route forwards its own facts and drops another agent's", async () => {
  await withApiKey("sk-ant-test", async () => {
    const app = new Hono();
    let captured: readonly { subject: string; key: string }[] = [];
    registerAgentRoutes(app, {
      chat: async function* (args) {
        captured = args.facts ?? [];
        yield "ok";
      },
    });
    const res = await app.request(
      "/api/agent/chat",
      jsonPost({
        tab: "overview",
        messages: [{ role: "user", content: "hoi" }],
        facts: [
          { subject: "antwoord", key: "lengte", value: "kort", source: "user" },
          { subject: "ING betaalpas", key: "fxFeePct", value: "1.4", source: "user" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    await res.text(); // drain the stream so the generator runs
    expect(captured.map((f) => f.key)).toEqual(["lengte"]);
  });
});
