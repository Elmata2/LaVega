import { readFileSync } from "node:fs";
import { Cause, Effect, Exit } from "effect";
import { expect, test } from "vitest";
import { DeGiroReadError } from "./read.js";
import {
  DEGIRO_HEADERS,
  detectProfile,
  readDeGiro,
  readDeGiroCsv,
  unknownHeaderProblem,
} from "./profiles.js";

/* Issue #314, part 2: profile detection by exact header signature.
 *
 * The five signatures were verified from real exports and are recorded in
 * `docs/investing/DEGIRO.md`. The fixtures under `__fixtures__/degiro/` carry
 * the byte-exact header line, so detection is tested against the real bytes
 * and not against a copy of the spec.
 */

const fixture = (path: string): string =>
  readFileSync(new URL(`../__fixtures__/degiro/${path}`, import.meta.url), "utf8");

const ACCOUNT_NL = "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id";
const TRANSACTIONS_NL =
  "Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde EUR,Wisselkoers,AutoFX Kosten,Transactiekosten en/of kosten van derden EUR,Totaal EUR,Order ID";
const TRANSACTIONS_EN =
  "Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID";
const PORTFOLIO_NL = "Product,Symbool/ISIN,Aantal,Slotkoers,Lokale waarde,,Waarde in EUR";
const PORTFOLIO_EN = "Product,Symbol/ISIN,Amount,Closing,Local value,,Value in EUR";

const FIXTURES = [
  { file: "nl/account.csv", profile: "account", language: "nl", header: ACCOUNT_NL },
  { file: "nl/transactions.csv", profile: "transactions", language: "nl", header: TRANSACTIONS_NL },
  { file: "en/transactions.csv", profile: "transactions", language: "en", header: TRANSACTIONS_EN },
  { file: "nl/portfolio.csv", profile: "portfolio", language: "nl", header: PORTFOLIO_NL },
  { file: "en/portfolio.csv", profile: "portfolio", language: "en", header: PORTFOLIO_EN },
] as const;

for (const { file, profile, language, header } of FIXTURES) {
  test(`${file} detects as ${profile}/${language}`, () => {
    const text = fixture(file);
    // The fixture carries the verified header byte for byte; a drift between
    // fixture, test constant and spec would show up here, not in detection.
    expect(text.split(/\r?\n/)[0]).toBe(header);
    const read = readDeGiroCsv(text);
    expect(read.detection).toEqual({ known: true, profile, language });
    expect(read.problems).toEqual([]);
    expect(read.table).not.toBeNull();
    expect(read.table?.rows.length).toBeGreaterThan(0);
  });
}

test("DEGIRO_HEADERS holds the five verified signatures and each round-trips", () => {
  expect(DEGIRO_HEADERS).toHaveLength(5);
  for (const entry of DEGIRO_HEADERS) {
    expect(detectProfile(entry.header)).toEqual({
      known: true,
      profile: entry.profile,
      language: entry.language,
    });
  }
});

test("DEGIRO_HEADERS keeps the spec order and the byte-exact cells", () => {
  expect(DEGIRO_HEADERS.map((entry) => `${entry.profile}/${entry.language}`)).toEqual(
    FIXTURES.map((entry) => `${entry.profile}/${entry.language}`),
  );
  expect(DEGIRO_HEADERS.map((entry) => entry.header.join(","))).toEqual(
    FIXTURES.map((entry) => entry.header),
  );
});

test("a header with one renamed column is unknown and the problem names the header", () => {
  const detection = detectProfile(ACCOUNT_NL.replace("Omschrijving", "Beschrijving").split(","));
  expect(detection.known).toBe(false);
  if (detection.known) throw new Error("a renamed column must not detect");
  expect(detection.problem).toBe(
    "onbekend DeGiro-formaat: Datum,Tijd,Valutadatum,Product,ISIN,Beschrijving,FX,Mutatie,,Saldo,,Order Id",
  );
});

test("a non-DeGiro CSV is unknown with exactly one problem", () => {
  const read = readDeGiroCsv("Date,Description,Amount\n2026-01-01,synthetic,1\n");
  expect(read.detection.known).toBe(false);
  expect(read.problems).toHaveLength(1);
  expect(read.problems[0]?.startsWith("onbekend DeGiro-formaat: ")).toBe(true);
});

test("the problem sentence trims the cells it names", () => {
  expect(unknownHeaderProblem([" A ", " B "])).toBe("onbekend DeGiro-formaat: A,B");
  expect(unknownHeaderProblem([])).toBe("onbekend DeGiro-formaat: ");
});

test("empty text is one problem, no table, no rows", () => {
  const read = readDeGiroCsv("");
  expect(read.problems).toEqual(["leeg bestand — geen DeGiro-export gevonden"]);
  expect(read.problems).toHaveLength(1);
  expect(read.detection.known).toBe(false);
  expect(read.table).toBeNull();
});

test("a header-only account file is a known profile without rows", () => {
  const read = readDeGiroCsv(ACCOUNT_NL);
  expect(read.detection).toEqual({ known: true, profile: "account", language: "nl" });
  expect(read.problems).toHaveLength(1);
  expect(read.problems[0]).toMatch(/zonder rijen/);
  expect(read.problems[0]).toBe("DeGiro account-export zonder rijen");
  expect(read.table?.rows).toEqual([]);
});

test("whitespace around header cells still detects", () => {
  const padded = ACCOUNT_NL.split(",").map((cell) => ` ${cell}\t`);
  expect(detectProfile(padded)).toEqual({ known: true, profile: "account", language: "nl" });
});

test("a leading UTF-8 BOM in the text still detects through the reader", () => {
  const read = readDeGiroCsv(`\uFEFF${fixture("nl/account.csv")}`);
  expect(read.detection).toEqual({ known: true, profile: "account", language: "nl" });
  expect(read.problems).toEqual([]);
});

/* Acceptance criterion of #314: "a renamed file is detected the same as
 * Account.csv". Detection takes no filename at all — the header alone decides —
 * so a rename cannot change the result. This test is the guard against a future
 * filename shortcut; if one appears, this call signature would expose it. */
test("a renamed file detects the same: no filename is an input", () => {
  expect(detectProfile(ACCOUNT_NL.split(","))).toEqual({
    known: true,
    profile: "account",
    language: "nl",
  });
  // The same header text detects identically when the file around it differs:
  // the header-only text and the full fixture agree on the detection.
  const headerOnly = readDeGiroCsv(ACCOUNT_NL);
  const fullFile = readDeGiroCsv(fixture("nl/account.csv"));
  expect(headerOnly.detection).toEqual(fullFile.detection);
});

test("readDeGiro succeeds on the account fixture", () => {
  const read = Effect.runSync(readDeGiro(fixture("nl/account.csv")));
  expect(read.detection.profile).toBe("account");
  expect(read.detection.language).toBe("nl");
  expect(read.problems).toEqual([]);
  expect(read.table?.rows.length).toBeGreaterThan(0);
});

test("readDeGiro fails with a typed DeGiroReadError on empty text", () => {
  const exit = Effect.runSyncExit(readDeGiro(""));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) throw new Error("empty text must not succeed");
  const error = Cause.squash(exit.cause);
  expect(error).toBeInstanceOf(DeGiroReadError);
  expect((error as DeGiroReadError)._tag).toBe("DeGiroReadError");
  expect((error as DeGiroReadError).problem).toBe("leeg bestand — geen DeGiro-export gevonden");
});
