// Ported from gloomberb's src/plugins/ibkr/flex/index.test.ts (bun:test) to
// vitest. Only the requestFlexStatement tests apply — the parseFlex* tests
// exercised code LaVega didn't vendor (see vendor/gloomberb/README.md).
import { afterEach, expect, test, vi } from "vitest";
import { loadFlexStatement, requestFlexStatement } from "./flexStatementClient.js";
import {
  clearPendingFlexReferences,
  FlexStatementRetryableError,
} from "./flexStatementClientImpl.js";
import { setHttpFetchTransport } from "../../../vendor/gloomberb/http-transport.js";
import { createImmediatePartnerBudget } from "../../partnerBudget/fakes.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  clearPendingFlexReferences();
  setHttpFetchTransport(null);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

test("uses the configured HTTP transport for statement requests", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  setHttpFetchTransport(async (url, init) => {
    requests.push({ url, init });
    return new Response(
      "<FlexStatementResponse><ReferenceCode>987654</ReferenceCode></FlexStatementResponse>",
      { status: 200 },
    );
  });

  await expect(
    requestFlexStatement({
      token: "secret-flex-token",
      partnerBudget: createImmediatePartnerBudget(),
      queryId: "12345",
      endpoint:
        "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest",
    }),
  ).resolves.toBe("987654");

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toContain("q=12345");
  expect(
    (requests[0]?.init?.headers as Record<string, string> | undefined)?.["User-Agent"],
  ).toBeTruthy();
});

test("adds request context to vague IBKR Flex errors without exposing the token", async () => {
  globalThis.fetch = (async () =>
    new Response(
      "<FlexStatementResponse><ErrorCode>1001</ErrorCode><ErrorMessage>Load failed</ErrorMessage></FlexStatementResponse>",
      { status: 200 },
    )) as unknown as typeof fetch;

  let message = "";
  try {
    await requestFlexStatement({
      token: "secret-flex-token",
      partnerBudget: createImmediatePartnerBudget(),
      queryId: "12345",
      endpoint:
        "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest",
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  expect(message).toContain(
    "IBKR Flex request failed while requesting the statement: IBKR error 1001: Load failed.",
  );
  expect(message).toContain("Endpoint SendRequest");
  expect(message).toContain("query ID 12345");
  expect(message).toContain("token configured");
  expect(message).toContain("Flex Web Service is enabled");
  expect(message).not.toContain("secret-flex-token");
});

test("deadline stops before the initial statement request", async () => {
  const fetch = vi.fn();
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  setHttpFetchTransport(fetch);

  await expect(
    requestFlexStatement({
      token: "secret-flex-token",
      partnerBudget: createImmediatePartnerBudget(),
      queryId: "12345",
      deadlineMs: 1_005_000,
    }),
  ).rejects.toThrow("IBKR Flex sync paused before the host time limit");
  expect(fetch).not.toHaveBeenCalled();
});

test("deadline stops before the initial Flex wait", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        "<FlexStatementResponse><ReferenceCode>987654</ReferenceCode></FlexStatementResponse>",
      ),
  );
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  setHttpFetchTransport(fetch);

  await expect(
    loadFlexStatement({
      token: "secret-flex-token",
      partnerBudget: createImmediatePartnerBudget(),
      queryId: "12345",
      deadlineMs: 1_006_000,
      initialWaitMs: 1_000,
    }),
  ).rejects.toThrow("IBKR Flex sync paused before the host time limit");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("deadline stops before a Flex poll request", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        "<FlexStatementResponse><ReferenceCode>987654</ReferenceCode></FlexStatementResponse>",
      ),
  );
  vi.spyOn(Date, "now")
    .mockReturnValueOnce(1_000_000)
    .mockReturnValueOnce(1_000_000)
    .mockReturnValue(1_000_002);
  setHttpFetchTransport(fetch);

  await expect(
    loadFlexStatement({
      token: "secret-flex-token",
      partnerBudget: createImmediatePartnerBudget(),
      queryId: "12345",
      deadlineMs: 1_005_001,
      initialWaitMs: 0,
    }),
  ).rejects.toThrow("IBKR Flex sync paused before the host time limit");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("deadline stops before a Flex poll sleep", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        "<FlexStatementResponse><ReferenceCode>987654</ReferenceCode></FlexStatementResponse>",
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        "<FlexStatementResponse><Status>Statement generation in progress</Status></FlexStatementResponse>",
      ),
    );
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  setHttpFetchTransport(fetch);

  await expect(
    loadFlexStatement({
      token: "secret-flex-token",
      partnerBudget: createImmediatePartnerBudget(),
      queryId: "12345",
      deadlineMs: 1_005_001,
      initialWaitMs: 0,
      pollDelayMs: 1,
    }),
  ).rejects.toThrow("IBKR Flex sync paused before the host time limit");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("fails fast when GetStatement returns a non-XML statement", async () => {
  let getCalls = 0;
  setHttpFetchTransport(async (url) => {
    if (url.includes("SendRequest")) {
      return new Response(
        "<FlexStatementResponse><ReferenceCode>987654</ReferenceCode></FlexStatementResponse>",
        { status: 200 },
      );
    }
    getCalls += 1;
    return new Response('"ClientAccountID","Symbol"\n"U1","AAPL"\n', { status: 200 });
  });

  await expect(
    loadFlexStatement({
      token: "secret-flex-token",
      partnerBudget: createImmediatePartnerBudget(),
      queryId: "12345",
      initialWaitMs: 0,
      pollDelayMs: 0,
    }),
  ).rejects.toThrow(/not XML.*Format to XML/s);
  expect(getCalls).toBe(1);
});

test.each([
  ["an HTTP 503 page", () => new Response("<html>Service Unavailable</html>", { status: 503 })],
  ["an empty body", () => new Response("", { status: 200 })],
])("retries after %s instead of blaming the query format", async (_label, outage) => {
  let getCalls = 0;
  setHttpFetchTransport(async (url) => {
    if (url.includes("SendRequest")) {
      return new Response(
        "<FlexStatementResponse><ReferenceCode>987654</ReferenceCode></FlexStatementResponse>",
        { status: 200 },
      );
    }
    getCalls += 1;
    return getCalls === 1
      ? outage()
      : new Response("<FlexQueryResponse><FlexStatements /></FlexQueryResponse>", { status: 200 });
  });

  await expect(
    loadFlexStatement({
      token: "secret-flex-token",
      partnerBudget: createImmediatePartnerBudget(),
      queryId: "12345",
      initialWaitMs: 0,
      pollDelayMs: 0,
    }),
  ).resolves.toContain("<FlexQueryResponse>");
  expect(getCalls).toBe(2);
});

test("does not blame the query format for an unexpected markup response", async () => {
  setHttpFetchTransport(async (url) =>
    url.includes("SendRequest")
      ? new Response(
          "<FlexStatementResponse><ReferenceCode>987654</ReferenceCode></FlexStatementResponse>",
          { status: 200 },
        )
      : new Response("<html>Login</html>", { status: 200 }),
  );

  await expect(
    loadFlexStatement({
      token: "secret-flex-token",
      partnerBudget: createImmediatePartnerBudget(),
      queryId: "12345",
      initialWaitMs: 0,
      pollDelayMs: 0,
    }),
  ).rejects.toThrow(/unexpected response/);
});

test("surfaces an IBKR error carried by a 5xx response instead of retrying", async () => {
  let getCalls = 0;
  setHttpFetchTransport(async (url) => {
    if (url.includes("SendRequest")) {
      return new Response(
        "<FlexStatementResponse><ReferenceCode>987654</ReferenceCode></FlexStatementResponse>",
        { status: 200 },
      );
    }
    getCalls += 1;
    return new Response(
      "<FlexStatementResponse><ErrorCode>1012</ErrorCode><ErrorMessage>Token has expired.</ErrorMessage></FlexStatementResponse>",
      { status: 500 },
    );
  });

  await expect(
    loadFlexStatement({
      token: "secret-flex-token",
      partnerBudget: createImmediatePartnerBudget(),
      queryId: "12345",
      initialWaitMs: 0,
      pollDelayMs: 0,
    }),
  ).rejects.toThrow(/IBKR error 1012: Token has expired/);
  expect(getCalls).toBe(1);
});

test("persists referenceCode across statement generation timeout and reuses it on retry", async () => {
  const urls: string[] = [];
  let ready = false;
  setHttpFetchTransport(async (url) => {
    urls.push(url);
    if (url.includes("SendRequest")) {
      return new Response(
        "<FlexStatementResponse><ReferenceCode>ref-persist-1</ReferenceCode></FlexStatementResponse>",
        { status: 200 },
      );
    }
    return ready
      ? new Response("<FlexQueryResponse><FlexStatements /></FlexQueryResponse>", { status: 200 })
      : new Response(
          "<FlexStatementResponse><Status>Statement generation in progress</Status></FlexStatementResponse>",
          { status: 200 },
        );
  });

  const config = {
    token: "secret-flex-token",
    partnerBudget: createImmediatePartnerBudget(),
    queryId: "12345",
    initialWaitMs: 0,
    pollDelayMs: 0,
    maxDownloadAttempts: 1,
  };

  let firstError: unknown;
  try {
    await loadFlexStatement(config);
  } catch (error) {
    firstError = error;
  }
  expect(firstError).toBeInstanceOf(FlexStatementRetryableError);
  expect((firstError as FlexStatementRetryableError).referenceCode).toBe("ref-persist-1");
  expect(urls.filter((u) => u.includes("SendRequest"))).toHaveLength(1);

  // Next call reuses the persisted referenceCode without calling SendRequest again.
  ready = true;
  urls.length = 0;
  await expect(loadFlexStatement(config)).resolves.toContain("<FlexQueryResponse>");
  expect(urls.filter((u) => u.includes("SendRequest"))).toHaveLength(0);
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain("GetStatement");
  expect(urls[0]).toContain("q=ref-persist-1");

  // Once succeeded, the persisted referenceCode is cleared and a new load calls SendRequest.
  urls.length = 0;
  await expect(loadFlexStatement(config)).resolves.toContain("<FlexQueryResponse>");
  expect(urls.filter((u) => u.includes("SendRequest"))).toHaveLength(1);
});

test("clears persisted referenceCode when GetStatement returns a permanent IBKR error", async () => {
  const urls: string[] = [];
  let mode: "in-progress" | "expired" | "ready" = "in-progress";
  setHttpFetchTransport(async (url) => {
    urls.push(url);
    if (url.includes("SendRequest")) {
      return new Response(
        "<FlexStatementResponse><ReferenceCode>ref-expiring</ReferenceCode></FlexStatementResponse>",
        { status: 200 },
      );
    }
    if (mode === "in-progress") {
      return new Response(
        "<FlexStatementResponse><Status>Statement generation in progress</Status></FlexStatementResponse>",
        { status: 200 },
      );
    }
    if (mode === "expired") {
      return new Response(
        "<FlexStatementResponse><ErrorCode>1018</ErrorCode><ErrorMessage>Invalid reference code</ErrorMessage></FlexStatementResponse>",
        { status: 200 },
      );
    }
    return new Response("<FlexQueryResponse><FlexStatements /></FlexQueryResponse>", {
      status: 200,
    });
  });

  const config = {
    token: "secret-flex-token",
    partnerBudget: createImmediatePartnerBudget(),
    queryId: "12345",
    initialWaitMs: 0,
    pollDelayMs: 0,
    maxDownloadAttempts: 1,
  };

  await expect(loadFlexStatement(config)).rejects.toThrow(/timed out/);

  mode = "expired";
  urls.length = 0;
  await expect(loadFlexStatement(config)).rejects.toThrow(/Invalid reference code/);
  expect(urls.filter((u) => u.includes("SendRequest"))).toHaveLength(0);

  // Permanent error cleared the cached referenceCode, so the next load sends a fresh SendRequest.
  mode = "ready";
  urls.length = 0;
  await expect(loadFlexStatement(config)).resolves.toContain("<FlexQueryResponse>");
  expect(urls.filter((u) => u.includes("SendRequest"))).toHaveLength(1);
});

test("explicit config.referenceCode skips SendRequest and polls GetStatement directly", async () => {
  const urls: string[] = [];
  setHttpFetchTransport(async (url) => {
    urls.push(url);
    return new Response("<FlexQueryResponse><FlexStatements /></FlexQueryResponse>", {
      status: 200,
    });
  });

  await expect(
    loadFlexStatement({
      token: "secret-flex-token",
      partnerBudget: createImmediatePartnerBudget(),
      queryId: "12345",
      referenceCode: "explicit-ref-42",
      initialWaitMs: 0,
      pollDelayMs: 0,
    }),
  ).resolves.toContain("<FlexQueryResponse>");
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain("GetStatement");
  expect(urls[0]).toContain("q=explicit-ref-42");
});
