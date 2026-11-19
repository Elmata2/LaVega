import {
  buildAgentTools,
  capAgentToolResult,
  findAgentTool,
  safeAgentToolError,
  type AgentToolDefinition,
  type AgentToolJsonSchema,
} from "../agentTools.js";
import { accountClassification, accountType, withCurrentBalances } from "../balance.js";
import { detectSubscriptions } from "../subscriptions.js";
import { occurrenceAmountCents, upcomingOccurrences } from "../bills/occurrences.js";
import { cardOfferOf } from "../instinct/cardOffer.js";
import { isMovedCategory } from "../movedMoney.js";
import type { DailyInput } from "../instinct/types.js";
import {
  MAX_WINDOW_DAYS,
  TOOL_CATEGORIES,
  parseToolCall,
  runTool,
  type ToolCall,
} from "../instinct/tools.js";
import { addDays } from "../instinct/candidates.js";
import { isEurCurrency, type Account, type Tx } from "../model.js";
import { categorize, enrichTxs, filterTxs, ownAccounts } from "../views.js";
import { norm } from "../hash.js";
import { cleanName } from "./clean.js";
import { centsOf, moneyOf, type Money } from "./money.js";
import type { VaultView } from "./view.js";
/** Text matching for the chat's filters: the shared normal form, with accents
 *  folded, so "cafe" finds "Café". Only for matching; nothing is shown from it. */
const fold = (s: string): string => norm(s).normalize("NFD").replace(/\p{M}/gu, "");

/* The assistant chat's tool set: eleven READ tools over the unlocked vault, run
 * in the browser. Each wraps an existing pure function (`runTool`,
 * `detectSubscriptions`, `computePlan` output ...); nothing here is new money
 * logic. The registry is core's `AgentToolDefinition`, the same one the MCP
 * server uses, so WhatsApp can adopt it later.
 *
 * What a result may hold: amounts as `{cents, text}`, dates, category names,
 * merchant and account names (cleaned, at most 60 characters), account TYPE,
 * bank, currency, balances. Never an IBAN or account key (accounts are aliases
 * a1, a2 ...), a transaction id, a description, a note or a tag. Every result is
 * capped at 25 rows and 12 KiB and carries `asOf` and what the data covers. */

export const CHAT_RESULT_MAX_ROWS = 25;
export const CHAT_RESULT_MAX_BYTES = 12 * 1024;
/** Leaves room for the envelope around `data` inside the 12 KiB. */
const DATA_MAX_BYTES = CHAT_RESULT_MAX_BYTES - 1024;
/** The chat looks back a year; the daily message and WhatsApp keep their 90 days. */
const CHAT_WINDOW_DAYS = MAX_WINDOW_DAYS;
/** Bank data lags a day or two; a tail shorter than this is not a gap. */
const COVERAGE_GRACE_DAYS = 2;
const NAME_MAX = 60;

export type ChatEnvelope = {
  asOf: string;
  /** The scope the lists were taken from (see `VaultView.scope`), when known. */
  scope: string | null;
  coverage: { from: string; to: string } | null;
  data: unknown;
  truncated: boolean;
  totalRows: number;
};

type ToolSpec = {
  name: string;
  description: string;
  schema: AgentToolJsonSchema;
};

const ISO_DAY_PROP = { type: "string", description: "Date, YYYY-MM-DD." };
const ACCOUNT_PROP = {
  type: "string",
  description:
    "Optional: one account, by its alias (a1, a2 ...) or exact name, both shown by the balances tool.",
};

const spec = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ToolSpec => ({
  name,
  description,
  schema: { type: "object", properties, required, additionalProperties: false },
});

/** Schemas and descriptions only: static, so the server can list them without a vault. */
export const CHAT_TOOL_SPECS: readonly ToolSpec[] = [
  spec(
    "spending_on_day",
    "Total spending (EUR, money out) on one day. Excludes own transfers, credit-card payoffs and money moved to your own savings or investment accounts. `dataCovers` says whether the data reaches that day.",
    { date: ISO_DAY_PROP, account: ACCOUNT_PROP },
    ["date"],
  ),
  spec(
    "spending_in_range",
    'Total spending (EUR, money out) between two dates, inclusive. This is the one call for "how much did I spend at a merchant in a period": pass `counterparty` (text in the merchant name). Add `category` or `account` ONLY when the user named one. Same rules as spending_on_day: money moved to your own savings or investment accounts, own transfers and card payoffs are not counted (say so when asked whether something counted as spending). Window: the last 366 days.',
    {
      from: ISO_DAY_PROP,
      to: ISO_DAY_PROP,
      category: {
        type: "string",
        enum: [...TOOL_CATEGORIES],
        description: "Leave out unless the user named a spending category.",
      },
      counterparty: {
        type: "string",
        description:
          "Optional: text in the merchant or counterparty name (for example albert heijn). A merchant, not an account: for one account use `account`. Matches names and categories only.",
      },
      account: ACCOUNT_PROP,
    },
    ["from", "to"],
  ),
  spec(
    "compare_weekday",
    "Spending on one day against the same weekday a week earlier, with the signed difference (positive = more than last week).",
    { date: ISO_DAY_PROP, account: ACCOUNT_PROP },
    ["date"],
  ),
  spec(
    "top_categories",
    "The five biggest spending categories between two dates, biggest first.",
    { from: ISO_DAY_PROP, to: ISO_DAY_PROP, account: ACCOUNT_PROP },
    ["from", "to"],
  ),
  spec(
    "upcoming_charges",
    "Recurring subscription-like charges expected in the next N days (1 to 31), at most 10, with a total.",
    { days: { type: "integer", minimum: 1, maximum: 31 } },
    ["days"],
  ),
  spec(
    "balances",
    "Every account with alias, name, bank, type, currency, balance and balance date, plus totals in EUR: assets, liabilities (money owed, e.g. a credit card) and net. Foreign-currency accounts are listed, never summed.",
    {},
    [],
  ),
  spec(
    "transactions",
    'Search individual payments. Returns at most 25 rows (date, counterparty, amount, category, account) plus how many matched (`matched`) and their signed sum (`sum`, EUR; money out is negative). Use it to look up a single payment, and to check "did a payment count as spending": search the name and report what was found with its amount. No descriptions. For a plain total at a merchant, spending_in_range with `counterparty` is shorter.',
    {
      search: {
        type: "string",
        description: "Text in the counterparty name or the category (as shown in the results).",
      },
      category: { type: "string" },
      from: ISO_DAY_PROP,
      to: ISO_DAY_PROP,
      minCents: {
        type: "integer",
        minimum: 0,
        description: "Smallest size of the payment, in cents.",
      },
      maxCents: {
        type: "integer",
        minimum: 0,
        description: "Largest size of the payment, in cents.",
      },
      account: ACCOUNT_PROP,
      sort: { type: "string", enum: ["date_desc", "date_asc", "amount_desc", "amount_asc"] },
      limit: { type: "integer", minimum: 1, maximum: 25 },
    },
    ["from", "to", "sort"],
  ),
  spec(
    "subscriptions",
    "Detected subscriptions: name, function, monthly price, cadence in days, last charge date and the price change as a fraction (0.1 = 10% up). At most 30, with the monthly total.",
    {},
    [],
  ),
  spec(
    "monthly_totals",
    "Income against spending for each of the last N calendar months (1 to 12). Own transfers and credit-card payoffs are left out.",
    { months: { type: "integer", minimum: 1, maximum: 12 } },
    ["months"],
  ),
  spec(
    "plan_summary",
    "The owner's computed plan: the monthly room to save (a range), income, fixed costs, savings rate, buffer in months and its gap, and the card in use against a better card. `available:false` when no plan exists.",
    {},
    [],
  ),
  spec(
    "upcoming_bills",
    "Bills and expected payments due in the next N days (1 to 60): name, due date, direction, amount (null when unknown) and source.",
    { days: { type: "integer", minimum: 1, maximum: 60 } },
    ["days"],
  ),
];

export const CHAT_TOOL_NAMES: readonly string[] = CHAT_TOOL_SPECS.map((s) => s.name);

/* --- helpers --- */

/** Bad arguments. `hint` says what to fix, in words the model can act on; it never
 *  holds a value the model sent. */
class ArgError extends Error {
  readonly _tag = "SchemaError";
  constructor(
    readonly hint = "Check the argument names and types in the tool description, then retry once.",
  ) {
    super("invalid arguments");
    this.name = "SchemaError";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function isRealDay(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Exactly these keys: no unknown key, no missing required one. */
function strictKeys(
  args: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): void {
  const keys = Object.keys(args);
  if (
    !required.every((k) => k in args) ||
    !keys.every((k) => required.includes(k) || optional.includes(k))
  )
    throw new ArgError(
      `Use exactly these arguments: ${[...required, ...optional.map((k) => `${k} (optional)`)].join(", ") || "none"}.`,
    );
}

function intIn(v: unknown, min: number, max: number, name = "value"): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw new ArgError(`${name} must be a whole number between ${min} and ${max}.`);
  return v;
}

function text(v: unknown, max: number, name = "value"): string {
  if (typeof v !== "string" || v.length === 0 || v.length > max)
    throw new ArgError(`${name} must be a non-empty text of at most ${max} characters.`);
  return v;
}

type Aliases = { byKey: Map<string, string>; byAlias: Map<string, string> };

/** a1, a2 ... in account-key order: stable for one vault, never derived from an IBAN. */
function aliasesOf(accounts: readonly Account[]): Aliases {
  const byKey = new Map<string, string>();
  const byAlias = new Map<string, string>();
  [...accounts]
    .sort((a, b) => a.key.localeCompare(b.key))
    .forEach((a, i) => {
      const alias = `a${i + 1}`;
      byKey.set(a.key, alias);
      byAlias.set(alias, a.key);
    });
  return { byKey, byAlias };
}

/** A Trading 212 style export name: "from_<date>_to_<date>…". Plain index
 *  checks, so a long name cannot make a pattern run slowly. */
function isExportFileName(name: string): boolean {
  const lower = name.toLowerCase();
  const from = lower.indexOf("from_");
  return from >= 0 && lower.indexOf("_to_", from + 5) >= 0;
}

/** Does this "name" look like an import artefact rather than a name: the account's own
 *  key or IBAN, four or more digits (card digits, account numbers), or a file name? */
function looksLikeIdentifier(a: Account): boolean {
  const name = (a.name || "").trim();
  const flat = (v: string) => v.replace(/\s+/g, "").toLowerCase();
  if (name === "" || flat(name) === flat(a.key) || flat(name) === flat(a.iban)) return true;
  if ((name.match(/\d/g) ?? []).length >= 4) return true;
  if (/\.[a-z0-9]{2,4}$/i.test(name) || isExportFileName(name)) return true;
  return !/\s/.test(name) && name.includes("_");
}

/** The shown name of an account: cleaned, and a neutral "Rekening a3" when the stored
 *  name is really a key, a card number or a file name. Bank and type are sent anyway. */
function accountLabel(view: VaultView, a: Account, alias: string): string {
  const neutral = `${view.locale === "en" ? "Account" : "Rekening"} ${alias}`;
  if (looksLikeIdentifier(a)) return neutral;
  const name = cleanName(a.name, NAME_MAX);
  return name === "" || name.includes("[") ? neutral : name;
}

function dailyInput(view: VaultView, txs: Tx[]): DailyInput {
  return {
    today: view.asOf,
    txs,
    accounts: view.accounts,
    rules: view.rules,
    mirror: { rules: [], dueDates: [], cardOffer: null },
    balances: [],
    rates: [],
    answers: {},
    state: { sentKeys: [], lastTipDate: null },
  };
}

function coverageOf(txs: readonly Tx[]): { from: string; to: string } | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const t of txs) {
    if (!t.date) continue;
    if (from === null || t.date < from) from = t.date;
    if (to === null || t.date > to) to = t.date;
  }
  return from === null || to === null ? null : { from, to };
}

/** Does the data reach the asked period? A tail within the bank's usual lag is not a gap. */
function dataCovers(
  cov: { from: string; to: string } | null,
  from: string,
  to: string,
  asOf: string,
): "full" | "partial" | "none" {
  if (!cov) return "none";
  const end = to > asOf ? asOf : to;
  if (end < cov.from || from > cov.to) return "none";
  if (from >= cov.from && addDays(cov.to, COVERAGE_GRACE_DAYS) >= end) return "full";
  return "partial";
}

type Piece = { coverage: ChatEnvelope["coverage"]; data: unknown; truncated?: boolean };

function envelope(view: VaultView, piece: Piece): ChatEnvelope {
  const capped = capAgentToolResult(piece.data, {
    maxRows: CHAT_RESULT_MAX_ROWS,
    maxBytes: DATA_MAX_BYTES,
  });
  return {
    asOf: view.asOf,
    scope: view.scope ?? null,
    coverage: piece.coverage,
    data: capped.value,
    truncated: capped.truncated || piece.truncated === true,
    totalRows: capped.totalRows,
  };
}

const money = (view: VaultView, cents: number, currency = "EUR"): Money =>
  moneyOf(view.locale, cents, currency);

const num = (v: number | string | undefined): number => (typeof v === "number" ? v : 0);
const str = (v: number | string | undefined): string => (typeof v === "string" ? v : "");

/* --- the five Instinct tools --- */

const ACCOUNT_HINT =
  "account must be an alias from the balances tool (a1, a2 ...) or the exact account name.";

/** An account by alias (a1) or by its shown name, case-insensitive; the name must be unambiguous. */
function accountKeyOf(view: VaultView, al: Aliases, ref: unknown): string {
  if (typeof ref !== "string") throw new ArgError(ACCOUNT_HINT);
  const wanted = ref.trim().toLowerCase();
  const byAlias = al.byAlias.get(wanted);
  if (byAlias !== undefined) return byAlias;
  const named = view.accounts.filter(
    (a) => accountLabel(view, a, al.byKey.get(a.key) ?? "a?").toLowerCase() === wanted,
  );
  if (named.length !== 1) throw new ArgError(ACCOUNT_HINT);
  return named[0]!.key;
}

/** The rows the spend tools count, by the SAME rules as the Statistiek block: money that
 *  only moves (own transfers, savings and investments, credit-card payoffs) is out of
 *  spending AND income; a row the owner marked `excluded` still counts; a Tikkie-type
 *  "Overboekingen" row counts too. `runTool` skips those two on its own for the daily
 *  message, so they are put back here: an excluded flag is cleared, and a transfer to
 *  another person is relabelled so `runTool` does not skip it. */
const OTHER_TRANSFER_LABEL = "Overboekingen aan anderen";
function statisticsTxs(view: VaultView, txs: readonly Tx[]): Tx[] {
  const own = ownAccounts(view.accounts);
  const out: Tx[] = [];
  for (const t of txs) {
    const category = categorize(t, view.rules, own);
    if (isMovedCategory(category)) continue;
    if (category === "Overboekingen")
      out.push({ ...t, category: OTHER_TRANSFER_LABEL, excluded: false });
    else out.push(t.excluded === true ? { ...t, excluded: false } : t);
  }
  return out;
}

/** Rows in [from, to] left out because they are not in euros (the app does the same). */
function foreignIn(txs: readonly Tx[], from: string, to: string): number {
  return txs.filter((t) => t.date >= from && t.date <= to && !isEurCurrency(t.currency)).length;
}

function scopedTxs(view: VaultView, args: Record<string, unknown>, al: Aliases): Tx[] {
  if (args.account === undefined) return view.txs;
  const key = accountKeyOf(view, al, args.account);
  return view.txs.filter((t) => t.accountKey === key);
}

/** What was wrong with the arguments of an Instinct tool call, without echoing them. */
function instinctHint(args: Record<string, unknown>): string {
  if ("days" in args) return "days must be a whole number between 1 and 31.";
  if ("category" in args && !TOOL_CATEGORIES.includes(String(args.category)))
    return "category must be one of the names listed in the tool schema.";
  if ("date" in args) return "date must be a real date written as YYYY-MM-DD.";
  return "from and to must be real dates written as YYYY-MM-DD, with from not after to.";
}

function instinctHandler(
  view: VaultView,
  al: Aliases,
  name: "spending_on_day" | "spending_in_range" | "compare_weekday" | "top_categories",
  args: Record<string, unknown>,
): ChatEnvelope {
  const { account: _account, counterparty: _counterparty, ...rest } = args;
  const scopeTxs = scopedTxs(view, args, al);
  let txs = scopeTxs;
  const counterparty =
    args.counterparty === undefined ? undefined : text(args.counterparty, NAME_MAX, "counterparty");
  if (counterparty !== undefined) {
    /* Same matching as the transactions search: the visible name and the category, never the description. */
    const needle = norm(counterparty);
    if (
      view.accounts.some(
        (a) =>
          norm(accountLabel(view, a, al.byKey.get(a.key) ?? "a?")) === needle ||
          norm(a.bank) === needle,
      )
    )
      throw new ArgError(
        "That text is an account name, not a merchant. To look at one account pass it as `account` (alias or exact name from the balances tool) and leave out `counterparty`.",
      );
    const own = ownAccounts(view.accounts);
    /* The CLEANED name, as the results show it: digits hidden in a raw name
     * (an IBAN, a card number) give no total, so the filter is not an oracle. */
    const folded = fold(counterparty);
    txs = txs.filter(
      (t) =>
        fold(cleanName(t.counterparty, NAME_MAX)).includes(folded) ||
        fold(cleanName(categorize(t, view.rules, own), NAME_MAX)).includes(folded),
    );
  }
  const call: ToolCall = parseToolCall({ tool: name, ...rest });
  if (call.tool === "unknown") throw new ArgError(instinctHint(rest));
  const cov = coverageOf(scopeTxs);
  const r = runTool(call, dailyInput(view, statisticsTxs(view, txs)), view.locale, {
    windowDays: CHAT_WINDOW_DAYS,
  });
  const f = r.figures;
  const outside = f.covered === 0;
  const foreign = (from: string, to: string) => foreignIn(txs, from, to);
  const m = (cents: number) => money(view, cents);

  switch (call.tool) {
    case "spending_on_day": {
      const data = outside
        ? { date: call.date, total: null, outsideWindow: true }
        : {
            date: call.date,
            total: m(num(f.totalCents)),
            dataCovers: dataCovers(cov, call.date, call.date, view.asOf),
            foreignExcluded: foreign(call.date, call.date),
          };
      return envelope(view, { coverage: cov, data });
    }
    case "spending_in_range": {
      const data = outside
        ? { from: call.from, to: call.to, total: null, outsideWindow: true }
        : {
            from: call.from,
            to: call.to,
            ...(call.category === undefined ? {} : { category: call.category }),
            ...(counterparty === undefined ? {} : { counterparty }),
            total: m(num(f.totalCents)),
            dataCovers: dataCovers(cov, call.from, call.to, view.asOf),
            foreignExcluded: foreign(call.from, call.to),
          };
      return envelope(view, { coverage: cov, data });
    }
    case "compare_weekday": {
      const data = outside
        ? { date: call.date, total: null, outsideWindow: true }
        : {
            date: call.date,
            weekday: num(f.weekday),
            total: m(num(f.dateCents)),
            lastWeekDate: str(f.lastWeekDate),
            lastWeekTotal: m(num(f.lastWeekCents)),
            diff: m(num(f.diffCents)),
            dataCovers: dataCovers(cov, str(f.lastWeekDate), call.date, view.asOf),
          };
      return envelope(view, { coverage: cov, data });
    }
    case "top_categories": {
      if (outside)
        return envelope(view, {
          coverage: cov,
          data: { from: call.from, to: call.to, categories: [], outsideWindow: true },
        });
      const categories = Array.from({ length: num(f.count) }, (_, n) => ({
        category: cleanName(str(f[`category${n + 1}`]), NAME_MAX),
        total: m(num(f[`category${n + 1}Cents`])),
      }));
      return envelope(view, {
        coverage: cov,
        data: {
          from: call.from,
          to: call.to,
          categories,
          dataCovers: dataCovers(cov, call.from, call.to, view.asOf),
          foreignExcluded: foreign(call.from, call.to),
        },
      });
    }
    default:
      throw new ArgError();
  }
}

function upcomingCharges(view: VaultView, args: Record<string, unknown>): ChatEnvelope {
  strictKeys(args, ["days"]);
  const call = parseToolCall({ tool: "upcoming_charges", days: args.days });
  if (call.tool !== "upcoming_charges") throw new ArgError(instinctHint({ days: args.days }));
  const r = runTool(call, dailyInput(view, statisticsTxs(view, view.txs)), view.locale, {
    windowDays: CHAT_WINDOW_DAYS,
  });
  const f = r.figures;
  const charges = Array.from({ length: Math.min(num(f.count), 10) }, (_, n) => ({
    name: cleanName(str(f[`charge${n + 1}Name`]), NAME_MAX),
    date: str(f[`charge${n + 1}Date`]),
    amount: money(view, num(f[`charge${n + 1}Cents`])),
  }));
  return envelope(view, {
    coverage: coverageOf(view.txs),
    data: {
      days: call.days,
      charges,
      more: num(f.more),
      total: money(view, num(f.totalCents)),
    },
  });
}

/* --- balances --- */

function balances(view: VaultView, al: Aliases): ChatEnvelope {
  const current = withCurrentBalances(view.accounts, view.txs, view.asOf);
  let assets = 0;
  let liabilities = 0;
  let unknown = 0;
  let foreign = 0;
  const rows = [...current]
    .sort((a, b) =>
      (al.byKey.get(a.key) ?? "").localeCompare(al.byKey.get(b.key) ?? "", "en", { numeric: true }),
    )
    .map((a) => {
      const alias = al.byKey.get(a.key) ?? "a?";
      const cents = a.balance === null ? null : centsOf(a.balance);
      const classification = accountClassification(a);
      if (!isEurCurrency(a.currency)) foreign += 1;
      else if (cents === null) unknown += 1;
      else if (classification === "liability") liabilities -= cents;
      else assets += cents;
      return {
        alias,
        name: accountLabel(view, a, alias),
        bank: cleanName(a.bank || "", NAME_MAX),
        type: accountType(a),
        classification,
        currency: a.currency,
        balance: cents === null ? null : money(view, cents, a.currency),
        balanceDate: a.balanceDate ?? null,
      };
    });
  return envelope(view, {
    coverage: coverageOf(view.txs),
    data: {
      accounts: rows,
      assets: money(view, assets),
      liabilities: money(view, liabilities),
      net: money(view, assets - liabilities),
      unknownBalances: unknown,
      foreignAccounts: foreign,
    },
  });
}

/* --- transactions --- */

const SORTS = ["date_desc", "date_asc", "amount_desc", "amount_asc"] as const;
type Sort = (typeof SORTS)[number];

function transactions(view: VaultView, al: Aliases, args: Record<string, unknown>): ChatEnvelope {
  strictKeys(
    args,
    ["from", "to", "sort"],
    ["search", "category", "minCents", "maxCents", "account", "limit"],
  );
  if (!isRealDay(args.from) || !isRealDay(args.to) || args.from > args.to)
    throw new ArgError(
      "from and to must be real dates written as YYYY-MM-DD, with from not after to.",
    );
  if (!SORTS.includes(args.sort as Sort))
    throw new ArgError(`sort must be one of ${SORTS.join(", ")}.`);
  const sort = args.sort as Sort;
  const limit = args.limit === undefined ? 10 : intIn(args.limit, 1, CHAT_RESULT_MAX_ROWS, "limit");
  const search = args.search === undefined ? undefined : text(args.search, NAME_MAX, "search");
  const category =
    args.category === undefined ? undefined : text(args.category, NAME_MAX, "category");
  const min = args.minCents === undefined ? 0 : intIn(args.minCents, 0, 1e12, "minCents");
  const max = args.maxCents === undefined ? Infinity : intIn(args.maxCents, 0, 1e12, "maxCents");
  const accountKey = args.account === undefined ? undefined : accountKeyOf(view, al, args.account);

  const own = ownAccounts(view.accounts);
  const scope = view.txs.filter((t) => accountKey === undefined || t.accountKey === accountKey);
  /* The model may search what it can SEE: the counterparty and the category. The
   * description is never sent, and a match count over it would tell the model what
   * it says. `filterTxs` is not given a search for that reason. */
  const needle = search === undefined ? "" : fold(search);
  const rows = filterTxs(enrichTxs([...scope], view.accounts), { from: args.from, to: args.to })
    .map((t) => ({ t, size: Math.abs(centsOf(t.amount)), cat: categorize(t, view.rules, own) }))
    .filter(
      (x) =>
        x.size >= min &&
        x.size <= max &&
        (category === undefined || x.cat === category) &&
        /* The CLEANED name, as the results show it: a hidden number in the raw name cannot be probed. */
        (needle === "" ||
          fold(cleanName(x.t.counterparty, NAME_MAX)).includes(needle) ||
          fold(cleanName(x.cat, NAME_MAX)).includes(needle)),
    );

  const byDate = (a: Tx, b: Tx) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  rows.sort((a, b) => {
    switch (sort) {
      case "date_desc":
        return byDate(b.t, a.t);
      case "date_asc":
        return byDate(a.t, b.t);
      case "amount_desc":
        return b.size - a.size || byDate(b.t, a.t);
      default:
        return a.size - b.size || byDate(b.t, a.t);
    }
  });

  const eurSum = rows.reduce(
    (s, x) => (isEurCurrency(x.t.currency) ? s + centsOf(x.t.amount) : s),
    0,
  );
  const shown = rows.slice(0, limit).map((x) => ({
    date: x.t.date,
    counterparty: cleanName(x.t.counterparty, NAME_MAX),
    amount: money(view, centsOf(x.t.amount), x.t.currency),
    category: cleanName(x.cat, NAME_MAX),
    account: al.byKey.get(x.t.accountKey) ?? "a?",
  }));
  return envelope(view, {
    coverage: coverageOf(scope),
    data: { rows: shown, matched: rows.length, sum: money(view, eurSum), sumCurrency: "EUR" },
    truncated: rows.length > shown.length,
  });
}

/* --- subscriptions, totals --- */

function subscriptions(view: VaultView): ChatEnvelope {
  const subs = detectSubscriptions(
    view.txs.filter((t) => t.excluded !== true && isEurCurrency(t.currency)),
    { asOf: view.asOf },
  );
  const total = subs.reduce((s, x) => s + x.monthlyCents, 0);
  return envelope(view, {
    coverage: coverageOf(view.txs),
    data: {
      subscriptions: subs.slice(0, 30).map((s) => ({
        name: cleanName(s.name, NAME_MAX),
        function: s.function,
        monthly: money(view, s.monthlyCents),
        cadenceDays: s.cadenceDays,
        lastDate: s.lastDate,
        changePct: s.changePct,
      })),
      monthlyTotal: money(view, total),
    },
    truncated: subs.length > 30,
  });
}

function monthlyTotalsTool(view: VaultView, args: Record<string, unknown>): ChatEnvelope {
  strictKeys(args, ["months"]);
  const n = intIn(args.months, 1, 12, "months");
  const own = ownAccounts(view.accounts);
  /* The Statistiek rule, nothing else: euro rows, moved money out of both sides, every
   * other inflow is income and every other outflow is spending. */
  const byMonth = new Map<string, { in: number; out: number; foreign: number }>();
  for (const t of view.txs) {
    if (!t.date) continue;
    const m = t.date.slice(0, 7);
    const b = byMonth.get(m) ?? { in: 0, out: 0, foreign: 0 };
    byMonth.set(m, b);
    if (!isEurCurrency(t.currency)) {
      b.foreign += 1;
      continue;
    }
    if (isMovedCategory(categorize(t, view.rules, own))) continue;
    const cents = centsOf(t.amount);
    if (cents >= 0) b.in += cents;
    else b.out -= cents;
  }
  const thisMonth = view.asOf.slice(0, 7);
  const picked = [...byMonth.entries()]
    .filter(([m]) => m <= thisMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-n);
  return envelope(view, {
    coverage: coverageOf(view.txs),
    data: {
      months: picked.map(([month, b]) => ({
        month,
        income: money(view, b.in),
        spent: money(view, b.out),
      })),
      foreignExcluded: picked.reduce((sum, [, b]) => sum + b.foreign, 0),
    },
  });
}

/* --- plan --- */

const cents = (v: number | null | undefined, view: VaultView): Money | null =>
  typeof v === "number" ? money(view, v) : null;

function planSummary(view: VaultView): ChatEnvelope {
  const plan = view.plan;
  if (!plan)
    return envelope(view, {
      coverage: null,
      data: {
        available: false,
        status: "not-calculated-yet",
        note: "The plan is not calculated yet. Tell the owner: Je plan is nog niet berekend. Open Jouw plan in Profiel, dan kan ik ermee rekenen. (English: Your plan is not calculated yet. Open Your plan in Profile and I can work with it.) Do not say they have no plan.",
      },
    });
  const month = plan.sections.month;
  const buffer = plan.sections.buffer;
  const cards = plan.sections.cards.figures;
  const room = month.figures.room;
  const [low, high] =
    room.kind === "computed" || room.kind === "stated"
      ? [room.lowCents, room.highCents]
      : [null, null];
  const rate = month.figures.savingsRate;
  const offer = cardOfferOf(plan, view.asOf);
  const inUse = cards.nets.find((n) => n.cardKey === cards.cardInUseKey);
  return envelope(view, {
    coverage: null,
    data: {
      available: true,
      month: {
        status: month.status,
        reason: month.statusReason.key,
        roomLow: cents(low, view),
        roomHigh: cents(high, view),
        income: cents(month.figures.incomeMiddleCents, view),
        fixedCosts: cents(month.figures.fixedCents, view),
        savingsRatePct: typeof rate === "number" ? Math.round(rate * 1000) / 10 : null,
      },
      buffer: {
        status: buffer.status,
        reason: buffer.statusReason.key,
        months: buffer.figures.incomeBufferMonths,
        targetMonths: buffer.figures.targetMonths,
        gap: cents(buffer.figures.gapCents, view),
        gapMonths: buffer.figures.gapMonths,
      },
      cards: {
        inUse: inUse ? cleanName(inUse.name, NAME_MAX) : null,
        betterCard: offer ? cleanName(offer.name, NAME_MAX) : null,
        yearlyGain: offer ? money(view, offer.yearlyGainCents) : null,
      },
    },
  });
}

/* --- bills --- */

function upcomingBills(view: VaultView, args: Record<string, unknown>): ChatEnvelope {
  strictKeys(args, ["days"]);
  const days = intIn(args.days, 1, 60, "days");
  const horizon = addDays(view.asOf, days);
  const billById = new Map(view.bills.map((b) => [b.id, b]));
  const viewKeys = new Set(view.accounts.map((a) => a.key));
  const mirrored = new Set(
    view.bills.flatMap((b) => (b.scheduledFlowId ? [b.scheduledFlowId] : [])),
  );
  const items: Array<{
    name: string;
    dueDate: string;
    direction: "in" | "out";
    amount: Money | null;
    source: string;
    overdue: boolean;
  }> = [];
  for (const o of upcomingOccurrences(view.bills, view.occurrences, view.asOf, days)) {
    const bill = billById.get(o.billId);
    if (!bill) continue;
    /* A bill belongs to the view only through its account; one with no account has no scope. */
    if (bill.accountKey ? !viewKeys.has(bill.accountKey) : view.scope !== undefined) continue;
    items.push({
      name: cleanName(bill.name, NAME_MAX),
      dueDate: o.dueOn,
      direction: bill.direction,
      amount: money(view, occurrenceAmountCents(bill, o, view.occurrences), bill.currency),
      source: "bill",
      overdue: o.dueOn < view.asOf,
    });
  }
  for (const f of view.flows) {
    if (f.status !== "expected" && f.status !== "confirmed") continue;
    if (mirrored.has(f.id) || f.dueDate < view.asOf || f.dueDate > horizon) continue;
    items.push({
      name: cleanName(f.label, NAME_MAX),
      dueDate: f.dueDate,
      direction: f.sign === 1 ? "in" : "out",
      amount: money(view, f.amountCents),
      source: f.source,
      overdue: false,
    });
  }
  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
  return envelope(view, { coverage: null, data: { items } });
}

/* --- the registry --- */

/** The eleven tools bound to one vault. Handlers return the capped envelope. */
export function createChatTools(view: VaultView): readonly AgentToolDefinition[] {
  const al = aliasesOf(view.accounts);
  const handlers: Record<string, (args: Record<string, unknown>) => ChatEnvelope> = {
    spending_on_day: (a) => {
      strictKeys(a, ["date"], ["account"]);
      return instinctHandler(view, al, "spending_on_day", a);
    },
    spending_in_range: (a) => {
      if ("search" in a)
        throw new ArgError(
          "spending_in_range has no `search`. To limit it to a merchant use `counterparty` (text in the name); to list the payments use the transactions tool with `search`.",
        );
      strictKeys(a, ["from", "to"], ["category", "account", "counterparty"]);
      return instinctHandler(view, al, "spending_in_range", a);
    },
    compare_weekday: (a) => {
      strictKeys(a, ["date"], ["account"]);
      return instinctHandler(view, al, "compare_weekday", a);
    },
    top_categories: (a) => {
      strictKeys(a, ["from", "to"], ["account"]);
      return instinctHandler(view, al, "top_categories", a);
    },
    upcoming_charges: (a) => upcomingCharges(view, a),
    balances: (a) => {
      strictKeys(a, []);
      return balances(view, al);
    },
    transactions: (a) => transactions(view, al, a),
    subscriptions: (a) => {
      strictKeys(a, []);
      return subscriptions(view);
    },
    monthly_totals: (a) => monthlyTotalsTool(view, a),
    plan_summary: (a) => {
      strictKeys(a, []);
      return planSummary(view);
    },
    upcoming_bills: (a) => upcomingBills(view, a),
  };
  const defs: AgentToolDefinition[] = CHAT_TOOL_SPECS.map((s) => ({
    ...s,
    scope: "read",
    handler: async (input) => {
      const run = handlers[s.name];
      if (!run) throw new ArgError();
      /* Models often fill an optional argument with "" meaning "none": that is absent. */
      return run(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== "")));
    },
  }));
  return buildAgentTools(defs, { scopes: ["read"] });
}

export type ChatToolRun = {
  ok: boolean;
  /** The JSON string that goes to the model as the tool message. */
  content: string;
  /** The parsed envelope when ok, the error object otherwise. */
  result: unknown;
};

/** Run one model-requested call. Never throws: a bad name or bad arguments is a
 *  safe error object the model can act on once. */
export async function runChatTool(
  tools: readonly AgentToolDefinition[],
  name: string,
  args: unknown,
): Promise<ChatToolRun> {
  const fail = (error: { error: string; hint: string }): ChatToolRun => ({
    ok: false,
    content: JSON.stringify(error),
    result: error,
  });
  const tool = findAgentTool(tools, name);
  if (!tool) return fail({ error: "unknown_tool", hint: "Use only the tools you were given." });
  if (!isObject(args))
    return fail({ error: "invalid_arguments", hint: "Arguments must be a JSON object." });
  try {
    const result = (await tool.handler(args)) as ChatEnvelope;
    const content = JSON.stringify(result);
    if (new TextEncoder().encode(content).length > CHAT_RESULT_MAX_BYTES)
      return fail({ error: "result_too_large", hint: "Ask for a narrower period or fewer rows." });
    return { ok: true, content, result };
  } catch (e) {
    if (e instanceof ArgError) return fail({ error: "invalid_arguments", hint: e.hint });
    return fail(safeAgentToolError(e));
  }
}
