import { assignTxIds, type Account, type Tx } from "@lavega/core";
import {
  ebAccountKey,
  mapEbAccount,
  mapEbTransaction,
  pickEbBalance,
  pickEbBalanceDate,
  type EbAccount,
  type EbBalance,
  type EbTransaction,
} from "@lavega/adapters";
import { loadConfig, type EbConfig } from "../config.js";
import { eb } from "../eb-client.js";
import { consentExpiresAt, fetchSessionItems, type EbSession } from "../eb-routes.js";

/* The agent's own, UNATTENDED read of the bank. Banks allow only a few of
 * these a day, and a call counts as "user present" only when PSU headers are
 * sent, so nothing here ever sends one: the eb client attaches Authorization
 * and Content-Type and nothing else, and this module adds no header of its own.
 *
 * The result lives in memory only. Nothing here writes a transaction anywhere,
 * logs one, or lets a bank payload escape inside an error. */

export const UNATTENDED_DAYS = 90;

export type BankState = {
  bank: string;
  state: "ok" | "expired" | "refused";
  validUntil?: string;
};

export type FetchOutcome =
  | {
      status: "ok";
      txs: Tx[];
      accounts: Account[];
      balances: { accountKey: string; cents: number }[];
      /** Earliest consent expiry over the banks that answered, ISO; null if none did. */
      consentExpiresAt: string | null;
      banks: BankState[];
    }
  | { status: "no-bank" };

function isConsentRejection(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  return status === 401 || status === 403;
}

export async function fetchForAgent(
  userSessions: { sessionId: string; payload: EbSession; createdAt: string }[],
  now: number,
  deps: { eb?: typeof eb; config?: EbConfig } = {},
): Promise<FetchOutcome> {
  if (userSessions.length === 0) return { status: "no-bank" };

  const cfg = deps.config ?? loadConfig();
  const client = deps.eb ?? eb;
  const txs: Tx[] = [];
  const accounts: Account[] = [];
  const balances: { accountKey: string; cents: number }[] = [];
  const banks: BankState[] = [];
  let earliestOk = Infinity;

  for (const { payload, createdAt } of userSessions) {
    const expiry = consentExpiresAt(payload, createdAt);
    const validUntil = Number.isFinite(expiry) ? new Date(expiry).toISOString() : undefined;
    if (expiry <= now) {
      banks.push({ bank: payload.aspsp, state: "expired", ...(validUntil ? { validUntil } : {}) });
      continue;
    }
    try {
      const items = await fetchSessionItems(cfg, payload, UNATTENDED_DAYS, client);
      const sTxs: Tx[] = [];
      const sAccounts: Account[] = [];
      const sBalances: { accountKey: string; cents: number }[] = [];
      for (const item of items) {
        const raw = item.account as EbAccount;
        const balance = pickEbBalance(item.balances as EbBalance[]);
        const account = mapEbAccount(
          { ...raw, aspsp: payload.aspsp },
          balance,
          pickEbBalanceDate(item.balances as EbBalance[]),
        );
        sAccounts.push(account);
        if (balance !== null) {
          sBalances.push({ accountKey: account.key, cents: Math.round(balance * 100) });
        }
        const key = ebAccountKey(raw);
        sTxs.push(
          ...assignTxIds(
            (item.transactions as EbTransaction[]).map((t) =>
              mapEbTransaction(t, key, account.currency),
            ),
          ),
        );
      }
      txs.push(...sTxs);
      accounts.push(...sAccounts);
      balances.push(...sBalances);
      earliestOk = Math.min(earliestOk, expiry);
      banks.push({ bank: payload.aspsp, state: "ok", ...(validUntil ? { validUntil } : {}) });
    } catch (e) {
      // Typed state only: the bank's message may carry its payload.
      banks.push({
        bank: payload.aspsp,
        state: isConsentRejection(e) ? "expired" : "refused",
        ...(validUntil ? { validUntil } : {}),
      });
    }
  }
  return {
    status: "ok",
    txs,
    accounts,
    balances,
    consentExpiresAt: Number.isFinite(earliestOk) ? new Date(earliestOk).toISOString() : null,
    banks,
  };
}
