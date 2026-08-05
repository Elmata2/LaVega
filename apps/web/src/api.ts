/* Base URL for the LaVega server API (Enable Banking + rates). In production the
 * web app is served from the same origin as the server, so a relative "" works.
 * In dev the web runs on Vite (:5173) and the server on :8787. Overridable via
 * VITE_API_URL. */
export const API_BASE: string =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:8787" : "");

export type ChatMessage = { role: string; content: string };

export type ChatStreamHandlers = {
  onChunk: (text: string) => void;
  onError?: (msg: string) => void;
  onDone?: () => void;
};

/** Parse one SSE record (the text between two "\n\n" delimiters) and fire the
 *  matching handler. A record with no `event:` line is a plain text chunk —
 *  one `onChunk` call per `data:` line. `event: error` / `event: done`
 *  records are the terminal signals the server (agent-routes.ts) sends. */
export function dispatchSseRecord(record: string, handlers: ChatStreamHandlers): void {
  if (!record.trim()) return;
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const rawLine of record.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).replace(/^ /, ""));
  }
  if (event === "error") {
    handlers.onError?.(dataLines.join("\n"));
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
 *  itself proxies Claude — the browser never talks to Anthropic directly).
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
    let msg = `Verzoek mislukt (${res.status}).`;
    try {
      const parsed = (await res.json()) as { error?: string };
      if (parsed?.error) msg = parsed.error;
    } catch {
      /* non-JSON error body; keep the status-based message */
    }
    handlers.onError?.(msg);
    return;
  }
  if (!res.body) {
    handlers.onError?.("Geen antwoord van de server.");
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
