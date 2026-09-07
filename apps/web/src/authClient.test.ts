import { afterEach, expect, test, vi } from "vitest";
import { getSession, signIn } from "./authClient.js";

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

test("a 200 with a user means signed in, with that user's email", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ user: { id: "u1", email: "alexander@generation-c.nl" } })),
    ),
  );
  await expect(getSession()).resolves.toEqual({
    kind: "signed-in",
    email: "alexander@generation-c.nl",
  });
});

test("a sign-in with wrong credentials rejects with the Dutch credentials message, not the server's text", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ message: "invalid credentials" }), { status: 401 }),
    ),
  );
  await expect(signIn("alexander@generation-c.nl", "verkeerd")).rejects.toThrow(
    "Onjuist e-mailadres of wachtwoord.",
  );
});

test("a sign-in the server can't complete rejects with the unreachable message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 500 })),
  );
  await expect(signIn("alexander@generation-c.nl", "geheim")).rejects.toThrow(
    "Inloggen lukte niet. Probeer het later opnieuw.",
  );
});

test("a network failure on sign-in also rejects with the unreachable message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network down");
    }),
  );
  await expect(signIn("alexander@generation-c.nl", "geheim")).rejects.toThrow(
    "Inloggen lukte niet. Probeer het later opnieuw.",
  );
});
