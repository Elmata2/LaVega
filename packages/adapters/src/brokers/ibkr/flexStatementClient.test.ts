// Ported from gloomberb's src/plugins/ibkr/flex/index.test.ts (bun:test) to
// vitest. Only the requestFlexStatement tests apply — the parseFlex* tests
// exercised code LaVega didn't vendor (see vendor/gloomberb/README.md).
import { afterEach, expect, test, vi } from "vitest";
import { loadFlexStatement, requestFlexStatement } from "./flexStatementClient.js";
import { setHttpFetchTransport } from "../../../vendor/gloomberb/http-transport.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
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
      queryId: "12345",
      deadlineMs: 1_005_001,
      initialWaitMs: 0,
      pollDelayMs: 1,
    }),
  ).rejects.toThrow("IBKR Flex sync paused before the host time limit");
  expect(fetch).toHaveBeenCalledTimes(2);
});
