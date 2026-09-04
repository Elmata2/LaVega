import { expect, test } from "vitest";
import { makeRewardsBalance } from "@lavega/core";
import { upsertBalance } from "./views/Punten.js";

test("upsertBalance replaces the same-program row and appends a new one", () => {
  const a = makeRewardsBalance({
    program: "American Express Membership Rewards",
    points: 100,
    updatedAt: "2026-01-01",
  });
  const a2 = makeRewardsBalance({
    program: "American Express Membership Rewards",
    points: 5000,
    updatedAt: "2026-07-01",
  });
  const b = makeRewardsBalance({
    program: "Flying Blue (KLM/Air France)",
    points: 200,
    updatedAt: "2026-07-01",
  });
  let list = upsertBalance([], a);
  expect(list).toHaveLength(1);
  list = upsertBalance(list, a2); // same id -> replace
  expect(list).toHaveLength(1);
  expect(list[0].points).toBe(5000);
  list = upsertBalance(list, b); // new program -> append
  expect(list).toHaveLength(2);
});
