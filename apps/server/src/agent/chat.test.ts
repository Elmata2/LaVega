import { beforeEach, expect, test, vi } from "vitest";
import { AGENTS } from "@lavega/core";
import { sanitizeKnownFacts } from "./facts.js";
const { chatWithSearchMock, createMistralProviderMock } = vi.hoisted(() => ({
  chatWithSearchMock: vi.fn(),
  createMistralProviderMock: vi.fn(),
}));
vi.mock("./mistral.js", () => ({
  createMistralProvider: createMistralProviderMock.mockImplementation(() => ({
    chatWithSearch: chatWithSearchMock,
  })),
}));
import { runChat } from "./chat.js";

beforeEach(() => {
  chatWithSearchMock.mockReset();
  createMistralProviderMock.mockClear();
});

test("runChat yields the full text and sends Mistral + tab context", async () => {
  chatWithSearchMock.mockImplementation(async ({ onDelta }) => {
    onDelta("Hallo wereld");
    return { text: "Hallo wereld", sources: [] };
  });
  const chunks: string[] = [];
  for await (const c of runChat({
    tab: "overview",
    messages: [{ role: "user", content: "hoi" }],
    context: { alertCount: 2 },
    apiKey: "k",
  }))
    chunks.push(c);
  expect(chunks).toEqual(["Hallo wereld"]); // one yield, not chopped into fake streamed pieces
  const arg = chatWithSearchMock.mock.calls[0][0];
  expect(JSON.stringify(arg.system)).toContain("alertCount"); // tab context injected into system
  expect(arg.system).toContain("LaVega — basis voor elke agent"); // instruction files, not a literal
  expect(arg.system).not.toContain("WAT LAVEGA AL WEET:"); // nothing learned yet -> no dangling header
  expect(arg.messages).toEqual([{ role: "user", content: "hoi" }]);
  expect(createMistralProviderMock).toHaveBeenCalledWith("k", "mistral-medium-latest");
});

test("chat reads what it has learned about how to answer, and nothing else", async () => {
  chatWithSearchMock.mockImplementation(async ({ onDelta }) => {
    onDelta("ok");
    return { text: "ok", sources: [] };
  });
  const facts = sanitizeKnownFacts(
    [
      { subject: "antwoord", key: "lengte", value: "kort", source: "user" },
      // Travel's namespace: it belongs to another agent and must not appear.
      { subject: "ING betaalpas", key: "fxFeePct", value: "1.4", source: "user" },
    ],
    AGENTS.chat,
  );
  for await (const _ of runChat({
    tab: "overview",
    messages: [{ role: "user", content: "hoi" }],
    context: {},
    facts,
    apiKey: "k",
  }))
    void _;
  const system: string = chatWithSearchMock.mock.calls[0][0].system;
  expect(system).toContain("- antwoord lengte = kort (door de gebruiker)");
  expect(system).not.toContain("fxFeePct");
});

test("runChat calls onUsage once with the provider's reported token counts, before yielding", async () => {
  chatWithSearchMock.mockResolvedValue({
    text: "ok",
    sources: [],
    usage: { input: 20, output: 8 },
  });
  const onUsage = vi.fn();
  for await (const _ of runChat({
    tab: "overview",
    messages: [{ role: "user", content: "hoi" }],
    context: {},
    apiKey: "k",
    onUsage,
  }))
    void _;
  expect(onUsage).toHaveBeenCalledTimes(1);
  expect(onUsage).toHaveBeenCalledWith({ inputTokens: 20, outputTokens: 8 });
});
