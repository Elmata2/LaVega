import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";
import type { EbConfig } from "./config.js";

/* eb-routes.ts had no test file at all, which is the likeliest reason the
 * unvalidated OAuth `state` survived: the callback created a state, deleted it,
 * and never once read it back. */

const { loadConfigMock, ebMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn<() => EbConfig>(),
  ebMock: vi.fn(),
}));

vi.mock("./config.js", async () => {
  const actual = await vi.importActual<typeof import("./config.js")>("./config.js");
  return { ...actual, loadConfig: loadConfigMock };
});
vi.mock("./eb-client.js", async () => {
  const actual = await vi.importActual<typeof import("./eb-client.js")>("./eb-client.js");
  return { ...actual, eb: ebMock };
});

const { registerEbRoutes } = await import("./eb-routes.js");

const app = new Hono();
registerEbRoutes(app);

beforeEach(() => {
  ebMock.mockReset();
  loadConfigMock.mockReset();
  loadConfigMock.mockReturnValue({
    configured: true,
    applicationId: "app-1",
    privateKey: "key",
    privateKeyFile: null,
    redirectUrl: "http://localhost:8787/api/eb/callback",
    psuType: "business",
  });
});

/** Start a real authorisation and return the `state` the server issued. */
async function issueState(): Promise<string> {
  ebMock.mockResolvedValueOnce({ url: "https://bank.example/authorize" });
  const res = await app.request("/api/eb/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "ING", country: "NL" }),
  });
  expect(res.status).toBe(200);
  const sent = ebMock.mock.calls[0]![3] as { state: string };
  return sent.state;
}

test("a callback whose state this server never issued does not exchange the code", async () => {
  const res = await app.request("/api/eb/callback?code=attacker-code&state=never-issued");
  expect(ebMock).not.toHaveBeenCalled();
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("eb_error");
});

test("a callback with no state at all does not exchange the code", async () => {
  const res = await app.request("/api/eb/callback?code=attacker-code");
  expect(ebMock).not.toHaveBeenCalled();
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("eb_error");
});

test("a callback carrying a state this server issued is exchanged", async () => {
  const state = await issueState();
  ebMock.mockResolvedValueOnce({ session_id: "sess-1", accounts: [], aspsp: { name: "ING" } });
  const res = await app.request(`/api/eb/callback?code=real-code&state=${state}`);
  expect(ebMock).toHaveBeenCalledTimes(2);
  expect(ebMock.mock.calls[1]![2]).toBe("/sessions");
  expect(res.headers.get("location")).toBe("/?eb=sess-1");
});

test("a state is one-shot — replaying the same callback is refused", async () => {
  const state = await issueState();
  ebMock.mockResolvedValueOnce({ session_id: "sess-1", accounts: [], aspsp: { name: "ING" } });
  await app.request(`/api/eb/callback?code=real-code&state=${state}`);
  ebMock.mockClear();

  const replay = await app.request(`/api/eb/callback?code=real-code&state=${state}`);
  expect(ebMock).not.toHaveBeenCalled();
  expect(replay.headers.get("location")).toContain("eb_error");
});

test("an error from the bank still short-circuits before any exchange", async () => {
  const res = await app.request("/api/eb/callback?error=access_denied&error_description=Geweigerd");
  expect(ebMock).not.toHaveBeenCalled();
  expect(res.headers.get("location")).toContain("Geweigerd");
});
