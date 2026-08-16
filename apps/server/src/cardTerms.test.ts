import { expect, test, beforeEach } from "vitest";
import { getCardTerms, resetCardTerms, ingestCardTerms } from "./cardTerms.js";
import type { TravelInput } from "./agent/travel.js";
import type { BankNlTable } from "@lavega/core";

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

test("a note-only reply is NOT cached — a failed lookup must stay retryable", async () => {
  // What the live agent returns when web search hits its limit: a note, no numbers.
  const noteOnly = async () => [{ provider: "ING", note: "Kon actuele tarieven niet verifiëren." }];
  getCardTerms(input(["ING"]), "k", { lookup: noteOnly as never });
  await settle();

  // Still unknown, so the next ask tries again instead of serving the failure
  // back for a week.
  const again = getCardTerms(input(["ING"]), "k", { lookup: noteOnly as never });
  expect(again.terms).toEqual([]);
  expect(again.pending).toEqual(["ING"]);
});

test("a reply carrying any usable number IS cached", async () => {
  const withNumber = async () => [{ provider: "ING", cashbackPct: 0, note: "geen cashback" }];
  getCardTerms(input(["ING"]), "k", { lookup: withNumber as never });
  await settle();
  expect(getCardTerms(input(["ING"]), "k", { lookup: withNumber as never }).pending).toEqual([]);
});

/* --- Ingest from the n8n workflow (fetches the provider's own tariff page, so
 * there is no "couldn't find it" step to fail). --- */

test("ingested terms are served straight away, no lookup needed", async () => {
  const never = async () => { throw new Error("should not be called"); };
  const res = ingestCardTerms("NL", "USD", [{ provider: "Revolut betaalpas", fxFeePct: 0, note: "0% tot €1000/mnd" }]);
  expect(res).toEqual({ accepted: 1, rejected: [] });

  const out = getCardTerms(input(["Revolut betaalpas"]), "k", { lookup: never as never });
  expect(out.pending).toEqual([]);
  expect(out.terms[0]).toMatchObject({ provider: "Revolut betaalpas", fxFeePct: 0 });
});

test("a row with no usable number is rejected, exactly like a failed lookup", () => {
  const res = ingestCardTerms("NL", "USD", [
    { provider: "Revolut betaalpas", note: "kon niets vinden" },
    { provider: "", fxFeePct: 1 },
    { provider: "ING betaalpas", fxFeePct: 1.4 },
  ]);
  expect(res.accepted).toBe(1);
  expect(res.rejected).toEqual(["Revolut betaalpas"]);
});

test("ingest is scoped per market, like every other cached entry", async () => {
  const never = async () => { throw new Error("should not be called"); };
  ingestCardTerms("NL", "USD", [{ provider: "Revolut betaalpas", fxFeePct: 0 }]);
  const gbp = getCardTerms({ ...input(["Revolut betaalpas"]), currency: "GBP" }, "k", { lookup: never as never });
  expect(gbp.terms).toEqual([]); // different market -> not served
});

/* --- The bank.nl comparison table: ONE fetch covering seven Dutch banks and
 * both card kinds, including the ones whose own tariff pages refuse us. --- */

const TABLE: BankNlTable = {
  checkedAt: "2026-01-15",
  rows: [
    { bank: "ING", card: "betaalpas", fxFeePct: 1.4, checkedAt: "2026-01-15", note: "1,4% koersopslag. Bron: bank.nl-vergelijking." },
    { bank: "ING", card: "creditcard", fxFeePct: 2, checkedAt: "2026-01-15", note: "2,0% koersopslag. Bron: bank.nl-vergelijking." },
    { bank: "Triodos Bank", card: "betaalpas", fxFeePct: 1, checkedAt: "2026-01-15", note: "1,0% koersopslag. Bron: bank.nl-vergelijking." },
  ],
};
const comparison = () => Promise.resolve(TABLE);
const noLookup = async () => [];

test("a gap the comparison table covers is filled without any model call", async () => {
  const res = getCardTerms(input(["ING betaalpas"]), "k", { lookup: noLookup as never, comparison });
  expect(res.pending).toEqual(["ING betaalpas"]); // nothing known yet, so: ask again
  await settle();

  const second = getCardTerms(input(["ING betaalpas"]), "k", { lookup: noLookup as never, comparison });
  expect(second.pending).toEqual([]);
  expect(second.terms[0]).toMatchObject({ provider: "ING betaalpas", fxFeePct: 1.4 });
  expect(second.terms[0].note).toContain("bank.nl");
});

test("debit and credit get their own figure, never each other's", async () => {
  getCardTerms(input(["ING betaalpas", "ING creditcard"]), "k", { lookup: noLookup as never, comparison });
  await settle();
  const res = getCardTerms(input(["ING betaalpas", "ING creditcard"]), "k", { lookup: noLookup as never, comparison });
  expect(res.terms.map((t) => [t.provider, t.fxFeePct])).toEqual([
    ["ING betaalpas", 1.4],
    ["ING creditcard", 2],
  ]);
});

test("a card kind the table never priced stays unknown, not free", async () => {
  // Triodos is listed for a betaalpas only. An unknown fee is a risk, not a 0%.
  getCardTerms(input(["Triodos creditcard"]), "k", { lookup: noLookup as never, comparison });
  await settle();
  expect(getCardTerms(input(["Triodos creditcard"]), "k", { lookup: noLookup as never, comparison }).pending)
    .toEqual(["Triodos creditcard"]);
});

test("a bank the table says nothing about stays unknown", async () => {
  getCardTerms(input(["Revolut betaalpas"]), "k", { lookup: noLookup as never, comparison });
  await settle();
  expect(getCardTerms(input(["Revolut betaalpas"]), "k", { lookup: noLookup as never, comparison }).pending)
    .toEqual(["Revolut betaalpas"]);
});

test("the comparison table is NOT consulted for a euro destination", async () => {
  // There is no koersopslag to compare when you already pay in euros.
  let calls = 0;
  const counted = () => { calls++; return Promise.resolve(TABLE); };
  getCardTerms({ ...input(["ING betaalpas"]), destination: "DE", currency: "EUR" }, "k", { lookup: noLookup as never, comparison: counted });
  await settle();
  expect(calls).toBe(0);
});

test("the comparison table is NOT used outside the Netherlands", async () => {
  // A Dutch source about Dutch banks; a Belgian ING card is a different tariff.
  let calls = 0;
  const counted = () => { calls++; return Promise.resolve(TABLE); };
  getCardTerms({ ...input(["ING betaalpas"]), homeCountry: "BE" }, "k", { lookup: noLookup as never, comparison: counted });
  await settle();
  expect(calls).toBe(0);
});

test("a failing comparison fetch leaves the provider unknown, nothing more", async () => {
  const broken = () => Promise.reject(new Error("403"));
  getCardTerms(input(["ING betaalpas"]), "k", { lookup: noLookup as never, comparison: broken });
  await settle();
  expect(getCardTerms(input(["ING betaalpas"]), "k", { lookup: noLookup as never, comparison: broken }).pending)
    .toEqual(["ING betaalpas"]);
});

/* --- Precedence. The provider's OWN tariff page beats the comparison table,
 * and the owner beats both (his corrections never enter this cache at all —
 * core's upsertFacts refuses to let an agent-sourced fact overwrite a user
 * one, so everything served from here passes that rule first). --- */

test("the comparison table never overwrites a fresher provider-specific figure", async () => {
  // n8n read ING's own tariff page: 1,5%. bank.nl says 1,4%. The provider wins.
  ingestCardTerms("NL", "USD", [{ provider: "ING betaalpas", fxFeePct: 1.5, note: "eigen tarievenblad" }]);
  getCardTerms(input(["ING betaalpas"]), "k", { lookup: noLookup as never, comparison });
  await settle();
  const res = getCardTerms(input(["ING betaalpas"]), "k", { lookup: noLookup as never, comparison });
  expect(res.terms[0]).toMatchObject({ fxFeePct: 1.5, note: "eigen tarievenblad" });
});

test("a provider-specific figure DOES overwrite a comparison figure", async () => {
  ingestCardTerms("NL", "USD", [{ provider: "ING betaalpas", fxFeePct: 1.4 }], "comparison");
  const res = ingestCardTerms("NL", "USD", [{ provider: "ING betaalpas", fxFeePct: 1.5 }]);
  expect(res).toEqual({ accepted: 1, rejected: [] });
  const out = getCardTerms(input(["ING betaalpas"]), "k", { lookup: noLookup as never });
  expect(out.terms[0]).toMatchObject({ fxFeePct: 1.5 });
});

test("the comparison table DOES overwrite what the model searched up", async () => {
  // The model's weak step was finding a tariff page at all; a curated, dated
  // table beats a web search that may not have found the right page.
  const lookup = async () => [{ provider: "ING betaalpas", fxFeePct: 9.9 }];
  getCardTerms(input(["ING betaalpas"]), "k", { lookup: lookup as never });
  await settle();
  ingestCardTerms("NL", "USD", [{ provider: "ING betaalpas", fxFeePct: 1.4 }], "comparison");
  const out = getCardTerms(input(["ING betaalpas"]), "k", { lookup: lookup as never });
  expect(out.terms[0]).toMatchObject({ fxFeePct: 1.4 });
});

test("a comparison figure may refresh an EXPIRED provider figure", async () => {
  // "Fresher" is the point: refusing forever would freeze a stale number in
  // place with nothing able to correct it.
  ingestCardTerms("NL", "USD", [{ provider: "ING betaalpas", fxFeePct: 1.5 }]);
  const realNow = Date.now;
  Date.now = () => realNow() + 8 * 24 * 60 * 60 * 1000;
  try {
    ingestCardTerms("NL", "USD", [{ provider: "ING betaalpas", fxFeePct: 1.4 }], "comparison");
    const out = getCardTerms(input(["ING betaalpas"]), "k", { lookup: noLookup as never });
    expect(out.terms[0]).toMatchObject({ fxFeePct: 1.4 });
  } finally {
    Date.now = realNow;
  }
});

test("a refused write is reported as rejected, never counted as accepted", () => {
  ingestCardTerms("NL", "USD", [{ provider: "ING betaalpas", fxFeePct: 1.5 }]);
  const res = ingestCardTerms("NL", "USD", [{ provider: "ING betaalpas", fxFeePct: 1.4 }], "comparison");
  expect(res).toEqual({ accepted: 0, rejected: ["ING betaalpas"] });
});

test("a source that states only a fee keeps what another source knew", async () => {
  // bank.nl publishes a koersopslag and nothing else. Letting it land must not
  // wipe the cashback the model found, or the ranking silently gets worse.
  const lookup = async () => [{ provider: "ING betaalpas", fxFeePct: 9.9, cashbackPct: 1, pointsPerEuro: 2 }];
  getCardTerms(input(["ING betaalpas"]), "k", { lookup: lookup as never });
  await settle();
  ingestCardTerms("NL", "USD", [{ provider: "ING betaalpas", fxFeePct: 1.4, note: "bank.nl" }], "comparison");
  const out = getCardTerms(input(["ING betaalpas"]), "k", { lookup: lookup as never });
  expect(out.terms[0]).toMatchObject({ fxFeePct: 1.4, cashbackPct: 1, pointsPerEuro: 2, note: "bank.nl" });
});

test("without a comparison layer wired in, nothing changes", async () => {
  // The layer is injected, never imported here: a caller that does not pass it
  // (every existing test, and any deployment that turns it off) gets exactly
  // the old behaviour.
  const lookup = async () => [{ provider: "ING betaalpas", fxFeePct: 1.4 }];
  const res = getCardTerms(input(["ING betaalpas"]), "k", { lookup: lookup as never });
  expect(res.pending).toEqual(["ING betaalpas"]);
});
