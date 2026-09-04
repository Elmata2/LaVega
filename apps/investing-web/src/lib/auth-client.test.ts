// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { getSession, signIn, signOut, signUp } from "./auth-client";

afterEach(() => {
  vi.restoreAllMocks();
});

test("getSession returns null when auth is not configured (503)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        }),
      ),
    ),
  );
  expect(await getSession()).toEqual({ status: "unconfigured" });
});

test("getSession returns anonymous when configured but no cookie", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response("null", { status: 200 }))),
  );
  expect(await getSession()).toEqual({ status: "anonymous" });
  expect(fetch).toHaveBeenCalledWith("/api/auth/get-session", {
    headers: { accept: "application/json" },
  });
});

test("getSession returns the session when a user is signed in", async () => {
  const body = { session: { id: "s1" }, user: { id: "u1", email: "jort@example.com" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))),
  );
  expect(await getSession()).toEqual({ status: "authenticated", user: body.user });
});

test("signUp posts name, email and password to sign-up/email", async () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await signUp({
    name: "Jort",
    email: "jort@example.com",
    password: "correct horse battery staple",
  });
  expect(result).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Jort",
      email: "jort@example.com",
      password: "correct horse battery staple",
    }),
  });
});

test("signUp surfaces the server's error message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "E-mailadres al in gebruik" }), { status: 422 }),
      ),
    ),
  );
  const result = await signUp({ name: "Jort", email: "jort@example.com", password: "x" });
  expect(result).toEqual({ ok: false, message: "E-mailadres al in gebruik" });
});

test("signIn posts email and password to sign-in/email", async () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await signIn({
    email: "jort@example.com",
    password: "correct horse battery staple",
  });
  expect(result).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "jort@example.com", password: "correct horse battery staple" }),
  });
});

test("signIn surfaces a fallback message when the server sends none", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 401 }))),
  );
  const result = await signIn({ email: "jort@example.com", password: "wrong" });
  expect(result).toEqual({ ok: false, message: "Inloggen mislukt." });
});

test("signOut posts to sign-out", async () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
  await signOut();
  expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-out", { method: "POST" });
});
