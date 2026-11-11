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
 *
 * WS5.5 (#300) adds ONE direct write with no preview: `record_valuation`, the
 * analogue of Sure's `record_valuation.rb` tool. It is append/upsert by date, and
 * it is REFUSED unless the caller supplies a structured provenance citation —
 * a value with no provenance is worse than a missing value. Sure's tool is
 * cited here; its write trust is not copied (a write-scoped token and a
 * validated citation are both required).
 */

import { randomUUID } from "node:crypto";
import { Schema } from "effect";
import {
  decodeProvenanceCitation,
  isValidProvenanceDate,
  provenanceCitationProblem,
  validateAccountWrapperMap,
  type AccountWrapperEntry,
  type AgentToolDefinition,
  type ProvenanceCitation,
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
export type ValuationWriteInput = {
  date: string;
  totalCents: number;
  citation: ProvenanceCitation;
};

export type InvestingWriteSource = {
  /** The account labels currently stored, for the dry-run diff. */
  currentEntries(): Promise<readonly AccountWrapperEntry[]>;
  /** Record the owner's valuation for `date`, with its citation. Resolves once
   *  the row is stored; throws when the surface has no database. */
  recordValuation(input: ValuationWriteInput): Promise<{
    applied: true;
    date: string;
    totalCents: number;
    citation: ProvenanceCitation;
  }>;
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
    name: "record_valuation",
    description:
      "Record the owner's total portfolio/personal valuation for one date, with the provenance that backs it. Money is INTEGER CENTS in EUR (ADR 0011: 123456 means EUR 1,234.56), and date is the day the valuation refers to (YYYY-MM-DD, not in the future). `citation` is REQUIRED and structured, never prose: {source, grade: A|B|C, date, documentId?, estimated?}, where grade A = an official document for that exact date, B = derived with a document, C = a proxy or assumption. A valuation without a citation, or with a malformed one (grade D, impossible date, free-text note), is refused and nothing is written; the refusal is {error, hint} data. Re-recording the same date replaces that day's value and its citation.",
    schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "The day the valuation refers to, YYYY-MM-DD.",
        },
        totalCents: {
          type: "integer",
          description: "The total in integer EUR cents; 123456 means EUR 1,234.56.",
          minimum: -1_000_000_000_000,
          maximum: 1_000_000_000_000,
        },
        currency: {
          type: "string",
          enum: ["EUR"],
          description: "Always EUR; the stored total is EUR cents.",
        },
        citation: {
          type: "object",
          description:
            "Structured provenance. Never prose. A value with no citation is worse than a missing value.",
          properties: {
            source: { type: "string", description: "Document or provider the number came from." },
            grade: {
              type: "string",
              enum: ["A", "B", "C"],
              description: "A = official document for that date; B = derived with a document; C = proxy/assumption.",
            },
            date: { type: "string", description: "The date the cited source refers to, YYYY-MM-DD." },
            documentId: { type: "string", description: "Optional stable id or URL of the document." },
            estimated: {
              type: "boolean",
              description: "True when the figure is an estimate (Sure's `estimated:` marker).",
            },
          },
          required: ["source", "grade", "date"],
          additionalProperties: false,
        },
      },
      required: ["date", "totalCents", "citation"],
      additionalProperties: false,
    },
    scope: "write",
    handler: async (source, input) => {
      /* The citation is checked FIRST: a valuation without provenance must be
       * refused before any other complaint can mask it (WS5.5 acceptance). */
      const problem = provenanceCitationProblem(input.citation);
      if (problem)
        return {
          applied: false,
          error: problem.error,
          hint: problem.hint,
          problems: [problem.hint],
        };
      const date = typeof input.date === "string" ? input.date.trim() : "";
      if (!isValidProvenanceDate(date))
        return {
          applied: false,
          error: "invalid_date",
          hint: "date must be a real calendar date, YYYY-MM-DD.",
          problems: ["date must be a real calendar date, YYYY-MM-DD"],
        };
      const today = new Date().toISOString().slice(0, 10);
      if (date > today)
        return {
          applied: false,
          error: "future_date",
          hint: "Record a valuation for a day that has already happened.",
          problems: ["A valuation cannot be recorded for a future date"],
        };
      if (date < "2000-01-01")
        return {
          applied: false,
          error: "invalid_date",
          hint: "date is older than this feature supports.",
          problems: ["date is too far in the past"],
        };
      const totalCents = input.totalCents;
      if (
        typeof totalCents !== "number" ||
        !Number.isInteger(totalCents) ||
        Math.abs(totalCents) > 1_000_000_000_000
      )
        return {
          applied: false,
          error: "invalid_amount",
          hint: "totalCents must be an integer number of EUR cents.",
          problems: ["totalCents must be an integer number of EUR cents"],
        };
      const currency = input.currency ?? "EUR";
      if (currency !== "EUR")
        return {
          applied: false,
          error: "invalid_currency",
          hint: "The stored valuation is EUR cents; currency must be EUR.",
          problems: ["currency must be EUR"],
        };
      const citation = decodeProvenanceCitation(input.citation);
      return source.recordValuation({ date, totalCents, citation });
    },
  },
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
