/**
 * Transactional mail for Better Auth. Resend's HTTP API, no SDK: the only
 * thing this process needs is a key and a from-address.
 */
export function authEmailConfig(): { configured: boolean; apiKey: string; from: string } {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.AUTH_EMAIL_FROM?.trim() ?? "";
  return { configured: apiKey.length > 0 && from.length > 0, apiKey, from };
}

export async function sendAuthEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const { configured, apiKey, from } = authEmailConfig();
  if (!configured) {
    throw new Error("Verification email is not configured (RESEND_API_KEY, AUTH_EMAIL_FROM)");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text }),
  });
  if (!response.ok) {
    throw new Error(`Verification email failed (${response.status})`);
  }
}
