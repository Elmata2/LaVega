import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { loadLlmConfig, loadIngestConfig } from "./config.js";
import { sanitizeExtractInput, type InvoiceExtractInput } from "./agent/redaction.js";
import { extractInvoiceFields } from "./agent/invoiceExtract.js";
import { sanitizeChatContext, sanitizeMessages } from "./agent/chatContext.js";
import { runChat } from "./agent/chat.js";
import { sanitizeCategorizeInput } from "./agent/categorize.js";
import { categorizeTransactions } from "./agent/categorize.js";
import { sanitizeTravelInput, lookupProviderTerms } from "./agent/travel.js";
import { sanitizeKnownFacts } from "./agent/facts.js";
import { getCardTerms, ingestCardTerms } from "./cardTerms.js";
import { getBankNlTable } from "./bankNl.js";
import { createRateLimiter, rateLimitKey } from "./agent/rateLimit.js";
import { sessionUserId } from "./apiGuard.js";
import { AGENTS, type BankNlTable, type LearnedFact } from "@lavega/core";

/* Agent proxy routes. The server holds the Mistral key (it never reaches the
 * client) and is the ONLY place that talks to Mistral. `deps.extract`/`deps.chat`
 * are injectable so routes can be tested without a real network call. */

type Deps = {
  extract?: typeof extractInvoiceFields;
  chat?: typeof runChat;
  categorize?: typeof categorizeTransactions;
  travelFacts?: typeof lookupProviderTerms;
  /** The bank.nl koersopslag comparison table. Injected so a test never fetches. */
  cardComparison?: () => Promise<BankNlTable>;
};

// 20 requests/min per CALLER per route. The key comes from `rateLimitKey`,
// which prefers the verified session's user id and falls back to the caller's
// address; see the note there for why it is not the route name alone.
const limit = createRateLimiter(20, 60_000);

// Mistral's error text (up to 2000 chars of its raw response body, per
// mistral.ts) must never reach the browser — it can carry more detail about
// our account/usage than a stranger should see. Every AI-route failure logs
// the real error server-side and returns this one fixed message instead.
const AI_ERROR_MESSAGE = "De AI-dienst gaf een fout; probeer het later opnieuw.";

function logAiError(route: string, e: unknown): void {
  console.error(`agent/${route}: ${e instanceof Error ? e.message : String(e)}`);
}

/* This request's rate-limit bucket for `route`. */
function bucket(c: { req: { header(name: string): string | undefined } }, route: string): string {
  return rateLimitKey(route, sessionUserId(c as never), c.req.header("x-forwarded-for"));
}

export function registerAgentRoutes(app: Hono, deps: Deps = {}): void {
  const extract = deps.extract ?? extractInvoiceFields;
  const chat = deps.chat ?? runChat;
  const categorize = deps.categorize ?? categorizeTransactions;
  const travelFacts = deps.travelFacts ?? lookupProviderTerms;
  const cardComparison = deps.cardComparison ?? (() => getBankNlTable());

  // Whether AI extraction is available server-side (does the key exist?). The
  // key itself is never returned. Lives here, not in index.ts (Task 1 deferred).
  app.get("/api/agent/status", (c) => c.json({ configured: loadLlmConfig().configured }));

  // Extract one invoice's fields via Mistral. Guard order: 503 (not configured)
  // -> 429 (rate limited) -> 400 (bad/oversize input, thrown by the redaction
  // boundary) -> 502 (extraction failed). The request body is sanitized BEFORE
  // it can reach the SDK, so transactions/balances never leave the browser.
  app.post("/api/agent/extract-invoice", async (c) => {
    const { configured, apiKey } = loadLlmConfig();
    if (!configured || !apiKey)
      return c.json({ error: "AI-extractie is niet geconfigureerd op de server." }, 503);
    if (!limit(bucket(c, "extract")))
      return c.json({ error: "Even wachten — te veel AI-verzoeken." }, 429);
    let input: InvoiceExtractInput;
    let facts: LearnedFact[];
    try {
      const raw = await c.req.json();
      input = sanitizeExtractInput(raw);
      // What the extractor has learned about how the owner corrects it (per
      // invoice FIELD, never per counterparty) — sanitized like every input.
      facts = sanitizeKnownFacts(raw?.facts, AGENTS.facturen);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "ongeldige invoer" }, 400);
    }
    try {
      return c.json(await extract(input, apiKey, facts));
    } catch (e) {
      logAiError("extract-invoice", e);
      return c.json({ error: AI_ERROR_MESSAGE }, 502);
    }
  });

  // Stream one chat turn from Mistral. Guard order matches extract-invoice:
  // 503 (not configured) -> 429 (rate limited) -> 400 (bad body / no messages)
  // -> stream. `context` is redacted per-tab by `sanitizeChatContext` BEFORE it
  // reaches `chat` — that's the boundary that keeps raw data off Mistral.
  app.post("/api/agent/chat", async (c) => {
    const { configured, apiKey } = loadLlmConfig();
    if (!configured || !apiKey)
      return c.json({ error: "AI-assistent is niet geconfigureerd." }, 503);
    if (!limit(bucket(c, "chat")))
      return c.json({ error: "Even wachten — te veel verzoeken." }, 429);
    let tab = "";
    let messages;
    let context;
    let facts: LearnedFact[] = [];
    try {
      const raw = await c.req.json();
      tab = String(raw?.tab ?? "");
      messages = sanitizeMessages(raw?.messages);
      context = sanitizeChatContext(tab, raw?.context);
      // How the owner wants the assistant to answer — the chat agent's own
      // namespace, never anything about his money.
      facts = sanitizeKnownFacts(raw?.facts, AGENTS.chat);
      if (messages.length === 0) return c.json({ error: "Geen bericht." }, 400);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "ongeldige invoer" }, 400);
    }
    return streamSSE(c, async (stream) => {
      try {
        for await (const chunk of chat({ tab, messages, context, facts, apiKey })) {
          await stream.writeSSE({ data: chunk });
        }
        await stream.writeSSE({ event: "done", data: "" });
      } catch (e) {
        logAiError("chat", e);
        await stream.writeSSE({ event: "error", data: AI_ERROR_MESSAGE });
      }
    });
  });

  // Bulk-categorize onbekend transactions via Mistral. Guard order matches the
  // other agent routes: 503 -> 429 -> 400 -> 502. `sanitizeCategorizeInput`
  // strips every item down to {id,text,sign} BEFORE it can reach the model, so
  // amounts/accounts/balances never leave the browser.
  app.post("/api/agent/categorize", async (c) => {
    const { configured, apiKey } = loadLlmConfig();
    if (!configured || !apiKey)
      return c.json({ error: "AI-categorisatie is niet geconfigureerd." }, 503);
    if (!limit(bucket(c, "categorize")))
      return c.json({ error: "Even wachten — te veel verzoeken." }, 429);
    let input: { items: import("./agent/categorize.js").CategorizeItem[] };
    let facts: LearnedFact[];
    try {
      const raw = await c.req.json();
      input = sanitizeCategorizeInput(raw);
      // How the owner keeps re-filing the categorizer's suggestions — category
      // to category, so no merchant can ride along.
      facts = sanitizeKnownFacts(raw?.facts, AGENTS.categorize);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "ongeldige invoer" }, 400);
    }
    try {
      return c.json(await categorize(input, apiKey, facts));
    } catch (e) {
      logAiError("categorize", e);
      return c.json({ error: AI_ERROR_MESSAGE }, 502);
    }
  });

  // Travel agent: looks up CURRENT product terms (foreign-transaction fee,
  // cashback, iDEAL top-up) for the providers the user banks with. The tightest
  // boundary in the app — `sanitizeTravelInput` lets only a country pair, a
  // currency and provider NAMES through, because the ranking that needs his
  // balances is done locally in core. Same ladder: 503 -> 429 -> 400 -> 502.
  app.post("/api/agent/travel-facts", async (c) => {
    const { configured, apiKey } = loadLlmConfig();
    if (!configured || !apiKey)
      return c.json({ error: "AI-reisadvies is niet geconfigureerd." }, 503);
    if (!limit(bucket(c, "travel")))
      return c.json({ error: "Even wachten — te veel verzoeken." }, 429);
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
    //
    // `comparison` is the bank.nl koersopslag table: one 96 kB GET that answers
    // for seven Dutch banks at once, including ING and Rabobank, whose own
    // tariff pages refuse us. It ranks BELOW a provider's own tariff page and
    // below the owner's correction — see the ladder in cardTerms.ts.
    return c.json(getCardTerms(input, apiKey, { lookup: travelFacts, comparison: cardComparison }));
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
    if (given.length !== token.length || given !== token)
      return c.json({ error: "Ongeldige token." }, 401);

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
