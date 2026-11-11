/*
 * The investing WRITE tools: preview → apply, behind a separate write token
 * (plan §3 WS5.4, #299).
 *
 * Sure source: `app/models/assistant/function_tool_caller.rb` and
 * `app/controllers/mcp_controller.rb` at pinned commit 562fe09. Sure's MCP is
 * write-capable with one coarse scope and no dry-run; this refuses that shape:
 *
 *   - a write tool exists only in the registry a write-scoped token builds, so a
 *     read token cannot call it by name (the same filtered array backs
 *     `tools/list` and dispatch);
 *   - every structural write is a PAIR: `preview_rule` validates and describes
 *     the change and returns a single-use token that expires after 30 minutes;
 *     `apply_rule` consumes that token and performs the write. The preview
 *     changes nothing, and an apply without a live token is refused;
 *   - the one write surface is the account tax-treatment rule map from WS4.4,
 *     which is already the owner's own metadata and already persisted per
 *     tenant. No new write surface is opened by this slice.
 */

import { randomUUID } from "node:crypto";
import {
  validateAccountWrapperMap,
  type AccountWrapperEntry,
  type AgentToolDefinition,
} from "@lavega/core";

/** How long an issued preview may be applied. Plan WS5.4: 30 minutes. */
export const RULE_PREVIEW_TTL_MS = 30 * 60 * 1000;

/** One account whose label the proposed rule would change. */
export type RulePreviewChange = {
  broker: string;
  account: string;
  from: string;
  to: string;
};

export type RulePreview = {
  previewToken: string;
  expiresAt: string;
  entries: AccountWrapperEntry[];
  changes: RulePreviewChange[];
  applied: false;
};

/** What the write tools need from the surface they run on. Bound to the
 *  caller's tenant by the surface; a tool argument can never name one. */
export type InvestingWriteSource = {
  /** The account labels currently stored, for the dry-run diff. */
  currentEntries(): Promise<readonly AccountWrapperEntry[]>;
  /** Holds one validated preview for `ttlMs` and returns its single-use token. */
  storePreview(input: {
    entries: readonly AccountWrapperEntry[];
    changes: readonly RulePreviewChange[];
    ttlMs: number;
  }): Promise<{ previewToken: string; expiresAt: string }>;
  /** Consumes the token and applies the rule. Throws on unknown/expired/used. */
  applyPreview(previewToken: string): Promise<{ applied: true; entries: AccountWrapperEntry[] }>;
};

const entriesInput = (input: Record<string, unknown>): unknown => {
  const entries = input.entries;
  return Array.isArray(entries) ? entries : null;
};

/** A stable digest of the entries, so a preview token is bound to its payload. */
export function rulePayloadKey(entries: readonly AccountWrapperEntry[]): string {
  return JSON.stringify(
    [...entries]
      .map((entry) => [entry.broker, entry.account, entry.wrapper] as const)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
}

/** The dry-run diff between what is stored and what the rule proposes. */
export function diffAccountWrappers(
  current: readonly AccountWrapperEntry[],
  proposed: readonly AccountWrapperEntry[],
): RulePreviewChange[] {
  const byKey = new Map<string, string>(
    current.map((entry) => [`${entry.broker}\u0000${entry.account}`, entry.wrapper]),
  );
  const changes: RulePreviewChange[] = [];
  for (const entry of proposed) {
    const key = `${entry.broker}\u0000${entry.account}`;
    const from = byKey.get(key) ?? "unknown";
    if (from !== entry.wrapper)
      changes.push({ broker: entry.broker, account: entry.account, from, to: entry.wrapper });
  }
  return changes.sort(
    (left, right) =>
      left.broker.localeCompare(right.broker) || left.account.localeCompare(right.account),
  );
}

type InvestingWriteToolSpec = Omit<AgentToolDefinition, "handler"> & {
  handler: (source: InvestingWriteSource, input: Record<string, unknown>) => Promise<unknown>;
};

/**
 * The write definition set. Both tools are `scope: "write"`; `apply_rule` is
 * additionally `preview: true`, so even a write-scoped caller that has not
 * opted into preview tools cannot run it.
 */
export const INVESTING_WRITE_TOOL_SPECS: readonly InvestingWriteToolSpec[] = [
  {
    name: "preview_rule",
    description:
      "Validate a proposed account tax-treatment rule map and describe what applying it would change. This changes NOTHING: it returns a single-use previewToken that expires after 30 minutes, the accounts whose label would change, and the normalized rule. Entries are {broker, account, wrapper}; an unknown wrapper label is dropped. Apply it with apply_rule and that token.",
    schema: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          description:
            "Account labels to store: [{broker, account, wrapper}]. wrapper is one of brokerage, isa, lisa, sipp, pea, assurance-vie, pillar-3a, pillar-3b, private-pension, ira, roth-ira, 401k, unknown.",
          items: {
            type: "object",
            properties: {
              broker: { type: "string" },
              account: { type: "string" },
              wrapper: { type: "string" },
            },
            required: ["broker", "account", "wrapper"],
            additionalProperties: false,
          },
        },
      },
      required: ["entries"],
      additionalProperties: false,
    },
    scope: "write",
    handler: async (source, input) => {
      const raw = entriesInput(input);
      if (!raw)
        return {
          applied: false,
          valid: false,
          problems: ["entries must be an array of {broker, account, wrapper}"],
        };
      const entries = validateAccountWrapperMap(raw);
      if (entries.length === 0 && (raw as unknown[]).length > 0)
        return {
          applied: false,
          valid: false,
          problems: ["No entry has a known wrapper label; nothing to preview"],
        };
      const changes = diffAccountWrappers(await source.currentEntries(), entries);
      const stored = await source.storePreview({ entries, changes, ttlMs: RULE_PREVIEW_TTL_MS });
      return {
        applied: false,
        valid: true,
        previewToken: stored.previewToken,
        expiresAt: stored.expiresAt,
        entries,
        changes,
      } satisfies RulePreview & { valid: true };
    },
  },
  {
    name: "apply_rule",
    description:
      "Apply a rule preview previously returned by preview_rule. Takes only the previewToken: the payload was validated and bound to it. The token is single-use and expires after 30 minutes; an unknown, used or expired token is refused and nothing changes. This is the only write tool; a read token cannot call it.",
    schema: {
      type: "object",
      properties: {
        previewToken: {
          type: "string",
          description: "The single-use token preview_rule returned.",
        },
      },
      required: ["previewToken"],
      additionalProperties: false,
    },
    scope: "write",
    preview: true,
    handler: async (source, input) => {
      const token = typeof input.previewToken === "string" ? input.previewToken.trim() : "";
      if (!token)
        return {
          applied: false,
          problems: ["previewToken is required; call preview_rule first"],
        };
      try {
        return await source.applyPreview(token);
      } catch {
        /* A used/expired/unknown token is a client error, not a server fault. */
        return {
          applied: false,
          problems: [
            "The preview token is unknown, already used, or expired. Call preview_rule again; nothing was changed.",
          ],
        };
      }
    },
  },
];

/** Bind the shared write definitions to one surface's source. */
export function createInvestingWriteTools(source: InvestingWriteSource): AgentToolDefinition[] {
  return INVESTING_WRITE_TOOL_SPECS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    schema: spec.schema,
    scope: spec.scope,
    ...(spec.preview !== undefined ? { preview: spec.preview } : {}),
    handler: (input) => spec.handler(source, input),
  }));
}

/** A fresh single-use preview token. Not a credential: it names a stored,
 *  tenant-bound preview and cannot be guessed into another tenant's. */
export function newPreviewToken(): string {
  return `rule_${randomUUID()}`;
}

/** Exposed for the docs generator: the write tools a write token lists. */
export const WRITE_TOOL_NAMES = INVESTING_WRITE_TOOL_SPECS.map((spec) => spec.name);
export type { AccountWrapperEntry };
