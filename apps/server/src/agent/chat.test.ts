import { beforeEach, expect, test, vi } from "vitest";
import { AGENTS } from "@lavega/core";
import { sanitizeKnownFacts } from "./facts.js";
const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { stream: streamMock }; } }));
import { runChat } from "./chat.js";

function fakeStream(events: unknown[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; } };
}
beforeEach(() => streamMock.mockReset());

test("runChat yields only text deltas and sends Sonnet 5 + web_search + tab context", async () => {
  streamMock.mockReturnValue(fakeStream([
    { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "hmm" } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "Hallo" } },
    { type: "content_block_delta", delta: { type: "text_delta", text: " wereld" } },
  ]));
  const chunks: string[] = [];
  for await (const c of runChat({ tab: "overview", messages: [{ role: "user", content: "hoi" }], context: { alertCount: 2 }, apiKey: "k" })) chunks.push(c);
  expect(chunks.join("")).toBe("Hallo wereld");
  const arg = streamMock.mock.calls[0][0];
  expect(arg.model).toBe("claude-sonnet-5");
  expect(arg.tools.some((t: { type: string }) => String(t.type).startsWith("web_search"))).toBe(true);
  expect(JSON.stringify(arg.system)).toContain("alertCount"); // tab context injected into system
  expect(arg.system).toContain("LaVega — basis voor elke agent"); // instruction files, not a literal
  expect(arg.system).not.toContain("WAT LAVEGA AL WEET:"); // nothing learned yet -> no dangling header
});

test("chat reads what it has learned about how to answer, and nothing else", async () => {
  streamMock.mockReturnValue(fakeStream([{ type: "content_block_delta", delta: { type: "text_delta", text: "ok" } }]));
  const facts = sanitizeKnownFacts(
    [
      { subject: "antwoord", key: "lengte", value: "kort", source: "user" },
      // Travel's namespace: it belongs to another agent and must not appear.
      { subject: "ING betaalpas", key: "fxFeePct", value: "1.4", source: "user" },
    ],
    AGENTS.chat,
  );
  for await (const _ of runChat({ tab: "overview", messages: [{ role: "user", content: "hoi" }], context: {}, facts, apiKey: "k" })) void _;
  const system: string = streamMock.mock.calls[0][0].system;
  expect(system).toContain("- antwoord lengte = kort (door de gebruiker)");
  expect(system).not.toContain("fxFeePct");
});
