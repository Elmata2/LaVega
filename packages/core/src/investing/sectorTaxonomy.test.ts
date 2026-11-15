import { expect, test } from "vitest";
import { formatSectorWeightKey, GICS_SECTOR_LABELS } from "./sectorTaxonomy.js";

test("maps every Yahoo sectorWeightings key to a GICS label, realestate irregular", () => {
  expect(formatSectorWeightKey("technology")).toBe("Technology");
  expect(formatSectorWeightKey("consumer_cyclical")).toBe("Consumer Cyclical");
  expect(formatSectorWeightKey("realestate")).toBe("Real Estate");
});

test("an unrecognized key formats to null instead of inventing a 12th sector", () => {
  expect(formatSectorWeightKey("crypto_assets")).toBeNull();
});

test("every formatted label is a member of the canonical set", () => {
  for (const key of ["technology", "financial_services", "realestate"]) {
    expect(GICS_SECTOR_LABELS).toContain(formatSectorWeightKey(key));
  }
});
