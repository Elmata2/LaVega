import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";
import { registerVaultRoutes } from "./vault-routes.js";
import type { OpaqueVaultWrite } from "@lavega/database";

const blob = { v: 1, kdf: "PBKDF2-SHA256", iterations: 210_000, salt: "c2FsdA==", iv: "aXY=", ct: "Y2lwaGVy" };

function harness(overrides: Partial<Parameters<typeof registerVaultRoutes>[1]> = {}) {
  const repository = {
    get: vi.fn(async () => null as { blob: Buffer; updatedAt: string } | null),
    put: vi.fn(async (): Promise<OpaqueVaultWrite> => ({ status: "stored", updatedAt: "2026-08-31T12:00:00.000Z" })),
    overwrite: vi.fn(async () => ({ updatedAt: "2026-08-31T12:00:00.000Z" })),
  };
  const app = new Hono();
  registerVaultRoutes(app, { tenantId: async () => "user-123", repository: () => repository, ...overrides });
  return { app, repository };
}

const put = (app: Hono, body: unknown, query = "") =>
  app.request(`/api/vault/backup${query}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => vi.clearAllMocks());

test("an unauthenticated request reaches neither the vault nor the database", async () => {
  const { app, repository } = harness({ tenantId: async () => null });

  const read = await app.request("/api/vault/backup");
  const write = await put(app, { blob });

  expect(read.status).toBe(401);
  expect(write.status).toBe(401);
  expect(repository.get).not.toHaveBeenCalled();
  expect(repository.put).not.toHaveBeenCalled();
});

test("a vault that was never backed up reads as absent, not as an error", async () => {
  const { app } = harness();

  const response = await app.request("/api/vault/backup");

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ blob: null, updatedAt: null });
});

test("a stored vault comes back exactly as it went in", async () => {
  const { app, repository } = harness();
  repository.get.mockResolvedValue({ blob: Buffer.from(JSON.stringify(blob)), updatedAt: "2026-08-31T00:00:00.000Z" });

  const response = await app.request("/api/vault/backup");

  expect(await response.json()).toEqual({ blob, updatedAt: "2026-08-31T00:00:00.000Z" });
});

test("the write is conditional on the copy the client last saw", async () => {
  const { app, repository } = harness();

  const response = await put(app, { blob, baseUpdatedAt: "2026-08-31T00:00:00.000Z" });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ updatedAt: "2026-08-31T12:00:00.000Z" });
  expect(repository.put).toHaveBeenCalledWith(Buffer.from(JSON.stringify(blob)), "2026-08-31T00:00:00.000Z");
});

test("a stale write is refused with the server's copy so the user can choose", async () => {
  const { app, repository } = harness();
  repository.put.mockResolvedValue({ status: "conflict" });
  repository.get.mockResolvedValue({ blob: Buffer.from(JSON.stringify(blob)), updatedAt: "2026-08-31T09:00:00.000Z" });

  const response = await put(app, { blob, baseUpdatedAt: "2026-08-30T00:00:00.000Z" });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ problems: ["De server heeft een nieuwere back-up"], updatedAt: "2026-08-31T09:00:00.000Z" });
});

test("overwrite is the only way past a conflict, and it is explicit", async () => {
  const { app, repository } = harness();

  const response = await put(app, { blob }, "?overwrite=true");

  expect(response.status).toBe(200);
  expect(repository.overwrite).toHaveBeenCalledWith(Buffer.from(JSON.stringify(blob)));
  expect(repository.put).not.toHaveBeenCalled();
});

test("anything that is not a sealed vault envelope is refused", async () => {
  const { app, repository } = harness();

  for (const bad of [{ blob: { ...blob, ct: undefined } }, { blob: { ...blob, v: 2 } }, { blob: { ...blob, iterations: 1 } }, { blob: "plaintext" }, {}]) {
    expect((await put(app, bad)).status, JSON.stringify(bad)).toBe(400);
  }
  expect(repository.put).not.toHaveBeenCalled();
});
