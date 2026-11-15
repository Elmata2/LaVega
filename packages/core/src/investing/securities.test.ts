import { describe, expect, test } from "vitest";
import {
  clampToListingStart,
  instrumentAliases,
  instrumentKey,
  instrumentKeyForSymbol,
  isValidIsin,
  normalizeIsin,
  planThesisMigration,
  provisionalRefetchFrom,
  providerAffinity,
  resolveSecurityIdentities,
  PROVISIONAL_REFETCH_DAYS,
} from "./securities.js";

/* WS4.5 acceptance (#297):
 *  - the same ISIN from two brokers resolves to one security and one thesis key;
 *  - a symbol change does not split history;
 *  - a migration fixture proves existing confirmed theses survive as one key or
 *    are surfaced for review, never silently merged.
 */

const ALPHABET_ISIN = "US02079K3059";
const ALPHABET_OTHER_ISIN = "US02079K1079";
const APPLE_ISIN = "US0378331005";
const ASML_ISIN = "NL0010273215";

describe("identity", () => {
  test("accepts only well-formed ISINs with a valid check digit", () => {
    expect(isValidIsin(APPLE_ISIN)).toBe(true);
    expect(isValidIsin(ASML_ISIN)).toBe(true);
    expect(isValidIsin(ALPHABET_ISIN)).toBe(true);
    expect(isValidIsin("US0378331004")).toBe(false); // wrong check digit
    expect(isValidIsin("US037833100")).toBe(false); // too short
    expect(isValidIsin("")).toBe(false);
    expect(isValidIsin(null)).toBe(false);
    expect(normalizeIsin(" us0378331005 ")).toBe(APPLE_ISIN);
  });

  test("ISIN first, then ticker and MIC, then a bare ticker", () => {
    expect(instrumentKey({ isin: APPLE_ISIN, ticker: "AAPL" })).toBe(`isin:${APPLE_ISIN}`);
    expect(instrumentKey({ ticker: "AAPL", mic: "XNAS" })).toBe("sym:AAPL@XNAS");
    expect(instrumentKey({ ticker: "AAPL" })).toBe("sym:AAPL");
    // A malformed ISIN is not an identity, so the ticker path answers.
    expect(instrumentKey({ isin: "NOPE", ticker: "AAPL", mic: "XNAS" })).toBe("sym:AAPL@XNAS");
  });

  test("canonicalises MIC aliases so one venue is one identity", () => {
    expect(instrumentKey({ ticker: "ASML", mic: "war" })).toBe("sym:ASML@XWAR");
    expect(instrumentKey({ ticker: "ASML", mic: "XWAR" })).toBe("sym:ASML@XWAR");
    expect(instrumentAliases({ isin: APPLE_ISIN, ticker: "AAPL", mic: "XNAS" })).toEqual([
      `isin:${APPLE_ISIN}`,
      "sym:AAPL@XNAS",
    ]);
  });

  test("the same ISIN from two brokers is one security with two aliases", () => {
    const resolved = resolveSecurityIdentities([
      { symbol: "GOOGL_US_EQ", isin: ALPHABET_ISIN, broker: "trading212" },
      { symbol: "GOOGL", isin: ALPHABET_ISIN, broker: "ibkr" },
    ]);
    expect(resolved.identities).toHaveLength(1);
    expect(resolved.identities[0]).toMatchObject({
      key: `isin:${ALPHABET_ISIN}`,
      isin: ALPHABET_ISIN,
      aliases: ["GOOGL", "GOOGL_US_EQ"],
      brokers: ["ibkr", "trading212"],
    });
    expect(instrumentKeyForSymbol(resolved, "GOOGL_US_EQ")).toBe(`isin:${ALPHABET_ISIN}`);
    expect(instrumentKeyForSymbol(resolved, "GOOGL")).toBe(`isin:${ALPHABET_ISIN}`);
  });

  test("a symbol change does not split the history", () => {
    const resolved = resolveSecurityIdentities([
      { symbol: "FB", isin: ALPHABET_OTHER_ISIN, broker: "ibkr" },
      { symbol: "META", isin: ALPHABET_OTHER_ISIN, broker: "trading212" },
    ]);
    expect(resolved.identities).toHaveLength(1);
    expect(resolved.identities[0]!.aliases).toEqual(["FB", "META"]);
    expect(instrumentKeyForSymbol(resolved, "FB")).toBe(instrumentKeyForSymbol(resolved, "META"));
  });

  test("distinct share classes stay apart and a reused ticker is reported as ambiguous", () => {
    const resolved = resolveSecurityIdentities([
      { symbol: "BRK.B", isin: ALPHABET_ISIN, broker: "ibkr" },
      { symbol: "BRK.B", isin: ALPHABET_OTHER_ISIN, broker: "trading212" },
    ]);
    expect(resolved.identities).toHaveLength(2);
    expect(resolved.ambiguousSymbols).toEqual(["BRK.B"]);
    expect(resolved.bySymbol["BRK.B"]).toBeUndefined();
  });

  test("rows without an ISIN group by ticker and MIC, and an unknown symbol is null", () => {
    const resolved = resolveSecurityIdentities([
      { symbol: "ASML", mic: "XAMS", broker: "trading212" },
      { symbol: "ASML", mic: "XNAS", broker: "ibkr" },
      { symbol: "IWM", broker: "ibkr" },
    ]);
    expect(resolved.identities.map((identity) => identity.key)).toEqual([
      "sym:ASML@XAMS",
      "sym:ASML@XNAS",
      "sym:IWM",
    ]);
    expect(instrumentKeyForSymbol(resolved, "missing")).toBeNull();
  });
});

describe("thesis migration", () => {
  const resolved = resolveSecurityIdentities([
    { symbol: "GOOGL_US_EQ", isin: ALPHABET_ISIN, broker: "trading212" },
    { symbol: "GOOGL", isin: ALPHABET_ISIN, broker: "ibkr" },
    { symbol: "ASML", isin: ASML_ISIN, broker: "trading212" },
  ]);

  test("identical confirmed theses become one key", () => {
    const plan = planThesisMigration(
      [
        { symbol: "GOOGL_US_EQ", status: "active", fingerprint: "same-body" },
        { symbol: "GOOGL", status: "active", fingerprint: "same-body" },
      ],
      resolved,
    );
    expect(plan.merges).toEqual([
      {
        instrumentKey: `isin:${ALPHABET_ISIN}`,
        keptSymbol: "GOOGL",
        mergedSymbols: ["GOOGL_US_EQ"],
      },
    ]);
    expect(plan.reviews).toEqual([]);
  });

  test("conflicting confirmed theses are surfaced for review, never silently merged", () => {
    const plan = planThesisMigration(
      [
        { symbol: "GOOGL_US_EQ", status: "active", fingerprint: "search-winner" },
        { symbol: "GOOGL", status: "active", fingerprint: "cloud-winner" },
      ],
      resolved,
    );
    expect(plan.merges).toEqual([]);
    expect(plan.reviews).toEqual([
      {
        instrumentKey: `isin:${ALPHABET_ISIN}`,
        symbols: ["GOOGL", "GOOGL_US_EQ"],
        reason: "conflicting-theses",
      },
    ]);
    // Both rows still get the canonical key; nothing is dropped or overwritten.
    expect(plan.assignments).toEqual([
      { symbol: "GOOGL", instrumentKey: `isin:${ALPHABET_ISIN}` },
      { symbol: "GOOGL_US_EQ", instrumentKey: `isin:${ALPHABET_ISIN}` },
    ]);
  });

  test("an active and a dormant thesis of one instrument are a conflict, not a merge", () => {
    const plan = planThesisMigration(
      [
        { symbol: "ASML", status: "active", fingerprint: "same-body" },
        { symbol: "ASML.AS", status: "dormant", fingerprint: "same-body" },
      ],
      { bySymbol: { ASML: `isin:${ASML_ISIN}`, "ASML.AS": `isin:${ASML_ISIN}` } },
    );
    expect(plan.merges).toEqual([]);
    expect(plan.reviews).toHaveLength(1);
  });

  test("a thesis the snapshot cannot place keeps a null key", () => {
    const plan = planThesisMigration(
      [{ symbol: "OLDCO", status: "active", fingerprint: "body" }],
      resolved,
    );
    expect(plan.assignments).toEqual([{ symbol: "OLDCO", instrumentKey: null }]);
    expect(plan.merges).toEqual([]);
    expect(plan.reviews).toEqual([]);
  });
});

describe("price hardening", () => {
  test("an unavailable assigned provider is skipped, never replanned", () => {
    expect(providerAffinity(null, ["yahoo"])).toEqual({ skip: false });
    expect(providerAffinity("yahoo", ["yahoo", "marketstack"])).toEqual({ skip: false });
    expect(providerAffinity("yahoo", ["marketstack"])).toEqual({
      skip: true,
      reason: "Assigned price provider yahoo is unavailable; skipped instead of replanning",
    });
  });

  test("a provisional close is refetched only inside its window", () => {
    expect(PROVISIONAL_REFETCH_DAYS).toBe(7);
    expect(provisionalRefetchFrom("2026-11-10", "2026-11-11")).toBe("2026-11-10");
    expect(provisionalRefetchFrom("2026-11-04", "2026-11-11")).toBe("2026-11-04");
    expect(provisionalRefetchFrom("2026-11-03", "2026-11-11")).toBeNull();
    expect(provisionalRefetchFrom("2026-11-12", "2026-11-11")).toBeNull();
    expect(provisionalRefetchFrom(undefined, "2026-11-11")).toBeNull();
  });

  test("a backfill is clamped to the listing start", () => {
    expect(clampToListingStart("2020-01-01", "2023-06-01")).toBe("2023-06-01");
    expect(clampToListingStart("2024-01-01", "2023-06-01")).toBe("2024-01-01");
    expect(clampToListingStart(undefined, "2023-06-01")).toBe("2023-06-01");
    expect(clampToListingStart("2020-01-01", null)).toBe("2020-01-01");
  });
});
