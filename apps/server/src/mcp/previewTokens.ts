/*
 * Single-use preview tokens for the write path (plan §3 WS5.4, #299).
 *
 * `preview_rule` validates a proposed account tax-treatment rule and stores it
 * here; `apply_rule` consumes the token and performs the write. A token is:
 *
 *   - bound to the token identity that asked (a leaked token is useless to
 *     another tenant or another token row),
 *   - bound to the exact payload, so an apply cannot swap the entries,
 *   - single-use, and
 *   - short-lived: 30 minutes (plan WS5.4).
 *
 * In memory, like MCP sessions (WS5.2's documented trade-off): a cold start
 * invalidates outstanding previews, which is safe — the owner just previews
 * again. A shared store is the follow-up if the endpoint ever runs multi-instance.
 */

import {
  newPreviewToken,
  RULE_PREVIEW_TTL_MS,
  type RulePreviewChange,
} from "@lavega/investing-server/src/tools/writeTools.js";
import type { AccountWrapperEntry } from "@lavega/core";

export type StoredRulePreview = {
  readonly tenantId: string;
  readonly tokenId: string;
  readonly entries: readonly AccountWrapperEntry[];
  readonly changes: readonly RulePreviewChange[];
  readonly expiresAt: number;
};

export type RulePreviewStore = {
  issue(input: {
    tenantId: string;
    tokenId: string;
    entries: readonly AccountWrapperEntry[];
    changes: readonly RulePreviewChange[];
    now: number;
    /** Overrides the store's default TTL; the tool passes the plan's 30 min. */
    ttlMs?: number;
  }): { previewToken: string; expiresAt: string };
  /** Consumes the token. Null when unknown, used, expired or for another
   *  identity: every one of those is the same refusal, so nothing changes. */
  consume(input: {
    previewToken: string;
    tenantId: string;
    tokenId: string;
    now: number;
  }): StoredRulePreview | null;
  /** Test seam: drop every stored preview. */
  clear(): void;
};

export function createRulePreviewStore(ttlMs = RULE_PREVIEW_TTL_MS): RulePreviewStore {
  const previews = new Map<string, StoredRulePreview>();
  return {
    issue({ tenantId, tokenId, entries, changes, now, ttlMs: overrideTtlMs }) {
      const previewToken = newPreviewToken();
      const expiresAt = now + (overrideTtlMs ?? ttlMs);
      previews.set(previewToken, {
        tenantId,
        tokenId,
        entries: [...entries],
        changes: [...changes],
        expiresAt,
      });
      return { previewToken, expiresAt: new Date(expiresAt).toISOString() };
    },
    consume({ previewToken, tenantId, tokenId, now }) {
      const stored = previews.get(previewToken);
      if (!stored) return null;
      /* Always delete: an expired or mismatched attempt spends the token too,
       * so a leaked token cannot be probed repeatedly. */
      previews.delete(previewToken);
      if (stored.tenantId !== tenantId || stored.tokenId !== tokenId) return null;
      if (stored.expiresAt <= now) return null;
      return stored;
    },
    clear() {
      previews.clear();
    },
  };
}
