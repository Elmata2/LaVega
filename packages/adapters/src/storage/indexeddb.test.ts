// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { createIndexedDbStorage } from "./indexeddb.js";

test("round-trips txs", async () => {
  const s = createIndexedDbStorage();
  await s.putTxs([{ id:"1#0", accountKey:"A", date:"2026-01-02", amount:-5, currency:"EUR",
    counterparty:"x", description:"", category:"", manual:false }]);
  expect(await s.getTxs()).toHaveLength(1);
});
