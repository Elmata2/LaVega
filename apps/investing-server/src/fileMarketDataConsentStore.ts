import { YAHOO_DISCLOSURE_VERSION, type MarketDataConsentDecision, type MarketDataConsentStore } from "./marketDataConsent.js";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

export function runtimeMarketDataConsentFile(): string {
  return runtimeDataFile("INVESTING_MARKET_DATA_CONSENT_FILE", "market-data-consent.json");
}

export function createFileMarketDataConsentStore(filePath = runtimeMarketDataConsentFile()): MarketDataConsentStore {
  const store = createJsonFileStore<MarketDataConsentDecision[]>(filePath, {
    empty: [],
    validate: (contents) => {
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) throw new Error("Invalid market-data consent store");
      return parsed.map((row) => {
        if (!row || typeof row !== "object") throw new Error("Invalid market-data consent row");
        const decision = row as Partial<MarketDataConsentDecision>;
        if (typeof decision.tenantId !== "string" || typeof decision.accepted !== "boolean" || (decision.decidedAt !== null && typeof decision.decidedAt !== "string") || typeof decision.disclosureVersion !== "string") throw new Error("Invalid market-data consent row");
        return decision as MarketDataConsentDecision;
      });
    },
  });
  return {
    async get(tenantId) {
      const decision = (await store.read()).find((row) => row.tenantId === tenantId);
      return !decision || decision.disclosureVersion !== YAHOO_DISCLOSURE_VERSION
        ? { tenantId, accepted: false, decidedAt: null, disclosureVersion: YAHOO_DISCLOSURE_VERSION }
        : decision;
    },
    async set(decision) {
      await store.update((rows) => [...rows.filter((row) => row.tenantId !== decision.tenantId), decision]);
    },
  };
}
