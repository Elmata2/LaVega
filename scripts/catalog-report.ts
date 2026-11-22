/* Turns the sweep's RunSummary into ONE GitHub issue, or nothing when the week
 * had nothing to say. Never edits the repo.
 *
 *   tsx scripts/catalog-report.ts --summary <path> [--dry] [--push-failed] */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCrashReport,
  buildReport,
  REPORT_LABEL,
  type RunSummary,
} from "./catalog/catalogReport.js";

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function loadSummary(path: string | undefined): RunSummary | null {
  if (!path) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    return raw && typeof raw === "object" && Array.isArray((raw as RunSummary).verdicts)
      ? (raw as RunSummary)
      : null;
  } catch {
    return null;
  }
}

const TITLE_PREFIX = "Catalogue report ";
const SUPERSEDED = "Superseded by this week's report.";

/** Open issues that carry the report label AND the workflow's own title. Nothing else is ever closed. */
function listSupersededReports(): number[] | null {
  try {
    const raw: unknown = JSON.parse(
      gh([
        "issue",
        "list",
        "--label",
        REPORT_LABEL,
        "--state",
        "open",
        "--json",
        "number,title",
        "--limit",
        "100",
      ]),
    );
    if (!Array.isArray(raw)) return null;
    return raw.flatMap((i: { number?: unknown; title?: unknown }) =>
      typeof i.number === "number" &&
      typeof i.title === "string" &&
      i.title.startsWith(TITLE_PREFIX)
        ? [i.number]
        : [],
    );
  } catch (e) {
    console.error(`could not list earlier reports, creating the new one anyway: ${e}`);
    return null;
  }
}

function runUrl(): string | null {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: runId } = process.env;
  return server && repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null;
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--summary");
  const dry = args.includes("--dry");
  const pushFailed = args.includes("--push-failed");

  let summary = loadSummary(i >= 0 ? args[i + 1] : undefined);
  // A failed commit or push means the catalogue did not change, whatever the sweep wrote.
  if (summary && pushFailed) {
    summary = { ...summary, status: "refused", refusedReason: "the commit or push failed" };
  }
  const report = summary
    ? buildReport(summary)
    : buildCrashReport(new Date().toISOString().slice(0, 10), runUrl());

  if (!report) {
    console.log("nothing to report");
    return;
  }
  const old = listSupersededReports() ?? [];
  if (dry) {
    for (const n of old) console.log(`would close #${n}`);
    console.log(`${report.title}\n\n${report.body}`);
    return;
  }
  const bodyFile = join(mkdtempSync(join(tmpdir(), "catalog-report-")), "body.md");
  writeFileSync(bodyFile, report.body);
  gh(["label", "create", REPORT_LABEL, "--force", "--description", "Weekly catalogue changes"]);
  const created = gh([
    "issue",
    "create",
    "--title",
    report.title,
    "--body-file",
    bodyFile,
    "--label",
    REPORT_LABEL,
  ]).trim();
  console.log(created);
  for (const n of old) {
    try {
      gh(["issue", "close", String(n), "--comment", SUPERSEDED]);
    } catch (e) {
      console.error(`could not close #${n}: ${e}`);
    }
  }
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
