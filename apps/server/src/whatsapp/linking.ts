import { randomUUID } from "node:crypto";
import {
  consumeLinkCode,
  createAgentRepository,
  encryptBlob,
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
  linkCodeHash,
  phoneHash,
  type Database,
} from "@lavega/database";
import { createRateLimiter, type RateLimiter } from "../agent/rateLimit.js";
import { whatsappClientFromEnv, type WhatsAppClient } from "./client.js";
import { WHATSAPP_COPY } from "./copy.js";
import type { Inbound } from "./webhook.js";

/* Linking by code: the user sends the code shown in settings to LaVega's number.
 * This is the only thing an unknown number can do, so it is the only thing that
 * ever gets a reply, and only on success. */

/* The shape of a code is the repository's own alphabet and length, so anything that could
 * not have been issued (a 6-character string, an I or a 0) never spends an attempt. */
const CODE = new RegExp(`^LV-[${LINK_CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`, "i");
/* Attempts per phone hash, spent before the code is looked at: the 8-char code
 * cannot be brute forced from one number. Over the limit = ignored, no reply. */
export const UNLINKED_ATTEMPTS = 5;
export const UNLINKED_WINDOW_MS = 15 * 60 * 1000;

/* Cheap first filter only. The real, durable throttle is in SQL
 * (agent_consume_link_code, migration 0029): this process forgets on a cold start. */
const sharedLimiter = createRateLimiter(UNLINKED_ATTEMPTS, UNLINKED_WINDOW_MS);
/* Everything else an unknown number sends: ignored, under a looser cap that
 * never touches the code budget, so ordinary chatter cannot lock out linking. */
export const UNLINKED_CHATTER = 60;
const chatterLimiter = createRateLimiter(UNLINKED_CHATTER, UNLINKED_WINDOW_MS);

/** Meta sends the sender as digits only ("wa_id"). */
export const toE164 = (from: string): string => `+${from.replace(/^\+/, "")}`;

export type LinkingDeps = {
  client?: WhatsAppClient | null;
  limiter?: RateLimiter;
  chatterLimiter?: RateLimiter;
  now?: () => number;
  locale?: (userId: string) => Promise<"nl" | "en">;
};

export async function handleUnlinked(
  db: Database,
  inbound: Extract<Inbound, { kind: "text" }>,
  deps: LinkingDeps = {},
): Promise<"linked" | "ignored"> {
  const e164 = toE164(inbound.from);
  const hash = phoneHash(e164);

  const code = inbound.text.trim();
  if (!CODE.test(code)) {
    (deps.chatterLimiter ?? chatterLimiter)(hash);
    return "ignored";
  }
  if (!(deps.limiter ?? sharedLimiter)(hash)) return "ignored";

  const result = await consumeLinkCode(db, linkCodeHash(code), hash, encryptBlob(e164));
  if (!result.ok) return "ignored";

  const client = deps.client === undefined ? whatsappClientFromEnv() : deps.client;
  if (client) {
    try {
      const locale = await (deps.locale ?? defaultLocale(db))(result.userId);
      const now = deps.now?.() ?? Date.now();
      /* The user messaged us a moment ago, so the window is open. */
      await client.sendText(inbound.from, WHATSAPP_COPY[locale].linked, inbound.at, now);
      await createAgentRepository(db, result.userId)
        .appendEvent({
          id: randomUUID(),
          channel: "whatsapp",
          type: "message",
          body: { text: WHATSAPP_COPY[locale].linked, meta: { direction: "out" } },
        })
        .catch(() => undefined);
    } catch {
      // The link stands; a lost confirmation is not worth undoing it.
    }
  }
  return "linked";
}

const defaultLocale = (db: Database) => async (userId: string) => {
  try {
    return (await createAgentRepository(db, userId).getSettings())?.locale ?? "nl";
  } catch {
    return "nl" as const;
  }
};

/** `+31612345678` -> `+•••••••••78`; the last two digits only. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `+${"•".repeat(Math.max(digits.length - 2, 0))}${digits.slice(-2)}`;
}
