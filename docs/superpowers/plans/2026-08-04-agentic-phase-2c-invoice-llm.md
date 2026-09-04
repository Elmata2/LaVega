# Agentic Phase 2c — Invoice LLM extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let the owner opt in to reading an invoice PDF with Claude: drop a PDF → the server proxy sends ONLY that one document to the Anthropic API (owner's key) → Claude returns the 7 structured invoice fields → they pre-fill the Facturen form as a DRAFT the owner confirms/edits before it becomes an `expected` invoice.

**Architecture:** A thin server-side LLM proxy on the existing Hono server (`POST /api/agent/extract-invoice`) holding the owner's `ANTHROPIC_API_KEY` (Railway env, same custody as `EB_PRIVATE_KEY`), so `@anthropic-ai/sdk` never enters the browser bundle. A hard **redaction boundary** (`sanitizeExtractInput`) guarantees only `{pdfBase64|text, filename, mediaType}` can ever be forwarded — never transactions/balances/other invoices — with a size cap. A small in-memory rate limiter. Client side: an OPT-IN toggle (default OFF) + a PDF drop that calls the proxy and pre-fills a draft; nothing auto-feeds the forecast (confirm-first).

**Tech Stack:** TypeScript, pnpm monorepo, Vitest, Hono, `@anthropic-ai/sdk` (Claude Opus 4.8, tool-use forced structured output).

## Global Constraints

- **Privacy boundary (owner-approved):** an opted-in PDF is sent (base64) via the owner's server proxy to Anthropic. The redaction boundary must make it _impossible_ for anything other than the single document + the fixed extraction schema to reach the API. Default OFF; per-document; confirm-first.
- LLM lives ONLY on the server (`apps/server`). `@anthropic-ai/sdk` must NOT be imported anywhere in `apps/web`. Model: `claude-opus-4-8`. Structured output via a forced tool (`tool_choice: {type:"tool", name:"record_invoice"}`).
- Returns `503 "AI-extractie niet geconfigureerd"` until `ANTHROPIC_API_KEY` is set — the app keeps working (manual + CSV/UBL) without it.
- Pure core stays pure; the money math (amount→invoice) stays deterministic — the LLM only proposes field values the owner confirms.
- Dutch UI copy. Each task commits with a message ending `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Verify: `pnpm test`, `pnpm typecheck`, `pnpm --filter @lavega/web build`, `pnpm --filter @lavega/server build` (tsc) — and confirm `@anthropic-ai/sdk` is NOT in the web bundle.

## File Structure

- `apps/server/package.json` — `@anthropic-ai/sdk` dependency (already added).
- `apps/server/src/config.ts` — `loadLlmConfig()` (modify).
- `apps/server/src/agent/redaction.ts` — NEW: `sanitizeExtractInput`, `INVOICE_TOOL`, `EXTRACT_PROMPT`.
- `apps/server/src/agent/anthropicExtract.ts` — NEW: `extractInvoiceFields(input, apiKey)`.
- `apps/server/src/agent/rateLimit.ts` — NEW: tiny in-memory limiter.
- `apps/server/src/agent-routes.ts` — NEW: `registerAgentRoutes(app)` → `/api/agent/status`, `POST /api/agent/extract-invoice`.
- `apps/server/src/index.ts` — register agent routes (modify).
- `packages/core/src/model.ts` — `Invoice.sourceType` gains `"llm"`; add optional `confidence?` (modify).
- `apps/web/src/settings.ts` — `getAiExtractionEnabled`/`setAiExtractionEnabled` (modify).
- `apps/web/src/views/Facturen.tsx` — opt-in toggle + PDF-drop → proxy → draft prefill (modify).

---

## Task 1: Server LLM config + `@anthropic-ai/sdk` dep + `/api/agent/status`

**Files:** Modify `apps/server/src/config.ts`, `apps/server/src/index.ts`; Test `apps/server/src/config.test.ts` (append) or a small new test. Ensure `apps/server/package.json` lists `@anthropic-ai/sdk` (already added by `pnpm add`).

**Interfaces produced:** `loadLlmConfig(): { configured: boolean; apiKey: string | null }` (reads `process.env.ANTHROPIC_API_KEY`; `configured` = non-empty). Route `GET /api/agent/status` → `{ configured: boolean }`.

- [ ] **Step 1: Failing test** — append to `apps/server/src/config.test.ts`:

```ts
import { loadLlmConfig } from "./config.js";
test("loadLlmConfig: configured only when ANTHROPIC_API_KEY is set", () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  expect(loadLlmConfig()).toEqual({ configured: false, apiKey: null });
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  expect(loadLlmConfig()).toEqual({ configured: true, apiKey: "sk-ant-test" });
  if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prev;
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Add to `config.ts`:**

```ts
export function loadLlmConfig(): { configured: boolean; apiKey: string | null } {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
  return { configured: typeof apiKey === "string" && apiKey.length > 0, apiKey };
}
```

- [ ] **Step 4:** In `index.ts`, add `import { loadLlmConfig } from "./config.js";` and, next to the EB status route, `app.get("/api/agent/status", (c) => c.json({ configured: loadLlmConfig().configured }));`. (This can also be added in Task 3's `registerAgentRoutes`; if so, keep this route there and skip here — don't duplicate.)
- [ ] **Step 5: Run → PASS; typecheck.** **Step 6: Commit** (`config.ts`, `config.test.ts`, `index.ts`, `package.json`, `pnpm-lock.yaml`): `feat(server): Anthropic LLM config + @anthropic-ai/sdk dep + /api/agent/status`.

---

## Task 2: Redaction boundary + extraction schema (the must-not-skip guard)

**Files:** Create `apps/server/src/agent/redaction.ts`, `apps/server/src/agent/redaction.test.ts`.

**Interfaces produced:**

- `type InvoiceExtractInput = { pdfBase64?: string; text?: string; filename?: string; mediaType?: string }`.
- `sanitizeExtractInput(raw: unknown): InvoiceExtractInput` — copies ONLY those 4 keys, enforces size caps, requires at least one of pdf/text, throws on violation. Anything else in `raw` (e.g. `transactions`, `balance`) is dropped.
- `INVOICE_TOOL` (Anthropic tool spec: name `record_invoice`, `input_schema` with the 7 fields) + `EXTRACT_PROMPT` (fixed Dutch/English instruction).

- [ ] **Step 1: Failing test** — `apps/server/src/agent/redaction.test.ts`:

```ts
import { expect, test } from "vitest";
import { sanitizeExtractInput, INVOICE_TOOL } from "./redaction.js";

test("sanitizeExtractInput passes only the allowed doc fields — never anything else", () => {
  const out = sanitizeExtractInput({
    pdfBase64: "AAAA",
    filename: "f.pdf",
    transactions: [1, 2, 3],
    balance: 99999,
    apiKey: "leak",
  } as unknown);
  expect(out).toEqual({ pdfBase64: "AAAA", filename: "f.pdf" });
  expect((out as Record<string, unknown>).transactions).toBeUndefined();
  expect((out as Record<string, unknown>).balance).toBeUndefined();
});

test("sanitizeExtractInput enforces size caps and requires a document", () => {
  expect(() => sanitizeExtractInput({})).toThrow();
  expect(() => sanitizeExtractInput({ pdfBase64: "A".repeat(14_000_001) })).toThrow();
  expect(() => sanitizeExtractInput({ text: "A".repeat(200_001) })).toThrow();
});

test("INVOICE_TOOL forces exactly the 7 invoice fields", () => {
  const props = Object.keys(INVOICE_TOOL.input_schema.properties);
  expect(new Set(props)).toEqual(
    new Set([
      "counterparty",
      "amount",
      "currency",
      "issueDate",
      "dueDate",
      "direction",
      "vatAmount",
    ]),
  );
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Create `apps/server/src/agent/redaction.ts`:**

```ts
export type InvoiceExtractInput = {
  pdfBase64?: string;
  text?: string;
  filename?: string;
  mediaType?: string;
};

const MAX_PDF_B64 = 14_000_000; // ~10 MB of base64
const MAX_TEXT = 200_000;

/** THE redaction boundary: build the forwarded input from ONLY these four keys.
 *  Nothing else in `raw` (transactions, balances, keys, ...) can ever reach the
 *  Anthropic API. Throws on oversize or an empty document. */
export function sanitizeExtractInput(raw: unknown): InvoiceExtractInput {
  if (!raw || typeof raw !== "object") throw new Error("ongeldige invoer");
  const r = raw as Record<string, unknown>;
  const out: InvoiceExtractInput = {};
  if (typeof r.pdfBase64 === "string") {
    if (r.pdfBase64.length > MAX_PDF_B64) throw new Error("pdf te groot");
    out.pdfBase64 = r.pdfBase64;
  }
  if (typeof r.text === "string") {
    if (r.text.length > MAX_TEXT) throw new Error("tekst te groot");
    out.text = r.text;
  }
  if (typeof r.filename === "string") out.filename = r.filename.slice(0, 200);
  if (typeof r.mediaType === "string") out.mediaType = r.mediaType.slice(0, 100);
  if (!out.pdfBase64 && !out.text) throw new Error("geen document");
  return out;
}

export const INVOICE_TOOL = {
  name: "record_invoice",
  description: "Registreer de velden van deze ene factuur.",
  input_schema: {
    type: "object",
    properties: {
      counterparty: {
        type: "string",
        description: "Naam van de wederpartij (leverancier bij inkoop, klant bij verkoop)",
      },
      amount: { type: "number", description: "Totaalbedrag incl. btw, in de factuurvaluta" },
      currency: { type: "string", description: "ISO-valuta, bv. EUR" },
      issueDate: { type: "string", description: "Factuurdatum, ISO YYYY-MM-DD" },
      dueDate: {
        type: "string",
        description: "Vervaldatum, ISO YYYY-MM-DD (indien afwezig: gelijk aan factuurdatum)",
      },
      direction: {
        type: "string",
        enum: ["in", "out"],
        description:
          "'in' = jij ontvangt geld (verkoopfactuur); 'out' = jij betaalt (inkoopfactuur)",
      },
      vatAmount: { type: "number", description: "Btw-bedrag indien vermeld" },
    },
    required: ["counterparty", "amount", "currency", "issueDate", "dueDate", "direction"],
  },
} as const;

export const EXTRACT_PROMPT =
  "Je krijgt één factuur (PDF of tekst). Haal de velden eruit en roep record_invoice aan. " +
  "Gok niet: laat vatAmount weg als het niet vermeld staat; als de vervaldatum ontbreekt, gebruik de factuurdatum. " +
  "Bepaal 'direction' vanuit wie de factuur uitschrijft.";
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** (`redaction.ts`, `redaction.test.ts`): `feat(server): invoice-extract redaction boundary + tool schema`.

---

## Task 3: Anthropic extractor + agent route + rate limiter

**Files:** Create `apps/server/src/agent/anthropicExtract.ts`, `apps/server/src/agent/rateLimit.ts`, `apps/server/src/agent-routes.ts`, and tests `apps/server/src/agent-routes.test.ts`, `apps/server/src/agent/rateLimit.test.ts`; Modify `apps/server/src/index.ts` (register).

**Interfaces produced:**

- `extractInvoiceFields(input: InvoiceExtractInput, apiKey: string): Promise<{ fields: ExtractedInvoice; confidence: number }>` where `ExtractedInvoice = { counterparty; amount; currency; issueDate; dueDate; direction: "in"|"out"; vatAmount? }`.
- `createRateLimiter(max: number, windowMs: number)` → `(key: string) => boolean` (true = allowed).
- `registerAgentRoutes(app, deps?)` where `deps.extract` is injectable (defaults to `extractInvoiceFields`) — so the route is testable without a network call.

- [ ] **Step 1: rateLimit test + impl.** `rateLimit.test.ts`: a limiter of `max:2, window:1000` allows 2 then blocks the 3rd for the same key; `now` is injectable. Implement `apps/server/src/agent/rateLimit.ts`:

```ts
export function createRateLimiter(
  max: number,
  windowMs: number,
  now: () => number = () => Date.now(),
) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const arr = (hits.get(key) ?? []).filter((ts) => t - ts < windowMs);
    if (arr.length >= max) {
      hits.set(key, arr);
      return false;
    }
    arr.push(t);
    hits.set(key, arr);
    return true;
  };
}
```

- [ ] **Step 2: `anthropicExtract.ts`** — build the request from the sanitized input + `INVOICE_TOOL`/`EXTRACT_PROMPT`, call the SDK, parse the forced tool_use:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { InvoiceExtractInput } from "./redaction.js";
import { INVOICE_TOOL, EXTRACT_PROMPT } from "./redaction.js";

export type ExtractedInvoice = {
  counterparty: string;
  amount: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  direction: "in" | "out";
  vatAmount?: number;
};

export async function extractInvoiceFields(
  input: InvoiceExtractInput,
  apiKey: string,
): Promise<{ fields: ExtractedInvoice; confidence: number }> {
  const client = new Anthropic({ apiKey });
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.pdfBase64)
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: (input.mediaType as "application/pdf") || "application/pdf",
        data: input.pdfBase64,
      },
    });
  if (input.text) content.push({ type: "text", text: `Factuurtekst:\n${input.text}` });
  content.push({ type: "text", text: EXTRACT_PROMPT });
  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    tools: [INVOICE_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "record_invoice" },
    messages: [{ role: "user", content }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("geen extractie");
  const f = block.input as Record<string, unknown>;
  const fields: ExtractedInvoice = {
    counterparty: String(f.counterparty ?? ""),
    amount: Number(f.amount ?? 0),
    currency: String(f.currency ?? "EUR"),
    issueDate: String(f.issueDate ?? ""),
    dueDate: String(f.dueDate ?? f.issueDate ?? ""),
    direction: f.direction === "in" ? "in" : "out",
    vatAmount: typeof f.vatAmount === "number" ? f.vatAmount : undefined,
  };
  return { fields, confidence: 0.8 };
}
```

(The exact SDK types may differ slightly — the implementer must read `@anthropic-ai/sdk`'s current `messages.create` + content-block types and adapt so it typechecks. Keep the shape: PDF document block + a forced `record_invoice` tool.)

- [ ] **Step 3: `agent-routes.ts`:**

```ts
import type { Hono } from "hono";
import { loadLlmConfig } from "./config.js";
import { sanitizeExtractInput } from "./agent/redaction.js";
import { extractInvoiceFields } from "./agent/anthropicExtract.js";
import { createRateLimiter } from "./agent/rateLimit.js";

type Deps = { extract?: typeof extractInvoiceFields };
const limit = createRateLimiter(20, 60_000); // 20 extractions/min

export function registerAgentRoutes(app: Hono, deps: Deps = {}): void {
  const extract = deps.extract ?? extractInvoiceFields;
  app.get("/api/agent/status", (c) => c.json({ configured: loadLlmConfig().configured }));
  app.post("/api/agent/extract-invoice", async (c) => {
    const { configured, apiKey } = loadLlmConfig();
    if (!configured || !apiKey)
      return c.json({ error: "AI-extractie is niet geconfigureerd op de server." }, 503);
    if (!limit("extract")) return c.json({ error: "Even wachten — te veel AI-verzoeken." }, 429);
    let input;
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
}
```

- [ ] **Step 4:** register in `index.ts` (import `registerAgentRoutes`, call `registerAgentRoutes(app)` before the static catch-all). If Task 1 already added the `/api/agent/status` route in index.ts, REMOVE that line (it now lives in `registerAgentRoutes`) to avoid a duplicate.
- [ ] **Step 5: `agent-routes.test.ts`** (mirror `index.test.ts`'s pattern of importing the app; mock `loadLlmConfig` via env): (a) with no key → `POST /api/agent/extract-invoice` returns 503; (b) with a key set + an injected fake `extract` (register a test app via `registerAgentRoutes(testApp, { extract: async () => ({ fields: {...}, confidence: 0.9 }) })`) → 200 with the fields; (c) a body carrying `transactions`/`balance` alongside a `pdfBase64` → the injected extract receives ONLY the sanitized input (assert the extra keys never reach it); (d) oversize pdf → 400.
- [ ] **Step 6: Verify** — `pnpm test`, `pnpm typecheck`, `pnpm --filter @lavega/server build`. **Step 7: Commit**: `feat(server): /api/agent/extract-invoice proxy + rate limiter + Anthropic extractor`.

---

## Task 4: Web — opt-in toggle + PDF drop → draft (confirm-first)

**Files:** Modify `packages/core/src/model.ts` (Invoice.sourceType `+ "llm"`, `confidence?: number`); `apps/web/src/settings.ts`; `apps/web/src/views/Facturen.tsx`; Test `apps/web/src/facturen-llm.test.ts` (NEW).

- [ ] **Step 1: model.ts** — change `sourceType: "manual" | "csv" | "ubl"` to `... | "llm"`; add `confidence?: number` to `Invoice`.
- [ ] **Step 2: settings.ts** — add (mirroring `getBufferCents`):

```ts
const AI_KEY = "lavega.aiExtraction";
export function getAiExtractionEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(AI_KEY) === "1";
  } catch {
    return false;
  }
}
export function setAiExtractionEnabled(on: boolean): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(AI_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 3: Facturen.tsx** — add an "AI-facturen lezen (PDF → Claude)" section:
  - A checkbox bound to `getAiExtractionEnabled`/`setAiExtractionEnabled` (default OFF), with a one-line note that the chosen PDF is sent to Anthropic via the server (opt-in, only that document).
  - When ON: a PDF `<input type="file" accept="application/pdf">`. On select: read the file as base64 (`const b64 = btoa over an ArrayBuffer`, or `FileReader.readAsDataURL` then strip the `data:...;base64,` prefix), `POST ${API_BASE}/api/agent/extract-invoice` with `{ pdfBase64, filename: file.name, mediaType: file.type }`. On 503 → note "AI-extractie is niet geconfigureerd" ; on error → show it.
  - On success: PRE-FILL the manual-entry form state (direction/counterparty/amount/issueDate/dueDate/currency/vat) with the returned `fields`, set a visible "AI-concept — controleer en bevestig (betrouwbaarheid X%)" note, and set the pending `sourceType` to `"llm"` + `confidence`. The invoice is added to the vault ONLY when the owner clicks the existing "Toevoegen" (confirm-first). Nothing auto-saves.
  - `@anthropic-ai/sdk` must NOT be imported here — only `fetch` to the proxy.
- [ ] **Step 4: `apps/web/src/facturen-llm.test.ts`** — pure wiring test: given a mocked proxy response `{ fields: {...}, confidence: 0.9 }`, assert the mapping into a draft Invoice (via `makeInvoice` with `sourceType:"llm"`) produces a valid `expected` invoice with the right fields (no network — test the mapping function you extract, or assert `makeInvoice({...fields, sourceType:"llm"})` shape). Keep it logic-only (jsdom + a stubbed `fetch` if you test the call).
- [ ] **Step 5: Verify** — `pnpm test`, `pnpm typecheck`, `pnpm --filter @lavega/web build`. Also grep the built web bundle to confirm `@anthropic-ai/sdk` / "anthropic" is NOT present. **Step 6: Commit** (`model.ts`, `settings.ts`, `Facturen.tsx`, test): `feat(web): opt-in AI PDF invoice extraction (confirm-first)`.

## Deployment note (after merge)

2c returns 503 until the owner sets `ANTHROPIC_API_KEY` in Railway (their account/cost) and enables the opt-in toggle in the app. Advise the owner to set Anthropic org data-retention to minimum + no training before the first real call.

## Self-Review notes

- Redaction boundary is a dedicated, tested pure function (Task 2) that the route MUST call before anything reaches the SDK; Task 3's route test (c) asserts extra keys never reach the extractor.
- LLM only proposes; the owner confirms before any invoice becomes an `expected` flow (Task 4) — so a hallucinated field can't silently move the forecast.
- `@anthropic-ai/sdk` stays server-only (Task 4 Step 5 greps the web bundle to prove it).
- Types consistent: `InvoiceExtractInput`/`ExtractedInvoice` in the server agent module; `Invoice.sourceType` gains `"llm"` in core.
