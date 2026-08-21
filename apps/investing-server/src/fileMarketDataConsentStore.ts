import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { YAHOO_DISCLOSURE_VERSION, type MarketDataConsentDecision, type MarketDataConsentStore } from "./marketDataConsent.js";

export function runtimeMarketDataConsentFile(): string {
  const configured = process.env.INVESTING_MARKET_DATA_CONSENT_FILE?.trim();
  if (configured) return configured;
  return existsSync("/data") ? "/data/market-data-consent.json" : join(process.cwd(), ".lavega", "market-data-consent.json");
}

export function createFileMarketDataConsentStore(filePath = runtimeMarketDataConsentFile()): MarketDataConsentStore {
  let writeQueue = Promise.resolve();
  const readRows = async (): Promise<MarketDataConsentDecision[]> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("Invalid market-data consent store");
      return parsed.map((row) => {
        if (!row || typeof row !== "object") throw new Error("Invalid market-data consent row");
        const decision = row as Partial<MarketDataConsentDecision>;
        if (typeof decision.tenantId !== "string" || typeof decision.accepted !== "boolean" || (decision.decidedAt !== null && typeof decision.decidedAt !== "string") || typeof decision.disclosureVersion !== "string") throw new Error("Invalid market-data consent row");
        return decision as MarketDataConsentDecision;
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  };
  return {
    async get(tenantId) {
      const decision = (await readRows()).find((row) => row.tenantId === tenantId);
      return !decision || decision.disclosureVersion !== YAHOO_DISCLOSURE_VERSION
        ? { tenantId, accepted: false, decidedAt: null, disclosureVersion: YAHOO_DISCLOSURE_VERSION }
        : decision;
    },
    async set(decision) {
      const operation = async () => {
        const rows = (await readRows()).filter((row) => row.tenantId !== decision.tenantId);
        rows.push(decision);
        await mkdir(dirname(filePath), { recursive: true });
        const temporary = `${filePath}.tmp`;
        await writeFile(temporary, JSON.stringify(rows), "utf8");
        await rename(temporary, filePath);
      };
      const result = writeQueue.then(operation);
      writeQueue = result.then(() => undefined, () => undefined);
      await result;
    },
  };
}
