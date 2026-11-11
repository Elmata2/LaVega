/*
 * The one tool registry (plan §3 WS5.1).
 *
 * Sure source: `app/models/assistant/function/*`, `function_tool_caller.rb`,
 * `mcp_controller.rb` at pinned commit 562fe09. Sure has ONE registry that both
 * the in-app chat and `/mcp` read (`Assistant.function_classes`); a tool added
 * there is callable by every surface, and filtering happens once per caller.
 * This module is that seam for LaVega: definitions are data, the surface is a
 * projection of them, and a hidden tool is refused by NAME at dispatch — not
 * only omitted from `tools/list`.
 *
 * Nothing here knows about HTTP, tenants or JSON-RPC: those live in
 * `apps/server/src/mcp/*`. The registry is the single source for
 * `tools/list`, so the docs are generated from the same array (WS5.1: "docs in
 * the description, not in a second prompt").
 */

/** What a caller may do with a tool. `read` is the only scope WS5.2 ships. */
export type AgentToolScope = "read" | "write";

/** JSON Schema (object root, draft 2020-12 subset) an MCP client needs. */
export type AgentToolJsonSchema = {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
};

/**
 * One typed tool.
 *
 * `description` carries the data semantics Sure puts in its tool schemas:
 * direction, units, pagination and what an unknown value means — so an external
 * agent answers correctly without a second prompt (WS5.1).
 */
export type AgentToolDefinition = {
  readonly name: string;
  /** Data semantics for the model: units, direction, pagination, unknown rules. */
  readonly description: string;
  readonly schema: AgentToolJsonSchema;
  readonly scope: AgentToolScope;
  /** Reserved for WS5.4: a write tool that needs a preview token before it runs. */
  readonly preview?: boolean;
  readonly handler: (input: Record<string, unknown>) => Promise<unknown>;
};

/** Who is asking. A bearer token's scopes become this, never a header or a tool argument. */
export type AgentToolCaller = {
  readonly scopes: readonly AgentToolScope[];
  /** Preview tools stay hidden until the caller opts in (WS5.4). */
  readonly preview?: boolean;
};

/**
 * The registry for one caller. This is the ONLY place filtering happens, so
 * `tools/list` and dispatch cannot disagree: dispatch looks the tool up in this
 * same filtered array and therefore refuses a hidden tool by name.
 */
export function buildAgentTools(
  definitions: readonly AgentToolDefinition[],
  caller: AgentToolCaller,
): readonly AgentToolDefinition[] {
  const allowed = new Set<AgentToolScope>(caller.scopes);
  return definitions.filter(
    (tool) => allowed.has(tool.scope) && (tool.preview !== true || caller.preview === true),
  );
}

/** The MCP `tools/list` result for a filtered registry. */
export function agentToolListJson(tools: readonly AgentToolDefinition[]): {
  tools: Array<{ name: string; description: string; inputSchema: AgentToolJsonSchema }>;
} {
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.schema,
    })),
  };
}

/**
 * Dispatch lookup over the SAME filtered array the caller listed. Returns
 * `undefined` for an unknown, write-only or preview-hidden name, so the caller
 * refuses it at dispatch instead of trusting `tools/list` to be the only gate.
 */
export function findAgentTool(
  tools: readonly AgentToolDefinition[],
  name: string,
): AgentToolDefinition | undefined {
  return tools.find((tool) => tool.name === name);
}

/** Is this string one of the two scopes? A stored token row may carry anything. */
export function isAgentToolScope(value: unknown): value is AgentToolScope {
  return value === "read" || value === "write";
}

/** Row and byte ceilings for one tool response (plan §3 WS5.2 caps). */
export type AgentToolResponseCaps = {
  readonly maxRows: number;
  readonly maxBytes: number;
};

/**
 * Defaults match what the chat tools already cap themselves at, with room for
 * an external agent: 200 rows and 256 KiB. A response over either ceiling is
 * TRUNCATED and says so, rather than dropped or streamed whole.
 */
export const DEFAULT_AGENT_TOOL_CAPS: AgentToolResponseCaps = {
  maxRows: 200,
  maxBytes: 256 * 1024,
};

export type CappedAgentToolResult = {
  readonly value: unknown;
  readonly truncated: boolean;
  readonly totalRows: number;
  readonly keptRows: number;
  readonly bytes: number;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Cap every array in the payload against ONE shared row budget, in walk order. */
function capRows(value: unknown, maxRows: number): { value: unknown; totalRows: number } {
  let remaining = maxRows;
  let totalRows = 0;
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > 8) return null; // a read payload is shallow; refuse to walk a cycle-shaped monster
    if (Array.isArray(node)) {
      totalRows += node.length;
      const kept = node.slice(0, remaining);
      remaining -= kept.length;
      return kept.map((item) => walk(item, depth + 1));
    }
    if (isPlainObject(node)) {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(node)) out[key] = walk(entry, depth + 1);
      return out;
    }
    return node;
  };
  return { value: walk(value, 0), totalRows };
}

/**
 * Enforce the response caps. Row caps trim arrays (keeping the newest/largest
 * order the tool chose, since the registry never re-sorts); a payload still over
 * the byte ceiling is shrunk by halving the row budget, and a single object that
 * cannot fit becomes a small explicit marker so the boundary never streams an
 * oversized body or a stack trace.
 */
export function capAgentToolResult(
  value: unknown,
  caps: AgentToolResponseCaps = DEFAULT_AGENT_TOOL_CAPS,
): CappedAgentToolResult {
  let rowBudget = Math.max(1, Math.floor(caps.maxRows));
  for (;;) {
    const capped = capRows(value, rowBudget);
    const text = JSON.stringify(capped.value) ?? "";
    const bytes = new TextEncoder().encode(text).length;
    const keptRows = capped.totalRows;
    if (bytes <= caps.maxBytes || rowBudget === 1) {
      if (bytes > caps.maxBytes) {
        const marker = { truncated: true, reason: "response exceeds byte cap" };
        const markerBytes = new TextEncoder().encode(JSON.stringify(marker)).length;
        return {
          value: marker,
          truncated: true,
          totalRows: capped.totalRows,
          keptRows: 0,
          bytes: markerBytes,
        };
      }
      return {
        value: capped.value,
        truncated: capped.totalRows > rowBudget || keptRows > rowBudget,
        totalRows: capped.totalRows,
        keptRows: Math.min(keptRows, rowBudget),
        bytes,
      };
    }
    rowBudget = Math.max(1, Math.floor(rowBudget / 2));
  }
}

/** A safe tool error: result data the model can act on, never an exception,
 *  SQL, path or stack across the boundary (plan §3 WS5.6, #299). */
export type SafeAgentToolError = { readonly error: string; readonly hint: string };

/**
 * Map any thrown tool error to the safe `{error, hint}` pair both surfaces use.
 *
 * `SchemaError` means the arguments did not match `tools/list`; everything else
 * is a tool failure the caller may retry once. The hint names the retry rule so
 * an external agent does not loop on the same call (WS5.6).
 */
export function safeAgentToolError(error: unknown): SafeAgentToolError {
  const schemaError =
    !!error &&
    typeof error === "object" &&
    ((error as { _tag?: unknown })._tag === "SchemaError" ||
      (error as { name?: unknown }).name === "SchemaError" ||
      (error as { name?: unknown }).name === "ParseError");
  return schemaError
    ? {
        error: "invalid_arguments",
        hint: "Check the argument names and types against tools/list, then retry once.",
      }
    : {
        error: "tool_failed",
        hint: "The tool could not answer. Retry once; do not keep retrying the same call.",
      };
}
