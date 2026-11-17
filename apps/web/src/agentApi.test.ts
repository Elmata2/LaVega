import { afterEach, expect, test, vi } from "vitest";
import { agentApi } from "./api.js";

afterEach(() => vi.unstubAllGlobals());

test("a 401 from settings and feed is signedOut, not an error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 401 })),
  );
  expect(await agentApi.getSettings()).toEqual({ kind: "signedOut" });
  expect(await agentApi.listFeed({})).toEqual({ kind: "signedOut" });
});

test("createLinkCode posts the AI consent in the body", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ code: "LV-ABCD2345", expiresAt: "x", number: null }), {
        status: 200,
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(await agentApi.createLinkCode(true)).toMatchObject({ kind: "ok", code: "LV-ABCD2345" });
  const init = (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1];
  expect(JSON.parse(init.body)).toEqual({ aiConsent: true });
});
