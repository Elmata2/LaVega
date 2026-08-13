import { expect, test } from "vitest";
import { sanitizeTravelInput, lookupProviderTerms } from "./travel.js";

const valid = { homeCountry: "NL", destination: "US", currency: "USD", providers: ["ING", "Trading 212"], knownFacts: [] };

test("sanitize keeps only the allowlisted fields", () => {
  const out = sanitizeTravelInput(valid);
  expect(out).toEqual({ homeCountry: "NL", destination: "US", currency: "USD", providers: ["ING", "Trading 212"], knownFacts: [] });
});

test("nothing about the user's money can pass the boundary", () => {
  const out = sanitizeTravelInput({
    ...valid,
    balance: 12345,
    accounts: [{ key: "NL01INGB0001234567", balance: 9999 }],
    txs: [{ amount: -45.2, counterparty: "Albert Heijn" }],
    iban: "NL01INGB0001234567",
    entity: "BV1",
  });
  const serialized = JSON.stringify(out);
  expect(serialized).not.toContain("12345");
  expect(serialized).not.toContain("INGB");
  expect(serialized).not.toContain("Albert Heijn");
  expect(serialized).not.toContain("BV1");
  expect(Object.keys(out).sort()).toEqual(["currency", "destination", "homeCountry", "knownFacts", "providers"]);
});

test("destination and home country must be country codes, never free text", () => {
  expect(() => sanitizeTravelInput({ ...valid, destination: "Amerika (met Jan en Marie)" })).toThrow();
  expect(sanitizeTravelInput({ ...valid, homeCountry: "vanuit Rotterdam" }).homeCountry).toBe("NL"); // safe default
  expect(sanitizeTravelInput({ ...valid, currency: "dollars please" }).currency).toBe("");
});

test("provider names are de-duped and length-capped; empty or oversize input is refused", () => {
  const out = sanitizeTravelInput({ ...valid, providers: ["ING", "ing", "ING", "x".repeat(200)] });
  expect(out.providers).toHaveLength(3); // ING, ing, and the truncated one
  expect(out.providers[2].length).toBe(60);
  expect(() => sanitizeTravelInput({ ...valid, providers: [] })).toThrow();
  expect(() => sanitizeTravelInput({ ...valid, providers: Array(20).fill("bank") })).toThrow();
  expect(() => sanitizeTravelInput({ ...valid, knownFacts: Array(99).fill({ subject: "a", key: "b", value: "c" }) })).toThrow();
});

test("known facts survive, malformed ones are dropped", () => {
  const out = sanitizeTravelInput({
    ...valid,
    knownFacts: [{ subject: "Trading 212", key: "fxFeePct", value: "0.5" }, { subject: "x" }, "nope", null],
  });
  expect(out.knownFacts).toEqual([{ subject: "Trading 212", key: "fxFeePct", value: "0.5" }]);
});

/* --- The model call, with a stubbed client (no network, no key). --- */

function stubClient(providers: unknown) {
  return {
    messages: {
      create: async () => ({ content: [{ type: "tool_use", name: "report_provider_terms", input: { providers } }] }),
    },
  } as never;
}

test("lookup returns terms for the providers we asked about", async () => {
  const client = stubClient([
    { provider: "Trading 212", fxFeePct: 0, cashbackPct: 1, note: "geen wisselkosten" },
    { provider: "ING", fxFeePct: 1.2 },
  ]);
  const out = await lookupProviderTerms(sanitizeTravelInput(valid), "k", { client });
  expect(out).toHaveLength(2);
  expect(out[0]).toMatchObject({ provider: "Trading 212", fxFeePct: 0, cashbackPct: 1 });
  expect(out[1]).toMatchObject({ provider: "ING", fxFeePct: 1.2 });
});

test("a product the user does not hold is dropped, and unverifiable fields stay undefined", async () => {
  const client = stubClient([
    { provider: "Some Other Bank", fxFeePct: 0 }, // never asked for
    { provider: "trading 212", fxFeePct: 0, cashbackPct: "veel" }, // case-insensitive match, junk number
  ]);
  const out = await lookupProviderTerms(sanitizeTravelInput(valid), "k", { client });
  expect(out.map((o) => o.provider)).toEqual(["Trading 212"]); // normalized back to what we asked
  expect(out[0].cashbackPct).toBeUndefined(); // not coerced to 0
});

test("a model reply with no tool call yields no terms rather than throwing", async () => {
  const client = { messages: { create: async () => ({ content: [{ type: "text", text: "sorry" }] }) } } as never;
  expect(await lookupProviderTerms(sanitizeTravelInput(valid), "k", { client })).toEqual([]);
});

test("a provider that looks like an account number is refused at the boundary", () => {
  const out = sanitizeTravelInput({ ...valid, providers: ["ING", "A 286-41213", "NL12INGB0123456789", "D 128-83091"] });
  expect(out.providers).toEqual(["ING"]); // identifiers dropped, brand kept
  // Nothing digit-shaped survives into what we would send.
  expect(out.providers.some((p) => /\d{4}/.test(p))).toBe(false);
  // If ALL of them were identifiers there is nothing legitimate to ask about.
  expect(() => sanitizeTravelInput({ ...valid, providers: ["A 286-41213"] })).toThrow();
});

test("real brand names with digits still pass", () => {
  const out = sanitizeTravelInput({ ...valid, providers: ["Trading 212", "N26", "bunq", "American Express"] });
  expect(out.providers).toEqual(["Trading 212", "N26", "bunq", "American Express"]);
});
