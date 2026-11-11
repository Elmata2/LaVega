import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  authorizedCronRequest,
  CRON_MAX_HOPS,
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
  createFileSharedPriceStore: vi.fn(() => ({ clear: async () => undefined })),
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

/* The hop chain calls its own deployment with global fetch. Tests record that
 * request instead of sending it. */
const continueFetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
  Response.json({ ok: true }),
);

beforeEach(() => {
  continueFetch.mockClear();
  vi.stubGlobal("fetch", continueFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
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
  const first = await forwardInvesting(new Request("https://lavega.dev/investing/health"), "local");
  const second = await forwardInvesting(
    new Request("https://lavega.dev/api/investing/dashboard"),
    "user-1",
  );
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

test("the runtime gets the Neon partner budget with a database, and one process-wide memory budget without", async () => {
  const lastOptions = () =>
    (createRuntimeAppMock.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0];

  runtimeDatabaseMock.mockReturnValue({});
  await forwardInvesting(new Request("https://lavega.dev/investing/health"), "user-1");
  expect(lastOptions().partnerBudget).toBeDefined();
  expect(lastOptions()).not.toHaveProperty("partnerBudgetClient");

  runtimeDatabaseMock.mockReturnValue(null);
  await forwardInvesting(new Request("https://lavega.dev/investing/health"), "local");
  const first = lastOptions().partnerBudgetClient;
  expect(first).toBeDefined();
  expect(lastOptions()).not.toHaveProperty("partnerBudget");

  // The per-request runtime is rebuilt, the memory budget it is given is not.
  await forwardInvesting(new Request("https://lavega.dev/investing/health"), "local");
  expect(lastOptions().partnerBudgetClient).toBe(first);
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

const cronRequest = (query = "") =>
  new Request(`https://lavega.dev/api/cron/investing-sync${query}`, {
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
  expect(seen).toEqual(["local:/api/sync/drive"]);
  expect(listBrokerSyncTenantsMock).not.toHaveBeenCalled();
});

test("the cron syncs every tenant with a connected broker, with no allowlist env", async () => {
  const { mount, seen } = await cronMount(["user-a", "user-b", "user-c"]);

  const response = await mount.runInvestingCron(cronRequest());

  expect(response.status).toBe(200);
  expect(seen).toEqual([
    "user-a:/api/sync/drive",
    "user-b:/api/sync/drive",
    "user-c:/api/sync/drive",
  ]);
  const body = (await response.json()) as {
    tenants: Array<{ status: number }>;
    skipped: number;
    continued: boolean;
  };
  expect(body.tenants).toHaveLength(3);
  expect(body.tenants.map((tenant) => tenant.status)).toEqual([200, 200, 200]);
  expect(body.skipped).toBe(0);
  expect(body.continued).toBe(false);
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

  expect(seen).toEqual([
    "stale:/api/sync/drive",
    "newer:/api/sync/drive",
    "newest:/api/sync/drive",
  ]);
});

test("the cron stops before a tenant that no longer fits, counting from before the tenant listing", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  process.env.INVESTING_SYNC_BUDGET_MS = "100000";
  process.env.INVESTING_PRICE_SYNC_BUDGET_MS = "40000";
  const { mount, seen } = await cronMount(["user-a", "user-b", "user-c"], (_t, path) => {
    // a tenant's one request may spend a whole 40s slice
    if (path === "/api/sync/drive") vi.setSystemTime(Date.now() + 40_000);
    return Response.json({ result: "continue" });
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

test("one drive call is the whole tenant: lanes and letter run inside it", async () => {
  const { mount, seen } = await cronMount(["user-a"]);

  await mount.runInvestingCron(cronRequest());

  expect(seen).not.toContain("user-a:/api/prices/sync");
  expect(seen).not.toContain("user-a:/api/letters/ensure");
  expect(seen).toEqual(["user-a:/api/sync/drive"]);
});

test("a drive call that answers a problem still counts the tenant as processed", async () => {
  const { mount } = await cronMount(["user-a"], () =>
    Response.json({ result: "failed" }, { status: 200 }),
  );

  const response = await mount.runInvestingCron(cronRequest());

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    tenants: [{ tenantId: "user-a", status: 200, result: "failed" }],
    skipped: 0,
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
    if (tenant === "user-a" && path === "/api/sync/drive")
      throw new Error("vault exploded: token=secret-token");
    if (tenant === "user-b") return Response.json({ problems: ["x"] }, { status: 503 });
    return Response.json({ ok: true });
  });

  const response = await mount.runInvestingCron(cronRequest());

  expect(response.status).toBe(200);
  expect(seen).toContain("user-c:/api/sync/drive");
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

test("the cron hop chain visits 7 tenants in 3 hops, each exactly once, in list order", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  process.env.INVESTING_SYNC_BUDGET_MS = "140000";
  process.env.INVESTING_PRICE_SYNC_BUDGET_MS = "40000";
  const tenants = ["a", "b", "c", "d", "e", "f", "g"];
  const { mount, seen } = await cronMount(tenants, (_tenant, path) => {
    // a tenant consumes one 40s slice; three fit in 140s minus the 5s margin
    if (path === "/api/sync/drive") vi.setSystemTime(Date.now() + 40_000);
    return Response.json({ result: "continue" });
  });
  listBrokerSyncTenantsMock.mockReset().mockResolvedValue(tenants);
  runtimeDatabaseMock.mockReturnValue({});

  const visited: string[] = [];
  let request = cronRequest();
  for (let hop = 0; hop <= 5; hop += 1) {
    const body = (await (await mount.runInvestingCron(request)).json()) as {
      tenants: Array<{ tenantId: string }>;
      continued: boolean;
    };
    visited.push(...body.tenants.map((tenant) => tenant.tenantId));
    if (!body.continued) break;
    const next = new URL(String(continueFetch.mock.calls.at(-1)![0]));
    request = cronRequest(
      `?after=${next.searchParams.get("after")}&hop=${next.searchParams.get("hop")}`,
    );
  }

  expect(visited).toEqual(tenants); // each exactly once, in list order
  expect(seen).toEqual(tenants.map((tenant) => `${tenant}:/api/sync/drive`));
  expect(continueFetch).toHaveBeenCalledTimes(2); // hop 1 and hop 2, not a third
  const first = new URL(String(continueFetch.mock.calls[0]![0]));
  expect(first.pathname).toBe("/api/cron/investing-sync");
  expect(first.searchParams.get("after")).toBe("c");
  expect(first.searchParams.get("hop")).toBe("1");
});

test("INVESTING_SYNC_CHAIN=off stops the cron chain and leaves the rest for the next trigger", async () => {
  process.env.INVESTING_SYNC_CHAIN = "off";
  process.env.INVESTING_SYNC_BUDGET_MS = "140000";
  process.env.INVESTING_PRICE_SYNC_BUDGET_MS = "40000";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  const { mount } = await cronMount(["a", "b", "c", "d"], (_tenant, path) => {
    if (path === "/api/sync/drive") vi.setSystemTime(Date.now() + 40_000);
    return Response.json({ result: "continue" });
  });

  const response = await mount.runInvestingCron(cronRequest());
  const body = (await response.json()) as { skipped: number; continued: boolean };

  expect(body).toMatchObject({ skipped: 1, continued: false });
  expect(continueFetch).not.toHaveBeenCalled();
  delete process.env.INVESTING_SYNC_CHAIN;
});

test("a cron hop above the cap is a 400, not a silent restart", async () => {
  const { mount } = await cronMount([]);

  const response = await mount.runInvestingCron(cronRequest(`?hop=${CRON_MAX_HOPS + 1}`));

  expect(response.status).toBe(400);
});

test("a cursor that is not in the tenant list starts the pass from the beginning", async () => {
  const { mount, seen } = await cronMount(["a", "b"]);

  const response = await mount.runInvestingCron(cronRequest("?after=gone&hop=1"));

  expect(response.status).toBe(200);
  expect(seen).toEqual(["a:/api/sync/drive", "b:/api/sync/drive"]);
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
