import { afterEach, expect, test } from "vitest";
import { envMcpTokenIdentity, hashMcpToken, mcpBearerToken, resolveMcpToken } from "./tokens.js";

const ENV_KEYS = ["DATABASE_URL", "MCP_API_TOKEN", "MCP_TENANT_ID", "MCP_USER_EMAIL"] as const;

const saved = new Map<string, string | undefined>();
for (const key of ENV_KEYS) saved.set(key, process.env[key]);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const clearEnv = () => {
  for (const key of ENV_KEYS) delete process.env[key];
};

test("a raw token is stored as a SHA-256 digest, never the token", () => {
  expect(hashMcpToken("secret")).toBe(
    "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b",
  );
  expect(hashMcpToken("secret")).not.toContain("secret");
});

test("the bearer token is read from Authorization only", () => {
  const request = (headers: Record<string, string>) => new Request("http://local/mcp", { headers });
  expect(mcpBearerToken(request({ authorization: "Bearer abc.def" }))).toBe("abc.def");
  expect(mcpBearerToken(request({ authorization: "bearer   abc.def  " }))).toBe("abc.def");
  expect(mcpBearerToken(request({ authorization: "Basic abc" }))).toBeNull();
  expect(mcpBearerToken(request({}))).toBeNull();
  expect(mcpBearerToken(request({ authorization: "Bearer " }))).toBeNull();
});

test("the env pair resolves a token to its configured tenant, read-only", () => {
  clearEnv();
  process.env.MCP_API_TOKEN = "env-token";
  process.env.MCP_TENANT_ID = "owner";
  expect(envMcpTokenIdentity("env-token")).toEqual({
    tokenId: "env",
    tenantId: "owner",
    scopes: ["read"],
  });
});

test("a wrong env token resolves to nothing", () => {
  clearEnv();
  process.env.MCP_API_TOKEN = "env-token";
  process.env.MCP_TENANT_ID = "owner";
  expect(envMcpTokenIdentity("guess")).toBeNull();
});

test("an env token WITHOUT a tenant is 401, never local-tenant data", () => {
  clearEnv();
  process.env.MCP_API_TOKEN = "env-token";
  expect(envMcpTokenIdentity("env-token")).toBeNull();

  process.env.MCP_TENANT_ID = "   ";
  expect(envMcpTokenIdentity("env-token")).toBeNull();
});

test("MCP_USER_EMAIL is accepted as the documented tenant alias", () => {
  clearEnv();
  process.env.MCP_API_TOKEN = "env-token";
  process.env.MCP_USER_EMAIL = "owner@example.com";
  expect(envMcpTokenIdentity("env-token")).toMatchObject({
    tenantId: "owner@example.com",
  });
});

test("the env fallback is disabled once DATABASE_URL exists, so a stray env token cannot bypass revocation", () => {
  clearEnv();
  process.env.DATABASE_URL = "postgres://example";
  process.env.MCP_API_TOKEN = "env-token";
  process.env.MCP_TENANT_ID = "owner";
  expect(envMcpTokenIdentity("env-token")).toBeNull();
});

test("resolveMcpToken returns null with no env pair and no database, so the route answers 401", async () => {
  clearEnv();
  expect(await resolveMcpToken("anything")).toBeNull();
});

test("resolveMcpToken resolves the env pair on a no-database install", async () => {
  clearEnv();
  process.env.MCP_API_TOKEN = "env-token";
  process.env.MCP_TENANT_ID = "owner";
  expect(await resolveMcpToken("env-token")).toMatchObject({
    tokenId: "env",
    tenantId: "owner",
    scopes: ["read"],
  });
});

test("the env fallback keeps write behind a separate token", () => {
  const previous = {
    database: process.env.DATABASE_URL,
    read: process.env.MCP_API_TOKEN,
    write: process.env.MCP_WRITE_API_TOKEN,
    tenant: process.env.MCP_TENANT_ID,
  };
  delete process.env.DATABASE_URL;
  process.env.MCP_API_TOKEN = "read-token";
  process.env.MCP_WRITE_API_TOKEN = "write-token";
  process.env.MCP_TENANT_ID = "local";
  try {
    expect(envMcpTokenIdentity("read-token")).toMatchObject({ scopes: ["read"] });
    expect(envMcpTokenIdentity("write-token")).toMatchObject({
      tokenId: "env-write",
      scopes: ["read", "write"],
    });
    expect(envMcpTokenIdentity("other")).toBeNull();
  } finally {
    if (previous.database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous.database;
    if (previous.read === undefined) delete process.env.MCP_API_TOKEN;
    else process.env.MCP_API_TOKEN = previous.read;
    if (previous.write === undefined) delete process.env.MCP_WRITE_API_TOKEN;
    else process.env.MCP_WRITE_API_TOKEN = previous.write;
    if (previous.tenant === undefined) delete process.env.MCP_TENANT_ID;
    else process.env.MCP_TENANT_ID = previous.tenant;
  }
});
