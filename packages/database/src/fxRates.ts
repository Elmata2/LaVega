import type { Database } from "./connection.js";

export type FxRateRow = {
  base: string;
  date: string;
  rates: Record<string, number>;
};

export type FxRateRepository = {
  /** Oldest first, starting at the last published date on or before `from`. */
  range(base: string, from: string, to: string): Promise<FxRateRow[]>;
  put(rows: readonly FxRateRow[]): Promise<void>;
};

/** Published exchange rates. They belong to no user, so no tenant is set. */
export function createFxRateRepository(db: Database): FxRateRepository {
  return {
    async range(base, from, to) {
      const result = await db.http.query(
        `SELECT base, to_char(date, 'YYYY-MM-DD') AS date, rates FROM investing.fx_rates
         WHERE base = $1 AND date <= $3::date
           AND date >= COALESCE(
             (SELECT max(date) FROM investing.fx_rates WHERE base = $1 AND date <= $2::date),
             $2::date)
         ORDER BY date`,
        [base, from, to],
      );
      return result.rows as FxRateRow[];
    },
    async put(rows) {
      if (rows.length === 0) return;
      await db.http.query(
        `INSERT INTO investing.fx_rates (base, date, rates)
         SELECT row->>'base', (row->>'date')::date, row->'rates'
         FROM jsonb_array_elements($1::jsonb) AS row
         ON CONFLICT (base, date) DO UPDATE SET rates = EXCLUDED.rates`,
        [JSON.stringify(rows)],
      );
    },
  };
}
