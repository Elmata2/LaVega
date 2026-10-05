import { redactProblem } from "./redact.js";

export type SentryApp = "web" | "server" | "investing-web" | "investing-server";

/* Privacy model: this is an allowlist, not a scrubber. A finance app cannot
 * enumerate every way a transaction, a vault fragment or a counterparty name
 * ends up inside an error event (a JSON.parse message quotes its input, a
 * context blob carries app state, a breadcrumb records a click on a label).
 * So the event is rebuilt from scratch out of the few fields that diagnose a
 * crash, and every other field is dropped by construction. Adding a field here
 * is a privacy decision, not a convenience. */

type Json = Record<string, unknown>;

const REDACTED_MESSAGE = "[redacted: message contained input data]";
const QUOTED = /"[^"]*"|'[^']*'|`[^`]*`/g;
// Uppercase 1-6 letter words, optionally with a 1-2 letter exchange suffix:
// AAPL, SKX, ASML.AS, BRK.B. Held tickers are portfolio data.
const TICKER = /\b[A-Z]{1,6}(?:\.[A-Z]{1,2})?\b/g;
// All-caps words that name a protocol, format or currency and reveal nothing about holdings.
const TICKER_KEEP = new Set([
  "HTTP",
  "HTTPS",
  "JSON",
  "URL",
  "API",
  "CORS",
  "SQL",
  "TLS",
  "SSL",
  "DNS",
  "UTF",
  "OK",
  "ID",
  "EUR",
  "USD",
  "GBP",
]);
const ID_SEGMENT = ":id";
const STATIC_SEGMENT = /^[a-z][a-z-]*$/;
const MAX_SEGMENT_LENGTH = 24;
const PATH_KEEP_CATEGORIES = new Set(["navigation", "http", "fetch", "xhr"]);
const TEXT_KEEP_CATEGORIES = PATH_KEEP_CATEGORIES;

const IBAN = /\b[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]){10,30}\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const CURRENCY_AMOUNT = /(?:[€$]|\b(?:EUR|USD|GBP)\b)\s?-?\d[\d.,]*/gi;
const DECIMAL_AMOUNT = /-?\d+[.,]\d+(?:\s?(?:EUR|€))?/gi;
const DIGIT_RUN = /\d{4,}/g;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const bool = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

/** Copies only the named keys, and only when the value passes its guard. */
function pick(source: unknown, guards: Record<string, (value: unknown) => unknown>): Json {
  if (!isRecord(source)) return {};
  const out: Json = {};
  for (const [key, guard] of Object.entries(guards)) {
    const value = guard(source[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function scrubText(value: string): string {
  return redactProblem(value)
    .replace(EMAIL, "[EMAIL]")
    .replace(IBAN, "[IBAN]")
    .replace(CURRENCY_AMOUNT, "[AMOUNT]")
    .replace(DECIMAL_AMOUNT, "[AMOUNT]")
    .replace(DIGIT_RUN, "[NUMBER]");
}

/** A segment survives only as a lowercase static word; tickers, ids, dots, digits and caps are masked. */
function normaliseSegment(segment: string): string {
  return segment === "" || (segment.length <= MAX_SEGMENT_LENGTH && STATIC_SEGMENT.test(segment))
    ? segment
    : ID_SEGMENT;
}

/** origin + path, every id-like segment replaced, no query or hash. */
export function normalisePath(url: string): string {
  let origin = "";
  let path = url;
  const absolute = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(url);
  if (absolute) {
    origin = absolute[0];
    path = url.slice(origin.length);
  }
  const cut = path.search(/[?#]/);
  if (cut !== -1) path = path.slice(0, cut);
  return origin + path.split("/").map(normaliseSegment).join("/");
}

function scrubExceptionValue(type: string | undefined, value: string): string {
  if (type === "SyntaxError") return REDACTED_MESSAGE;
  const masked = value
    .replace(QUOTED, '"…"')
    .replace(TICKER, (word) => (TICKER_KEEP.has(word) ? word : "[SYMBOL]"));
  return scrubText(masked);
}

function scrubFrame(frame: unknown): Json {
  const picked = pick(frame, {
    filename: (v) => str(v),
    function: (v) => str(v),
    lineno: (v) => num(v),
    colno: (v) => num(v),
    in_app: (v) => bool(v),
  });
  const filename = str(picked.filename);
  if (filename !== undefined) picked.filename = filename.replace(/[?#].*$/, "");
  return picked;
}

function scrubException(entry: unknown): ScrubbedException {
  const picked: ScrubbedException = pick(entry, { type: (v) => str(v) });
  const value = isRecord(entry) ? str(entry.value) : undefined;
  if (value !== undefined) picked.value = scrubExceptionValue(picked.type, value);
  if (isRecord(entry) && isRecord(entry.mechanism)) {
    picked.mechanism = pick(entry.mechanism, { type: (v) => str(v), handled: (v) => bool(v) });
  }
  if (isRecord(entry) && isRecord(entry.stacktrace) && Array.isArray(entry.stacktrace.frames)) {
    picked.stacktrace = { frames: entry.stacktrace.frames.map(scrubFrame) };
  }
  return picked;
}

const nameVersion = (v: unknown) => {
  const picked = pick(v, { name: (x) => str(x), version: (x) => str(x) });
  return Object.keys(picked).length > 0 ? picked : undefined;
};

function scrubContexts(contexts: unknown): Json | undefined {
  const picked = pick(contexts, {
    browser: nameVersion,
    os: nameVersion,
    runtime: nameVersion,
  });
  return Object.keys(picked).length > 0 ? picked : undefined;
}

export type ScrubbedBreadcrumb = {
  type?: string;
  category?: string;
  level?: string;
  timestamp?: number;
  message?: string;
  data?: Json;
};

export function scrubBreadcrumb<B extends object>(breadcrumb: B): B | null {
  const source = breadcrumb as Json;
  const category = str(source.category);
  if (category === "console" || category?.startsWith("ui.")) return null;
  const out: ScrubbedBreadcrumb = pick(source, {
    type: (v) => str(v),
    category: (v) => str(v),
    level: (v) => str(v),
    timestamp: (v) => num(v),
  });
  const message = str(source.message);
  if (message !== undefined && category !== undefined && TEXT_KEEP_CATEGORIES.has(category)) {
    out.message = scrubText(message);
  }
  const data = pick(source.data, {
    method: (v) => str(v),
    status_code: (v) => num(v),
    url: (v) => (typeof v === "string" ? normalisePath(v) : undefined),
    from: (v) => (typeof v === "string" ? normalisePath(v) : undefined),
    to: (v) => (typeof v === "string" ? normalisePath(v) : undefined),
  });
  if (Object.keys(data).length > 0) out.data = data;
  return out as unknown as B;
}

export type ScrubbedException = {
  type?: string;
  value?: string;
  mechanism?: { type?: string; handled?: boolean };
  stacktrace?: { frames: Json[] };
};

export type ScrubbedEvent = {
  event_id?: string;
  timestamp?: number;
  level?: string;
  platform?: string;
  environment?: string;
  release?: string;
  tags?: { app: string };
  sdk?: { name?: string; version?: string };
  contexts?: Json;
  request?: { method?: string; url?: string };
  exception?: { values: ScrubbedException[] };
  breadcrumbs?: ScrubbedBreadcrumb[];
};

/** Rebuilds a minimal event. Anything not named here (extra, user, fingerprint,
 * transaction, modules, server_name, message, logentry, other tags and contexts)
 * is dropped, including non-Error rejections serialised under extra. */
export function scrubEvent(event: object): ScrubbedEvent {
  const source = event as Json;
  const out: ScrubbedEvent = pick(source, {
    event_id: (v) => str(v),
    timestamp: (v) => num(v),
    level: (v) => str(v),
    platform: (v) => str(v),
    environment: (v) => str(v),
    release: (v) => str(v),
  });

  const app = isRecord(source.tags) ? str(source.tags.app) : undefined;
  if (app !== undefined) out.tags = { app };

  const sdk = pick(source.sdk, { name: (v) => str(v), version: (v) => str(v) });
  if (Object.keys(sdk).length > 0) out.sdk = sdk;

  const contexts = scrubContexts(source.contexts);
  if (contexts) out.contexts = contexts;

  const request = isRecord(source.request) ? source.request : undefined;
  const method = request ? str(request.method) : undefined;
  const url = request ? str(request.url) : undefined;
  if (method !== undefined || url !== undefined) {
    out.request = {
      ...(method === undefined ? {} : { method }),
      ...(url === undefined ? {} : { url: normalisePath(url) }),
    };
  }

  if (isRecord(source.exception) && Array.isArray(source.exception.values)) {
    out.exception = { values: source.exception.values.map(scrubException) };
  }

  if (Array.isArray(source.breadcrumbs)) {
    out.breadcrumbs = source.breadcrumbs.flatMap((crumb: unknown) => {
      const safe = isRecord(crumb) ? scrubBreadcrumb(crumb) : null;
      return safe ? [safe as ScrubbedBreadcrumb] : [];
    });
  }
  return out;
}

export type SentryOptionsInput = {
  dsn: string | undefined;
  environment: string | undefined;
  app: SentryApp;
};

/* No tracesSampleRate on purpose. @sentry/node enables its OpenTelemetry
 * performance integrations (http, express, pg, ...) when it is set at all,
 * even to 0 (hasSpansEnabled is a `!= null` check). Omitted, we get errors only. */
export function sentryOptions({ dsn, environment, app }: SentryOptionsInput) {
  const trimmed = dsn?.trim();
  if (!trimmed) return undefined;
  return {
    dsn: trimmed,
    ...(environment ? { environment } : {}),
    sendDefaultPii: false,
    // Release-health sessions are sent outside beforeSend; client reports likewise.
    sendClientReports: false,
    integrations: <I extends { name: string }>(defaults: I[]): I[] =>
      defaults.filter((integration) => integration.name !== "BrowserSession"),
    // Tracing is off, but a future change must not bypass the scrubber.
    beforeSendTransaction: (): null => null,
    initialScope: { tags: { app } },
    // The rebuilt event is a strict subset of Sentry's event shape, so handing
    // it back as the caller's own event type is sound.
    beforeSend: <E extends object>(event: E): E => scrubEvent(event) as unknown as E,
    beforeBreadcrumb: <B extends object>(breadcrumb: B): B | null => scrubBreadcrumb(breadcrumb),
  };
}
