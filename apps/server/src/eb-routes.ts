import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { loadConfig, type EbConfig } from "./config.js";
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

type PendingAuth = { name: string; country: string; ts: number };
type EbSession = { accounts: Array<Record<string, unknown>>; aspsp: string; ts: number };

// In-memory (single-user personal app). Lost on restart — the user just
// reconnects. Short TTLs so nothing lingers.
const pending = new Map<string, PendingAuth>();
const sessions = new Map<string, EbSession>();
const PENDING_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;

function sweep<T extends { ts: number }>(store: Map<string, T>, ttl: number): void {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.ts > ttl) store.delete(k);
}

function clientConfig(cfg: EbConfig): EbClientConfig {
  return { applicationId: cfg.applicationId, privateKey: cfg.privateKey, privateKeyFile: cfg.privateKeyFile };
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

export function registerEbRoutes(app: Hono): void {
  // Bank list for the picker (defaults to NL). Public-ish metadata only.
  app.get("/api/eb/aspsps", async (c) => {
    const cfg = loadConfig();
    if (!cfg.configured) return c.json({ error: "Enable Banking is nog niet geconfigureerd op de server." }, 503);
    const country = (c.req.query("country") || "NL").toUpperCase();
    try {
      const data = (await eb(clientConfig(cfg), "GET", `/aspsps?country=${country}&psu_type=${cfg.psuType}`)) as {
        aspsps?: Array<{ name?: string; country?: string; logo?: string }>;
      };
      const aspsps = (data.aspsps ?? []).map((a) => ({ name: a.name, country: a.country, logo: a.logo }));
      return c.json({ aspsps });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 502);
    }
  });

  // Start authorisation: returns the bank's authorization URL for the client to
  // redirect the browser to.
  app.post("/api/eb/auth", async (c) => {
    const cfg = loadConfig();
    if (!cfg.configured) return c.json({ error: "Enable Banking is nog niet geconfigureerd op de server." }, 503);
    sweep(pending, PENDING_TTL_MS);
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; country?: string };
    const name = body.name;
    const country = (body.country || "NL").toUpperCase();
    if (!name) return c.json({ error: "Kies een bank (name ontbreekt)." }, 400);
    const state = randomUUID();
    try {
      const data = (await eb(clientConfig(cfg), "POST", "/auth", {
        access: { valid_until: validUntil(89) },
        aspsp: { name, country },
        state,
        redirect_url: cfg.redirectUrl,
        psu_type: cfg.psuType,
      })) as { url?: string };
      if (!data.url) return c.json({ error: "Geen autorisatie-URL ontvangen van Enable Banking." }, 502);
      pending.set(state, { name, country, ts: Date.now() });
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
    if (error) return c.redirect(`/?eb_error=${encodeURIComponent(c.req.query("error_description") || error)}`);
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code) return c.redirect(`/?eb_error=${encodeURIComponent("Geen autorisatiecode ontvangen.")}`);
    if (state) pending.delete(state); // one-shot
    try {
      const data = (await eb(clientConfig(cfg), "POST", "/sessions", { code })) as {
        session_id?: string;
        accounts?: Array<Record<string, unknown>>;
        aspsp?: { name?: string };
      };
      if (!data.session_id) return c.redirect(`/?eb_error=${encodeURIComponent("Geen sessie ontvangen.")}`);
      sweep(sessions, SESSION_TTL_MS);
      sessions.set(data.session_id, { accounts: data.accounts ?? [], aspsp: data.aspsp?.name ?? "", ts: Date.now() });
      return c.redirect(`/?eb=${encodeURIComponent(data.session_id)}`);
    } catch (e) {
      return c.redirect(`/?eb_error=${encodeURIComponent(errMsg(e))}`);
    }
  });

  // Fetch balances + transactions for the session's accounts and relay the RAW
  // bank JSON to the client (which maps + stores it locally).
  app.get("/api/eb/accounts", async (c) => {
    const cfg = loadConfig();
    if (!cfg.configured) return c.json({ error: "Enable Banking is nog niet geconfigureerd op de server." }, 503);
    const sessionId = c.req.query("session_id") || "";
    const session = sessions.get(sessionId);
    if (!session) return c.json({ error: "Sessie onbekend of verlopen — koppel de bank opnieuw." }, 404);
    const dateFrom = isoDaysAgo(365);
    const cc = clientConfig(cfg);
    try {
      const items = [];
      for (const account of session.accounts) {
        const uid = String((account as { uid?: string }).uid || "");
        if (!uid) continue;
        const balancesRes = (await eb(cc, "GET", `/accounts/${uid}/balances`)) as { balances?: unknown[] };
        // Transactions are paginated via continuation_key; follow it (capped).
        const transactions: unknown[] = [];
        let cont: string | undefined;
        for (let page = 0; page < 20; page++) {
          const q = `date_from=${dateFrom}` + (cont ? `&continuation_key=${encodeURIComponent(cont)}` : "");
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
      sessions.delete(sessionId); // one-shot: data delivered
      return c.json({ aspsp: session.aspsp, items });
    } catch (e) {
      return c.json({ error: errMsg(e) }, 502);
    }
  });
}
