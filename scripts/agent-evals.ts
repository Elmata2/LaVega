/* Agent eval harness CLI (plan §3 WS5.9, #300).
 *
 *   pnpm agent:evals                    run every fixture offline + contract check
 *   pnpm agent:evals --update-contract  regenerate the reviewed contract snapshot
 *   pnpm agent:evals --mutate           prove a deliberate contract mutation FAILS
 *
 * The fixtures call the real investing tool registry, and the contract snapshot
 * pins each tool's name, scope, description and input schema. Run this after
 * changing a model, a prompt or a tool definition; `--mutate` is the harness's
 * own self-check that it fails loudly instead of passing a broken contract.
 *
 * No network and no model: a fixture supplies the data source and the scripted
 * model is part of the fixture (harness.ts). That makes it deterministic in CI
 * and free to run on every change. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_FIXTURES, evalRegistry } from "../apps/investing-server/src/evals/fixtures.js";
import {
  contractDrift,
  contractSnapshot,
  runEvalFixture,
  type ContractSnapshot,
} from "../apps/investing-server/src/evals/harness.js";
import { createInvestingTools } from "../apps/investing-server/src/tools/investingTools.js";

const contractPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../apps/investing-server/src/evals/contract.json",
);

const updateContract = process.argv.includes("--update-contract");
const mutate = process.argv.includes("--mutate");

function readContract(): ContractSnapshot {
  return JSON.parse(readFileSync(contractPath, "utf8")) as ContractSnapshot;
}

async function main(): Promise<void> {
  if (updateContract) {
    writeFileSync(contractPath, `${JSON.stringify(contractSnapshot(evalRegistry()), null, 2)}\n`);
    console.log(`agent-evals: contract snapshot written to ${contractPath}`);
    return;
  }

  if (mutate) {
    /* The self-check: rename a tool the fixtures call and prove the harness
     * reports a contract failure instead of passing. Exit 0 only when the
     * mutated run FAILED the way it must. */
    const fixture = EVAL_FIXTURES[0]!;
    const renamed = createInvestingTools(fixture.source).map((tool) =>
      tool.name === "get_positions" ? { ...tool, name: "get_holdings" } : tool,
    );
    try {
      await runEvalFixture(fixture, { tools: renamed });
    } catch (error) {
      console.log(
        `agent-evals: deliberate mutation failed the harness as intended — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    console.error("agent-evals: MUTATION DID NOT FAIL — the harness cannot catch a tool rename");
    process.exitCode = 1;
    return;
  }

  let failed = false;
  for (const fixture of EVAL_FIXTURES) {
    try {
      const result = await runEvalFixture(fixture);
      console.log(`ok   ${result.fixtureId} (${result.steps} tool calls): ${result.answer}`);
    } catch (error) {
      failed = true;
      console.error(`FAIL ${fixture.id}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const drift = contractDrift(evalRegistry(), readContract());
  if (drift.length > 0) {
    failed = true;
    console.error("FAIL tool contract drifted from the reviewed snapshot:");
    for (const line of drift) console.error(`     - ${line}`);
    console.error("     Review the change, then run: pnpm agent:evals --update-contract");
  } else {
    console.log(`ok   tool contract: ${evalRegistry().length} tools match the reviewed snapshot`);
  }

  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
