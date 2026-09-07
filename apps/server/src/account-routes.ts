import type { Hono } from "hono";
import { eraseUserData, type ErasureReport } from "@lavega/database";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import { investingTenantId } from "./investing-mount.js";

export type AccountRouteDependencies = {
  tenantId: (request: Request) => Promise<string | null>;
  erase: (tenantId: string) => Promise<ErasureReport>;
};

/**
 * The right to be forgotten, as a route (GDPR art. 17).
 *
 * The vault backup can be replaced but never removed, and no other route
 * deletes anything a person owns. Encryption did the privacy work, and
 * encryption is a mitigation, not a lawful basis — a user asking to be erased
 * could not be, because nothing could remove their rows.
 *
 * Irreversible, so it asks to be meant: a bare DELETE is refused. The body must
 * carry `{ "confirm": "ERASE" }`, which a mis-routed fetch or a curious click
 * will not have. Beyond that it deletes only the caller's own rows — the tenant
 * comes from the session, never from the request — and `eraseUserData` runs the
 * whole thing in one transaction, so there is no half-erased account.
 */
export function registerAccountRoutes(app: Hono, dependencies: AccountRouteDependencies): void {
  app.delete("/api/account/data", async (c) => {
    const tenantId = await dependencies.tenantId(c.req.raw);
    if (!tenantId) return c.json({ problems: ["Authentication is required"] }, 401);

    const body: { confirm?: unknown } = await c.req.json<{ confirm?: unknown }>().catch(() => ({}));
    if (body.confirm !== "ERASE") {
      return c.json({ problems: ["Bevestig met { \"confirm\": \"ERASE\" } — dit is niet terug te draaien"] }, 400);
    }

    const report = await dependencies.erase(tenantId);
    /* What was deleted, per table. An erasure you cannot evidence is one you
     * cannot answer a regulator about. */
    return c.json({ erased: report });
  });
}

/** Wiring for the real server: session identity, Neon storage. */
export function accountRouteDependencies(): AccountRouteDependencies | null {
  const database = runtimeDatabase();
  if (!database) return null;
  return { tenantId: investingTenantId, erase: (tenantId) => eraseUserData(database, tenantId) };
}
