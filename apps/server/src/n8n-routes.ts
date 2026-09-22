import type { Hono } from "hono";
import { loadN8nQueueConfig } from "./config.js";
import { createN8nForwardingRepository, type N8nForwardingWrite } from "@lavega/database";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import { investingTenantId } from "./investing-mount.js";

/* The invoice-queue proxy. Moved off a direct browser-to-n8n call
 * (docs/adr/0006-invoice-queue-server-proxy.md) so a user configures nothing:
 * the server holds the n8n credential and derives `queueKey` from the caller's
 * OWN session, never from anything the request carries.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: nothing below ever reads a `key`
 * off the request (query, body, or otherwise). n8n partitions its queue
 * store by that key, and reading it DESTROYS the bucket it returns
 * (packages/core/src/n8n/queue.js's `drainQueue`) — there is no second chance
 * to notice a leaked key. `localPart` comes from exactly one place: the
 * caller's row in `personal.n8n_forwarding`, looked up by the session's own
 * user id. */

/** n8n answers from a workflow, not a CDN; generous, but not unbounded. */
const N8N_TIMEOUT_MS = 20_000;

export type N8nRouteDependencies = {
  /** The signed-in user, or null. Never read from the request's own body. */
  tenantId: (request: Request) => Promise<string | null>;
  getLocalPart: (userId: string) => Promise<string | null>;
  setLocalPart: (userId: string, localPart: string) => Promise<N8nForwardingWrite>;
  fetchImpl?: typeof fetch;
};

export function registerN8nRoutes(app: Hono, dependencies: N8nRouteDependencies): void {
  const { tenantId, getLocalPart, setLocalPart } = dependencies;
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  /* WHETHER THE SERVER HAS ITS CREDENTIAL, AND NOTHING ELSE.
   *
   * `/api/n8n/queue` is closed by default, so apiGuard answers 401 to an
   * unauthenticated caller BEFORE the handler's config check runs. That makes
   * "the variables are missing" and "you are not signed in" indistinguishable
   * from outside, and the question came up on three separate deploys — each
   * time answerable only by signing in and reading an error message.
   *
   * A boolean settles it. This returns exactly what `/api/eb/status` and
   * `/api/agent/status` already return for their own credentials: whether the
   * server has one. Never the URL, never the token, never whose queue. */
  app.get("/api/n8n/status", (c) => c.json({ configured: loadN8nQueueConfig().configured }));

  app.get("/api/n8n/queue", async (c) => {
    const cfg = loadN8nQueueConfig();
    if (!cfg.configured || !cfg.url || !cfg.token)
      return c.json(
        {
          error: "De factuur-wachtrij is niet ingesteld op de server.",
          code: "n8n-not-configured",
        },
        503,
      );

    const userId = await tenantId(c.req.raw);
    if (!userId)
      return c.json(
        { error: "Log in om je facturen op te halen.", code: "n8n-queue-unauthenticated" },
        401,
      );

    const localPart = await getLocalPart(userId);
    // No address on file: an empty, explicitly-flagged queue — never a fetch
    // to n8n with no key, which would fall through to `OWNER_KEY` on n8n's
    // side and hand a brand new user the owner's own invoices.
    if (!localPart) return c.json({ invoices: [], notices: [], noAddress: true });

    /* A MALFORMED URL IS AN OPERATOR ERROR, and there is already a shape for
     * that. Outside the try below this threw an unhandled 500, which the client
     * maps to "did the workflow not start?" — pointing the reader at n8n for a
     * mistake in our own environment. */
    let target: URL;
    try {
      target = new URL(cfg.url);
    } catch {
      return c.json(
        { error: "De n8n-URL op de server is ongeldig.", code: "n8n-misconfigured-url" },
        503,
      );
    }
    target.searchParams.set("key", localPart);

    let res: Response;
    try {
      res = await fetchImpl(target.toString(), {
        method: "GET",
        headers: { "x-lavega-token": cfg.token },
        /* THE ONLY OUTBOUND CALL HERE WHOSE UPSTREAM DELETES WHAT IT RETURNS,
         * and it was the only one in this server without a timeout — bankNl,
         * fx, fxHistory and rates all carry one. Without it a slow n8n hangs
         * the function until the platform kills it, long after `drainQueue`
         * emptied the bucket, and the reader is told nothing was fetched. A
         * bounded wait does not save those rows, but it turns an indefinite
         * hang into one failure the client can name. */
        signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
      });
    } catch {
      return c.json({ error: "Kon n8n niet bereiken.", code: "n8n-unreachable" }, 502);
    }
    // n8n's own answer never becomes THIS route's 401/403: that status is
    // reserved above for "you are signed out of LaVega". An upstream refusal
    // here is a server/operator fault (the shared token, or n8n itself), and
    // reads as one — never as the browser's own session lapsing.
    if (!res.ok)
      return c.json(
        { error: `n8n antwoordde met status ${res.status}.`, code: "n8n-upstream-error" },
        502,
      );

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return c.json({ error: "Onleesbaar antwoord van n8n.", code: "n8n-unreadable" }, 502);
    }
    return c.json(body as Record<string, unknown>);
  });

  app.get("/api/n8n/forward-address", async (c) => {
    const userId = await tenantId(c.req.raw);
    if (!userId)
      return c.json(
        {
          error: "Log in om je doorstuuradres te zien.",
          code: "n8n-forward-address-read-unauthenticated",
        },
        401,
      );
    const localPart = await getLocalPart(userId);
    return c.json({ localPart });
  });

  app.post("/api/n8n/forward-address", async (c) => {
    const userId = await tenantId(c.req.raw);
    if (!userId)
      return c.json(
        {
          error: "Log in om een doorstuuradres in te stellen.",
          code: "n8n-forward-address-write-unauthenticated",
        },
        401,
      );
    const body: { localPart?: unknown } = await c.req
      .json<{ localPart?: unknown }>()
      .catch(() => ({}));
    const raw = typeof body.localPart === "string" ? body.localPart : "";
    const outcome = await setLocalPart(userId, raw);
    if (outcome.status === "invalid")
      return c.json(
        {
          error: "Dat is geen geldig lokaal deel van een e-mailadres.",
          code: "n8n-address-invalid",
        },
        400,
      );
    if (outcome.status === "taken")
      return c.json(
        { error: "Dit adres is al bij een ander account in gebruik.", code: "n8n-address-taken" },
        409,
      );
    return c.json({ localPart: outcome.localPart });
  });
}

/** Wiring for the real server: Neon storage, session identity. */
/* RESOLVED PER REQUEST, for the same reason as eb-routes.ts — see the longer
 * note there. `753b48e` made `runtimeDatabase()` request-scoped; this factory
 * runs at module load, so it returned null and `index.ts` skipped every n8n
 * route. `/api/n8n/status` is the only one public enough to get past apiGuard,
 * and in production it answered Hono's own 404: the routes were not merely
 * unconfigured, they did not exist.
 *
 * A call with no database throws rather than answering. `getLocalPart`
 * returning null would read as "this user has no forwarding address", which is
 * a real state with real consequences — the queue route treats it as "return
 * an empty queue" — so a missing database must not be able to impersonate it. */
export function n8nRouteDependencies(): N8nRouteDependencies {
  const repository = () => {
    const database = runtimeDatabase();
    if (!database) throw new Error("geen database in dit verzoek");
    return createN8nForwardingRepository(database);
  };
  return {
    tenantId: investingTenantId,
    getLocalPart: (userId) => repository().getLocalPart(userId),
    setLocalPart: (userId, localPart) => repository().setLocalPart(userId, localPart),
  };
}
