import type { QueryResultRow } from "@neondatabase/serverless";
import { requireUserId, withTenantStatement, type Database } from "./connection.js";

export type PreferencesRepository = {
  getBenchmarkSymbols(): Promise<string[]>;
  setBenchmarkSymbols(symbols: readonly string[]): Promise<void>;
  getMarketDataConsent(): Promise<unknown | null>;
  setMarketDataConsent(decision: unknown): Promise<void>;
  getLayout(): Promise<unknown | null>;
  setLayout(layout: unknown): Promise<void>;
  /** Account tax-treatment labels (plan §3 WS4.4, #296). */
  getAccountWrappers(): Promise<unknown | null>;
  setAccountWrappers(entries: unknown): Promise<void>;
  /** The owner's switch for identifier candidate selection (Jev-03, #136). */
  getIdentifierSelectionEnabled(): Promise<boolean>;
  setIdentifierSelectionEnabled(enabled: boolean): Promise<void>;
  /** The owner's symbol choice per ISIN, most trusted resolution tier (#136). */
  getIdentifierOverrides(): Promise<unknown | null>;
  setIdentifierOverrides(overrides: unknown): Promise<void>;
  getSectorCorrections(): Promise<Record<string, string>>;
  setSectorCorrection(symbol: string, sector: string): Promise<void>;
  clearSectorCorrection(symbol: string): Promise<void>;
  /** Owner-facing switch for sector inference (#135), default off — a
   *  per-account preference, not a server env flag, because inference sends
   *  an instrument's name and description to an external model. */
  getSectorInferenceEnabled(): Promise<boolean>;
  setSectorInferenceEnabled(enabled: boolean): Promise<void>;
  /** Owner-confirmed cash-flow vocabulary rules (issue #137). */
  getCashFlowRules(): Promise<unknown>;
  setCashFlowRules(rules: unknown): Promise<void>;
  /** Stored suggestions, separate from rules; no effect until confirmed. */
  getCashFlowSuggestions(): Promise<unknown>;
  setCashFlowSuggestions(suggestions: unknown): Promise<void>;
  /** Explicit owner switch for the suggestion step, default off. */
  getCashFlowSuggestionsEnabled(): Promise<boolean>;
  setCashFlowSuggestionsEnabled(enabled: boolean): Promise<void>;
};

/** Benchmarks, market-data consent, layout, sector corrections and the sector-inference switch
 *  share one row, so each write names its own column. */
export function createPreferencesRepository(
  db: Database,
  userId: string | undefined | null,
): PreferencesRepository {
  const tenantId = requireUserId(userId);
  const read = async <T>(column: string, fallback: T): Promise<T> =>
    withTenantStatement(db, tenantId, async (client) => {
      const result = await client.query<QueryResultRow>(
        `SELECT ${column} FROM investing.preferences`,
      );
      const value = result.rows[0]?.[column];
      return value == null ? fallback : (value as T);
    });
  const write = async (column: string, value: unknown) => {
    await withTenantStatement(db, tenantId, async (client) => {
      await client.query(
        `INSERT INTO investing.preferences (user_id, ${column}) VALUES (current_setting('app.user_id'), $1::jsonb) ON CONFLICT (user_id) DO UPDATE SET ${column} = EXCLUDED.${column}, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify(value)],
      );
    });
  };
  const writeBoolean = async (column: string, value: boolean) => {
    await withTenantStatement(db, tenantId, async (client) => {
      await client.query(
        `INSERT INTO investing.preferences (user_id, ${column}) VALUES (current_setting('app.user_id'), $1) ON CONFLICT (user_id) DO UPDATE SET ${column} = EXCLUDED.${column}, updated_at = CURRENT_TIMESTAMP`,
        [value],
      );
    });
  };
  const readCorrections = () => read<Record<string, string>>("sector_corrections", {});
  const writeCorrections = (value: Record<string, string>) => write("sector_corrections", value);
  return {
    getBenchmarkSymbols: () => read<string[]>("benchmark_symbols", []),
    setBenchmarkSymbols: (symbols) => write("benchmark_symbols", [...symbols]),
    getMarketDataConsent: () => read<unknown | null>("market_data_consent", null),
    setMarketDataConsent: (decision) => write("market_data_consent", decision),
    getLayout: () => read<unknown | null>("layout", null),
    setLayout: (layout) => write("layout", layout),
    getAccountWrappers: () => read<unknown | null>("account_wrappers", null),
    setAccountWrappers: (entries) => write("account_wrappers", entries),
    getIdentifierSelectionEnabled: () => read<boolean>("identifier_selection_enabled", false),
    setIdentifierSelectionEnabled: (enabled) =>
      writeBoolean("identifier_selection_enabled", enabled),
    getIdentifierOverrides: () => read<unknown | null>("identifier_overrides", null),
    setIdentifierOverrides: (overrides) => write("identifier_overrides", overrides),
    getSectorCorrections: readCorrections,
    async setSectorCorrection(symbol, sector) {
      const current = await readCorrections();
      await writeCorrections({ ...current, [symbol.toUpperCase()]: sector });
    },
    async clearSectorCorrection(symbol) {
      const current = await readCorrections();
      const { [symbol.toUpperCase()]: _removed, ...rest } = current;
      await writeCorrections(rest);
    },
    getSectorInferenceEnabled: () => read<boolean>("sector_inference_enabled", false),
    setSectorInferenceEnabled: (enabled) => writeBoolean("sector_inference_enabled", enabled),
    getCashFlowRules: () => read<unknown>("cash_flow_rules", []),
    setCashFlowRules: (rules) => write("cash_flow_rules", rules),
    getCashFlowSuggestions: () => read<unknown>("cash_flow_suggestions", []),
    setCashFlowSuggestions: (suggestions) => write("cash_flow_suggestions", suggestions),
    getCashFlowSuggestionsEnabled: () => read<boolean>("cash_flow_suggestions_enabled", false),
    setCashFlowSuggestionsEnabled: (enabled) =>
      writeBoolean("cash_flow_suggestions_enabled", enabled),
  };
}
