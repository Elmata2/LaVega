/**
 * Transactional mail for Better Auth. Resend's HTTP API, no SDK: the only
 * thing this process needs is a key and a from-address.
 */
export function authEmailConfig(): { configured: boolean; apiKey: string; from: string } {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const from = process.env.AUTH_EMAIL_FROM?.trim() ?? "";
  return { configured: apiKey.length > 0 && from.length > 0, apiKey, from };
}

export type AuthEmail = { subject: string; text: string; html: string };

export async function sendAuthEmail(input: AuthEmail & { to: string }): Promise<void> {
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

export type EmailLocale = "nl" | "en";

/**
 * The language a mail goes out in, read from the request that triggered it.
 *
 * The `lavega_locale` cookie is what the app and the landing page already
 * agree on, so it wins. Without it, the browser's own preference decides.
 * Anything that is not Dutch gets English.
 */
export function emailLocale(request: Request | undefined): EmailLocale {
  const cookie = request?.headers.get("cookie") ?? "";
  const chosen = /(?:^|;\s*)lavega_locale=(nl|en)\b/.exec(cookie)?.[1];
  if (chosen === "nl" || chosen === "en") return chosen;
  const accepted = request?.headers.get("accept-language")?.trim().toLowerCase() ?? "";
  return accepted.startsWith("nl") ? "nl" : "en";
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

type Layout = {
  locale: EmailLocale;
  /** Shown by inbox clients next to the subject. Never repeats the subject. */
  preheader: string;
  heading: string;
  body: string;
  action?: { label: string; url: string; fallback: string };
  footnote: string;
};

const SIGN_OFF: Record<EmailLocale, string> = {
  nl: "LaVega · lavega.dev\nJe ontvangt deze e-mail omdat iemand dit adres bij LaVega gebruikte.",
  en: "LaVega · lavega.dev\nYou are receiving this email because this address was used at LaVega.",
};

function render(layout: Layout, subject: string): AuthEmail {
  const { locale, preheader, heading, body, action, footnote } = layout;
  const text = [
    heading,
    body,
    action ? `${action.fallback}\n${action.url}` : null,
    footnote,
    SIGN_OFF[locale],
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");

  const safeUrl = action ? escapeHtml(action.url) : "";
  const button = action
    ? `<p style="margin:0 0 26px"><a href="${safeUrl}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#24516b;color:#fff;text-decoration:none;font-weight:700">${escapeHtml(action.label)}</a></p><p style="margin:0 0 12px;font-size:14px;line-height:1.5">${escapeHtml(action.fallback)}</p><p style="margin:0 0 26px;font-size:13px;line-height:1.6;overflow-wrap:anywhere"><a href="${safeUrl}" style="color:#24516b">${safeUrl}</a></p>`
    : "";
  const signOff = SIGN_OFF[locale]
    .split("\n")
    .map((line) => escapeHtml(line))
    .join("<br>");
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f7f6f2;color:#20231f;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e7e5dc;border-radius:16px"><tr><td style="padding:36px"><p style="margin:0 0 24px;color:#24516b;font-size:13px;font-weight:700;letter-spacing:2px">LAVEGA</p><h1 style="margin:0 0 16px;font-size:27px;line-height:1.2">${escapeHtml(heading)}</h1><p style="margin:0 0 26px;font-size:16px;line-height:1.6">${escapeHtml(body)}</p>${button}<p style="margin:0;color:#5c625d;font-size:13px;line-height:1.5">${escapeHtml(footnote)}</p></td></tr></table><p style="margin:16px 0 0;color:#8a8f8a;font-size:12px;line-height:1.5">${signOff}</p></td></tr></table></body></html>`;
  return { subject, text, html };
}

export function verificationEmail(url: string, locale: EmailLocale = "en"): AuthEmail {
  if (locale === "nl")
    return render(
      {
        locale,
        preheader: "Nog één klik en je account is klaar.",
        heading: "Bevestig je e-mailadres",
        body: "Bevestig dat dit e-mailadres van jou is om je LaVega-account af te ronden.",
        action: {
          label: "E-mailadres bevestigen",
          url,
          fallback: "Deze link verloopt over een uur. Werkt de knop niet? Kopieer dan deze link:",
        },
        footnote: "Heb je geen LaVega-account aangemaakt? Dan kun je deze e-mail negeren.",
      },
      "Bevestig je e-mailadres voor LaVega",
    );
  return render(
    {
      locale,
      preheader: "One click and your account is ready.",
      heading: "Confirm your email address",
      body: "To finish creating your LaVega account, confirm that this email address belongs to you.",
      action: {
        label: "Confirm email address",
        url,
        fallback:
          "This link expires in one hour. If the button does not work, copy this link into your browser:",
      },
      footnote: "If you did not create a LaVega account, you can ignore this email.",
    },
    "Confirm your LaVega email address",
  );
}

export function passwordResetEmail(url: string, locale: EmailLocale = "en"): AuthEmail {
  if (locale === "nl")
    return render(
      {
        locale,
        preheader: "Kies een nieuw wachtwoord. De link werkt een uur.",
        heading: "Stel een nieuw wachtwoord in",
        body: "We kregen een verzoek om het wachtwoord van je LaVega-account opnieuw in te stellen.",
        action: {
          label: "Nieuw wachtwoord kiezen",
          url,
          fallback: "Deze link verloopt over een uur. Werkt de knop niet? Kopieer dan deze link:",
        },
        footnote: "Heb je dit niet aangevraagd? Negeer deze e-mail. Je wachtwoord verandert niet.",
      },
      "Stel je LaVega-wachtwoord opnieuw in",
    );
  return render(
    {
      locale,
      preheader: "Choose a new password. The link works for one hour.",
      heading: "Reset your password",
      body: "We received a request to reset your LaVega password. Use this link to choose a new one.",
      action: {
        label: "Reset password",
        url,
        fallback:
          "This link expires in one hour. If the button does not work, copy this link into your browser:",
      },
      footnote: "If you did not request this, ignore this email. Your password will not change.",
    },
    "Reset your LaVega password",
  );
}

/** Sent after a reset succeeds, so a reset the owner did not ask for is noticed. */
export function passwordChangedEmail(appUrl: string, locale: EmailLocale = "en"): AuthEmail {
  if (locale === "nl")
    return render(
      {
        locale,
        preheader: "Je bent op al je apparaten uitgelogd.",
        heading: "Je wachtwoord is gewijzigd",
        body: "Het wachtwoord van je LaVega-account is zojuist gewijzigd. Voor de veiligheid ben je op al je apparaten uitgelogd.",
        action: {
          label: "Inloggen",
          url: appUrl,
          fallback: "Of open deze link:",
        },
        footnote:
          "Was jij dit niet? Stel dan meteen een nieuw wachtwoord in via 'Wachtwoord vergeten'.",
      },
      "Je LaVega-wachtwoord is gewijzigd",
    );
  return render(
    {
      locale,
      preheader: "You have been signed out on all your devices.",
      heading: "Your password was changed",
      body: "The password for your LaVega account was just changed. For your security, you have been signed out on all your devices.",
      action: { label: "Sign in", url: appUrl, fallback: "Or open this link:" },
      footnote: "Was this not you? Reset your password now with 'Forgot password'.",
    },
    "Your LaVega password was changed",
  );
}

/** Sent once, after the address is confirmed. One next step, nothing to sell. */
export function welcomeEmail(appUrl: string, locale: EmailLocale = "en"): AuthEmail {
  if (locale === "nl")
    return render(
      {
        locale,
        preheader: "Je account is bevestigd.",
        heading: "Welkom bij LaVega",
        body: "Je e-mailadres is bevestigd en je account staat klaar, voor LaVega Personal en LaVega Investing.",
        action: { label: "Open LaVega", url: appUrl, fallback: "Of open deze link:" },
        footnote: "We sturen je alleen e-mail over je account, geen nieuwsbrieven.",
      },
      "Welkom bij LaVega",
    );
  return render(
    {
      locale,
      preheader: "Your account is confirmed.",
      heading: "Welcome to LaVega",
      body: "Your email address is confirmed and your account is ready, for LaVega Personal and LaVega Investing.",
      action: { label: "Open LaVega", url: appUrl, fallback: "Or open this link:" },
      footnote: "We only email you about your account. No newsletters.",
    },
    "Welcome to LaVega",
  );
}
