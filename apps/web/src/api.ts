import type { Locale } from "./locale.js";
import { apiErrorText } from "./copy/apiErrors.js";
import { pick, readAppLocale } from "./appLocale.js";

/* Base URL for the LaVega server API (Enable Banking + rates). In production the
 * web app is served from the same origin as the server, so a relative "" works.
 * In dev the web runs on Vite (:5173) and the server on :8787. Overridable via
 * VITE_API_URL. */
export const API_BASE: string =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:8787" : "");

export type ChatMessage = { role: string; content: string };

/** Shown for any 401 from a Better-Auth-guarded server route. */
export const SIGNED_OUT_MESSAGE = "Je bent uitgelogd, log opnieuw in.";

/** Turn a non-OK `Response` into a user-facing Dutch message: `{error}` from
 *  the JSON body when present, else a status-based fallback — except a 401,
 *  which always means the session lapsed. */
export async function apiErrorMessage(res: Response): Promise<string> {
  if (res.status === 401) return SIGNED_OUT_MESSAGE;
  let msg = `Verzoek mislukt (${res.status}).`;
  try {
    const parsed = (await res.json()) as { error?: string; problems?: string[] };
    if (parsed?.error) msg = parsed.error;
    else if (parsed?.problems?.length) msg = parsed.problems.join(" ");
  } catch {
    /* non-JSON error body; keep the status-based message */
  }
  return msg;
}

const SIGNED_OUT_MESSAGE_EN = "You're signed out, log back in.";

/** Same message as SIGNED_OUT_MESSAGE, in the caller's language. The
 *  no-locale exports above keep returning Dutch so every existing caller
 *  behaves exactly as before until it is converted — same pattern as
 *  format.ts's `*In` functions. */
export function signedOutMessageIn(locale: Locale): string {
  return locale === "nl" ? SIGNED_OUT_MESSAGE : SIGNED_OUT_MESSAGE_EN;
}

export async function apiErrorMessageIn(locale: Locale, res: Response): Promise<string> {
  if (res.status === 401) return signedOutMessageIn(locale);
  let msg =
    locale === "nl" ? `Verzoek mislukt (${res.status}).` : `Request failed (${res.status}).`;
  try {
    const parsed = (await res.json()) as { error?: string; code?: string; problems?: string[] };
    if (parsed?.error) msg = parsed.error;
    else if (parsed?.problems?.length) msg = parsed.problems.join(" ");
    if (parsed?.code) msg = apiErrorText(locale, parsed.code, msg, res.status);
  } catch {
    /* non-JSON error body; keep the status-based message */
  }
  return msg;
}

/** One transaction for the AI-categorize proxy. Only these three fields ever
 *  leave the browser — never amounts, balances, account keys, or dates. The
 *  server's `sanitizeCategorizeInput` re-enforces this allowlist. */
export type CategorizeItem = { id: string; text: string; sign: "in" | "out" };

/** Bulk-categorize onbekend transactions via our server's `POST
 *  /api/agent/categorize` (which proxies Mistral — the browser never talks to
 *  Mistral directly). Returns one `{id, category}` per transaction the model
 *  could classify; ids it couldn't place are simply absent. Throws with the
 *  server's `{error}` message on a non-OK response (503/429/400/502). */
export async function categorizeTxs(
  items: CategorizeItem[],
): Promise<{ id: string; category: string }[]> {
  const res = await fetch(`${API_BASE}/api/agent/categorize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(await apiErrorMessageIn(readAppLocale(), res));
  return (await res.json()) as { id: string; category: string }[];
}

export type ProviderTerms = {
  provider: string;
  fxFeePct?: number;
  convertFeePct?: number;
  cashbackPct?: number;
  pointsPerEuro?: number;
  transferFreeViaIdeal?: number;
  note?: string;
  /** When the SOURCE says the figure was last checked. bank.nl stamps its rows;
   *  an agent lookup states nothing because it is as of now. Used to date the
   *  fact by when it was TRUE rather than when we received it. */
  checkedAt?: string;
};

/** Ask the travel agent for the CURRENT terms of the providers you bank with.
 *  Sends provider NAMES and a country pair — never balances or accounts; the
 *  ranking that needs those is done locally. */
export async function travelFacts(input: {
  homeCountry: string;
  destination: string;
  currency: string;
  providers: string[];
  knownFacts: { subject: string; key: string; value: string }[];
}): Promise<{ terms: ProviderTerms[]; pending: string[] }> {
  // Returns immediately: `terms` is what the server already knows, `pending`
  // is what it just started looking up. Card tariffs are public data cached
  // server-side, so the answer is usually instant and a gap fills in by itself.
  const res = await fetch(`${API_BASE}/api/agent/travel-facts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await apiErrorMessageIn(readAppLocale(), res));
  const body = (await res.json()) as { terms?: ProviderTerms[]; pending?: string[] };
  return { terms: body.terms ?? [], pending: body.pending ?? [] };
}

export type ChatStreamHandlers = {
  onChunk: (text: string) => void;
  onError?: (msg: string, code?: string) => void;
  onDone?: () => void;
};

/** Parse one SSE record (the text between two "\n\n" delimiters) and fire the
 *  matching handler. A record with no `event:` line is a plain text chunk —
 *  one `onChunk` call per `data:` line. `event: error` / `event: done`
 *  records are the terminal signals the server (agent-routes.ts) sends. An
 *  `event: error` record carries its `code:` line alongside `data:`, not as
 *  a separate event — a record with only a `code:` line and no `data:` line
 *  is inert (no handler fires at all), which is what keeps this change safe
 *  for an unrecognized line prefix: it is never misread as a text chunk. */
export function dispatchSseRecord(record: string, handlers: ChatStreamHandlers): void {
  if (!record.trim()) return;
  let event: string | null = null;
  let code: string | undefined;
  const dataLines: string[] = [];
  for (const rawLine of record.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("code:")) code = line.slice("code:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).replace(/^ /, ""));
  }
  if (event === "error") {
    handlers.onError?.(dataLines.join("\n"), code);
    return;
  }
  if (event === "done") {
    handlers.onDone?.();
    return;
  }
  // One record = one writeSSE({data}) call. Claude's `writeSSE` splits a chunk
  // that contains newlines into multiple `data:` lines, so rejoin them into the
  // single original chunk (preserving internal newlines) rather than emitting
  // one onChunk per line.
  if (dataLines.length > 0) handlers.onChunk(dataLines.join("\n"));
}

/** Stream one chat turn from our server's `POST /api/agent/chat` (which
 *  itself proxies Mistral — the browser never talks to Mistral directly).
 *  Non-OK responses (503 unconfigured, 429 rate-limited, 400 bad body) are
 *  reported via `onError` with the server's `{error}` message; a healthy
 *  response is an SSE stream of `data:` text chunks terminated by
 *  `event: done` (or `event: error` on a mid-stream failure). */
export async function streamChat(
  body: { tab: string; messages: ChatMessage[]; context: Record<string, unknown> },
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    handlers.onError?.(await apiErrorMessageIn(readAppLocale(), res));
    return;
  }
  if (!res.body) {
    handlers.onError?.(pick(readAppLocale(), "Geen antwoord van de server.", "No response from the server."));
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const records = buffer.split("\n\n");
    buffer = records.pop() ?? "";
    for (const record of records) dispatchSseRecord(record, handlers);
  }
  if (buffer.trim()) dispatchSseRecord(buffer, handlers);
}
