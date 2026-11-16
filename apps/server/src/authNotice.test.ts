import { afterEach, expect, test, vi } from "vitest";

const sendAuthEmail = vi.fn();
vi.mock("./authEmail.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./authEmail.js")>()),
  sendAuthEmail: (...args: unknown[]) => sendAuthEmail(...args),
}));

import { sendNotice } from "./auth.js";

afterEach(() => vi.restoreAllMocks());

test("a failing notice mail logs the event, error name and status only, never an address (W6)", async () => {
  const lines: unknown[][] = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(a));
  sendAuthEmail.mockRejectedValueOnce(
    Object.assign(new Error("Verification email failed (422): invalid to: someone@example.com"), {
      status: 422,
    }),
  );
  await expect(
    sendNotice("someone@example.com", { subject: "s", text: "t", html: "h" }),
  ).resolves.toBeUndefined();
  const out = JSON.stringify(lines);
  expect(out).not.toContain("@");
  expect(out).not.toContain("someone");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(String(lines[0]![0]))).toEqual({
    event: "auth_notice.failed",
    kind: "Error",
    status: 422,
  });
});

test("a notice that fails without a status logs no status (W6)", async () => {
  const lines: unknown[][] = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void lines.push(a));
  sendAuthEmail.mockRejectedValueOnce(new TypeError("fetch failed for a@b.nl"));
  await sendNotice("a@b.nl", { subject: "s", text: "t", html: "h" });
  expect(JSON.parse(String(lines[0]![0]))).toEqual({
    event: "auth_notice.failed",
    kind: "TypeError",
  });
});
