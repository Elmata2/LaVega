import { expect, test } from "vitest";
import { normalisePath, scrubBreadcrumb, scrubEvent, sentryOptions } from "./sentryScrub.js";

const IBAN = "NL91ABNA0417164300";
const EMAIL = "jan.jansen@example.nl";
const VAULT = '{"accounts":[{"iban":"NL91ABNA0417164300","balance":1234.56}]}';

test("without a DSN there are no options, so nothing is initialised", () => {
  expect(sentryOptions({ dsn: undefined, environment: "production", app: "web" })).toBeUndefined();
  expect(sentryOptions({ dsn: "  ", environment: "production", app: "web" })).toBeUndefined();
});

test("with a DSN the options are errors-only, carry no PII and enable no tracing", () => {
  const options = sentryOptions({
    dsn: "https://k@o0.ingest.de.sentry.io/1",
    environment: "preview",
    app: "server",
  });
  expect(options).toMatchObject({
    dsn: "https://k@o0.ingest.de.sentry.io/1",
    environment: "preview",
    sendDefaultPii: false,
    initialScope: { tags: { app: "server" } },
  });
  expect(options).toMatchObject({ sendClientReports: false });
  expect(options?.beforeSendTransaction()).toBeNull();
  const kept = options?.integrations([{ name: "BrowserSession" }, { name: "GlobalHandlers" }]);
  expect(kept).toEqual([{ name: "GlobalHandlers" }]);
  expect(options).not.toHaveProperty("tracesSampleRate");
  expect(options).not.toHaveProperty("tracesSampler");
});

test("normalisePath replaces ids, emails, IBANs, digit and long segments", () => {
  expect(normalisePath("/api/accounts/NL91ABNA0417164300/tx?x=1#h")).toBe("/api/accounts/:id/tx");
  expect(normalisePath("/api/users/jan@example.nl")).toBe("/api/users/:id");
  expect(normalisePath("/a/123/b")).toBe("/a/:id/b");
  expect(normalisePath(`/x/${"a".repeat(25)}`)).toBe("/x/:id");
  expect(normalisePath("/api/eb/callback")).toBe("/api/eb/callback");
  expect(normalisePath("https://www.lavega.dev/api/accounts/42/tx?q=1")).toBe(
    "https://www.lavega.dev/api/accounts/:id/tx",
  );
});

const junkEvent = () => ({
  event_id: "abc123",
  timestamp: 1700000000,
  level: "error",
  platform: "javascript",
  environment: "production",
  release: "1.2.3",
  server_name: "host-1",
  message: "Albert Heijn €1.234,56",
  tags: { app: "web", customer: "Albert Heijn", runtime: "node" },
  user: { email: EMAIL, ip_address: "1.2.3.4", id: "u1" },
  fingerprint: ["Albert Heijn", IBAN],
  transaction: `GET /api/accounts/${IBAN}/tx`,
  modules: { secret: "1.0.0" },
  sdk: { name: "sentry.javascript.browser", version: "10.0.0", integrations: ["X"], packages: [] },
  extra: { __serialized__: { iban: IBAN }, detail: "Albert Heijn" },
  contexts: {
    browser: { name: "Chrome", version: "120", blob: "Albert Heijn" },
    os: { name: "macOS", version: "14", kernel: "x" },
    runtime: { name: "node", version: "22" },
    app: { app_name: "Albert Heijn" },
    state: { vault: VAULT },
  },
  request: {
    method: "GET",
    url: `https://www.lavega.dev/api/accounts/${IBAN}/tx?x=1#frag`,
    query_string: "x=1",
    data: VAULT,
    cookies: { session: "SECRET" },
    headers: { Cookie: "session=SECRET", "User-Agent": "Mozilla" },
  },
  exception: {
    values: [
      {
        type: "SyntaxError",
        value: `Unexpected token in JSON at position 2: ${VAULT}`,
        module: "app",
        thread_id: 1,
        mechanism: { type: "onerror", handled: false, data: { note: "Albert Heijn" } },
        stacktrace: {
          frames: [
            {
              filename: "/app/dist/a.js",
              function: "parse",
              lineno: 3,
              colno: 9,
              in_app: true,
              vars: { vault: VAULT },
              context_line: `const x = "${VAULT}"`,
              pre_context: ["Albert Heijn"],
              post_context: ["€1.234,56"],
              abs_path: `https://x.test/a.js?iban=${IBAN}`,
              module: "a",
            },
          ],
        },
      },
      {
        type: "Error",
        value: `Failed for "Albert Heijn" amount €1.234,56`,
        stacktrace: { frames: [{ filename: "b.js" }] },
      },
      {
        type: "Error",
        value: `Row 12345 ${EMAIL} ${IBAN} paid €1.234,56 or 1234.56 or -45,10 or EUR 12 token=SECRET`,
      },
    ],
  },
  breadcrumbs: [
    { category: "console", message: "Albert Heijn", level: "log" },
    { category: "ui.click", message: "button#pay Albert Heijn" },
    { category: "ui.input", message: "input[name=iban]" },
    {
      category: "fetch",
      type: "http",
      timestamp: 1,
      message: "request to jan.jansen@example.nl failed",
      data: {
        url: `https://www.lavega.dev/api/accounts/${IBAN}/tx?x=1`,
        method: "POST",
        status_code: 500,
        request_body_size: 10,
        body: VAULT,
      },
    },
    { category: "navigation", data: { from: "/accounts/42", to: "/accounts/43?x=1" } },
    { category: "custom", message: "Albert Heijn", data: { a: 1 } },
  ],
});

test("scrubEvent rebuilds a minimal event from an allowlist", () => {
  const event = scrubEvent(junkEvent());
  const dump = JSON.stringify(event);
  for (const secret of [
    IBAN,
    EMAIL,
    "SECRET",
    "1.2.3.4",
    "Albert Heijn",
    "1.234,56",
    "1234.56",
    "-45,10",
    "12345",
    "EUR 12",
    "balance",
    "x=1",
    "frag",
    "host-1",
    "session",
    "vault",
    "context_line",
  ]) {
    expect(dump, secret).not.toContain(secret);
  }
  expect(Object.keys(event).sort()).toEqual(
    [
      "environment",
      "event_id",
      "exception",
      "contexts",
      "level",
      "platform",
      "release",
      "request",
      "sdk",
      "tags",
      "timestamp",
      "breadcrumbs",
    ].sort(),
  );
  expect(event.tags).toEqual({ app: "web" });
  expect(event.sdk).toEqual({ name: "sentry.javascript.browser", version: "10.0.0" });
  expect(event.contexts).toEqual({
    browser: { name: "Chrome", version: "120" },
    os: { name: "macOS", version: "14" },
    runtime: { name: "node", version: "22" },
  });
  expect(event.request).toEqual({
    method: "GET",
    url: "https://www.lavega.dev/api/accounts/:id/tx",
  });

  const [syntax, quoted, plain] = event.exception?.values ?? [];
  expect(Object.keys(syntax ?? {}).sort()).toEqual(["mechanism", "stacktrace", "type", "value"]);
  expect(syntax?.value).toBe("[redacted: message contained input data]");
  expect(syntax?.mechanism).toEqual({ type: "onerror", handled: false });
  expect(syntax?.stacktrace?.frames).toEqual([
    { filename: "/app/dist/a.js", function: "parse", lineno: 3, colno: 9, in_app: true },
  ]);
  expect(quoted?.value).toBe(`Failed for "…" amount [AMOUNT]`);
  expect(quoted?.stacktrace?.frames).toEqual([{ filename: "b.js" }]);
  expect(plain?.value).not.toMatch(/\d{4}/);

  expect(event.breadcrumbs).toEqual([
    {
      category: "fetch",
      type: "http",
      timestamp: 1,
      message: "request to [EMAIL] failed",
      data: { url: "https://www.lavega.dev/api/accounts/:id/tx", method: "POST", status_code: 500 },
    },
    { category: "navigation", data: { from: "/accounts/:id", to: "/accounts/:id" } },
    { category: "custom" },
  ]);
});

test("every quoted string is replaced, short or long", () => {
  const quote = (value: string) =>
    scrubEvent({ exception: { values: [{ type: "Error", value }] } });
  expect(quote(`Cannot read "foo" of undefined`).exception?.values?.[0]?.value).toBe(
    `Cannot read "…" of undefined`,
  );
  expect(quote(`bad 'Albert Heijn Amsterdam' row`).exception?.values?.[0]?.value).toBe(
    'bad "…" row',
  );
});

test("an event with nothing allowlisted collapses to nothing but what it had", () => {
  expect(scrubEvent({ extra: { a: 1 }, user: { id: "1" } })).toEqual({});
});

test("scrubBreadcrumb drops console and ui breadcrumbs and keeps only safe data", () => {
  expect(scrubBreadcrumb({ category: "console", message: "hi" })).toBeNull();
  expect(scrubBreadcrumb({ category: "ui.click", message: "x" })).toBeNull();
  expect(scrubBreadcrumb({ category: "ui.input", message: "x" })).toBeNull();
  expect(
    scrubBreadcrumb({ category: "xhr", data: { url: "/a/1?x=1", method: "GET", body: "x" } })?.data,
  ).toEqual({ url: "/a/:id", method: "GET" });
});

test("normalisePath keeps only lowercase static words, so tickers and ids are masked", () => {
  expect(normalisePath("/positions/AAPL")).toBe("/positions/:id");
  expect(normalisePath("/positions/ASML.AS")).toBe("/positions/:id");
  expect(normalisePath("/positions/BRK.B")).toBe("/positions/:id");
  expect(normalisePath("/positions/asml")).toBe("/positions/asml");
  expect(normalisePath("/api/v1/n8n/x_y")).toBe("/api/:id/:id/:id");
  expect(normalisePath("https://www.lavega.dev/positions/ASML.AS?x=1")).toBe(
    "https://www.lavega.dev/positions/:id",
  );
  expect(normalisePath("/agents/bill-ackman")).toBe("/agents/bill-ackman");
  expect(
    scrubBreadcrumb({
      category: "navigation",
      data: { from: "/positions/SKX", to: "/positions/AAPL" },
    })?.data,
  ).toEqual({
    from: "/positions/:id",
    to: "/positions/:id",
  });
});

test("exception values lose quoted strings and ticker symbols but keep the diagnosis", () => {
  const value = (v: string) =>
    scrubEvent({ exception: { values: [{ type: "Error", value: v }] } }).exception?.values?.[0]
      ?.value;
  expect(value("No Yahoo history for ASML.AS")).toBe("No Yahoo history for [SYMBOL]");
  expect(value("Cannot read properties of undefined (reading 'Jumbo')")).toBe(
    'Cannot read properties of undefined (reading "…")',
  );
  expect(value("No listing found on Yahoo Finance for SKX (tried 1 symbol)")).toBe(
    "No listing found on Yahoo Finance for [SYMBOL] (tried 1 symbol)",
  );
  expect(value("Sync failed for BRK.B and AAPL")).toBe("Sync failed for [SYMBOL] and [SYMBOL]");
  expect(value("fetch https://api.example.com/positions/AAPL failed: HTTP 500 JSON EUR")).toBe(
    "fetch https://api.example.com/positions/[SYMBOL] failed: HTTP 500 JSON EUR",
  );
  expect(value('bad `tpl` and "x"')).toBe('bad "…" and "…"');
});
