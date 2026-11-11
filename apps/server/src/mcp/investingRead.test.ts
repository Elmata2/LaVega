import { expect, test, vi } from "vitest";
import {
  createMcpInvestingRead,
  isMcpReadPath,
  MCP_READ_PATH_PREFIXES,
} from "./investingRead.js";

test("only the documented read paths pass the allowlist", () => {
  for (const prefix of MCP_READ_PATH_PREFIXES) {
    expect(isMcpReadPath(prefix)).toBe(true);
  }
  expect(isMcpReadPath("/api/investing/dashboard?symbol=AAPL")).toBe(true);
  expect(isMcpReadPath("/api/investing/trades?symbol=AAPL&limit=5")).toBe(true);
  expect(isMcpReadPath("/api/investing/prices/AAPL")).toBe(true);
  expect(isMcpReadPath("/api/investing/fundamentals/AAPL")).toBe(true);
  expect(isMcpReadPath("/api/memory")).toBe(true);
});

test("every write path of the investing app is outside the allowlist", () => {
  for (const path of [
    "/api/brokers/credentials",
    "/api/brokers/sync",
    "/api/prices/sync",
    "/api/prices/cache",
    "/api/market-data/consent",
    "/api/investing/benchmarks",
    "/api/investing/layout",
    "/api/investing/sectors/infer",
    "/api/memory/threads/abc",
    "/api/memory/risk-tolerance",
    "/api/agents/portfolio/run",
  ])
    expect(isMcpReadPath(path)).toBe(false);
});

test("a read forwards a GET under the resolved tenant and returns status plus parsed body", async () => {
  const forward = vi.fn(async (_request: Request, _tenantId: string) =>
    Response.json({ positions: [{ symbol: "AAPL" }] }, { status: 200 }),
  );
  const read = createMcpInvestingRead("user-1", "http://local", forward);
  expect(await read("/api/investing/dashboard")).toEqual({
    status: 200,
    body: { positions: [{ symbol: "AAPL" }] },
  });
  const [request, tenant] = forward.mock.calls[0]!;
  expect(tenant).toBe("user-1");
  expect(request.method).toBe("GET");
  expect(new URL(request.url).pathname).toBe("/api/investing/dashboard");
});

test("a path outside the allowlist is refused before any request is forwarded", async () => {
  const forward = vi.fn(async (_request: Request, _tenantId: string) => Response.json({}));
  const read = createMcpInvestingRead("user-1", "http://local", forward);
  await expect(read("/api/brokers/credentials")).rejects.toThrow("not a read-only path");
  expect(forward).not.toHaveBeenCalled();
});

test("a non-JSON body becomes a safe problem, not data", async () => {
  const forward = vi.fn(async (_request: Request, _tenantId: string) => new Response("<html>error</html>", { status: 500 }));
  const read = createMcpInvestingRead("user-1", "http://local", forward);
  const result = await read("/api/investing/dashboard");
  expect(result.status).toBe(500);
  expect(result.body).toEqual({ problems: ["The investing app answered with an unreadable body"] });
});
