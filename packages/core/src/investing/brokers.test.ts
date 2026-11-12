import { expect, test } from "vitest";
import {
  BROKER_IDS,
  BROKERS,
  CREDENTIAL_BROKERS,
  FILE_IMPORT_BROKERS,
  SCHEDULED_BROKERS,
  brokerLabel,
  brokerShortLabel,
  isBrokerId,
  isCredentialBroker,
} from "./brokers.js";

/* Issue #320 criterion 3: DeGiro is import-only. It must not appear in the
 * scheduled-sync set or behind the credential APIs. */
test("DeGiro is import-only: no credentials, no scheduled sync", () => {
  expect(BROKERS.degiro).toMatchObject({
    credentials: false,
    scheduled: false,
    fileImport: true,
  });
  expect(SCHEDULED_BROKERS).toEqual(["ibkr", "trading212"]);
  expect(CREDENTIAL_BROKERS).toEqual(["ibkr", "trading212"]);
  expect(FILE_IMPORT_BROKERS).toEqual(["degiro"]);
  expect(isCredentialBroker("degiro")).toBe(false);
  expect(isBrokerId("degiro")).toBe(true);
});

/* The lists are derived from the table, so a capability that is false in the
 * table cannot leak into the matching list. */
test("every capability list holds exactly the brokers that declare it", () => {
  expect(CREDENTIAL_BROKERS).toEqual(BROKER_IDS.filter((id) => BROKERS[id].credentials));
  expect(SCHEDULED_BROKERS).toEqual(BROKER_IDS.filter((id) => BROKERS[id].scheduled));
  expect(FILE_IMPORT_BROKERS).toEqual(BROKER_IDS.filter((id) => BROKERS[id].fileImport));
});

test("every broker has a distinct name for the screen", () => {
  const labels = BROKER_IDS.map((id) => brokerLabel(id));
  const shortLabels = BROKER_IDS.map((id) => brokerShortLabel(id));
  expect(labels).toEqual(["Interactive Brokers", "Trading 212", "DeGiro"]);
  expect(shortLabels).toEqual(["IBKR", "Trading 212", "DeGiro"]);
  expect(new Set(labels).size).toBe(labels.length);
  expect(new Set(shortLabels).size).toBe(shortLabels.length);
});

test("an unknown id is not a broker, and not a credential broker", () => {
  for (const value of ["degiro2", "IBKR", "", "toString", null, 42]) {
    expect(isBrokerId(value)).toBe(false);
    expect(isCredentialBroker(value)).toBe(false);
  }
  expect(isCredentialBroker("ibkr")).toBe(true);
});
