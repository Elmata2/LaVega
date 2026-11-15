/**
 * Statement metadata detection (WS3.5, issue #293).
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure source: `app/models/account_statement/metadata_detector.rb`. No Ruby is
 * copied.
 *
 * Sure reads the document's own text first and the filename second, then scores
 * a parser confidence from which tier spoke. LaVega has no PDF text extractor
 * in this slice, so the filename is the first tier and a caller that already
 * extracted text (or the owner) can pass it as `text`; the confidence tiers are
 * Sure's, and a detection that found nothing scores 0.1 rather than pretending.
 */
import type { DetectedMetadata } from "./review.js";

const DATE_PATTERNS: RegExp[] = [
  /(?<![a-z0-9])(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})(?![a-z0-9])/gi,
  /(?<![a-z0-9])(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})(?![a-z0-9])/gi,
  /(?<![a-z0-9])(\d{8})(?![a-z0-9])/g,
];

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  /* Dutch spellings too: LaVega's statements are Dutch, and a file called
   * "afschrift augustus 2026" would otherwise carry no period (a deliberate
   * addition over Sure's English-only month pattern). */
  januari: 1,
  februari: 2,
  maart: 3,
  mrt: 3,
  mei: 5,
  juni: 6,
  juli: 7,
  augustus: 8,
  oktober: 10,
};

const MONTH_PATTERN =
  /(?<![a-z0-9])(?:(\d{4})[-_.](0?[1-9]|1[0-2])|(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|augustus|mrt|maart|mei|juni|juli|oktober|sep(?:t(?:ember)?)?|oct(?:ober)?|okt(?:ober)?|nov(?:ember)?|dec(?:ember)?)[-_\s.]+(\d{4}))(?![a-z0-9])/gi;

const LAST4_PATTERN =
  /(?:^|[^a-z0-9])(?:x{2,}|ending|last\s*4|acct|account|card)[^\d]*(\d{4})(?=\D|$)/i;

const CURRENCY_PATTERN = /\b(EUR|USD|GBP|CHF|SEK|NOK|DKK|PLN)\b/i;

/** Sure's text parser reads the IBAN's last four digits as the account hint. */
const IBAN_PATTERN = /\b([A-Z]{2}\d{2}[A-Z0-9]{6,30})\b/;

/** Sure's generic words: a filename made only of these says nothing about the
 *  institution or the account. */
const GENERIC_FILENAME_HINTS = [
  "statement",
  "statements",
  "bank statement",
  "bank statements",
  "account statement",
  "account statements",
  "credit card statement",
  "card statement",
  "afschrift",
  "rekeningafschrift",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoOf(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Every ISO day a text or filename spells, in the order found. */
export function datesIn(raw: string): string[] {
  const out: string[] = [];
  for (const pattern of DATE_PATTERNS) {
    for (const match of raw.matchAll(pattern)) {
      const parts = match.slice(1).map(Number);
      if (match[0].replace(/\D/g, "").length === 8 && parts.length === 1) {
        const digits = String(parts[0]);
        const iso = isoOf(
          Number(digits.slice(0, 4)),
          Number(digits.slice(4, 6)),
          Number(digits.slice(6, 8)),
        );
        if (iso != null) out.push(iso);
        continue;
      }
      const [a, b, c] = parts as [number, number, number];
      const iso = a > 1000 ? isoOf(a, b, c) : isoOf(c, b, a);
      if (iso != null) out.push(iso);
    }
  }
  return [...new Set(out)].sort();
}

/** The month a text spells as `YYYY-MM` or as a month name plus year. */
export function monthIn(raw: string): string | null {
  const match = MONTH_PATTERN.exec(raw);
  MONTH_PATTERN.lastIndex = 0;
  if (match == null) return null;
  if (match[1] != null && match[2] != null) {
    return `${match[1]}-${pad(Number(match[2]))}`;
  }
  const month = MONTH_NAMES[(match[3] ?? "").toLowerCase()];
  const year = Number(match[4]);
  return month == null || !Number.isFinite(year) ? null : `${year}-${pad(month)}`;
}

export type DetectInput = {
  filename: string;
  mime?: string | null;
  /** Text the caller already extracted (PDF/CSV), when it has any. */
  text?: string | null;
};

/**
 * The metadata a filename (and optional extracted text) can honestly support.
 * Text wins over the filename, exactly as Sure orders its tiers.
 */
export function detectStatementMetadata(input: DetectInput): DetectedMetadata {
  const filename = input.filename ?? "";
  const basename = filename.replace(/\.[^.]*$/, "");
  const sources: string[] = [];
  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  let accountLast4: string | null = null;
  let currency: string | null = null;
  let institutionHint: string | null = null;
  let accountNameHint: string | null = null;

  const text = (input.text ?? "").trim();
  if (text !== "") {
    const dates = datesIn(text);
    if (dates.length >= 2) {
      periodFrom = dates[0] as string;
      periodTo = dates[dates.length - 1] as string;
    } else if (dates.length === 1) {
      const month = (dates[0] as string).slice(0, 7);
      periodFrom = `${month}-01`;
      periodTo = lastDayOf(month);
    } else {
      const month = monthIn(text);
      if (month != null) {
        periodFrom = `${month}-01`;
        periodTo = lastDayOf(month);
      }
    }
    accountLast4 =
      text.match(LAST4_PATTERN)?.[1] ??
      (text.match(IBAN_PATTERN)?.[1]?.replace(/\D/g, "").slice(-4) || null);
    currency = text.match(CURRENCY_PATTERN)?.[1]?.toUpperCase() ?? null;
    if (periodFrom != null || accountLast4 != null || currency != null) sources.push("content");
  }

  const filenameDates = datesIn(basename);
  if (periodFrom == null) {
    if (filenameDates.length >= 2) {
      periodFrom = filenameDates[0] as string;
      periodTo = filenameDates[filenameDates.length - 1] as string;
    } else if (filenameDates.length === 1) {
      const month = (filenameDates[0] as string).slice(0, 7);
      periodFrom = `${month}-01`;
      periodTo = lastDayOf(month);
    } else {
      const month = monthIn(basename);
      if (month != null) {
        periodFrom = `${month}-01`;
        periodTo = lastDayOf(month);
      }
    }
    if (periodFrom != null) sources.push("filename");
  }
  if (accountLast4 == null) {
    const last4 = basename.match(LAST4_PATTERN)?.[1] ?? null;
    if (last4 != null) {
      accountLast4 = last4;
      if (!sources.includes("filename")) sources.push("filename");
    }
  }
  if (currency == null) {
    currency = basename.match(CURRENCY_PATTERN)?.[1]?.toUpperCase() ?? null;
  }

  // The name hint: strip what the patterns already consumed, then drop generic
  // words and years. Nothing left means no hint — never the filename itself.
  const hint = basename
    .replace(LAST4_PATTERN, " ")
    .replace(/\b\d{4}[-_.]\d{1,2}(?:[-_.]\d{1,2})?\b/g, " ")
    .replace(/\b\d{8}\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const meaningful = hint.toLowerCase();
  const generic = GENERIC_FILENAME_HINTS.some(
    (word) => meaningful === word || meaningful.replace(/\s+/g, " ") === word,
  );
  if (meaningful !== "" && !generic) {
    institutionHint = hint;
    accountNameHint = hint;
    if (!sources.includes("filename")) sources.push("filename");
  }

  const parserConfidence =
    sources.includes("content") && (periodFrom != null || accountLast4 != null)
      ? 0.85
      : sources.includes("filename") && periodFrom != null
        ? 0.65
        : sources.length > 0
          ? 0.45
          : 0.1;

  return {
    periodFrom,
    periodTo,
    accountLast4,
    institutionHint,
    accountNameHint,
    currency,
    metadataSources: sources,
    parserConfidence,
  };
}
