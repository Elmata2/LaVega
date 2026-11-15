/** The owner's per-account switch for sector inference (#135), tenant-scoped
 *  and off by default. A set TYPESAFE_API_KEY alone must never turn this on —
 *  inference sends a symbol and its description to an external model, so the
 *  decision to send that belongs to the account it's about, not the server's
 *  configuration. */
export type SectorInferenceSettingStore = {
  get(tenantId: string): Promise<boolean>;
  set(tenantId: string, enabled: boolean): Promise<void>;
};

export function createInMemorySectorInferenceSettingStore(): SectorInferenceSettingStore {
  const settings = new Map<string, boolean>();
  return {
    async get(tenantId) {
      return settings.get(tenantId) ?? false;
    },
    async set(tenantId, enabled) {
      settings.set(tenantId, enabled);
    },
  };
}
