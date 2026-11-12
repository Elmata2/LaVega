import { expect, test } from "vitest";
import { createDeGiroFileImport } from "./fileImport.js";

/* The rows this adapter hands to the snapshot come from `parseBrokerFile`, which
 * since #314 delegates to `packages/core/src/parsers/degiro/` and only *names*
 * the profile. The row mapping lands in #315–#319.
 *
 * The invented semicolon fixtures that used to live here (`Date;Product;…;
 * Currency;Order ID`) described a shape no DeGiro export produces. #313 deleted
 * them from core, so they are gone here too, together with the trade and position
 * stamping assertions that hung off them. Those assertions return with the mapping
 * in #318/#319.
 *
 * This adapter's own contract, asserted below: pass the core problems through,
 * derive each section's status from them, and never throw.
 */

const ACCOUNT_HEADER =
  "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id";

test("DeGiro file import passes the profile names and problems through", async () => {
  const text = [
    ACCOUNT_HEADER,
    "06-03-2026,09:00,06-03-2026,,,iDEAL Deposit,,EUR,21.76,EUR,1467.64,",
    "05-03-2026,09:00,05-03-2026,,,flatex Storting,,EUR,101.76,EUR,1445.88,",
  ].join("\n");

  const result = await createDeGiroFileImport().load({
    filename: "Account.csv",
    text,
    entity: "BV1",
  });

  expect(result.source).toBe("DeGiro account");
  expect(result.problems).toEqual([
    "DeGiro account-export herkend, maar nog niet uitgelezen: de rij-mapping volgt in #315–#319",
  ]);
  expect(result.sections.positions).toEqual({ status: "partial", rows: [] });
  expect(result.sections.trades).toEqual({ status: "partial", rows: [] });
});

test("DeGiro file import returns problems for empty input and never throws", async () => {
  const result = await createDeGiroFileImport().load({
    filename: "empty.csv",
    text: "",
    entity: "BV1",
  });

  expect(result.source).toBe("");
  expect(result.problems).toHaveLength(1);
  expect(result.sections.positions.rows).toEqual([]);
  expect(result.sections.trades.rows).toEqual([]);
});

test("DeGiro file import reports an unknown header instead of guessing", async () => {
  const result = await createDeGiroFileImport().load({
    filename: "portfolio.csv",
    text: "Product;ISIN;Symbol;Amount;Price;Value;Currency;Date\nETF;IE00TEST;VUAA;2;10;20;EUR;2026-08-18",
    entity: "BV2",
  });

  // The filename says portfolio; only the header may decide, and it does not match.
  expect(result.source).toBe("");
  expect(result.problems).toEqual([
    "onbekend DeGiro-formaat: Product;ISIN;Symbol;Amount;Price;Value;Currency;Date",
  ]);
  expect(result.sections.positions.rows).toEqual([]);
  expect(result.sections.trades.rows).toEqual([]);
});
