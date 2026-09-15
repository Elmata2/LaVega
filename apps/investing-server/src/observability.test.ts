import { expect, test, vi } from "vitest";
import { createProblemReporter, redactProblem } from "./observability.js";

const TOKEN = "SYNTHETIC_EXAMPLE_TOKEN";

test("an Authorization header loses its scheme and its credential", () => {
  expect(redactProblem(`Authorization: Bearer ${TOKEN}`)).not.toContain(TOKEN);
  expect(redactProblem(`Authorization: Bearer ${TOKEN}`)).toContain("Authorization");
});

test("credential redaction survives case, spacing and quoting variants", () => {
  const variants = [
    `authorization:Bearer ${TOKEN}`,
    `AUTHORIZATION =  bearer ${TOKEN}`,
    `{"authorization":"Bearer ${TOKEN}"}`,
    `{"Authorization": "Basic ${TOKEN}"}`,
    `authorization: ${TOKEN}`,
    `Bearer ${TOKEN}`,
    `api-key: ${TOKEN}`,
    `{"apiKey":"${TOKEN}"}`,
    `token=${TOKEN}`,
    `password='${TOKEN}'`,
    `https://user:${TOKEN}@broker.example.com/report`,
    `https://broker.example.com/report?api_key=${TOKEN}&format=json`,
    // Quotes that do not pair must not rescue the credential.
    `Authorization: Bearer "${TOKEN}"`,
    `Authorization: Basic '${TOKEN}"`,
    `api_key: '${TOKEN}"extra`,
    `Proxy-Authorization: Bearer ${TOKEN}`,
    `Set-Cookie: session=${TOKEN}; Path=/`,
    `{"client_secret":"${TOKEN}"}`,
    `refresh_token=${TOKEN}`,
    `x-api-key: ${TOKEN}`,
    `first: Bearer ${TOKEN}, second: Bearer ${TOKEN}`,
    `line one\nauthorization: Bearer ${TOKEN}\nline three`,
  ];

  for (const variant of variants) {
    expect(redactProblem(variant), variant).not.toContain(TOKEN);
  }
});

test("redaction keeps the diagnostic text around the credential", () => {
  const line = redactProblem(
    `ibkr: request failed (401) for https://broker.example.com/report?api_key=${TOKEN}&format=json`,
  );

  expect(line).toContain("ibkr: request failed (401)");
  expect(line).toContain("format=json");
  expect(line).toContain("[REDACTED]");
});

test("prose that merely mentions a credential word is left intact", () => {
  expect(redactProblem("ibkr: token expired, reconnect the account")).toBe(
    "ibkr: token expired, reconnect the account",
  );
  expect(redactProblem("trading212: password reset required")).toBe(
    "trading212: password reset required",
  );
});

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
