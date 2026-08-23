import { beforeEach, afterEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG_FILE, loadCatalogue } from "./catalogFile.js";
import { getCardTerms, resetCardTerms } from "./cardTerms.js";
import type { TravelInput } from "./agent/travel.js";

let dir: string;
let logged: string[];

beforeEach(() => {
  resetCardTerms();
  dir = mkdtempSync(join(tmpdir(), "lavega-catalog-"));
  logged = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const log = (m: string) => { logged.push(m); };

/** A catalogue file on disk, written for one test. */
function file(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
}

const covered = {
  value: 1.4,
  route: "provider-pdf",
  sourceUrl: "https://assets.ing.com/x.pdf",
  checkedAt: "2026-06-15",
  conditions: null,
  conditionsKnown: true,
};

/** What the travel route asks for. */
const ask = (providers: string[]): TravelInput =>
  ({ homeCountry: "NL", destination: "US", currency: "USD", providers, knownFacts: [] });

test("a valid catalogue populates the card-terms cache, so the travel block is answered without a lookup", () => {
  const path = file("catalog.json", JSON.stringify({
    generatedAt: "2026-08-18",
    entries: [{ id: "ing-betaalpas", product: "ING betaalpas", fields: { fxFeePct: covered } }],
  }));

  const res = loadCatalogue({ file: path, currency: "USD", log });

  expect(res).toMatchObject({ accepted: 1, refused: 0, total: 1, loaded: true });
  // Instantly, from the file — no lookup was needed to answer.
  const held = getCardTerms(ask(["ING betaalpas"]), "k", { lookup: (async () => []) as never });
  expect(held.terms[0].fxFeePct).toBe(1.4);
  expect(held.terms[0].checkedAt).toBe("2026-06-15"); // the SOURCE's date, never the sweep's
  expect(logged.join("\n")).toContain("1 accepted");
});

test("a missing file logs and does not throw — a fresh clone still boots", () => {
  const path = join(dir, "nope.json");

  expect(() => loadCatalogue({ file: path, currency: "USD", log })).not.toThrow();
  const res = loadCatalogue({ file: path, currency: "USD", log });

  expect(res).toMatchObject({ accepted: 0, refused: 0, total: 0, loaded: false });
  expect(res.reason).toBeTruthy();
  expect(logged.join("\n")).toContain("not loaded");
});

test("a malformed file logs and does not throw — a half-written sweep must not take the server down", () => {
  const path = file("catalog.json", "{ entries: [ this is not json");

  expect(() => loadCatalogue({ file: path, currency: "USD", log })).not.toThrow();
  const res = loadCatalogue({ file: path, currency: "USD", log });

  expect(res.loaded).toBe(false);
  expect(res.accepted).toBe(0);
  expect(logged.join("\n")).toContain("not loaded");
});

test("valid JSON of the wrong SHAPE is refused whole, not half-ingested", () => {
  // `entries` missing entirely, and `entries` holding junk. Both parse fine and
  // neither is a catalogue.
  const noEntries = file("a.json", JSON.stringify({ generatedAt: "2026-08-18" }));
  expect(loadCatalogue({ file: noEntries, currency: "USD", log }).loaded).toBe(false);

  const junk = file("b.json", JSON.stringify({ entries: [null, 3, "ING", { id: "x" }] }));
  const res = loadCatalogue({ file: junk, currency: "USD", log });
  expect(res.accepted).toBe(0);
  expect(res.refused).toBe(4); // counted, not silently dropped
});

test("a figure whose conditions were never established is still refused after the wiring", () => {
  // The rule the whole phase rests on, checked at the boundary that now feeds
  // the app: Revolut's 0% was true only inside a EUR 1.000 monthly cap, and it
  // shipped as unconditional and ranked first. A file cannot be a way around it.
  const path = file("catalog.json", JSON.stringify({
    entries: [{
      id: "revolut-betaalpas",
      product: "Revolut betaalpas",
      fields: { fxFeePct: { ...covered, value: 0, route: "provider-page", sourceUrl: "https://revolut.com/x", conditionsKnown: false } },
    }],
  }));

  const res = loadCatalogue({ file: path, currency: "USD", log });

  expect(res).toMatchObject({ accepted: 0, refused: 1, total: 1, loaded: true });
  // Nothing was served in its place. Unknown is never zero.
  expect(getCardTerms(ask(["Revolut betaalpas"]), "k", { lookup: (async () => []) as never }).terms).toEqual([]);
  expect(logged.join("\n")).toContain("1 refused");
});

test("the default path resolves to the committed catalogue, from either working directory", () => {
  // WEB_DIST's trick: derive from this FILE, not from cwd. `pnpm --filter` runs
  // in the package dir and Railway runs from the repo root, and a relative path
  // would silently find nothing in one of them.
  expect(CATALOG_FILE.endsWith("/docs/catalog/catalog.json")).toBe(true);
  expect(existsSync(CATALOG_FILE)).toBe(true);
});

test("loading the REAL committed catalogue reports its counts and does not throw", () => {
  // The committed file is written by the sweep, which another process owns. It
  // must never be able to stop the server booting, whatever it currently holds.
  const res = loadCatalogue({ log });

  expect(res.loaded).toBe(true);
  expect(res.total).toBeGreaterThan(0);
  expect(res.accepted + res.refused).toBe(res.total);
  expect(logged.join("\n")).toContain("catalogue");
});
