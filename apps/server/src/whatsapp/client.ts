/* Minimal WhatsApp Cloud API client. Only what the agent sends: a template (the
 * proactive daily message), free text inside the 24 h window, and reply
 * buttons. Never logs a number, a text or an API response body. */

export const GRAPH_VERSION = "v21.0";
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export class WindowClosedError extends Error {
  constructor() {
    super("The 24 h WhatsApp window is closed; use a template");
    this.name = "WindowClosedError";
  }
}

export class WhatsAppSendError extends Error {
  constructor(readonly status: number) {
    super(`WhatsApp send failed with status ${status}`);
    this.name = "WhatsAppSendError";
  }
}

export type WhatsAppEnv = { phoneNumberId: string; accessToken: string };

export type WhatsAppClient = {
  sendTemplate(
    to: string,
    name: string,
    lang: "nl" | "en",
    vars: string[],
  ): Promise<{ wamid: string }>;
  sendText(
    to: string,
    text: string,
    windowOpenAt: number | null,
    now: number,
  ): Promise<{ wamid: string }>;
  sendButtons(
    to: string,
    text: string,
    buttons: { id: string; title: string }[],
  ): Promise<{ wamid: string }>;
};

export function createWhatsAppClient(env: WhatsAppEnv, fetchImpl: typeof fetch): WhatsAppClient {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(env.phoneNumberId)}/messages`;

  async function post(payload: Record<string, unknown>): Promise<{ wamid: string }> {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        ...payload,
      }),
    });
    if (!response.ok) throw new WhatsAppSendError(response.status);
    const json = (await response.json().catch(() => null)) as {
      messages?: { id?: unknown }[];
    } | null;
    const id = json?.messages?.[0]?.id;
    if (typeof id !== "string" || id === "") throw new WhatsAppSendError(response.status);
    return { wamid: id };
  }

  return {
    sendTemplate: (to, name, lang, vars) =>
      post({
        to,
        type: "template",
        template: {
          name,
          language: { code: lang },
          ...(vars.length > 0
            ? {
                components: [
                  { type: "body", parameters: vars.map((text) => ({ type: "text", text })) },
                ],
              }
            : {}),
        },
      }),
    async sendText(to, text, windowOpenAt, now) {
      if (windowOpenAt === null || now - windowOpenAt >= WINDOW_MS) throw new WindowClosedError();
      return post({ to, type: "text", text: { body: text, preview_url: false } });
    },
    sendButtons: (to, text, buttons) =>
      post({
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text },
          action: {
            buttons: buttons
              .slice(0, 3)
              .map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })),
          },
        },
      }),
  };
}

/** The client from the environment, or null while the channel is not configured. */
export function whatsappClientFromEnv(fetchImpl: typeof fetch = fetch): WhatsAppClient | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (!phoneNumberId || !accessToken) return null;
  return createWhatsAppClient({ phoneNumberId, accessToken }, fetchImpl);
}
