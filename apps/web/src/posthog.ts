import posthog, { type CaptureResult } from "posthog-js";
import { normalisePath } from "@lavega/core";

const apiKey = import.meta.env.VITE_POSTHOG_KEY;
const apiHost = import.meta.env.VITE_POSTHOG_HOST;
export const posthogConfigured = Boolean(apiKey && apiHost);

/* Vitest leaves DEV true and sets MODE to "test". A missing key must not fail
 * the suite, and the SDK must not start. `vite dev` still throws. */
const runningTests = import.meta.env.MODE === "test";

/* ── Waarom hier een eigen allowlist staat en niet alleen scrubText ──────────
 *
 * Sentry's `scrubEvent` (packages/core/src/sentryScrub.ts) gast op SENTRY's
 * eventvorm, niet op PostHog's `CaptureResult`; hetzelfde allowlist-denken
 * opnieuw toepassen is de enige manier om "er gaat niets mee wat we niet
 * noemen" hier ook waar te maken. Vrije tekst uit foutmeldingen valt weg:
 * een tegenpartijnaam valt niet betrouwbaar te maskeren.
 *
 * DE REBUILD IS DE BELOFTE. Alles wat niet in ALLOWED_OF_URL staat valt weg,
 * inclusief `$set`/`$set_once` (persoonskenmerken), `$elements` (DOM-tekst en
 * attributen) en elke onbekende sleutel. PostHog is voor ons productgedrag,
 * niet voor paginatekst; een veld hier toevoegen is een privac keuze. */

/** Sleutels die onveranderd door mogen: ze beschrijven de SDK, het apparaat of
 *  een opaque id en dragen geen paginainhoud. NIET door `scrubText` halen: dat
 *  zou "1.435.8" of een id met vier cijfers erin als bedrag maskeren.
 *
 *  Daarnaast de EIGEN eventeigenschappen die de app bewust verstuurt. Ze staan
 *  hier met naam en niet als "alles wat een string of getal is", en dat is de
 *  hele belofte: een bedrag, een IBAN of een tegenpartij die in een capture
 *  sluipt valt buiten deze lijst en verdwijnt. Een nieuwe eigenschap toevoegen
 *  is daarmee een privac keuze, net als bij Sentry's scrubEvent. */
const ALLOWED = new Set<string>([
  // SDK, apparaat, sessie.
  "$lib",
  "$lib_version",
  "$lib_custom_api_host",
  "$browser",
  "$browser_version",
  "$os",
  "$os_version",
  "$device_type",
  "$screen_height",
  "$screen_width",
  "$viewport_height",
  "$viewport_width",
  "$session_id",
  "$window_id",
  "$pageview_id",
  "$device_id",
  "$geoip_disable",
  "$process_person_profile",
  "distinct_id",
  // Eigen eventeigenschappen, uit de capture()-aanroepen in de app.
  "direction",
  "duplicate",
  "overwritten",
  "source",
  "currency",
  "invoice_count",
  "collections_erased",
  "rows_erased",
]);

/** Sleutels waarvan de waarde een ADRES is: die gaat door `normalisePath`,
 *  dat query en hash wegsnijdt en id-achtige padsegmenten vervangt. */
const URL_KEYS = new Set<string>([
  "$current_url",
  "$initial_current_url",
  "$referrer",
  "$initial_referrer",
]);

/** Sleutels met alleen host of pad: geen query, geen hash, geen id-segmenten. */
const HOST_KEYS = new Set<string>(["$host", "$referring_domain"]);
const PATH_KEYS = new Set<string>(["$pathname", "$initial_pathname"]);

const FRAME_KEYS: Record<string, true> = {
  lineno: true,
  colno: true,
  in_app: true,
};

const EXCEPTION_TYPES = new Set([
  "Error",
  "TypeError",
  "ReferenceError",
  "RangeError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function safeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Een adres dat we niet als zodanig herkennen levert niets op: "onbekend" is
 *  hier veiliger dan een willekeurige tekenreeks doorlaten. */
function scrubbedPath(value: unknown): string | undefined {
  const s = safeString(value);
  if (s === undefined) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return undefined;
  return normalisePath(s);
}

function scrubbedHost(value: unknown): string | undefined {
  const s = safeString(value);
  if (s === undefined) return undefined;
  if (!/^[a-z0-9.-]+$/i.test(s)) return undefined;
  return normalisePath(`https://${s}`).replace(/^https:\/\//, "");
}

function scrubbedPathOnly(value: unknown): string | undefined {
  const s = safeString(value);
  if (s === undefined) return undefined;
  return normalisePath(`https://x.invalid${s.startsWith("/") ? s : `/${s}`}`).replace(
    /^https:\/\/x\.invalid/,
    "",
  );
}

/** Keep numeric stack locations; filenames and function names may contain user data. */
function scrubFrame(frame: unknown): Record<string, unknown> {
  if (!isRecord(frame)) return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(FRAME_KEYS)) {
    const value = frame[key];
    if (key === "lineno" || key === "colno") {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
      continue;
    }
    if (key === "in_app") {
      if (typeof value === "boolean") out[key] = value;
      continue;
    }
  }
  return out;
}

/** Exception messages may quote arbitrary account, merchant or document text. */
function scrubException(entry: unknown): Record<string, unknown> {
  if (!isRecord(entry)) return {};
  const out: Record<string, unknown> = {};
  const type = safeString(entry.type);
  if (type !== undefined && EXCEPTION_TYPES.has(type)) out.type = type;
  if (isRecord(entry.mechanism)) {
    const mechanism: Record<string, unknown> = {};
    const mType = safeString(entry.mechanism.type);
    if (mType === "onerror" || mType === "onunhandledrejection") mechanism.type = mType;
    if (typeof entry.mechanism.handled === "boolean") mechanism.handled = entry.mechanism.handled;
    out.mechanism = mechanism;
  }
  const stacktrace = entry.stacktrace;
  if (isRecord(stacktrace) && Array.isArray(stacktrace.frames)) {
    out.stacktrace = { frames: stacktrace.frames.map(scrubFrame) };
  }
  return out;
}

function scrubExceptionProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const list = properties.$exception_list;
  if (Array.isArray(list)) out.$exception_list = list.map(scrubException);
  const type = safeString(properties.$exception_type);
  if (type !== undefined && EXCEPTION_TYPES.has(type)) out.$exception_type = type;
  const level = safeString(properties.$exception_level);
  if (level === "error" || level === "warning") out.$exception_level = level;
  if (typeof properties.$exception_synthetic === "boolean")
    out.$exception_synthetic = properties.$exception_synthetic;
  return out;
}

/** Rebuilds a PostHog capture out of the fields that diagnose product use.
 *  Every other property is dropped by construction, so a VAT amount, an IBAN,
 *  a counterparty name or a parse-error body never leaves for PostHog. Wired
 *  in as `before_send`, which PostHog runs for every capture — events,
 *  autocapture and exceptions alike. */
export function scrubPostHogEvent(event: CaptureResult): CaptureResult {
  const properties = isRecord(event.properties) ? event.properties : {};
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (ALLOWED.has(key)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        safe[key] = value;
      continue;
    }
    if (URL_KEYS.has(key)) {
      const url = scrubbedPath(value);
      if (url !== undefined) safe[key] = url;
      continue;
    }
    if (HOST_KEYS.has(key)) {
      const host = scrubbedHost(value);
      if (host !== undefined) safe[key] = host;
      continue;
    }
    if (PATH_KEYS.has(key)) {
      const path = scrubbedPathOnly(value);
      if (path !== undefined) safe[key] = path;
      continue;
    }
  }

  if (event.event === "$exception") Object.assign(safe, scrubExceptionProperties(properties));

  /* `$set`/`$set_once`/`$unset` zijn persoonskenmerken en worden hier NIET
   * doorgegeven. identify() stuurt het account-id als distinct_id; de e-mail
   * gaat er bewust niet in (zie Root.tsx), dus er valt niets te bewaren.
   *
   * Het event wordt expliciet opgebouwd en niet gespread: anders zouden
   * `$set`/`$set_once`/`$unset` uit het origineel alsnog meegaan. De
   * allowlist-belofte geldt voor het HELE event, niet alleen `properties`. */
  return {
    uuid: event.uuid,
    event: event.event,
    properties: safe,
    ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
  };
}

if (!runningTests && (!apiKey || !apiHost)) {
  if (import.meta.env.DEV) {
    const missingVariable = apiKey ? "VITE_POSTHOG_HOST" : "VITE_POSTHOG_KEY";
    throw new Error(
      `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
    );
  }
} else if (!runningTests && apiKey && apiHost) {
  posthog.init(apiKey, {
    api_host: apiHost,
    defaults: "2026-05-30",
    /* PostHog's before_send runs for every capture, exceptions included; there
     * is no separate exception hook in this SDK version, so this one covers
     * `$exception` too (`capture_exceptions` only decides WHAT is captured). */
    before_send: (event) => (event === null ? null : scrubPostHogEvent(event)),
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    /* No replay: a browser-recording of a finance vault is the widest screen
     * this app has, and it is not needed to fix a crash. Text masking is set
     * as a second layer for anything the allowlist above lets through. */
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    logs: {
      serviceName: "lavega-web",
      environment: import.meta.env.MODE,
    },
  });
}

export default posthog;
