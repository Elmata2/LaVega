/*
 * The ONLY write bridge between an MCP write tool and the investing app
 * (plan §3 WS5.4, #299).
 *
 * The mirror of `investingRead.ts`: a write tool asks for an allowlisted
 * structural write, and this module forwards it under the tenant the bearer
 * token resolved to. One path only — the account tax-treatment rule map the
 * owner already controls (WS4.4). The MCP body is not forwarded verbatim: the
 * bridge re-serialises the entries the preview validated, so no caller-supplied
 * method, path or extra field can turn the write into something else.
 */

import {
  decodeProvenanceCitation,
  validateAccountWrapperMap,
  type AccountWrapperEntry,
  type ProvenanceCitation,
} from "@lavega/core";
import { createPersonalNetWorthRepository } from "@lavega/database";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import { forwardInvesting } from "../investing-mount.js";

/** Every structural write an MCP write tool may perform. Exactly one path. */
export const MCP_WRITE_PATHS = ["/api/investing/account-wrappers"] as const;

export function isMcpWritePath(path: string): boolean {
  return (MCP_WRITE_PATHS as readonly string[]).includes(path);
}

export type ForwardInvesting = (request: Request, tenantId: string) => Promise<Response>;

/** PUT the validated account labels under the token's tenant. Throws when the
 *  investing app refuses, so the tool boundary answers with safe error data. */
export function createMcpInvestingWrite(
  tenantId: string,
  origin: string,
  forward: ForwardInvesting = forwardInvesting,
): (entries: readonly AccountWrapperEntry[]) => Promise<void> {
  return async (entries) => {
    const path = "/api/investing/account-wrappers";
    if (!isMcpWritePath(path)) throw new Error(`MCP write refused: ${path}`);
    const response = await forward(
      new Request(new URL(path, origin), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: validateAccountWrapperMap(entries) }),
      }),
      tenantId,
    );
    if (!response.ok) throw new Error(`The investing app refused the write (${response.status})`);
  };
}

/**
 * Record one dated valuation with its citation (#300, WS5.5).
 *
 * Unlike the rule map, this write has no preview pair: it is an upsert by date
 * — the analogue of Sure's `record_valuation`, which also writes directly and
 * is gated by its citation grammar instead of by a preview token. The citation
 * is decoded again here, so a caller that bypassed the tool layer still cannot
 * store prose.
 *
 * The repository is the ONLY path: it runs under the token's tenant, so the row
 * carries that account's `user_id` and RLS applies exactly as it does to the
 * browser's own share route. `repository` is injectable so a test can prove the
 * write without a database.
 */
export type ValuationWriteRepository = {
  put(date: string, totalCents: number, provenance?: Record<string, unknown>): Promise<void>;
};

export function createMcpValuationWrite(
  tenantId: string,
  repository?: ValuationWriteRepository,
): (input: {
  date: string;
  totalCents: number;
  citation: ProvenanceCitation;
}) => Promise<{ applied: true; date: string; totalCents: number; citation: ProvenanceCitation }> {
  return async (input) => {
    const citation = decodeProvenanceCitation(input.citation);
    let target = repository;
    if (!target) {
      const database = runtimeDatabase();
      if (!database) throw new Error("A valuation write needs a database");
      target = createPersonalNetWorthRepository(database, tenantId);
    }
    await target.put(input.date, input.totalCents, citation);
    return { applied: true, date: input.date, totalCents: input.totalCents, citation };
  };
}
