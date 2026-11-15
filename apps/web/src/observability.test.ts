import { afterEach, expect, test, vi } from "vitest";

const sentry = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/browser", () => sentry);

import { initWebSentry } from "./observability";

afterEach(() => vi.clearAllMocks());

test("init is a no-op without VITE_SENTRY_DSN", () => {
  expect(initWebSentry({ MODE: "production" })).toBe(false);
  expect(sentry.init).not.toHaveBeenCalled();
});

test("init tags the app and disables PII and enables no tracing when a DSN is set", () => {
  expect(
    initWebSentry({ VITE_SENTRY_DSN: "https://k@o0.ingest.sentry.io/1", MODE: "production" }),
  ).toBe(true);
  expect(sentry.init).toHaveBeenCalledWith(
    expect.objectContaining({
      environment: "production",
      sendDefaultPii: false,
      initialScope: { tags: { app: "web" } },
    }),
  );
  expect(sentry.init.mock.calls[0]?.[0]).not.toHaveProperty("tracesSampleRate");
});
