import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

/* The critical finding of the 2026-08-28 review: with the investing app mounted
 * (which the production Dockerfile does), POST /api/brokers/credentials had no
 * authentication, and on a host with no vault yet it CREATED one from the
 * passphrase the caller sent. A stranger could take the broker vault on the
 * owner's persistent volume and lock him out of it.
 *
 * The mount is decided once, when index.js loads, so this file sets the
 * environment before importing it — a separate file from apiGuard.test.ts
 * because vitest gives each file its own module registry. */
process.env.INVESTING_MOUNT = "1";
// A real directory, made here, because the mount is decided by whether the
// investing build EXISTS — so the test must not depend on one having been built.
process.env.INVESTING_WEB_DIST = mkdtempSync(join(tmpdir(), "lavega-investing-dist-"));
delete process.env.LAVEGA_ALLOW_UNAUTHENTICATED;

const { verifiedSessionMock } = vi.hoisted(() => ({ verifiedSessionMock: vi.fn() }));
vi.mock("./auth.js", async () => {
  const actual = await vi.importActual<typeof import("./auth.js")>("./auth.js");
  return { ...actual, verifiedSession: verifiedSessionMock };
});
verifiedSessionMock.mockResolvedValue(null);

const { shouldMountInvesting } = await import("./investing-mount.js");
const { app } = await import("./index.js");

test("the investing routes really are mounted, or the rest of this file proves nothing", () => {
  expect(shouldMountInvesting()).toBe(true);
});

test("an anonymous caller cannot claim the broker vault", async () => {
  const res = await app.request("/api/brokers/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passphrase: "attacker-chosen-value" }),
  });
  expect(res.status).toBe(401);
});

test("an anonymous caller cannot brute-force the broker vault passphrase", async () => {
  const res = await app.request("/api/brokers/credentials/unlock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passphrase: "guess" }),
  });
  expect(res.status).toBe(401);
});

test("an anonymous caller cannot read the portfolio or wipe the price cache", async () => {
  expect((await app.request("/api/investing/summary")).status).toBe(401);
  expect((await app.request("/api/prices/cache", { method: "DELETE" })).status).toBe(401);
});
