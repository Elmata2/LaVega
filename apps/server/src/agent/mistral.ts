import type { LlmProvider } from "./provider.js";

const BASE_URL = "https://api.mistral.ai/v1";
const CITATION_KEYS = ["references", "citations", "citation_chunks"] as const;
const DEFAULT_TIMEOUT_MS = 60_000;
const SEARCH_TIMEOUT_MS = 240_000;

async function errorBody(res: Response): Promise<string> {
  return (await res.text()).slice(0, 2000);
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`mistral ${label} timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asSource(v: unknown): { url: string; title: string } | undefined {
  if (!isRecord(v) || typeof v.url !== "string") return undefined;
  const title = typeof v.title === "string" && v.title ? v.title : v.url;
  return { url: v.url, title };
}

// Collects any {url, title?} entries found directly on `value`, in an array
// `value`, or in a references/citations/citation_chunks array on `value` — the
// exact citation shape isn't confirmed, so we look for all of these.
function collectSources(value: unknown, into: Map<string, { url: string; title: string }>) {
  const direct = asSource(value);
  if (direct) {
    if (!into.has(direct.url)) into.set(direct.url, direct);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const s = asSource(item);
      if (s && !into.has(s.url)) into.set(s.url, s);
    }
    return;
  }
  if (isRecord(value)) {
    for (const key of CITATION_KEYS) {
      const arr = value[key];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const s = asSource(item);
        if (s && !into.has(s.url)) into.set(s.url, s);
      }
    }
  }
}

function extractSources(outputs: unknown[]): { url: string; title: string }[] {
  const found = new Map<string, { url: string; title: string }>();
  for (const output of outputs) {
    collectSources(output, found);
    if (isRecord(output)) {
      for (const nested of Object.values(output)) collectSources(nested, found);
    }
  }
  return [...found.values()];
}

// `model` is a constructor param, not a per-call one: the shared LlmProvider.complete
// signature has no model field, and different call sites need different models
// (e.g. mistral-small-latest for categorize/extraction, mistral-medium-latest for
// travel/chat), so each call site builds its own provider instance.
export function createMistralProvider(apiKey: string, model: string): LlmProvider {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  return {
    async complete({ system, user, json, maxTokens }) {
      const res = await fetchWithTimeout(
        `${BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            max_tokens: maxTokens,
            ...(json ? { response_format: { type: "json_object" } } : {}),
          }),
        },
        DEFAULT_TIMEOUT_MS,
        "chat",
      );
      if (!res.ok) throw new Error(`mistral chat ${res.status}: ${await errorBody(res)}`);
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        console.error(`mistral chat onverwachte respons: ${JSON.stringify(data).slice(0, 2000)}`);
        throw new Error("onverwachte respons");
      }
      return {
        text: content,
        usage: {
          input: typeof data.usage?.prompt_tokens === "number" ? data.usage.prompt_tokens : 0,
          output:
            typeof data.usage?.completion_tokens === "number" ? data.usage.completion_tokens : 0,
        },
      };
    },

    async ocrPdf({ pdfBase64, pages }) {
      const res = await fetchWithTimeout(
        `${BASE_URL}/ocr`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: "mistral-ocr-latest",
            document: {
              type: "document_url",
              document_url: `data:application/pdf;base64,${pdfBase64}`,
            },
            ...(pages !== undefined ? { pages } : {}),
          }),
        },
        DEFAULT_TIMEOUT_MS,
        "ocr",
      );
      if (!res.ok) throw new Error(`mistral ocr ${res.status}: ${await errorBody(res)}`);
      const data = await res.json();
      if (!Array.isArray(data.pages)) {
        console.error(`mistral ocr onverwachte respons: ${JSON.stringify(data).slice(0, 2000)}`);
        throw new Error("onverwachte respons");
      }
      return {
        markdown: data.pages
          .map((p: { markdown?: unknown }) => (typeof p?.markdown === "string" ? p.markdown : ""))
          .join("\n\n"),
        pages:
          typeof data.usage_info?.pages_processed === "number"
            ? data.usage_info.pages_processed
            : data.pages.length,
      };
    },

    async chatWithSearch({ system, messages, onDelta }) {
      const body = {
        model,
        instructions: system,
        tools: [{ type: "web_search" }],
        inputs: messages,
        stream: false,
      };

      const res = await fetchWithTimeout(
        `${BASE_URL}/conversations`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
        SEARCH_TIMEOUT_MS,
        "conversation",
      );
      if (!res.ok) throw new Error(`mistral conversation ${res.status}: ${await errorBody(res)}`);
      const data = await res.json();

      const outputs: unknown[] = Array.isArray(data.outputs) ? data.outputs : [];
      const text = outputs
        .map((o) => {
          if (!isRecord(o) || typeof o.content !== "string") return "";
          // Only message entries carry user-visible text — tool/function/handoff
          // entries (e.g. the web_search step) can also have a `content` field,
          // but it's internal and must not leak into the answer.
          if (typeof o.type === "string" && o.type !== "message.output") return "";
          return o.content;
        })
        .join("");
      const sources = extractSources(outputs);

      onDelta(text);
      return { text, sources };
    },
  };
}
