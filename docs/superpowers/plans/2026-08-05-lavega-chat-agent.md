# LaVega Chat Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A floating "LaVega" chat widget (bottom-right, every tab) whose agent has per-tab `.md` instructions + a minimal per-tab data context, answers the owner's questions, and fetches realtime external facts via web search. Remove all "indicatief" static estimates (Valuta routes, Punten values) — those become chat answers.

**Architecture:** Reuses the Phase-2c server LLM proxy (server-side `ANTHROPIC_API_KEY` via `loadLlmConfig`, in-memory rate limiter). New streaming `POST /api/agent/chat` runs Claude Sonnet 5 with the hosted `web_search` tool; per-tab system prompts load from `.md` files; a `sanitizeChatContext` redaction boundary allowlists the per-tab context. The server holds the key but no data — the browser supplies the current tab's minimal context. `@anthropic-ai/sdk` stays server-only. Client: a `ChatWidget` (opt-in, consent-gated, streaming) + a `buildTabContext` that turns app state into the minimal per-tab slice.

**Tech Stack:** TypeScript, pnpm monorepo, Vitest, Hono (`hono/streaming` `streamSSE`), React (Vite), `@anthropic-ai/sdk@0.115.0` (Sonnet 5, `web_search_20260209`, `messages.stream`).

## Global Constraints

- **Privacy (hard):** opt-in (consent default OFF); each request carries ONLY the current tab's allowlisted, size-capped context (`sanitizeChatContext` is the boundary — the chat analogue of `sanitizeExtractInput`); server is stateless (no vault access); `@anthropic-ai/sdk` server-only (must NOT appear in `apps/web/dist` — grep it); dormant `503` until the key is set; conversations not persisted server-side.
- **Model:** `claude-sonnet-5`, adaptive thinking (`thinking: { type: "adaptive" }`), streaming, hosted web search tool `web_search_20260209` (verify the param shape against the installed SDK types under `apps/server/node_modules/@anthropic-ai/sdk`). Never force `tool_choice`.
- **`_base.md` rule (must-not-skip):** the agent never puts the owner's amounts/counterparties into a web-search query; realtime numbers it reports are labelled as live-searched; it never invents figures — deterministic numbers come from the tab context.
- **Realtime, not indicative:** after Phase 4 no "indicatief"/"schatting" static tables remain in Valuta/Punten.
- Dutch UI + prompt copy. Follow existing patterns (agent-routes.ts, encryptedStorage/App wiring, settings.ts). Commit messages end `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Verify per task: `pnpm test`, `pnpm typecheck`, and for web tasks `pnpm --filter @lavega/web build`.

## File Structure

- `apps/server/src/agent/chatContext.ts` — `sanitizeChatContext`, `sanitizeMessages`, `CHAT_TABS`.
- `apps/server/src/agent/prompts/_base.md` + `<tab>.md` (10 tabs).
- `apps/server/src/agent/prompts.ts` — `loadPrompt(tab)` (read + cache).
- `apps/server/src/agent/chat.ts` — `runChat(...)` async generator.
- `apps/server/src/agent-routes.ts` — add `POST /api/agent/chat` (modify).
- `apps/web/src/settings.ts` — `getChatEnabled`/`setChatEnabled` (modify).
- `apps/web/src/api.ts` — `streamChat(...)` (modify).
- `apps/web/src/agent/tabContext.ts` — `buildTabContext(view, state)`.
- `apps/web/src/components/ChatWidget.tsx` — the widget.
- `apps/web/src/App.tsx` — mount ChatWidget (modify).
- Phase 4: `apps/web/src/views/Valuta.tsx`, `apps/web/src/views/Punten.tsx`, `packages/core/src/fx.ts`, `packages/core/src/rewards.ts` + their tests (modify).

---

# PHASE 1 — Chat backbone (server)

## Task 1: `sanitizeChatContext` + `sanitizeMessages` (the chat redaction boundary)

**Files:** Create `apps/server/src/agent/chatContext.ts`, `apps/server/src/agent/chatContext.test.ts`.

**Interfaces produced:**

```ts
export const CHAT_TABS = [
  "overview",
  "rekeningen",
  "regels",
  "forecast",
  "optimalisatie",
  "valuta",
  "belasting",
  "facturen",
  "punten",
  "backup",
] as const;
export type ChatTab = (typeof CHAT_TABS)[number];
export function sanitizeChatContext(tab: string, raw: unknown): Record<string, unknown>; // per-tab allowlist + size cap; unknown tab -> {}
export type ChatMessage = { role: "user" | "assistant"; content: string };
export function sanitizeMessages(raw: unknown): ChatMessage[]; // keeps only {role in user/assistant, content:string}, last 20, content capped
```

- [ ] **Step 1: Failing test** — `chatContext.test.ts`:

```ts
import { expect, test } from "vitest";
import { sanitizeChatContext, sanitizeMessages } from "./chatContext.js";

test("sanitizeChatContext keeps only the tab's allowlisted keys", () => {
  const out = sanitizeChatContext("facturen", {
    invoices: [{ counterparty: "X" }],
    txs: [1, 2, 3],
    balance: 999,
  });
  expect(out).toEqual({ invoices: [{ counterparty: "X" }] });
  expect((out as Record<string, unknown>).txs).toBeUndefined();
});
test("unknown tab yields empty context", () => {
  expect(sanitizeChatContext("hackerz", { secrets: 1 })).toEqual({});
});
test("valuta allows only rate + holdings (no personal amounts)", () => {
  const out = sanitizeChatContext("valuta", {
    rate: { base: "EUR" },
    holdings: ["USD"],
    invoices: [1],
  });
  expect(out).toEqual({ rate: { base: "EUR" }, holdings: ["USD"] });
});
test("oversize context throws", () => {
  expect(() => sanitizeChatContext("facturen", { invoices: "A".repeat(70_000) })).toThrow();
});
test("sanitizeMessages drops junk roles + caps count", () => {
  const msgs = sanitizeMessages([
    { role: "user", content: "hi" },
    { role: "system", content: "x" },
    { role: "assistant", content: 5 },
  ]);
  expect(msgs).toEqual([{ role: "user", content: "hi" }]);
  const many = sanitizeMessages(Array.from({ length: 30 }, () => ({ role: "user", content: "q" })));
  expect(many.length).toBe(20);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `chatContext.ts`:**

```ts
export const CHAT_TABS = [
  "overview",
  "rekeningen",
  "regels",
  "forecast",
  "optimalisatie",
  "valuta",
  "belasting",
  "facturen",
  "punten",
  "backup",
] as const;
export type ChatTab = (typeof CHAT_TABS)[number];
export type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_CONTEXT_CHARS = 60_000;
const MAX_MSG_CHARS = 8_000;
const MAX_MSGS = 20;

/** Per-tab allowlist of top-level context keys the client may send. Nothing
 *  outside this can reach Claude — the chat redaction boundary. */
const ALLOW: Record<string, readonly string[]> = {
  overview: ["entities", "categories", "alertCount", "shortfall", "bufferCents"],
  rekeningen: ["accounts"],
  regels: ["rules"],
  forecast: ["summary"],
  optimalisatie: ["subscriptions", "rates", "bestBenchmark"],
  valuta: ["rate", "holdings"],
  belasting: ["vat", "deadlines", "settings"],
  facturen: ["invoices"],
  punten: ["balances"],
  backup: [],
};

export function sanitizeChatContext(tab: string, raw: unknown): Record<string, unknown> {
  const allow = ALLOW[tab] ?? [];
  const out: Record<string, unknown> = {};
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const k of allow) if (k in r) out[k] = r[k];
  }
  if (JSON.stringify(out).length > MAX_CONTEXT_CHARS) throw new Error("context te groot");
  return out;
}

export function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (m && typeof m === "object") {
      const role = (m as Record<string, unknown>).role;
      const content = (m as Record<string, unknown>).content;
      if ((role === "user" || role === "assistant") && typeof content === "string") {
        out.push({ role, content: content.slice(0, MAX_MSG_CHARS) });
      }
    }
  }
  return out.slice(-MAX_MSGS);
}
```

- [ ] **Step 4: Run → PASS; `pnpm typecheck`.** **Step 5: Commit:** `feat(server): chat context + message redaction boundary`.

## Task 2: prompt loader + `runChat` (Sonnet 5 + web search, streaming)

**Files:** Create `apps/server/src/agent/prompts/_base.md`, `apps/server/src/agent/prompts/overview.md`, `apps/server/src/agent/prompts.ts`, `apps/server/src/agent/chat.ts`, `apps/server/src/agent/chat.test.ts`. (Remaining tab `.md` files come in Phase 3; `loadPrompt` falls back to base for a missing tab.)

**Interfaces produced:**

```ts
export function loadPrompt(tab: string): string; // _base.md + <tab>.md (or just _base.md), cached
export async function* runChat(args: { tab: string; messages: ChatMessage[]; context: Record<string, unknown>; apiKey: string }): AsyncGenerator<string>;
```

- [ ] **Step 1:** Write `prompts/_base.md` — the shared system prompt:

```
Je bent **LaVega**, de financiële assistent in de LaVega-app van een Nederlandse ondernemer met meerdere BV's. Antwoord in het Nederlands, kort en concreet.

Regels:
- Gebruik het blok TAB-CONTEXT als bron voor cijfers over de gebruiker. Verzin NOOIT bedragen of saldi; als iets niet in de context staat, zeg dat.
- Voor actuele/externe feiten (wisselkoers-opslagen van banken, punt-waardes, rentes, deadlines, regels) gebruik je de web_search tool en je zegt erbij dat het een live opgezochte waarde is met de bron/datum.
- Zet NOOIT persoonlijke gegevens van de gebruiker (bedragen, tegenpartijen, rekeningnummers) in een web-zoekopdracht. Zoek alleen naar algemene feiten.
- Reken niet zelf met geld waar de app het al exact heeft; leg uit en verwijs naar de cijfers in de context.
- Je hebt geen toegang tot data buiten deze tab. Voor iets van een andere tab, zeg welke tab de gebruiker moet openen.
```

And `prompts/overview.md`:

```
Context: het startscherm. Je krijgt per-entiteit saldi, topcategorieën, het aantal aandachtspunten, of er een tekort in de forecast zit, en de buffer.
Help met: wat valt op, waar gaat geld heen, wat verdient aandacht. Verwijs naar de juiste tab voor details (Rekeningen, Forecast, Belasting, Facturen).
```

- [ ] **Step 2:** Implement `prompts.ts` (read files relative to this module via `import.meta.url`, cache in a `Map`; `loadPrompt(tab)` = `_base.md` + (`<tab>.md` if it exists, else `"")`):

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "prompts");
const cache = new Map<string, string>();
function read(name: string): string {
  try {
    return readFileSync(path.join(DIR, name), "utf8");
  } catch {
    return "";
  }
}
export function loadPrompt(tab: string): string {
  if (cache.has(tab)) return cache.get(tab)!;
  const base = read("_base.md");
  const t = /^[a-z]+$/.test(tab) ? read(`${tab}.md`) : "";
  const prompt = t ? `${base}\n\n${t}` : base;
  cache.set(tab, prompt);
  return prompt;
}
```

- [ ] **Step 3: Failing test** — `chat.test.ts` (mock the SDK; assert request build + that only text deltas are yielded). Mirror the Phase-2c `anthropicExtract.test.ts` `vi.hoisted`/`vi.mock("@anthropic-ai/sdk")` approach, but mock `messages.stream` to return an async-iterable of events:

```ts
import { beforeEach, expect, test, vi } from "vitest";
const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: streamMock };
  },
}));
import { runChat } from "./chat.js";

function fakeStream(events: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
  };
}
beforeEach(() => streamMock.mockReset());

test("runChat yields only text deltas and sends Sonnet 5 + web_search + tab context", async () => {
  streamMock.mockReturnValue(
    fakeStream([
      { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hallo" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: " wereld" } },
    ]),
  );
  const chunks: string[] = [];
  for await (const c of runChat({
    tab: "overview",
    messages: [{ role: "user", content: "hoi" }],
    context: { alertCount: 2 },
    apiKey: "k",
  }))
    chunks.push(c);
  expect(chunks.join("")).toBe("Hallo wereld");
  const arg = streamMock.mock.calls[0][0];
  expect(arg.model).toBe("claude-sonnet-5");
  expect(arg.tools.some((t: { type: string }) => String(t.type).startsWith("web_search"))).toBe(
    true,
  );
  expect(JSON.stringify(arg.system)).toContain("alertCount"); // tab context injected into system
});
```

- [ ] **Step 4: Implement `chat.ts`:**

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "./chatContext.js";
import { loadPrompt } from "./prompts.js";

export async function* runChat(args: {
  tab: string;
  messages: ChatMessage[];
  context: Record<string, unknown>;
  apiKey: string;
}): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const system =
    loadPrompt(args.tab) +
    "\n\nTAB-CONTEXT (van het apparaat van de gebruiker — bron voor cijfers; verstuur hieruit NOOIT persoonlijke gegevens naar een web-zoekopdracht):\n" +
    JSON.stringify(args.context);
  const stream = client.messages.stream({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 5 } as unknown as Anthropic.Tool,
    ],
    messages: args.messages,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}
```

(Implementer: verify the exact `web_search_20260209` tool-param shape + the streaming event union against `apps/server/node_modules/@anthropic-ai/sdk` types; adapt casts so it typechecks. Keep: Sonnet 5, adaptive thinking, hosted web search, yield only `text_delta`.)

- [ ] **Step 5: Run → PASS; `pnpm typecheck`; `pnpm --filter @lavega/server build`.** **Step 6: Commit:** `feat(server): runChat streaming (Sonnet 5 + web search) + per-tab prompt loader`.

## Task 3: `POST /api/agent/chat` streaming route

**Files:** Modify `apps/server/src/agent-routes.ts`; add tests to `apps/server/src/agent-routes.test.ts`.

**Interfaces produced:** `registerAgentRoutes(app, deps?)` gains `deps.chat?` (defaults to `runChat`); route `POST /api/agent/chat` streams SSE (`data:` lines = text chunks; final `event: done`; `event: error` on failure). 503 unconfigured → 429 rate-limited → 400 bad body → stream.

- [ ] **Step 1:** Read the current `agent-routes.ts`. Add imports: `streamSSE` from `hono/streaming`, `sanitizeChatContext`/`sanitizeMessages` from `./agent/chatContext.js`, `runChat` from `./agent/chat.js`. Add `chat = deps.chat ?? runChat`.
- [ ] **Step 2:** Add the route (before nothing special; alongside extract-invoice):

```ts
app.post("/api/agent/chat", async (c) => {
  const { configured, apiKey } = loadLlmConfig();
  if (!configured || !apiKey) return c.json({ error: "AI-assistent is niet geconfigureerd." }, 503);
  if (!limit("chat")) return c.json({ error: "Even wachten — te veel verzoeken." }, 429);
  let tab = "",
    messages,
    context;
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
```

- [ ] **Step 3: Failing tests** in `agent-routes.test.ts` (mirror the extract-invoice tests): (a) no key → `POST /api/agent/chat` returns 503; (b) key set + injected `chat` generator yielding `"hoi"` → response body (read the stream) contains `data: hoi`; (c) a body whose `context` carries a disallowed key (e.g. `txs`) with `tab:"facturen"` → the injected `chat` receives a context WITHOUT `txs` (capture the arg); (d) empty messages → 400. Register a test app via `registerAgentRoutes(testApp, { chat: async function* () { yield "hoi"; } })` and drive with `app.request(...)`; for the stream, `await res.text()` and assert it contains the chunk.
- [ ] **Step 4: Run → PASS; `pnpm test`; `pnpm typecheck`; `pnpm --filter @lavega/server build`.** **Step 5: Commit:** `feat(server): POST /api/agent/chat streaming route`.

---

# PHASE 2 — Widget + consent + overview tab (end-to-end)

## Task 4: consent + `streamChat` client + `buildTabContext` (overview)

**Files:** Modify `apps/web/src/settings.ts`, `apps/web/src/api.ts`; create `apps/web/src/agent/tabContext.ts`, `apps/web/src/agent/tabContext.test.ts`.

**Interfaces produced:**

- `settings.ts`: `getChatEnabled(): boolean` (default false), `setChatEnabled(on)` — localStorage `lavega.chatEnabled`, mirror `getAiExtractionEnabled`.
- `api.ts`: `async function streamChat(body, handlers, signal?)` — POST `${API_BASE}/api/agent/chat`, read the SSE stream, call `handlers.onChunk(text)` per `data:` line, `handlers.onError(msg)` / `handlers.onDone()`.
- `tabContext.ts`: `buildTabContext(view: string, state: TabState): { tab: string; context: Record<string, unknown> }` — the ONLY place app state becomes chat context; returns the minimal per-tab slice with arrays capped (e.g. invoices/accounts ≤ 100). Phase-2: implement `overview` + a `default` (`{}`); other tabs added in Task 7. `TabState` is a bag of the app's already-loaded data.

- [ ] **Step 1: Failing test** `tabContext.test.ts`:

```ts
import { expect, test } from "vitest";
import { buildTabContext } from "./tabContext.js";
test("overview context carries only aggregates, not raw txs", () => {
  const { tab, context } = buildTabContext("overview", {
    accounts: [{ entity: "BV1", balance: 100 } as any],
    txs: [{} as any],
    alertCount: 3,
    bufferCents: 5000,
    shortfall: false,
    categories: [{ name: "Boodschappen", out: 200 }],
  } as any);
  expect(tab).toBe("overview");
  expect((context as any).txs).toBeUndefined();
  expect((context as any).alertCount).toBe(3);
});
test("unknown tab yields empty context", () => {
  expect(buildTabContext("zzz", {} as any).context).toEqual({});
});
```

- [ ] **Step 2: Implement** `settings` additions, `streamChat` (parse SSE: split on double-newline, lines starting `data:` → chunk, `event: error`/`done`), and `buildTabContext` with the `overview` + default cases. For `overview`, assemble `{ entities: perEntityBalances, categories, alertCount, shortfall, bufferCents }` from state (reuse whatever the Overzicht already computes; keep it aggregate-only).
- [ ] **Step 3: Run → PASS; `pnpm typecheck`.** **Step 4: Commit:** `feat(web): chat consent + SSE streamChat client + overview tab context`.

## Task 5: `ChatWidget` + mount in App

**Files:** Create `apps/web/src/components/ChatWidget.tsx`; modify `apps/web/src/App.tsx`; (optional) add styles in the existing stylesheet.

- [ ] **Step 1: Implement `ChatWidget.tsx`** — a fixed-position launcher bottom-right + collapsible panel:
  - Props: `{ view: string; context: { tab: string; context: Record<string, unknown> }; configured: boolean }`.
  - State: `open`, `enabled` (from `getChatEnabled`), `messages: {role,content}[]`, `input`, `streaming`.
  - First open with `enabled === false` → a consent panel: explains "Ik stuur de gegevens van dít tabblad + je vraag naar Claude (jouw server, jouw key) om te antwoorden. Voor actuele cijfers zoek ik op het web. Niets wordt opgeslagen." + an "Zet assistent aan" button → `setChatEnabled(true)`.
  - If `!configured` → show "AI-assistent nog niet geconfigureerd (ANTHROPIC_API_KEY ontbreekt)".
  - On send: push `{role:"user"}`, push an empty `{role:"assistant"}`, call `streamChat({ tab: context.tab, messages, context: context.context }, { onChunk: append to last assistant msg, onError, onDone })`; disable input while `streaming`. Show a typing indicator while streaming.
  - Minimal styling: fixed `bottom: 1rem; right: 1rem; z-index: 50;` launcher button (💬 / "LaVega"), panel ~360×480 with a scrollable message list + input row. Reuse existing classes where possible; add a small `<style>` block or extend the stylesheet with `.chat-*` classes (light theme, matches the app).
- [ ] **Step 2: Mount in `App.tsx`** — after `</main>` (still inside the shell), render `<ChatWidget view={view} context={chatCtx} configured={llmConfigured} />` where `const chatCtx = useMemo(() => buildTabContext(view, { accounts: currentScopedAccounts, txs: scopedTxs, invoices, rewards, rules, vatSettings, scheduledFlows, alertCount, bufferCents, asOf /* etc as available */ }), [view, ...])`. Fetch `llmConfigured` once via `GET ${API_BASE}/api/agent/status` in a `useEffect` (default false). (Task 4's `buildTabContext` only handles overview+default now; other tabs return `{}` until Task 7 — that's fine, the widget still works.)
- [ ] **Step 3: Verify** — `pnpm typecheck`, `pnpm --filter @lavega/web build`, and grep `apps/web/dist` for `anthropic` (must be clean — the browser only calls our server). `pnpm test`. **Step 4: Commit:** `feat(web): LaVega chat widget (opt-in, streaming) mounted on all tabs`.

---

# PHASE 3 — All tab prompts + contexts

## Task 6: remaining tab `.md` prompts

**Files:** Create `apps/server/src/agent/prompts/{rekeningen,regels,forecast,optimalisatie,valuta,belasting,facturen,punten,backup}.md`.

- [ ] **Step 1:** Write one `.md` per tab (Dutch, ~4–8 lines each), each stating: what context it receives (match the Task-1 allowlist), what it helps with, and when to use web search. Concrete per-tab focus:
  - **rekeningen:** accounts (bank/type/entity/saldo). Help: welke rekening waarvoor, saldo-overzicht, ontbrekende saldi. Verwijs naar Rekeningen om te bewerken.
  - **regels:** de categorieregels. Help: hoe een regel werkt, welke categorie een merchant krijgt, suggesties voor nieuwe regels.
  - **forecast:** 13-weeks samenvatting (mediaan/tekortweek/drivers). Help: waarom een tekort, welke posten drukken, wat te doen. Geen nieuwe cijfers verzinnen.
  - **optimalisatie:** abonnementen + rentes + beste benchmark. Help: dubbele/gestegen abonnementen, waar spaargeld beter staat; web_search voor actuele rentes/voorwaarden.
  - **valuta:** de live ECB-koers + welke vreemde valuta de gebruiker aanhoudt. Help: omrekenen (koers zit in context), en **de goedkoopste route/kosten via web_search** (actuele Wise/Revolut/bank-fees) — noem bron + dat het live is.
  - **belasting:** btw-reservering + deadlines + per-BV instellingen (al berekend). Help: uitleg reservering/deadline; web_search alleen voor algemene BTW-regels/tarieven, nooit met persoonlijke bedragen.
  - **facturen:** de facturenlijst (tegenpartij/bedrag/datum/status). Help: openstaand, wat vervalt binnenkort, totaal per richting.
  - **punten:** de saldi (programma/punten/bijgewerkt). Help: **wat punten waard zijn + beste inwissel/transfer via web_search** (actuele waardes/ratio's, met bron), en welke saldi verouderd zijn.
  - **backup:** geen persoonlijke data. Help: uitleg over back-up/herstel/wachtwoord ("wachtwoord kwijt = data kwijt").
- [ ] **Step 2: Verify** the loader picks them up (`loadPrompt` reads `<tab>.md`; no code change needed — data only). Run `pnpm test`. **Step 3: Commit:** `feat(server): per-tab agent instruction prompts`.

## Task 7: per-tab `buildTabContext` slices

**Files:** Modify `apps/web/src/agent/tabContext.ts`; extend `apps/web/src/agent/tabContext.test.ts`.

- [ ] **Step 1: Failing tests** for a few representative tabs (facturen carries only invoices, not txs; valuta carries rate+holdings, no amounts; punten carries balances):

```ts
test("facturen context carries capped invoices only", () => {
  const { tab, context } = buildTabContext("facturen", {
    invoices: Array.from({ length: 200 }, (_, i) => ({
      counterparty: "X" + i,
      amount: 1,
      issueDate: "2026-01-01",
      dueDate: "2026-01-31",
      status: "expected",
    })),
    txs: [{}],
  } as any);
  expect(tab).toBe("facturen");
  expect(Array.isArray((context as any).invoices)).toBe(true);
  expect((context as any).invoices.length).toBeLessThanOrEqual(100);
  expect((context as any).txs).toBeUndefined();
});
test("valuta context has no personal amounts", () => {
  const { context } = buildTabContext("valuta", {
    fxRate: { base: "EUR", rates: { USD: 1.15 } },
    accounts: [{ currency: "USD" }],
    invoices: [{}],
  } as any);
  expect((context as any).rate).toBeTruthy();
  expect((context as any).holdings).toContain("USD");
  expect((context as any).invoices).toBeUndefined();
});
```

- [ ] **Step 2: Implement** the remaining `buildTabContext` cases, each returning ONLY the Task-1-allowlisted keys, arrays capped ≤100:
  - rekeningen → `{ accounts: accounts.map(a => ({bank,type,entity,balance})) }`
  - regels → `{ rules }`
  - forecast → `{ summary: <the forecast summary object the Forecast view already builds> }`
  - optimalisatie → `{ subscriptions, rates, bestBenchmark }`
  - valuta → `{ rate: fxRate, holdings: [...unique non-EUR account currencies] }`
  - belasting → `{ vat: <computed set-aside figures>, deadlines, settings: vatSettings }`
  - facturen → `{ invoices: invoices.slice(0,100).map(minimal) }`
  - punten → `{ balances: rewards }`
  - backup → `{}`
    (Pull from the state bag App passes; reuse existing selectors/helpers rather than recomputing. Keep everything aggregate/minimal — no raw `txs` ever.)
- [ ] **Step 3:** In `App.tsx`, widen the `state` object passed to `buildTabContext` so these fields are available (fxRate may need fetching on the Valuta tab — if not already in App scope, pass what's available and let valuta’s context include just `holdings` + let the agent web-search the rate; simplest: include `rate` only if App already has it, else omit). Keep it to data already in scope; do not add heavy new fetches.
- [ ] **Step 4: Run → PASS; `pnpm test`; `pnpm typecheck`; `pnpm --filter @lavega/web build`.** **Step 5: Commit:** `feat(web): minimal per-tab chat context for all tabs`.

---

# PHASE 4 — Remove all "indicatief"

## Task 8: Valuta — drop the indicative routes, keep the realtime converter

**Files:** Modify `apps/web/src/views/Valuta.tsx`, `apps/web/src/valuta.test.ts`, `packages/core/src/fx.ts`, `packages/core/src/fx.test.ts`.

- [ ] **Step 1:** Rewrite `Valuta.tsx` to: keep the amount + from/to selects + the **live ECB middenkoers** line + a single computed **"je ontvangt ≈ {amount × crossRate}"** (realtime, mid-market). REMOVE: the ranked-routes table, `FX_ROUTES`/`rankRoutes`/`ownedProviders` usage, the "indicatief" copy, and the `ownedProviders` export. Add one line: _"Voor de goedkoopste route en actuele kosten per aanbieder: vraag de LaVega-assistent (rechtsonder) — die zoekt de actuele fees live op."_ Keep the live/offline source badge.
- [ ] **Step 2:** In `packages/core/src/fx.ts` remove `FX_ROUTES`, `FX_ROUTES_AS_OF`, `routeNet`, `rankRoutes`, `FxRoute`, `FxRouteResult` (the indicative pieces). KEEP `FxRate`, `crossRate`, `parseFxRatePayload`, `FX_RATE_FALLBACK` (realtime converter + server proxy need them). Update `fx.test.ts`: delete the `routeNet`/`rankRoutes`/`FX_ROUTES` tests; keep `crossRate`/`parseFxRatePayload`/fallback tests.
- [ ] **Step 3:** Update `valuta.test.ts`: remove the `ownedProviders` tests; add a small `crossRate`-based converter assertion if a pure helper is extracted, else drop the file's obsolete tests (leave at least one meaningful test — e.g. currency-option derivation).
- [ ] **Step 4: Verify** — `pnpm test`, `pnpm typecheck`, `pnpm --filter @lavega/web build`. Grep the repo for `FX_ROUTES`/`rankRoutes`/`ownedProviders` → no remaining references. **Step 5: Commit:** `refactor(web): Valuta = realtime ECB converter only; routes move to the assistant`.

## Task 9: Punten — drop the indicative value/transfer, keep the tracker

**Files:** Modify `apps/web/src/views/Punten.tsx`, `packages/core/src/rewards.ts`, `packages/core/src/rewards.test.ts`. (`punten.test.ts` tests `upsertBalance` — keep it.)

- [ ] **Step 1:** Rewrite `Punten.tsx` to keep: the add/edit/delete form (program `datalist` from `REWARD_PROGRAMS` names, points, bijgewerkt-date) + the balances table (programma, punten, bijgewerkt + **verouderd** staleness badge). REMOVE: the "geschatte waarde" column + total, the Amex-transfer card, and the "schattingen" copy. Add one line: _"Wat je punten waard zijn en de beste inwissel/transfer: vraag de LaVega-assistent — die zoekt actuele waardes live op."_
- [ ] **Step 2:** In `packages/core/src/rewards.ts` remove `estimateValueCents`, `totalValueCents`, `amexTransferOptions`, `AMEX_MR_TRANSFERS`, `REWARDS_AS_OF`, `AmexTransfer`, and the `centsPerPoint` field from `RewardProgram` (keep `{ name, category, note? }`). KEEP `RewardsBalance`, `makeRewardsBalance`, `isStale`, `REWARD_PROGRAMS` (names/categories for the datalist). Update `rewards.test.ts`: delete tests for the removed functions; keep `makeRewardsBalance`/`isStale`/table-well-formed (adjusted to not assert `centsPerPoint`).
- [ ] **Step 3: Verify** — `pnpm test`, `pnpm typecheck`, `pnpm --filter @lavega/web build`. Grep for `estimateValueCents`/`amexTransferOptions`/`centsPerPoint` → none left. **Step 4: Commit:** `refactor(web): Punten = balance tracker only; value/transfer move to the assistant`.

## Self-Review notes

- The chat redaction boundary (`sanitizeChatContext`, Task 1) is a dedicated tested pure function the route MUST call; Task-3 test (c) proves disallowed keys never reach `runChat`.
- Opt-in + consent-gated (Task 5); dormant 503 without the key; `@anthropic-ai/sdk` server-only (Task-5 bundle grep).
- Realtime: after Tasks 8–9 no indicative static estimates remain; the agent supplies realtime external facts via web search (per-tab `.md` in Task 6 instruct it, and never to leak personal data into a query — enforced by `_base.md`).
- Types consistent: `ChatMessage`/`ChatTab` in chatContext (Task 1) → consumed by chat.ts (Task 2) + route (Task 3) + client; `buildTabContext` output shape matches the server allowlist per tab.
