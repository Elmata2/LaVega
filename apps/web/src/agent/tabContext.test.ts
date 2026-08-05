import { expect, test } from "vitest";
import { buildTabContext } from "./tabContext.js";

test("overview context carries only aggregates, not raw txs", () => {
  const { tab, context } = buildTabContext("overview", {
    accounts: [{ entity: "BV1", balance: 100 } as any], txs: [{} as any], alertCount: 3, bufferCents: 5000,
    shortfall: false, categories: [{ name: "Boodschappen", out: 200 }],
  } as any);
  expect(tab).toBe("overview");
  expect((context as any).txs).toBeUndefined();
  expect((context as any).alertCount).toBe(3);
});

test("unknown tab yields empty context", () => {
  expect(buildTabContext("zzz", {} as any).context).toEqual({});
});
