import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";
import {
  authorizedCronRequest,
  currentInvestingTenant,
  forwardInvesting,
  investingDist,
  investingOwnsApiPath,
  investingTenantId,
  rewriteInvestingRequest,
  shouldMountInvesting,
  withInvestingTenant,
} from "./investing-mount.js";

const {
  createRuntimeAppMock,
  createDockerFetchMock,
  createDashboardCacheMock,
  dashboardCacheMock,
  getAuthMock,
  verifiedSessionMock,
  runtimeDatabaseMock,
  listBrokerSyncTenantsMock,
} = vi.hoisted(() => ({
  runtimeDatabaseMock: vi.fn(() => null as unknown),
  listBrokerSyncTenantsMock: vi.fn(async (_db: unknown) => [] as string[]),
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
  dashboardCacheMock: {
    get: vi.fn(),
    set: vi.fn(),
    load: vi.fn(),
    invalidate: vi.fn(),
  },
  createDashboardCacheMock: vi.fn(),
  getAuthMock: vi.fn(() => null as unknown),
  verifiedSessionMock: vi.fn(async () => null as { user?: { id: string } } | null),
}));

vi.mock("@lavega/investing-server/src/index.js", () => ({
  createDashboardCache: () => {
    createDashboardCacheMock();
    return dashboardCacheMock;
  },
  createRuntimeApp: createRuntimeAppMock,
}));
vi.mock("./auth.js", () => ({ getAuth: getAuthMock, verifiedSession: verifiedSessionMock }));
vi.mock("@lavega/investing-server/src/credentialStore.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runtimeDatabase: runtimeDatabaseMock,
}));
vi.mock("@lavega/database", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listBrokerSyncTenants: listBrokerSyncTenantsMock,
}));
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
  delete process.env.INVESTING_SYNC_BUDGET_MS;
  delete process.env.INVESTING_PRICE_SYNC_BUDGET_MS;
  vi.useRealTimers();
  // clearAllMocks leaves unconsumed once-values queued for the next test.
  runtimeDatabaseMock.mockReset().mockReturnValue(null);
  listBrokerSyncTenantsMock.mockReset().mockResolvedValue([]);
  getAuthMock.mockReset().mockReturnValue(null);
});

test("rewriteInvestingRequest strips /investing for static and health paths", () => {
  const rewritten = rewriteInvestingRequest(new Request("https://lavega.dev/investing/positions"));
  expect(new URL(rewritten.url).pathname).toBe("/positions");
  const api = rewriteInvestingRequest(new Request("https://lavega.dev/api/investing/dashboard"));
  expect(new URL(api.url).pathname).toBe("/api/investing/dashboard");
});

test("forwardInvesting builds an investing runtime per request", async () => {
  const first = await forwardInvesting(new Request("https://lavega.dev/investing/health"));
  const second = await forwardInvesting(new Request("https://lavega.dev/api/investing/dashboard"));
  expect(await first.text()).toBe("path:/health");
  expect(await second.text()).toBe("path:/api/investing/dashboard");
  expect(createRuntimeAppMock).toHaveBeenCalledTimes(2);
  expect(createDockerFetchMock).toHaveBeenCalledWith(expect.any(Function), investingDist());
  expect(createRuntimeAppMock).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ dashboardCache: dashboardCacheMock }),
  );
  expect(createRuntimeAppMock).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ dashboardCache: dashboardCacheMock }),
  );
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

const cronRequest = () =>
  new Request("https://lavega.dev/api/cron/investing-sync", {
    headers: { authorization: "Bearer cron-secret" },
  });

async function cronMount(
  tenants: string[],
  handle: (tenant: string, path: string) => Response | Promise<Response> = () =>
    Response.json({ ok: true }),
) {
  vi.resetModules();
  const mount = await import("./investing-mount.js");
  const seen: string[] = [];
  createDockerFetchMock.mockImplementation(() => async (request: Request) => {
    const entry = `${mount.currentInvestingTenant()}:${new URL(request.url).pathname}`;
    seen.push(entry);
    return handle(mount.currentInvestingTenant(), new URL(request.url).pathname);
  });
  process.env.CRON_SECRET = "cron-secret";
  getAuthMock.mockReturnValue({});
  runtimeDatabaseMock.mockReturnValueOnce({});
  listBrokerSyncTenantsMock.mockResolvedValueOnce(tenants);
  return { mount, seen };
}

test("without authentication the cron syncs the one local tenant and never asks the database", async () => {
  const { mount, seen } = await cronMount([]);
  getAuthMock.mockReturnValue(null);

  const response = await mount.runInvestingCron(cronRequest());

  expect(response.status).toBe(200);
  expect(seen).toEqual(["local:/api/brokers/sync"]);
  expect(listBrokerSyncTenantsMock).not.toHaveBeenCalled();
});

test("the cron syncs every tenant with a connected broker, with no allowlist env", async () => {
  const { mount, seen } = await cronMount(["user-a", "user-b", "user-c"]);

  const response = await mount.runInvestingCron(cronRequest());

  expect(response.status).toBe(200);
  expect(seen).toEqual([
    "user-a:/api/brokers/sync",
    "user-a:/api/letters/ensure",
    "user-b:/api/brokers/sync",
    "user-b:/api/letters/ensure",
    "user-c:/api/brokers/sync",
    "user-c:/api/letters/ensure",
  ]);
  const body = (await response.json()) as {
    tenants: Array<{ letterStatus: number }>;
    skipped: number;
  };
  expect(body.tenants).toHaveLength(3);
  expect(body.tenants.map((tenant) => tenant.letterStatus)).toEqual([200, 200, 200]);
  expect(body.skipped).toBe(0);
});

test("with no connected broker anywhere the cron succeeds and does nothing", async () => {
  const { mount, seen } = await cronMount([]);

  const response = await mount.runInvestingCron(cronRequest());

  expect(response.status).toBe(200);
  expect(seen).toEqual([]);
});

test("the cron keeps the order the database gave, least recently synced first", async () => {
  const { mount, seen } = await cronMount(["stale", "newer", "newest"]);

  await mount.runInvestingCron(cronRequest());

  expect(seen.filter((entry) => entry.endsWith("/api/brokers/sync"))).toEqual([
    "stale:/api/brokers/sync",
    "newer:/api/brokers/sync",
    "newest:/api/brokers/sync",
  ]);
});

test("the cron stops before a tenant that no longer fits, counting from before the tenant listing", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  process.env.INVESTING_SYNC_BUDGET_MS = "100000";
  process.env.INVESTING_PRICE_SYNC_BUDGET_MS = "40000";
  const { mount, seen } = await cronMount(["user-a", "user-b", "user-c"], (_t, path) => {
    // a tenant's one request may spend a whole 40s slice
    if (path === "/api/brokers/sync") vi.setSystemTime(Date.now() + 40_000);
    return Response.json({ ok: true });
  });
  // listing takes 20s: the 80s that remain (minus the 5s margin) fit one 40s slice, not two
  listBrokerSyncTenantsMock.mockReset().mockImplementationOnce(async () => {
    vi.setSystemTime(Date.now() + 20_000);
    return ["user-a", "user-b", "user-c"];
  });

  const response = await mount.runInvestingCron(cronRequest());

  const body = (await response.json()) as { tenants: { tenantId: string }[]; skipped: number };
  expect(response.status).toBe(200);
  expect(body.tenants.map((tenant) => tenant.tenantId)).toEqual(["user-a"]);
  expect(body.skipped).toBe(2);
  expect(seen.some((entry) => entry.startsWith("user-b:"))).toBe(false);
});

test("the price slice runs inside /api/brokers/sync, with the letter asked for after it", async () => {
  const { mount, seen } = await cronMount(["user-a"]);

  await mount.runInvestingCron(cronRequest());

  expect(seen).not.toContain("user-a:/api/prices/sync");
  expect(seen).toEqual(["user-a:/api/brokers/sync", "user-a:/api/letters/ensure"]);
});

test("a failing letter call leaves the sync result intact", async () => {
  const { mount } = await cronMount(["user-a"], (_tenant, path) => {
    if (path === "/api/letters/ensure") throw new Error("model down");
    return Response.json({ ok: true });
  });

  const response = await mount.runInvestingCron(cronRequest());

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    tenants: [{ tenantId: "user-a", brokerStatus: 200, letterStatus: 0 }],
  });
});

test("a budget where not even one slice fits is a 500, not a quiet 200 with everything skipped", async () => {
  process.env.INVESTING_SYNC_BUDGET_MS = "60000";
  process.env.INVESTING_PRICE_SYNC_BUDGET_MS = "60000";
  const { mount, seen } = await cronMount(["user-a", "user-b"]);

  const response = await mount.runInvestingCron(cronRequest());

  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).toContain("budget");
  expect(seen).toEqual([]);
});

test("the cron answers statuses only, never per-user symbols", async () => {
  const { mount } = await cronMount(["user-a"], () =>
    Response.json({ remainingSymbols: ["AAPL", "MSFT"], currentSymbol: "AAPL", completed: 1 }),
  );

  const text = JSON.stringify(await (await mount.runInvestingCron(cronRequest())).json());

  expect(text).not.toMatch(/AAPL|MSFT|remainingSymbols|currentSymbol/);
});

test("one tenant that throws or answers 5xx does not stop the others, and the failure is logged", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const { mount, seen } = await cronMount(["user-a", "user-b", "user-c"], (tenant, path) => {
    if (tenant === "user-a" && path === "/api/brokers/sync")
      throw new Error("vault exploded: token=secret-token");
    if (tenant === "user-b") return Response.json({ problems: ["x"] }, { status: 503 });
    return Response.json({ ok: true });
  });

  const response = await mount.runInvestingCron(cronRequest());

  expect(response.status).toBe(200);
  expect(seen).toContain("user-c:/api/brokers/sync");
  const text = JSON.stringify(await response.json());
  expect(text).not.toContain("secret-token");
  expect(text).toContain("user-a");
  const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
  expect(logged).toContain("vault exploded");
  expect(logged).toContain("user-a");
  expect(logged).not.toContain("secret-token");
  log.mockRestore();
});

test("a failing tenant listing is a 503 with a fixed message, not a leak", async () => {
  vi.resetModules();
  const mount = await import("./investing-mount.js");
  process.env.CRON_SECRET = "cron-secret";
  getAuthMock.mockReturnValue({});
  runtimeDatabaseMock.mockReturnValueOnce({});
  listBrokerSyncTenantsMock.mockRejectedValueOnce(new Error("connection string postgres://u:p@h"));

  const log = vi.spyOn(console, "log").mockImplementation(() => {});

  const response = await mount.runInvestingCron(cronRequest());

  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("postgres://");
  const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
  expect(logged).toContain("Could not list tenants");
  expect(logged).not.toContain("u:p@h");
  log.mockRestore();
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
