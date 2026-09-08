import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { loadConfig, type EbConfig, type PsuType } from "./config.js";
import { createEbFlowRepository } from "@lavega/database";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import { investingTenantId } from "./investing-mount.js";
import { eb, type EbClientConfig } from "./eb-client.js";

/* Enable Banking AIS flow. The server holds the app credential (JWT signing)
 * and does the OAuth exchange; it never persists the user's financial data.
 * The RAW bank JSON is relayed to the client, which maps it (@lavega/adapters'
 * enableBankingMap) and stores it in the browser's encrypted vault.
 *
 * Flow: GET /aspsps (bank list) -> POST /auth (start, returns bank URL) ->
 * [user authorises at the bank] -> GET /callback?code&state (exchange for a
 * session, redirect to the SPA with ?eb=<sessionId>) -> GET /accounts?session_id
 * (fetch balances+transactions per account, return raw). */

export type EbSession = { accounts: Array<Record<string, unknown>>; aspsp: string };
export type PendingAuth = { userId: string; name: string; country: string };

/**
 * Where the flow's two intermediate states live.
 *
 * They used to be module-scope `Map`s, which worked on Railway — one container,
 * one process — and cannot work on Vercel. `/api/eb/auth` may write the state in
 * one function instance while the bank's redirect to `/api/eb/callback` lands on
 * another, where the Map is empty. Every real bank connection would fail, and the
 * `state` check added for M1 would fail it reliably rather than silently.
 */
export type EbFlowStore = {
  startAuth(state: string, pending: PendingAuth): Promise<void>;
  consumeAuth(state: string, ttlMs: number): Promise<PendingAuth | null>;
  sweepAuth(ttlMs: number): Promise<void>;
  sweepSessions(userId: string, ttlMs: number): Promise<number>;
  putSession(userId: string, sessionId: string, payload: EbSession): Promise<void>;
  getSession(userId: string, sessionId: string, ttlMs: number): Promise<EbSession | null>;
  deleteSession(userId: string, sessionId: string): Promise<void>;
};

export const PENDING_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 60 * 60 * 1000;

function clientConfig(cfg: EbConfig): EbClientConfig {
  return {
    applicationId: cfg.applicationId,
    privateKey: cfg.privateKey,
    privateKeyFile: cfg.privateKeyFile,
  };
}

/** RFC3339 timestamp `days` from now — for the consent's `valid_until`. */
function validUntil(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type EbRouteDependencies = {
  store: EbFlowStore;
  /** The signed-in user, or null. Never read from the request's own body. */
  tenantId: (request: Request) => Promise<string | null>;
};

/** ISO 3166-1 alpha-2 or nothing: the value is interpolated into the Enable
 *  Banking URL, and `.toUpperCase()` alone let `&` and `#` through (L2). */
function countryCode(raw: string | undefined): string | null {
  const country = (raw || "NL").toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

function psuTypeParam(raw: string | undefined, fallback: PsuType): PsuType | null {
  if (!raw) return fallback;
  return raw === "business" || raw === "personal" ? raw : null;
}

export function registerEbRoutes(app: Hono, dependencies: EbRouteDependencies): void {
  const { store, tenantId } = dependencies;
  // Bank list for the picker (defaults to NL). Public-ish metadata only.
  app.get("/api/eb/aspsps", async (c) => {
    const cfg = loadConfig();
    if (!cfg.configured)
      return c.json({ error: "Enable Banking is nog niet geconfigureerd op de server." }, 503);
    const country = countryCode(c.req.query("country"));
    if (!country) return c.json({ error: "Ongeldige landcode." }, 400);
    const psuType = psuTypeParam(c.req.query("psu_type"), cfg.psuType);
    if (!psuType) return c.json({ error: "Ongeldig type rekening." }, 400);
    try {
      const data = (await eb(
        clientConfig(cfg),
        "GET",
        `/aspsps?country=${country}&psu_type=${psuType}`,
      )) as {
        aspsps?: Array<{ name?: string; country?: string; logo?: string }>;
      };
      const aspsps = (data.aspsps ?? []).map((a) => ({
        name: a.name,
        country: a.country,
        logo: a.logo,
      }));
      return c.json({ aspsps });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 502);
    }
  });

  // Start authorisation: returns the bank's authorization URL for the client to
  // redirect the browser to.
  app.post("/api/eb/auth", async (c) => {
    const cfg = loadConfig();
    if (!cfg.configured)
      return c.json({ error: "Enable Banking is nog niet geconfigureerd op de server." }, 503);
    const userId = await tenantId(c.req.raw);
    if (!userId) return c.json({ error: "Log in om een bank te koppelen." }, 401);
    // Housekeeping, not a prerequisite: a failed sweep must not stop the user
    // from connecting a bank. eb_sessions is RLS-scoped per user, so there is
    // no table-wide sweep for it — it is swept for this user here, on the one
    // request that already runs as them. SESSION_TTL_MS is the window
    // getSession already treats a session as gone by.
    await Promise.all([
      store.sweepAuth(PENDING_TTL_MS),
      store.sweepSessions(userId, SESSION_TTL_MS),
    ]).catch((error: unknown) => {
      console.warn("eb sweep skipped", error instanceof Error ? error.message : String(error));
    });
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      country?: string;
      psuType?: string;
    };
    const name = body.name;
    const country = countryCode(body.country);
    if (!name) return c.json({ error: "Kies een bank (name ontbreekt)." }, 400);
    if (!country) return c.json({ error: "Ongeldige landcode." }, 400);
    const psuType = psuTypeParam(body.psuType, cfg.psuType);
    if (!psuType) return c.json({ error: "Ongeldig type rekening." }, 400);
    const state = randomUUID();
    try {
      const data = (await eb(clientConfig(cfg), "POST", "/auth", {
        access: { valid_until: validUntil(89) },
        aspsp: { name, country },
        state,
        redirect_url: cfg.redirectUrl,
        psu_type: psuType,
      })) as { url?: string };
      if (!data.url)
        return c.json({ error: "Geen autorisatie-URL ontvangen van Enable Banking." }, 502);
      await store.startAuth(state, { userId, name, country });
      return c.json({ url: data.url });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 502);
    }
  });

  // Bank redirects the browser here after authorisation. Exchange code -> session,
  // stash the accounts, then bounce to the SPA with the session id.
  app.get("/api/eb/callback", async (c) => {
    const cfg = loadConfig();
    const error = c.req.query("error");
    if (error)
      return c.redirect(
        `/?eb_error=${encodeURIComponent(c.req.query("error_description") || error)}`,
      );
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code)
      return c.redirect(`/?eb_error=${encodeURIComponent("Geen autorisatiecode ontvangen.")}`);

    /* The `state` has to be one THIS server issued, or the whole point of
     * having one is lost. It used to be created in /auth, deleted here, and
     * never read — so the callback accepted any code from anyone. An attacker
     * could start his own authorisation, take his `code`, and send the owner to
     * /api/eb/callback?code=<his>; the server would exchange it and the app
     * would pull HIS bank data into the owner's vault.
     *
     * Consumed on use, so a replayed callback is refused too. */
    /* Consumed as it is read, so a replayed callback finds nothing rather than
     * getting a second exchange. The row also names the user who started the
     * flow — which is how this route knows whose bank this is without relying
     * on a session cookie surviving a redirect from the bank's own domain. */
    const authorised = state ? await store.consumeAuth(state, PENDING_TTL_MS) : null;
    if (!authorised) {
      return c.redirect(
        `/?eb_error=${encodeURIComponent("Onbekende of verlopen autorisatie — koppel de bank opnieuw.")}`,
      );
    }
    try {
      const data = (await eb(clientConfig(cfg), "POST", "/sessions", { code })) as {
        session_id?: string;
        accounts?: Array<Record<string, unknown>>;
        aspsp?: { name?: string };
      };
      if (!data.session_id)
        return c.redirect(`/?eb_error=${encodeURIComponent("Geen sessie ontvangen.")}`);
      await store.putSession(authorised.userId, data.session_id, {
        accounts: data.accounts ?? [],
        aspsp: data.aspsp?.name ?? "",
      });
      return c.redirect(`/?eb=${encodeURIComponent(data.session_id)}`);
    } catch (e) {
      return c.redirect(`/?eb_error=${encodeURIComponent(errMsg(e))}`);
    }
  });

  // Fetch balances + transactions for the session's accounts and relay the RAW
  // bank JSON to the client (which maps + stores it locally).
  app.get("/api/eb/accounts", async (c) => {
    const cfg = loadConfig();
    if (!cfg.configured)
      return c.json({ error: "Enable Banking is nog niet geconfigureerd op de server." }, 503);
    const userId = await tenantId(c.req.raw);
    if (!userId) return c.json({ error: "Log in om je rekeningen op te halen." }, 401);
    const sessionId = c.req.query("session_id") || "";
    /* Scoped to the caller. The id still travels in the URL (review finding M2),
     * but it is no longer a bearer token: the row belongs to a user, and RLS
     * means someone else's session id finds nothing here. */
    const session = await store.getSession(userId, sessionId, SESSION_TTL_MS);
    if (!session)
      return c.json({ error: "Sessie onbekend of verlopen — koppel de bank opnieuw." }, 404);
    const dateFrom = isoDaysAgo(365);
    const cc = clientConfig(cfg);
    try {
      const items = [];
      for (const account of session.accounts) {
        const uid = String((account as { uid?: string }).uid || "");
        if (!uid) continue;
        const balancesRes = (await eb(cc, "GET", `/accounts/${uid}/balances`)) as {
          balances?: unknown[];
        };
        // Transactions are paginated via continuation_key; follow it (capped).
        const transactions: unknown[] = [];
        let cont: string | undefined;
        for (let page = 0; page < 20; page++) {
          const q =
            `date_from=${dateFrom}` + (cont ? `&continuation_key=${encodeURIComponent(cont)}` : "");
          const txRes = (await eb(cc, "GET", `/accounts/${uid}/transactions?${q}`)) as {
            transactions?: unknown[];
            continuation_key?: string;
          };
          if (txRes.transactions) transactions.push(...txRes.transactions);
          cont = txRes.continuation_key;
          if (!cont) break;
        }
        items.push({ account, balances: balancesRes.balances ?? [], transactions });
      }
      await store.deleteSession(userId, sessionId); // one-shot: data delivered
      return c.json({ aspsp: session.aspsp, items });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 502);
    }
  });
}

/** Wiring for the real server: Neon storage, session identity. */
export function ebRouteDependencies(): EbRouteDependencies | null {
  const database = runtimeDatabase();
  if (!database) return null;
  return { store: createEbFlowRepository(database) as EbFlowStore, tenantId: investingTenantId };
}
