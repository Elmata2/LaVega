import { expect, test } from "vitest";
import { canonicalMerchantKey, normalizeLabel, resolveMerchant, type Merchant } from "./labels.js";
import { merchantKey } from "./subscriptions.js";

test("card descriptor: rail, operation date and merchant name are three facts", () => {
  const label = normalizeLabel("BEA, BETAALPAS 02/09 ALBERT HEIJN 4821", {
    on: "2025-10-04",
    region: "NL",
  });
  expect(label.rail).toBe("card");
  expect(label.operationDate).toBe("2025-09-02");
  // The trailing store number is part of the descriptor, not of the name a
  // human would use; `canonicalMerchantKey` drops it, `name` keeps what the
  // bank wrote (casing included).
  expect(label.name).toBe("ALBERT HEIJN 4821");
  expect(canonicalMerchantKey("BEA, BETAALPAS 02/09 ALBERT HEIJN 4821")).toBe(
    merchantKey("ALBERT HEIJN"),
  );
});

test("terminal id between marker and merchant is stripped only at the front", () => {
  const label = normalizeLabel("POS 5250 27DEC24 TESCO", { on: "2025-01-02" });
  expect(label.rail).toBe("card");
  expect(label.operationDate).toBe("2024-12-27");
  expect(label.name).toBe("TESCO");
  // A store number that is part of the name is not a terminal id.
  expect(normalizeLabel("CARD PAYMENT TESCO STORE 3243").name).toBe("TESCO STORE 3243");
});

test("direct debit rail is read before the transfer token inside it", () => {
  const label = normalizeLabel("SEPA INCASSO ALGEMEEN DOORLOPEND SIMYO B.V. 4839201", {
    region: "NL",
  });
  expect(label.rail).toBe("direct_debit");
  expect(label.operationDate).toBeNull();
  expect(label.name).toBe("SIMYO B.V");
  expect(canonicalMerchantKey("SEPA INCASSO ALGEMEEN DOORLOPEND SIMYO B.V. 4839201")).toBe("simyo");
});

test("refund keeps the refund rail and removes the rail it reverses", () => {
  const label = normalizeLabel("SEPA INCASSO TERUGBOEKING NETFLIX INTERNATIONAL B.V.");
  expect(label.rail).toBe("refund");
  expect(label.name).toBe("NETFLIX INTERNATIONAL B.V");
  expect(canonicalMerchantKey(label.name)).toBe("netflix");
});

test("aggregator star: the aggregator is the rail, the merchant follows", () => {
  const label = normalizeLabel("PAYPAL *STEAM GAMES");
  expect(label.rail).toBe("card");
  expect(label.name).toBe("STEAM GAMES");
});

test("German card label: marker, slashed date and merchant", () => {
  const label = normalizeLabel("KARTENZAHLUNG 02/09/2024 REWE SAGT DANKE", { region: "DE" });
  expect(label.rail).toBe("card");
  expect(label.operationDate).toBe("2024-09-02");
  expect(label.name).toBe("REWE SAGT DANKE");
});

test("German transfer label: salary marker, legal form dropped from the key", () => {
  const label = normalizeLabel("LOHN/GEHALT/RENTE ARBEITGEBER GMBH", { region: "DE" });
  expect(label.rail).toBe("transfer");
  expect(label.name).toBe("ARBEITGEBER GMBH");
  expect(canonicalMerchantKey(label.name)).toBe("arbeitgeber");
});

test("compact DU date is only read after the explicit DU marker", () => {
  const label = normalizeLabel("DU 020924 ALBERT HEIJN", { on: "2024-09-05", region: "NL" });
  expect(label.operationDate).toBe("2024-09-02");
  expect(label.name).toBe("ALBERT HEIJN");
  // A bare six-digit run stays a reference, not a date.
  expect(normalizeLabel("DU 0209244 ALBERT HEIJN").operationDate).toBeNull();
});

test("a year-less date takes the entry year, or the previous year across New Year", () => {
  expect(normalizeLabel("BEA, BETAALPAS 31/12 WINKEL", { on: "2026-01-02" }).operationDate).toBe(
    "2025-12-31",
  );
  expect(normalizeLabel("BEA, BETAALPAS 05/01 WINKEL", { on: "2026-01-10" }).operationDate).toBe(
    "2026-01-05",
  );
  // No entry date means the year is unknown, not guessed.
  expect(normalizeLabel("BEA, BETAALPAS 05/01 WINKEL").operationDate).toBeNull();
});

test("a date that does not exist on the calendar is not invented", () => {
  const label = normalizeLabel("POS 31FEB24 SHOP", { on: "2024-03-05" });
  expect(label.operationDate).toBeNull();
  expect(label.name).toBe("SHOP");
});

test("day/month order comes from the marker pack, region only as fallback", () => {
  // en_US marker: month first, regardless of the reader's region.
  expect(
    normalizeLabel("POS DEBIT 09/02 STORE", { on: "2025-10-01", region: "NL" }).operationDate,
  ).toBe("2025-09-02");
  // No marker: the region hint decides.
  expect(normalizeLabel("09/02 SHOP", { on: "2025-10-01", region: "US" }).operationDate).toBe(
    "2025-09-02",
  );
  expect(normalizeLabel("09/02 SHOP", { on: "2025-10-01", region: "NL" }).operationDate).toBe(
    "2025-02-09",
  );
});

test("a value above 12 settles day/month on its own", () => {
  expect(normalizeLabel("BEA, BETAALPAS 25/02 WINKEL", { on: "2025-03-01" }).operationDate).toBe(
    "2025-02-25",
  );
});

test("nested English refund: connector is consumed, merchant survives", () => {
  const label = normalizeLabel("REFUND CARD PAYMENT TO ASOS");
  expect(label.rail).toBe("refund");
  expect(label.name).toBe("ASOS");
});

test("reference fields truncate the tail instead of leaking into the name", () => {
  const label = normalizeLabel("BEA, BETAALPAS 02/09 ALBERT HEIJN KENMERK 884422 123456789", {
    on: "2025-10-04",
  });
  expect(label.name).toBe("ALBERT HEIJN");
});

test("a label that is only noise keeps its original text and has no merchant key", () => {
  const label = normalizeLabel("NR 1234567890");
  expect(label.name).toBe("NR 1234567890");
  expect(canonicalMerchantKey("NR 1234567890")).toBe("");
  expect(normalizeLabel("")).toEqual({
    name: "",
    hasName: false,
    rail: null,
    operationDate: null,
  });
});

test("registry aliases resolve to one canonical key, longest alias first", () => {
  const registry: Merchant[] = [
    { key: "ah", name: "Albert Heijn", aliases: ["AH", "Albert Heijn"] },
    { key: "simyo", name: "Simyo", aliases: ["Simyo"] },
  ];
  const match = resolveMerchant("BEA, BETAALPAS ALBERT HEIJN 1234", registry);
  expect(match.merchant).not.toBeNull();
  expect(match.key).toBe("ah");
  expect(match.name).toBe("Albert Heijn");

  // An unregistered merchant still lands in the same key space.
  expect(resolveMerchant("ALBERT HEIJN", []).key).toBe(merchantKey("ALBERT HEIJN"));
  expect(canonicalMerchantKey("SEPA INCASSO SIMYO B.V.", registry)).toBe("simyo");
  // Whole-token match: alias "ah" does not match inside another word.
  expect(resolveMerchant("AHOLD DELHAIZE", registry).key).not.toBe("ah");
});

test("registry alias matching ignores case, accents and punctuation", () => {
  const registry: Merchant[] = [{ key: "cafe", name: "Café Noir", aliases: ["Cafe Noir"] }];
  expect(canonicalMerchantKey("BEA, BETAALPAS CAFÉ NOIR 9911", registry)).toBe("cafe");
});
