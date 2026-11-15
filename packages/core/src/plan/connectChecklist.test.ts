import { expect, test } from "vitest";
import { connectChecklist } from "./connectChecklist.js";

const none = { statedBanks: [], impliedBanks: [], accounts: [] };

test("ING card implies ING", () => {
  expect(connectChecklist({ ...none, impliedBanks: ["ing"] })).toEqual([
    { brand: "ing", connected: false },
  ]);
});

test("a stated and an implied brand are listed once, in stable order", () => {
  const r = connectChecklist({ ...none, statedBanks: ["abn", "ing"], impliedBanks: ["ing", "amex"] });
  expect(r.map((x) => x.brand)).toEqual(["abn", "ing", "amex"]);
});

test("a linked account with a matching bank is connected", () => {
  const r = connectChecklist({
    ...none,
    statedBanks: ["ing", "abn"],
    accounts: [{ bank: "ING Bank", linkedAt: "2026-10-01T00:00:00Z" }],
  });
  expect(r).toEqual([
    { brand: "ing", connected: true },
    { brand: "abn", connected: false },
  ]);
});

test("CSV account without linkedAt is not connected", () => {
  const r = connectChecklist({ ...none, statedBanks: ["ing"], accounts: [{ bank: "ING" }] });
  expect(r).toEqual([{ brand: "ing", connected: false }]);
});

test("ING does not match 'Leasing'", () => {
  const r = connectChecklist({
    ...none,
    statedBanks: ["ing"],
    accounts: [{ bank: "Leasing Co", linkedAt: "2026-10-01T00:00:00Z" }],
  });
  expect(r[0]!.connected).toBe(false);
});

test("other is never listed", () => {
  expect(connectChecklist({ ...none, statedBanks: ["other"], impliedBanks: ["other-brand"] })).toEqual([]);
});

test("aliases match multi-word names", () => {
  const r = connectChecklist({
    ...none,
    statedBanks: ["amex", "abn"],
    accounts: [
      { bank: "American Express", linkedAt: "x" },
      { bank: "ABN AMRO Bank N.V.", linkedAt: "x" },
    ],
  });
  expect(r.every((x) => x.connected)).toBe(true);
});

test("brands with no bank-link path are never listed", () => {
  const r = connectChecklist({ ...none, statedBanks: ["crypto", "nexo", "ing"], impliedBanks: ["crypto"] });
  expect(r.map((x) => x.brand)).toEqual(["ing"]);
});

const linked = (bank: string) => [{ bank, linkedAt: "x" }];
const hit = (brand: string, bank: string) =>
  connectChecklist({ ...none, statedBanks: [brand], accounts: linked(bank) })[0]!.connected;

test("whole words only: Physics is not ics, Basnet is not asn", () => {
  expect(hit("ics", "Physics")).toBe(false);
  expect(hit("sns-asn-regio", "Basnet")).toBe(false);
  expect(hit("ics", "ICS")).toBe(true);
});

test("bare ABN does not match abn (documented false negative)", () => {
  expect(hit("abn", "ABN")).toBe(false);
});

test("ABN-AMRO and ABN AMRO both match", () => {
  expect(hit("abn", "ABN-AMRO Bank")).toBe(true);
  expect(hit("abn", "ABN AMRO Bank")).toBe(true);
});
