/* Cloudflare Email Routing authenticates mail before Worker delivery, but
 * ForwardableEmailMessage does not expose its measured SPF/DKIM/DMARC results.
 * Authentication-Results is part of the email headers and can be supplied by
 * the sender, including a forged `mx.cloudflare.net` authserv-id. Never turn
 * that text into a trusted pass or fail. The webhook must see `unknown` until
 * Cloudflare provides a verified result through the Worker API.
 */

export type AuthResult =
  | "pass"
  | "fail"
  | "softfail"
  | "neutral"
  | "none"
  | "temperror"
  | "permerror"
  | "unknown";

export type SenderChecks = { spf: AuthResult; dkim: AuthResult; dmarc: AuthResult };

export const UNKNOWN_CHECKS: SenderChecks = { spf: "unknown", dkim: "unknown", dmarc: "unknown" };

/** The domain in a From address; used only for reply-loop protection. */
export function domainOf(value: string): string {
  const matches = String(value || "").match(/<[^<>]*>/g);
  const address = (matches ? matches[matches.length - 1].slice(1, -1) : String(value || "")).trim();
  const at = address.lastIndexOf("@");
  return at >= 0
    ? address
        .slice(at + 1)
        .trim()
        .toLowerCase()
        .replace(/\.$/, "")
    : "";
}

/** The local part of the trusted envelope recipient selects the queue. */
export function localPartOf(address: string): string {
  const at = String(address || "").lastIndexOf("@");
  return at > 0 ? address.slice(0, at).trim().toLowerCase() : "";
}
