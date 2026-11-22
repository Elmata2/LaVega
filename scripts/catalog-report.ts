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
  if (dry) {
    console.log(`${report.title}\n\n${report.body}`);
    return;
  }
  const bodyFile = join(mkdtempSync(join(tmpdir(), "catalog-report-")), "body.md");
  writeFileSync(bodyFile, report.body);
  gh(["label", "create", REPORT_LABEL, "--force", "--description", "Weekly catalogue changes"]);
  console.log(
    gh([
      "issue",
      "create",
      "--title",
      report.title,
      "--body-file",
      bodyFile,
      "--label",
      REPORT_LABEL,
    ]).trim(),
  );
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
