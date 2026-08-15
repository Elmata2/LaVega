import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { loadLlmConfig, loadIngestConfig } from "./config.js";
import { sanitizeExtractInput, type InvoiceExtractInput } from "./agent/redaction.js";
import { extractInvoiceFields } from "./agent/anthropicExtract.js";
import { sanitizeChatContext, sanitizeMessages } from "./agent/chatContext.js";
import { runChat } from "./agent/chat.js";
import { sanitizeCategorizeInput } from "./agent/categorize.js";
import { categorizeTransactions } from "./agent/categorize.js";
import { sanitizeTravelInput, lookupProviderTerms } from "./agent/travel.js";
import { getCardTerms, ingestCardTerms } from "./cardTerms.js";
import { createRateLimiter } from "./agent/rateLimit.js";

/* Agent proxy routes. The server holds the Anthropic key (it never reaches the
 * client) and is the ONLY place that talks to Claude. `deps.extract`/`deps.chat`
 * are injectable so routes can be tested without a real network call. */

type Deps = {
  extract?: typeof extractInvoiceFields;
  chat?: typeof runChat;
  categorize?: typeof categorizeTransactions;
  travelFacts?: typeof lookupProviderTerms;
};

// 20 requests/min per route key (each route passes its own key — "extract" /
// "chat" / "categorize" — so each gets an independent bucket). Single-user
// personal app, so these limits are a safety valve, not a shared budget.
const limit = createRateLimiter(20, 60_000);

export function registerAgentRoutes(app: Hono, deps: Deps = {}): void {
  const extract = deps.extract ?? extractInvoiceFields;
  const chat = deps.chat ?? runChat;
  const categorize = deps.categorize ?? categorizeTransactions;
  const travelFacts = deps.travelFacts ?? lookupProviderTerms;

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

  // Bulk-categorize onbekend transactions via Claude. Guard order matches the
  // other agent routes: 503 -> 429 -> 400 -> 502. `sanitizeCategorizeInput`
  // strips every item down to {id,text,sign} BEFORE it can reach the model, so
  // amounts/accounts/balances never leave the browser.
  app.post("/api/agent/categorize", async (c) => {
    const { configured, apiKey } = loadLlmConfig();
    if (!configured || !apiKey) return c.json({ error: "AI-categorisatie is niet geconfigureerd." }, 503);
    if (!limit("categorize")) return c.json({ error: "Even wachten — te veel verzoeken." }, 429);
    let input: { items: import("./agent/categorize.js").CategorizeItem[] };
    try {
      input = sanitizeCategorizeInput(await c.req.json());
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "ongeldige invoer" }, 400);
    }
    try {
      return c.json(await categorize(input, apiKey));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "categorisatie mislukt" }, 502);
    }
  });

  // Travel agent: looks up CURRENT product terms (foreign-transaction fee,
  // cashback, iDEAL top-up) for the providers the user banks with. The tightest
  // boundary in the app — `sanitizeTravelInput` lets only a country pair, a
  // currency and provider NAMES through, because the ranking that needs his
  // balances is done locally in core. Same ladder: 503 -> 429 -> 400 -> 502.
  app.post("/api/agent/travel-facts", async (c) => {
    const { configured, apiKey } = loadLlmConfig();
    if (!configured || !apiKey) return c.json({ error: "AI-reisadvies is niet geconfigureerd." }, 503);
    if (!limit("travel")) return c.json({ error: "Even wachten — te veel verzoeken." }, 429);
    let input: import("./agent/travel.js").TravelInput;
    try {
      input = sanitizeTravelInput(await c.req.json());
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "ongeldige invoer" }, 400);
    }
    // Returns instantly with whatever is cached and starts background lookups
    // for the gaps — card tariffs are PUBLIC data, the same for every user, so
    // they belong in a shared server cache (exactly like /api/rates) rather
    // than being re-fetched per user at the moment someone wants an answer.
    // Nothing here awaits the model, so the 100s Cloudflare ceiling that killed
    // the synchronous version can't be reached.
    return c.json(getCardTerms(input, apiKey, { lookup: travelFacts }));
  });

  // Ingest from the n8n workflow, which fetches each provider's OWN tariff page
  // and extracts the numbers — no searching, so no flaky "couldn't find it".
  // Shared-secret auth: without CARD_TERMS_INGEST_TOKEN the endpoint is closed,
  // and a wrong token is refused, because this writes into the cache every user
  // reads. Constant-time-ish compare: reject on length first, then value.
  app.post("/api/card-terms/ingest", async (c) => {
    const { configured, token } = loadIngestConfig();
    if (!configured || !token) return c.json({ error: "Ingest is niet geconfigureerd." }, 503);
    const given = c.req.header("x-ingest-token") ?? "";
    if (given.length !== token.length || given !== token) return c.json({ error: "Ongeldige token." }, 401);

    let body: { homeCountry?: unknown; currency?: unknown; terms?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "ongeldige invoer" }, 400);
    }
    const homeCountry = /^[A-Z]{2}$/.test(String(body.homeCountry ?? "").toUpperCase())
      ? String(body.homeCountry).toUpperCase()
      : "NL";
    const currency = /^[A-Z]{3}$/.test(String(body.currency ?? "").toUpperCase())
      ? String(body.currency).toUpperCase()
      : "";
    if (!Array.isArray(body.terms)) return c.json({ error: "geen terms" }, 400);
    if (body.terms.length > 40) return c.json({ error: "te veel terms" }, 400);

    return c.json(ingestCardTerms(homeCountry, currency, body.terms as never));
  });
}
