import { DateTime } from "effect";
import {
  createMemoryPartnerBudgetClient,
  isPartnerBudgetUnavailable,
  isPartnerWait,
  PartnerWait,
  type PartnerBudgetClient,
} from "../../partnerBudget/PartnerBudget.js";
import { partnerKey } from "../../partnerBudget/limits.js";
import { cookieHeaderFromSetCookie } from "./setCookie.js";
import { retryAfterMsOf } from "../../http/retryAfter.js";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;
const RETRYABLE = /429|403|401|502|503|504|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i;
/** Yahoo answers these when it has slowed or blocked our egress IP. The key is
 *  shared by every user, so the budget must hold everyone back, not only this call.
 *  401 is a stale crumb/cookie rather than an IP block, so it retries locally. */
const REJECTED = /\[(?:429|403)\]|Failed to get crumb: (?:429|403)/;
/** A Retry-After longer than this is not worth holding the shared key for. */
const MAX_RETRY_AFTER_MS = 120_000;
/** Chart, search, quoteSummary and crumb requests are one budget: Yahoo counts our IP. */
const YAHOO_KEY = partnerKey("yahoo:any");
/** The crumb and cookie negotiation, shared by every caller, has this bound from
 *  its start whatever deadline the caller that started it has. */
const CREDENTIALS_BOUND_MS = 10_000;

export type YahooFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** A non-2xx answer. The message keeps the `[status] body` form callers match on. */
export class YahooHttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
    readonly retryAfterMs?: number,
  ) {
    super(`[${status}] ${body.slice(0, 200)}`);
    this.name = "YahooHttpError";
  }
}

export type YahooHttpOptions = {
  /** Where request slots come from. Defaults to a budget of this client's own. */
  partnerBudget?: PartnerBudgetClient;
  /** Absolute epoch ms. A slot after it fails the request with `PartnerWait`. */
  deadlineMs?: number;
};

/** An immutable crumb + cookie pair published atomically once `getcrumb` succeeds. */
type YahooCredentials = {
  readonly crumb: string;
  readonly cookie: string;
};

/** The crumb and cookie Yahoo hands out, shared by a client and its deadline views. */
type YahooSession = {
  credentials: YahooCredentials | null;
  crumbPromise: Promise<YahooCredentials> | null;
};

export class YahooHttpClient {
  private readonly session: YahooSession;
  private readonly budget: PartnerBudgetClient;
  private readonly deadlineMs: number | undefined;
  constructor(
    private readonly fetchFn: YahooFetch = fetch.bind(globalThis),
    private readonly timeoutMs = 20_000,
    private readonly retryBaseMs = RETRY_BASE_MS,
    options: YahooHttpOptions = {},
    session?: YahooSession,
  ) {
    this.session = session ?? { credentials: null, crumbPromise: null };
    this.budget = options.partnerBudget ?? createMemoryPartnerBudgetClient();
    this.deadlineMs = options.deadlineMs;
  }

  /** The same client, crumb and budget, but a slot after `deadlineMs` fails with
   *  `PartnerWait` instead of sleeping. One view per run keeps the deadline off
   *  shared state. */
  withDeadline(deadlineMs: number | undefined): YahooHttpClient {
    return new YahooHttpClient(
      this.fetchFn,
      this.timeoutMs,
      this.retryBaseMs,
      { partnerBudget: this.budget, deadlineMs },
      this.session,
    );
  }

  defaultHeaders(): Record<string, string> {
    return {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "application/json,text/plain,*/*",
      Referer: "https://finance.yahoo.com/",
    };
  }

  fetchJson<T>(url: string): Promise<T> {
    return this.withRetry(async () => this.request<T>(url));
  }
  fetchJsonWithCrumb<T>(url: string): Promise<T> {
    return this.withRetry(async () => {
      const credentials = await this.ensureCrumb();
      return this.request<T>(
        `${url}${url.includes("?") ? "&" : "?"}crumb=${encodeURIComponent(credentials.crumb)}`,
        { Cookie: credentials.cookie },
        credentials,
      );
    });
  }

  /** Every outbound request, the crumb and cookie ones included, takes a slot first. */
  private slot(): Promise<void> {
    return this.budget.awaitSlot(YAHOO_KEY, this.deadlineMs);
  }

  private async request<T>(
    url: string,
    extra: Record<string, string> = {},
    usedCredentials?: YahooCredentials,
  ): Promise<T> {
    await this.slot();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        headers: { ...this.defaultHeaders(), ...extra },
        signal: controller.signal,
      });
      if (
        response.status === 401 &&
        (usedCredentials === undefined || this.session.credentials === usedCredentials)
      ) {
        this.session.credentials = null;
      }
      if (!response.ok)
        throw new YahooHttpError(
          response.status,
          await response.text(),
          retryAfterMsOf(response.headers.get("retry-after"), Date.now()),
        );
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Every caller waits for the one shared negotiation, but only as long as its
   *  own deadline allows. The caller that starts it does not lend it its deadline:
   *  the negotiation has a bound of its own, so a short-deadline starter cannot
   *  fail it for the callers that joined. */
  private ensureCrumb(): Promise<YahooCredentials> {
    const session = this.session;
    if (session.credentials !== null) return Promise.resolve(session.credentials);
    session.crumbPromise ??= this.withDeadline(Date.now() + CREDENTIALS_BOUND_MS).negotiate();
    return this.untilOwnDeadline(session.crumbPromise);
  }

  /** The shared promise, or `PartnerWait` for this caller alone at its deadline.
   *  The negotiation goes on for the others. */
  private untilOwnDeadline<T>(shared: Promise<T>): Promise<T> {
    const deadlineMs = this.deadlineMs;
    if (deadlineMs === undefined) return shared;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new PartnerWait({ until: DateTime.makeUnsafe(deadlineMs) })),
        Math.max(0, deadlineMs - Date.now()),
      );
    });
    return Promise.race([shared, expired]).finally(() => clearTimeout(timer));
  }

  /** Runs on a view that carries the negotiation's own deadline. A failure is not
   *  cached: the `finally` clears the promise, so the next caller starts again.
   *  `{ crumb, cookie }` are published atomically only after `getcrumb` succeeds
   *  so a concurrent 401 cannot leave a half-populated session. */
  private negotiate(): Promise<YahooCredentials> {
    const session = this.session;
    const run = (async (): Promise<YahooCredentials> => {
      try {
        await this.slot();
        const cookieResponse = await this.fetchFn("https://fc.yahoo.com/", {
          headers: this.defaultHeaders(),
          redirect: "manual",
        });
        const cookie = cookieHeaderFromSetCookie(cookieResponse.headers);
        await this.slot();
        const crumbResponse = await this.fetchFn(
          "https://query2.finance.yahoo.com/v1/test/getcrumb",
          { headers: { ...this.defaultHeaders(), Cookie: cookie } },
        );
        if (!crumbResponse.ok) throw new Error(`Failed to get crumb: ${crumbResponse.status}`);
        const crumb = await crumbResponse.text();
        if (!crumb) throw new Error("Empty crumb response");
        const credentials: YahooCredentials = { crumb, cookie };
        session.credentials = credentials;
        return credentials;
      } finally {
        session.crumbPromise = null;
      }
    })();
    // Nobody may be awaiting it when every caller has given up: that is not an
    // unhandled rejection. Callers that do await still see the error.
    run.catch(() => undefined);
    return run;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let error: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (caught) {
        error = caught;
        // The budget saying wait, or being down, is not a Yahoo failure: no
        // request went out, so there is nothing to retry or back off from.
        if (isPartnerWait(caught) || isPartnerBudgetUnavailable(caught)) throw caught;
        if (attempt === MAX_RETRIES || !RETRYABLE.test(String(caught))) throw caught;
        const backoffMs = Math.min(30_000, this.retryBaseMs * 2 ** attempt);
        if (REJECTED.test(String(caught))) {
          // Yahoo is slowing or blocking our IP. Tell the shared budget, so every
          // user's next slot waits, instead of sleeping here alone.
          const retryAfterMs = caught instanceof YahooHttpError ? caught.retryAfterMs : undefined;
          const holdMs =
            retryAfterMs !== undefined ? Math.min(retryAfterMs, MAX_RETRY_AFTER_MS) : backoffMs;
          await this.budget.reject(YAHOO_KEY, Date.now() + holdMs);
        } else {
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }
    throw error;
  }
}
