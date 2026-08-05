/* buildTabContext turns already-loaded app state into the minimal per-tab
 * slice sent to the chat agent (POST /api/agent/chat). This is the ONLY
 * place app state becomes chat context — the client-side counterpart to the
 * server's sanitizeChatContext allowlist. It must never forward raw
 * transactions or other line-level data; only pre-computed aggregates leave
 * the browser for a tab's system prompt. */

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
 *  whatever is in scope for the active view. Later tabs (Task 7) add more
 *  optional fields here as their `buildTabContext` cases are implemented. */
export type TabState = {
  accounts?: TabAccount[];
  txs?: unknown[];
  categories?: unknown;
  alertCount?: number;
  shortfall?: unknown;
  bufferCents?: number;
  rules?: unknown;
  invoices?: unknown[];
  rewards?: unknown;
  subscriptions?: unknown;
  rates?: unknown;
  bestBenchmark?: unknown;
  fxRate?: unknown;
  vatSettings?: unknown;
  scheduledFlows?: unknown;
  summary?: unknown;
};

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

export function buildTabContext(view: string, state: TabState): { tab: string; context: Record<string, unknown> } {
  switch (view) {
    case "overview": {
      const context: Record<string, unknown> = {
        entities: entityBalances(state.accounts ?? []),
        categories: state.categories ?? [],
        alertCount: state.alertCount ?? 0,
        shortfall: state.shortfall ?? false,
        bufferCents: state.bufferCents ?? 0,
      };
      return { tab: view, context };
    }
    default:
      return { tab: view, context: {} };
  }
}
