import type { Provider } from "../providerRouter.js";
import type {
  IdentifierCandidate,
  IdentifierCandidateSelector,
  IdentifierMatch,
  IdentifierProviderResult,
  IdentifierRequest,
} from "../lanes.js";
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

/** One OpenFIGI mapping row, copied field by field. Nothing is reconstructed:
 *  a candidate either carries a string ticker or is not a candidate. */
function candidateOf(item: unknown): IdentifierCandidate | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const row = item as Record<string, unknown>;
  if (typeof row.ticker !== "string" || row.ticker.trim() === "") return null;
  return {
    ticker: row.ticker,
    ...(typeof row.exchCode === "string" && row.exchCode.trim() !== ""
      ? { exchange: row.exchCode }
      : {}),
    ...(typeof row.name === "string" && row.name.trim() !== "" ? { name: row.name } : {}),
    ...(typeof row.currency === "string" && row.currency.trim() !== ""
      ? { currency: row.currency }
      : {}),
  };
}

/** The candidate set from one mapping answer: every row with a ticker, in the
 *  provider's own order. The option set is this array and nothing else. */
export function identifierCandidatesOf(raw: unknown): IdentifierCandidate[] {
  const first = Array.isArray(raw) ? raw[0] : null;
  const data = first && typeof first === "object" ? (first as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const candidate = candidateOf(item);
    return candidate ? [candidate] : [];
  });
}

/** Copy the chosen candidate's fields verbatim into the match. */
function matchOf(isin: string, candidate: IdentifierCandidate): IdentifierMatch {
  return {
    isin,
    ticker: candidate.ticker,
    ...(candidate.exchange !== undefined ? { exchange: candidate.exchange } : {}),
    ...(candidate.name !== undefined ? { name: candidate.name } : {}),
    ...(candidate.currency !== undefined ? { currency: candidate.currency } : {}),
  };
}

const unresolved = (
  isin: string,
  problem: string,
  candidates: readonly IdentifierCandidate[] = [],
): IdentifierProviderResult => ({
  match: { isin, ticker: "" },
  problems: [problem],
  resolution: { tier: "unresolved", confidence: null, candidates },
});

/** The candidate a selection names, or null when it names none of them. This
 *  is the verbatim guarantee: the provider never accepts a ticker the answer
 *  did not come from. Exchange, when the selector names one, must also match. */
export function selectedCandidate(
  candidates: readonly IdentifierCandidate[],
  selection: { ticker: string; exchange?: string },
): IdentifierCandidate | null {
  return (
    candidates.find(
      (candidate) =>
        candidate.ticker === selection.ticker &&
        (selection.exchange === undefined || candidate.exchange === selection.exchange),
    ) ?? null
  );
}

export function createOpenFigiIdentifierProvider(
  input: {
    client?: OpenFigiClient;
    now?: () => number;
    /** Where request slots come from. Defaults to a budget of this provider's own. */
    partnerBudget?: PartnerBudgetClient;
    /** The optional decision seam (issue #136). Absent = today's behaviour. */
    selector?: IdentifierCandidateSelector;
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
  const selector = input.selector;

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

  /** Resolve an ambiguous candidate set through the injected selector. Returns
   *  null when the selector refused or failed: the caller keeps the unresolved
   *  outcome and caches nothing. */
  const selectCandidate = async (
    request: IdentifierRequest,
    isin: string,
    candidates: readonly IdentifierCandidate[],
  ): Promise<IdentifierProviderResult | null> => {
    if (!selector) return null;
    let selection;
    try {
      selection = await selector({
        isin,
        ...(request.instrument !== undefined ? { instrument: request.instrument } : {}),
        candidates,
      });
    } catch {
      // A selector failure is retryable and is never cached: the next run asks
      // the provider again and may get a decision.
      return null;
    }
    if (selection.kind === "no-match") return null;
    if (selection.kind === "failed") return null;
    const candidate = selectedCandidate(candidates, selection);
    // The verbatim guarantee: an answer naming a candidate the provider did not
    // return is refused, never normalised into one.
    if (!candidate) return null;
    return {
      match: matchOf(isin, candidate),
      problems: [],
      resolution: {
        tier: "model",
        confidence:
          Number.isFinite(selection.confidence) &&
          selection.confidence >= 0 &&
          selection.confidence <= 1
            ? selection.confidence
            : null,
        candidates,
      },
    };
  };

  return {
    sourceKey: "openfigi",
    priority: 10,
    async get(request) {
      const isin = request.isin.trim().toUpperCase();
      /* The owner's own choice is the most trusted tier and short-circuits both
       * the provider and any stored model selection. It is not cached: an
       * override can be changed or removed, and it is not a provider answer. */
      if (request.override && request.override.ticker.trim() !== "") {
        return {
          match: {
            isin,
            ticker: request.override.ticker,
            ...(request.override.exchange !== undefined
              ? { exchange: request.override.exchange }
              : {}),
          },
          problems: [],
          resolution: { tier: "owner-override", confidence: null, candidates: [] },
        };
      }
      const known = cache.get(isin);
      if (known) return known;
      try {
        const raw = await requestWithBudget(
          [{ idType: "ID_ISIN", idValue: isin }],
          request.deadlineMs,
        );
        const candidates = identifierCandidatesOf(raw);
        if (candidates.length === 0) throw new Error("ISIN not found");
        /* The common case costs nothing: one candidate is taken as-is. */
        if (candidates.length === 1) {
          const result: IdentifierProviderResult = {
            match: matchOf(isin, candidates[0]!),
            problems: [],
            resolution: { tier: "provider", confidence: null, candidates },
          };
          cache.set(isin, result);
          return result;
        }
        /* Ambiguity: select only when the caller allowed it. Without consent
         * or the enable setting the behaviour is exactly today's: the first
         * candidate, recorded with the full candidate set for audit. */
        const selected =
          request.allowModelSelection === true
            ? await selectCandidate(request, isin, candidates)
            : null;
        if (selected) {
          cache.set(isin, selected);
          return selected;
        }
        if (request.allowModelSelection === true) {
          // A refusal or selector failure leaves the identifier unresolved and
          // uncached; the existing unresolved shape and problem prefix stand.
          return unresolved(
            isin,
            "OpenFIGI identifier request failed: none of the candidates fits this holding",
            candidates,
          );
        }
        const result: IdentifierProviderResult = {
          match: matchOf(isin, candidates[0]!),
          problems: [],
          resolution: { tier: "provider", confidence: null, candidates },
        };
        cache.set(isin, result);
        return result;
      } catch (error) {
        // No slot, or no budget: nothing was asked, so "unresolved" would be a lie
        // that callers turn into a delisting. The caller pauses instead.
        if (isPartnerBudgetStop(error)) throw error;
        // Failures are not cached: a rate-limited ISIN must resolve on a later run.
        return unresolved(
          isin,
          `OpenFIGI identifier request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
