import type { RenderedMessage } from "@lavega/core";
import { sendAuthEmail } from "../authEmail.js";

/* The email channel of the instinct agent. The body is the rendered long text
 * and one settings link, nothing else: no figures are added here. Never throws
 * and logs only the event name, the error name and the HTTP status, never the message, the address or the Resend response. */

const FOOTER = {
  nl: (url: string) =>
    `Wil je deze meldingen niet meer? Zet meldingen uit in je instellingen: ${url}`,
  en: (url: string) => `Do not want these messages? Turn notifications off in settings: ${url}`,
} as const;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function sendAgentEmail(
  to: string,
  msg: RenderedMessage,
  locale: "nl" | "en",
  appUrl: string,
): Promise<"sent" | "failed"> {
  try {
    const from = process.env.AGENT_EMAIL_FROM?.trim() || process.env.AUTH_EMAIL_FROM?.trim() || "";
    const link = `${appUrl.replace(/\/+$/, "")}/app`;
    const footer = FOOTER[locale](link);
    await sendAuthEmail({
      to,
      from,
      subject: msg.title,
      text: `${msg.long}\n\n${footer}`,
      html: `<p>${escapeHtml(msg.long).replace(/\n/g, "<br>")}</p><p style="color:#5c625d;font-size:13px">${escapeHtml(footer)}</p>`,
    });
    return "sent";
  } catch (error) {
    // Event name, error name and HTTP status only: never the address, subject, text or reason.
    const status = (error as { status?: unknown }).status;
    console.log(
      JSON.stringify({
        event: "instinct.email_failed",
        kind: error instanceof Error ? error.name : "UnknownError",
        ...(typeof status === "number" ? { status } : {}),
      }),
    );
    return "failed";
  }
}
