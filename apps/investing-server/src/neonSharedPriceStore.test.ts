import { afterAll, beforeAll, beforeEach } from "vitest";
import { migratedTestDatabase } from "@lavega/database/testing";
import { registerSharedPriceStoreContract } from "@lavega/adapters/src/prices/sharedPriceStore.contract.js";
import { createNeonSharedPriceStore } from "./neonStores.js";

let context: Awaited<ReturnType<typeof migratedTestDatabase>>;

beforeAll(async () => {
  context = await migratedTestDatabase();
}, 120_000);

beforeEach(async () => {
  // The migration owner may truncate; the runtime role may not, by design.
  await context.pglite.exec(
    "RESET ROLE; TRUNCATE investing.instrument_price_bars, investing.instrument_price_coverage, investing.instrument_price_claims; SET ROLE lavega_runtime;",
  );
});

afterAll(async () => {
  await context.pglite.close();
});

registerSharedPriceStoreContract("Neon", () => createNeonSharedPriceStore(context.db));
