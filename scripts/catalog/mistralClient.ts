/** One tool-call request to Mistral's chat API, shared by every model rung of the sweep. */

export const DEFAULT_CATALOG_MODEL = "mistral-large-latest";

/** USD per million tokens. Large: docs.mistral.ai/inference/pricing (Mistral Large 4, 2026-11-22).
 *  Medium: apps/server/src/agent/pricing.ts. Small: its model card, 2026-11-22. */
export const MISTRAL_PRICES: Readonly<Record<string, { inPerM: number; outPerM: number }>> = {
  "mistral-large-latest": { inPerM: 0.7, outPerM: 2.1 },
  "mistral-medium-latest": { inPerM: 1.5, outPerM: 7.5 },
  "mistral-small-latest": { inPerM: 0.15, outPerM: 0.6 },
};

/** An unknown model reads high on purpose: a budget estimate must err upward. */
const UNKNOWN_PRICE = { inPerM: 10, outPerM: 10 };

export type ToolSpec = { name: string; description: string; input_schema: object };
export type ModelUsage = { inputTokens: number; outputTokens: number };
export type ToolCallResult =
  | { kind: "tool"; input: unknown; usage: ModelUsage }
  | { kind: "declined"; text: string; usage: ModelUsage };

/** 401, 402, 403: the key or the account cannot be used. Stop the run. */
export class MistralFatalError extends Error {}
/** This call failed after its retries. The next product may still work. */
export class MistralCallError extends Error {
  /** Set when the reply was HTTP 200 and carried usage: it was billed even though unusable. */
  usage?: ModelUsage;
  /** The request or the reading of its body ran into the timeout. */
  timedOut?: boolean;
}

/** A timeout or a reply cut off at max_tokens: the same request may succeed on a faster model.
 *  Not HTTP errors, not a dead key. */
export function isFallbackWorthy(e: unknown): boolean {
  return e instanceof MistralCallError && (e.timedOut === true || e.message.includes("truncated"));
}

/** What the client sends besides the prompts and the tool. The reply cache hashes these into its key. */
export const REQUEST_CONFIG = Object.freeze({
  temperature: 0,
  top_p: 1,
  max_tokens: 32_000,
  tool_choice: "auto",
});

const isTimeout = (e: unknown) => (e as Error | undefined)?.name === "TimeoutError";

export function usdFor(model: string, usage: ModelUsage): number {
  const p = MISTRAL_PRICES[model] ?? UNKNOWN_PRICE;
  return (usage.inputTokens / 1e6) * p.inPerM + (usage.outputTokens / 1e6) * p.outPerM;
}

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
const BACKOFF_MS = [2_000, 6_000, 18_000];

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Reply = {
  choices?: {
    finish_reason?: string;
    message?: { content?: unknown; tool_calls?: { function?: { arguments?: unknown } }[] };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "",
      )
      .join("");
  }
  return "";
}

export async function callWithTool(req: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  tool: ToolSpec;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Called once per retry, before the wait, with the status that caused it. */
  onRetry?: (status: number, attempt: number) => void;
}): Promise<ToolCallResult> {
  const doFetch = req.fetchImpl ?? fetch;
  const sleep = req.sleep ?? realSleep;
  const body = JSON.stringify({
    model: req.model,
    // The large model rejects greedy sampling unless top_p is 1.
    temperature: REQUEST_CONFIG.temperature,
    top_p: REQUEST_CONFIG.top_p,
    max_tokens: req.maxTokens ?? REQUEST_CONFIG.max_tokens,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: req.tool.name,
          description: req.tool.description,
          parameters: req.tool.input_schema,
        },
      },
    ],
    // Not forced: "this page does not state it for this product" must stay sayable.
    tool_choice: REQUEST_CONFIG.tool_choice,
  });

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${req.apiKey}` },
        body,
        signal: AbortSignal.timeout(req.timeoutMs ?? 180_000),
      });
    } catch (e) {
      // A timeout is not retried: it would bill the call again for the same wait.
      const err = new MistralCallError(`mistral request failed: ${(e as Error).message}`);
      err.timedOut = isTimeout(e);
      throw err;
    }

    if (res.status === 401 || res.status === 402 || res.status === 403) {
      throw new MistralFatalError(`mistral ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < BACKOFF_MS.length) {
      req.onRetry?.(res.status, attempt);
      await sleep(BACKOFF_MS[attempt]!);
      continue;
    }
    if (!res.ok) {
      throw new MistralCallError(`mistral ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    let data: Reply;
    try {
      data = (await res.json()) as Reply;
    } catch (e) {
      const err = new MistralCallError(
        `mistral reply body could not be read: ${(e as Error).message}`,
      );
      err.timedOut = isTimeout(e);
      throw err;
    }
    const usage: ModelUsage = {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
    const message = data.choices?.[0]?.message;
    const args = message?.tool_calls?.[0]?.function?.arguments;
    // Cut off at max_tokens, while thinking or inside the tool call: not a refusal and not a
    // malformed reply, so it must be told apart BEFORE the arguments are parsed.
    if (data.choices?.[0]?.finish_reason === "length") {
      const err = new MistralCallError("reply truncated at max_tokens");
      err.usage = usage;
      throw err;
    }
    if (args === undefined || args === null) {
      return { kind: "declined", text: textOf(message?.content), usage };
    }
    if (typeof args !== "string") return { kind: "tool", input: args, usage };
    try {
      return { kind: "tool", input: JSON.parse(args) as unknown, usage };
    } catch {
      const err = new MistralCallError(`unparseable tool arguments: ${args.slice(0, 200)}`);
      err.usage = usage;
      throw err;
    }
  }
}
