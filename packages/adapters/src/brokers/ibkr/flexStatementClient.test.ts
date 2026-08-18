// Ported from gloomberb's src/plugins/ibkr/flex/index.test.ts (bun:test) to
// vitest. Only the requestFlexStatement tests apply — the parseFlex* tests
// exercised code LaVega didn't vendor (see vendor/gloomberb/README.md).
import { afterEach, expect, test } from "vitest";
import { requestFlexStatement } from "./flexStatementClient.js";
import { setHttpFetchTransport } from "../../../vendor/gloomberb/http-transport.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  setHttpFetchTransport(null);
  globalThis.fetch = originalFetch;
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

  await expect(requestFlexStatement({
    token: "secret-flex-token",
    queryId: "12345",
    endpoint: "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest",
  })).resolves.toBe("987654");

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toContain("q=12345");
  expect((requests[0]?.init?.headers as Record<string, string> | undefined)?.["User-Agent"]).toBeTruthy();
});

test("adds request context to vague IBKR Flex errors without exposing the token", async () => {
  globalThis.fetch = (async () => new Response(
    "<FlexStatementResponse><ErrorCode>1001</ErrorCode><ErrorMessage>Load failed</ErrorMessage></FlexStatementResponse>",
    { status: 200 },
  )) as unknown as typeof fetch;

  let message = "";
  try {
    await requestFlexStatement({
      token: "secret-flex-token",
      queryId: "12345",
      endpoint: "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest",
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  expect(message).toContain("IBKR Flex request failed while requesting the statement: IBKR error 1001: Load failed.");
  expect(message).toContain("Endpoint SendRequest");
  expect(message).toContain("query ID 12345");
  expect(message).toContain("token configured");
  expect(message).toContain("Flex Web Service is enabled");
  expect(message).not.toContain("secret-flex-token");
});
