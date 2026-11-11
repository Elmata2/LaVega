import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import {
  createAgentRepository,
  phoneHash,
  userForPhone,
  type AgentRepository,
  type Database,
} from "@lavega/database";
import { requireRuntimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import { handleUnlinked, toE164 } from "./linking.js";
import { answerApprovalButton, parseApprovalButton } from "./approval.js";
import { whatsappClientFromEnv } from "./client.js";
import { answerLinkedText } from "./reply.js";

/* The only unauthenticated write path of the agent. Its trust is the Meta
 * signature, checked on the exact raw bytes before anything is parsed or any
 * repository is touched. Fails closed without WHATSAPP_APP_SECRET. Nothing here
 * logs a number, a text, a code, a hash or the body. */

export const MAX_BODY_BYTES = 256 * 1024;
const SIGNATURE_PREFIX = "sha256=";

export function verifySignature(
  rawBody: string | Uint8Array,
  header: string | null,
  appSecret: string,
): boolean {
  if (!appSecret || !header || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const expected = Buffer.from(
    createHmac("sha256", appSecret).update(rawBody).digest("hex"),
    "utf8",
  );
  const given = Buffer.from(header.slice(SIGNATURE_PREFIX.length).toLowerCase(), "utf8");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

export type Inbound =
  | { wamid: string; from: string; at: number; kind: "text"; text: string }
  | { wamid: string; from: string; at: number; kind: "button"; buttonId: string }
  | { kind: "ignored" };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v !== "";

/** `at` is epoch milliseconds (Meta sends seconds). Status callbacks yield nothing. */
export function parseInbound(payload: unknown): Inbound[] {
  if (!isObj(payload) || !Array.isArray(payload.entry)) return [];
  const out: Inbound[] = [];
  for (const entry of payload.entry) {
    if (!isObj(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const value = isObj(change) && isObj(change.value) ? change.value : null;
      if (!value || !Array.isArray(value.messages)) continue;
      for (const m of value.messages) {
        if (!isObj(m) || !str(m.id) || !str(m.from)) {
          out.push({ kind: "ignored" });
          continue;
        }
        const seconds = Number(m.timestamp);
        const at = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
        const base = { wamid: m.id, from: m.from, at };
        if (m.type === "text" && isObj(m.text) && str(m.text.body)) {
          out.push({ ...base, kind: "text", text: m.text.body });
        } else if (m.type === "button" && isObj(m.button) && str(m.button.payload)) {
          out.push({ ...base, kind: "button", buttonId: m.button.payload });
        } else if (
          m.type === "interactive" &&
          isObj(m.interactive) &&
          isObj(m.interactive.button_reply) &&
          str(m.interactive.button_reply.id)
        ) {
          out.push({ ...base, kind: "button", buttonId: m.interactive.button_reply.id });
        } else {
          out.push({ kind: "ignored" });
        }
      }
    }
  }
  return out;
}

export type WebhookDeps = {
  appSecret: () => string | undefined;
  verifyToken: () => string | undefined;
  lookup: (hash: string) => Promise<string | null>;
  repository: (userId: string) => AgentRepository;
  unlinked: (inbound: Extract<Inbound, { kind: "text" }>) => Promise<"linked" | "ignored">;
  /** Hook for a linked user's message once it is stored: the money-question answer (reply.ts). */
  onLinked?: (userId: string, inbound: Exclude<Inbound, { kind: "ignored" }>) => Promise<void>;
};

export function whatsappWebhookDependencies(
  db: () => Database = requireRuntimeDatabase,
): WebhookDeps {
  return {
    appSecret: () => process.env.WHATSAPP_APP_SECRET?.trim() || undefined,
    verifyToken: () => process.env.WHATSAPP_VERIFY_TOKEN?.trim() || undefined,
    lookup: (hash) => userForPhone(db(), hash),
    repository: (userId) => createAgentRepository(db(), userId),
    unlinked: (inbound) => handleUnlinked(db(), inbound),
    /* Never throws: the inbound is stored and deduped by now, so a 500 would only
     * make Meta retry into a no-op. */
    onLinked: async (userId, inbound) => {
      if (inbound.kind === "text") return answerLinkedText(db(), userId, inbound);
      try {
        const client = whatsappClientFromEnv();
        if (client)
          await answerApprovalButton({
            repo: createAgentRepository(db(), userId),
            client,
            now: () => Date.now(),
          });
      } catch (error) {
        console.log(
          JSON.stringify({ event: "whatsapp.reply_failed", kind: (error as Error)?.name }),
        );
      }
    },
  };
}

/** The body as bytes, read as a stream; null once it passes the cap (the rest is not read). */
async function readCapped(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

const sameToken = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function registerWhatsappWebhook(app: Hono, deps: WebhookDeps): void {
  app.get("/api/whatsapp/webhook", (c) => {
    const expected = deps.verifyToken();
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    if (
      !expected ||
      c.req.query("hub.mode") !== "subscribe" ||
      !token ||
      !challenge ||
      !sameToken(token, expected)
    )
      return c.body(null, 403);
    return c.text(challenge, 200);
  });

  app.post("/api/whatsapp/webhook", async (c) => {
    const secret = deps.appSecret();
    if (!secret) return c.body(null, 401);
    const bytes = await readCapped(c.req.raw);
    if (bytes === null) return c.body(null, 413);
    if (!verifySignature(bytes, c.req.header("x-hub-signature-256") ?? null, secret))
      return c.body(null, 401);

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return c.body(null, 200);
    }
    /* A database failure answers 500 so Meta retries: the wa:<wamid> dedupe key and
     * the single-use code make a retry safe. Everything the sender caused stays 200. */
    let failed = false;
    for (const inbound of parseInbound(payload)) {
      if (inbound.kind === "ignored") continue;
      try {
        await handle(deps, inbound);
      } catch (error) {
        failed = true;
        // Kind only: never the message, the number or the error text.
        console.log(
          JSON.stringify({ event: "whatsapp.inbound_failed", kind: (error as Error)?.name }),
        );
      }
    }
    return c.body(null, failed ? 500 : 200);
  });
}

async function handle(
  deps: WebhookDeps,
  inbound: Exclude<Inbound, { kind: "ignored" }>,
): Promise<void> {
  const userId = await deps.lookup(phoneHash(toE164(inbound.from)));
  if (!userId) {
    if (inbound.kind === "text") await deps.unlinked(inbound);
    return;
  }
  const repo = deps.repository(userId);
  /* Touch first: if it fails nothing is stored, so Meta's retry is not blocked by
   * the dedupe key. The stamp is monotonic in the database, so a replayed or late
   * delivery cannot move the window back. */
  await repo.touchInbound(new Date(inbound.at).toISOString());
  const button = inbound.kind === "button" ? parseApprovalButton(inbound.buttonId) : null;
  // A button that is not approve:<caseId> or reject:<caseId> is not stored and not answered.
  if (inbound.kind === "button" && !button) return;
  const stored = await repo.appendEvent({
    id: randomUUID(),
    channel: "whatsapp",
    type: button ? "approval_response" : "message",
    body: button
      ? {
          text: inbound.kind === "button" ? inbound.buttonId : "",
          meta: { direction: "in", caseId: button.caseId, answer: button.answer },
        }
      : { text: inbound.kind === "text" ? inbound.text : "", meta: { direction: "in" } },
    dedupeKey: `wa:${inbound.wamid}`,
  });
  /* "skipped" = the agent is off or its settings are gone: nothing is answered. */
  if (stored !== "stored") return;
  await deps.onLinked?.(userId, inbound);
}
