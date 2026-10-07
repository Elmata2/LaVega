import type { Hono } from "hono";
import {
  createOpaqueVaultRepository,
  createVaultKeyRepository,
  UnreadableVaultKeyError,
  type OpaqueVaultRow,
  type OpaqueVaultWrite,
} from "@lavega/database";
import {
  credentialsArePerTenant,
  requireRuntimeDatabase,
} from "@lavega/investing-server/src/credentialStore.js";
import { PBKDF2_ITERATIONS } from "@lavega/adapters";
import { investingTenantId } from "./investing-mount.js";

/* Bounded at both ends. Below the vault's own KDF floor the blob is weakly
 * sealed and deriveKey would reject it on the way back out, so storing it only
 * wastes the user's real backup. Above the ceiling, a crafted count makes the
 * browser deriving the key hang for minutes. Anything holding a session can
 * upload here, so neither bound is the client's to enforce alone. */
const MIN_ITERATIONS = PBKDF2_ITERATIONS;
const MAX_ITERATIONS = 10_000_000;

/** The sealed envelope, and nothing about what is inside it. */
function isSealedVault(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const blob = value as Record<string, unknown>;
  // Sealed with the account's vault key (GET /api/vault/key): no KDF parameters.
  if (blob.v === 2)
    return blob.kdf === "account-key" && typeof blob.iv === "string" && typeof blob.ct === "string";
  return (
    blob.v === 1 &&
    blob.kdf === "PBKDF2-SHA256" &&
    typeof blob.salt === "string" &&
    typeof blob.iv === "string" &&
    typeof blob.ct === "string" &&
    typeof blob.iterations === "number" &&
    blob.iterations >= MIN_ITERATIONS &&
    blob.iterations <= MAX_ITERATIONS
  );
}

export type VaultRouteDependencies = {
  tenantId: (request: Request) => Promise<string | null>;
  repository: (tenantId: string) => {
    get(): Promise<OpaqueVaultRow | null>;
    put(blob: Buffer, expectedUpdatedAt: string | null): Promise<OpaqueVaultWrite>;
    overwrite(blob: Buffer): Promise<{ updatedAt: string }>;
  };
  vaultKey: (tenantId: string) => { getOrCreate(): Promise<Buffer> };
};

/**
 * Encrypted backup of the personal vault.
 *
 * The browser holds the key; this stores and returns the bytes it is given and
 * has no way to read them. That is the whole point — it buys another device and
 * a cleared browser, and it must not quietly buy the server a copy of anyone's
 * finances.
 */
export function registerVaultRoutes(app: Hono, dependencies: VaultRouteDependencies): void {
  const forTenant = async (request: Request) => {
    const tenantId = await dependencies.tenantId(request);
    return tenantId ? dependencies.repository(tenantId) : null;
  };

  /* The key the browser opens the personal vault with. Created on the first
   * signed-in request, so an account that never opens Personal has none.
   * no-store: a cached copy of this answer is a copy of the key. */
  app.get("/api/vault/key", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const tenantId = await dependencies.tenantId(c.req.raw);
    if (!tenantId) return c.json({ problems: ["Authentication is required"] }, 401);
    try {
      const key = await dependencies.vaultKey(tenantId).getOrCreate();
      return c.json({ key: key.toString("base64") });
    } catch (error) {
      if (error instanceof UnreadableVaultKeyError)
        return c.json({ problems: ["Vault key unreadable"], code: "vault-key-unreadable" }, 500);
      throw error;
    }
  });

  app.get("/api/vault/backup", async (c) => {
    const repository = await forTenant(c.req.raw);
    if (!repository) return c.json({ problems: ["Authentication is required"] }, 401);
    const stored = await repository.get();
    // No backup yet is the normal state of a new account, not a failure.
    if (!stored) return c.json({ blob: null, updatedAt: null });
    return c.json({
      blob: JSON.parse(stored.blob.toString("utf8")) as unknown,
      updatedAt: stored.updatedAt,
    });
  });

  app.put("/api/vault/backup", async (c) => {
    const repository = await forTenant(c.req.raw);
    if (!repository) return c.json({ problems: ["Authentication is required"] }, 401);
    const body: { blob?: unknown; baseUpdatedAt?: unknown } = await c.req
      .json<{ blob?: unknown; baseUpdatedAt?: unknown }>()
      .catch(() => ({}));
    if (!isSealedVault(body.blob))
      return c.json({ problems: ["Back-up is geen versleutelde kluis"] }, 400);
    const bytes = Buffer.from(JSON.stringify(body.blob), "utf8");

    if (c.req.query("overwrite") === "true") return c.json(await repository.overwrite(bytes));

    const baseUpdatedAt = typeof body.baseUpdatedAt === "string" ? body.baseUpdatedAt : null;
    const outcome = await repository.put(bytes, baseUpdatedAt);
    if (outcome.status === "stored") return c.json({ updatedAt: outcome.updatedAt });
    /* The client's copy is not based on what the server holds. Returning the
     * server's timestamp lets the screen say which is newer instead of picking
     * one and destroying the other. */
    return c.json(
      {
        problems: ["De server heeft een nieuwere back-up"],
        updatedAt: (await repository.get())?.updatedAt ?? null,
      },
      409,
    );
  });
}

/* Whether to mount is decided by DATABASE_URL, which exists at module load; the
 * pool itself is resolved per request, because `runtimeDatabase()` is request
 * scoped and is null here. Checking it at load skipped these routes entirely —
 * see the note in eb-routes.ts. */
/** Wiring for the real server: session identity, Neon storage. */
export function vaultRouteDependencies(): VaultRouteDependencies | null {
  if (!credentialsArePerTenant()) return null;
  return {
    tenantId: investingTenantId,
    repository: (tenantId) => createOpaqueVaultRepository(requireRuntimeDatabase(), tenantId),
    vaultKey: (tenantId) => createVaultKeyRepository(requireRuntimeDatabase(), tenantId),
  };
}
