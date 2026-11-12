# DeGiro import — spec

Status: spec, 2026-11-12. Epic [#329](https://github.com/Elmata2/lavega/issues/329). Supersedes the "Verified for #47/#49" claim in
`CONNECTORS.md` (that claim was wrong, see [Current state](#current-state)).

Goal: a DeGiro user puts their DeGiro exports into LaVega and sees the same
dashboard an IBKR or Trading 212 user sees: positions, trades, dividends, cash,
cash history, returns. No DeGiro login touches LaVega. Decision #25 holds:
file import, no credentials, no automation.

## Current state

- `packages/core/src/parsers/parseBrokerFile.ts` and
  `packages/adapters/src/brokers/degiro/fileImport.ts` exist (#47, #49).
- Nothing in `apps/` imports them. A user cannot reach DeGiro in the product.
- The old #47/#49 fixtures used invented headers (`Date;Time;…;Currency;Order
ID`, semicolon). No real DeGiro export has that shape; D1 deleted them and
  checked in real-format fixtures.
- Run against a real NL account statement (`Rekeningoverzicht`, the file DeGiro
  calls `Account.csv`), the pre-#314 parser returned
  `onbekend of leeg bestand — geen transacties of posities herkend`. D2 (#314)
  replaced that detection: the same file is now named `DeGiro account`. See
  [Reader and detection](#reader-and-detection-d2-314).
- Row mapping is **not** built yet. A recognised file reports one problem naming
  the profile and returns no rows; #315–#319 add the mapping.
- `Transactions.csv` and `Portfolio.csv` shapes were **unverified** until D1.
  They are now verified from real exports of 2026-11-12 (see the two sections
  below), and their headers are the ones D2 matches.

## Verified: the account statement (`Account.csv`)

Observed in three real NL exports (109, 21 and 9 rows). Headers and
description vocabulary only; no amounts are recorded here.

```
Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id
```

- Comma delimiter, quoted fields, optional UTF-8 BOM.
- Dates `DD-MM-YYYY`. Rows are newest first.
- `Mutatie` and `Saldo` label the **currency** column. The amount is in the
  next, unnamed column. Amounts in these files use dot decimals; keep
  comma-decimal support for other locales.
- `Valutadatum` differs from `Datum` on many rows (dividends, interest, fees).
- `Saldo` is the running balance of that row's currency after the row.

Row kinds seen (`#` = number):

| `Omschrijving`                                                 | Product/ISIN | Order Id | Mutatie   | Meaning                                       |
| -------------------------------------------------------------- | ------------ | -------- | --------- | --------------------------------------------- |
| `Koop # @ # EUR` / `Koop # @ # USD`                            | yes          | yes      | yes       | Buy execution: quantity and price in the text |
| `DEGIRO Transactiekosten en/of kosten van derden`              | yes          | yes      | yes       | Commission of that order                      |
| `Valuta Creditering` / `Valuta Debitering`                     | some         | some     | yes       | FX leg. With Order Id: AutoFX of that trade   |
| `Dividend`                                                     | yes          | no       | yes       | Gross dividend (EUR and USD seen)             |
| `Dividendbelasting`                                            | yes          | no       | yes       | Withholding tax on a dividend                 |
| `flatex Storting`, `iDEAL Deposit`                             | no           | no       | yes       | External deposit                              |
| `Reservation iDEAL / Sofort Deposit`                           | no           | no       | yes       | Deposit reservation. May pair with a deposit  |
| `Processed Flatex Withdrawal`, `flatex terugstorting`          | no           | no       | yes       | External withdrawal                           |
| `Degiro Cash Sweep Transfer`                                   | yes (fund)   | no       | yes       | Internal move, broker cash ↔ flatex bank      |
| `Overboeking van/naar uw geldrekening bij flatexDEGIRO Bank …` | no           | no       | **empty** | Information line. No cash moves               |
| `Flatex Interest Income`, `Rente`                              | no           | no       | yes       | Interest (sign decides income or charge)      |
| `DEGIRO Aansluitingskosten # (<exchange>)`                     | no           | no       | yes       | Exchange connection fee                       |

Not seen in the sample and required in D1's fixture: a sell (`Verkoop`), a
corporate action (split, ISIN change, merger), a transfer of shares in or out.
These rows are in the checked-in fixture; they are hand-built, not observed.

## Verified: the transaction export (`Transactions.csv`)

Observed in real NL and EN exports of 2026-11-12 (25 rows each, identical rows,
only the header differs). Headers, byte for byte:

```
Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde EUR,Wisselkoers,AutoFX Kosten,Transactiekosten en/of kosten van derden EUR,Totaal EUR,Order ID
```

```
Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value EUR,Exchange rate,AutoFX Fee,Transaction and/or third party fees EUR,Total EUR,Order ID
```

- Comma delimiter, quoted fields, comma decimals (`"27,0700"`, `"-189,49"`).
- `Koers`/`Price` is followed by an unnamed **price-currency** column; `Lokale
waarde`/`Local value` by an unnamed **local-currency** column. EUR value,
  AutoFX fee and transaction fee are in EUR.
- Rows are newest first. 25 rows, 24 Order Ids: a partial fill shares one
  Order Id.
- The sample holds buys only. A sell row is not verified; #318 must handle it
  from the account statement until one appears in an export.
- `AutoFX Kosten` is present on every row, also when it is `0,00`.

## Verified: the portfolio export (`Portfolio.csv`)

Observed in real NL and EN exports of 2026-11-12 (13 rows each, identical rows).
Headers, byte for byte:

```
Product,Symbool/ISIN,Aantal,Slotkoers,Lokale waarde,,Waarde in EUR
```

```
Product,Symbol/ISIN,Amount,Closing,Local value,,Value in EUR
```

- Comma delimiter, quoted fields, comma decimals.
- The first row is `CASH & CASH FUND & FTX CASH (EUR)` with empty ISIN,
  quantity and closing price: a cash balance, not a position. Confirmed.
- No date column. The export date must be asked for, never invented.
- `Lokale waarde` is followed by an unnamed local-currency column.

## Fixtures (D1, #313)

`packages/core/src/parsers/__fixtures__/degiro/{nl,en}/`

| File                  | Source                            | Rows | Notes                                                                                               |
| --------------------- | --------------------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| `nl/account.csv`      | real 109-row NL account statement | 29   | header byte-identical; sell, partial fill, split, transfer-in and a full AutoFX group added by hand |
| `nl/transactions.csv` | real 25-row NL transaction export | 25   | header byte-identical; partial-fill Order Id kept                                                   |
| `en/transactions.csv` | real 25-row EN transaction export | 25   | same rows; EN header                                                                                |
| `nl/portfolio.csv`    | real 13-row NL portfolio export   | 13   | header byte-identical; cash row kept                                                                |
| `en/portfolio.csv`    | real 13-row EN portfolio export   | 13   | same rows; EN header                                                                                |

Every amount, balance, Order Id, ISIN and product is synthetic. `Saldo` was
recomputed so the walk above holds per currency. `degiroFixtures.test.ts`
asserts the headers, the walk, the row kinds and the internal arithmetic.

## Design

### Reader and detection (D2, #314)

`packages/core/src/parsers/degiro/read.ts` and `profiles.ts`.

- `readCsv(text)` — RFC 4180: comma delimiter, quoted fields with embedded
  commas, embedded newlines and doubled quotes, optional UTF-8 BOM, CRLF / LF /
  CR. Never throws; empty input yields an empty table. `CsvRow.line` is the
  source line the record starts on, so a problem can name its row.
- `detectLocale(table)` — the decimal convention is decided **once per file**,
  never per cell. It only looks at cells outside the free-text columns
  (`Product`, `Omschrijving`, `ISIN`, `Beurs`, …). The account statement writes
  dot decimals while its quoted descriptions hold comma decimals, so a per-cell
  guess reads `Koop 5 @ 19,648 USD` as an amount. Evidence wins, a tie or no
  evidence means `dot`.
- `parseDecimal(raw, locale)` — dot or comma decimals, thousands separators,
  leading minus, `0` preserved; `null` for anything else.
- `parseIsoDate(raw)` / `parseClockTime(raw)` — `DD-MM-YYYY` and `HH:MM` to ISO.
  Impossible calendar dates (`31-02-2026`, `29-02-2023`) give `null`.
  `dateProblems(table, column)` turns those into row-numbered problems
  (`rij 7: onmogelijke datum "31-02-2026"`).
- `currencyAmountAt(header, cells, labelIndex, locale)` — the two adjacent
  columns that hold a currency and its amount, as `{ currency, amount }`. The
  column order differs per export, so the code is found by content, not by
  position:
  - account: `Mutatie` / `Saldo` hold the currency, the unnamed column holds
    the amount;
  - transactions: `Koers` / `Lokale waarde` hold the amount, the unnamed column
    holds the currency;
  - portfolio: `Lokale waarde` holds the currency, the unnamed column holds the
    amount.
- `detectProfile(header)` — exact header signature per profile and language.
  Five signatures are verified: account NL, transactions NL, transactions EN,
  portfolio NL, portfolio EN. An account statement has been observed in NL only,
  so there is deliberately no EN account signature. Unknown header gives
  `{ known: false, problem: "onbekend DeGiro-formaat: <header>" }`. It never
  throws, never guesses, and takes no filename.
- `readDeGiroCsv(text)` — sync, never throws, at most one problem: empty file
  (`leeg bestand — geen DeGiro-export gevonden`), unknown header, or a known
  header with no data row (`DeGiro <profile>-export zonder rijen`).
  `readDeGiro(text)` is the Effect wrapper; it fails with `DeGiroReadError`.
- `parseBrokerFile(filename, text)` delegates to `readDeGiroCsv` and **ignores
  `filename`**. No filename regex is left in the DeGiro path.

### One file set, three profiles

| Profile        | DeGiro export               | Produces                                                    | Status   |
| -------------- | --------------------------- | ----------------------------------------------------------- | -------- |
| `account`      | Rekeningoverzicht / Account | cash flows, dividends, cash balances, trades, cash coverage | verified |
| `transactions` | Transacties / Transactions  | trades (venue, local value, FX rate, commission)            | verified |
| `portfolio`    | Portefeuille / Portfolio    | positions, cash balance                                     | verified |

The account statement is the **primary** import. It alone proves cash history.
Transactions and Portfolio enrich it; neither is required.

Detection is by exact header signature per profile and language (NL, EN). The
filename is never trusted. An unknown header returns a problem naming the
header, never a guess.

### Mapping rules

- **Trade cash stream.** `cashHistory.tradeCash = "cash-flows"`. Trade cash is
  the `Koop`/`Verkoop` ledger row; trades carry no second settlement. Same rule
  as IBKR.
- **Coverage.** Account statement over `[first Datum, last Datum]` →
  `status: "complete"` only if the Saldo walk (below) holds for every currency.
  Otherwise `unknown` with the failing row named.
- **Saldo walk invariant.** The file is newest first: reverse it, never re-sort
  (a trade, its fee and its AutoFX legs share one `Datum`+`Tijd`; file order is
  the only true order). Two kinds of row stay out of the walk:
  - `Degiro Cash Sweep Transfer` moves cash between the DeGiro account and the
    flatex bank; its `Saldo` column reports the flatex-bank leg.
  - a row with an empty `Mutatie` is an information line; no cash moves.

  For the rest, per currency: `Saldo[n] = Saldo[n-1] + Mutatie[n]`. Verified on
  the three real exports (109, 21 and 9 rows): no break, except one row in two
  of the files that differs by €0.01 because the file rounds quantity × price
  to cents. The naive rule, which includes sweeps and information lines, breaks
  on every sweep and information row.

- **Cash flow kinds.** External money only is `deposit`/`withdrawal`. Cash
  sweep, FX legs and flatex transfer lines are `other` with the description.
  Information lines with empty `Mutatie` emit nothing.
- **Trades from the account statement.** Quantity and price parse from
  `Koop|Verkoop|Buy|Sell <qty> @ <price> <ccy>`. `amount` = the row's
  `Mutatie`. `commission` = sum of fee rows with the same Order Id.
  `brokerTradeId` = Order Id. Partial fills share an Order Id; the existing
  occurrence counter in `assignTradeIds` keeps them distinct.
- **Dedupe across files.** When the account statement and `Transactions.csv`
  both carry an Order Id, one trade survives. Transactions supplies venue and
  FX rate; the account row stays the cash stream.
- **Instrument identity.** DeGiro has a product name and an ISIN, no ticker.
  `Position.symbol` and `Trade.symbol` = ISIN; product name goes in a display
  field. A product rename then cannot break joins. Prices resolve through the
  OpenFIGI ISIN path that Trading 212 already uses.
- **Portfolio cash row.** A `CASH & CASH FUND …` row (if D1 confirms it) is a
  `CashBalance`, not a position.
- **Position `asOf`.** The portfolio export carries no date (confirmed 2026-11-12).
  The upload form asks for the export date, default today. Never invent one
  silently.

### Re-import

Users export overlapping windows (the sample machine already has three
overlapping account files). A re-import must not append duplicates.

- `brokerSnapshot.windowPeriod` returns a period only for `ibkr`. Extend it to
  `degiro`: a complete account statement replaces stored rows inside
  `[first Datum, last Datum]` and keeps rows outside it, via `replaceWindow`.
- Importing the same file twice leaves the snapshot byte-identical.

### Server and web

- Broker ids come from one list with capabilities (`BROKERS` in
  `packages/core/src/investing/brokers.ts`): `credentials`, `scheduled`,
  `fileImport`. `SCHEDULED_BROKERS`, `CredentialBroker`, `BrokerDataSnapshot`
  keys, readability maps and labels derive from it, so `degiro` is absent from
  the scheduled-sync set and the credential APIs by construction (#320).
- Upload route: tenant-bound, Effect 4, multipart, up to three files, total
  under 4.5 MB (Vercel body limit). Dry run returns a preview; commit writes the
  encrypted snapshot under the broker lease and invalidates the dashboard
  cache. The raw file is never stored; only parsed rows and a SHA-256 per file.
- Web: a DeGiro tab in broker settings with export steps, multi-file drop,
  preview, confirm. Status reads "Last imported <date>, covers <from>–<to>",
  not fresh/stale/never.

### Out of scope

- DeGiro login, session reuse, scheduled sync, browser automation (#25, #33).
- A browser-extension export helper. Tracked as a separate decision (D16); not
  blocking.

### Privacy

Fixtures and issue bodies hold headers and description vocabulary only. No
real amounts, balances, Order Ids or holdings. Sanitized fixtures replace every
number and keep the Saldo walk consistent.

## Issues

| ID                                                       | Title                                                       | Blocked by    |
| -------------------------------------------------------- | ----------------------------------------------------------- | ------------- |
| D1 [#313](https://github.com/Elmata2/lavega/issues/313)  | Real-format DeGiro fixtures (sanitized)                     | —             |
| D2 [#314](https://github.com/Elmata2/lavega/issues/314)  | DeGiro CSV reader + header-signature profile detection      | D1 (account)  |
| D3 [#315](https://github.com/Elmata2/lavega/issues/315)  | Account statement → cash flows + Saldo walk invariant       | D2            |
| D4 [#316](https://github.com/Elmata2/lavega/issues/316)  | Account statement → dividends and withholding tax           | D2            |
| D5 [#317](https://github.com/Elmata2/lavega/issues/317)  | Account statement → trades, commissions, balances, coverage | D3, D4        |
| D6 [#318](https://github.com/Elmata2/lavega/issues/318)  | Transactions export → trades, deduped by Order Id           | D1, D5        |
| D7 [#319](https://github.com/Elmata2/lavega/issues/319)  | Portfolio export → positions and cash balance               | D1, D2        |
| D8 [#320](https://github.com/Elmata2/lavega/issues/320)  | One broker list with capabilities; add `degiro`             | —             |
| D9 [#321](https://github.com/Elmata2/lavega/issues/321)  | Snapshot window replace for DeGiro re-imports               | D5, D8        |
| D10 [#322](https://github.com/Elmata2/lavega/issues/322) | ISIN as DeGiro instrument identity + price resolution       | D5            |
| D11 [#323](https://github.com/Elmata2/lavega/issues/323) | Upload route: dry run + commit                              | D8, D9        |
| D12 [#324](https://github.com/Elmata2/lavega/issues/324) | Web: DeGiro import tab                                      | D11           |
| D13 [#325](https://github.com/Elmata2/lavega/issues/325) | Import age and stale-data problem                           | D11           |
| D14 [#326](https://github.com/Elmata2/lavega/issues/326) | Quantity and cash reconciliation problems                   | D6, D7        |
| D15 [#327](https://github.com/Elmata2/lavega/issues/327) | Live verification + docs close-out                          | D12, D13, D14 |
| D16 [#328](https://github.com/Elmata2/lavega/issues/328) | Decision: extension export helper (optional)                | D15           |

Order: D1 and D8 start in parallel. D2 → D3/D4 → D5 is the critical path.

Landed: D1 (#313, fixtures), D8 (#320, one broker list), D2 (#314, reader and
header-signature detection).
