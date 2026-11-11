import { createHash, createHmac, randomInt } from "node:crypto";
import type { QueryResultRow } from "@neondatabase/serverless";
import {
  encryptBlob,
  tryDecryptBlob,
  withTenant,
  withTenantStatement,
  type Database,
} from "./index.js";

/*
 * Instinct agent storage (ADR 0014, migration 0038). Free text and payloads are
 * sealed with encryptBlob (ADR 0007) before they reach Neon; the plain columns
 * are only what a query has to filter on. Transactions, balances and IBANs are
 * never stored here.
 *
 * Every repository is bound to one user. That includes `purgeOlderThan`: the
 * nightly job calls it once per tenant, so no statement in this file crosses
 * users.
 */

export type AgentChannel = "feed" | "push" | "email" | "whatsapp";
export type AgentSettings = {
  enabled: boolean;
  channels: AgentChannel[];
  sendHour: number;
  locale: "nl" | "en";
  email: string | null;
  consentVersion: string;
  consentedAt: string | null;
};
export type AgentState = {
  lastSentDate: string | null;
  sentKeys: { key: string; date: string }[];
  lastTipDate: string | null;
  expiryRemindedFor: string | null;
  expiryPausedNoted: boolean;
};
/** Same shape as `Rule` in @lavega/core, which this package does not depend on. */
export type AgentRule = { id: string; match: string; category: string };
export type AgentMirror = {
  rules: AgentRule[];
  dueDates: { kind: "vat" | "other"; label: string; date: string }[];
  cardOffer: { name: string; yearlyGainCents: number; computedAt: string } | null;
};

export type AgentEventType =
  | "message"
  | "approval_request"
  | "approval_response"
  | "action"
  | "action_result"
  | "error";
export type AgentEvent = {
  id: string;
  channel: AgentChannel;
  type: AgentEventType;
  body: { text: string; meta?: Record<string, string | number> };
  createdAt: string;
};

export const EVENT_RETENTION_DAYS = 90;

/** A stored blob exists but cannot be opened (key rotated or data damaged).
 *  Reads throw this instead of answering "empty", and partial writes refuse to
 *  overwrite it: the ciphertext may still be openable with a restored key. */
export class UnreadableAgentDataError extends Error {
  constructor(what: string) {
    super(`Stored agent ${what} cannot be read with the current LAVEGA_ENCRYPTION_KEY`);
    this.name = "UnreadableAgentDataError";
  }
}

const DAY = "YYYY-MM-DD";

const EMPTY_STATE: AgentState = {
  lastSentDate: null,
  sentKeys: [],
  lastTipDate: null,
  expiryRemindedFor: null,
  expiryPausedNoted: false,
};

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

/**
 * The stored form of an event's dedupe key.
 *
 * `agent_events.dedupe_key` is a clear-text column, so it must never hold a
 * merchant name or an amount. The key is HMAC-SHA256 (hex) of the caller's
 * parts under `AGENT_DEDUPE_HMAC_KEY` (32 bytes, 64 hex characters), so equal
 * parts collide and nothing can be read back from the column.
 */
export function agentDedupeKey(parts: readonly string[]): string {
  return createHmac("sha256", dedupeSecret()).update(JSON.stringify(parts)).digest("hex");
}

function dedupeSecret(): Buffer {
  const secret = process.env.AGENT_DEDUPE_HMAC_KEY;
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret))
    throw new Error("AGENT_DEDUPE_HMAC_KEY is required (32 bytes, 64 hex characters)");
  return Buffer.from(secret, "hex");
}

/**
 * The agent needs the dedupe HMAC key and the encryption key. Messages name the
 * variable and never its value. This is a check, not a boot hook: the cron calls
 * it at the start of every run and each agent route calls it on every request, so a
 * missing key fails that request or run closed.
 */
export function assertAgentConfig(): void {
  dedupeSecret();
  const value = process.env.LAVEGA_ENCRYPTION_KEY;
  if (!value) throw new Error("LAVEGA_ENCRYPTION_KEY is required");
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("LAVEGA_ENCRYPTION_KEY must decode to 32 bytes");
}

/*
 * WhatsApp link (migration 0040). The phone number is personal data: it is
 * sealed with encryptBlob, and `phoneHash` (HMAC under AGENT_PHONE_HMAC_KEY) is
 * the only lookup key. Nothing here logs or returns a code, hash or number
 * beyond what the caller asked for.
 */
function phoneSecret(): Buffer {
  const secret = process.env.AGENT_PHONE_HMAC_KEY;
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret))
    throw new Error("AGENT_PHONE_HMAC_KEY is required (32 bytes, 64 hex characters)");
  return Buffer.from(secret, "hex");
}

/** Boot check for the WhatsApp channel: fails closed, never names a value. */
export function assertWhatsappConfig(): void {
  phoneSecret();
}

/** HMAC-SHA256 (hex) of an E.164 number; the lookup key for inbound messages. */
export function phoneHash(e164: string): string {
  return createHmac("sha256", phoneSecret()).update(`phone:${e164}`).digest("hex");
}

/** HMAC-SHA256 (hex) of a link code, case and spacing insensitive. */
export function linkCodeHash(code: string): string {
  return createHmac("sha256", phoneSecret())
    .update(`link-code:${code.trim().toUpperCase()}`)
    .digest("hex");
}

/** No I, L, O, 0 or 1: a code read aloud or typed from a phone screen stays unambiguous. */
export const LINK_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** 31^8 is about 8.5e11 codes. With 5 tries per number per 15 minutes and no global cap,
 *  guessing a live code is not feasible; a global cap would let a few hundred hostile
 *  numbers block everyone's linking. */
export const LINK_CODE_LENGTH = 8;
const LINK_CODE_MINUTES = 15;

function newLinkCode(): string {
  let tail = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++)
    tail += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  return `LV-${tail}`;
}

export type WhatsappLink = {
  phone: string;
  linkedAt: string;
  lastInboundAt: string | null;
  /** When the user agreed that WhatsApp questions go to the AI provider; null = never. */
  aiConsentAt: string | null;
};

/** A write that lands only while the user still has the agent switched on. */
export type WriteResult = "stored" | "skipped";

export type AgentRepository = {
  getSettings(): Promise<AgentSettings | null>;
  putSettings(s: AgentSettings): Promise<void>;
  getState(): Promise<AgentState>;
  /** True for the first caller of a day only; the claim is the "one message a day" lock. It only
   *  moves forward: a day on or before the stored claim is refused. */
  claimDay(today: string): Promise<boolean>;
  releaseDay(today: string): Promise<void>;
  /** "skipped" when the agent is off (or was turned off meanwhile): nothing is written. */
  putState(patch: Partial<AgentState>): Promise<WriteResult>;
  /** True while fewer than `max` fetches were taken today; the count resets on a new day. */
  takeFetchBudget(today: string, max: number): Promise<boolean>;
  getMirror(): Promise<AgentMirror | null>;
  /** "skipped" when the agent is off (or was turned off meanwhile): nothing is written. */
  putMirror(m: AgentMirror): Promise<WriteResult>;
  /** "skipped" when the agent is off (or was turned off meanwhile): nothing is written. */
  putPush(sub: PushSubscriptionJSON): Promise<WriteResult>;
  listPush(): Promise<PushSubscriptionJSON[]>;
  deletePush(endpoint: string): Promise<void>;
  /** A fresh one-time code for linking WhatsApp; replaces any earlier code. Only its HMAC is stored.
   *  Calling it records that the user agreed to AI processing of WhatsApp questions.
   *  "skipped" when the agent is off (or was turned off meanwhile): no code is stored. */
  createLinkCode(): Promise<{ code: string; expiresAt: string } | "skipped">;
  getLink(): Promise<WhatsappLink | null>;
  unlink(): Promise<void>;
  /** Stamp the time of the user's latest inbound WhatsApp message. */
  touchInbound(at: string): Promise<void>;
  /** Settings, state, mirror, push subscriptions, events and WhatsApp link: the turn-off. */
  deleteAll(): Promise<void>;
  /** `dedupeKey` is hashed here with `agentDedupeKey`; pass the plain key. */
  appendEvent(
    e: Omit<AgentEvent, "createdAt"> & { dedupeKey?: string | readonly string[] },
  ): Promise<"stored" | "duplicate" | "skipped">;
  /** Newest first. `before` is the (createdAt, id) of the last event seen (exclusive). */
  listEvents(opts: {
    channel?: AgentChannel;
    limit: number;
    before?: { createdAt: string; id: string };
  }): Promise<AgentEvent[]>;
  deleteEvent(id: string): Promise<boolean>;
  deleteConversation(channel: AgentChannel): Promise<number>;
  /** This user's events older than `days` days. Called once per tenant. */
  purgeOlderThan(days: number): Promise<number>;
};

export function createAgentRepository(
  db: Database,
  userId: string | undefined | null,
): AgentRepository {
  const ME = "current_setting('app.user_id')";
  /* The turn-off race: deleteAll can run between a caller's settings read and its write. Writes
   * that would re-create state or events only happen while an enabled settings row exists.
   * FOR SHARE makes a concurrent deleteAll (which removes the settings row first) wait for
   * this statement, or makes this statement see the row gone. */
  const ENABLED = `EXISTS (SELECT 1 FROM personal.agent_settings gs WHERE gs.user_id = ${ME} AND gs.enabled FOR SHARE)`;

  async function readState(client: {
    query: (t: string, p?: unknown[]) => Promise<{ rows: QueryResultRow[] }>;
  }): Promise<AgentState & { sentKeysUnreadable: boolean }> {
    const result = await client.query(
      `SELECT to_char(last_sent_date, '${DAY}') AS last_sent_date, sent_keys_blob,
              to_char(last_tip_date, '${DAY}') AS last_tip_date,
              to_char(expiry_reminded_for, '${DAY}') AS expiry_reminded_for,
              expiry_paused_noted
       FROM personal.agent_state WHERE user_id = ${ME}`,
    );
    const row = result.rows[0];
    if (!row) return { ...EMPTY_STATE, sentKeys: [], sentKeysUnreadable: false };
    const keys = row.sent_keys_blob
      ? tryDecryptBlob<AgentState["sentKeys"]>(row.sent_keys_blob)
      : null;
    return {
      sentKeysUnreadable: keys?.readable === false,
      lastSentDate: (row.last_sent_date as string | null) ?? null,
      sentKeys: keys?.readable ? keys.value : [],
      lastTipDate: (row.last_tip_date as string | null) ?? null,
      expiryRemindedFor: (row.expiry_reminded_for as string | null) ?? null,
      expiryPausedNoted: Boolean(row.expiry_paused_noted),
    };
  }

  return {
    async getSettings() {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `SELECT enabled, channels_blob, send_hour, locale, email_blob, consent_text_version,
                  consented_at FROM personal.agent_settings WHERE user_id = ${ME}`,
        );
        const row = result.rows[0];
        if (!row) return null;
        const channels = row.channels_blob
          ? tryDecryptBlob<AgentChannel[]>(row.channels_blob as Buffer)
          : null;
        const email = row.email_blob ? tryDecryptBlob<string>(row.email_blob as Buffer) : null;
        if (channels?.readable === false || email?.readable === false)
          throw new UnreadableAgentDataError("settings");
        return {
          enabled: Boolean(row.enabled),
          channels: channels?.readable ? channels.value : [],
          sendHour: Number(row.send_hour),
          locale: row.locale as "nl" | "en",
          email: email?.readable ? email.value : null,
          consentVersion: String(row.consent_text_version ?? ""),
          consentedAt: row.consented_at ? iso(row.consented_at) : null,
        };
      });
    },
    async putSettings(s) {
      const channelsBlob = encryptBlob(s.channels);
      const emailBlob = s.email === null ? null : encryptBlob(s.email);
      await withTenantStatement(db, userId, async (client) => {
        await client.query(
          `INSERT INTO personal.agent_settings
             (user_id, enabled, channels_blob, send_hour, locale, email_blob, consent_text_version, consented_at)
           VALUES (${ME}, $1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id) DO UPDATE SET
             enabled = EXCLUDED.enabled, channels_blob = EXCLUDED.channels_blob,
             send_hour = EXCLUDED.send_hour, locale = EXCLUDED.locale,
             email_blob = EXCLUDED.email_blob,
             consent_text_version = EXCLUDED.consent_text_version,
             consented_at = EXCLUDED.consented_at, updated_at = CURRENT_TIMESTAMP`,
          [
            s.enabled,
            channelsBlob,
            s.sendHour,
            s.locale,
            emailBlob,
            s.consentVersion,
            s.consentedAt,
          ],
        );
      });
    },

    async getState() {
      const { sentKeysUnreadable, ...state } = await withTenant(db, userId, (client) =>
        readState(client),
      );
      if (sentKeysUnreadable) throw new UnreadableAgentDataError("state");
      return state;
    },
    async claimDay(today) {
      return withTenant(db, userId, async (client) => {
        await client.query(
          `INSERT INTO personal.agent_state (user_id) SELECT ${ME} WHERE ${ENABLED}
           ON CONFLICT (user_id) DO NOTHING`,
        );
        const result = await client.query(
          `UPDATE personal.agent_state SET last_sent_date = $1::date
           WHERE user_id = ${ME} AND (last_sent_date IS NULL OR last_sent_date < $1::date)
             AND ${ENABLED}
           RETURNING 1`,
          [today],
        );
        return (result.rows?.length ?? 0) > 0;
      });
    },
    async releaseDay(today) {
      await withTenantStatement(db, userId, async (client) => {
        await client.query(
          `UPDATE personal.agent_state SET last_sent_date = NULL
           WHERE user_id = ${ME} AND last_sent_date = $1::date`,
          [today],
        );
      });
    },
    async putState(patch) {
      return withTenant(db, userId, async (client): Promise<WriteResult> => {
        await client.query(
          `INSERT INTO personal.agent_state (user_id) SELECT ${ME} WHERE ${ENABLED}
           ON CONFLICT (user_id) DO NOTHING`,
        );
        const locked = await client.query(
          `SELECT 1 FROM personal.agent_state WHERE user_id = ${ME} AND ${ENABLED} FOR UPDATE`,
        );
        if ((locked.rows?.length ?? 0) === 0) return "skipped";
        const { sentKeysUnreadable, ...current } = await readState(client);
        // A patch that leaves sentKeys alone must not write a blank over ciphertext it cannot open.
        if (sentKeysUnreadable && patch.sentKeys === undefined)
          throw new UnreadableAgentDataError("state");
        const next = { ...current, ...patch };
        await client.query(
          `UPDATE personal.agent_state SET last_sent_date = $1::date, sent_keys_blob = $2,
             last_tip_date = $3::date, expiry_reminded_for = $4::date, expiry_paused_noted = $5
           WHERE user_id = ${ME}`,
          [
            next.lastSentDate,
            encryptBlob(next.sentKeys),
            next.lastTipDate,
            next.expiryRemindedFor,
            next.expiryPausedNoted,
          ],
        );
        return "stored";
      });
    },
    async takeFetchBudget(today, max) {
      if (max < 1) return false;
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query(
          `INSERT INTO personal.agent_state (user_id, fetches_today, fetches_day)
           SELECT ${ME}, 1, $1::date WHERE ${ENABLED}
           ON CONFLICT (user_id) DO UPDATE SET
             fetches_today = CASE WHEN personal.agent_state.fetches_day = $1::date
               THEN personal.agent_state.fetches_today + 1 ELSE 1 END,
             fetches_day = $1::date
           WHERE personal.agent_state.fetches_day IS DISTINCT FROM $1::date
              OR personal.agent_state.fetches_today < $2
           RETURNING 1`,
          [today, max],
        );
        return (result.rows?.length ?? 0) > 0;
      });
    },

    async getMirror() {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `SELECT payload_blob FROM personal.agent_mirror WHERE user_id = ${ME}`,
        );
        const blob = result.rows[0]?.payload_blob as Buffer | null | undefined;
        if (!blob) return null;
        const payload = tryDecryptBlob<AgentMirror>(blob);
        if (!payload.readable) throw new UnreadableAgentDataError("mirror");
        return payload.value;
      });
    },
    async putMirror(m) {
      const blob = encryptBlob(m);
      return withTenantStatement(db, userId, async (client): Promise<WriteResult> => {
        const result = await client.query(
          `INSERT INTO personal.agent_mirror (user_id, payload_blob)
           SELECT ${ME}, $1 WHERE ${ENABLED}
           ON CONFLICT (user_id) DO UPDATE SET payload_blob = EXCLUDED.payload_blob,
             updated_at = CURRENT_TIMESTAMP
           RETURNING 1`,
          [blob],
        );
        return (result.rows?.length ?? 0) > 0 ? "stored" : "skipped";
      });
    },

    async putPush(sub) {
      const blob = encryptBlob(sub);
      const hash = createHash("sha256").update(String(sub.endpoint)).digest("hex");
      return withTenantStatement(db, userId, async (client): Promise<WriteResult> => {
        // No UPDATE grant on this table: a known endpoint is left as it is. The gate row
        // tells "agent off" (skipped) from "already known" (stored, nothing to do).
        const result = await client.query<QueryResultRow>(
          `WITH gate AS (SELECT 1 AS ok WHERE ${ENABLED}),
                ins AS (
                  INSERT INTO personal.agent_push_subscriptions (user_id, endpoint_hash, subscription_blob)
                  SELECT ${ME}, $1::text, $2::bytea FROM gate
                  ON CONFLICT (user_id, endpoint_hash) DO NOTHING RETURNING 1
                )
           SELECT (SELECT count(*) FROM gate)::int AS enabled`,
          [hash, blob],
        );
        return Number(result.rows[0]?.enabled ?? 0) > 0 ? "stored" : "skipped";
      });
    },
    async listPush() {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `SELECT subscription_blob FROM personal.agent_push_subscriptions
           WHERE user_id = ${ME} ORDER BY created_at`,
        );
        return result.rows.flatMap((row) => {
          const sub = tryDecryptBlob<PushSubscriptionJSON>(row.subscription_blob as Buffer);
          return sub.readable ? [sub.value] : [];
        });
      });
    },
    async deletePush(endpoint) {
      const hash = createHash("sha256").update(endpoint).digest("hex");
      await withTenantStatement(db, userId, async (client) => {
        await client.query(
          `DELETE FROM personal.agent_push_subscriptions WHERE user_id = ${ME} AND endpoint_hash = $1`,
          [hash],
        );
      });
    },

    async createLinkCode() {
      const expiryColumn = `to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
      // A code collision with another user's live code is 1 in ~8.5e11; retry rather than fail.
      for (let attempt = 0; ; attempt++) {
        const code = newLinkCode();
        try {
          const row = await withTenant(db, userId, async (client) => {
            // The upsert below replaces this user's earlier code, expired or not. No separate
            // DELETE: it would lock the code table before the settings lock (deleteAll's order is
            // the reverse).
            const result = await client.query<QueryResultRow>(
              `INSERT INTO personal.agent_link_codes (user_id, code_hash, expires_at, ai_consent_at)
               SELECT ${ME}, $1, CURRENT_TIMESTAMP + make_interval(mins => $2::int), CURRENT_TIMESTAMP
               WHERE ${ENABLED}
               ON CONFLICT (user_id) DO UPDATE SET
                 code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
                 ai_consent_at = EXCLUDED.ai_consent_at
               RETURNING ${expiryColumn} AS expires_at`,
              [linkCodeHash(code), LINK_CODE_MINUTES],
            );
            return result.rows[0] ?? null;
          });
          if (!row) return "skipped";
          return { code, expiresAt: String(row.expires_at) };
        } catch (error) {
          if (attempt < 2 && isUniqueViolation(error)) continue;
          throw error;
        }
      }
    },
    async getLink() {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `SELECT phone_blob,
                  to_char(ai_consent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ai_consent_at,
                  to_char(linked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS linked_at,
                  to_char(last_inbound_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS last_inbound_at
           FROM personal.agent_whatsapp WHERE user_id = ${ME}`,
        );
        const row = result.rows[0];
        if (!row) return null;
        const phone = row.phone_blob ? tryDecryptBlob<string>(row.phone_blob as Buffer) : null;
        if (!phone?.readable) throw new UnreadableAgentDataError("WhatsApp link");
        return {
          phone: phone.value,
          linkedAt: String(row.linked_at),
          lastInboundAt: row.last_inbound_at ? String(row.last_inbound_at) : null,
          aiConsentAt: row.ai_consent_at ? String(row.ai_consent_at) : null,
        };
      });
    },
    async unlink() {
      // A pending code goes with the link: it must not re-link within its 15 minutes.
      await withTenant(db, userId, async (client) => {
        await client.query(`DELETE FROM personal.agent_whatsapp WHERE user_id = ${ME}`);
        await client.query(`DELETE FROM personal.agent_link_codes WHERE user_id = ${ME}`);
      });
    },
    async touchInbound(at) {
      await withTenantStatement(db, userId, async (client) => {
        await client.query(
          `UPDATE personal.agent_whatsapp SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, $1::timestamptz), $1::timestamptz) WHERE user_id = ${ME}`,
          [at],
        );
      });
    },

    async deleteAll() {
      // Settings go first: a concurrent guarded write (ENABLED) then waits or sees them gone.
      await withTenant(db, userId, async (client) => {
        for (const table of AGENT_TABLES)
          await client.query(`DELETE FROM ${table} WHERE user_id = ${ME}`);
      });
    },

    async appendEvent(e) {
      const blob = encryptBlob(e.body);
      const key =
        e.dedupeKey === undefined
          ? null
          : agentDedupeKey(typeof e.dedupeKey === "string" ? [e.dedupeKey] : e.dedupeKey);
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `WITH gate AS (SELECT 1 AS ok WHERE ${ENABLED}),
                ins AS (
                  INSERT INTO personal.agent_events (user_id, id, channel, type, body_blob, dedupe_key)
                  SELECT ${ME}, $1::uuid, $2::text, $3::text, $4::bytea, $5::text FROM gate
                  ON CONFLICT (user_id, dedupe_key) DO NOTHING RETURNING 1
                )
           SELECT (SELECT count(*) FROM gate)::int AS enabled, (SELECT count(*) FROM ins)::int AS stored`,
          [e.id, e.channel, e.type, blob, key],
        );
        const row = result.rows[0];
        if (Number(row?.enabled ?? 0) === 0) return "skipped";
        return Number(row?.stored ?? 0) > 0 ? "stored" : "duplicate";
      });
    },
    async listEvents({ channel, limit, before }) {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query<QueryResultRow>(
          `SELECT id, channel, type, body_blob,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
           FROM personal.agent_events
           WHERE user_id = ${ME} AND ($1::text IS NULL OR channel = $1)
             AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
           ORDER BY created_at DESC, id DESC LIMIT $4`,
          [channel ?? null, before?.createdAt ?? null, before?.id ?? null, limit],
        );
        return result.rows.flatMap((row) => {
          const body = tryDecryptBlob<AgentEvent["body"]>(row.body_blob as Buffer);
          if (!body.readable) return [];
          return [
            {
              id: String(row.id),
              channel: row.channel as AgentChannel,
              type: row.type as AgentEventType,
              body: body.value,
              createdAt: String(row.created_at),
            },
          ];
        });
      });
    },
    async deleteEvent(id) {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query(
          `DELETE FROM personal.agent_events WHERE user_id = ${ME} AND id = $1 RETURNING 1`,
          [id],
        );
        return (result.rows?.length ?? 0) > 0;
      });
    },
    async deleteConversation(channel) {
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query(
          `DELETE FROM personal.agent_events WHERE user_id = ${ME} AND channel = $1 RETURNING 1`,
          [channel],
        );
        return result.rows?.length ?? 0;
      });
    },
    async purgeOlderThan(days) {
      if (!Number.isInteger(days) || days < 1)
        throw new Error("purgeOlderThan needs a whole number of days, at least 1");
      return withTenantStatement(db, userId, async (client) => {
        const result = await client.query(
          `DELETE FROM personal.agent_events
           WHERE user_id = ${ME} AND created_at < CURRENT_TIMESTAMP - make_interval(days => $1::int)
           RETURNING 1`,
          [days],
        );
        return result.rows?.length ?? 0;
      });
    },
  };
}

const AGENT_TABLES = [
  "personal.agent_settings",
  "personal.agent_whatsapp",
  "personal.agent_link_codes",
  "personal.agent_events",
  "personal.agent_push_subscriptions",
  "personal.agent_mirror",
  "personal.agent_state",
] as const;

/** A user whose daily message is due, and the local date it belongs to. After midnight inside
 *  a wrapped window (send hour 23, run at 00:30) `day` is the previous date. */
export type DueUser = { userId: string; day: string };

/**
 * Opted-in users whose send time has come and who have not had that day's message.
 * `hour` and `today` are the Amsterdam hour and date of now. The window wraps
 * midnight (migration 0039). Like `listBrokerSyncTenants`, deliberately tenantless:
 * the SECURITY DEFINER function returns user ids and the message day, nothing else.
 */
export async function listAgentDueUsers(
  db: Database,
  hour: number,
  retryHours: number,
  today: string,
): Promise<DueUser[]> {
  const result = await db.http.query(
    `SELECT tenant_id, to_char(message_day, 'YYYY-MM-DD') AS day
     FROM personal.list_agent_due_users($1::int, $2::int, $3::date)`,
    [hour, retryHours, today],
  );
  return result.rows.map((row) => ({ userId: String(row.tenant_id), day: String(row.day) }));
}

/**
 * Delete link-attempt rows older than the 15 minute window (migration 0040).
 * Tenantless like `listAgentDueUsers`: the table has no policy or grant for the
 * runtime role, only the SECURITY DEFINER function reaches it. Returns the count.
 */
export async function purgeLinkAttempts(db: Database): Promise<number> {
  const result = await db.http.query("SELECT personal.agent_purge_link_attempts() AS deleted", []);
  return Number(result.rows[0]?.deleted ?? 0);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505"
  );
}

/**
 * The user a phone belongs to, or null. Tenantless on purpose: the webhook only
 * knows a number. The SECURITY DEFINER function from migration 0040 returns one
 * user id and nothing else.
 */
export async function userForPhone(db: Database, hash: string): Promise<string | null> {
  const result = await db.http.query("SELECT personal.agent_user_for_phone($1::text) AS user_id", [
    hash,
  ]);
  const id = result.rows[0]?.user_id;
  return id ? String(id) : null;
}

/** Link-code brute-force throttle, enforced in SQL (migration 0040): failures within the window. */
export const LINK_ATTEMPTS_PER_PHONE = 5;
export const LINK_ATTEMPTS_WINDOW_MINUTES = 15;

export type ConsumeLinkCodeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "phone-taken" };

/**
 * Use a one-time link code for a phone, in one SQL statement (migration 0040).
 * `invalid` covers wrong, used and expired codes alike. `phone-taken` means
 * another account already has that phone; the code is kept.
 */
export async function consumeLinkCode(
  db: Database,
  codeHash: string,
  hash: string,
  phoneBlob: Buffer,
): Promise<ConsumeLinkCodeResult> {
  try {
    const result = await db.http.query(
      "SELECT personal.agent_consume_link_code($1::text, $2::text, $3::bytea) AS user_id",
      [codeHash, hash, phoneBlob],
    );
    const id = result.rows[0]?.user_id;
    return id ? { ok: true, userId: String(id) } : { ok: false, reason: "invalid" };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "phone-taken" };
    throw error;
  }
}
