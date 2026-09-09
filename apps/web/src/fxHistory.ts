import type { Account, Tx } from "@lavega/core";
import { isEurCurrency } from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import { API_BASE } from "./api.js";

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
const todayIso = (): string => new Date().toISOString().slice(0, 10);
const normalizeCurrency = (c: string): string => (c || "EUR").trim().toUpperCase();

type FxHistoryResponse = { base: string; currency: string; rates: Record<string, number> };

async function fetchOne(currency: string, from: string): Promise<FxHistoryResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/fx/history?currency=${currency}&from=${from}`);
    if (!res.ok) return null;
    return (await res.json()) as FxHistoryResponse;
  } catch {
    return null; // transient network blip shouldn't block unlock — same silent-degrade as Valuta.tsx
  }
}

/** Fills the vault's ECB history for every non-EUR currency the ledger touches.
 *  A currency already cached only asks for the last few days (ECB publish-delay
 *  corrections); a new currency asks from its earliest transaction, or 30 days
 *  back for a balance-only pocket with no tx history yet. Same operation for
 *  the initial fetch and every unlock-time refresh — the vault state decides
 *  which one it turns out to be. */
export async function syncFxHistory(
  storage: VaultStorage,
  accounts: Account[],
  txs: Tx[],
): Promise<void> {
  const currencies = new Set<string>();
  for (const a of accounts)
    if (!isEurCurrency(a.currency)) currencies.add(normalizeCurrency(a.currency));
  for (const t of txs)
    if (!isEurCurrency(t.currency)) currencies.add(normalizeCurrency(t.currency));
  if (currencies.size === 0) return;

  const history = await storage.getFxHistory();

  const requests: Array<{ currency: string; from: string }> = [];
  for (const currency of currencies) {
    const cached = history[currency];
    const cachedDates = cached ? Object.keys(cached) : [];
    const txDates = txs
      .filter((t) => normalizeCurrency(t.currency) === currency)
      .map((t) => t.date);
    const earliestTxDate =
      txDates.length > 0 ? txDates.reduce((min, d) => (d < min ? d : min)) : undefined;

    let from: string | undefined;
    if (cachedDates.length === 0) {
      from = earliestTxDate ?? addDays(todayIso(), -30);
    } else {
      const refreshFrom = addDays(
        cachedDates.reduce((max, d) => (d > max ? d : max)),
        -5,
      );
      /* The server always returns the full cached range filtered to >= from,
       * so the earlier of a newly-imported older tx date and the refresh
       * target backfills the gap and refreshes recent days in one request. */
      from =
        earliestTxDate !== undefined && earliestTxDate < refreshFrom ? earliestTxDate : refreshFrom;
    }
    if (from) requests.push({ currency, from });
  }
  if (requests.length === 0) return;

  const results = await Promise.all(requests.map((r) => fetchOne(r.currency, r.from)));

  /* Keyed by the request's own normalized currency, not `result.currency` —
   * the vault format has to agree with rateOn's lookup regardless of what
   * case the server happens to echo back in its response body. */
  let changed = false;
  for (let i = 0; i < requests.length; i++) {
    const result = results[i];
    if (result == null) continue;
    const currency = requests[i]!.currency;
    history[currency] = { ...history[currency], ...result.rates };
    changed = true;
  }
  if (changed) await storage.putFxHistory(history);
}
