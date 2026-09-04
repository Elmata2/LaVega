// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { computeVatSetAside, nextBtwDeadline } from "@lavega/core";
import type { Tx, VatSettings } from "@lavega/core";

test("Belasting wiring: settings + txs -> a savable VAT ScheduledFlow", () => {
  const settings: VatSettings = {
    entity: "BV1",
    frequency: "quarterly",
    defaultRatePct: 21,
    mixedRates: false,
  };
  const txs: Tx[] = [
    {
      id: "t",
      accountKey: "A",
      date: "2026-05-01",
      amount: 12100,
      currency: "EUR",
      counterparty: "Klant",
      description: "",
      category: "",
      manual: false,
    },
  ];
  const dl = nextBtwDeadline("quarterly", "2026-06-20");
  const flow = computeVatSetAside(txs, settings, "2026-06-20");
  expect(dl.deadline).toBe("2026-07-31");
  expect(flow?.source).toBe("vat");
  expect(flow?.dueDate).toBe("2026-07-31");
});
