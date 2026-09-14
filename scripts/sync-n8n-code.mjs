#!/usr/bin/env node
/* Schrijf de geteste logica uit packages/core/src/n8n/ in de Code-nodes van
 * docs/n8n/lavega-invoices.json.
 *
 *   pnpm run sync:n8n           schrijft de JSON bij
 *   pnpm run sync:n8n --check   zegt alleen of hij bij is (exit 1 zo niet)
 *
 * De test packages/core/src/n8n/codeNodes.test.ts doet hetzelfde en faalt als
 * de JSON achterloopt, dus vergeten kan niet ongemerkt.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NODE_SPECS, buildCodeNode } from "../packages/core/src/n8n/codeNodes.js";

const root = new URL("../", import.meta.url);
/* BEIDE exports, niet één. `lavega-invoices.json` is de template die de app
 * pusht; `lavega-facturen-workflow.json` is de export die hij met de hand
 * importeert. apps/web/src/n8n-workflow.test.ts eist dat ze op precies vier
 * bekende punten verschillen, dus een sync die er maar één bijwerkt laat de
 * twee uit elkaar lopen en breekt die wacht. */
const workflowUrls = [
  new URL("docs/n8n/lavega-invoices.json", root),
  new URL("docs/n8n/lavega-facturen-workflow.json", root),
];
const sharedDir = new URL("packages/core/src/n8n/", root);

const check = process.argv.includes("--check");
const changed = [];
const pending = [];

for (const workflowUrl of workflowUrls) {
  const name = workflowUrl.pathname.split("/").pop();
  const workflow = JSON.parse(readFileSync(workflowUrl, "utf8"));
  let dirty = false;
  for (const spec of NODE_SPECS) {
    const node = workflow.nodes.find((n) => n.id === spec.id);
    if (!node) throw new Error(`Node ${spec.id} (${spec.name}) staat niet in ${name}.`);
    const sources = spec.sources.map((file) => readFileSync(new URL(file, sharedDir), "utf8"));
    const jsCode = buildCodeNode(sources, spec.adapter);
    if (node.parameters.jsCode !== jsCode) {
      changed.push(`${name}: ${spec.name}`);
      node.parameters.jsCode = jsCode;
      dirty = true;
    }
  }
  if (dirty) pending.push([workflowUrl, workflow]);
}

if (changed.length === 0) {
  console.log("n8n-code is bij: geen node gewijzigd.");
  process.exit(0);
}

if (check) {
  console.error(
    `n8n-code loopt achter op de bron: ${changed.join(", ")}. Draai \`pnpm run sync:n8n\`.`,
  );
  process.exit(1);
}

for (const [url, workflow] of pending) {
  writeFileSync(fileURLToPath(url), `${JSON.stringify(workflow, null, 2)}\n`);
}
console.log(`Bijgewerkt: ${changed.join(", ")}.`);
