import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import {
  authorizedCronRequest,
  currentInvestingTenant,
  forwardInvesting,
  investingCronTenantIds,
  investingDist,
  investingOwnsApiPath,
  investingTenantId,
  rewriteInvestingRequest,
  shouldMountInvesting,
  withInvestingTenant,
} from "./investing-mount.js";

const { createRuntimeAppMock, createDockerFetchMock, getAuthMock, verifiedSessionMock } =
  vi.hoisted(() => ({
    createRuntimeAppMock: vi.fn(async () => ({
      routes: [
        { method: "GET", path: "/api/investing/dashboard" },
        { method: "GET", path: "/api/agents/portfolio" },
      ],
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, service: "investing-server" }), {
            headers: { "content-type": "application/json" },
          }),
      ),
    })),
    createDockerFetchMock: vi.fn(
      (_fetch: unknown, _root: string) => async (request: Request) =>
        new Response(`path:${new URL(request.url).pathname}`, { status: 200 }),
    ),
    getAuthMock: vi.fn(() => null as unknown),
    verifiedSessionMock: vi.fn(async () => null as { user?: { id: string } } | null),
  }));

vi.mock("@lavega/investing-server/src/index.js", () => ({
  createRuntimeApp: createRuntimeAppMock,
}));
vi.mock("./auth.js", () => ({ getAuth: getAuthMock, verifiedSession: verifiedSessionMock }));
vi.mock("@lavega/investing-server/src/docker.js", () => ({
  createDockerFetch: createDockerFetchMock,
}));
vi.mock("@lavega/investing-server/src/filePriceStore.js", () => ({
  createFilePriceStore: vi.fn(),
  runtimePriceStoreFile: () => "/tmp/prices.json",
}));
vi.mock("@lavega/investing-server/src/fileBenchmarkSelectionStore.js", () => ({
  createFileBenchmarkSelectionStore: vi.fn(),
  runtimeBenchmarkSelectionFile: () => "/tmp/benchmarks.json",
}));
vi.mock("@lavega/investing-server/src/fileMarketDataConsentStore.js", () => ({
  createFileMarketDataConsentStore: vi.fn(),
  runtimeMarketDataConsentFile: () => "/tmp/consent.json",
}));

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.INVESTING_CRON_TENANT_IDS;
});

test("rewriteInvestingRequest strips /investing for static and health paths", () => {
  const rewritten = rewriteInvestingRequest(new Request("https://lavega.dev/investing/positions"));
  expect(new URL(rewritten.url).pathname).toBe("/positions");
  const api = rewriteInvestingRequest(new Request("https://lavega.dev/api/investing/dashboard"));
  expect(new URL(api.url).pathname).toBe("/api/investing/dashboard");
});

test("forwardInvesting lazy-loads the investing runtime once", async () => {
  const first = await forwardInvesting(new Request("https://lavega.dev/investing/health"));
  const second = await forwardInvesting(new Request("https://lavega.dev/api/investing/dashboard"));
  expect(await first.text()).toBe("path:/health");
  expect(await second.text()).toBe("path:/api/investing/dashboard");
  expect(createRuntimeAppMock).toHaveBeenCalledTimes(1);
  expect(createDockerFetchMock).toHaveBeenCalledWith(expect.any(Function), investingDist());
});

test("shouldMountInvesting is false when dist is missing", () => {
  const prev = process.env.INVESTING_MOUNT;
  process.env.INVESTING_MOUNT = "0";
  expect(shouldMountInvesting()).toBe(false);
  process.env.INVESTING_MOUNT = prev;
});

test("the investing API can be mounted where its built UI is served by something else", () => {
  const prev = process.env.INVESTING_MOUNT;
  process.env.INVESTING_MOUNT = "1";
  process.env.INVESTING_WEB_DIST = "/nowhere-at-all";
  try {
    // On Vercel the CDN holds the SPA and the function never sees it on disk.
    expect(shouldMountInvesting()).toBe(true);
  } finally {
    process.env.INVESTING_MOUNT = prev;
    delete process.env.INVESTING_WEB_DIST;
  }
});

test("investingDist defaults next to investing-web dist", () => {
  const serverDir = dirname(fileURLToPath(import.meta.url));
  expect(investingDist()).toBe(resolve(serverDir, "../../investing-web/dist"));
});

test("investingTenantId falls back to the local tenant when authentication is not configured", async () => {
  getAuthMock.mockReturnValueOnce(null);

  expect(await investingTenantId(new Request("https://lavega.dev/api/investing/dashboard"))).toBe(
    "local",
  );
  expect(verifiedSessionMock).not.toHaveBeenCalled();
});

test("investingTenantId refuses an unauthenticated request once authentication is configured", async () => {
  getAuthMock.mockReturnValueOnce({});
  verifiedSessionMock.mockResolvedValueOnce(null);

  expect(
    await investingTenantId(new Request("https://lavega.dev/api/investing/dashboard")),
  ).toBeNull();
});

test("investingTenantId returns the verified user id as the tenant", async () => {
  getAuthMock.mockReturnValueOnce({});
  verifiedSessionMock.mockResolvedValueOnce({ user: { id: "user-123" } });

  expect(await investingTenantId(new Request("https://lavega.dev/api/investing/dashboard"))).toBe(
    "user-123",
  );
});

test("the investing tenant is scoped to one request and never leaks to the next", async () => {
  const inside = await withInvestingTenant("user-123", async () => currentInvestingTenant());

  expect(inside).toBe("user-123");
  expect(currentInvestingTenant()).toBe("local");
});

test("cron requests require the configured secret", () => {
  process.env.CRON_SECRET = "secret-123";

  expect(
    authorizedCronRequest(
      new Request("https://lavega.dev/api/cron/investing-sync", {
        headers: { authorization: "Bearer secret-123" },
      }),
    ),
  ).toBe(true);
  expect(authorizedCronRequest(new Request("https://lavega.dev/api/cron/investing-sync"))).toBe(
    false,
  );
});

test("cron tenants come from env when auth exists, with local fallback only when auth is off", () => {
  process.env.INVESTING_CRON_TENANT_IDS = " user-a, user-b, user-a ";
  expect(investingCronTenantIds()).toEqual(["user-a", "user-b"]);

  delete process.env.INVESTING_CRON_TENANT_IDS;
  getAuthMock.mockReturnValueOnce({});
  expect(investingCronTenantIds()).toEqual([]);
  getAuthMock.mockReturnValueOnce(null);
  expect(investingCronTenantIds()).toEqual(["local"]);
});

test("investing cron runs broker sync then a fresh price slice for each configured tenant", async () => {
  vi.resetModules();
  const mount = await import("./investing-mount.js");
  const seen: string[] = [];
  createDockerFetchMock.mockImplementationOnce(() => async (request: Request) => {
    seen.push(`${mount.currentInvestingTenant()}:${new URL(request.url).pathname}`);
    return Response.json({ ok: true });
  });
  process.env.CRON_SECRET = "cron-secret";
  process.env.INVESTING_CRON_TENANT_IDS = "user-a,user-b";

  const response = await mount.runInvestingCron(
    new Request("https://lavega.dev/api/cron/investing-sync", {
      headers: { authorization: "Bearer cron-secret" },
    }),
  );

  expect(response.status).toBe(200);
  expect(seen).toEqual([
    "user-a:/api/brokers/sync",
    "user-a:/api/prices/sync",
    "user-b:/api/brokers/sync",
    "user-b:/api/prices/sync",
  ]);
});

test("forwardInvesting runs the forwarded request inside the caller's tenant scope", async () => {
  // A fresh module: forwardInvesting memoizes its runtime, and an earlier test
  // in this file has already built one.
  vi.resetModules();
  const mount = await import("./investing-mount.js");
  const seen: string[] = [];
  createDockerFetchMock.mockImplementationOnce(() => async () => {
    seen.push(mount.currentInvestingTenant());
    return new Response("ok");
  });

  await mount.forwardInvesting(
    new Request("https://lavega.dev/api/investing/dashboard"),
    "user-123",
  );

  expect(seen).toEqual(["user-123"]);
  expect(createRuntimeAppMock).toHaveBeenCalledWith(
    expect.objectContaining({ resolveTenantId: expect.any(Function) }),
  );
});

test("the forwarded /api namespaces are read from the investing app's own routes", async () => {
  /* A hand-written copy of this list in apps/server went stale when the
   * investing app grew /api/agents, which then 404'd in production. */
  expect(await investingOwnsApiPath("/api/agents/portfolio")).toBe(true);
  expect(await investingOwnsApiPath("/api/investing/dashboard")).toBe(true);
  expect(await investingOwnsApiPath("/api/vault/backup")).toBe(false);
});
