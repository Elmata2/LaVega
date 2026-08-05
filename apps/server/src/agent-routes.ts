import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { loadLlmConfig } from "./config.js";
import { sanitizeExtractInput, type InvoiceExtractInput } from "./agent/redaction.js";
import { extractInvoiceFields } from "./agent/anthropicExtract.js";
import { sanitizeChatContext, sanitizeMessages } from "./agent/chatContext.js";
import { runChat } from "./agent/chat.js";
import { createRateLimiter } from "./agent/rateLimit.js";

/* Agent proxy routes. The server holds the Anthropic key (it never reaches the
 * client) and is the ONLY place that talks to Claude. `deps.extract`/`deps.chat`
 * are injectable so routes can be tested without a real network call. */

type Deps = { extract?: typeof extractInvoiceFields; chat?: typeof runChat };

// 20 extractions/min, shared across all requests (single-user personal app).
const limit = createRateLimiter(20, 60_000);

export function registerAgentRoutes(app: Hono, deps: Deps = {}): void {
  const extract = deps.extract ?? extractInvoiceFields;
  const chat = deps.chat ?? runChat;

  // Whether AI extraction is available server-side (does the key exist?). The
  // key itself is never returned. Lives here, not in index.ts (Task 1 deferred).
  app.get("/api/agent/status", (c) => c.json({ configured: loadLlmConfig().configured }));

  // Extract one invoice's fields via Claude. Guard order: 503 (not configured)
  // -> 429 (rate limited) -> 400 (bad/oversize input, thrown by the redaction
  // boundary) -> 502 (extraction failed). The request body is sanitized BEFORE
  // it can reach the SDK, so transactions/balances never leave the browser.
  app.post("/api/agent/extract-invoice", async (c) => {
    const { configured, apiKey } = loadLlmConfig();
    if (!configured || !apiKey) return c.json({ error: "AI-extractie is niet geconfigureerd op de server." }, 503);
    if (!limit("extract")) return c.json({ error: "Even wachten — te veel AI-verzoeken." }, 429);
    let input: InvoiceExtractInput;
    try {
      input = sanitizeExtractInput(await c.req.json());
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "ongeldige invoer" }, 400);
    }
    try {
      return c.json(await extract(input, apiKey));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "extractie mislukt" }, 502);
    }
  });

  // Stream one chat turn from Claude. Guard order matches extract-invoice:
  // 503 (not configured) -> 429 (rate limited) -> 400 (bad body / no messages)
  // -> stream. `context` is redacted per-tab by `sanitizeChatContext` BEFORE it
  // reaches `chat` — that's the boundary that keeps raw data off Claude.
  app.post("/api/agent/chat", async (c) => {
    const { configured, apiKey } = loadLlmConfig();
    if (!configured || !apiKey) return c.json({ error: "AI-assistent is niet geconfigureerd." }, 503);
    if (!limit("chat")) return c.json({ error: "Even wachten — te veel verzoeken." }, 429);
    let tab = "";
    let messages;
    let context;
    try {
      const raw = await c.req.json();
      tab = String(raw?.tab ?? "");
      messages = sanitizeMessages(raw?.messages);
      context = sanitizeChatContext(tab, raw?.context);
      if (messages.length === 0) return c.json({ error: "Geen bericht." }, 400);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "ongeldige invoer" }, 400);
    }
    return streamSSE(c, async (stream) => {
      try {
        for await (const chunk of chat({ tab, messages, context, apiKey })) {
          await stream.writeSSE({ data: chunk });
        }
        await stream.writeSSE({ event: "done", data: "" });
      } catch (e) {
        await stream.writeSSE({ event: "error", data: e instanceof Error ? e.message : "fout" });
      }
    });
  });
}
