import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createMistralProvider, fetchWithTimeout } from "./mistral.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

test("complete() sends the right URL, auth header, model, and includes response_format when json:true", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      choices: [{ message: { content: "hoi" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  );

  const provider = createMistralProvider("sk-test", "mistral-small-latest");
  const res = await provider.complete({ system: "sys", user: "usr", json: true, maxTokens: 100 });

  expect(res).toEqual({ text: "hoi", usage: { input: 10, output: 5 } });

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
  expect(init.headers).toMatchObject({
    Authorization: "Bearer sk-test",
    "Content-Type": "application/json",
  });
  const body = JSON.parse(init.body);
  expect(body.model).toBe("mistral-small-latest");
  expect(body.messages).toEqual([
    { role: "system", content: "sys" },
    { role: "user", content: "usr" },
  ]);
  expect(body.max_tokens).toBe(100);
  expect(body.response_format).toEqual({ type: "json_object" });
});

test("complete() omits response_format entirely when json is falsy/omitted", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      choices: [{ message: { content: "x" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
  );

  const provider = createMistralProvider("sk-test", "mistral-small-latest");
  await provider.complete({ system: "sys", user: "usr", maxTokens: 100 });

  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect("response_format" in body).toBe(false);
});

test("complete() throws an Error with status and body text on a non-2xx response", async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 429,
    text: () => Promise.resolve("rate limited"),
  });

  const provider = createMistralProvider("sk-test", "mistral-small-latest");
  await expect(provider.complete({ system: "s", user: "u", maxTokens: 10 })).rejects.toThrow(
    "mistral chat 429: rate limited",
  );
});

test("ocrPdf() sends the right URL and body shape, omitting pages when not given", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      pages: [{ index: 0, markdown: "pagina 1" }],
      usage_info: { pages_processed: 1, doc_size_bytes: 123 },
    }),
  );

  const provider = createMistralProvider("sk-test", "mistral-small-latest");
  const res = await provider.ocrPdf({ pdfBase64: "AAAA" });

  expect(res).toEqual({ markdown: "pagina 1", pages: 1 });

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.mistral.ai/v1/ocr");
  const body = JSON.parse(init.body);
  expect(body.model).toBe("mistral-ocr-latest");
  expect(body.document).toEqual({
    type: "document_url",
    document_url: "data:application/pdf;base64,AAAA",
  });
  expect("pages" in body).toBe(false);
});

test("ocrPdf() includes pages when given, and joins multi-page markdown", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      pages: [
        { index: 0, markdown: "een" },
        { index: 1, markdown: "twee" },
      ],
      usage_info: { pages_processed: 2, doc_size_bytes: 456 },
    }),
  );

  const provider = createMistralProvider("sk-test", "mistral-small-latest");
  const res = await provider.ocrPdf({ pdfBase64: "BBBB", pages: "0-1" });

  expect(res).toEqual({ markdown: "een\n\ntwee", pages: 2 });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.pages).toBe("0-1");
});

test("ocrPdf() throws an Error with status and body text on a non-2xx response", async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 500,
    text: () => Promise.resolve("server error"),
  });

  const provider = createMistralProvider("sk-test", "mistral-small-latest");
  await expect(provider.ocrPdf({ pdfBase64: "AAAA" })).rejects.toThrow(
    "mistral ocr 500: server error",
  );
});

test("chatWithSearch() sends inline model+instructions+tools with a single-message array, no agent_id branch", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({ conversation_id: "c1", outputs: [{ content: "antwoord" }], usage: {} }),
  );

  const provider = createMistralProvider("sk-test", "mistral-medium-latest");
  const onDelta = vi.fn();
  const res = await provider.chatWithSearch({
    system: "sys",
    messages: [{ role: "user", content: "hallo" }],
    onDelta,
  });

  expect(res.text).toBe("antwoord");
  expect(onDelta).toHaveBeenCalledTimes(1);
  expect(onDelta).toHaveBeenCalledWith("antwoord");

  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.mistral.ai/v1/conversations");
  const body = JSON.parse(init.body);
  expect(body.model).toBe("mistral-medium-latest");
  expect(body.instructions).toBe("sys");
  expect(body.tools).toEqual([{ type: "web_search" }]);
  expect(body.stream).toBe(false);
  expect(body.inputs).toEqual([{ role: "user", content: "hallo" }]);
  expect("agent_id" in body).toBe(false);
});

test("chatWithSearch() reads usage from data.usage the same way complete() does", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      conversation_id: "c1",
      outputs: [{ content: "antwoord" }],
      usage: { prompt_tokens: 42, completion_tokens: 7 },
    }),
  );

  const provider = createMistralProvider("sk-test", "mistral-medium-latest");
  const res = await provider.chatWithSearch({
    system: "sys",
    messages: [{ role: "user", content: "hallo" }],
    onDelta: vi.fn(),
  });

  expect(res.usage).toEqual({ input: 42, output: 7 });
});

test("chatWithSearch() defaults usage to {input:0, output:0} when the response has no usage field", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({ conversation_id: "c1", outputs: [{ content: "antwoord" }] }),
  );

  const provider = createMistralProvider("sk-test", "mistral-medium-latest");
  const res = await provider.chatWithSearch({
    system: "sys",
    messages: [{ role: "user", content: "hallo" }],
    onDelta: vi.fn(),
  });

  expect(res.usage).toEqual({ input: 0, output: 0 });
});

test("chatWithSearch() always sends inputs as an array, even for a multi-turn history", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({ conversation_id: "c1", outputs: [{ content: "hoi" }], usage: {} }),
  );

  const provider = createMistralProvider("sk-test", "mistral-medium-latest");
  await provider.chatWithSearch({
    system: "sys",
    messages: [
      { role: "user", content: "een" },
      { role: "assistant", content: "twee" },
    ],
    onDelta: vi.fn(),
  });

  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.inputs).toEqual([
    { role: "user", content: "een" },
    { role: "assistant", content: "twee" },
  ]);
});

test("chatWithSearch() parses a nested references[] citation shape into sources, deduped by url", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      conversation_id: "c1",
      outputs: [
        {
          content: "zie bronnen",
          references: [
            { url: "https://a.example", title: "A" },
            { url: "https://a.example", title: "A dup" },
            { url: "https://b.example" },
          ],
        },
      ],
      usage: {},
    }),
  );

  const provider = createMistralProvider("sk-test", "mistral-medium-latest");
  const res = await provider.chatWithSearch({
    system: "sys",
    messages: [{ role: "user", content: "vraag" }],
    onDelta: vi.fn(),
  });

  expect(res.sources).toEqual([
    { url: "https://a.example", title: "A" },
    { url: "https://b.example", title: "https://b.example" },
  ]);
});

test("chatWithSearch() only reads text from message.output entries, not tool/function entries with their own content field", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      conversation_id: "c1",
      outputs: [
        { type: "tool.execution", content: "internal search trace, should not appear" },
        { type: "message.output", content: "final answer" },
      ],
      usage: {},
    }),
  );

  const provider = createMistralProvider("sk-test", "mistral-medium-latest");
  const res = await provider.chatWithSearch({
    system: "sys",
    messages: [{ role: "user", content: "vraag" }],
    onDelta: vi.fn(),
  });

  expect(res.text).toBe("final answer");
});

test("chatWithSearch() joins only the text blocks when content is the live API's array-of-blocks shape, skipping tool_reference blocks", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      conversation_id: "c1",
      outputs: [
        { type: "tool.execution", content: "internal search trace" },
        {
          type: "message.output",
          content: [
            { type: "text", text: "Het antwoord is " },
            {
              type: "tool_reference",
              tool: "web_search",
              url: "https://source.example",
              title: "Bron",
            },
            { type: "text", text: "42." },
          ],
        },
      ],
      usage: {},
    }),
  );

  const provider = createMistralProvider("sk-test", "mistral-medium-latest");
  const res = await provider.chatWithSearch({
    system: "sys",
    messages: [{ role: "user", content: "vraag" }],
    onDelta: vi.fn(),
  });

  expect(res.text).toBe("Het antwoord is 42.");
  expect(res.sources).toEqual([{ url: "https://source.example", title: "Bron" }]);
});

test("chatWithSearch() collects sources from a directly {url,title}-shaped output entry and from a bare array of {url,title} items", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      conversation_id: "c1",
      outputs: [
        { content: "antwoord" },
        { url: "https://direct.example", title: "Direct" },
        [
          { url: "https://bare-array.example", title: "Bare array" },
          { url: "https://bare-array-two.example" },
        ],
      ],
      usage: {},
    }),
  );

  const provider = createMistralProvider("sk-test", "mistral-medium-latest");
  const res = await provider.chatWithSearch({
    system: "sys",
    messages: [{ role: "user", content: "vraag" }],
    onDelta: vi.fn(),
  });

  expect(res.sources).toEqual([
    { url: "https://direct.example", title: "Direct" },
    { url: "https://bare-array.example", title: "Bare array" },
    { url: "https://bare-array-two.example", title: "https://bare-array-two.example" },
  ]);
});

test("chatWithSearch() throws an Error with status and body text on a non-2xx response", async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 400,
    text: () => Promise.resolve("bad request"),
  });

  const provider = createMistralProvider("sk-test", "mistral-medium-latest");
  await expect(
    provider.chatWithSearch({
      system: "s",
      messages: [{ role: "user", content: "u" }],
      onDelta: vi.fn(),
    }),
  ).rejects.toThrow("mistral conversation 400: bad request");
});

test("complete() passes an AbortSignal to fetch", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      choices: [{ message: { content: "hoi" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
  );

  const provider = createMistralProvider("sk-test", "mistral-small-latest");
  await provider.complete({ system: "s", user: "u", maxTokens: 10 });

  expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});

test("ocrPdf() passes an AbortSignal to fetch", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      pages: [{ index: 0, markdown: "pagina 1" }],
      usage_info: { pages_processed: 1, doc_size_bytes: 123 },
    }),
  );

  const provider = createMistralProvider("sk-test", "mistral-small-latest");
  await provider.ocrPdf({ pdfBase64: "AAAA" });

  expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});

test("chatWithSearch() passes an AbortSignal to fetch", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({ conversation_id: "c1", outputs: [{ content: "antwoord" }], usage: {} }),
  );

  const provider = createMistralProvider("sk-test", "mistral-medium-latest");
  await provider.chatWithSearch({
    system: "sys",
    messages: [{ role: "user", content: "hallo" }],
    onDelta: vi.fn(),
  });

  expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});

test("fetchWithTimeout() rejects with a formatted timeout Error when the abort signal fires", async () => {
  fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });
  });

  await expect(fetchWithTimeout("https://example.test", {}, 5, "chat")).rejects.toThrow(
    "mistral chat timeout after 5ms",
  );
});

test("complete() throws 'onverwachte respons' instead of a TypeError when choices is empty", async () => {
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock.mockResolvedValue(jsonResponse({ choices: [], usage: {} }));

  const provider = createMistralProvider("sk-test", "mistral-small-latest");
  await expect(provider.complete({ system: "s", user: "u", maxTokens: 10 })).rejects.toThrow(
    "onverwachte respons",
  );
  expect(errSpy).toHaveBeenCalled();
  errSpy.mockRestore();
});

test("ocrPdf() throws 'onverwachte respons' instead of a TypeError when the response has no pages", async () => {
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock.mockResolvedValue(jsonResponse({ usage_info: { pages_processed: 0 } }));

  const provider = createMistralProvider("sk-test", "mistral-small-latest");
  await expect(provider.ocrPdf({ pdfBase64: "AAAA" })).rejects.toThrow("onverwachte respons");
  expect(errSpy).toHaveBeenCalled();
  errSpy.mockRestore();
});

test("fetchWithTimeout() rethrows a non-abort fetch error unchanged", async () => {
  const boom = new Error("boom");
  fetchMock.mockRejectedValue(boom);

  await expect(fetchWithTimeout("https://example.test", {}, 1000, "chat")).rejects.toBe(boom);
});
