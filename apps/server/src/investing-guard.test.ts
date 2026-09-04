import { beforeEach, expect, test, vi } from "vitest";

const {
  shouldMountInvestingMock,
  investingTenantIdMock,
  forwardInvestingMock,
  runInvestingCronMock,
  investingOwnsApiPathMock,
} = vi.hoisted(() => ({
  shouldMountInvestingMock: vi.fn(() => true),
  investingTenantIdMock: vi.fn(async () => null as string | null),
  forwardInvestingMock: vi.fn(
    async (_request: Request, tenantId?: string) => new Response(`tenant:${tenantId ?? "none"}`),
  ),
  runInvestingCronMock: vi.fn(async () => Response.json({ tenants: [] })),
  investingOwnsApiPathMock: vi.fn(async (path: string) =>
    ["investing", "brokers", "prices", "market-data", "config", "agents"].includes(
      path.split("/")[2] ?? "",
    ),
  ),
}));

vi.mock("./investing-mount.js", () => ({
  shouldMountInvesting: shouldMountInvestingMock,
  investingTenantId: investingTenantIdMock,
  forwardInvesting: forwardInvestingMock,
  runInvestingCron: runInvestingCronMock,
  investingOwnsApiPath: investingOwnsApiPathMock,
  investingDist: () => "/tmp/investing-dist",
}));

async function investingApp() {
  vi.resetModules();
  return (await import("./index.js")).app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("an investing API request without a tenant is refused, not served under the local tenant", async () => {
  investingTenantIdMock.mockResolvedValue(null);
  const app = await investingApp();

  const response = await app.request("/api/investing/dashboard");

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ problems: ["Authentication is required"] });
  expect(forwardInvestingMock).not.toHaveBeenCalled();
});

test("an investing API request is forwarded under the tenant the session named", async () => {
  investingTenantIdMock.mockResolvedValue("user-123");
  const app = await investingApp();

  for (const path of [
    "/api/investing/dashboard",
    "/api/brokers/sync/status",
    "/api/prices/sync/status",
    "/api/market-data/consent",
    "/api/config/status",
    "/api/agents/portfolio",
  ]) {
    const response = await app.request(path);
    expect(await response.text(), path).toBe("tenant:user-123");
  }
});

test("a namespace the investing app claims is forwarded without touching this server", async () => {
  investingTenantIdMock.mockResolvedValue("user-123");
  investingOwnsApiPathMock.mockResolvedValue(true);
  const app = await investingApp();

  const response = await app.request("/api/a-namespace-nobody-has-written-yet");

  expect(await response.text()).toBe("tenant:user-123");
});

test("an /api path the investing app does not claim is not answered by it", async () => {
  investingTenantIdMock.mockResolvedValue("user-123");
  investingOwnsApiPathMock.mockResolvedValue(false);
  const app = await investingApp();

  await app.request("/api/vault/backup");

  expect(forwardInvestingMock).not.toHaveBeenCalled();
});

test("this server keeps its own API routes ahead of the investing wildcard", async () => {
  investingTenantIdMock.mockResolvedValue("user-123");
  const app = await investingApp();

  const response = await app.request("/api/eb/status");

  expect(forwardInvestingMock).not.toHaveBeenCalled();
  expect(response.status).toBe(200);
});

test("the investing SPA shell stays reachable without a session", async () => {
  investingTenantIdMock.mockResolvedValue(null);
  const app = await investingApp();

  const response = await app.request("/investing/positions");

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("tenant:none");
});

test("the health line is answered without a session, and by the investing runtime", async () => {
  investingTenantIdMock.mockResolvedValue(null);
  const app = await investingApp();

  const response = await app.request("/api/investing/health");

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("tenant:none");
  expect(investingTenantIdMock).not.toHaveBeenCalled();
});

test("investing cron route uses cron handler instead of browser session auth", async () => {
  investingTenantIdMock.mockResolvedValue(null);
  const app = await investingApp();

  const response = await app.request("/api/cron/investing-sync");

  expect(response.status).toBe(200);
  expect(runInvestingCronMock).toHaveBeenCalledOnce();
  expect(investingTenantIdMock).not.toHaveBeenCalled();
});
