import type { RewardsBalance } from "./rewards.js";

/* Manually tracked balances — the LOW-TRUST half of BACKLOG item 7.
 *
 * Some numbers Enable Banking will never deliver: an Amex Membership Rewards
 * balance, a hotel programme, a cashback pot. Item 7 lists two ways to get them.
 * This module builds ONLY the low-trust one: LaVega notices the number has gone
 * stale, asks one question, and takes a reply that is *just the number*.
 *
 * NOT BUILT, DELIBERATELY: the high-trust path (an agent logging into a
 * provider's site on the owner's behalf to scrape the balance). That needs the
 * owner's provider credentials, which would be a stored secret and a live
 * outbound session per provider — the opposite of local-first, read-only and
 * "no new cloud dependency by default". Nothing here reaches for it, and no seam
 * is left pretending to.
 *
 * The whole module is pure: no clock (`asOf` is passed), no I/O, no model. The
 * question text never contains the last known number, so a due question is safe
 * to hand to the chat assistant; the ANSWER is parsed here, on the device.
 *
 * Rewards balances are the first — and today the only — source. `TrackedBalance`
 * is the neutral shape a second source would map onto, which is why the detector
 * takes it rather than `RewardsBalance` directly. */

export type TrackedSource = "rewards";

/** A number the owner maintains by hand, reduced to what staleness needs. */
export type TrackedBalance = {
  /** Stable id of the row in its source (for rewards: the RewardsBalance id). */
  id: string;
  source: TrackedSource;
  /** What to name in the question — the programme name for rewards. */
  label: string;
  /** What is being counted ("punten"), so the question reads naturally. */
  unit: string;
  /** ISO date the number was last confirmed by the owner. */
  updatedAt: string;
  /** How often this one should be refreshed. Absent ⇒ the default. */
  intervalDays?: number;
  /** ISO date before which LaVega must not ask again ("niet nu"). */
  snoozedUntil?: string;
};

export type TrackingState = "fresh" | "due" | "overdue" | "snoozed";

export type TrackedStatus = {
  id: string;
  source: TrackedSource;
  label: string;
  unit: string;
  state: TrackingState;
  updatedAt: string;
  /** Days since the number was last confirmed. */
  ageDays: number;
  /** ISO date the refresh became (or becomes) due. */
  dueDate: string;
  /** Days past `dueDate`; 0 while still fresh. */
  daysOverdue: number;
  /** The one-line Dutch question to put in front of the owner. Never contains
   *  the current or previous value. */
  question: string;
  snoozedUntil?: string;
};

/** A hand-kept balance is expected to be refreshed quarterly. Long enough not to
 *  nag, short enough that a points balance is never a year out of date. */
export const DEFAULT_TRACKING_INTERVAL_DAYS = 90;

/** How far past its due date a number goes from "due" (a quiet ask) to
 *  "overdue" (worth flagging in the alert center). */
export const TRACKING_OVERDUE_AFTER_DAYS = 30;

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** The one question to ask, in Dutch, ending in the instruction that makes this
 *  as cheap as replying to a WhatsApp message. Deliberately value-free: it names
 *  the programme and nothing else, so it can be shown in a notification or
 *  handed to the chat assistant without leaking a balance. */
export function trackingQuestion(t: Pick<TrackedBalance, "label" | "unit">): string {
  return t.unit === "punten"
    ? `Hoeveel punten staan er nu bij ${t.label}? Stuur alleen het getal.`
    : `Wat is het huidige saldo van ${t.label} (${t.unit})? Stuur alleen het getal.`;
}

/** Where one tracked number stands at `asOf`. `snoozed` only ever masks a number
 *  that WOULD be due — a fresh one is fresh regardless of a snooze. */
export function trackingStatus(t: TrackedBalance, asOf: string): TrackedStatus {
  const interval = t.intervalDays != null && t.intervalDays > 0 ? Math.floor(t.intervalDays) : DEFAULT_TRACKING_INTERVAL_DAYS;
  const dueDate = addDays(t.updatedAt, interval);
  const past = daysBetween(dueDate, asOf); // asOf - dueDate
  const state: TrackingState =
    past < 0 ? "fresh"
      : t.snoozedUntil != null && asOf < t.snoozedUntil ? "snoozed"
        : past > TRACKING_OVERDUE_AFTER_DAYS ? "overdue"
          : "due";
  return {
    id: t.id,
    source: t.source,
    label: t.label,
    unit: t.unit,
    state,
    updatedAt: t.updatedAt,
    ageDays: daysBetween(t.updatedAt, asOf),
    dueDate,
    daysOverdue: Math.max(0, past),
    question: trackingQuestion(t),
    ...(t.snoozedUntil != null ? { snoozedUntil: t.snoozedUntil } : {}),
  };
}

/** Every tracked number's status, in the order the caller supplied them. */
export function trackingStatuses(list: readonly TrackedBalance[], asOf: string): TrackedStatus[] {
  return list.map((t) => trackingStatus(t, asOf));
}

/** Only the ones worth asking about now (due or overdue), most overdue first,
 *  ties broken by label so the order is deterministic. Snoozed and fresh rows
 *  are not returned at all — this is the ask-list. */
export function dueTrackers(list: readonly TrackedBalance[], asOf: string): TrackedStatus[] {
  return trackingStatuses(list, asOf)
    .filter((s) => s.state === "due" || s.state === "overdue")
    .sort((a, b) => b.daysOverdue - a.daysOverdue || a.label.localeCompare(b.label));
}

/* ---------------------------------------------------------------------------
 * "Just the number" — parsing the reply.
 * ------------------------------------------------------------------------- */

/** Collapse a space used as a thousands separator: "245 000" → "245000", but
 *  "245 3" is left alone (a group of 3 digits is the only shape that reads as a
 *  separator). Run repeatedly for "1 234 567". */
function joinSpacedThousands(s: string): string {
  let out = s;
  for (;;) {
    const next = out.replace(/(\d)[ \u00a0](\d{3})(?!\d)/g, "$1$2");
    if (next === out) return out;
    out = next;
  }
}

/** Turn one digit token into a number, resolving `.` and `,`:
 *  - both present ⇒ the LAST one is the decimal ("1.234,56" NL, "1,234.56" EN)
 *  - one kind, more than once ⇒ thousands ("1.234.567")
 *  - one kind, once, followed by exactly 3 digits ⇒ thousands ("245.000", "1,234")
 *  - otherwise ⇒ decimal ("12,50", "1.5") */
function tokenToNumber(token: string): number {
  const neg = token.startsWith("-");
  const body = neg ? token.slice(1) : token;
  const lastDot = body.lastIndexOf(".");
  const lastComma = body.lastIndexOf(",");
  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;

  let plain: string;
  if (dots > 0 && commas > 0) {
    const decAt = Math.max(lastDot, lastComma);
    plain = body.slice(0, decAt).replace(/[.,]/g, "") + "." + body.slice(decAt + 1);
  } else if (dots + commas === 0) {
    plain = body;
  } else if (dots + commas > 1) {
    plain = body.replace(/[.,]/g, "");
  } else {
    const at = Math.max(lastDot, lastComma);
    const after = body.length - at - 1;
    plain = after === 3 ? body.replace(/[.,]/g, "") : body.slice(0, at) + "." + body.slice(at + 1);
  }
  const n = Number(plain);
  return neg ? -n : n;
}

const MULTIPLIERS: Record<string, number> = { k: 1_000, m: 1_000_000, mln: 1_000_000, mio: 1_000_000, miljoen: 1_000_000 };

/** Read a WhatsApp-style reply that is meant to be *just the number*.
 *
 *  Understands what a person actually types: "245000", "245.000", "245 000",
 *  "245k", "1,2 mln", "ongeveer 245.000 punten", "€ 12,50". Returns null when
 *  there is no number, or when there is MORE THAN ONE — two numbers in one reply
 *  is a sentence, not an answer, and guessing which one is the balance is
 *  exactly the mistake that would put a wrong figure in the vault. The caller
 *  asks again. The sign is preserved; whether a negative makes sense is the
 *  source's business (a points balance rejects it, a card debt would not). */
export function parseBalanceReply(text: string): number | null {
  const cleaned = joinSpacedThousands(String(text ?? "").toLowerCase().replace(/[€$£]/g, " "));
  const re = /(-?\d+(?:[.,]\d+)*)\s*(miljoen|mln|mio|k|m)?(?![a-z])/g;
  const found: number[] = [];
  for (const m of cleaned.matchAll(re)) {
    const value = tokenToNumber(m[1]);
    if (!Number.isFinite(value)) return null;
    found.push(m[2] ? value * MULTIPLIERS[m[2]] : value);
    if (found.length > 1) return null; // a sentence, not an answer
  }
  return found.length === 1 ? found[0] : null;
}

/* ---------------------------------------------------------------------------
 * The rewards source.
 * ------------------------------------------------------------------------- */

/** The Punten balances as tracked numbers. */
export function rewardsTracked(balances: readonly RewardsBalance[]): TrackedBalance[] {
  return balances.map((b) => ({
    id: b.id,
    source: "rewards" as const,
    label: b.program,
    unit: "punten",
    updatedAt: b.updatedAt,
    ...(b.intervalDays != null ? { intervalDays: b.intervalDays } : {}),
    ...(b.snoozedUntil != null ? { snoozedUntil: b.snoozedUntil } : {}),
  }));
}

/** Which Punten balances LaVega should ask about at `asOf`. */
export function dueRewards(balances: readonly RewardsBalance[], asOf: string): TrackedStatus[] {
  return dueTrackers(rewardsTracked(balances), asOf);
}

/** Apply a "just the number" reply to one programme: the balance becomes the
 *  replied number (points are whole, so it is rounded), `updatedAt` becomes
 *  `today`, and any snooze is cleared — the question has been answered.
 *  Returns null, changing nothing, when the id is unknown or the reply is not a
 *  single non-negative number; the caller re-asks rather than storing a guess. */
export function applyRewardsReply(
  balances: readonly RewardsBalance[],
  id: string,
  reply: string,
  today: string,
): RewardsBalance[] | null {
  if (!balances.some((b) => b.id === id)) return null;
  const value = parseBalanceReply(reply);
  if (value == null || value < 0) return null;
  return balances.map((b) => {
    if (b.id !== id) return b;
    const { snoozedUntil: _dropped, ...rest } = b;
    return { ...rest, points: Math.round(value), updatedAt: today };
  });
}

/** "Niet nu": don't ask about this programme again before `until`. Unknown id
 *  changes nothing. Immutable. */
export function snoozeTracker(
  balances: readonly RewardsBalance[],
  id: string,
  until: string,
): RewardsBalance[] {
  return balances.map((b) => (b.id === id ? { ...b, snoozedUntil: until } : b));
}
