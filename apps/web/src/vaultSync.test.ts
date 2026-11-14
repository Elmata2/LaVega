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

  expect(await eraseServerData("nl")).toEqual([{ table: "personal.vaults", rows: 1 }]);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/account/data");
  expect(init.method).toBe("DELETE");
  expect(init.credentials).toBe("same-origin");
  expect(JSON.parse(String(init.body))).toEqual({ confirm: "ERASE" });
});

test("erasure while signed out reports the shared signed-out message", async () => {
  stub(new Response(null, { status: 401 }));

  await expect(eraseServerData("nl")).rejects.toThrow(SIGNED_OUT_MESSAGE);
});

test("a server-side erasure failure surfaces its own message", async () => {
  stub(new Response(JSON.stringify({ error: "Wissen mislukt." }), { status: 500 }));

  await expect(eraseServerData("nl")).rejects.toThrow("Wissen mislukt.");
});

/* DE LAATSTE AANROEPER VAN DE TAALLOZE `apiErrorMessage`. Wissen is de ene knop
 * waar misverstaan worden het minst kan, en een Engelse lezer kreeg er
 * "Je bent uitgelogd, log opnieuw in." Nu volgt de melding de lezer. */
test("erasure while signed out reports it in the reader's language", async () => {
  stub(new Response(null, { status: 401 }));
  await expect(eraseServerData("en")).rejects.toThrow("You're signed out, log back in.");
});

/* ---- resetPersonalData ---------------------------------------------------- */

import {
  PERSONAL_LOCAL_KEYS,
  PERSONAL_SESSION_KEYS,
  PersonalResetError,
  resetPersonalData,
} from "./vaultSync.js";
import { VaultDestroyError } from "@lavega/adapters";

const memoryStore = (initial: Record<string, string>) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    removeItem: (key: string) => void data.delete(key),
  };
};

const KEPT_KEYS = [
  "lavega.theme",
  "lavega.locale",
  "lavega.chart",
  "lavega.ownerName",
  "lavega.country",
  "lavega.sidebarWidth",
];

const resetSetup = () => {
  const local = memoryStore(
    Object.fromEntries([...PERSONAL_LOCAL_KEYS, ...KEPT_KEYS].map((key) => [key, "x"])),
  );
  const session = memoryStore({ "lavega.popupShown": "1", "lavega.other": "1" });
  const navigate = vi.fn();
  const storage = { destroyVault: vi.fn(async () => {}) };
  return { local, session, navigate, storage };
};

const account = { kind: "account", id: "user-a" } as const;
const device = { kind: "device" } as const;
const run = (
  setup: ReturnType<typeof resetSetup>,
  owner: typeof account | typeof device = account,
  locale: "nl" | "en" = "nl",
) =>
  resetPersonalData({
    locale,
    storage: setup.storage,
    owner,
    local: setup.local,
    session: setup.session,
    navigate: setup.navigate,
  });
const untouched = (setup: ReturnType<typeof resetSetup>) => {
  expect(setup.storage.destroyVault).not.toHaveBeenCalled();
  expect(setup.local.data.size).toBe(PERSONAL_LOCAL_KEYS.length + KEPT_KEYS.length);
  expect(setup.session.data.has("lavega.popupShown")).toBe(true);
  expect(setup.navigate).not.toHaveBeenCalled();
};

test("the personal key lists are exactly the specified ones", () => {
  expect([...PERSONAL_LOCAL_KEYS].sort()).toEqual(
    [
      "lavega.bufferCents",
      "lavega.ebLastRefreshAt",
      "lavega.ebEverConnected",
      "lavega.shareNetWorth",
      "lavega.shareNetWorthPendingDelete",
      "lavega.n8nHandledMessageIds",
      "lavega.n8n.autoBooked.v1",
      "lavega.forwardingGuide.v1",
      "lavega.invoiceForwardAddress",
      "lavega.onboardingSeen",
      "lavega.popups",
      "lavega.overviewWidgets",
      "lavega.navModules",
      "lavega.n8nInvoiceUrl",
      "lavega.n8nInvoiceToken",
      "lavega.n8nBaseUrl",
      "lavega.n8nApiKey",
    ].sort(),
  );
  expect([...PERSONAL_SESSION_KEYS]).toEqual(["lavega.popupShown"]);
});

test("a server error stops the reset with the server's message: nothing local changes", async () => {
  const setup = resetSetup();
  stub(new Response(JSON.stringify({ error: "Wissen mislukt." }), { status: 500 }));
  await expect(run(setup)).rejects.toMatchObject({ code: "server", message: "Wissen mislukt." });
  untouched(setup);
});

test("401 at click stops with the unauthorized code and changes nothing", async () => {
  const setup = resetSetup();
  stub(new Response(null, { status: 401 }));
  await expect(run(setup)).rejects.toMatchObject({ code: "unauthorized" });
  untouched(setup);
});

test("404 is a failure for an account owner, never 'no server copy'", async () => {
  const setup = resetSetup();
  stub(new Response(null, { status: 404 }));
  await expect(run(setup)).rejects.toBeInstanceOf(PersonalResetError);
  untouched(setup);
});

test("409 (the session is another account now) stops and changes nothing", async () => {
  const setup = resetSetup();
  stub(new Response(JSON.stringify({ code: "owner-changed" }), { status: 409 }));
  await expect(run(setup)).rejects.toMatchObject({ code: "owner-changed" });
  untouched(setup);
});

test("a network failure stops with the network code, never a raw fetch error", async () => {
  const setup = resetSetup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
  const failure = await run(setup).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(PersonalResetError);
  expect(failure).toMatchObject({ code: "network" });
  expect((failure as Error).message).not.toContain("Failed to fetch");
  untouched(setup);
});

test("success: exact request incl. expectedOwner, vault dropped, personal keys gone, kept keys stay, reload", async () => {
  const setup = resetSetup();
  const fetchMock = stub(
    new Response(JSON.stringify({ erased: [{ table: "personal.vaults", rows: 1 }] })),
  );

  const report = await run(setup);

  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/account/personal-data");
  expect(init.method).toBe("DELETE");
  expect(init.credentials).toBe("same-origin");
  expect(JSON.parse(String(init.body))).toEqual({
    confirm: "RESET-PERSONAL",
    expectedOwner: "user-a",
  });
  expect(report).toEqual([{ table: "personal.vaults", rows: 1 }]);
  expect(setup.storage.destroyVault).toHaveBeenCalledTimes(1);
  expect([...setup.local.data.keys()].sort()).toEqual([...KEPT_KEYS].sort());
  expect([...setup.session.data.keys()]).toEqual(["lavega.other"]);
  expect(setup.navigate.mock.calls).toEqual([["/app"]]);
});

test("a device owner (local-only install): no request at all, local clear only", async () => {
  const setup = resetSetup();
  const fetchMock = stub(new Response(null, { status: 500 }));

  await run(setup, device);

  expect(fetchMock).not.toHaveBeenCalled();
  expect(setup.storage.destroyVault).toHaveBeenCalledTimes(1);
  expect([...setup.local.data.keys()].sort()).toEqual([...KEPT_KEYS].sort());
  expect(setup.navigate).toHaveBeenCalledWith("/app");
});

test("a blocked vault delete is local-blocked: keys stay, no reload", async () => {
  const setup = resetSetup();
  setup.storage.destroyVault.mockRejectedValue(new VaultDestroyError("blocked", "x"));
  stub(new Response(JSON.stringify({ erased: [] })));

  await expect(run(setup)).rejects.toMatchObject({ code: "local-blocked" });
  expect(setup.local.data.size).toBe(PERSONAL_LOCAL_KEYS.length + KEPT_KEYS.length);
  expect(setup.session.data.has("lavega.popupShown")).toBe(true);
  expect(setup.navigate).not.toHaveBeenCalled();
});

test("any other vault failure is local-failed", async () => {
  const setup = resetSetup();
  setup.storage.destroyVault.mockRejectedValue(new Error("boom"));
  stub(new Response(JSON.stringify({ erased: [] })));
  await expect(run(setup)).rejects.toMatchObject({ code: "local-failed" });
  expect(setup.navigate).not.toHaveBeenCalled();
});
