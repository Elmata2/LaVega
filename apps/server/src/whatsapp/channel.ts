import type { RenderedMessage } from "@lavega/core";
import type { createAgentRepository } from "@lavega/database";
import { whatsappClientFromEnv, type WhatsAppClient } from "./client.js";
import { WHATSAPP_COPY } from "./copy.js";

/* The WhatsApp channel of the instinct agent. Proactive = one approved utility
 * template whose only variable is the rendered figures line. The number is read
 * from the encrypted link, held in memory for this call, and never logged.
 * Never throws. */

type Repo = Pick<ReturnType<typeof createAgentRepository>, "getLink" | "appendEvent" | "unlink">;

/* A phone number can be given to someone else. A link is permanent, so one that has seen no
 * message from the user for this long (counted from the later of linking and the last inbound
 * message) stops receiving the daily figures: it is removed and the user is told in the feed. */
export const LINK_MAX_IDLE_DAYS = 90;
const DAY_MS = 86_400_000;

export async function sendWhatsAppDaily(
  _userId: string,
  msg: RenderedMessage,
  locale: "nl" | "en",
  repo: Repo,
  deps: { client?: WhatsAppClient | null; now?: () => number } = {},
): Promise<"sent" | "failed"> {
  const template = process.env.WHATSAPP_TEMPLATE_DAILY?.trim();
  const client = deps.client === undefined ? whatsappClientFromEnv() : deps.client;
  if (!template || !client) return "failed";

  let wamid: string;
  try {
    const link = await repo.getLink();
    if (!link) return "failed";
    const lastSeen = Math.max(
      Date.parse(link.linkedAt) || 0,
      link.lastInboundAt ? Date.parse(link.lastInboundAt) || 0 : 0,
    );
    if (lastSeen > 0 && (deps.now?.() ?? Date.now()) - lastSeen > LINK_MAX_IDLE_DAYS * DAY_MS) {
      /* Notice first: its dedupe key makes a retry after a failed unlink store nothing twice. */
      await repo.appendEvent({
        id: crypto.randomUUID(),
        channel: "feed",
        type: "message",
        body: { text: WHATSAPP_COPY[locale].linkExpired },
        dedupeKey: ["wa-link-expired", link.linkedAt],
      });
      await repo.unlink();
      return "failed";
    }
    /* The Cloud API takes the number as digits only. */
    const to = link.phone.replace(/\D/g, "");
    ({ wamid } = await client.sendTemplate(to, template, locale, msg.whatsappParams));
  } catch (error) {
    /* Event name, error name and HTTP status only: never the number, text or params. */
    const status = (error as { status?: unknown }).status;
    console.log(
      JSON.stringify({
        event: "instinct.whatsapp_failed",
        kind: error instanceof Error ? error.name : "UnknownError",
        ...(typeof status === "number" ? { status } : {}),
      }),
    );
    return "failed";
  }
  /* The message is out: a lost record must not turn it into a failure. */
  await repo
    .appendEvent({
      id: crypto.randomUUID(),
      channel: "whatsapp",
      type: "message",
      body: { text: msg.short, meta: { direction: "out" } },
      dedupeKey: `wa-out:${wamid}`,
    })
    .catch(() => undefined);
  return "sent";
}
