import { expect, test } from "vitest";
import {
  agentToolListJson,
  buildAgentTools,
  capAgentToolResult,
  DEFAULT_AGENT_TOOL_CAPS,
  findAgentTool,
  isAgentToolScope,
  type AgentToolDefinition,
} from "./agentTools.js";

const readTool = (name: string): AgentToolDefinition => ({
  name,
  description: `${name} reads something`,
  schema: { type: "object", properties: {}, additionalProperties: false },
  scope: "read",
  handler: async () => ({ name }),
});

const writeTool = (name: string): AgentToolDefinition => ({
  ...readTool(name),
  scope: "write",
});

const registry = [
  readTool("get_positions"),
  readTool("get_trades"),
  writeTool("apply_rule"),
  { ...readTool("preview_rule"), preview: true },
];

test("a read token sees read tools and never a write tool", () => {
  const tools = buildAgentTools(registry, { scopes: ["read"] });
  expect(tools.map((tool) => tool.name)).toEqual(["get_positions", "get_trades"]);
});

test("a write token sees write tools too", () => {
  const tools = buildAgentTools(registry, { scopes: ["read", "write"] });
  expect(tools.map((tool) => tool.name)).toContain("apply_rule");
});

test("tools/list is a projection of the filtered registry, not a second copy", () => {
  const tools = buildAgentTools(registry, { scopes: ["read"] });
  const list = agentToolListJson(tools);
  expect(list.tools.map((tool) => tool.name)).toEqual(tools.map((tool) => tool.name));
  expect(list.tools[0]?.description).toBe(tools[0]?.description);
  expect(list.tools[0]?.inputSchema).toEqual(tools[0]?.schema);
});

test("a tool hidden by the filter is also refused by name at dispatch", () => {
  const readOnly = buildAgentTools(registry, { scopes: ["read"] });
  expect(findAgentTool(readOnly, "get_positions")).toBeDefined();
  // The write tool is in the full registry but not in this caller's list.
  expect(findAgentTool(readOnly, "apply_rule")).toBeUndefined();
  // The preview tool is hidden unless the caller opted in.
  expect(findAgentTool(readOnly, "preview_rule")).toBeUndefined();
  expect(findAgentTool(buildAgentTools(registry, { scopes: ["read"], preview: true }), "preview_rule"))
    .toBeDefined();
});

test("preview tools are also refused by name for a caller without the flag", () => {
  const readOnly = buildAgentTools(registry, { scopes: ["read"] });
  expect(readOnly.some((tool) => tool.name === "preview_rule")).toBe(false);
});

test("scope parsing accepts only read and write", () => {
  expect(isAgentToolScope("read")).toBe(true);
  expect(isAgentToolScope("write")).toBe(true);
  expect(isAgentToolScope("read_write")).toBe(false);
  expect(isAgentToolScope(null)).toBe(false);
  expect(isAgentToolScope(["read"])).toBe(false);
});

test("a payload under the caps is passed through untouched", () => {
  const payload = { positions: [{ symbol: "AAPL" }, { symbol: "MSFT" }] };
  const capped = capAgentToolResult(payload, { maxRows: 10, maxBytes: 10_000 });
  expect(capped.value).toEqual(payload);
  expect(capped.truncated).toBe(false);
  expect(capped.totalRows).toBe(2);
  expect(capped.keptRows).toBe(2);
});

test("a row over the cap is kept with newer order and marked truncated", () => {
  const payload = { trades: Array.from({ length: 5 }, (_, index) => ({ id: index })) };
  const capped = capAgentToolResult(payload, { maxRows: 2, maxBytes: 10_000 });
  expect(capped.value).toEqual({ trades: [{ id: 0 }, { id: 1 }] });
  expect(capped.truncated).toBe(true);
  expect(capped.totalRows).toBe(5);
  expect(capped.keptRows).toBe(2);
});

test("the row budget is shared across nested arrays so total rows cannot exceed the cap", () => {
  const payload = { theses: [{ id: 1 }, { id: 2 }], goals: [{ id: 3 }, { id: 4 }] };
  const capped = capAgentToolResult(payload, { maxRows: 3, maxBytes: 10_000 });
  expect(capped.value).toEqual({ theses: [{ id: 1 }, { id: 2 }], goals: [{ id: 3 }] });
  expect(capped.truncated).toBe(true);
  expect(capped.keptRows).toBe(3);
});

test("a payload over the byte cap is shrunk and still marked truncated", () => {
  const payload = { rows: Array.from({ length: 200 }, () => "x".repeat(64)) };
  const capped = capAgentToolResult(payload, { maxRows: 200, maxBytes: 4_000 });
  expect(capped.truncated).toBe(true);
  expect(capped.bytes).toBeLessThanOrEqual(4_000);
  const text = JSON.stringify(capped.value) as string;
  expect(text.length).toBeLessThan(200 * 64);
});

test("an oversized single object becomes a marker, never a stack or the raw body", () => {
  const capped = capAgentToolResult({ blob: "y".repeat(5_000) }, { maxRows: 10, maxBytes: 100 });
  expect(capped.truncated).toBe(true);
  expect(capped.value).toEqual({ truncated: true, reason: "response exceeds byte cap" });
});

test("the defaults are the documented 200 rows and 256 KiB", () => {
  expect(DEFAULT_AGENT_TOOL_CAPS).toEqual({ maxRows: 200, maxBytes: 256 * 1024 });
});
