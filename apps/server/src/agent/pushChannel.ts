import type { RenderedMessage } from "@lavega/core";
import type { createAgentRepository } from "@lavega/database";
import * as webpush from "web-push";

/* The web push channel. The payload is the title and the short text, which the
 * service worker shows as is; no amounts or merchants are added or logged.
 * A subscription the push service reports gone (404, 410) is deleted. */

type Repo = Pick<ReturnType<typeof createAgentRepository>, "listPush" | "deletePush">;
type Sender = Pick<typeof webpush, "sendNotification">;

const GONE = new Set([404, 410]);

export async function sendPush(
  _userId: string,
  msg: RenderedMessage,
  repo: Repo,
  deps: { webpush?: Sender } = {},
): Promise<"sent" | "failed"> {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return "failed";

  let subs: Awaited<ReturnType<Repo["listPush"]>>;
  try {
    subs = await repo.listPush();
  } catch {
    return "failed";
  }
  const sender = deps.webpush ?? webpush;
  const payload = JSON.stringify({ title: msg.title, body: msg.short, url: "/app" });
  let delivered = false;
  for (const sub of subs) {
    const { endpoint, keys } = sub;
    if (!endpoint || !keys?.p256dh || !keys.auth) continue;
    try {
      await sender.sendNotification(
        { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
        payload,
        {
          vapidDetails: { subject, publicKey, privateKey },
          TTL: 60 * 60 * 24,
        },
      );
      delivered = true;
    } catch (error) {
      const status = (error as { statusCode?: unknown }).statusCode;
      // Event name, error name and HTTP status only: never the endpoint, keys or text.
      console.log(
        JSON.stringify({
          event: "instinct.push_failed",
          kind: error instanceof Error ? error.name : "UnknownError",
          ...(typeof status === "number" ? { status } : {}),
        }),
      );
      if (typeof status === "number" && GONE.has(status)) {
        await repo.deletePush(endpoint).catch(() => undefined);
      }
    }
  }
  return delivered ? "sent" : "failed";
}
