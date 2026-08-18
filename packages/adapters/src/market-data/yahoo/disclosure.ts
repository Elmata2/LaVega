export const YAHOO_FINANCE_DISCLOSURE = "Yahoo Finance is unofficial. Its endpoints can stop working or rate-limit you without notice. Yahoo's terms restrict automated access and commercial reuse. LaVega uses Yahoo only for local or self-hosted personal use; hosted services must use another provider.";
const KEY = "lavega.yahoo-finance-disclosure.v1";

export function hasSeenYahooFinanceDisclosure(storage: Storage | undefined = typeof localStorage === "undefined" ? undefined : localStorage): boolean {
  try { return storage?.getItem(KEY) === "seen"; } catch { return false; }
}

export function markYahooFinanceDisclosureSeen(storage: Storage | undefined = typeof localStorage === "undefined" ? undefined : localStorage): void {
  try { storage?.setItem(KEY, "seen"); } catch { /* unavailable storage is non-fatal */ }
}
