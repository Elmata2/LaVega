/*
 * The ONLY bridge between an MCP tool and the investing app (#285, ADR 0012 §1,
 * §4).
 *
 * A tool handler asks for a path; this module decides whether that path is a
 * READ and forwards it under the tenant the token resolved to. The allowlist is
 * the second half of "a read token cannot call a write tool": the registry
 * refuses write-scoped tools, and even a bug that named `/api/brokers/credentials`
 * would be refused here before any request reached the investing app.
 *
 * The forwarded Request is always a GET built from the allowlisted path — the
 * MCP body is never forwarded, so no caller-supplied method or body can turn a
 * read into a write.
 */

import { forwardInvesting } from "../investing-mount.js";
import type { InvestingToolRead } from "@lavega/investing-server/src/tools/investingTools.js";

/** Every path a tool may read. Prefixes end with `/` where a symbol follows. */
export const MCP_READ_PATH_PREFIXES = [
  "/api/investing/dashboard",
  "/api/investing/trades",
  "/api/investing/prices/",
  "/api/investing/fundamentals/",
  "/api/investing/sectors",
  "/api/memory",
  /* The write path's dry-run diff reads the current labels; the write itself
   * goes through the separate allowlist in investingWrite.ts. */
  "/api/investing/account-wrappers",
] as const;

export function isMcpReadPath(path: string): boolean {
  return MCP_READ_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}?`),
  );
}

export type ForwardInvesting = (request: Request, tenantId: string) => Promise<Response>;

export function createMcpInvestingRead(
  tenantId: string,
  origin: string,
  forward: ForwardInvesting = forwardInvesting,
): InvestingToolRead {
  return async (path) => {
    if (!isMcpReadPath(path)) throw new Error(`MCP read refused: ${path} is not a read-only path`);
    const response = await forward(new Request(new URL(path, origin)), tenantId);
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        /* The boundary must not hand a non-JSON body (an HTML error page) to a
         * tool as if it were data. */
        body = { problems: ["The investing app answered with an unreadable body"] };
      }
    }
    return { status: response.status, body };
  };
}
