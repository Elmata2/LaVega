import { afterEach, expect, test, vi } from "vitest";
import {
  AssistantStepError,
  CLIENT_TIMEOUT_MS,
  createAssistantStep as createStep,
  fetchAssistantConfigured,
} from "./chatClient.js";
import type { ChatLocale } from "@lavega/core";

const createAssistantStep = (
  language: ChatLocale,
  opts: Partial<Parameters<typeof createStep>[1]> = {},
) => createStep(language, { today: "2026-11-18", enabled: () => true, ...opts });

afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const messages = [{ role: "user" as const, content: "Wat gaf ik gisteren uit?" }];

test("posts exactly {locale, noTools, messages} to the assistant route, with the session cookie", async () => {
  const fetchMock = vi.fn(async () => json(200, { type: "answer", text: "Hoi" }));
  vi.stubGlobal("fetch", fetchMock);
  const out = await createAssistantStep("nl")({ messages, noTools: false });
  expect(out).toEqual({ type: "answer", text: "Hoi" });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url.endsWith("/api/agent/assistant")).toBe(true);
  expect(init.method).toBe("POST");
  expect(init.credentials).toBe("same-origin");
  expect(JSON.parse(init.body as string)).toEqual({
    locale: "nl",
    noTools: false,
    today: "2026-11-18",
    messages,
  });
});

test("returns tool calls as the server sent them", async () => {
  const calls = [{ id: "abc123XYZ", name: "balances", args: {} }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(200, { type: "tool_calls", calls })),
  );
  expect(await createAssistantStep("en")({ messages, noTools: false })).toEqual({
    type: "tool_calls",
    calls,
  });
});

test.each([
  [503, { code: "assistant-not-configured" }, "not-configured"],
  [401, { error: "unauthorized" }, "signed-out"],
  [429, { code: "assistant-rate-limited-hour" }, "rate"],
  [429, { code: "assistant-rate-limited-local" }, "rate"],
  [429, { code: "ai-rate-limited-global" }, "rate"],
  [429, { code: "ai-budget-day" }, "budget"],
  [429, { code: "ai-budget-month" }, "budget"],
  [502, { code: "ai-fault" }, "unavailable"],
  [500, {}, "unavailable"],
  [400, { code: "assistant-bad-input" }, "unavailable"],
] as const)("a %s answer with %j is reported as %s", async (status, body, reason) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(status, body)),
  );
  const err = await createAssistantStep("nl")({ messages, noTools: false }).catch(
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AssistantStepError);
  expect((err as AssistantStepError).reason).toBe(reason);
});

test("no network and a timeout are reported as offline", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
  );
  const err = await createAssistantStep("nl")({ messages, noTools: false }).catch(
    (e: unknown) => e,
  );
  expect((err as AssistantStepError).reason).toBe("offline");
});

test("a body that is not a step is reported as unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(200, { type: "poem" })),
  );
  const err = await createAssistantStep("nl")({ messages, noTools: false }).catch(
    (e: unknown) => e,
  );
  expect((err as AssistantStepError).reason).toBe("unavailable");
});

test("configured answers from the public status route; a failed check does not block", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(200, { configured: true })),
  );
  expect(await fetchAssistantConfigured()).toBe(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(200, { configured: false })),
  );
  expect(await fetchAssistantConfigured()).toBe(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Promise.reject(new Error("offline"))),
  );
  expect(await fetchAssistantConfigured()).toBe(true);
});

test("C2: the client waits a little longer than the server's own 60 s provider timeout", () => {
  expect(CLIENT_TIMEOUT_MS).toBeGreaterThan(60_000);
  expect(CLIENT_TIMEOUT_MS).toBeLessThanOrEqual(70_000);
});

test("A1: consent is read at send time: switched off means no request at all", async () => {
  const fetchMock = vi.fn(async () => json(200, { type: "answer", text: "x" }));
  vi.stubGlobal("fetch", fetchMock);
  let on = true;
  const step = createAssistantStep("nl", { enabled: () => on });
  await step({ messages, noTools: false });
  on = false;
  const err = await step({ messages, noTools: false }).catch((e: unknown) => e);
  expect((err as AssistantStepError).reason).toBe("cancelled");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("A1: an aborted question sends nothing, and aborting in flight ends the pending request", async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn(
    (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal!.addEventListener("abort", () =>
          rej(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const step = createAssistantStep("nl", { signal: controller.signal });
  const pending = step({ messages, noTools: false }).catch((e: unknown) => e);
  controller.abort();
  expect(((await pending) as AssistantStepError).reason).toBe("cancelled");
  const after = await step({ messages, noTools: false }).catch((e: unknown) => e);
  expect((after as AssistantStepError).reason).toBe("cancelled");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("a timeout has its own reason", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Promise.reject(new DOMException("t", "TimeoutError"))),
  );
  const err = await createAssistantStep("nl")({ messages, noTools: false }).catch(
    (e: unknown) => e,
  );
  expect((err as AssistantStepError).reason).toBe("timeout");
});
