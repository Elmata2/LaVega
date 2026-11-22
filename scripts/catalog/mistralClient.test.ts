import { describe, expect, it, vi } from "vitest";
import {
  callWithTool,
  MistralCallError,
  MistralFatalError,
  REQUEST_CONFIG,
  isFallbackWorthy,
  usdFor,
  type ToolSpec,
} from "./mistralClient.js";

const tool: ToolSpec = {
  name: "record_x",
  description: "Record x.",
  input_schema: { type: "object", properties: { x: { type: "number" } } },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const toolReply = (args: string, usage = { prompt_tokens: 100, completion_tokens: 20 }) =>
  json(200, {
    choices: [{ message: { tool_calls: [{ function: { name: "record_x", arguments: args } }] } }],
    usage,
  });

const base = { apiKey: "k", model: "mistral-large-latest", system: "sys", user: "usr", tool };

describe("callWithTool", () => {
  it("sends tool in function format with temperature 0 and top_p 1", async () => {
    const fetchImpl = vi.fn(async () => toolReply("{}"));
    await callWithTool({ ...base, fetchImpl: fetchImpl as never });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = JSON.parse(String(init.body));
    expect(body.temperature).toBe(0);
    expect(body.top_p).toBe(1);
    expect(body.tool_choice).toBe("auto");
    expect(body.max_tokens).toBe(32000);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "record_x",
          description: "Record x.",
          parameters: tool.input_schema,
        },
      },
    ]);
  });

  it("default max_tokens is 32000", async () => {
    const fetchImpl = vi.fn(async () => toolReply("{}"));
    await callWithTool({ ...base, fetchImpl: fetchImpl as never });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).max_tokens).toBe(32000);
  });

  it("a reply cut at max_tokens without a tool call throws MistralCallError with usage", async () => {
    const fetchImpl = async () =>
      json(200, {
        choices: [{ finish_reason: "length", message: { content: [{ type: "thinking" }] } }],
        usage: { prompt_tokens: 6000, completion_tokens: 32000 },
      });
    const err = await callWithTool({ ...base, fetchImpl: fetchImpl as never }).catch((e) => e);
    expect(err).toBeInstanceOf(MistralCallError);
    expect(err.message).toBe("reply truncated at max_tokens");
    expect(err.usage).toEqual({ inputTokens: 6000, outputTokens: 32000 });
  });

  it("a tool call cut off at max_tokens is truncated, not unparseable", async () => {
    const fetchImpl = async () =>
      json(200, {
        choices: [
          {
            finish_reason: "length",
            message: { tool_calls: [{ function: { arguments: '{"value": 1.' } }] },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 32000 },
      });
    const err = await callWithTool({ ...base, fetchImpl: fetchImpl as never }).catch((e) => e);
    expect(err).toBeInstanceOf(MistralCallError);
    expect(err.message).toBe("reply truncated at max_tokens");
    expect(err.usage).toEqual({ inputTokens: 100, outputTokens: 32000 });
    expect(isFallbackWorthy(err)).toBe(true);
  });

  it("returns tool input parsed from the arguments string", async () => {
    const r = await callWithTool({
      ...base,
      fetchImpl: (async () => toolReply('{"x":1.4}')) as never,
    });
    expect(r).toEqual({
      kind: "tool",
      input: { x: 1.4 },
      usage: { inputTokens: 100, outputTokens: 20 },
    });
  });

  it("text answer without a tool call is declined, with the text", async () => {
    const r = await callWithTool({
      ...base,
      fetchImpl: (async () =>
        json(200, {
          choices: [{ message: { content: "Not stated for this product." } }],
          usage: { prompt_tokens: 5, completion_tokens: 6 },
        })) as never,
    });
    expect(r).toEqual({
      kind: "declined",
      text: "Not stated for this product.",
      usage: { inputTokens: 5, outputTokens: 6 },
    });
  });

  it("unparseable arguments throw MistralCallError carrying the reply's usage", async () => {
    const err = await callWithTool({
      ...base,
      fetchImpl: (async () =>
        toolReply("{nope", { prompt_tokens: 7, completion_tokens: 8192 })) as never,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MistralCallError);
    expect((err as MistralCallError).usage).toEqual({ inputTokens: 7, outputTokens: 8192 });
  });

  it("a body that fails to read throws MistralCallError", async () => {
    const res = new Response("x", { status: 200 });
    res.json = async () => {
      throw new DOMException("body timed out", "TimeoutError");
    };
    await expect(
      callWithTool({ ...base, fetchImpl: (async () => res) as never }),
    ).rejects.toBeInstanceOf(MistralCallError);
  });

  it("429 then 200 retries and succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const replies = [json(429, { message: "slow down" }), toolReply('{"x":2}')];
    const fetchImpl = vi.fn(async () => replies.shift()!);
    const r = await callWithTool({ ...base, fetchImpl: fetchImpl as never, sleep });
    expect(r.kind).toBe("tool");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("onRetry is called once per retry with the status", async () => {
    const replies = [json(429, {}), json(503, {}), toolReply('{"x":2}')];
    const onRetry = vi.fn();
    await callWithTool({
      ...base,
      fetchImpl: (async () => replies.shift()!) as never,
      sleep: async () => {},
      onRetry,
    });
    expect(onRetry.mock.calls).toEqual([
      [429, 0],
      [503, 1],
    ]);
  });

  it("four 500s throw MistralCallError after three retries", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fetchImpl = vi.fn(async () => json(500, { message: "boom" }));
    await expect(
      callWithTool({ ...base, fetchImpl: fetchImpl as never, sleep }),
    ).rejects.toBeInstanceOf(MistralCallError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 6000, 18000]);
  });

  it("401 throws MistralFatalError without retry", async () => {
    const fetchImpl = vi.fn(async () => json(401, { message: "Unauthorized" }));
    await expect(callWithTool({ ...base, fetchImpl: fetchImpl as never })).rejects.toBeInstanceOf(
      MistralFatalError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("usage is read from the reply", async () => {
    const r = await callWithTool({
      ...base,
      fetchImpl: (async () =>
        toolReply("{}", { prompt_tokens: 1234, completion_tokens: 56 })) as never,
    });
    expect(r.usage).toEqual({ inputTokens: 1234, outputTokens: 56 });
  });
});

describe("usdFor", () => {
  it("usdFor prices a known model and falls back to 10 per million", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
    expect(usdFor("mistral-large-latest", usage)).toBeCloseTo(2.8, 6);
    expect(usdFor("mistral-small-latest", usage)).toBeCloseTo(0.75, 6);
    expect(usdFor("some-unknown-model", usage)).toBeCloseTo(20, 6);
  });
});

describe("timeouts and the fallback rule", () => {
  it("a request timeout is flagged timedOut and is worth a fallback", async () => {
    const err = await callWithTool({
      ...base,
      fetchImpl: (async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }) as never,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MistralCallError);
    expect((err as MistralCallError).timedOut).toBe(true);
    expect(isFallbackWorthy(err)).toBe(true);
  });

  it("a body read that times out is flagged timedOut", async () => {
    const res = new Response("x", { status: 200 });
    res.json = async () => {
      throw new DOMException("body timed out", "TimeoutError");
    };
    const err = await callWithTool({ ...base, fetchImpl: (async () => res) as never }).catch(
      (e) => e,
    );
    expect(isFallbackWorthy(err)).toBe(true);
  });

  it("a truncated reply is worth a fallback", () => {
    expect(isFallbackWorthy(new MistralCallError("reply truncated at max_tokens"))).toBe(true);
  });

  it("an HTTP error, a plain network error and a fatal key error are not", async () => {
    const http = await callWithTool({
      ...base,
      fetchImpl: (async () => json(400, { message: "bad" })) as never,
    }).catch((e) => e);
    expect(isFallbackWorthy(http)).toBe(false);
    const net = await callWithTool({
      ...base,
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as never,
    }).catch((e) => e);
    expect(isFallbackWorthy(net)).toBe(false);
    expect(isFallbackWorthy(new MistralFatalError("mistral 401"))).toBe(false);
    expect(isFallbackWorthy(new Error("x"))).toBe(false);
  });

  it("the client sends exactly the exported request constants", async () => {
    const fetchImpl = vi.fn(async (_u: unknown, init: { body: string }) => {
      void init;
      return toolReply("{}");
    });
    await callWithTool({ ...base, fetchImpl: fetchImpl as never });
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as { body: string }).body);
    expect(body.temperature).toBe(REQUEST_CONFIG.temperature);
    expect(body.top_p).toBe(REQUEST_CONFIG.top_p);
    expect(body.max_tokens).toBe(REQUEST_CONFIG.max_tokens);
    expect(body.tool_choice).toBe(REQUEST_CONFIG.tool_choice);
    expect(Object.isFrozen(REQUEST_CONFIG)).toBe(true);
  });
});
