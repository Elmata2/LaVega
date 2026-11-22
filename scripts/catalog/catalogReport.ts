import type {
  CatalogField,
  CatalogRoute,
  CatalogValue,
  FieldVerdict,
  HoldReason,
} from "@lavega/core";

export type RunSummary = {
  today: string;
  status: "written" | "refused" | "dry";
  /** The REFUSING TO WRITE line, when refused. */
  refusedReason: string | null;
  verdicts: FieldVerdict[];
  /** Carried for the run log, not shown in the issue. */
  kept: string[];
  /** Products with no figure this run. */
  failures: { product: string; reason: string }[];
  crossedAgeLine: { product: string; field: string; lastConfirmed: string }[];
  spendLines: string[];
  runUrl: string | null;
  /** Figures in the catalogue after the run. Absent in a summary written by an older sweep. */
  figuresTotal?: number;
  /** Verdicts whose kind is not "unjudged". */
  figuresJudged?: number;
  /** Figures for which isOlderThanMaxAge is true today. */
  figuresOlderThan12Months?: number;
};

export const REPORT_LABEL = "catalog-report";

const MAX_BODY = 60_000;
const CUT_NOTICE = "report cut, see the run log";
const MAX_FAILURE_LINES = 30;

const FIELD_LABEL: Record<CatalogField, string> = {
  fxFeePct: "foreign currency fee",
  convertFeePct: "currency conversion fee",
  interestPct: "interest rate",
  cashbackPct: "cashback",
  pointsPerEuro: "points",
  accountFee: "account fee",
};

const ROUTE_LABEL: Record<CatalogRoute, string> = {
  "provider-page": "provider page",
  "provider-pdf": "provider PDF",
  wayback: "web archive copy of the provider page",
  comparison: "comparison site",
  agent: "research agent",
};

const HOLD_REASON: Record<HoldReason, string> = {
  "out-of-range": "the value is outside the range that is possible for this field",
  "unknown-host": "the figure came from a website not seen before for this provider",
  "comparison-route": "the figure came from a comparison site, not the provider",
  "bad-source-url": "the source link is missing or broken",
};

/** All text from scraped pages or model output goes through here: one line, no markdown or mention syntax. */
function plain(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine
    .replace(/[\\`*_![\]<>|()]/g, (c) => `\\${c}`)
    .replace(/@/g, "@\u200B")
    .replace(/^#/, "\\#");
}

const SAFE_URL = /^https?:\/\/[^\s<>]+$/;
function link(url: string): string {
  const u = url.trim();
  if (SAFE_URL.test(u)) return `<${u}>`;
  return u ? plain(u) : "no source link";
}

const label = (field: string): string => FIELD_LABEL[field as CatalogField] ?? plain(field);

/** At most 2 decimals, Dutch decimal comma, trailing zeros dropped. */
const dutch = (n: number): string => String(Math.round(n * 100) / 100).replace(".", ",");

function figure(field: CatalogField, n: number): string {
  switch (field) {
    case "accountFee":
      return `€${(Math.round(n * 100) / 100).toFixed(2).replace(".", ",")} per year`;
    case "pointsPerEuro":
      return `${dutch(n)} ${Math.round(n * 100) / 100 === 1 ? "point" : "points"} per euro`;
    default:
      return `${dutch(n)}%`;
  }
}

const before = (v: FieldVerdict): string => (v.before ? figure(v.field, v.before.value) : "—");
const source = (v: CatalogValue): string => link(v.sourceUrl);

function changedLine(v: FieldVerdict, viaPending: boolean): string {
  const tail = viaPending ? " (after second read)" : "";
  return `- ${plain(v.product)}, ${label(v.field)}: ${before(v)} → ${figure(v.field, v.found.value)}${tail}. From the ${ROUTE_LABEL[v.found.route]}: ${source(v.found)}`;
}

function section(title: string, intro: string | null, lines: string[]): string[] {
  if (lines.length === 0) return [];
  return [`## ${title}`, ...(intro ? [intro] : []), ...lines, ""];
}

function cut(body: string): string {
  if (body.length <= MAX_BODY) return body;
  const room = MAX_BODY - CUT_NOTICE.length - 1;
  const head = body.slice(0, room);
  const lastBreak = head.lastIndexOf("\n");
  return `${lastBreak > 0 ? head.slice(0, lastBreak) : head}\n${CUT_NOTICE}`;
}

export function buildReport(summary: RunSummary): { title: string; body: string } | null {
  if (summary.status === "dry") return null;
  const refused = summary.status === "refused";

  const changed = refused
    ? []
    : summary.verdicts.flatMap((v) =>
        v.verdict.kind === "publish" ? [changedLine(v, v.verdict.viaPending)] : [],
      );
  const waiting = (refused ? [] : summary.verdicts).flatMap((v) =>
    v.verdict.kind === "pending"
      ? [
          `- ${plain(v.product)}, ${label(v.field)}: ${before(v)} → ${figure(v.field, v.verdict.pending.value)}. First seen ${plain(v.verdict.pending.seenAt)}. From the ${ROUTE_LABEL[v.found.route]}: ${source(v.found)}. Goes live if next week's run reads the same value.`,
        ]
      : [],
  );
  const held = (refused ? [] : summary.verdicts).flatMap((v) =>
    v.verdict.kind === "hold"
      ? [
          `- ${plain(v.product)}, ${label(v.field)}: ${before(v)} → ${figure(v.field, v.found.value)} not used, because ${HOLD_REASON[v.verdict.reason]}. Source: ${source(v.found)}`,
        ]
      : [],
  );
  const old = (refused ? [] : summary.crossedAgeLine).map(
    (c) => `- ${plain(c.product)}, ${label(c.field)}: last confirmed ${plain(c.lastConfirmed)}`,
  );

  if (!refused && [changed, waiting, held, old].every((s) => s.length === 0)) return null;

  const failures = summary.failures.map((f) => `- ${plain(f.product)}: ${plain(f.reason)}`);
  const failureLines =
    failures.length > MAX_FAILURE_LINES
      ? [
          ...failures.slice(0, MAX_FAILURE_LINES),
          `- and ${failures.length - MAX_FAILURE_LINES} more`,
        ]
      : failures;

  const title = refused
    ? `Catalogue report ${summary.today}: run refused, nothing published`
    : `Catalogue report ${summary.today}: ${changed.length} changed, ${held.length} held`;

  const head: string[] = [];
  if (refused) {
    head.push("This run wrote nothing. The catalogue is as it was before the run.", "");
    if (summary.refusedReason) head.push(plain(summary.refusedReason), "");
  }
  const { figuresTotal, figuresJudged, figuresOlderThan12Months } = summary;
  if (
    figuresTotal !== undefined &&
    figuresJudged !== undefined &&
    figuresOlderThan12Months !== undefined
  ) {
    head.unshift(
      `Checked this run: ${figuresJudged} of ${figuresTotal} figures. ${figuresOlderThan12Months} figures are older than 12 months.`,
      "",
    );
  }
  if (summary.runUrl) head.unshift(`Run log: ${link(summary.runUrl)}`, "");

  const lines = [
    ...head,
    ...section("Changed", null, changed),
    ...section("Waiting for a second read", "The old figure stays in place until then.", waiting),
    ...section("Held back", "The old figure stays in place for all of these.", held),
    ...section(
      "Older than 12 months",
      "These figures were not confirmed for 12 months. In this release they stay in the ranking with their date shown.",
      old,
    ),
    ...section("No figure this run", "No figure this run for:", failureLines),
    ...section(
      "Spend",
      null,
      summary.spendLines.map((s) => `- ${plain(s)}`),
    ),
  ];

  return { title, body: cut(lines.join("\n").trimEnd()) };
}

export function buildCrashReport(
  today: string,
  runUrl: string | null,
): { title: string; body: string } {
  return {
    title: `Catalogue report ${today}: run crashed, no summary written`,
    body: [
      "The weekly run left no summary file. Nothing is known about what it changed.",
      "No summary was written, so this report cannot say what the run did. Treat the catalogue as unchanged until the run log shows otherwise.",
      runUrl ? `Run log: ${link(runUrl)}` : "No run link is available.",
    ].join("\n\n"),
  };
}
