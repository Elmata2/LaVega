import type { Provider } from "../providerRouter.js";
import type { IdentifierProviderResult, IdentifierRequest } from "../lanes.js";
import {
  createMemoryPartnerBudgetClient,
  isPartnerBudgetStop,
  type PartnerBudgetClient,
} from "../../partnerBudget/PartnerBudget.js";
import { partnerKey } from "../../partnerBudget/limits.js";
type OpenFigiClient = { postJson(url: string, body: unknown): Promise<unknown> };

/* The unauthenticated OpenFIGI budget is 25 requests/min, shared by every user
 * of the deployment. The spacing lives in the PartnerBudget limit table
 * (`openfigi:mapping`), so it holds across invocations and instances. */
const MAX_ATTEMPTS = 5;
/** A Retry-After longer than this is not worth holding the key for. */
const MAX_RETRY_AFTER_MS = 120_000;
const OPENFIGI_KEY = partnerKey("openfigi:mapping");

/** Retry-After is seconds or an HTTP date. Returns the wait in ms, or undefined. */
function retryAfterMsOf(header: string | null, nowMs: number): number | undefined {
  const raw = header?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1_000 : undefined;
  const at = Date.parse(raw);
  return Number.isFinite(at) && at > nowMs ? at - nowMs : undefined;
}

export function createOpenFigiIdentifierProvider(
  input: {
    client?: OpenFigiClient;
    now?: () => number;
    /** Where request slots come from. Defaults to a budget of this provider's own. */
    partnerBudget?: PartnerBudgetClient;
  } = {},
): Provider<IdentifierRequest, IdentifierProviderResult> {
  const cache = new Map<string, IdentifierProviderResult>();
  const postJson =
    input.client?.postJson ??
    (async (url: string, body: unknown) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const error = new Error(`OpenFIGI HTTP ${response.status}`) as Error & {
          status?: number;
          retryAfterMs?: number;
        };
        error.status = response.status;
        const retryAfterMs = retryAfterMsOf(response.headers.get("retry-after"), Date.now());
        if (retryAfterMs !== undefined) error.retryAfterMs = retryAfterMs;
        throw error;
      }
      return response.json();
    });
  const now = input.now ?? Date.now;
  const budget = input.partnerBudget ?? createMemoryPartnerBudgetClient();

  const requestWithBudget = async (body: unknown, deadlineMs?: number): Promise<unknown> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      // A slot after the deadline, or a failure of the budget itself, is not
      // retried: no request goes out and the lookup ends unresolved and uncached.
      await budget.awaitSlot(OPENFIGI_KEY, deadlineMs);
      try {
        return await postJson("https://api.openfigi.com/v3/mapping", body);
      } catch (error) {
        lastError = error;
        const status = (error as { status?: number }).status;
        // Rate limit or transient provider issue: tell the budget when the key
        // may be used again; the next slot waits for it. Honor Retry-After when
        // present (capped), otherwise back off.
        if (status !== 429 && (status === undefined || status < 500)) break;
        const retryAfterMs = (error as { retryAfterMs?: number }).retryAfterMs;
        const holdMs =
          retryAfterMs !== undefined
            ? Math.min(retryAfterMs, MAX_RETRY_AFTER_MS)
            : Math.min(60_000, 5_000 * attempt);
        await budget.reject(OPENFIGI_KEY, now() + holdMs);
      }
    }
    throw lastError;
  };

  return {
    sourceKey: "openfigi",
    priority: 10,
    async get(request) {
      const isin = request.isin.trim().toUpperCase();
      const known = cache.get(isin);
      if (known) return known;
      try {
        const raw = await requestWithBudget(
          [{ idType: "ID_ISIN", idValue: isin }],
          request.deadlineMs,
        );
        const first = Array.isArray(raw) ? raw[0] : null;
        const data = first && typeof first === "object" ? (first as { data?: unknown }).data : null;
        const item =
          Array.isArray(data) && data[0] && typeof data[0] === "object"
            ? (data[0] as Record<string, unknown>)
            : null;
        if (!item || typeof item.ticker !== "string") throw new Error("ISIN not found");
        const result = {
          match: {
            isin,
            ticker: item.ticker,
            ...(typeof item.exchCode === "string" ? { exchange: item.exchCode } : {}),
            ...(typeof item.name === "string" ? { name: item.name } : {}),
          },
          problems: [],
        };
        cache.set(isin, result);
        return result;
      } catch (error) {
        // No slot, or no budget: nothing was asked, so "unresolved" would be a lie
        // that callers turn into a delisting. The caller pauses instead.
        if (isPartnerBudgetStop(error)) throw error;
        // Failures are not cached: a rate-limited ISIN must resolve on a later run.
        return {
          match: { isin, ticker: "" },
          problems: [
            `OpenFIGI identifier request failed: ${error instanceof Error ? error.message : String(error)}`,
          ],
        };
      }
    },
  };
}
