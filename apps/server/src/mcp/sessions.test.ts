import { expect, test } from "vitest";
import { createMcpSessionStore, MCP_SESSION_TTL_MS } from "./sessions.js";
import type { McpTokenIdentity } from "./tokens.js";

const identity = (overrides: Partial<McpTokenIdentity> = {}): McpTokenIdentity => ({
  tokenId: "token-1",
  tenantId: "user-1",
  scopes: ["read"],
  ...overrides,
});

test("an issued session matches its own identity and nothing else", () => {
  const sessions = createMcpSessionStore();
  const id = sessions.issue(identity(), 1_000);
  expect(sessions.matches(id, identity(), 1_000)).toBe(true);
  expect(sessions.matches(id, identity({ tokenId: "token-2" }), 1_000)).toBe(false);
  expect(sessions.matches(id, identity({ tenantId: "user-2" }), 1_000)).toBe(false);
  expect(sessions.matches("unknown", identity(), 1_000)).toBe(false);
});

test("a session expires after the one-day TTL", () => {
  const sessions = createMcpSessionStore({ newId: () => "session-a" });
  sessions.issue(identity(), 0);
  expect(sessions.matches("session-a", identity(), MCP_SESSION_TTL_MS - 1)).toBe(true);
  expect(sessions.matches("session-a", identity(), MCP_SESSION_TTL_MS)).toBe(false);
  // and it is gone, not merely rejected once
  expect(sessions.matches("session-a", identity(), 0)).toBe(false);
});
