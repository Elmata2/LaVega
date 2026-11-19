/* Assistent chat evaluation against the REAL model, on a synthetic vault.
 *
 *   pnpm exec tsx scripts/assistant-chat-eval.ts                 run every case
 *   pnpm exec tsx scripts/assistant-chat-eval.ts --only 7,12     run some cases
 *   pnpm exec tsx scripts/assistant-chat-eval.ts --model medium  use mistral-medium
 *   pnpm exec tsx scripts/assistant-chat-eval.ts --record        also write the recording CI replays
 *   pnpm exec tsx scripts/assistant-chat-eval.ts --out <file>    write the results as markdown
 *
 * Needs MISTRAL_API_KEY (read from apps/server/.env; never printed). Sends
 * SYNTHETIC data only: the fixture in packages/core/src/chat/fixture.ts. Each case
 * runs through the real turn loop, tools and guards; only the model call is live.
 * One run is about 3 model calls per case. CI does not run this: it replays the
 * recording (apps/server/src/agent/assistantEval.test.ts). */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMistralProvider } from "../apps/server/src/agent/mistral.js";
import { MISTRAL_MEDIUM, MISTRAL_SMALL } from "../apps/server/src/agent/models.js";
import { runAssistantStep, sanitizeAssistantRequest } from "../apps/server/src/agent/assistant.js";
import {
  EVAL_CASES,
  EVAL_TODAY,
  evalLanguage,
  runEvalCase,
  type EvalRun,
} from "../apps/server/src/agent/assistantEval.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag("--only")?.split(",").map(Number);
const model = flag("--model") === "medium" ? MISTRAL_MEDIUM : MISTRAL_SMALL;
const record = args.includes("--record");
const out = flag("--out");
const RUNS = Number(flag("--runs") ?? 1);

/** MISTRAL_API_KEY from the environment, else apps/server/.env here or in the main checkout
 *  (a git worktree sits in .worktrees/<name>, two levels below it). Never printed. */
function loadKey(): string | undefined {
  if (process.env.MISTRAL_API_KEY) return process.env.MISTRAL_API_KEY;
  for (const rel of ["../apps/server/.env", "../../../apps/server/.env"]) {
    try {
      const env = readFileSync(join(here, rel), "utf8");
      const found = /^MISTRAL_API_KEY=(.*)$/m
        .exec(env)?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, "");
      if (found) return found;
    } catch {
      /* try the next place */
    }
  }
  return undefined;
}
const key = loadKey();
if (!key) {
  console.error("assistant-chat-eval: MISTRAL_API_KEY not found (environment or apps/server/.env)");
  process.exit(1);
}
const provider = createMistralProvider(key, model);

type Row = {
  id: number;
  label: string;
  question: string;
  expects: string;
  failures: string[];
  run: EvalRun;
  ms: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
};

const rows: Row[] = [];
let requests = 0;
for (let run = 1; run <= RUNS; run += 1)
  for (const c of EVAL_CASES) {
    if (only && !only.includes(c.id)) continue;
    let calls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    const started = Date.now();
    const run = await runEvalCase(c, async (req) => {
      calls += 1;
      requests += 1;
      return runAssistantStep(
        sanitizeAssistantRequest(
          { locale: evalLanguage(c), today: EVAL_TODAY, ...req },
          EVAL_TODAY,
        ),
        {
          provider,
          onUsage: (u) => {
            inputTokens += u.inputTokens;
            outputTokens += u.outputTokens;
          },
        },
      );
    }).catch((e: unknown): EvalRun => ({
      outcome: { kind: "no-answer", reason: "no-answer" },
      text: `ERROR ${e instanceof Error ? e.name : "unknown"}`,
      toolNames: [],
      steps: [],
    }));
    const failures = c.check(run);
    rows.push({
      id: c.id,
      label: c.label,
      question: c.question,
      expects: c.expects,
      failures,
      run,
      ms: Date.now() - started,
      calls,
      inputTokens,
      outputTokens,
    });
    console.log(
      `${failures.length === 0 ? "PASS" : "FAIL"} ${String(c.id).padStart(2)} ${c.label} (${calls} calls, ${Date.now() - started} ms)`,
    );
    if (failures.length > 0) console.log(`     ${failures.join("; ")}`);
    console.log(`     > ${run.text.replace(/\n/g, " / ")}`);
  }

const pass = rows.filter((r) => r.failures.length === 0).length;
const totalIn = rows.reduce((s, r) => s + r.inputTokens, 0);
const totalOut = rows.reduce((s, r) => s + r.outputTokens, 0);
const price = model === MISTRAL_MEDIUM ? { i: 1.5, o: 7.5 } : { i: 0.15, o: 0.6 };
const usd = (totalIn / 1e6) * price.i + (totalOut / 1e6) * price.o;
console.log(
  `\n${pass}/${rows.length} passed, ${requests} requests, ${totalIn} in / ${totalOut} out tokens, about USD ${usd.toFixed(4)}`,
);

if (RUNS > 1) {
  console.log("\nvariance (passes / runs):");
  for (const id of new Set(rows.map((r) => r.id)))
    console.log(
      `  case ${id}: ${rows.filter((r) => r.id === id && r.failures.length === 0).length}/${RUNS}`,
    );
}

if (record && RUNS === 1) {
  const file = join(here, "../apps/server/src/agent/assistantEval.recorded.json");
  const previous = (() => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as { cases: Record<string, unknown> };
    } catch {
      return { cases: {} };
    }
  })();
  for (const r of rows)
    previous.cases[String(r.id)] = {
      steps: r.run.steps,
      failures: r.failures,
      calls: r.calls,
      ms: r.ms,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
    };
  writeFileSync(
    file,
    `${JSON.stringify({ model, recordedAt: new Date().toISOString().slice(0, 10), cases: previous.cases }, null, 2)}\n`,
  );
  console.log(`recorded ${rows.length} case(s) to ${file}`);
}

if (out) {
  const lines = [
    `# Assistent chat: evaluation run`,
    ``,
    `Model: \`${model}\`. Synthetic vault only. Date of the vault: ${EVAL_TODAY}.`,
    `${pass}/${rows.length} passed. ${requests} model requests, ${totalIn} input and ${totalOut} output tokens (about USD ${usd.toFixed(4)}).`,
    ``,
    `| # | Case | Result | Calls | Latency | Answer |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.label} | ${r.failures.length === 0 ? "pass" : `FAIL: ${r.failures.join("; ")}`} | ${r.calls} | ${(r.ms / 1000).toFixed(1)} s | ${r.run.text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " / ")} |`,
    ),
    ``,
  ];
  writeFileSync(out, lines.join("\n"));
  console.log(`results written to ${out}`);
}
