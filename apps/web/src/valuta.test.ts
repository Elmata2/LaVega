import { expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { FX_ROUTES } from "@lavega/core";
import { ownedProviders } from "./views/Valuta.js";

const acct = (bank: string): Account => ({
  key: bank, iban: "", name: bank, bank, entity: "BV1", currency: "EUR", balance: 0,
});

test("ownedProviders matches a route to a bank the user holds (Revolut)", () => {
  const owned = ownedProviders([acct("Revolut"), acct("ING")], FX_ROUTES);
  expect([...owned].some((p) => p.toLowerCase().includes("revolut"))).toBe(true);
  // A provider the user does NOT have is not marked owned.
  expect([...owned].some((p) => p.toLowerCase().includes("wise"))).toBe(false);
});

test("ownedProviders is empty when no bank matches any route", () => {
  expect(ownedProviders([acct("Knab")], FX_ROUTES).size).toBe(0);
});
