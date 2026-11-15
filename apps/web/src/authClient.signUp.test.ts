import { afterEach, expect, test, vi } from "vitest";
import { signUp } from "./authClient.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const input = {
  name: "Anna",
  email: "anna@example.com",
  password: "correct horse",
  callbackURL: "https://lavega.dev/app",
};

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test("posts name, email, password and callbackURL as JSON to better-auth's sign-up endpoint", async () => {
  const fetchMock = stubFetch(200, { token: null, user: { email: input.email } });
  const result = await signUp(input);
  expect(result).toEqual({ ok: true });
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("/api/auth/sign-up/email");
  expect(init.method).toBe("POST");
  expect(init.credentials).toBe("same-origin");
  expect(init.headers).toEqual({ "content-type": "application/json" });
  expect(JSON.parse(init.body)).toEqual(input);
});

test("an already-registered email gets better-auth's generic 200 and reads as success", async () => {
  // better-auth 1.7.1 sign-up.mjs:163,205-211: with requireEmailVerification on, a duplicate
  // email returns the same synthetic { token: null, user } as a new one.
  stubFetch(200, { token: null, user: { id: "x", email: "a@b.nl" } });
  expect(await signUp(input)).toEqual({ ok: true });
});

test.each(["PASSWORD_TOO_SHORT", "PASSWORD_TOO_LONG"])("%s maps to weak-password", async (code) => {
  stubFetch(400, { code, message: "x" });
  expect(await signUp(input)).toEqual({ ok: false, kind: "weak-password" });
});

test("429 maps to rate-limited", async () => {
  stubFetch(429, { message: "Too many requests" });
  expect(await signUp(input)).toEqual({ ok: false, kind: "rate-limited" });
});

test("any other failure, or a network error, maps to unreachable", async () => {
  stubFetch(500, {});
  expect(await signUp(input)).toEqual({ ok: false, kind: "unreachable" });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  expect(await signUp(input)).toEqual({ ok: false, kind: "unreachable" });
});
