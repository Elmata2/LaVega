import { cookieHeaderFromSetCookie } from "./setCookie.js";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;
const RETRYABLE = /429|403|401|502|503|504|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i;

export type YahooFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class YahooHttpClient {
  private crumb: string | null = null;
  private cookie: string | null = null;
  private crumbPromise: Promise<void> | null = null;
  constructor(private readonly fetchFn: YahooFetch = fetch.bind(globalThis), private readonly timeoutMs = 20_000, private readonly retryBaseMs = RETRY_BASE_MS) {}

  defaultHeaders(): Record<string, string> {
    return { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", Accept: "application/json,text/plain,*/*", Referer: "https://finance.yahoo.com/" };
  }

  fetchJson<T>(url: string): Promise<T> { return this.withRetry(async () => this.request<T>(url)); }
  fetchJsonWithCrumb<T>(url: string): Promise<T> { return this.withRetry(async () => { await this.ensureCrumb(); return this.request<T>(`${url}${url.includes("?") ? "&" : "?"}crumb=${encodeURIComponent(this.crumb!)}`, { Cookie: this.cookie! }); }); }

  private async request<T>(url: string, extra: Record<string, string> = {}): Promise<T> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try { const response = await this.fetchFn(url, { headers: { ...this.defaultHeaders(), ...extra }, signal: controller.signal }); if (response.status === 401) { this.crumb = null; this.cookie = null; } if (!response.ok) throw new Error(`[${response.status}] ${(await response.text()).slice(0, 200)}`); return await response.json() as T; }
    finally { clearTimeout(timer); }
  }

  private async ensureCrumb(): Promise<void> {
    if (this.crumb && this.cookie) return;
    if (this.crumbPromise) return this.crumbPromise;
    this.crumbPromise = (async () => { try { const cookieResponse = await this.fetchFn("https://fc.yahoo.com/", { headers: this.defaultHeaders(), redirect: "manual" }); this.cookie = cookieHeaderFromSetCookie(cookieResponse.headers); const crumbResponse = await this.fetchFn("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { ...this.defaultHeaders(), Cookie: this.cookie } }); if (!crumbResponse.ok) throw new Error(`Failed to get crumb: ${crumbResponse.status}`); this.crumb = await crumbResponse.text(); if (!this.crumb) throw new Error("Empty crumb response"); } catch (error) { this.crumb = null; this.cookie = null; throw error; } finally { this.crumbPromise = null; } })();
    return this.crumbPromise;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> { let error: unknown; for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) { try { return await fn(); } catch (caught) { error = caught; if (attempt === MAX_RETRIES || !RETRYABLE.test(String(caught))) throw caught; await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, this.retryBaseMs * 2 ** attempt))); } } throw error; }
}
