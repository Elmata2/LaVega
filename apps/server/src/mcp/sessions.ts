/*
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 *
 * MCP sessions (ADR 0012 §7, plan WS5.2 "session id").
 *
 * Sure source: `app/controllers/mcp_controller.rb` at pinned commit 562fe09 —
 * a server-issued UUID in `Rails.cache` with a one-day TTL, and an inbound
 * `Mcp-Session-Id` must map to the authenticated user. LaVega keeps the same
 * contract with an in-process map: a session is an optimization for clients
 * that keep one connection, not an authority, and a lost session only costs one
 * re-initialize.
 *
 * The identity is checked on every use, so a session id that leaks cannot be
 * replayed with a DIFFERENT token: it names a token row and tenant, not just a
 * string.
 */

import { randomUUID } from "node:crypto";
import type { McpTokenIdentity } from "./tokens.js";

/** One day, the same TTL Sure uses. */
export const MCP_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;

type SessionRecord = {
  readonly tokenId: string;
  readonly tenantId: string;
  readonly expiresAt: number;
};

export type McpSessionStore = {
  /** Issue a new session id for this identity. */
  issue(identity: McpTokenIdentity, at: number): string;
  /** Does this id belong to this identity and is it still live? */
  matches(sessionId: string, identity: McpTokenIdentity, at: number): boolean;
};

export function createMcpSessionStore(
  options: {
    ttlMs?: number;
    newId?: () => string;
  } = {},
): McpSessionStore {
  const ttlMs = options.ttlMs ?? MCP_SESSION_TTL_MS;
  const newId = options.newId ?? randomUUID;
  const sessions = new Map<string, SessionRecord>();

  const prune = (at: number) => {
    if (sessions.size < 1_000) return;
    for (const [id, record] of sessions) if (record.expiresAt <= at) sessions.delete(id);
  };

  return {
    issue(identity, at) {
      prune(at);
      const sessionId = newId();
      sessions.set(sessionId, {
        tokenId: identity.tokenId,
        tenantId: identity.tenantId,
        expiresAt: at + ttlMs,
      });
      return sessionId;
    },

    matches(sessionId, identity, at) {
      const record = sessions.get(sessionId);
      if (!record) return false;
      if (record.expiresAt <= at) {
        sessions.delete(sessionId);
        return false;
      }
      return record.tokenId === identity.tokenId && record.tenantId === identity.tenantId;
    },
  };
}
