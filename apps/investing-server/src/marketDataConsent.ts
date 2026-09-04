export const YAHOO_DISCLOSURE_VERSION = "yahoo-finance-v1";

export type MarketDataConsentDecision = {
  tenantId: string;
  accepted: boolean;
  decidedAt: string | null;
  disclosureVersion: string;
};

export type MarketDataConsentStore = {
  get(tenantId: string): Promise<MarketDataConsentDecision>;
  set(decision: MarketDataConsentDecision): Promise<void>;
};

const emptyDecision = (tenantId: string): MarketDataConsentDecision => ({
  tenantId,
  accepted: false,
  decidedAt: null,
  disclosureVersion: YAHOO_DISCLOSURE_VERSION,
});

export function createInMemoryMarketDataConsentStore(): MarketDataConsentStore {
  const decisions = new Map<string, MarketDataConsentDecision>();
  return {
    async get(tenantId) {
      return structuredClone(decisions.get(tenantId) ?? emptyDecision(tenantId));
    },
    async set(decision) {
      decisions.set(decision.tenantId, structuredClone(decision));
    },
  };
}
