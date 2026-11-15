/* Weekly watch on the hand-kept business savings offers. Fetches each source
 * URL through r.jina.ai (the origin serves a bot challenge), compares the
 * figures with BUSINESS_SAVINGS_OFFERS and, when something differs or the
 * promo is about to end, opens or updates ONE GitHub issue. Never edits
 * businessSavings.ts.
 *
 *   tsx scripts/business-savings-watch.ts [--dry] [--today YYYY-MM-DD] */
import { execFileSync } from "node:child_process";
import { BUSINESS_SAVINGS_OFFERS } from "@lavega/core";
import {
  compareOffer,
  decideIssueAction,
  fetchSanityProblem,
  findingRow,
  ISSUE_TITLE,
  parsePages,
  renderIssueBody,
  type FetchFailure,
  type OfferReport,
} from "./catalog/businessSavingsWatch.js";

const FETCH_TIMEOUT_MS = 30_000;

function parseArgs(argv: readonly string[]): { dry: boolean; today: string } {
  const i = argv.indexOf("--today");
  const today = i >= 0 ? argv[i + 1] : new Date().toISOString().slice(0, 10);
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("--today needs YYYY-MM-DD");
  return { dry: argv.includes("--dry"), today };
}

async function fetchMarkdown(url: string): Promise<string> {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const problem = fetchSanityProblem(text);
  if (problem) throw new Error(problem);
  return text;
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function findOpenIssue(): number | null {
  const open = JSON.parse(
    gh(["issue", "list", "--state", "open", "--limit", "100", "--json", "number,title"]),
  ) as { number: number; title: string }[];
  return open.find((i) => i.title === ISSUE_TITLE)?.number ?? null;
}

function upsertIssue(body: string) {
  const existing = findOpenIssue();
  if (existing !== null) {
    gh(["issue", "edit", String(existing), "--body", body]);
    console.log(`\nUpdated issue #${existing}.`);
  } else {
    console.log(
      `\nOpened ${gh(["issue", "create", "--title", ISSUE_TITLE, "--body", body]).trim()}`,
    );
  }
}

function closeStaleIssue(number: number, today: string) {
  gh([
    "issue",
    "close",
    String(number),
    "--comment",
    `Bron komt weer overeen met businessSavings.ts (${today})`,
  ]);
  console.log(`\nClosed issue #${number}, source matches again.`);
}

async function main() {
  const { dry, today } = parseArgs(process.argv.slice(2));
  const reports: OfferReport[] = [];

  for (const offer of BUSINESS_SAVINGS_OFFERS) {
    const pages: string[] = [];
    const failures: FetchFailure[] = [];
    for (const url of offer.sourceUrls) {
      try {
        pages.push(await fetchMarkdown(url));
      } catch (e) {
        failures.push({ url, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const found = parsePages(pages);
    const findings = compareOffer(offer, found, failures, today);
    reports.push({ offer, findings });

    console.log(`\n${offer.id} (today ${today})`);
    console.log(
      found.promoRatePct === null && found.signupUntil === null
        ? "  promo n/a"
        : `  promo ${found.promoRatePct ?? "n/a"}% ${found.signupFrom ?? "n/a"}..${found.signupUntil ?? "n/a"}, ${found.durationMonths ?? "n/a"} months, cap ${found.capAmount ?? "n/a"}`,
    );
    console.log(`  plans ${JSON.stringify(found.planRates)}`);
    if (offer.promo) console.log(`  stored promo ends ${offer.promo.signupUntil}`);
    if (findings.length === 0) console.log("  all values match, no findings");
    for (const f of findings) {
      const r = findingRow(f);
      console.log(`  FINDING ${r.field} | stored ${r.stored} | found ${r.found}`);
    }
  }

  const clean = reports.every((r) => r.findings.length === 0);
  if (clean) {
    console.log("\nNo findings, no new issue.");
    if (dry) return;
    const decision = decideIssueAction(false, findOpenIssue());
    if (decision.action === "close") closeStaleIssue(decision.number, today);
    return;
  }
  const body = renderIssueBody(reports, today);
  if (dry) {
    console.log(`\n--dry: would open or update issue "${ISSUE_TITLE}":\n\n${body}`);
    return;
  }
  upsertIssue(body);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
