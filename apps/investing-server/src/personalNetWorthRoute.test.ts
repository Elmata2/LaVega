import { expect, test } from "vitest";
import { createApp } from "./app.js";
import { createInMemoryPersonalNetWorthStore } from "./personalNetWorthStore.js";

test("an owner who has never shared a total reads an empty list", async () => {
  const app = createApp({ resolveTenantId: () => "user-a" });
  const response = await app.request("/api/investing/personal-net-worth");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ totals: [] });
});

test("the route reads under the caller's own tenant, not another one's", async () => {
  const personalNetWorthStore = createInMemoryPersonalNetWorthStore({
    "user-a": [{ date: "2026-01-02", totalCents: 150_000 }],
    "user-b": [{ date: "2026-01-03", totalCents: 999 }],
  });
  const app = createApp({ personalNetWorthStore, resolveTenantId: () => "user-a" });

  const response = await app.request("/api/investing/personal-net-worth");

  expect(await response.json()).toEqual({
    totals: [{ date: "2026-01-02", totalCents: 150_000 }],
  });
});
