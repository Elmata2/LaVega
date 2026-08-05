import type { Account, Tx, Rule } from "./model.js";
import { norm } from "./hash.js";
import { NL_CATEGORY_RULES_NORMALIZED } from "./categories.js";

/* Pure derivations behind the Transacties and Rekeningen views. No I/O — these
 * take the already-loaded accounts/txs and return view-ready data, so the
 * React components stay thin and the logic is unit-tested here. */

export type EnrichedTx = Tx & { entity: string; bank: string; accountName: string };

/** Join each tx to its account so the Transacties table can show entity/bank
 *  without a per-row lookup. A tx whose accountKey has no account (shouldn't
 *  normally happen) falls back to entity "onbekend" — matching consolidate. */
export function enrichTxs(txs: Tx[], accounts: Account[]): EnrichedTx[] {
  const byKey = new Map(accounts.map((a) => [a.key, a]));
  return txs.map((t) => {
    const a = byKey.get(t.accountKey);
    return { ...t, entity: a?.entity ?? "onbekend", bank: a?.bank ?? "", accountName: a?.name ?? t.accountKey };
  });
}

export type TxFilter = { entity?: string; accountKey?: string; search?: string; from?: string; to?: string };

/** Apply the (combinable) Transacties filters. Search is case/space-insensitive
 *  over counterparty + description (via norm). from/to bound the date range
 *  inclusively (ISO dates compare lexicographically). Input order is preserved. */
export function filterTxs(txs: EnrichedTx[], f: TxFilter): EnrichedTx[] {
  const q = f.search ? norm(f.search) : "";
  return txs.filter((t) => {
    if (f.entity && t.entity !== f.entity) return false;
    if (f.accountKey && t.accountKey !== f.accountKey) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (q && !(norm(t.counterparty).includes(q) || norm(t.description).includes(q))) return false;
    return true;
  });
}

export type AccountSummary = { account: Account; txCount: number };

/** Per-account transaction count for the Rekeningen table (balance is already
 *  on the account). Accounts with zero txs are still returned. */
export function accountSummaries(accounts: Account[], txs: Tx[]): AccountSummary[] {
  const counts = new Map<string, number>();
  for (const t of txs) counts.set(t.accountKey, (counts.get(t.accountKey) ?? 0) + 1);
  return accounts.map((a) => ({ account: a, txCount: counts.get(a.key) ?? 0 }));
}

/** Return a new accounts array with one account reassigned to `entity`
 *  (immutable — never mutates the input). The caller persists + re-consolidates. */
export function reassignEntity(accounts: Account[], key: string, entity: string): Account[] {
  return accounts.map((a) => (a.key === key ? { ...a, entity } : a));
}

export type MonthlyTotal = { month: string; in: number; out: number };

/** Per-calendar-month inflow/outflow totals, sorted ascending by month
 *  (YYYY-MM). Drives the Overzicht bar chart. */
export function monthlyTotals(txs: Tx[]): MonthlyTotal[] {
  const byMonth = new Map<string, { in: number; out: number }>();
  for (const t of txs) {
    const m = t.date.slice(0, 7);
    const b = byMonth.get(m) ?? { in: 0, out: 0 };
    if (t.amount >= 0) b.in += t.amount; else b.out += t.amount;
    byMonth.set(m, b);
  }
  return [...byMonth.entries()]
    .map(([month, b]) => ({ month, in: b.in, out: b.out }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** Identifiers of the user's own accounts, used to flag transfers between them
 *  as "Eigen overboeking". `all` is the set of normalized, space-stripped IBANs
 *  and account numbers; `byKey` maps each account.key to its own identifiers so
 *  categorize can skip a transaction's OWN account (e.g. a bank-fee row that
 *  cites its own IBAN in the description). */
export type OwnAccounts = { all: string[]; byKey: Map<string, string[]> };

/** Build OwnAccounts from the full accounts list. Only values that contain a
 *  digit and are >= 8 chars qualify as identifiers — this deliberately excludes
 *  generic keys like "Betaalrekening"/"Current" that would substring-match
 *  unrelated descriptions and cause false "Eigen overboeking" hits. Pass the
 *  FULL list (not an entity-scoped subset) so a BV1->BV2 move still counts. */
export function ownAccounts(accounts: Account[]): OwnAccounts {
  const byKey = new Map<string, string[]>();
  const all = new Set<string>();
  for (const a of accounts) {
    const ids = [a.iban, a.key]
      .map((v) => norm(v).replace(/\s+/g, ""))
      .filter((s) => s.length >= 8 && /\d/.test(s));
    byKey.set(a.key, ids);
    for (const id of ids) all.add(id);
  }
  return { all: [...all], byKey };
}

/** Category for a tx, in precedence order: a non-empty tx.category (manual
 *  override) wins; else — when `own` is supplied — an "Eigen overboeking" if the
 *  counterparty/description names another of the user's own accounts; else the
 *  first user rule whose match text is a substring of counterparty+description
 *  (case/space-insensitive); else the first built-in Dutch default
 *  (NL_CATEGORY_RULES) that matches; else "onbekend". So internal transfers are
 *  separated out and the defaults categorize the rest out of the box, while a
 *  user's own rule or manual label always takes precedence over the defaults. */
export function categorize(tx: Tx, rules: Rule[], own?: OwnAccounts): string {
  if (tx.category) return tx.category;
  const hay = norm(tx.counterparty + " " + tx.description);
  if (own && own.all.length) {
    // Compare against a space-stripped haystack so an IBAN printed with spaces
    // ("NL95 INGB 0674 ...") still matches the compact stored identifier.
    const hayCompact = hay.replace(/\s+/g, "");
    const skip = own.byKey.get(tx.accountKey);
    for (const id of own.all) {
      if (skip && skip.includes(id)) continue; // don't match the tx's own account
      if (hayCompact.includes(id)) return "Eigen overboeking";
    }
  }
  for (const r of rules) {
    // Guard on the NORMALIZED match: a whitespace-only match norms to "" and
    // would otherwise substring-match every tx, mislabeling the whole dataset.
    const m = norm(r.match);
    if (m && hay.includes(m)) return r.category;
  }
  for (const r of NL_CATEGORY_RULES_NORMALIZED) {
    if (hay.includes(r.m)) return r.category;
  }
  return "onbekend";
}

/** In/out totals grouped by derived category (via categorize). Pass `own` to
 *  split out "Eigen overboeking" (transfers between the user's own accounts). */
export function categoryTotals(txs: Tx[], rules: Rule[], own?: OwnAccounts): Record<string, { in: number; out: number }> {
  const out: Record<string, { in: number; out: number }> = {};
  for (const t of txs) {
    const c = categorize(t, rules, own);
    const b = (out[c] ??= { in: 0, out: 0 });
    if (t.amount >= 0) b.in += t.amount; else b.out += t.amount;
  }
  return out;
}

export type CategoryComparisonRow = {
  category: string;
  out: number; // current-month spend, positive euros
  sharePct: number; // % of the current month's total spend
  prevOut: number; // previous-month spend, positive euros
  changePct: number | null; // vs previous month; null when there was no prior spend
};
export type CategoryComparison = { month: string; prevMonth: string; rows: CategoryComparisonRow[] };

const TRANSFER_CATEGORY = "Eigen overboeking";
const monthOf = (date: string): string => date.slice(0, 7); // "YYYY-MM"

/** Internal category comparison for the LATEST month present in the data vs the
 *  month before it: each expense category's share of that month's spend and its
 *  change vs the prior month. Own transfers ("Eigen overboeking") are excluded
 *  (not spending). Deterministic — the "current" month is derived from the
 *  newest tx date, so it also works on historical/imported statements. Only
 *  categories with spend in the current month are returned, biggest first. */
export function categoryComparison(txs: Tx[], rules: Rule[], own?: OwnAccounts): CategoryComparison {
  const dates = txs.map((t) => t.date).filter(Boolean);
  if (dates.length === 0) return { month: "", prevMonth: "", rows: [] };
  const month = monthOf(dates.reduce((a, b) => (a > b ? a : b)));
  const [y, m] = month.split("-").map(Number);
  const pd = new Date(Date.UTC(y, m - 2, 1)); // m is 1-based; m-2 = prev month (0-based)
  const prevMonth = `${pd.getUTCFullYear()}-${String(pd.getUTCMonth() + 1).padStart(2, "0")}`;

  const cur: Record<string, number> = {};
  const prev: Record<string, number> = {};
  for (const t of txs) {
    if (t.amount >= 0) continue; // spend only
    const c = categorize(t, rules, own);
    if (c === TRANSFER_CATEGORY) continue;
    const mo = monthOf(t.date);
    const spend = -t.amount; // positive euros
    if (mo === month) cur[c] = (cur[c] ?? 0) + spend;
    else if (mo === prevMonth) prev[c] = (prev[c] ?? 0) + spend;
  }
  const totalCur = Object.values(cur).reduce((s, v) => s + v, 0);
  const rows: CategoryComparisonRow[] = Object.keys(cur)
    .map((category) => {
      const out = cur[category];
      const prevOut = prev[category] ?? 0;
      return {
        category,
        out,
        sharePct: totalCur > 0 ? (out / totalCur) * 100 : 0,
        prevOut,
        changePct: prevOut > 0 ? ((out - prevOut) / prevOut) * 100 : null,
      };
    })
    .sort((a, b) => b.out - a.out);
  return { month, prevMonth, rows };
}

/** Merge freshly-imported accounts with the existing ones, preserving the user's
 *  manual edits on accounts they already have: their entity, their type (soort),
 *  and — for imports carrying no balance (CSV) — their manually-set saldo. A
 *  fresh statement balance (MT940/ABN, non-null) still wins. New accounts pass
 *  through unchanged. Returns only the imported accounts (the caller upserts
 *  them; untouched existing accounts stay put). */
export function mergeImportedAccounts(existing: Account[], imported: Account[]): Account[] {
  const byKey = new Map(existing.map((a) => [a.key, a]));
  return imported.map((imp) => {
    const prev = byKey.get(imp.key);
    if (!prev) return imp;
    return {
      ...imp,
      entity: prev.entity,
      type: prev.type,
      balance: imp.balance !== null ? imp.balance : prev.balance,
      balanceDate: imp.balance !== null ? imp.balanceDate : prev.balanceDate,
    };
  });
}
