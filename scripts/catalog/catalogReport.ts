import { CONFIRMED_DETAIL } from "@lavega/core";
import type {
  CatalogField,
  CatalogRoute,
  CatalogValue,
  FieldVerdict,
  FigureCoverage,
  HoldReason,
  NotCheckedCause,
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
  /** One status per catalogue figure. Absent in a summary written by an older sweep. */
  coverage?: FigureCoverage[];
  /** Figures in the catalogue after the run. Absent in a summary written by an older sweep. */
  figuresTotal?: number;
  /** Verdicts whose kind is not "unjudged". */
  figuresJudged?: number;
  /** Figures for which isOlderThanMaxAge is true today. */
  figuresOlderThan12Months?: number;
  /** Full accepted quotes of the confirm step, for a reviewer. Not printed in the report. */
  confirmQuotes?: { id: string; field: string; status: string; quote: string }[];
  /** Wall-clock minutes of the sweep. Absent in a summary written by an older sweep. */
  durationMinutes?: number;
  /** Products read at the same time. */
  concurrency?: number;
  /** Model calls retried after a 429 or a 5xx. Not printed in the report. */
  modelRetries?: { rateLimited: number; serverError: number };
  /** Model calls sent this run. Absent in a summary written by an older sweep. */
  modelCallsNew?: number;
  /** Replies reused because the request was identical to an earlier answered one. */
  modelCallsReused?: number;
  /** Calls answered by the fallback model after a timeout or a cut-off reply. */
  modelFallbacks?: number;
  /** Things that did not stop the run but need a look. Printed under the header. */
  warnings?: string[];
  /** The list's own reason per manual-hold key "productId.field". */
  manualHoldReasons?: Record<string, string>;
  /** Verified quote of the read behind a publish or pending verdict, key "productId.field". */
  evidenceQuotes?: Record<string, string>;
};

export const REPORT_LABEL = "catalog-report";

const MAX_BODY = 60_000;
const CUT_NOTICE = "report cut, see the run log";
const MAX_FAILURE_LINES = 30;
const MAX_CAUSE_LINES = 40;

/** The order is the order of the report. */
const CAUSE_ORDER: readonly NotCheckedCause[] = [
  "field-not-swept",
  "not-asked",
  "not-tracked",
  "not-in-this-run",
  "model-off",
  "no-source",
  "fetch-failed",
  "not-found-on-page",
  "no-figure-yet",
  "stopped-early",
];

const CAUSE_TEXT: Record<NotCheckedCause, string> = {
  "field-not-swept":
    "Not checked yet by the weekly run: account fees, points and cashback (planned)",
  "not-asked": "This product is checked for a different figure; this one is not asked yet",
  "not-tracked": "In the catalogue but not on the weekly run's watch list",
  "not-in-this-run": "Not part of this run",
  "model-off":
    "The model step did not run (no API key, or switched off), and no other route can read this product",
  "no-source": "No web source on file (figure was entered by hand)",
  "fetch-failed": "The provider's page or document could not be read",
  "not-found-on-page": "The page was read, but the figure could not be established from it",
  "no-figure-yet": "No figure on file yet for this product",
  "stopped-early":
    "The run stopped before it reached this product (cost ceiling, time limit or error)",
};

const WEAKER_ROUTES: ReadonlySet<string> = new Set([
  CONFIRMED_DETAIL["quote-check"],
  CONFIRMED_DETAIL["same-number"],
]);

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
  "change-not-cross-checked":
    "the page showed a different value, and the check on the stored value did not give a clear answer; the stored value stays and the next run checks again",
  "conflicting-read":
    "the page shows both the stored value and a different one; the stored value stays until a person or a later run settles it",
  "held-for-person": "a person must decide this figure; it is on the manual hold list",
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

/** "From the provider page: <url>" or, for the model, "Read by the model from: <url>". */
const from = (v: FieldVerdict): string =>
  v.found.route === "agent"
    ? `Read by the model from: ${source(v.found)}`
    : `From the ${ROUTE_LABEL[v.found.route]}: ${source(v.found)}`;

const MAX_QUOTE_CHARS = 200;
const MAX_HOLD_REASON_CHARS = 300;

/** `. Quote: "..."` for the read behind a verdict, or nothing when the summary has none. */
function quoteTail(summary: RunSummary, v: FieldVerdict): string {
  const q = summary.evidenceQuotes?.[`${v.id}.${v.field}`];
  return q ? `. Quote: "${plain(q.slice(0, MAX_QUOTE_CHARS))}"` : "";
}

function changedLine(summary: RunSummary, v: FieldVerdict, viaPending: boolean): string {
  const tail = viaPending ? " (after second read)" : "";
  return `- ${plain(v.product)}, ${label(v.field)}: ${before(v)} → ${figure(v.field, v.found.value)}${tail}. ${from(v)}${quoteTail(summary, v)}`;
}

const MAX_CONDITIONS_LINES = 30;
const MAX_WEAK_LINES = 30;
const MAX_CONDITIONS_CHARS = 200;

function conditionsLine(v: FieldVerdict): string {
  const now = v.found.conditions ? plain(v.found.conditions.slice(0, MAX_CONDITIONS_CHARS)) : "";
  const tail = v.before?.conditions === null ? `, was listed as unconditional; now: ${now}` : "";
  return `- ${plain(v.product)}, ${label(v.field)}: ${figure(v.field, v.found.value)}. ${from(v)}${tail}`;
}

function section(title: string, intro: string | null, lines: string[]): string[] {
  if (lines.length === 0) return [];
  return [`## ${title}`, ...(intro ? [intro] : []), ...lines, ""];
}

function runTimeLine(summary: RunSummary): string[] {
  return summary.durationMinutes === undefined
    ? []
    : [`Run time: ${summary.durationMinutes} minutes.`, ""];
}

function cut(body: string): string {
  if (body.length <= MAX_BODY) return body;
  const room = MAX_BODY - CUT_NOTICE.length - 1;
  const head = body.slice(0, room);
  const lastBreak = head.lastIndexOf("\n");
  return `${lastBreak > 0 ? head.slice(0, lastBreak) : head}\n${CUT_NOTICE}`;
}

const weeks = (n: number): string => `${n} ${n === 1 ? "week" : "weeks"}`;

function coverageHead(coverage: FigureCoverage[]): string[] {
  const count = (status: FigureCoverage["status"]) =>
    coverage.filter((f) => f.status === status).length;
  const confirmed = count("confirmed");
  const [changed, waiting, held] = [count("changed"), count("waiting"), count("held")];
  const checked = confirmed + changed + waiting + held;
  const lines = [
    `Checked this run: ${checked} of ${coverage.length} figures (${confirmed} confirmed, ${changed} changed, ${waiting} waiting, ${held} held).`,
  ];
  const weaker = coverage.filter(
    (f) => f.status === "confirmed" && f.detail && WEAKER_ROUTES.has(f.detail),
  ).length;
  if (weaker > 0) {
    lines.push(
      `Of the confirmed figures, ${weaker} ${weaker === 1 ? "was" : "were"} confirmed by a quote check or a same-number read, not by a full re-read.`,
    );
  }
  return lines;
}

function notCheckedSection(coverage: FigureCoverage[], minWeeks = 0): string[] {
  const out: string[] = [];
  for (const cause of CAUSE_ORDER) {
    const group = coverage.filter(
      (f) => f.status === "not-checked" && f.cause === cause && f.uncheckedWeeks >= minWeeks,
    );
    if (group.length === 0) continue;
    if (cause === "field-not-swept") {
      out.push(`- ${CAUSE_TEXT[cause]}: ${group.length} figures`);
      continue;
    }
    const sorted = [...group].sort(
      (a, b) => b.uncheckedWeeks - a.uncheckedWeeks || a.product.localeCompare(b.product),
    );
    // Nothing was looked at, so there is nothing to count in weeks: a long list adds no information.
    if (cause === "not-in-this-run") {
      out.push(
        "",
        `### ${CAUSE_TEXT[cause]}`,
        ...(sorted.length > MAX_CAUSE_LINES
          ? [`- ${sorted.length} figures`]
          : sorted.map((f) => `- ${plain(f.product)}, ${label(f.field)}`)),
      );
      continue;
    }
    const lines = sorted.map(
      (f) => `- ${plain(f.product)}, ${label(f.field)}: ${weeks(f.uncheckedWeeks)}`,
    );
    out.push(
      "",
      `### ${CAUSE_TEXT[cause]}`,
      ...(lines.length > MAX_CAUSE_LINES
        ? [...lines.slice(0, MAX_CAUSE_LINES), `- and ${lines.length - MAX_CAUSE_LINES} more`]
        : lines),
    );
  }
  return out.length ? ["## Not checked", ...out, ""] : [];
}

/** A run that stopped or could not be saved: no status counts, nothing that reads as published. */
function refusedReport(summary: RunSummary): { title: string; body: string } {
  const lines: string[] = [];
  if (summary.runUrl) lines.push(`Run log: ${link(summary.runUrl)}`, "");
  lines.push(
    "This run stopped early or its results could not be saved. Nothing from it was published.",
    "",
  );
  if (summary.refusedReason) lines.push(plain(summary.refusedReason), "");
  if (summary.coverage) {
    const read = summary.verdicts.filter((v) => v.verdict.kind !== "unjudged").length;
    const m = summary.coverage.length;
    lines.push(
      `It had read ${read} of ${m} figures before it stopped. All ${m} figures count as not checked this week.`,
      "",
      ...notCheckedSection(
        summary.coverage.map((f) => ({
          ...f,
          status: "not-checked" as const,
          cause: f.status === "not-checked" ? f.cause : ("stopped-early" as const),
          uncheckedWeeks: f.weeksIfNotSaved,
        })),
        2,
      ),
    );
  }
  lines.push(
    ...section(
      "Spend",
      null,
      summary.spendLines.map((s) => `- ${plain(s)}`),
    ),
    ...runTimeLine(summary),
  );
  return {
    title: `Catalogue report ${summary.today}: run refused, nothing published`,
    body: cut(lines.join("\n").trimEnd()),
  };
}

export function buildReport(summary: RunSummary): { title: string; body: string } | null {
  if (summary.status === "dry") return null;
  if (summary.status === "refused") return refusedReport(summary);

  const changed = summary.verdicts.flatMap((v) =>
    v.verdict.kind === "publish" && !v.verdict.conditionsOnly
      ? [changedLine(summary, v, v.verdict.viaPending)]
      : [],
  );
  const conditions = summary.verdicts.flatMap((v) =>
    v.verdict.kind === "publish" && v.verdict.conditionsOnly ? [conditionsLine(v)] : [],
  );
  const conditionsLines =
    conditions.length > MAX_CONDITIONS_LINES
      ? [
          ...conditions.slice(0, MAX_CONDITIONS_LINES),
          `- and ${conditions.length - MAX_CONDITIONS_LINES} more`,
        ]
      : conditions;
  const waiting = summary.verdicts.flatMap((v) =>
    v.verdict.kind === "pending"
      ? [
          `- ${plain(v.product)}, ${label(v.field)}: ${before(v)} → ${figure(v.field, v.verdict.pending.value)}. First seen ${plain(v.verdict.pending.seenAt)}. ${from(v)}${quoteTail(summary, v)}. Goes live if next week's run reads the same value.`,
        ]
      : [],
  );
  const heldWeeksOf = new Map(
    (summary.coverage ?? []).flatMap((f) =>
      f.status === "held" && f.heldWeeks !== undefined ? [[`${f.id}.${f.field}`, f.heldWeeks]] : [],
    ),
  );
  const held = summary.verdicts.flatMap((v) => {
    if (v.verdict.kind !== "hold") return [];
    const key = `${v.id}.${v.field}`;
    const weeksHeld = heldWeeksOf.get(key);
    const listed = summary.manualHoldReasons?.[key];
    const reasonTail =
      v.verdict.reason === "held-for-person" && listed
        ? ` Reason on the list: ${plain(listed.slice(0, MAX_HOLD_REASON_CHARS))}`
        : "";
    return [
      `- ${plain(v.product)}, ${label(v.field)}: ${before(v)} → ${figure(v.field, v.found.value)} not used, because ${HOLD_REASON[v.verdict.reason]}${weeksHeld !== undefined ? ` (held for ${weeks(weeksHeld)})` : ""}. Source: ${source(v.found)}${reasonTail}`,
    ];
  });
  const weakConfirmed = (summary.coverage ?? [])
    .filter((f) => f.status === "confirmed" && f.detail && WEAKER_ROUTES.has(f.detail))
    .sort((a, b) => a.product.localeCompare(b.product) || a.field.localeCompare(b.field))
    .map((f) => `- ${plain(f.product)}, ${label(f.field)}`);
  const weakLines =
    weakConfirmed.length > MAX_WEAK_LINES
      ? [
          ...weakConfirmed.slice(0, MAX_WEAK_LINES),
          `- and ${weakConfirmed.length - MAX_WEAK_LINES} more`,
        ]
      : weakConfirmed;
  const old = summary.crossedAgeLine.map(
    (c) => `- ${plain(c.product)}, ${label(c.field)}: last confirmed ${plain(c.lastConfirmed)}`,
  );

  const failures = summary.failures.map((f) => `- ${plain(f.product)}: ${plain(f.reason)}`);
  const failureLines =
    failures.length > MAX_FAILURE_LINES
      ? [
          ...failures.slice(0, MAX_FAILURE_LINES),
          `- and ${failures.length - MAX_FAILURE_LINES} more`,
        ]
      : failures;

  const title = `Catalogue report ${summary.today}: ${changed.length} changed, ${held.length} held`;

  const head: string[] = [];
  const { figuresTotal, figuresJudged, figuresOlderThan12Months } = summary;
  if (summary.coverage) {
    head.unshift(
      ...coverageHead(summary.coverage),
      ...(figuresOlderThan12Months !== undefined
        ? [`${figuresOlderThan12Months} figures are older than 12 months.`]
        : []),
      "",
    );
  } else if (
    figuresTotal !== undefined &&
    figuresJudged !== undefined &&
    figuresOlderThan12Months !== undefined
  ) {
    head.unshift(
      `Checked this run: ${figuresJudged} of ${figuresTotal} figures. ${figuresOlderThan12Months} figures are older than 12 months.`,
      "",
    );
  }
  if (summary.modelCallsNew !== undefined || summary.modelCallsReused !== undefined) {
    const fallbacks = summary.modelFallbacks
      ? `, ${summary.modelFallbacks} answered by the faster fallback model after a timeout`
      : "";
    const line = `Model calls: ${summary.modelCallsNew ?? 0} new, ${summary.modelCallsReused ?? 0} reused because the page and the question were unchanged${fallbacks}.`;
    // After the last "Checked this run" line, before the blank line that ends the head.
    if (head.length) head.splice(head.length - 1, 0, line);
    else head.push(line, "");
  }
  if (summary.runUrl) head.unshift(`Run log: ${link(summary.runUrl)}`, "");

  const lines = [
    ...head,
    ...section(
      "Warnings",
      null,
      (summary.warnings ?? []).map((w) => `- ${plain(w)}`),
    ),
    ...section("Changed", null, changed),
    ...section("Conditions text updated (figure unchanged)", null, conditionsLines),
    ...section("Waiting for a second read", "The old figure stays in place until then.", waiting),
    ...section("Held back", "The old figure stays in place for all of these.", held),
    ...section(
      "Confirmed by quote check or same-number read (weaker than a full re-read)",
      null,
      weakLines,
    ),
    ...section(
      "Passed the 12-month line this week",
      "These figures were not confirmed for 12 months. In this release they stay in the ranking with their date shown.",
      old,
    ),
    ...(summary.coverage ? notCheckedSection(summary.coverage) : []),
    ...section("No figure this run", "No figure this run for:", failureLines),
    ...section(
      "Spend",
      null,
      summary.spendLines.map((s) => `- ${plain(s)}`),
    ),
    ...runTimeLine(summary),
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
