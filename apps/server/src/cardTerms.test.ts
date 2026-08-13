import { expect, test, beforeEach } from "vitest";
import { getCardTerms, resetCardTerms } from "./cardTerms.js";
import type { TravelInput } from "./agent/travel.js";

const input = (providers: string[]): TravelInput =>
  ({ homeCountry: "NL", destination: "US", currency: "USD", providers, knownFacts: [] });

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetCardTerms());

test("an unknown provider answers instantly as pending, never blocking on the model", async () => {
  let resolveLookup: (v: never[]) => void = () => {};
  const lookup = () => new Promise<never[]>((res) => { resolveLookup = res; }); // never settles on its own

  const res = getCardTerms(input(["Revolut"]), "k", { lookup: lookup as never });
  // The call returned even though the "model" is still running — that is the point.
  expect(res).toEqual({ terms: [], pending: ["Revolut"] });
  resolveLookup([]);
});

test("a completed background lookup is served instantly on the next call", async () => {
  const lookup = async () => [{ provider: "Revolut", fxFeePct: 0, cashbackPct: 1 }];
  expect(getCardTerms(input(["Revolut"]), "k", { lookup: lookup as never }).pending).toEqual(["Revolut"]);
  await settle();

  const second = getCardTerms(input(["Revolut"]), "k", { lookup: lookup as never });
  expect(second.pending).toEqual([]);
  expect(second.terms).toEqual([{ provider: "Revolut", fxFeePct: 0, cashbackPct: 1 }]);
});

test("only the gaps are looked up; what is cached comes back with them", async () => {
  const asked: string[][] = [];
  const lookup = async (i: TravelInput) => {
    asked.push(i.providers);
    return [{ provider: i.providers[0], fxFeePct: 1 }];
  };
  getCardTerms(input(["ING"]), "k", { lookup: lookup as never });
  await settle();

  const res = getCardTerms(input(["ING", "Revolut"]), "k", { lookup: lookup as never });
  expect(res.terms.map((t) => t.provider)).toEqual(["ING"]); // cached
  expect(res.pending).toEqual(["Revolut"]); // only the gap
  await settle();
  expect(asked).toEqual([["ING"], ["Revolut"]]); // ING was not looked up twice
});

test("concurrent asks for the same provider trigger ONE lookup", async () => {
  let calls = 0;
  const lookup = async () => { calls++; return [{ provider: "Revolut", fxFeePct: 0 }]; };
  getCardTerms(input(["Revolut"]), "k", { lookup: lookup as never });
  getCardTerms(input(["Revolut"]), "k", { lookup: lookup as never });
  getCardTerms(input(["Revolut"]), "k", { lookup: lookup as never });
  await settle();
  expect(calls).toBe(1);
});

test("a failing lookup leaves the provider unknown instead of poisoning the cache", async () => {
  const failing = async () => { throw new Error("geen resultaten"); };
  getCardTerms(input(["Revolut"]), "k", { lookup: failing as never });
  await settle();
  // Still unknown, and askable again — the UI says "voorwaarden nog onbekend".
  expect(getCardTerms(input(["Revolut"]), "k", { lookup: failing as never }).pending).toEqual(["Revolut"]);
});

test("the same brand is cached separately per market", async () => {
  const lookup = async (i: TravelInput) => [{ provider: i.providers[0], fxFeePct: i.currency === "USD" ? 1 : 2 }];
  getCardTerms(input(["ING"]), "k", { lookup: lookup as never });
  await settle();
  // Same provider, different destination currency -> not a cache hit.
  const gbp = getCardTerms({ ...input(["ING"]), currency: "GBP" }, "k", { lookup: lookup as never });
  expect(gbp.pending).toEqual(["ING"]);
});

test("an EXPIRED entry is still served while it refreshes — never a blank", async () => {
  let value = 1;
  const lookup = async () => [{ provider: "Revolut", fxFeePct: value }];
  getCardTerms(input(["Revolut"]), "k", { lookup: lookup as never });
  await settle();

  // Age the entry past its TTL.
  const eightDays = 8 * 24 * 60 * 60 * 1000;
  const realNow = Date.now;
  Date.now = () => realNow() + eightDays;
  try {
    value = 2; // the refresh will find a new figure
    const stale = getCardTerms(input(["Revolut"]), "k", { lookup: lookup as never });
    // The week-old tariff is handed over NOW rather than reverting to unknown.
    expect(stale.terms).toEqual([{ provider: "Revolut", fxFeePct: 1 }]);
    expect(stale.pending).toEqual([]);
    await settle();
    // ...and the background refresh has replaced it for the next caller.
    expect(getCardTerms(input(["Revolut"]), "k", { lookup: lookup as never }).terms).toEqual([
      { provider: "Revolut", fxFeePct: 2 },
    ]);
  } finally {
    Date.now = realNow;
  }
});
