import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { createInvestingReadTools } from "./investingTools.js";

/*
 * The plan's WS5.2 risk says "MCP contract docs drift from code — generate the
 * tool list from the registry". This test is that generator's guard: the table
 * between the markers in docs/investing/MCP.md must name exactly the tools the
 * registry ships, no more and no fewer.
 */
const docsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/investing/MCP.md",
);

const documentedBlock = (markdown: string): string => {
  const start = markdown.indexOf("<!-- tool-registry:start -->");
  const end = markdown.indexOf("<!-- tool-registry:end -->");
  if (start < 0 || end < 0) throw new Error("docs/investing/MCP.md lost its tool-registry markers");
  return markdown.slice(start, end);
};

test("the documented tool list equals the registry", () => {
  const markdown = readFileSync(docsPath, "utf8");
  const documented = [...documentedBlock(markdown).matchAll(/`(get_[a-z_]+)`/g)].map(
    (match) => match[1],
  );
  const registry = createInvestingReadTools(async () => ({ status: 200, body: {} }));
  expect(documented.sort()).toEqual(registry.map((tool) => tool.name).sort());
});

test("every documented tool is documented as read-only", () => {
  const markdown = readFileSync(docsPath, "utf8");
  for (const tool of createInvestingReadTools(async () => ({ status: 200, body: {} }))) {
    const row = markdown
      .split("\n")
      .find((line) => line.startsWith(`| \`${tool.name}\``) || line.includes(`| \`${tool.name}\` |`));
    expect(row, `${tool.name} has no docs row`).toBeDefined();
    expect(row).toContain("| read |");
  }
});
