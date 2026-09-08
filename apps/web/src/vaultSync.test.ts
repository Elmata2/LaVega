import { afterEach, expect, test, vi } from "vitest";
import { eraseServerData, fetchServerBackup, uploadServerBackup } from "./vaultSync.js";
import { SIGNED_OUT_MESSAGE } from "./api.js";
import type { CipherBlob } from "@lavega/adapters";

const blob: CipherBlob = {
  v: 1,
  kdf: "PBKDF2-SHA256",
  iterations: 210_000,
  salt: "c2FsdA==",
  iv: "aXY=",
  ct: "Y2lwaGVy",
};

afterEach(() => vi.unstubAllGlobals());

const stub = (response: Response) => {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

test("an account with no backup reads as absent rather than failing", async () => {
  stub(new Response(JSON.stringify({ blob: null, updatedAt: null })));

  expect(await fetchServerBackup()).toEqual({ blob: null, updatedAt: null });
});

test("a signed-out visitor is told so, not shown an error", async () => {
  stub(new Response(null, { status: 401 }));

  expect(await fetchServerBackup()).toBe("signed-out");
  stub(new Response(null, { status: 401 }));
  expect(await uploadServerBackup(blob, null)).toEqual({ status: "signed-out" });
});

test("a blob the server hands back is validated before it reaches the key derivation", async () => {
  stub(
    new Response(
      JSON.stringify({
        blob: { ...blob, iterations: 99_000_000 },
        updatedAt: "2026-08-31T00:00:00.000Z",
      }),
    ),
  );

  await expect(fetchServerBackup()).rejects.toThrow(/ongeldig/i);
});

test("an upload names the copy it replaces", async () => {
  const fetchMock = stub(new Response(JSON.stringify({ updatedAt: "2026-08-31T12:00:00.000Z" })));

  expect(await uploadServerBackup(blob, "2026-08-31T00:00:00.000Z")).toEqual({
    status: "stored",
    updatedAt: "2026-08-31T12:00:00.000Z",
  });
  expect(
    JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)),
  ).toEqual({ blob, baseUpdatedAt: "2026-08-31T00:00:00.000Z" });
});

test("a newer server copy comes back as a conflict with its date, not as a write", async () => {
  stub(
    new Response(JSON.stringify({ problems: ["nieuwer"], updatedAt: "2026-08-31T09:00:00.000Z" }), {
      status: 409,
    }),
  );

  expect(await uploadServerBackup(blob, "2026-08-30T00:00:00.000Z")).toEqual({
    status: "conflict",
    updatedAt: "2026-08-31T09:00:00.000Z",
  });
});

test("overwriting is a different request, never a silent retry", async () => {
  const fetchMock = stub(new Response(JSON.stringify({ updatedAt: "2026-08-31T12:00:00.000Z" })));

  await uploadServerBackup(blob, null, true);

  expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
    "/api/vault/backup?overwrite=true",
  );
});

test("erasure confirms with the server-required body and reports what was deleted", async () => {
  const fetchMock = stub(
    new Response(JSON.stringify({ erased: [{ table: "personal.vaults", rows: 1 }] })),
  );

  expect(await eraseServerData()).toEqual([{ table: "personal.vaults", rows: 1 }]);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/account/data");
  expect(init.method).toBe("DELETE");
  expect(init.credentials).toBe("same-origin");
  expect(JSON.parse(String(init.body))).toEqual({ confirm: "ERASE" });
});

test("erasure while signed out reports the shared signed-out message", async () => {
  stub(new Response(null, { status: 401 }));

  await expect(eraseServerData()).rejects.toThrow(SIGNED_OUT_MESSAGE);
});

test("a server-side erasure failure surfaces its own message", async () => {
  stub(new Response(JSON.stringify({ error: "Wissen mislukt." }), { status: 500 }));

  await expect(eraseServerData()).rejects.toThrow("Wissen mislukt.");
});
