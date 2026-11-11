import { afterEach, expect, test, vi } from "vitest";
import { getSession, signIn, signOut } from "./authClient.js";
import { shellCopy } from "./copy/shell.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a 503 from get-session means no auth is configured on this deployment", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await expect(getSession()).resolves.toEqual({ kind: "unconfigured" });
});

test("a 200 with no user means signed out", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ user: null }))),
  );
  await expect(getSession()).resolves.toEqual({ kind: "signed-out" });
});

test("a 200 with a user means signed in, with that user's stable ID and email", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ user: { id: "u1", email: "owner@example.com" } })),
    ),
  );
  await expect(getSession()).resolves.toEqual({
    kind: "signed-in",
    id: "u1",
    email: "owner@example.com",
  });
});

test("a sign-in with wrong credentials reports the credentials kind, not the server's text", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ message: "invalid credentials" }), { status: 401 }),
    ),
  );
  await expect(signIn("owner@example.com", "verkeerd")).resolves.toEqual({
    ok: false,
    kind: "wrong-credentials",
  });
});

test("a sign-in the server can't complete reports the unreachable kind", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 500 })),
  );
  await expect(signIn("owner@example.com", "geheim")).resolves.toEqual({
    ok: false,
    kind: "unreachable",
  });
});

test("a network failure on sign-in also reports the unreachable kind", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network down");
    }),
  );
  await expect(signIn("owner@example.com", "geheim")).resolves.toEqual({
    ok: false,
    kind: "unreachable",
  });
});

/* DE TWEE ZINNEN WAREN HARDGECODEERD NEDERLANDS, op het allereerste scherm dat
 * een Engelse lezer ziet. Ze staan nu in `copy/shell` en dit bewaakt dat beide
 * kinds daar ook echt een zin hebben — een kind erbij zonder zin is een lege
 * melding onder een mislukte inlogpoging. */
test("both sign-in failures have a sentence in both languages", () => {
  for (const locale of ["nl", "en"] as const) {
    const e = shellCopy[locale].profiel.account.signInError;
    for (const kind of ["wrong-credentials", "unreachable"] as const) {
      expect(e[kind], `${locale} ${kind}`).toMatch(/\S/);
    }
    expect(e["wrong-credentials"]).not.toBe(e.unreachable);
  }
  expect(shellCopy.en.profiel.account.signInError["wrong-credentials"]).not.toMatch(
    /Onjuist|wachtwoord/,
  );
});

test("signOut resolves on a 200", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
  await expect(signOut()).resolves.toBeUndefined();
});

test("signOut rejects on a 500 without leaking the body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("secret body", { status: 500 })),
  );
  await expect(signOut()).rejects.toThrow("sign-out-failed");
});

test("signOut rejects on a network error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("offline");
    }),
  );
  await expect(signOut()).rejects.toThrow("sign-out-failed");
});

test("signOut posts to the sign-out endpoint with a JSON content type and a {} body", async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null));
  vi.stubGlobal("fetch", fetchMock);
  await signOut();
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("/api/auth/sign-out");
  expect(init?.method).toBe("POST");
  expect(init?.credentials).toBe("same-origin");
  expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  expect(init?.body).toBe("{}");
});
