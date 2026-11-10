import { DateTime, Option, Predicate, Schema } from "effect";
import type { N8nSetupSignal } from "./n8n.js";

/* The state of the forwarding guide. Local to this browser on purpose: ticks are
 * a memory aid, and the ONLY proven state is a passed test (passedAtMs). Pure
 * functions on a plain value; the component owns the React state. */

export const GMAIL_FORWARDING_URL = "https://mail.google.com/mail/u/0/#settings/fwdandpop";
export const GMAIL_FILTERS_URL = "https://mail.google.com/mail/u/0/#settings/filters";
/* VERIFIED 2026-10-21 (plan Task 9), WebFetch of Microsoft and Google docs:
 * - Outlook.com rules URL: support.microsoft.com/office/c24f5dea-9465-4df4-ad17-a50704d66c59
 *   lists https://outlook.live.com/mail/options/mail/rules (no "/0/"), so that is used.
 * - Work or school (Outlook on the web): Microsoft documents only the path
 *   "Settings, Mail, Rules" and gives NO outlook.office.com rules URL, so this
 *   constant is the generic mailbox and the copy names the path.
 * - M365 external-forwarding default: learn.microsoft.com/defender-office-365/
 *   outbound-spam-policies-external-email-forwarding (updated 2026-08-18) says the default
 *   "Automatic - System-controlled" is Off for new orgs since 2021 but can still be On for
 *   older ones. Behaviour differs by organisation, so the copy says "may block".
 * - Gmail #settings/fwdandpop and #settings/filters: Google documents the menu path
 *   (Settings, See all settings, Forwarding and POP/IMAP / Filters and Blocked Addresses)
 *   but not the fragments; kept, and the copy names the menu path as a fallback. */
export const OUTLOOK_COM_RULES_URL = "https://outlook.live.com/mail/options/mail/rules";
export const OUTLOOK_WORK_RULES_URL = "https://outlook.office.com/mail/";

/** Lives here, not in copy: the English copy tree may not contain Dutch words
 *  (copy/parity.test.ts bans "rekening"), and this is a search expression. */
export const GMAIL_FILTER_QUERY =
  "has:attachment filename:pdf (factuur OR invoice OR rekening OR nota OR receipt)";
export const RULE_WORDS = "factuur, invoice, rekening, nota, receipt";

export const TEST_POLL_MS = 20_000;
export const TEST_WINDOW_MS = 10 * 60 * 1000;
const STORAGE_KEY = "lavega.forwardingGuide.v1";

export type GuideTab = "gmail" | "outlook";

const GuideStateSchema = Schema.Struct({
  tab: Schema.Literals(["gmail", "outlook"]),
  ticks: Schema.Array(Schema.String),
  codeWaitStartedAtMs: Schema.NullOr(Schema.Number),
  /** receivedAtMs is the mail header time, for display only. seenAtMs is when
   *  LaVega fetched it: freshness and ordering use that, never the header. */
  confirmation: Schema.NullOr(
    Schema.Struct({ code: Schema.String, receivedAtMs: Schema.Number, seenAtMs: Schema.Number }),
  ),
  test: Schema.NullOr(
    Schema.Struct({
      code: Schema.String,
      startedAtMs: Schema.Number,
      receivedAtMs: Schema.NullOr(Schema.Number),
      receivedCode: Schema.NullOr(Schema.String),
    }),
  ),
  passedAtMs: Schema.NullOr(Schema.Number),
  /** Setup mails that arrived but could not be read (n8n `setupDropped`), this
   *  session only: the queue is drained, so a stored count would outlive its cause. */
  setupUnreadable: Schema.Number,
});
export type GuideState = Schema.Schema.Type<typeof GuideStateSchema>;
const decodeState = Schema.decodeUnknownOption(GuideStateSchema);

export function emptyGuideState(): GuideState {
  return {
    tab: "gmail",
    ticks: [],
    codeWaitStartedAtMs: null,
    confirmation: null,
    test: null,
    passedAtMs: null,
    setupUnreadable: 0,
  };
}

export function readNowMs(): number {
  return DateTime.toEpochMillis(DateTime.nowUnsafe());
}

export function loadGuideState(): GuideState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (Predicate.isNullish(raw) || raw === "") return emptyGuideState();
    const decoded = decodeState(JSON.parse(raw));
    return Option.match(decoded, {
      onNone: emptyGuideState,
      onSome: (s) => ({ ...s, setupUnreadable: 0 }),
    });
  } catch {
    return emptyGuideState();
  }
}

export function saveGuideState(state: GuideState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, setupUnreadable: 0 }));
  } catch {
    /* blocked or full: the guide still works for this session */
  }
}

const CODE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no l, o, 0, 1: it is typed into a subject

const secureBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

/** The alphabet has exactly 32 symbols, so masking a random byte with 31 is
 *  uniform: no division, no modulo bias. */
export function newTestCode(bytes: (n: number) => Uint8Array = secureBytes): string {
  let out = "";
  for (const b of bytes(4)) out += CODE_ALPHABET[b & 31];
  return out;
}

/** `LaVega test <code>` is what core's classifier anchors on. The trailing word
 *  is one of the filter words so the user's own Gmail filter or Outlook rule
 *  matches the self-sent mail (a PDF is still required by the filter). */
export function testSubject(code: string, locale: "nl" | "en"): string {
  return `LaVega test ${code} ${locale === "nl" ? "factuur" : "invoice"}`;
}

export function startTest(state: GuideState, code: string, nowMs: number): GuideState {
  return { ...state, test: { code, startedAtMs: nowMs, receivedAtMs: null, receivedCode: null } };
}

/** When the mail arrived: its own receivedAt if it parses and is not in the
 *  future, else the moment we saw it. Never throws. */
function arrivalMs(signal: N8nSetupSignal, nowMs: number): number {
  if (Predicate.isNullish(signal.receivedAt)) return nowMs;
  return Option.match(DateTime.make(signal.receivedAt), {
    onNone: () => nowMs,
    onSome: (dt) => Math.min(DateTime.toEpochMillis(dt), nowMs),
  });
}

export function applySignals(
  state: GuideState,
  signals: readonly N8nSetupSignal[],
  nowMs: number,
): GuideState {
  let next = state;
  for (const s of signals) {
    if (s.kind === "forwarding-confirmation") {
      const at = arrivalMs(s, nowMs);
      next = { ...next, confirmation: { code: s.code, receivedAtMs: at, seenAtMs: nowMs } };
      continue;
    }
    const t = next.test;
    const matches = t !== null && s.code === t.code;
    // A pending test takes any code; a result already recorded is only
    // replaced by a matching code (so a stale older mail never downgrades it).
    const takes = t !== null && (t.receivedAtMs === null || (matches && t.receivedCode !== t.code));
    // passedAtMs moves only when a pending test takes the mail: anyone who
    // knows the address can send "LaVega test abcd", so a stray one proves nothing.
    if (t !== null && takes) {
      next = {
        ...next,
        passedAtMs: nowMs,
        test: { ...t, receivedAtMs: nowMs, receivedCode: s.code },
      };
    }
  }
  return next;
}

/** Apply a whole ok fetch outcome: the signals, plus the count of setup mails
 *  that could not be read, which Task 10 shows as "a setup mail arrived that we
 *  couldn't read". */
export function applySetupFetch(
  state: GuideState,
  fetched: { readonly setup: readonly N8nSetupSignal[]; readonly setupDropped: number },
  nowMs: number,
): GuideState {
  const next = applySignals(state, fetched.setup, nowMs);
  return fetched.setupDropped > 0
    ? { ...next, setupUnreadable: next.setupUnreadable + fetched.setupDropped }
    : next;
}

export function dismissUnreadable(state: GuideState): GuideState {
  return { ...state, setupUnreadable: 0 };
}

export function toggleTick(state: GuideState, id: string, nowMs: number): GuideState {
  const on = state.ticks.includes(id);
  const ticks = on ? state.ticks.filter((t) => t !== id) : [...state.ticks, id];
  if (id !== "gmail:1") return { ...state, ticks };
  return { ...state, ticks, codeWaitStartedAtMs: on ? null : nowMs };
}

export function setTab(state: GuideState, tab: GuideTab): GuideState {
  return { ...state, tab };
}

export type TestStatus = "none" | "pending" | "passed" | "passed-other-code" | "timed-out";

export function testStatus(state: GuideState, nowMs: number): TestStatus {
  const t = state.test;
  if (t === null) return "none";
  if (t.receivedAtMs !== null) return t.receivedCode === t.code ? "passed" : "passed-other-code";
  return nowMs - t.startedAtMs > TEST_WINDOW_MS ? "timed-out" : "pending";
}

export type CodeStatus = "none" | "waiting" | "received" | "timed-out";

/** The one predicate behind the code UI, the stage and the polling gate. A code
 *  counts only if it was SEEN at or after the current wait started; a stored
 *  code from an earlier attempt or session, or one with no wait active, is not
 *  the answer. */
export function codeStatus(state: GuideState, nowMs: number): CodeStatus {
  const since = state.codeWaitStartedAtMs;
  if (since === null) return "none";
  if (state.confirmation !== null && state.confirmation.seenAtMs >= since) return "received";
  return nowMs - since <= TEST_WINDOW_MS ? "waiting" : "timed-out";
}

/** The confirmation to show as the current answer, or null. */
export function currentConfirmation(state: GuideState, nowMs: number): GuideState["confirmation"] {
  return codeStatus(state, nowMs) === "received" ? state.confirmation : null;
}

/** Restart the code wait after it timed out (or on demand). */
export function retryCodeWait(state: GuideState, nowMs: number): GuideState {
  return { ...state, codeWaitStartedAtMs: nowMs };
}

/** A code the normal pull stored before any wait began is still the answer if it
 *  is recent: start the wait at the moment it was seen, so it counts as current.
 *  Returns `state` itself when there is nothing to adopt. */
export function adoptFreshConfirmation(state: GuideState, nowMs: number): GuideState {
  const c = state.confirmation;
  if (codeStatus(state, nowMs) !== "none" || c === null) return state;
  return nowMs - c.seenAtMs <= TEST_WINDOW_MS
    ? { ...state, codeWaitStartedAtMs: c.seenAtMs }
    : state;
}

/** Fetch every TEST_POLL_MS only while there is something to wait for. */
export function isPollingActive(state: GuideState, nowMs: number): boolean {
  return testStatus(state, nowMs) === "pending" || codeStatus(state, nowMs) === "waiting";
}

export type GuideStage =
  | "no-address"
  | "address-ready"
  | "waiting-for-code"
  | "code-wait-timed-out"
  | "code-shown"
  | "test-pending"
  | "test-passed"
  | "test-timed-out";

/** The guide's headline state. `address-ready` is the idle state between "has an
 *  address" and the first thing the user does. */
export function guideStage(state: GuideState, nowMs: number, hasAddress: boolean): GuideStage {
  if (!hasAddress) return "no-address";
  const test = testStatus(state, nowMs);
  if (test === "passed" || test === "passed-other-code") return "test-passed";
  if (test === "pending") return "test-pending";
  if (test === "timed-out") return "test-timed-out";
  const code = codeStatus(state, nowMs);
  if (code === "received") return "code-shown";
  if (code === "waiting") return "waiting-for-code";
  if (code === "timed-out") return "code-wait-timed-out";
  return "address-ready";
}
