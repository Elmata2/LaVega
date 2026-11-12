import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseBrokerFile } from "./parseBrokerFile.js";
import { DEGIRO_HEADERS, detectProfile } from "./degiro/profiles.js";

/* Issue #314: the DeGiro reader and header-signature profile detection.
 *
 * The old parser guessed from the filename and from loose header names. Run
 * against a real NL account statement it answered `onbekend of leeg bestand —
 * geen transacties of posities herkend` (see `docs/investing/DEGIRO.md`,
 * "Current state"). These tests pin the replacement: the header alone decides
 * the profile, and the filename is never consulted.
 *
 * The invented #47/#49 DeGiro fixtures are gone (#313). Row mapping is not part
 * of this issue; it lands in #315–#319, so a recognised file still reports one
 * problem instead of returning rows.
 */

const fixture = (path: string): string =>
  readFileSync(new URL(`./__fixtures__/degiro/${path}`, import.meta.url), "utf8");

const account = fixture("nl/account.csv");
const transactions = fixture("nl/transactions.csv");
const portfolio = fixture("nl/portfolio.csv");

test("the real-format account statement is detected as `account`, not rejected", () => {
  // The whole point of the issue: the pre-#314 parser rejected this file.
  expect(detectProfile(account.split("\n")[0]!.split(","))).toMatchObject({
    known: true,
    profile: "account",
    language: "nl",
  });

  const parsed = parseBrokerFile("Account.csv", account);
  expect(parsed.source).toBe("DeGiro account");
  expect(parsed.problems.join(" ")).not.toMatch(/onbekend/);
  expect(parsed.positions).toEqual([]);
  expect(parsed.trades).toEqual([]);
});

test.each([
  ["nl/account.csv", "account"],
  ["nl/transactions.csv", "transactions"],
  ["en/transactions.csv", "transactions"],
  ["nl/portfolio.csv", "portfolio"],
  ["en/portfolio.csv", "portfolio"],
] as const)("%s is detected as %s", (path, profile) => {
  expect(parseBrokerFile("export.csv", fixture(path)).source).toBe(`DeGiro ${profile}`);
});

test("a renamed file is detected the same as a correctly named one", () => {
  const names = ["Account.csv", "foo.csv", "export (1).csv", "", "rekening.CSV"];
  const parsed = names.map((name) => parseBrokerFile(name, account));
  for (const result of parsed) {
    expect(result.source).toBe("DeGiro account");
    expect(result.problems).toEqual(parsed[0]!.problems);
  }
});

test("the filename never overrides the header", () => {
  // A file the user named after the wrong export still parses by its header.
  expect(parseBrokerFile("Portfolio.csv", account).source).toBe("DeGiro account");
  expect(parseBrokerFile("Transactions.csv", portfolio).source).toBe("DeGiro portfolio");
  expect(parseBrokerFile("Account.csv", transactions).source).toBe("DeGiro transactions");
});

test("an unknown header returns one clear problem and no rows", () => {
  const table = "Datum,Onbekend,Velderij\n06-03-2026,x,y\n";
  const parsed = parseBrokerFile("Account.csv", table);
  expect(parsed.positions).toEqual([]);
  expect(parsed.trades).toEqual([]);
  expect(parsed.source).toBe("");
  expect(parsed.problems).toEqual(["onbekend DeGiro-formaat: Datum,Onbekend,Velderij"]);
});

test.each([
  ["empty file", "", /leeg bestand/],
  ["whitespace only", "  \r\n\r\n", /leeg bestand/],
  ["header-only account", `${DEGIRO_HEADERS[0]!.header.join(",")}\n`, /zonder rijen/],
  ["header-only transactions", `${DEGIRO_HEADERS[1]!.header.join(",")}\r\n`, /zonder rijen/],
  [
    "a semicolon export",
    "Date;Amount;Currency;Description\n2026-08-14;100;EUR;Deposit",
    /onbekend/,
  ],
])("%s returns one problem and no rows", (_label, text, problem) => {
  const parsed = parseBrokerFile("Account.csv", text);
  expect(parsed.positions).toEqual([]);
  expect(parsed.trades).toEqual([]);
  expect(parsed.problems).toHaveLength(1);
  expect(parsed.problems[0]).toMatch(problem);
});
