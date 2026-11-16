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
 * The invented #47/#49 DeGiro fixtures are gone (#313). The account statement is
 * fully mapped (#315–#317), the transaction export maps to trades and an unknown
 * cash-history claim (#318), and the portfolio export maps to dated positions
 * and its cash row (#319).
 */

const fixture = (path: string): string =>
  readFileSync(new URL(`./__fixtures__/degiro/${path}`, import.meta.url), "utf8");

const account = fixture("nl/account.csv");
const transactions = fixture("nl/transactions.csv");
const portfolio = fixture("nl/portfolio.csv");

test("the real-format account statement is detected and mapped as `account`, not rejected", () => {
  // The whole point of the issue: the pre-#314 parser rejected this file.
  expect(detectProfile(account.split("\n")[0]!.split(","))).toMatchObject({
    known: true,
    profile: "account",
    language: "nl",
  });

  const parsed = parseBrokerFile("Account.csv", account);
  expect(parsed.profile).toBe("account");
  expect(parsed.source).toBe("DeGiro account");
  expect(parsed.problems).toEqual([]);
  // The statement itself is the import (#317): no other file is needed.
  expect(parsed.positions).toEqual([]);
  expect(parsed.trades).toHaveLength(4);
  expect(parsed.dividends).toHaveLength(2);
  expect(parsed.cashFlows).toHaveLength(21);
  expect(parsed.cashBalances).toHaveLength(2);
  expect(parsed.cashHistory).toEqual({
    status: "complete",
    from: "2026-01-05",
    to: "2026-03-06",
  });
  expect(parsed.period).toEqual({ from: "2026-01-05", to: "2026-03-06" });
});

test("a transactions export maps to trades but claims no cash history", () => {
  const parsed = parseBrokerFile("Transactions.csv", transactions);
  expect(parsed.profile).toBe("transactions");
  expect(parsed.source).toBe("DeGiro transactions");
  expect(parsed.positions).toEqual([]);
  expect(parsed.trades).toHaveLength(25);
  expect(parsed.dividends).toBeUndefined();
  expect(parsed.cashFlows).toBeUndefined();
  expect(parsed.cashBalances).toBeUndefined();
  // Only the account statement proves cash history; a trade list does not.
  expect(parsed.cashHistory).toMatchObject({ status: "unknown" });
  expect(parsed.period).toEqual({ from: "2022-03-30", to: "2025-02-06" });
  expect(parsed.problems).toEqual([]);
  expect(parsed.sections).toEqual(["trades"]);
});

test("a portfolio export without an export date claims no sections and no rows", () => {
  // The export carries no date column. Without one, the rows are undated and
  // an empty complete positions section would look like "all sold".
  const parsed = parseBrokerFile("Portfolio.csv", portfolio);
  expect(parsed.profile).toBe("portfolio");
  expect(parsed.positions).toEqual([]);
  expect(parsed.trades).toEqual([]);
  expect(parsed.sections).toEqual([]);
  expect(parsed.cashBalances).toBeUndefined();
  expect(parsed.period).toBeUndefined();
  expect(parsed.problems).toHaveLength(1);
  expect(parsed.problems[0]).toMatch(/exportdatum/);
});

test("a portfolio export with an export date maps 12 positions and the cash row", () => {
  const parsed = parseBrokerFile("Portfolio.csv", portfolio, { asOf: "2026-11-12" });

  expect(parsed.profile).toBe("portfolio");
  expect(parsed.source).toBe("DeGiro portfolio");
  expect(parsed.positions).toHaveLength(12);
  expect(parsed.positions[0]).toMatchObject({ symbol: "XS00PF000003", asOf: "2026-11-12" });
  expect(parsed.cashBalances).toEqual([{ currency: "EUR", amount: 201.76, asOf: "2026-11-12" }]);
  expect(parsed.sections).toEqual(["positions", "cashBalances"]);
  expect(parsed.cashHistory).toEqual({
    status: "unknown",
    reason: expect.stringMatching(/portfolio-export bewijst geen cashhistorie/),
  });
  expect(parsed.period).toBeUndefined();
  expect(parsed.problems).toEqual([]);
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
