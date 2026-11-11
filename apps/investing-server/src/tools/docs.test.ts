import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { createInvestingReadTools } from "./investingTools.js";
import { createInvestingWriteTools } from "./writeTools.js";

/*
 * The plan's WS5.2 risk says "MCP contract docs drift from code — generate the
 * tool list from the registry". This test is that generator's guard: the table
 * between the markers in docs/investing/MCP.md must name exactly the tools the
 * registry ships, no more and no fewer, with the scope each definition carries.
 * WS5.3 adds the chat projection, which is the SAME definitions — the docs are
 * generated from the registry, never from a surface.
 */
const docsPath = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/investing/MCP.md");

const documentedBlock = (markdown: string): string => {
  const start = markdown.indexOf("<!-- tool-registry:start -->");
  const end = markdown.indexOf("<!-- tool-registry:end -->");
  if (start < 0 || end < 0) throw new Error("docs/investing/MCP.md lost its tool-registry markers");
  return markdown.slice(start, end);
};

const registryTools = () => [
  ...createInvestingReadTools(async () => ({ status: 200, body: {} })),
  ...createInvestingWriteTools({
    recordValuation: async ({ date, totalCents, citation }) => ({
      applied: true as const,
      date,
      totalCents,
      citation,
    }),
    currentEntries: async () => [],
    storePreview: async () => ({ previewToken: "t", expiresAt: "2026-11-11T00:30:00.000Z" }),
    applyPreview: async () => ({ applied: true as const, entries: [] }),
  }),
];

test("the documented tool list equals the registry", () => {
  const markdown = readFileSync(docsPath, "utf8");
  const documented = [
    ...new Set(
      [
        ...documentedBlock(markdown).matchAll(
          /`(get_[a-z_]+|record_valuation|preview_rule|apply_rule)`/g,
        ),
      ].map((match) => match[1]),
    ),
  ];
  expect(documented.sort()).toEqual(
    registryTools()
      .map((tool) => tool.name)
      .sort(),
  );
});

test("every documented tool is documented with its registry scope", () => {
  const markdown = readFileSync(docsPath, "utf8");
  const rows = markdown
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) =>
      line
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean),
    );
  for (const tool of registryTools()) {
    const row = rows.find((cells) => cells[0] === `\`${tool.name}\``);
    expect(row, `${tool.name} has no docs row`).toBeDefined();
    expect(row?.[1]).toBe(tool.scope);
  }
});
