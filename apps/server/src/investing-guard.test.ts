import { beforeEach, expect, test, vi } from "vitest";

const { shouldMountInvestingMock, investingTenantIdMock, forwardInvestingMock } = vi.hoisted(() => ({
  shouldMountInvestingMock: vi.fn(() => true),
  investingTenantIdMock: vi.fn(async () => null as string | null),
  forwardInvestingMock: vi.fn(async (_request: Request, tenantId?: string) => new Response(`tenant:${tenantId ?? "none"}`)),
}));

vi.mock("./investing-mount.js", () => ({
  shouldMountInvesting: shouldMountInvestingMock,
  investingTenantId: investingTenantIdMock,
  forwardInvesting: forwardInvestingMock,
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

  for (const path of ["/api/investing/dashboard", "/api/brokers/sync/status", "/api/prices/sync/status", "/api/market-data/consent", "/api/config/status"]) {
    const response = await app.request(path);
    expect(await response.text(), path).toBe("tenant:user-123");
  }
});

test("the investing SPA shell stays reachable without a session", async () => {
  investingTenantIdMock.mockResolvedValue(null);
  const app = await investingApp();

  const response = await app.request("/investing/positions");

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("tenant:none");
});
