import { beforeEach, expect, test, vi } from "vitest";

/* The encrypted vault backup landed AFTER the 2026-08-28 review, so no finding
 * names it — but it is the same shape as C1. Its own check is
 * `investingTenantId`, which deliberately falls back to the LOCAL tenant when
 * authentication is not configured (`BETTER_AUTH_SECRET` absent). With a
 * DATABASE_URL but no secret the routes register, the fallback names a tenant,
 * and a stranger reads or overwrites another person's sealed finances.
 *
 * So this file gives the route the most permissive dependencies it could ever
 * have — a tenant is ALWAYS named — which leaves `apiGuard` as the only thing
 * that can refuse. If it stops refusing, these tests turn green in the wrong
 * direction and the hole is back. */
const { verifiedSessionMock, repositoryMock } = vi.hoisted(() => ({
  verifiedSessionMock: vi.fn(async () => null as unknown),
  repositoryMock: {
    get: vi.fn(async () => null),
    put: vi.fn(async () => ({ status: "stored" as const, updatedAt: "2026-08-31T00:00:00.000Z" })),
    overwrite: vi.fn(async () => ({ updatedAt: "2026-08-31T00:00:00.000Z" })),
  },
}));

vi.mock("./auth.js", async () => {
  const actual = await vi.importActual<typeof import("./auth.js")>("./auth.js");
  return { ...actual, verifiedSession: verifiedSessionMock };
});

vi.mock("./vault-routes.js", async () => {
  const actual = await vi.importActual<typeof import("./vault-routes.js")>("./vault-routes.js");
  return {
    ...actual,
    // Always available, always naming a tenant — the worst case, on purpose.
    vaultRouteDependencies: () => ({ tenantId: async () => "local", repository: () => repositoryMock }),
  };
});

delete process.env.LAVEGA_ALLOW_UNAUTHENTICATED;
const { app } = await import("./index.js");

beforeEach(() => {
  // Call counts only — the mocked implementations have to survive.
  for (const fn of Object.values(repositoryMock)) fn.mockClear();
});

const SEALED = { v: 1, kdf: "PBKDF2-SHA256", salt: "c2FsdA", iv: "aXY", ct: "Y3Q", iterations: 600_000 };

test("the vault backup routes are registered, or the rest of this file proves nothing", async () => {
  verifiedSessionMock.mockResolvedValue({ user: { id: "user-123" } });
  const res = await app.request("/api/vault/backup");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ blob: null, updatedAt: null });
});

test("an anonymous caller cannot read another person's encrypted vault backup", async () => {
  verifiedSessionMock.mockResolvedValue(null);
  const res = await app.request("/api/vault/backup");
  expect(res.status).toBe(401);
  expect(repositoryMock.get).not.toHaveBeenCalled();
});

test("an anonymous caller cannot overwrite another person's encrypted vault backup", async () => {
  verifiedSessionMock.mockResolvedValue(null);
  const res = await app.request("/api/vault/backup?overwrite=true", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ blob: SEALED }),
  });
  expect(res.status).toBe(401);
  expect(repositoryMock.overwrite).not.toHaveBeenCalled();
});
