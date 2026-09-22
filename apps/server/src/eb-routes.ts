import { randomUUID } from "node:crypto";
import { createRateLimiter, rateLimitKey, type RateLimiter } from "./agent/rateLimit.js";
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

export type EbSession = {
  accounts: Array<Record<string, unknown>>;
  aspsp: string;
  /** RFC3339, as sent to the bank in `access.valid_until`. The consent dies on
   *  this date whatever our own row says, so it travels with the session and
   *  the refresh path checks it rather than discovering a 401 from the bank. */
  validUntil?: string;
};
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
  listSessions(
    userId: string,
    ttlMs: number,
  ): Promise<Array<{ sessionId: string; payload: EbSession; createdAt: string }>>;
  getSession(userId: string, sessionId: string, ttlMs: number): Promise<EbSession | null>;
  deleteSession(userId: string, sessionId: string): Promise<void>;
};

export const PENDING_TTL_MS = 15 * 60 * 1000;

/** How long a connection stays usable here.
 *
 *  WAS ONE HOUR, AND THAT WAS THE WHOLE "MY BALANCE NEVER UPDATES" BUG. The
 *  consent we ask the bank for lasts 89 days (`validUntil(89)` below), but the
 *  row holding the session was swept after an hour and — worse — deleted
 *  outright the moment the first fetch succeeded. So there was never anything
 *  to refresh WITH: the balance a user saw was frozen at the minute they
 *  connected, and the only way forward was to reconnect the bank by hand.
 *
 *  A day longer than the consent, so the row outlives the thing it describes
 *  and the screen can say "this consent expired, reconnect" instead of the row
 *  vanishing and the app saying nothing at all. */
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const CONSENT_DAYS = 89;

/* Verversen kost quotum bij Enable Banking en tijd van de functie: per sessie
 * één saldo-aanroep en tot twintig transactiepagina's PER REKENING. De
 * agent-routes worden al zo begrensd, en dit is dezelfde soort knop — één die
 * iemand kan blijven indrukken. Zes per minuut per beller is ruim voor een
 * mens en krap voor een lus.
 *
 * Injecteerbaar, zoals de agent-routes hun model injecteren: een limiet op
 * moduleniveau is één emmer voor de hele testsuite, en dan bepaalt de VOLGORDE
 * van de tests of de laatste er nog in past. */
export const EB_REFRESH_PER_MINUTE = 6;

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
  /** Defaults to EB_REFRESH_PER_MINUTE per caller per minute. */
  refreshLimit?: RateLimiter;
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
  const refreshLimit =
    dependencies.refreshLimit ?? createRateLimiter(EB_REFRESH_PER_MINUTE, 60_000);
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
        access: { valid_until: validUntil(CONSENT_DAYS) },
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
      const aspspName = data.aspsp?.name ?? "";
      await store.putSession(authorised.userId, data.session_id, {
        accounts: data.accounts ?? [],
        aspsp: aspspName,
        validUntil: validUntil(CONSENT_DAYS),
      });
      /* ONE LIVE ROW PER BANK. Every authorisation mints a fresh session_id and
       * `putSession` upserts on that id alone, so without this a user who
       * reconnects ING four times keeps four live consents — and the refresh
       * path would then call the bank once per account FOUR times over,
       * burning quota and the function's time budget on three answers it
       * throws away. Superseding on reconnect is also what makes "reconnect
       * this bank" a complete fix for an expired consent. */
      for (const old of await store.listSessions(authorised.userId, SESSION_TTL_MS)) {
        if (old.sessionId !== data.session_id && old.payload.aspsp === aspspName)
          await store.deleteSession(authorised.userId, old.sessionId);
      }
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
    try {
      const items = await fetchSessionItems(cfg, session);
      /* THE SESSION STAYS. It used to be deleted here — "one-shot: data
         delivered" — which is why a connected bank could never be re-read.
         The consent is good for CONSENT_DAYS; throwing away our half of it
         after one fetch made every balance a snapshot of the minute it was
         connected. Disconnecting is now an explicit act, not a side effect of
         succeeding. */
      return c.json({ aspsp: session.aspsp, items });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 502);
    }
  });

  /* RE-READ EVERY LIVE CONNECTION. The answer to "my balance is from the day I
   * connected": the consent lasts CONSENT_DAYS, so within that window this is
   * just the same read again.
   *
   * THREE OUTCOMES, AND THEY ARE DIFFERENT SENTENCES. Refreshed is obvious.
   * Expired means the consent lapsed and the only way forward is to reconnect
   * that bank — reported by name, never silently skipped, because a balance
   * that has quietly stopped updating is worse than one that says so. Failed
   * is the bank being unreachable, which is worth retrying.
   *
   * A dead consent is also PRUNED here. `sweepSessions` only ever fires when
   * someone starts a new authorisation, so without this a user who never
   * connects another bank would keep a dead row for the full TTL. */
  app.post("/api/eb/refresh", async (c) => {
    const cfg = loadConfig();
    if (!cfg.configured)
      return c.json({ error: "Enable Banking is nog niet geconfigureerd op de server." }, 503);
    const userId = await tenantId(c.req.raw);
    if (!userId) return c.json({ error: "Log in om je rekeningen te verversen." }, 401);
    if (!refreshLimit(rateLimitKey("eb-refresh", userId, c.req.header("x-forwarded-for"))))
      return c.json({ error: "Even wachten — te veel verversverzoeken.", code: "eb-rate-limited" }, 429);
    const sessions = await store.listSessions(userId, SESSION_TTL_MS);
    if (sessions.length === 0) return c.json({ refreshed: [], expired: [], failed: [] });

    const now = Date.now();
    const refreshed: Array<{ aspsp: string; items: unknown[] }> = [];
    const expired: string[] = [];
    const failed: Array<{ aspsp: string; error: string }> = [];
    for (const { sessionId, payload, createdAt } of sessions) {
      if (!consentLive(payload, createdAt, now)) {
        expired.push(payload.aspsp);
        await store.deleteSession(userId, sessionId);
        continue;
      }
      try {
        refreshed.push({ aspsp: payload.aspsp, items: await fetchSessionItems(cfg, payload) });
      } catch (e) {
        /* THE BANK'S OWN WORDS DO NOT REACH THE BROWSER. `errMsg` is bare
           `e.message`, and on this path that can be 400 bytes of upstream body
           or — from the JWT signer — an absolute path to the private key on
           this server. It was already reachable once per connect; a refresh
           button makes it a thing any tenant can press repeatedly. The detail
           is logged, the screen gets a sentence. */
        if (isConsentRejection(e)) {
          expired.push(payload.aspsp);
          await store.deleteSession(userId, sessionId);
        } else {
          console.error("eb refresh failed", { aspsp: payload.aspsp, error: errMsg(e) });
          failed.push({ aspsp: payload.aspsp, error: "unreachable" });
        }
      }
    }
    return c.json({ refreshed, expired, failed });
  });

}


/** Balances + a year of transactions for every account in one session.
 *
 *  Lifted out of the `/accounts` route so the refresh path runs EXACTLY this
 *  and not a second copy of it. The two used to be one route, and the moment
 *  there were two ways to read a bank the interesting bug would have been the
 *  drift between them. */
async function fetchSessionItems(
  cfg: EbConfig,
  session: EbSession,
): Promise<Array<{ account: unknown; balances: unknown[]; transactions: unknown[] }>> {
  const dateFrom = isoDaysAgo(365);
  const cc = clientConfig(cfg);
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
  return items;
}

/** When this consent runs out, in epoch ms — derived when it was not recorded.
 *
 *  Every session stored before `validUntil` existed has none. Treating those
 *  as live forever was the tempting default and the wrong one: the consent
 *  really does die after CONSENT_DAYS, so such a row would be retried on every
 *  refresh until the row itself aged out, and the user would be told the bank
 *  had failed rather than that their consent had lapsed. The row's own
 *  `created_at` is the honest stand-in, because that IS the day we asked for
 *  the consent. */
export function consentExpiresAt(session: EbSession, createdAt: string): number {
  const stated = session.validUntil ? Date.parse(session.validUntil) : NaN;
  if (!Number.isNaN(stated)) return stated;
  const created = Date.parse(createdAt);
  return Number.isNaN(created) ? Infinity : created + CONSENT_DAYS * 86_400_000;
}

export function consentLive(session: EbSession, createdAt: string, now: number): boolean {
  return consentExpiresAt(session, createdAt) > now;
}

/** A bank refusing our credentials means the consent is gone, not that the
 *  bank is broken — and those two need different words in front of the user:
 *  one says "reconnect", the other says "try later". */
function isConsentRejection(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  return status === 401 || status === 403;
}

/* RESOLVED PER REQUEST, NOT AT MODULE LOAD — and this is not a refinement,
 * it is the fix for routes that had stopped existing.
 *
 * `753b48e` ("scope Neon pools to each request") made `runtimeDatabase()` read
 * an AsyncLocalStorage scope established by `withRuntimeDatabase` around
 * `app.fetch`. This factory runs at module load, where there is no request and
 * therefore no scope, so it began returning null — and `index.ts`'s
 * `if (ebDependencies) registerEbRoutes(...)` quietly skipped EVERY Enable
 * Banking route. /auth, /callback and /accounts stopped being registered at
 * all, and because apiGuard answers 401 before routing, a missing route is
 * indistinguishable from a missing session. It reads as "log in again".
 *
 * So the store is a facade that resolves the database on each CALL, inside the
 * request, and registration is now unconditional. A call with no database
 * throws rather than returning a plausible empty answer: this store holds the
 * two intermediate states of a bank authorisation, and inventing "no pending
 * auth" would silently abandon a consent the user just gave. */
function requestScopedEbStore(): EbFlowStore {
  const repository = (): EbFlowStore => {
    const database = runtimeDatabase();
    if (!database) throw new Error("geen database in dit verzoek");
    return createEbFlowRepository(database) as EbFlowStore;
  };
  return {
    startAuth: (state, pending) => repository().startAuth(state, pending),
    consumeAuth: (state, ttlMs) => repository().consumeAuth(state, ttlMs),
    sweepAuth: (ttlMs) => repository().sweepAuth(ttlMs),
    sweepSessions: (userId, ttlMs) => repository().sweepSessions(userId, ttlMs),
    putSession: (userId, sessionId, payload) => repository().putSession(userId, sessionId, payload),
    getSession: (userId, sessionId, ttlMs) => repository().getSession(userId, sessionId, ttlMs),
    listSessions: (userId, ttlMs) => repository().listSessions(userId, ttlMs),
    deleteSession: (userId, sessionId) => repository().deleteSession(userId, sessionId),
  };
}

/** Wiring for the real server: Neon storage, session identity. */
export function ebRouteDependencies(): EbRouteDependencies {
  return { store: requestScopedEbStore(), tenantId: investingTenantId };
}
