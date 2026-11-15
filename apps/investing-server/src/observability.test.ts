import { expect, test, vi } from "vitest";
import { createProblemReporter } from "./observability.js";

const TOKEN = "SYNTHETIC_EXAMPLE_TOKEN";

test("the reporter redacts the broker field as well as the problems", () => {
  const write = vi.fn();
  const reporter = createProblemReporter({ write });

  reporter({
    source: "broker-sync",
    broker: `ibkr (token=${TOKEN})`,
    problems: [`Authorization: Bearer ${TOKEN}`],
  });

  expect(write).toHaveBeenCalledOnce();
  expect(write.mock.calls[0]?.[0]).not.toContain(TOKEN);
});

test("the Sentry payload carries the same redacted text as the log line", () => {
  const write = vi.fn();
  const sentry = { captureException: vi.fn() };
  const reporter = createProblemReporter({ write, sentry, dsn: "https://example.invalid/1" });

  reporter({ source: "dashboard-read", problems: [`Authorization: Bearer ${TOKEN}`] });

  expect(JSON.stringify(sentry.captureException.mock.calls[0]?.[1])).not.toContain(TOKEN);
});
