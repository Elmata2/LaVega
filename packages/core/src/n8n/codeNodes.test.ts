import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { NODE_SPECS, buildCodeNode } from "./codeNodes.js";

/* De drift-test. De Code-nodes in de workflow-JSON zijn gegenereerd uit de
 * bestanden hiernaast; deze test bouwt ze opnieuw en vergelijkt. Loopt de JSON
 * achter (of is er in de n8n-UI in geknipt), dan valt de suite om in plaats van
 * dat het pas in een run met echte facturen opvalt. */

const workflowUrl = new URL("../../../../docs/n8n/lavega-invoices.json", import.meta.url);
const workflow = JSON.parse(readFileSync(workflowUrl, "utf8")) as {
  nodes: { id: string; name: string; type: string; parameters: Record<string, any> }[];
  connections: Record<string, { main: { node: string }[][] }>;
};

function node(id: string) {
  const found = workflow.nodes.find((n) => n.id === id);
  if (!found) throw new Error("node " + id + " ontbreekt in de workflow");
  return found;
}

for (const spec of NODE_SPECS) {
  test(`Code-node "${spec.name}" staat gelijk aan de bron in packages/core/src/n8n`, () => {
    const sources = spec.sources.map((file) =>
      readFileSync(new URL("./" + file, import.meta.url), "utf8"),
    );
    const target = node(spec.id);
    expect(target.name).toBe(spec.name);
    expect(target.parameters.jsCode).toBe(buildCodeNode(sources, spec.adapter));
  });
}

test("er staat geen export-regel in de gegenereerde nodes: n8n kent geen modules", () => {
  for (const spec of NODE_SPECS) {
    expect(node(spec.id).parameters.jsCode).not.toMatch(/^export /m);
  }
});

test("Download Attachments staat IN options — daar en nergens anders leest n8n hem", () => {
  const gmail = node("b1000000-0000-4000-8000-000000000003");
  // n8n leest alleen getNodeParameter('options.downloadAttachments'). Als sibling
  // van Simplify is het veld dood, en dat was precies de bug.
  expect(gmail.parameters.options.downloadAttachments).toBe(true);
  expect(gmail.parameters.downloadAttachments).toBeUndefined();
  // Simplify moet uit blijven: aan levert alleen headers, dus geen tekst en geen bijlagen.
  expect(gmail.parameters.simple).toBe(false);
});

test("de onleesbare mail heeft een uitgang: de If-node splitst in twee takken", () => {
  const branch = node("b1000000-0000-4000-8000-000000000007");
  expect(branch.type).toBe("n8n-nodes-base.if");
  const outputs = workflow.connections["Iets te lezen?"].main;
  expect(outputs).toHaveLength(2);
  expect(outputs[0][0].node).toBe("Bouw Claude-verzoek");
  expect(outputs[1][0].node).toBe("Melding: zelf ophalen");
  expect(workflow.connections["Melding: zelf ophalen"].main[0][0].node).toBe("Zet in de wachtrij");
});

test("de webhook geeft de meldingen mee terug en leegt beide rijen", () => {
  const serve = node("b1000000-0000-4000-8000-00000000000e");
  expect(serve.parameters.jsCode).toContain("store.notices = [];");
  expect(serve.parameters.jsCode).toContain("invoices, notices, servedAt");
});
