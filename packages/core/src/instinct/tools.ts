import {
  CREDIT_CARD_PAYMENT_CATEGORY,
  DE_CATEGORY_RULES,
  DIRECT_DEBIT_CATEGORY,
  NL_CATEGORY_RULES,
  PERSON_CATEGORY,
} from "../categories.js";
import { ownAccounts } from "../views.js";
import { addDays, spendOf, spendOnDay, upcomingRenewals } from "./candidates.js";
import { INSTINCT_COPY, type MessageLocale } from "./copy.js";
import { formatCents, formatDay } from "./render.js";
import type { DailyInput } from "./types.js";

/* Read-only tools the WhatsApp answer step may pick from. The model chooses ONE
 * call (parseToolCall is the trust boundary for what it said); runTool is pure
 * and computes the figures; the facts are sentences rendered from those figures.
 * The union is closed: a new tool forces runTool's exhaustive switch to change.
 * There is no write tool. "Now" is `i.today`, never a clock. */

export type ToolCall =
  | { tool: "spending_on_day"; date: string }
  | { tool: "spending_in_range"; from: string; to: string; category?: string }
  | { tool: "compare_weekday"; date: string }
  | { tool: "upcoming_charges"; days: number }
  | { tool: "top_categories"; from: string; to: string }
  | { tool: "unknown" };

/** `containsBankText` is true when any fact embeds a string that came from bank data
 *  (a counterparty, merchant or remittance-derived name). Such a result must never
 *  reach a model. Rule names and category names are NOT bank text: the user typed
 *  them, or they come from the fixed built-in category list. */
export type ToolResult = {
  figures: Record<string, number | string>;
  facts: string[];
  containsBankText: boolean;
};

/** The fetch window: the last 90 days up to and including `today`. */
const WINDOW_DAYS = 90;
const MAX_UPCOMING_DAYS = 31;
const TOP_N = 5;
const UPCOMING_LIST_MAX = 10;

const UNKNOWN: ToolCall = { tool: "unknown" };

/* --- parse (trust boundary) --- */

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set([
  ...NL_CATEGORY_RULES.map((r) => r.category),
  ...DE_CATEGORY_RULES.map((r) => r.category),
  CREDIT_CARD_PAYMENT_CATEGORY,
  DIRECT_DEBIT_CATEGORY,
  PERSON_CATEGORY,
  "Reizen",
  "onbekend",
]);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DAY.test(v)) return false;
  try {
    addDays(v, 0);
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Exactly these keys, no more, none missing (optional ones may be absent). */
function hasKeys(o: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const keys = Object.keys(o);
  return (
    required.every((k) => keys.includes(k)) &&
    keys.every((k) => required.includes(k) || optional.includes(k))
  );
}

/** Model output in, a safe `ToolCall` out. Anything that is not exactly one of
 *  the closed shapes becomes `{ tool: "unknown" }`. Dates must be real calendar
 *  days; whether they fall inside the 90-day window is decided by `runTool`
 *  (which knows "today") by clamping, not here. */
export function parseToolCall(raw: unknown): ToolCall {
  if (!isPlainObject(raw) || typeof raw.tool !== "string") return UNKNOWN;
  switch (raw.tool) {
    case "spending_on_day":
    case "compare_weekday":
      if (!hasKeys(raw, ["tool", "date"]) || !isRealDay(raw.date)) return UNKNOWN;
      return { tool: raw.tool, date: raw.date };
    case "spending_in_range": {
      if (!hasKeys(raw, ["tool", "from", "to"], ["category"])) return UNKNOWN;
      if (!isRealDay(raw.from) || !isRealDay(raw.to) || raw.from > raw.to) return UNKNOWN;
      if (!("category" in raw)) return { tool: "spending_in_range", from: raw.from, to: raw.to };
      if (typeof raw.category !== "string" || !KNOWN_CATEGORIES.has(raw.category)) return UNKNOWN;
      return { tool: "spending_in_range", from: raw.from, to: raw.to, category: raw.category };
    }
    case "top_categories":
      if (!hasKeys(raw, ["tool", "from", "to"])) return UNKNOWN;
      if (!isRealDay(raw.from) || !isRealDay(raw.to) || raw.from > raw.to) return UNKNOWN;
      return { tool: "top_categories", from: raw.from, to: raw.to };
    case "upcoming_charges":
      if (!hasKeys(raw, ["tool", "days"])) return UNKNOWN;
      if (
        typeof raw.days !== "number" ||
        !Number.isInteger(raw.days) ||
        raw.days < 1 ||
        raw.days > MAX_UPCOMING_DAYS
      )
        return UNKNOWN;
      return { tool: "upcoming_charges", days: raw.days };
    default:
      return UNKNOWN;
  }
}

/* --- run --- */

function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

type Window = { from: string; to: string };

function windowOf(i: DailyInput): Window {
  return { from: addDays(i.today, -(WINDOW_DAYS - 1)), to: i.today };
}

/** Clamp a requested range to the window; null when nothing of it is covered. */
function clamp(w: Window, from: string, to: string): Window | null {
  const f = from < w.from ? w.from : from;
  const t = to > w.to ? w.to : to;
  return f > t ? null : { from: f, to: t };
}

function outside(w: Window, requested: Record<string, string>, k: Copy): ToolResult {
  return {
    figures: { ...requested, covered: 0, coveredFrom: w.from, coveredTo: w.to },
    facts: [k.outsideWindow({ from: w.from, to: w.to })],
    containsBankText: false,
  };
}

type Copy = (typeof INSTINCT_COPY)[MessageLocale]["tools"];

export function runTool(call: ToolCall, i: DailyInput, locale: MessageLocale): ToolResult {
  const k = INSTINCT_COPY[locale].tools;
  const day = (d: string) => formatDay(locale, d);
  const money = (c: number) => formatCents(locale, c);
  const w = windowOf(i);

  switch (call.tool) {
    case "spending_on_day": {
      if (call.date < w.from || call.date > w.to) return outside(w, { date: call.date }, k);
      const totalCents = spendOnDay(i, call.date);
      return {
        figures: { date: call.date, totalCents },
        facts: [k.spendingOnDay({ date: day(call.date), amount: money(totalCents) })],
        containsBankText: false,
      };
    }

    case "spending_in_range": {
      const requested = { from: call.from, to: call.to };
      const c = clamp(w, call.from, call.to);
      if (!c) return outside(w, requested, k);
      const own = ownAccounts(i.accounts);
      let totalCents = 0;
      for (const t of i.txs) {
        if (t.date < c.from || t.date > c.to) continue;
        const s = spendOf(t, i.rules, own);
        if (!s || (call.category !== undefined && s.category !== call.category)) continue;
        totalCents += s.cents;
      }
      const clamped = c.from !== call.from || c.to !== call.to;
      return {
        figures: {
          ...requested,
          ...(call.category === undefined ? {} : { category: call.category }),
          totalCents,
          coveredFrom: c.from,
          coveredTo: c.to,
        },
        facts: [
          k.spendingInRange({
            from: day(c.from),
            to: day(c.to),
            amount: money(totalCents),
            category: call.category ?? null,
          }),
          ...(clamped ? [k.coverage({ from: day(w.from), to: day(w.to) })] : []),
        ],
        containsBankText: false,
      };
    }

    case "compare_weekday": {
      const lastWeekDate = addDays(call.date, -7);
      if (lastWeekDate < w.from || call.date > w.to) return outside(w, { date: call.date }, k);
      const dateCents = spendOnDay(i, call.date);
      const lastWeekCents = spendOnDay(i, lastWeekDate);
      const diffCents = dateCents - lastWeekCents;
      const weekday = weekdayOf(call.date);
      return {
        figures: { date: call.date, lastWeekDate, dateCents, lastWeekCents, diffCents, weekday },
        facts: [
          k.compare({
            date: day(call.date),
            amount: money(dateCents),
            lastDate: day(lastWeekDate),
            lastAmount: money(lastWeekCents),
            diff: money(Math.abs(diffCents)),
            direction: diffCents > 0 ? "more" : diffCents < 0 ? "less" : "same",
            weekday: INSTINCT_COPY[locale].weekdays[weekday] ?? "",
          }),
        ],
        containsBankText: false,
      };
    }

    case "upcoming_charges": {
      const all = upcomingRenewals(i, call.days).sort(
        (a, b) => a.daysAway - b.daysAway || a.key.localeCompare(b.key),
      );
      const items = all.slice(0, UPCOMING_LIST_MAX);
      const more = all.length - items.length;
      const totalCents = all.reduce((sum, r) => sum + r.amountCents, 0);
      const figures: Record<string, number | string> = {
        days: call.days,
        count: all.length,
        totalCents,
      };
      if (more > 0) {
        figures.listed = items.length;
        figures.more = more;
      }
      items.forEach((r, n) => {
        figures[`charge${n + 1}Name`] = r.name;
        figures[`charge${n + 1}Date`] = r.dueDate;
        figures[`charge${n + 1}Cents`] = r.amountCents;
      });
      const facts =
        items.length === 0
          ? [k.upcomingNone({ days: call.days })]
          : [
              ...items.map((r) =>
                k.upcomingItem({
                  name: r.name,
                  amount: money(r.amountCents),
                  date: day(r.dueDate),
                }),
              ),
              ...(more > 0 ? [k.upcomingMore({ more })] : []),
              k.upcomingTotal({ amount: money(totalCents), days: call.days }),
            ];
      // r.name is the counterparty of a recurring charge: raw bank text.
      return { figures, facts, containsBankText: items.length > 0 };
    }

    case "top_categories": {
      const requested = { from: call.from, to: call.to };
      const c = clamp(w, call.from, call.to);
      if (!c) return outside(w, requested, k);
      const own = ownAccounts(i.accounts);
      const byCategory = new Map<string, number>();
      for (const t of i.txs) {
        if (t.date < c.from || t.date > c.to) continue;
        const s = spendOf(t, i.rules, own);
        if (s) byCategory.set(s.category, (byCategory.get(s.category) ?? 0) + s.cents);
      }
      const top = [...byCategory.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, TOP_N);
      const figures: Record<string, number | string> = {
        ...requested,
        coveredFrom: c.from,
        coveredTo: c.to,
        count: top.length,
      };
      top.forEach(([name, cents], n) => {
        figures[`category${n + 1}`] = name;
        figures[`category${n + 1}Cents`] = cents;
      });
      const clamped = c.from !== call.from || c.to !== call.to;
      return {
        figures,
        facts: [
          ...(top.length === 0
            ? [k.topNone({ from: day(c.from), to: day(c.to) })]
            : top.map(([name, cents]) => k.topItem({ category: name, amount: money(cents) }))),
          ...(clamped ? [k.coverage({ from: day(w.from), to: day(w.to) })] : []),
        ],
        // Category names: fixed built-in list or a rule the user typed, never bank text.
        containsBankText: false,
      };
    }

    case "unknown":
      return { figures: {}, facts: [], containsBankText: false };

    default: {
      const never: never = call;
      return never;
    }
  }
}
