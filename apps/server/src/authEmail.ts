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
  html: string;
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
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    let reason = "";
    try {
      const parsed = JSON.parse(detail) as { message?: string };
      reason = parsed.message?.trim() ?? "";
    } catch {
      reason = "";
    }
    const message = reason
      ? `Verification email failed (${response.status}): ${reason}`
      : `Verification email failed (${response.status})`;
    console.error(message);
    throw new Error(message);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

export function verificationEmail(url: string) {
  const safeUrl = escapeHtml(url);
  return {
    subject: "Confirm your LaVega email address",
    text: `Confirm your LaVega email address\n\nTo finish creating your account, open this link:\n${url}\n\nThis link expires in one hour. If you did not create a LaVega account, you can ignore this email.\n\nLaVega`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f7f6f2;color:#20231f;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e7e5dc;border-radius:16px"><tr><td style="padding:36px"><p style="margin:0 0 24px;color:#24516b;font-size:13px;font-weight:700;letter-spacing:2px">LAVEGA</p><h1 style="margin:0 0 16px;font-size:27px;line-height:1.2">Confirm your email address</h1><p style="margin:0 0 26px;font-size:16px;line-height:1.6">To finish creating your LaVega account, confirm that this email address belongs to you.</p><p style="margin:0 0 26px"><a href="${safeUrl}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#24516b;color:#fff;text-decoration:none;font-weight:700">Confirm email address</a></p><p style="margin:0 0 12px;font-size:14px;line-height:1.5">This link expires in one hour. If the button does not work, copy this link into your browser:</p><p style="margin:0 0 26px;font-size:13px;line-height:1.6;overflow-wrap:anywhere"><a href="${safeUrl}" style="color:#24516b">${safeUrl}</a></p><p style="margin:0;color:#5c625d;font-size:13px;line-height:1.5">If you did not create a LaVega account, you can ignore this email.</p></td></tr></table></td></tr></table></body></html>`,
  };
}

export function passwordResetEmail(url: string) {
  const safeUrl = escapeHtml(url);
  return {
    subject: "Reset your LaVega password",
    text: `Reset your LaVega password\n\nWe received a request to reset your password. Open this link to set a new one:\n${url}\n\nThis link expires in one hour. If you did not request a password reset, you can ignore this email. Your password will not change.\n\nLaVega`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f7f6f2;color:#20231f;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e7e5dc;border-radius:16px"><tr><td style="padding:36px"><p style="margin:0 0 24px;color:#24516b;font-size:13px;font-weight:700;letter-spacing:2px">LAVEGA</p><h1 style="margin:0 0 16px;font-size:27px;line-height:1.2">Reset your password</h1><p style="margin:0 0 26px;font-size:16px;line-height:1.6">We received a request to reset your LaVega password. Use this link to choose a new one.</p><p style="margin:0 0 26px"><a href="${safeUrl}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#24516b;color:#fff;text-decoration:none;font-weight:700">Reset password</a></p><p style="margin:0 0 12px;font-size:14px;line-height:1.5">This link expires in one hour. If the button does not work, copy this link into your browser:</p><p style="margin:0 0 26px;font-size:13px;line-height:1.6;overflow-wrap:anywhere"><a href="${safeUrl}" style="color:#24516b">${safeUrl}</a></p><p style="margin:0;color:#5c625d;font-size:13px;line-height:1.5">If you did not request this, ignore this email. Your password will not change.</p></td></tr></table></td></tr></table></body></html>`,
  };
}
