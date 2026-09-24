import { afterEach, expect, test, vi } from "vitest";
import { authEmailConfig, sendAuthEmail } from "./authEmail.js";

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
  await sendAuthEmail({ to: "person@example.com", subject: "Confirm", text: "https://example" });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.resend.com/emails",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer re_test" }),
    }),
  );

  fetchMock.mockResolvedValueOnce(new Response("", { status: 422 }));
  await expect(
    sendAuthEmail({ to: "person@example.com", subject: "Confirm", text: "x" }),
  ).rejects.toThrow("Verification email failed (422)");
});

test("sendAuthEmail refuses to pretend a mail went out when it is not configured", async () => {
  await expect(
    sendAuthEmail({ to: "person@example.com", subject: "Confirm", text: "x" }),
  ).rejects.toThrow("RESEND_API_KEY");
});
