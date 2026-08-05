/* buildTabContext turns already-loaded app state into the minimal per-tab
 * slice sent to the chat agent (POST /api/agent/chat). This is the ONLY
 * place app state becomes chat context — the client-side counterpart to the
 * server's sanitizeChatContext allowlist. It must never forward raw
 * transactions or other line-level data; only pre-computed aggregates leave
 * the browser for a tab's system prompt. */

import type { Account, FxRate, Invoice, RewardsBalance, Rule, ScheduledFlow, Tx, VatSettings } from "@lavega/core";
import { computeVatSetAside, detectSubscriptions, forecastCashflow, nextBtwDeadline, resolveAccountRate } from "@lavega/core";

/** Minimal per-account fields any tab's context builder might read. */
export type TabAccount = {
  entity?: string;
  balance?: number | null;
  bank?: string;
  type?: string;
  key?: string;
  currency?: string;
};

/** Loose bag of the app's already-loaded data. Optional throughout — each
 *  tab's case below reads only the fields it needs; App.tsx assembles
 *  whatever is in scope for the active view. */
export type TabState = {
  accounts?: TabAccount[];
  txs?: Tx[];
  categories?: unknown;
  alertCount?: number;
  shortfall?: unknown;
  bufferCents?: number;
  rules?: Rule[];
  invoices?: Invoice[];
  rewards?: RewardsBalance[];
  subscriptions?: unknown;
  rates?: unknown;
  /** Best public savings benchmark — a LIVE-fetched figure. Present only if
   *  App already holds it; otherwise omitted and the agent web-searches it. */
  bestBenchmark?: unknown;
  /** ECB FX rate — LIVE-fetched inside the Valuta view, not in App scope, so
   *  usually absent here; the agent web-searches it when omitted. */
  fxRate?: FxRate;
  vatSettings?: VatSettings[];
  scheduledFlows?: ScheduledFlow[];
  summary?: unknown;
  asOf?: string;
};

/** Cap for any array leaving the browser as context — keeps a tab's slice
 *  small and well under the server's MAX_CONTEXT_CHARS budget. */
const MAX_ITEMS = 100;

/** App uses English view ids for two tabs; the server allowlist (and Claude's
 *  per-tab prompt) key them in Dutch. Normalize here so the `tab` we return —
 *  and thus the `tab` the widget forwards to the server — matches the
 *  allowlist EXACTLY. All other views already share their name with the tab. */
const VIEW_TO_TAB: Record<string, string> = { accounts: "rekeningen", rules: "regels" };

/** Fallback VAT config for an entity with no saved settings — mirrors the
 *  Belasting view's own default so the chat estimate matches what's shown. */
function defaultVatSettings(entity: string): VatSettings {
  return { entity, frequency: "quarterly", defaultRatePct: 21, mixedRates: false };
}

/** Per-entity balance aggregate: sums known account balances per entity;
 *  null when any account in that entity has no saldo yet (mirrors
 *  Overzicht's own "unknown balance" rule — never invent a number). */
function entityBalances(accounts: TabAccount[]): { entity: string; balance: number | null }[] {
  const entities = Array.from(new Set(accounts.map((a) => a.entity).filter((e): e is string => !!e)));
  return entities.map((entity) => {
    const entityAccounts = accounts.filter((a) => a.entity === entity);
    const balance = entityAccounts.some((a) => a.balance == null)
      ? null
      : entityAccounts.reduce((s, a) => s + (a.balance as number), 0);
    return { entity, balance };
  });
}

/** Unique entities present in the scoped accounts, first-appearance order. */
function entitiesOf(accounts: TabAccount[]): string[] {
  return Array.from(new Set(accounts.map((a) => a.entity).filter((e): e is string => !!e)));
}

export function buildTabContext(view: string, state: TabState): { tab: string; context: Record<string, unknown> } {
  const tab = VIEW_TO_TAB[view] ?? view;
  // Common, already-scoped inputs the compute tabs share (App pre-filters
  // accounts/txs/flows by the active top-bar entity scope).
  const accounts = (state.accounts ?? []) as TabAccount[];
  const txs = state.txs ?? [];
  const asOf = state.asOf ?? new Date().toISOString().slice(0, 10);

  switch (tab) {
    case "overview": {
      const context: Record<string, unknown> = {
        entities: entityBalances(accounts),
        categories: state.categories ?? [],
        alertCount: state.alertCount ?? 0,
        shortfall: state.shortfall ?? false,
        bufferCents: state.bufferCents ?? 0,
      };
      return { tab, context };
    }

    case "rekeningen": {
      const context = {
        accounts: accounts.slice(0, MAX_ITEMS).map((a) => ({
          bank: a.bank,
          type: a.type,
          entity: a.entity,
          balance: a.balance ?? null,
        })),
      };
      return { tab, context };
    }

    case "regels": {
      const rules = (state.rules ?? []) as Rule[];
      const context = {
        rules: rules.slice(0, MAX_ITEMS).map((r) => ({ match: r.match, category: r.category })),
      };
      return { tab, context };
    }

    case "forecast": {
      // Consolidated 13-week forecast over the (already entity-scoped) data —
      // the same core helper the Forecast view uses, reduced to a compact,
      // tx-free summary. No raw transactions ever go in here.
      const fc = forecastCashflow(txs as Tx[], accounts as Account[], {
        asOf,
        horizonDays: 91,
        bufferCents: state.bufferCents ?? 0,
        scheduledFlows: state.scheduledFlows ?? [],
      });
      const f = fc.consolidated;
      const lastPoint = f.points.length > 0 ? f.points[f.points.length - 1] : null;
      const context = {
        summary: {
          asOf: f.asOf,
          horizonDays: f.horizonDays,
          openingCents: f.openingCents,
          medianEndCents: lastPoint ? lastPoint.projectedClosingCents : null,
          shortfall: f.shortfall, // { date, balanceCents } | null
          bufferCents: state.bufferCents ?? 0,
          drivers: f.drivers, // already capped at 8: { label, sign, perWeekCents }
        },
      };
      return { tab, context };
    }

    case "optimalisatie": {
      const subs = detectSubscriptions(txs as Tx[]);
      const context: Record<string, unknown> = {
        subscriptions: subs.slice(0, MAX_ITEMS).map((s) => ({
          name: s.name,
          function: s.function,
          monthlyCents: s.monthlyCents,
          lastAmountCents: s.lastAmountCents,
          changePct: s.changePct,
          lastDate: s.lastDate,
        })),
        // Per-account resolved rate (own accounts only; benchmark table isn't in
        // App scope, so savings accounts resolve to "unknown" and the agent
        // web-searches current rates).
        rates: (accounts as Account[]).slice(0, MAX_ITEMS).map((a) => {
          const { ratePct, source } = resolveAccountRate(a, txs as Tx[], asOf, []);
          return { bank: a.bank, type: a.type, entity: a.entity, balance: a.balance ?? null, ratePct, source };
        }),
      };
      // Live public benchmark: only if App already has it; else omitted so the
      // agent web-searches it (the design).
      if (state.bestBenchmark !== undefined) context.bestBenchmark = state.bestBenchmark;
      return { tab, context };
    }

    case "valuta": {
      const holdings = Array.from(
        new Set((accounts as TabAccount[]).map((a) => a.currency).filter((c): c is string => !!c && c !== "EUR")),
      );
      const context: Record<string, unknown> = { holdings };
      // ECB rate is live-fetched in the Valuta view, not in App scope — include
      // only if present; otherwise omit and let the agent web-search it.
      if (state.fxRate !== undefined) context.rate = state.fxRate;
      return { tab, context };
    }

    case "belasting": {
      const vatSettings = (state.vatSettings ?? []) as VatSettings[];
      const savedByEntity = new Map(vatSettings.map((s) => [s.entity, s]));
      const keyToEntity = new Map((accounts as Account[]).map((a) => [a.key, a.entity]));
      // Entities to report on: those with accounts, plus any that only have
      // saved VAT settings.
      const entities = Array.from(new Set([...entitiesOf(accounts), ...vatSettings.map((s) => s.entity)]));

      const vat = entities.map((entity) => {
        const settings = savedByEntity.get(entity) ?? defaultVatSettings(entity);
        const entityTxs = (txs as Tx[]).filter((t) => keyToEntity.get(t.accountKey) === entity);
        const setAside = computeVatSetAside(entityTxs, settings, asOf);
        return {
          entity,
          amountCents: setAside ? setAside.amountCents : 0,
          dueDate: setAside ? setAside.dueDate : null,
          label: setAside ? setAside.label : null,
        };
      });

      const deadlines = entities.map((entity) => {
        const settings = savedByEntity.get(entity) ?? defaultVatSettings(entity);
        const { periodLabel, deadline } = nextBtwDeadline(settings.frequency, asOf);
        return { entity, frequency: settings.frequency, periodLabel, deadline };
      });

      const context = {
        vat,
        deadlines,
        settings: vatSettings.map((s) => ({
          entity: s.entity,
          frequency: s.frequency,
          defaultRatePct: s.defaultRatePct,
          mixedRates: s.mixedRates,
          manualCents: s.manualCents,
        })),
      };
      return { tab, context };
    }

    case "facturen": {
      const invoices = (state.invoices ?? []) as Invoice[];
      const context = {
        invoices: invoices.slice(0, MAX_ITEMS).map((i) => ({
          counterparty: i.counterparty,
          direction: i.direction,
          amount: i.amount,
          issueDate: i.issueDate,
          dueDate: i.dueDate,
          status: i.status,
        })),
      };
      return { tab, context };
    }

    case "punten": {
      const rewards = (state.rewards ?? []) as RewardsBalance[];
      const context = {
        balances: rewards.slice(0, MAX_ITEMS).map((b) => ({
          program: b.program,
          points: b.points,
          updatedAt: b.updatedAt,
          note: b.note,
        })),
      };
      return { tab, context };
    }

    case "backup":
      return { tab, context: {} };

    default:
      return { tab, context: {} };
  }
}
