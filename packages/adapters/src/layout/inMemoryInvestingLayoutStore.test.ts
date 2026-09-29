import { expect, test } from "vitest";
import { createInMemoryInvestingLayoutStore } from "./inMemoryInvestingLayoutStore.js";

test("round-trips a layout selection per tenant", async () => {
  const store = createInMemoryInvestingLayoutStore();
  await store.set({ tenantId: "a", modules: { positions: false }, widgets: { agent: false } });
  await expect(store.get("a")).resolves.toEqual({
    modules: { positions: false },
    widgets: { agent: false },
  });
  await expect(store.get("b")).resolves.toEqual({ modules: {}, widgets: {} });
});

test("set drops unknown ids on the way in, same as validateInvestingLayout", async () => {
  const store = createInMemoryInvestingLayoutStore();
  await store.set({
    tenantId: "a",
    modules: { positions: true, "removed-module": true } as never,
    widgets: {},
  });
  await expect(store.get("a")).resolves.toEqual({ modules: { positions: true }, widgets: {} });
});
