import { randomUUID } from "node:crypto";
import type { AgentRepository } from "@lavega/database";
import type { WhatsAppClient } from "./client.js";
import { WHATSAPP_COPY } from "./copy.js";

/* Approval scaffolding. Nothing sends approval buttons yet, and a button reply
 * never acts: no tool, no bank read, no model. It is recorded and answered with
 * one fixed sentence. */

const CASE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type ApprovalButton = { caseId: string; answer: "approve" | "reject" };

/** Only `approve:<caseId>` or `reject:<caseId>`; anything else is null. */
export function parseApprovalButton(id: string): ApprovalButton | null {
  const cut = id.indexOf(":");
  if (cut < 0) return null;
  const answer = id.slice(0, cut);
  const caseId = id.slice(cut + 1);
  if ((answer !== "approve" && answer !== "reject") || !CASE_ID.test(caseId)) return null;
  return { caseId, answer };
}

export type ApprovalRepo = Pick<AgentRepository, "getSettings" | "getLink" | "appendEvent">;

/** Sends the fixed reply. Never throws; a refused or failed send is recorded by error name only. */
export async function answerApprovalButton(deps: {
  repo: ApprovalRepo;
  client: WhatsAppClient;
  now: () => number;
}): Promise<void> {
  const { repo, client, now } = deps;
  try {
    const [settings, link] = await Promise.all([repo.getSettings(), repo.getLink()]);
    if (!link) return;
    const opened = link.lastInboundAt ? Date.parse(link.lastInboundAt) : Number.NaN;
    const text = WHATSAPP_COPY[settings?.locale ?? "nl"].cancelUnavailable;
    const { wamid } = await client.sendText(
      link.phone.replace(/\D/g, ""),
      text,
      Number.isFinite(opened) ? opened : null,
      now(),
    );
    await repo
      .appendEvent({
        id: randomUUID(),
        channel: "whatsapp",
        type: "message",
        body: { text, meta: { direction: "out" } },
        dedupeKey: `wa-out:${wamid}`,
      })
      .catch(() => undefined);
  } catch (error) {
    // Name only: never the message, the number or the error text.
    const kind = error instanceof Error ? error.name : "UnknownError";
    await repo
      .appendEvent({ id: randomUUID(), channel: "whatsapp", type: "error", body: { text: kind } })
      .catch(() => undefined);
  }
}
