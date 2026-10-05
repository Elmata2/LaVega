import { afterEach, expect, test, vi } from "vitest";

const sentry = vi.hoisted(() => {
  const state = { client: undefined as object | undefined };
  return {
    state,
    init: vi.fn((_options?: unknown) => {
      state.client = {};
    }),
    captureException: vi.fn(),
    flush: vi.fn(async () => true),
    getClient: vi.fn(() => state.client),
  };
});
vi.mock("@sentry/node", () => sentry);

import { initServerSentry, serverErrorResponse } from "./observability.js";

afterEach(() => {
  vi.clearAllMocks();
  sentry.state.client = undefined;
});

test("init is a no-op without SENTRY_DSN", () => {
  expect(initServerSentry({})).toBe(false);
  expect(sentry.init).not.toHaveBeenCalled();
});

test("init passes scrubbing options and the vercel environment when a DSN is set", () => {
  const dsn = "https://k@o0.ingest.sentry.io/1";
  expect(initServerSentry({ SENTRY_DSN: dsn, VERCEL_ENV: "preview" })).toBe(true);
  expect(sentry.init).toHaveBeenCalledOnce();
  const options = sentry.init.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
  expect(options).toMatchObject({
    environment: "preview",
    sendDefaultPii: false,
  });
  expect(options).not.toHaveProperty("tracesSampleRate");
  expect(typeof options.beforeSend).toBe("function");
});

test("onError captures, flushes and still answers with Hono's 500", async () => {
  initServerSentry({ SENTRY_DSN: "https://k@o0.ingest.sentry.io/1" });
  const error = new Error("boom");
  const response = await serverErrorResponse(error);
  expect(sentry.captureException).toHaveBeenCalledWith(error);
  expect(sentry.flush).toHaveBeenCalledWith(2000);
  expect(response.status).toBe(500);
  expect(await response.text()).toBe("Internal Server Error");
});

test("HTTPException keeps its own response and is not reported", async () => {
  const { HTTPException } = await import("hono/http-exception");
  initServerSentry({ SENTRY_DSN: "https://k@o0.ingest.sentry.io/1" });
  const response = await serverErrorResponse(new HTTPException(401, { message: "nope" }));
  expect(response.status).toBe(401);
  expect(sentry.captureException).not.toHaveBeenCalled();
});

test("without a DSN the error response is unchanged and nothing is captured", async () => {
  const response = await serverErrorResponse(new Error("boom"));
  expect(response.status).toBe(500);
  expect(sentry.captureException).not.toHaveBeenCalled();
  expect(sentry.flush).not.toHaveBeenCalled();
});
