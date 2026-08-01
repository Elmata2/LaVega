import { expect, test } from "vitest";
import { parseBankCsv } from "./bankCsv.js";
import { parseIngCsv } from "./csv.js";

/* --- ING: fold-in regression — parseBankCsv must produce the exact same txs
 * as the standalone parseIngCsv wrapper for the same ING fixture. --- */
const ING = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"Boodschappen"
"20260103";"Salaris";"NL01INGB0001";"NL99";"OV";"Bij";"2.500,00";"Overschrijving";"Loon"`;

test("ING: parseBankCsv detects the ING profile and matches parseIngCsv's txs (accountKey aside)", () => {
  const engineResult = parseBankCsv(ING, "NL01INGB0001");
  const wrapperTxs = parseIngCsv(ING, "NL01INGB0001");

  expect(engineResult.profile).toBe("ING");
  expect(engineResult.txs).toHaveLength(2);
  expect(wrapperTxs).toHaveLength(2);

  // Byte-identical field-by-field (both were tagged with the same accountKey here,
  // since the CSV's own "Rekening" column also happens to be NL01INGB0001).
  expect(engineResult.txs).toEqual(wrapperTxs);
  expect(wrapperTxs[0]).toMatchObject({ date: "2026-01-02", amount: -12.34, counterparty: "Albert Heijn", accountKey: "NL01INGB0001" });
  expect(wrapperTxs[1]).toMatchObject({ date: "2026-01-03", amount: 2500, counterparty: "Salaris" });
});

test("ING: parseIngCsv always tags txs with the caller-supplied accountKey, even if the CSV's Rekening column differs", () => {
  const OTHER_ACCOUNT = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL99DIFFERENT";"";"BA";"Af";"12,34";"Betaalautomaat";"Boodschappen"`;
  const txs = parseIngCsv(OTHER_ACCOUNT, "NL01INGB0001");
  expect(txs).toHaveLength(1);
  expect(txs[0].accountKey).toBe("NL01INGB0001");
});

/* --- Rabobank: comma-delimited, quoted, Dutch thousands-separator amount. --- */
const RABOBANK = `"IBAN/BBAN","Munt","BIC","Volgnr","Datum","Rentedatum","Bedrag","Saldo na trn","Tegenrekening IBAN/BBAN","Naam tegenpartij","Naam uiteindelijke partij","Naam initierende partij","BIC tegenpartij","Code","Batch ID","Transactiereferentie","Machtigingskenmerk","Incassant ID","Betalingskenmerk","Omschrijving-1","Omschrijving-2","Omschrijving-3","Reden retour","Oorspronkelijk bedrag","Oorspronkelijke munt","Koers"
"NL39RABO0300065264","EUR","RABONL2U","1","20260105","20260105","-45,00","1000,00","NL12ABNA0123456789","Albert Heijn","","","ABNANL2A","BA","","","","","","Boodschappen","","","","","",""
"NL39RABO0300065264","EUR","RABONL2U","2","20260106","20260106","1.234,56","2234,56","NL99INGB0009876543","Werkgever BV","","","INGBNL2A","OV","","","","","","Salaris januari","","","","","",""`;

test("Rabobank: profile detected, ISO dates, signed amounts (incl. thousands separator), IBAN account key", () => {
  const result = parseBankCsv(RABOBANK, "fallback");
  expect(result.profile).toBe("Rabobank");
  expect(result.txs).toHaveLength(2);

  expect(result.txs[0]).toMatchObject({
    date: "2026-01-05",
    amount: -45,
    counterparty: "Albert Heijn",
    description: "Boodschappen",
    currency: "EUR",
    accountKey: "NL39RABO0300065264",
  });
  expect(result.txs[1]).toMatchObject({
    date: "2026-01-06",
    amount: 1234.56,
    counterparty: "Werkgever BV",
    description: "Salaris januari",
  });

  expect(result.accounts).toHaveLength(1);
  expect(result.accounts[0]).toMatchObject({ key: "NL39RABO0300065264", iban: "NL39RABO0300065264", bank: "Rabobank", balance: null });
});

/* --- Knab: semicolon-delimited, CreditDebet column drives the sign. --- */
const KNAB = `Rekeningnummer;Transactiedatum;Valutadatum;CreditDebet;Bedrag;Tegenrekeningnummer;Tegenrekeninghouder;Valuta;Omschrijving
NL55KNAB0123456789;20260110;20260110;D;75,50;NL22RABO0123456789;Coolblue B.V.;EUR;Aankoop laptop
NL55KNAB0123456789;20260111;20260111;C;500,00;NL33ABNA0123456789;Klant X;EUR;Factuur 123`;

test("Knab: profile detected, CreditDebet drives sign (D=outflow, C=inflow)", () => {
  const result = parseBankCsv(KNAB, "fallback");
  expect(result.profile).toBe("Knab");
  expect(result.txs).toHaveLength(2);

  expect(result.txs[0]).toMatchObject({
    date: "2026-01-10", amount: -75.5, counterparty: "Coolblue B.V.", description: "Aankoop laptop", accountKey: "NL55KNAB0123456789",
  });
  expect(result.txs[1]).toMatchObject({ date: "2026-01-11", amount: 500, counterparty: "Klant X" });
});

/* --- Revolut: comma-delimited, amount already signed, "Product" as pseudo-account,
 * fee column present (0.00 -> no-op). --- */
const REVOLUT = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-01-12 10:00:00,2026-01-12 10:00:05,Coffee Shop,-4.50,0.00,EUR,COMPLETED,995.50
TOPUP,Current,2026-01-13 09:00:00,2026-01-13 09:00:10,Bank Transfer,250.00,0.00,EUR,COMPLETED,1245.50`;

test("Revolut: profile detected, dates truncate the time portion, amount sign passes through, fallback account key used (Product isn't an IBAN)", () => {
  const result = parseBankCsv(REVOLUT, "REVOLUT-FALLBACK");
  expect(result.profile).toBe("Revolut");
  expect(result.txs).toHaveLength(2);

  expect(result.txs[0]).toMatchObject({ date: "2026-01-12", amount: -4.5, counterparty: "Coffee Shop", currency: "EUR" });
  expect(result.txs[1]).toMatchObject({ date: "2026-01-13", amount: 250, counterparty: "Bank Transfer" });
  // "Product" column value is "Current", not an IBAN -> falls back to the caller's fallback key.
  expect(result.txs[0].accountKey).toBe("Current");
});

/* --- American Express: comma-delimited, DD/MM/YYYY dates, flip:true inverts
 * every amount (Amex represents charges as positive, credits/payments as
 * negative — the opposite of our "negative = outflow" convention). No acc
 * column -> falls back to the caller-supplied key. --- */
const AMEX = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
12/01/2026,RESTAURANT DE KROON AMSTERDAM,A STEUNENBERG,-12345,45.00,RESTAURANT DE KROON,Dining
13/01/2026,PAYMENT RECEIVED - THANK YOU,A STEUNENBERG,-12345,-500.00,PAYMENT RECEIVED,Payment`;

test("American Express: profile detected, flip inverts sign both ways (positive charge -> negative outflow; negative payment -> positive inflow)", () => {
  const result = parseBankCsv(AMEX, "AMEX-12345");
  expect(result.profile).toBe("American Express");
  expect(result.txs).toHaveLength(2);

  expect(result.txs[0]).toMatchObject({
    date: "2026-01-12", amount: -45, counterparty: "RESTAURANT DE KROON AMSTERDAM", description: "RESTAURANT DE KROON", accountKey: "AMEX-12345",
  });
  expect(result.txs[1]).toMatchObject({ date: "2026-01-13", amount: 500, counterparty: "PAYMENT RECEIVED - THANK YOU" });
});

/* --- Trading 212: comma-delimited, cashOnly:true keeps only cash-movement
 * actions (deposit/withdraw/dividend/interest); trade actions (e.g. "Market
 * buy") are filtered out entirely. --- */
const TRADING212 = `Action,Time,ISIN,Ticker,Name,Notes,ID,Currency (Total),Total
Deposit,2026-01-14 08:00:00,,,,,,EUR,1000.00
Market buy,2026-01-14 09:00:00,US0378331005,AAPL,Apple Inc,,tx1,EUR,-500.00
Dividend,2026-01-20 12:00:00,US0378331005,AAPL,Apple Inc,,tx2,EUR,4.25
Withdrawal,2026-01-25 10:00:00,,,,,,EUR,-200.00`;

test("Trading 212: cash-only filter keeps deposit/dividend/withdrawal, drops trade actions", () => {
  const result = parseBankCsv(TRADING212, "TRADING212-FALLBACK");
  expect(result.profile).toBe("Trading 212");
  expect(result.txs).toHaveLength(3);

  const actions = result.txs.map((t) => t.description);
  expect(actions).toEqual(["Deposit", "Dividend", "Withdrawal"]);
  expect(result.txs[0].amount).toBe(1000);
  expect(result.txs[1].amount).toBe(4.25);
  expect(result.txs[2].amount).toBe(-200);
});

/* --- ABN AMRO: TAB-delimited, no header, 8 columns; carries a closing balance
 * (last row wins, matching the reference's per-row overwrite). --- */
const ABN =
  "0123456789\tEUR\t20260115\t20260115\t1500.00\t1250.00\t-250.00\tBEA, Betaalpas, ALBERT HEIJN 1234, PAS123, 15.01.2026/10:15\n" +
  "0123456789\tEUR\t20260116\t20260116\t1250.00\t1750.00\t500.00\tSEPA Overboeking, IBAN: NL12ABNA0123456789, Naam: Werkgever BV, Omschrijving: Salaris";

test("ABN AMRO: TAB/no-header detected, dates ISO, signed amounts, closing balance on the account", () => {
  const result = parseBankCsv(ABN, "fallback");
  expect(result.profile).toBe("ABN AMRO");
  expect(result.txs).toHaveLength(2);

  expect(result.txs[0]).toMatchObject({ date: "2026-01-15", amount: -250, currency: "EUR", accountKey: "0123456789", counterparty: "ALBERT HEIJN 1234" });
  expect(result.txs[1]).toMatchObject({ date: "2026-01-16", amount: 500, accountKey: "0123456789" });
  expect(result.txs[1].counterparty).toContain("Werkgever BV");

  expect(result.accounts).toHaveLength(1);
  expect(result.accounts[0].bank).toBe("ABN AMRO");
  // Closing balance = the last row's balance-after column (real number, not null).
  expect(result.accounts[0].balance).toBe(1750);
});
