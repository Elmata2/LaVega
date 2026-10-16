/* Pure half of the business-savings watch: read figures out of page markdown,
 * compare them with a hand-kept offer. No I/O, no clock — `today` is an input.
 * A figure that is not on the page is reported missing, never guessed. */
import type { BusinessSavingsOffer } from "@lavega/core";

export type FoundFigures = {
  promoRatePct: number | null;
  signupFrom: string | null;
  signupUntil: string | null;
  durationMonths: number | null;
  capAmount: number | null;
  /** Keyed by plan name as written on the page, e.g. "Basic". */
  planRates: Record<string, number>;
};

export type Finding =
  | { kind: "changed"; field: string; stored: string; found: string }
  | { kind: "missing"; field: string; stored: string }
  | { kind: "fetch-failed"; url: string; error: string }
  | { kind: "promo-ending-soon"; signupUntil: string; daysLeft: number }
  | { kind: "promo-ended"; signupUntil: string };

export const ENDING_SOON_DAYS = 14;

/** "1,25" and "5.25" both → number. Several separators of one kind, or one
 *  separator followed by exactly three digits, is a thousands separator
 *  ("100,000", "10.000.000"). */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/[.,]+$/, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const seps = s.match(/[.,]/g) ?? [];
  if (seps.length === 0) return Number(s);
  const tail = s.slice(Math.max(s.lastIndexOf("."), s.lastIndexOf(",")) + 1);
  const thousands = seps.length > 1 ? new Set(seps).size === 1 : tail.length === 3;
  const n = thousands ? Number(s.replace(/[.,]/g, "")) : Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const isoFromDmy = (d: string, m: string, y: string) => `${y}-${m}-${d}`;

/** Promo figures from the savings page footnote. */
export function parsePromo(md: string): Omit<FoundFigures, "planRates"> {
  const rate = /Up to\s+(\d[\d.,]*)\s*%\s*p\.a\./i.exec(md);
  const dates = /from\s+(\d{2})\/(\d{2})\/(\d{4})\s+to\s+(\d{2})\/(\d{2})\/(\d{4})/i.exec(md);
  const months = /period of\s+(\d+)\s+months?/i.exec(md);
  const cap = /first\s+€\s?(\d[\d.,]*)\s+deposited/i.exec(md);
  return {
    promoRatePct: rate ? parseNumber(rate[1]!) : null,
    signupFrom: dates ? isoFromDmy(dates[1]!, dates[2]!, dates[3]!) : null,
    signupUntil: dates ? isoFromDmy(dates[4]!, dates[5]!, dates[6]!) : null,
    durationMonths: months ? Number(months[1]) : null,
    capAmount: cap ? parseNumber(cap[1]!) : null,
  };
}

/** "Interest rate (Basic)1,25% per annum" lines from the deposit sheet. */
export function parsePlanRates(md: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of md.matchAll(/Interest rate\s*\(([A-Za-z ]+?)\)\s*(\d[\d.,]*)\s*%/gi)) {
    const n = parseNumber(m[2]!);
    const plan = m[1]!.trim();
    if (n !== null && !(plan in out)) out[plan] = n;
  }
  return out;
}

/** Merge what several pages yielded; the first page with a figure wins. */
export function parsePages(pages: readonly string[]): FoundFigures {
  const merged: FoundFigures = {
    promoRatePct: null,
    signupFrom: null,
    signupUntil: null,
    durationMonths: null,
    capAmount: null,
    planRates: {},
  };
  for (const md of pages) {
    const p = parsePromo(md);
    merged.promoRatePct ??= p.promoRatePct;
    merged.signupFrom ??= p.signupFrom;
    merged.signupUntil ??= p.signupUntil;
    merged.durationMonths ??= p.durationMonths;
    merged.capAmount ??= p.capAmount;
    for (const [plan, rate] of Object.entries(parsePlanRates(md))) {
      if (!(plan in merged.planRates)) merged.planRates[plan] = rate;
    }
  }
  return merged;
}

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

export type FetchFailure = { url: string; error: string };

export function compareOffer(
  offer: BusinessSavingsOffer,
  found: FoundFigures,
  failures: readonly FetchFailure[],
  today: string,
): Finding[] {
  const findings: Finding[] = failures.map((f) => ({ kind: "fetch-failed", ...f }));
  // With a page down, every figure it carries would also read "missing"; the
  // fetch failure already says so.
  const pageDown = failures.length > 0;

  const check = (
    field: string,
    stored: string | number,
    got: string | number | null | undefined,
  ) => {
    if (got === null || got === undefined) {
      if (!pageDown) findings.push({ kind: "missing", field, stored: String(stored) });
    } else if (got !== stored) {
      findings.push({ kind: "changed", field, stored: String(stored), found: String(got) });
    }
  };

  for (const { plan, ratePct } of offer.planRates) {
    check(`Plan ${plan} (% p.a.)`, ratePct, found.planRates[plan]);
  }
  // Two-way: a plan the page lists that the offer does not know.
  const known = new Set(offer.planRates.map((r) => r.plan));
  for (const [plan, rate] of Object.entries(found.planRates)) {
    if (!known.has(plan)) {
      findings.push({
        kind: "changed",
        field: `Plan ${plan} (% p.a.)`,
        stored: "niet opgeslagen",
        found: String(rate),
      });
    }
  }
  const promo = offer.promo;
  if (!promo && (found.promoRatePct !== null || found.signupUntil !== null)) {
    const window = `${found.signupFrom ?? "?"}..${found.signupUntil ?? "?"}`;
    findings.push({
      kind: "changed",
      field: "Nieuwe actie op de pagina",
      stored: "geen actie",
      found: `${found.promoRatePct ?? "?"}% p.a., inschrijven ${window}`,
    });
  }
  if (promo) {
    check("Promo rate (% p.a.)", promo.ratePct, found.promoRatePct);
    check("Promo sign-up from", promo.signupFrom, found.signupFrom);
    check("Promo sign-up until", promo.signupUntil, found.signupUntil);
    check("Promo months", promo.durationMonths, found.durationMonths);
    check("Promo cap (EUR)", promo.capAmount, found.capAmount);

    const daysLeft = dayNumber(promo.signupUntil) - dayNumber(today);
    if (daysLeft < 0) findings.push({ kind: "promo-ended", signupUntil: promo.signupUntil });
    else if (daysLeft <= ENDING_SOON_DAYS) {
      findings.push({ kind: "promo-ending-soon", signupUntil: promo.signupUntil, daysLeft });
    }
  }
  return findings;
}

/** One table row per finding: field | stored | found. */
export function findingRow(f: Finding): { field: string; stored: string; found: string } {
  switch (f.kind) {
    case "changed":
      return { field: f.field, stored: f.stored, found: f.found };
    case "missing":
      return { field: f.field, stored: f.stored, found: "niet leesbaar op de pagina" };
    case "fetch-failed":
      return { field: `Pagina ophalen: ${f.url}`, stored: "-", found: f.error };
    case "promo-ending-soon":
      return {
        field: "Actie loopt af",
        stored: `inschrijven t/m ${f.signupUntil}`,
        found: `nog ${f.daysLeft} dag(en)`,
      };
    case "promo-ended":
      return {
        field: "Actie afgelopen",
        stored: `inschrijven t/m ${f.signupUntil}`,
        found: "verstreken",
      };
  }
}

/** Why a fetched body cannot be trusted, or null when it looks like a page. */
export function fetchSanityProblem(text: string): string | null {
  if (/just a quick security check/i.test(text)) return "bot challenge page";
  if (/^\s*(Warning|Error)\b/i.test(text))
    return `r.jina.ai failure header: ${text.trim().slice(0, 80)}`;
  if (text.trim().length < 500) return `body too short (${text.trim().length} chars)`;
  if (!text.includes("%") && !/Interest rate/i.test(text)) {
    return 'body has neither "%" nor "Interest rate"';
  }
  return null;
}

export type IssueAction =
  | { action: "none" }
  | { action: "upsert" }
  | { action: "close"; number: number };

/** What to do with the tracking issue, given the open issue (if any). */
export function decideIssueAction(
  hasFindings: boolean,
  existingOpenNumber: number | null,
): IssueAction {
  if (hasFindings) return { action: "upsert" };
  return existingOpenNumber === null
    ? { action: "none" }
    : { action: "close", number: existingOpenNumber };
}

const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export type OfferReport = { offer: BusinessSavingsOffer; findings: readonly Finding[] };

export const ISSUE_TITLE = "Zakelijk sparen: bron gewijzigd of actie loopt af";

export function renderIssueBody(reports: readonly OfferReport[], today: string): string {
  const parts = [`Datum controle: ${today}`, ""];
  for (const { offer, findings } of reports) {
    if (findings.length === 0) continue;
    parts.push(`## ${offer.bank} ${offer.product} (${offer.id})`, "");
    parts.push("| Veld | Opgeslagen | Gevonden |", "| --- | --- | --- |");
    for (const f of findings) {
      const r = findingRow(f);
      parts.push(`| ${cell(r.field)} | ${cell(r.stored)} | ${cell(r.found)} |`);
    }
    parts.push("", "Bronnen:", ...offer.sourceUrls.map((u) => `- ${u}`), "");
    parts.push(`Laatst handmatig gecontroleerd: ${offer.checkedOn}`, "");
  }
  parts.push(
    "Bijwerken in `packages/core/src/businessSavings.ts`, daarna `checkedOn` verzetten. Dit issue wordt door `scripts/business-savings-watch.ts` bijgehouden; het script past dat bestand nooit aan.",
  );
  return parts.join("\n");
}
