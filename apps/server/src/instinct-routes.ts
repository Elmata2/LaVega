import type { Context, Hono } from "hono";
import {
  assertAgentConfig,
  assertWhatsappConfig,
  createAgentRepository,
  createEbFlowRepository,
  UnreadableAgentDataError,
  type AgentChannel,
  type AgentMirror,
  type AgentRepository,
  type AgentSettings,
} from "@lavega/database";
import {
  credentialsArePerTenant,
  requireRuntimeDatabase,
} from "@lavega/investing-server/src/credentialStore.js";
import { consentLive, SESSION_TTL_MS, type EbSession } from "./eb-routes.js";
import { investingTenantId } from "./investing-mount.js";
import { CONSENT_VERSION } from "./instinctConsent.js";
import { maskPhone } from "./whatsapp/linking.js";

export { CONSENT_VERSION } from "./instinctConsent.js";

/* The agent's own routes: settings, the browser mirror, push subscriptions and
 * the feed. Every one is behind a session and bound to that session's tenant.
 * Bodies are checked here, at the boundary, with exact key sets: the mirror in
 * particular never takes a transaction, an IBAN or an amount (the one number it
 * accepts is the card offer's yearly gain), and an unknown key is a rejection,
 * not something silently dropped. */

export const MAX_MIRROR_RULES = 500;
export const MAX_MIRROR_DUE_DATES = 100;
export const MAX_YEARLY_GAIN_CENTS = 100_000_000;
const MAX_TEXT = 200;
const MAX_ID = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FEED_LIMIT = 100;
const FEED_CHANNELS: readonly AgentChannel[] = ["feed", "push", "email", "whatsapp"];
const SETTINGS_CHANNELS: readonly AgentChannel[] = ["feed", "push", "email", "whatsapp"];

export type InstinctRouteDependencies = {
  tenantId: (request: Request) => Promise<string | null>;
  repository: (tenantId: string) => AgentRepository;
  /** At least one bank consent that has not expired. */
  bankConnected: (tenantId: string) => Promise<boolean>;
  now?: () => Date;
  /** Defaults to assertAgentConfig; runs per request, never at boot. */
  assertConfig?: () => void;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const hasOnly = (o: Obj, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const isDay = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
};

export function parseMirror(body: unknown): AgentMirror | null {
  if (!isObj(body) || !hasOnly(body, ["rules", "dueDates", "cardOffer"])) return null;
  const { rules, dueDates, cardOffer } = body;
  if (!Array.isArray(rules) || rules.length > MAX_MIRROR_RULES) return null;
  if (!Array.isArray(dueDates) || dueDates.length > MAX_MIRROR_DUE_DATES) return null;

  const outRules: AgentMirror["rules"] = [];
  for (const r of rules) {
    if (!isObj(r) || !hasOnly(r, ["id", "match", "category"])) return null;
    if (!text(r.id, MAX_ID) || !text(r.match, MAX_TEXT) || !text(r.category, MAX_ID)) return null;
    outRules.push({ id: r.id, match: r.match, category: r.category });
  }
  const outDue: AgentMirror["dueDates"] = [];
  for (const d of dueDates) {
    if (!isObj(d) || !hasOnly(d, ["kind", "label", "date"])) return null;
    if ((d.kind !== "vat" && d.kind !== "other") || !text(d.label, MAX_TEXT) || !isDay(d.date))
      return null;
    outDue.push({ kind: d.kind, label: d.label, date: d.date });
  }
  let outCard: AgentMirror["cardOffer"] = null;
  if (cardOffer !== null) {
    if (!isObj(cardOffer) || !hasOnly(cardOffer, ["name", "yearlyGainCents", "computedAt"]))
      return null;
    const { name, yearlyGainCents, computedAt } = cardOffer;
    if (!text(name, MAX_TEXT)) return null;
    if (
      typeof yearlyGainCents !== "number" ||
      !Number.isInteger(yearlyGainCents) ||
      yearlyGainCents < 0 ||
      yearlyGainCents > MAX_YEARLY_GAIN_CENTS
    )
      return null;
    if (!isDay(computedAt)) return null;
    outCard = { name, yearlyGainCents, computedAt };
  }
  return { rules: outRules, dueDates: outDue, cardOffer: outCard };
}

type SettingsInput = Omit<AgentSettings, "consentedAt">;

function parseSettings(
  body: unknown,
): { enabled: false } | { enabled: true; value: SettingsInput } | null {
  if (!isObj(body) || typeof body.enabled !== "boolean") return null;
  if (!body.enabled) return { enabled: false };
  if (!hasOnly(body, ["enabled", "channels", "sendHour", "locale", "email", "consentVersion"]))
    return null;
  const { channels, sendHour, locale, email, consentVersion } = body;
  if (
    !Array.isArray(channels) ||
    channels.length === 0 ||
    channels.length > SETTINGS_CHANNELS.length
  )
    return null;
  const unique = [...new Set(channels)];
  if (unique.length !== channels.length) return null;
  if (!unique.every((c): c is AgentChannel => SETTINGS_CHANNELS.includes(c as AgentChannel)))
    return null;
  if (typeof sendHour !== "number" || !Number.isInteger(sendHour) || sendHour < 0 || sendHour > 23)
    return null;
  if (locale !== "nl" && locale !== "en") return null;
  let mail: string | null = null;
  if (email !== null && email !== undefined) {
    if (
      typeof email !== "string" ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
      return null;
    mail = email;
  }
  if (unique.includes("email") && mail === null) return null;
  if (typeof consentVersion !== "string") return null;
  // The feed is the stored record of what went out. A send that reports "failed" but was
  // delivered must still find that record, so the feed is always on (added silently).
  const stored: AgentChannel[] = unique.includes("feed") ? unique : ["feed", ...unique];
  return {
    enabled: true,
    value: { enabled: true, channels: stored, sendHour, locale, email: mail, consentVersion },
  };
}

function parsePush(body: unknown): PushSubscriptionJSON | null {
  if (!isObj(body) || !hasOnly(body, ["endpoint", "expirationTime", "keys"])) return null;
  const { endpoint, expirationTime, keys } = body;
  if (typeof endpoint !== "string" || endpoint.length > 2000) return null;
  try {
    if (new URL(endpoint).protocol !== "https:") return null;
  } catch {
    return null;
  }
  if (!isObj(keys) || !hasOnly(keys, ["p256dh", "auth"])) return null;
  if (!text(keys.p256dh, 200) || !text(keys.auth, 100)) return null;
  if (expirationTime !== null && expirationTime !== undefined && typeof expirationTime !== "number")
    return null;
  return {
    endpoint,
    expirationTime: (expirationTime as number | null | undefined) ?? null,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

/** A missing or malformed key (assertAgentConfig, the dedupe HMAC, the encryption key). */
const isConfigError = (error: unknown): boolean =>
  error instanceof Error &&
  /AGENT_DEDUPE_HMAC_KEY|AGENT_PHONE_HMAC_KEY|LAVEGA_ENCRYPTION_KEY/.test(error.message);

export function registerInstinctRoutes(app: Hono, deps: InstinctRouteDependencies): void {
  const now = deps.now ?? (() => new Date());
  const assertConfig = deps.assertConfig ?? assertAgentConfig;
  const unauthorised = { problems: ["Authentication is required"] };

  /* Everything here is one person's, so none of it may sit in a shared cache. */
  app.use("/api/agent/*", async (c, next) => {
    if (c.req.path === "/api/agent/status" || c.req.path === "/api/agent/extract-invoice")
      return next();
    c.header("Cache-Control", "private, no-store");
    return next();
  });

  /** Runs `fn` for the session's tenant; maps the two shared failures. */
  async function withAgent(
    c: Context,
    fn: (repo: AgentRepository, tenantId: string) => Promise<Response>,
  ): Promise<Response> {
    const tenantId = await deps.tenantId(c.req.raw);
    if (!tenantId) return c.json(unauthorised, 401);
    try {
      assertConfig();
      return await fn(deps.repository(tenantId), tenantId);
    } catch (error) {
      if (error instanceof UnreadableAgentDataError)
        return c.json({ problems: ["Agent data unreadable"], code: "agent-data-unreadable" }, 500);
      if (isConfigError(error)) {
        // The message names a variable, never its value; only the kind is logged.
        console.log(
          JSON.stringify({ event: "instinct.misconfigured", kind: (error as Error).name }),
        );
        return c.json({ problems: ["Agent is not configured"], code: "agent-not-configured" }, 503);
      }
      throw error;
    }
  }

  const readBody = (request: Request): Promise<unknown> => request.json().catch(() => undefined);

  app.get("/api/agent/settings", (c) =>
    withAgent(c, async (repo, tenantId) =>
      c.json({
        settings: await repo.getSettings(),
        bankConnected: await deps.bankConnected(tenantId),
        consentVersion: CONSENT_VERSION,
        /* Public by design: the browser needs it to subscribe to push. */
        vapidPublicKey: process.env.VAPID_PUBLIC_KEY?.trim() || null,
      }),
    ),
  );

  app.put("/api/agent/settings", (c) =>
    withAgent(c, async (repo, tenantId) => {
      const parsed = parseSettings(await readBody(c.req.raw));
      if (!parsed) return c.json({ problems: ["Invalid settings"], code: "invalid" }, 400);
      if (!parsed.enabled) {
        await repo.deleteAll();
        return c.body(null, 204);
      }
      const { value } = parsed;
      if (value.consentVersion !== CONSENT_VERSION)
        return c.json({ problems: ["Consent is out of date"], code: "consent-required" }, 400);
      if (!(await deps.bankConnected(tenantId)))
        return c.json({ problems: ["Connect a bank first"], code: "bank-required" }, 409);
      const prior = await repo.getSettings();
      const keepsConsent =
        prior?.enabled === true &&
        prior.consentVersion === CONSENT_VERSION &&
        prior.consentedAt !== null;
      const settings: AgentSettings = {
        ...value,
        consentedAt: keepsConsent ? prior.consentedAt : now().toISOString(),
      };
      await repo.putSettings(settings);
      return c.json({ settings });
    }),
  );

  const isEnabled = async (repo: AgentRepository) => (await repo.getSettings())?.enabled === true;
  const off = (c: Context) =>
    c.json({ problems: ["The daily message is off"], code: "agent-off" }, 409);

  app.put("/api/agent/mirror", (c) =>
    withAgent(c, async (repo) => {
      if (!(await isEnabled(repo))) return off(c);
      const mirror = parseMirror(await readBody(c.req.raw));
      if (!mirror) return c.json({ problems: ["Invalid mirror"], code: "invalid" }, 400);
      // "skipped" = turned off since the check above: nothing was written.
      if ((await repo.putMirror(mirror)) === "skipped") return off(c);
      return c.body(null, 204);
    }),
  );

  app.delete("/api/agent/mirror", (c) =>
    withAgent(c, async (repo) => {
      await repo.putMirror({ rules: [], dueDates: [], cardOffer: null });
      return c.body(null, 204);
    }),
  );

  app.post("/api/agent/push", (c) =>
    withAgent(c, async (repo) => {
      if (!(await isEnabled(repo))) return off(c);
      const sub = parsePush(await readBody(c.req.raw));
      if (!sub) return c.json({ problems: ["Invalid subscription"], code: "invalid" }, 400);
      if ((await repo.putPush(sub)) === "skipped") return off(c);
      return c.body(null, 204);
    }),
  );

  app.delete("/api/agent/push", (c) =>
    withAgent(c, async (repo) => {
      const body = await readBody(c.req.raw);
      if (!isObj(body) || !hasOnly(body, ["endpoint"]) || !text(body.endpoint, 2000))
        return c.json({ problems: ["Invalid request"], code: "invalid" }, 400);
      await repo.deletePush(body.endpoint);
      return c.body(null, 204);
    }),
  );

  /* WhatsApp link. The number is only ever shown masked (last two digits). */
  app.post("/api/agent/whatsapp/link-code", (c) =>
    withAgent(c, async (repo) => {
      if (!(await isEnabled(repo))) return off(c);
      assertWhatsappConfig();
      /* WhatsApp questions go to the AI provider (Mistral, EU) to pick a calculation. That is
       * a separate agreement from the daily message, so the code is refused without it. */
      const body = await readBody(c.req.raw);
      if (!isObj(body) || !hasOnly(body, ["aiConsent"]) || body.aiConsent !== true)
        return c.json(
          { problems: ["AI consent is required to link WhatsApp"], code: "ai-consent-required" },
          400,
        );
      const created = await repo.createLinkCode();
      if (created === "skipped") return off(c);
      const { code, expiresAt } = created;
      return c.json({
        code,
        expiresAt,
        number: process.env.WHATSAPP_NUMBER_DISPLAY?.trim() || null,
      });
    }),
  );

  app.get("/api/agent/whatsapp", (c) =>
    withAgent(c, async (repo) => {
      const link = await repo.getLink();
      return c.json({
        linked: link !== null,
        phone: link ? maskPhone(link.phone) : null,
        linkedAt: link?.linkedAt ?? null,
        number: process.env.WHATSAPP_NUMBER_DISPLAY?.trim() || null,
      });
    }),
  );

  app.delete("/api/agent/whatsapp", (c) =>
    withAgent(c, async (repo) => {
      await repo.unlink();
      return c.body(null, 204);
    }),
  );

  app.get("/api/agent/feed", (c) =>
    withAgent(c, async (repo) => {
      const channelRaw = c.req.query("channel");
      if (channelRaw !== undefined && !FEED_CHANNELS.includes(channelRaw as AgentChannel))
        return c.json({ problems: ["Invalid channel"], code: "invalid" }, 400);
      const limitRaw = c.req.query("limit");
      const limit = limitRaw === undefined ? 50 : Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FEED_LIMIT)
        return c.json({ problems: ["Invalid limit"], code: "invalid" }, 400);
      let before: { createdAt: string; id: string } | undefined;
      const beforeRaw = c.req.query("before");
      if (beforeRaw !== undefined) {
        const cut = beforeRaw.indexOf("_");
        const createdAt = beforeRaw.slice(0, cut);
        const id = beforeRaw.slice(cut + 1);
        if (cut < 1 || !UUID.test(id) || Number.isNaN(Date.parse(createdAt)))
          return c.json({ problems: ["Invalid cursor"], code: "invalid" }, 400);
        before = { createdAt, id };
      }
      const events = await repo.listEvents({
        ...(channelRaw ? { channel: channelRaw as AgentChannel } : {}),
        limit,
        ...(before ? { before } : {}),
      });
      const last = events.at(-1);
      return c.json({
        events,
        next: events.length === limit && last ? `${last.createdAt}_${last.id}` : null,
      });
    }),
  );

  app.delete("/api/agent/events/:id", (c) =>
    withAgent(c, async (repo) => {
      const id = c.req.param("id");
      if (!UUID.test(id)) return c.json({ problems: ["Not found"] }, 404);
      if (!(await repo.deleteEvent(id))) return c.json({ problems: ["Not found"] }, 404);
      return c.body(null, 204);
    }),
  );

  app.delete("/api/agent/conversation/:channel", (c) =>
    withAgent(c, async (repo) => {
      const channel = c.req.param("channel");
      if (!FEED_CHANNELS.includes(channel as AgentChannel))
        return c.json({ problems: ["Invalid channel"], code: "invalid" }, 400);
      return c.json({ deleted: await repo.deleteConversation(channel as AgentChannel) });
    }),
  );
}

export function instinctRouteDependencies(): InstinctRouteDependencies | null {
  if (!credentialsArePerTenant()) return null;
  // Config is checked per request (503), so a missing key never stops the server.
  return {
    tenantId: investingTenantId,
    repository: (tenantId) => createAgentRepository(requireRuntimeDatabase(), tenantId),
    bankConnected: async (tenantId) => {
      const sessions = await createEbFlowRepository(
        requireRuntimeDatabase(),
      ).listSessions<EbSession>(tenantId, SESSION_TTL_MS);
      const at = Date.now();
      return sessions.some((s) => consentLive(s.payload, s.createdAt, at));
    },
  };
}
