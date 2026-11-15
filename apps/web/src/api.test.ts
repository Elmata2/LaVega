// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  apiErrorMessage,
  apiErrorMessageIn,
  categorizeTxs,
  dispatchSseRecord,
  SIGNED_OUT_MESSAGE,
  type ChatStreamHandlers,
} from "./api.js";

/* categorizeTxs now resolves its locale via readAppLocale(), which reads
 * `document.cookie` — the Node environment has no `document`, so without
 * jsdom every assertion below would silently start reading English instead
 * of the Dutch this file was written against (see testSetup.ts's own
 * warning about this exact trap). jsdom + testSetup's beforeEach pins the
 * cookie to "nl", so the Dutch-expecting assertions below are unchanged. */

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a 401 rejects with the signed-out message, not the body's own error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    }),
  );
  await expect(categorizeTxs([])).rejects.toThrow(SIGNED_OUT_MESSAGE);
});

test("a non-401 error still prefers the body's {error} over the status fallback", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "server kapot" }),
    }),
  );
  await expect(categorizeTxs([])).rejects.toThrow("server kapot");
});

test("a non-401 error with an unparseable body falls back to the status message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("not json");
      },
    }),
  );
  await expect(categorizeTxs([])).rejects.toThrow("Verzoek mislukt (500).");
});

test("apiErrorMessage reads a problems list the way it reads an error string", async () => {
  const res = new Response(
    JSON.stringify({ problems: ["Bevestig met confirm", "niet terug te draaien"] }),
    {
      status: 400,
      headers: { "content-type": "application/json" },
    },
  );
  expect(await apiErrorMessage(res)).toBe("Bevestig met confirm niet terug te draaien");
});

test("apiErrorMessageIn localizes a recognized code, both languages from the same body", async () => {
  const body = { error: "De AI-limiet voor vandaag is bereikt.", code: "ai-budget-day" };
  const resEn = new Response(JSON.stringify(body), {
    status: 429,
    headers: { "content-type": "application/json" },
  });
  expect(await apiErrorMessageIn("en", resEn)).toBe("Today's AI limit has been reached.");

  const resNl = new Response(JSON.stringify(body), {
    status: 429,
    headers: { "content-type": "application/json" },
  });
  // Byte-identical to the server's own `error` string — proves no Dutch
  // regression: this is exactly what the old apiErrorMessage would have
  // returned for the same body, before `code` existed.
  expect(await apiErrorMessageIn("nl", resNl)).toBe("De AI-limiet voor vandaag is bereikt.");
});

test("dispatchSseRecord: a code-only record (no data: line) fires no handler at all", () => {
  const onChunk = vi.fn();
  const onError = vi.fn();
  const onDone = vi.fn();
  const handlers: ChatStreamHandlers = { onChunk, onError, onDone };

  dispatchSseRecord("code: ai-fault", handlers);

  expect(onChunk).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});

test("dispatchSseRecord: an error record's code: line reaches onError as the second argument, not the message", () => {
  const onError = vi.fn();
  const handlers: ChatStreamHandlers = { onChunk: vi.fn(), onError };

  dispatchSseRecord(
    "event: error\ndata: De AI-limiet voor vandaag is bereikt.\ncode: ai-budget-day",
    handlers,
  );

  expect(onError).toHaveBeenCalledWith("De AI-limiet voor vandaag is bereikt.", "ai-budget-day");
});
