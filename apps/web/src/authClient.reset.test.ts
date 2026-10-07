// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  RESET_PASSWORD_PATH,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  signIn,
} from "./authClient.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof respond>): Record<string, unknown> {
  const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(String(call[1].body));
}

test("an unconfirmed address signing in is told to confirm, not that the server failed", async () => {
  respond(403, { code: "EMAIL_NOT_VERIFIED" });
  await expect(signIn("a@b.nl", "longenough")).resolves.toEqual({ ok: false, kind: "unverified" });
});

test("a throttled sign-in says so", async () => {
  respond(429);
  await expect(signIn("a@b.nl", "longenough")).resolves.toEqual({
    ok: false,
    kind: "rate-limited",
  });
});

test("a reset request sends the link back to this origin's reset page", async () => {
  const fetchMock = respond(200, { status: true });
  await expect(requestPasswordReset("a@b.nl")).resolves.toEqual({ ok: true });
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/request-password-reset");
  expect(sentBody(fetchMock)).toEqual({
    email: "a@b.nl",
    redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}`,
  });
});

test("a resend that is throttled reports rate-limited", async () => {
  respond(429);
  await expect(resendVerification("a@b.nl")).resolves.toEqual({
    ok: false,
    kind: "rate-limited",
  });
});

test("an expired reset token reads as an invalid link", async () => {
  respond(400, { code: "INVALID_TOKEN" });
  await expect(resetPassword("t", "longenough")).resolves.toEqual({
    ok: false,
    kind: "invalid-link",
  });
});

test("a too-short new password reads as weak", async () => {
  respond(400, { code: "PASSWORD_TOO_SHORT" });
  await expect(resetPassword("t", "short")).resolves.toEqual({
    ok: false,
    kind: "weak-password",
  });
});
