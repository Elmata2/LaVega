import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { YAHOO_DISCLOSURE_VERSION } from "./marketDataConsent.js";
import { createFileMarketDataConsentStore } from "./fileMarketDataConsentStore.js";

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

test("persists Yahoo consent across store instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-consent-"));
  directories.push(directory);
  const file = join(directory, "nested", "consent.json");
  await createFileMarketDataConsentStore(file).set({
    tenantId: "local",
    accepted: true,
    decidedAt: "2026-08-21T12:00:00.000Z",
    disclosureVersion: YAHOO_DISCLOSURE_VERSION,
  });
  await expect(createFileMarketDataConsentStore(file).get("local")).resolves.toMatchObject({
    accepted: true,
    disclosureVersion: YAHOO_DISCLOSURE_VERSION,
  });
});

test("requires renewed consent after disclosure version changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-consent-version-"));
  directories.push(directory);
  const file = join(directory, "consent.json");
  await writeFile(
    file,
    JSON.stringify([
      {
        tenantId: "local",
        accepted: true,
        decidedAt: "2025-01-01T00:00:00.000Z",
        disclosureVersion: "yahoo-finance-old",
      },
    ]),
  );
  await expect(createFileMarketDataConsentStore(file).get("local")).resolves.toEqual({
    tenantId: "local",
    accepted: false,
    decidedAt: null,
    disclosureVersion: YAHOO_DISCLOSURE_VERSION,
  });
});
