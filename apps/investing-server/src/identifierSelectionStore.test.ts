import { expect, test } from "vitest";
import {
  createInMemoryIdentifierOverrideStore,
  createInMemoryIdentifierSelectionSettingStore,
  MAX_IDENTIFIER_OVERRIDES,
  validateIdentifierOverrides,
} from "./identifierSelectionStore.js";

/* The owner's identifier override map (issue #136) is untrusted input: it is
 * normalized on write and read, so an unknown row is dropped rather than
 * rejected and a ticker is never silently invented. */

test("the switch is off by default and per tenant", async () => {
  const store = createInMemoryIdentifierSelectionSettingStore();
  expect(await store.get("alice")).toBe(false);
  await store.set("alice", true);
  expect(await store.get("alice")).toBe(true);
  expect(await store.get("bob")).toBe(false);
});

test("an override map normalizes ISIN and ticker and drops invalid rows", () => {
  expect(
    validateIdentifierOverrides({
      nl0010273215: { ticker: " asml ", exchange: "ams" },
      "not-an-isin": { ticker: "ASML" },
      NL0000000002: { ticker: "" },
      NL0000000003: "ASML",
    }),
  ).toEqual({ NL0010273215: { ticker: "ASML", exchange: "AMS" } });
  expect(validateIdentifierOverrides(null)).toEqual({});
  expect(validateIdentifierOverrides([{ NL0010273215: { ticker: "ASML" } }])).toEqual({});
});

test("an override map is capped so a runaway write cannot grow without bound", () => {
  const input: Record<string, { ticker: string }> = {};
  for (let index = 0; index < MAX_IDENTIFIER_OVERRIDES + 10; index += 1)
    input[`NL${String(index).padStart(9, "0")}0`] = { ticker: `T${index}` };
  expect(Object.keys(validateIdentifierOverrides(input)).length).toBe(MAX_IDENTIFIER_OVERRIDES);
});

test("the override store round-trips one tenant's map and keeps tenants apart", async () => {
  const store = createInMemoryIdentifierOverrideStore();
  await store.set("alice", { NL0010273215: { ticker: "ASML", exchange: "AMS" } });
  expect(await store.get("alice")).toEqual({
    NL0010273215: { ticker: "ASML", exchange: "AMS" },
  });
  expect(await store.get("bob")).toEqual({});
});
