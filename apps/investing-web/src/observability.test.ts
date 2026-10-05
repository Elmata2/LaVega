import { afterEach, expect, test, vi } from "vitest";

const sentry = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("@sentry/browser", () => sentry);

import { initInvestingWebSentry } from "./observability";

afterEach(() => vi.clearAllMocks());

test("init is a no-op without VITE_SENTRY_DSN", () => {
  expect(initInvestingWebSentry({ MODE: "production" })).toBe(false);
  expect(sentry.init).not.toHaveBeenCalled();
});

test("init tags the app and disables PII and enables no tracing when a DSN is set", () => {
  expect(
    initInvestingWebSentry({ VITE_SENTRY_DSN: "https://k@o0.ingest.sentry.io/1", MODE: "preview" }),
  ).toBe(true);
  expect(sentry.init).toHaveBeenCalledWith(
    expect.objectContaining({
      environment: "preview",
      sendDefaultPii: false,
      initialScope: { tags: { app: "investing-web" } },
    }),
  );
  expect(sentry.init.mock.calls[0]?.[0]).not.toHaveProperty("tracesSampleRate");
});
