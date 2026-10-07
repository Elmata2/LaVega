import { afterEach, expect, test, vi } from "vitest";
import {
  authEmailConfig,
  emailLocale,
  passwordChangedEmail,
  passwordResetEmail,
  sendAuthEmail,
  verificationEmail,
  welcomeEmail,
} from "./authEmail.js";

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.AUTH_EMAIL_FROM;
  vi.unstubAllGlobals();
});

test("auth email is unconfigured until both the key and the from-address are set", () => {
  expect(authEmailConfig().configured).toBe(false);
  process.env.RESEND_API_KEY = "re_test";
  expect(authEmailConfig().configured).toBe(false);
  process.env.AUTH_EMAIL_FROM = "LaVega <accounts@lavega.dev>";
  expect(authEmailConfig()).toMatchObject({
    configured: true,
    from: "LaVega <accounts@lavega.dev>",
  });
});

test("sendAuthEmail posts the confirmation to Resend and refuses a non-2xx", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.AUTH_EMAIL_FROM = "LaVega <accounts@lavega.dev>";
  const fetchMock = vi.fn(() => Promise.resolve(new Response("", { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
  await sendAuthEmail({
    to: "person@example.com",
    ...verificationEmail("https://example.com/verify?token=x&callbackURL=y"),
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.resend.com/emails",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer re_test" }),
    }),
  );
  const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
  expect(sent.subject).toBe("Confirm your LaVega email address");
  expect(sent.text).toContain("expires in one hour");
  expect(sent.html).toContain("Confirm email address");
  expect(sent.html).toContain("token=x&amp;callbackURL=y");

  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ message: "The domain is not verified" }), { status: 403 }),
  );
  await expect(
    sendAuthEmail({ to: "person@example.com", ...verificationEmail("https://example.com") }),
  ).rejects.toThrow("Verification email failed (403): The domain is not verified");
});

test("sendAuthEmail refuses to pretend a mail went out when it is not configured", async () => {
  await expect(
    sendAuthEmail({ to: "person@example.com", ...verificationEmail("https://example.com") }),
  ).rejects.toThrow("RESEND_API_KEY");
});

test("password reset email includes safe HTML and clear expiry", () => {
  const email = passwordResetEmail('https://example.com/reset?token=a&next="b"');
  expect(email.subject).toBe("Reset your LaVega password");
  expect(email.text).toContain("expires in one hour");
  expect(email.html).toContain("token=a&amp;next=&quot;b&quot;");
  expect(email.html).toContain("Your password will not change");
});

test("mail follows the locale cookie first, then the browser language", () => {
  const request = (headers: Record<string, string>) =>
    new Request("https://lavega.dev/api/auth/sign-up/email", { headers });
  expect(emailLocale(undefined)).toBe("en");
  expect(emailLocale(request({ "accept-language": "nl-NL,nl;q=0.9" }))).toBe("nl");
  expect(emailLocale(request({ "accept-language": "de-DE" }))).toBe("en");
  expect(
    emailLocale(request({ cookie: "a=1; lavega_locale=en", "accept-language": "nl-NL" })),
  ).toBe("en");
});

test("every auth mail has a plain-text part, a preheader and its language", () => {
  const url = "https://lavega.dev/x?token=a";
  for (const email of [
    verificationEmail(url, "nl"),
    passwordResetEmail(url, "nl"),
    passwordChangedEmail(url, "nl"),
    welcomeEmail(url, "nl"),
  ]) {
    expect(email.html).toContain('<html lang="nl">');
    expect(email.html).toContain("display:none");
    expect(email.text).toContain("LaVega");
    expect(email.text).not.toContain("<");
  }
  expect(verificationEmail(url, "nl").subject).toBe("Bevestig je e-mailadres voor LaVega");
  expect(passwordChangedEmail(url).subject).toBe("Your LaVega password was changed");
});
