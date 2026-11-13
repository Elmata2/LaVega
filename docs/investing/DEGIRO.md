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
- The account statement maps to the whole import result: cash flows with the
  `Saldo` walk (D3, #315), dividends (D4, #316) and trades, cash balances,
  coverage and period (D5, #317). `parseBrokerFile` maps the `account` profile
  and `createDeGiroFileImport` stamps entity/broker into a full `BrokerResult`.
  See [Account statement → trades, balances, coverage](#account-statement--trades-balances-coverage-d5-317).
- The transaction export maps to trades and merges with the account statement
  by execution (#318, D6). The portfolio export maps to dated positions and its
  cash row (#319, D7). `parseBrokerFiles` is the multi-file seam; neither export
  proves cash history on its own. The upload route (#323) calls the seam; the
  DeGiro tab (#324) is the remaining path to a user.
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

| File                          | Source                                 | Rows | Notes                                                                                                                |
| ----------------------------- | -------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------- |
| `nl/account.csv`              | real 109-row NL account statement      | 29   | header byte-identical; sell, partial fill, split, transfer-in and a full AutoFX group added by hand                  |
| `nl/transactions.csv`         | real 25-row NL transaction export      | 25   | header byte-identical; partial-fill Order Id kept                                                                    |
| `en/transactions.csv`         | real 25-row EN transaction export      | 25   | same rows; EN header                                                                                                 |
| `nl/transactions-overlap.csv` | hand-built against the account fixture | 4    | header byte-identical to `nl/transactions.csv`; every execution overlaps `nl/account.csv` by Order Id + Datum + Tijd |
| `nl/portfolio.csv`            | real 13-row NL portfolio export        | 13   | header byte-identical; cash row kept                                                                                 |
| `en/portfolio.csv`            | real 13-row EN portfolio export        | 13   | same rows; EN header                                                                                                 |

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

### Account statement → cash flows (D3, #315)

`packages/core/src/parsers/degiro/account.ts`, `classify.ts`, `saldo.ts`.

`readAccountStatement(text)` returns `{ cashFlows, counts, saldo, problems }` and
never throws. It first classifies every data row into exactly one bucket, so no
row is dropped and no row is counted twice:

| Bucket      | Rows                                                                                           | Owner      |
| ----------- | ---------------------------------------------------------------------------------------------- | ---------- |
| `cash-flow` | external money, interest, fees, FX legs without an Order Id, iDEAL reservations, unknown text  | this issue |
| `dividend`  | `Dividend`, `Dividendbelasting`                                                                | #316       |
| `trade`     | executions, their `DEGIRO Transactiekosten…` rows, and `Valuta …` AutoFX legs with an Order Id | #317       |
| `skipped`   | information lines and corporate actions (empty `Mutatie`), and the cash sweep                  | —          |

`counts` sums to the number of data rows; the fixture gives 11 / 3 / 10 / 5 for
29 rows. An unrecognised description still becomes a cash flow of kind `other`
and adds a problem naming the text — it is never dropped.

Cash-flow kinds follow the spec: external money only is `deposit` /
`withdrawal`; interest keeps the signed `Mutatie`; `DEGIRO Aansluitingskosten`
and a commission row without an Order Id are `fee`; FX legs without an Order Id
and the iDEAL reservations are `other` with their description. Ids are the same
content hash the IBKR and Trading 212 paths use
(`degiro-cash-flow | date | currency | amount | kind | description`, plus an
occurrence counter for identical rows), so re-parsing the same file yields the
same ids and a merge cannot append duplicates.

**Cash sweep correction (D5).** #315 first emitted the `Degiro Cash Sweep
Transfer` row as a cash flow of kind `other`. D5's end-to-end walk (#317) proves
that wrong: the sweep's `Saldo` reports the flatex-bank leg, so the -23.24 in the
fixture never belonged to the balance the account's `Saldo` column shows.
Emitting it as a `CashFlow` makes core's date-based cash walk wrong on every date
before the row (the walk sums the events it is given). The row is now classified
`skip`: no flow, no balance anchor, still counted in `counts.skipped`. The Saldo
walk already ignored it; only the emitted flow changed.

**Reservation finding (the open question in #315).** `Reservation iDEAL /
Sofort Deposit` rows do _not_ double move cash with a later `iDEAL Deposit`.
Evidence: the Saldo walk holds on the fixture **with** both reservation rows
included, so each one moves real cash and dropping them would break the walk.
Their magnitudes are not a mirror pair of one deposit either — the fixture has
+76,76 and later −73,24 while the real `iDEAL Deposit` is a separate +21,76 row.
Conclusion: a reservation is a reservation leg, not external money arriving. It
is `other` with its description and **never** `deposit`, so counting deposits in
`flatex Storting` / `iDEAL Deposit` alone cannot double count. Encoded in
`classify.test.ts` and `account.test.ts`.

### Account statement → dividends (D4, #316)

`packages/core/src/parsers/degiro/dividends.ts`. `readAccountDividends(text)`
returns `{ dividends, counts, problems }` and never throws. It reuses
`classify.ts`, where `dividendKind` separates a gross `Dividend` row from a
`Dividendbelasting` (NL) or `Dividend tax` (EN) row.

- **Pairing.** A tax row carries no Order Id, so the only link is ISIN +
  currency + `Valutadatum`. The tax amounts are summed per that key first, then
  each gross row carries its key's tax; file order cannot orphan a pair.
- **Amounts.** `Dividend.amount` is the cash the pair moved, so the withholding
  is already netted out. `Dividend.withholdingTax` carries the tax itself:
  positive when the broker withheld it, negative when the statement refunded one.
  Gross = `amount + withholdingTax`. The field is absent when the statement holds
  no tax row; zero and absent are different facts. No conversion happens here.
- **Date.** `Dividend.date` is `Datum`, the booking date the `Saldo` walk books
  the cash on; `Valutadatum` is only the pairing key, with `Datum` as its
  fallback. D5's end-to-end walk (#317) proves the booking date: core sums cash
  events on their own dates, so a value-dated dividend misses the fixture
  `Saldo` at every date between the two (the USD dividend is booked 07-01 and
  value-dated 09-01, with the 08-01 FX debit in between).
- **Corrections.** A negative `Dividend` row is a correction, never a second
  dividend. It nets into the most recent dividend for the same ISIN and currency,
  its own tax refund included, and adds no row.
- **Unmatched rows.** A tax row without a gross row is still emitted as a
  dividend, with a problem naming its line. So is a correction with no original.
  Nothing is dropped silently. `counts` gives `grossRows`, `taxRows`,
  `corrections` and `unmatched`.
- **Not cash flows.** A dividend and its tax emit no `CashFlow`; the Saldo walk
  already counts their cash. Same rule as IBKR.
- **Identity.** The id is the content hash of the origin `Dividend` row
  (`degiro-dividend | date | currency | gross | symbol | description`, plus an
  occurrence counter for identical rows), so a re-parse yields the same ids. A
  correction in a newer file changes the amount, not the id, so a merge replaces
  that row instead of appending one.

**Why `amount` is net and not gross** (a deliberate deviation from the issue
text). The core cash walk files every dividend as a cash event in its wallet
(`portfolio.ts`). A gross `amount` there would add the withholding as cash that
never arrived, because DeGiro emits no tax cash flow to cancel it. Trading 212
already reports a net amount; IBKR keeps gross because it books the tax as its
own fee flow. So `amount` keeps its cash meaning and gross stays derivable as
`amount + withholdingTax`. Income surfaces sum `amount` unchanged, so a DeGiro
dividend appears there at its net cash, where IBKR fills the same field from its
gross row.

### Account statement → trades, balances, coverage (D5, #317)

`packages/core/src/parsers/degiro/trades.ts` and `accountProfile.ts`.

`readDeGiroAccount(text)` is the whole account import. It reuses
`readAccountStatement`, `readAccountDividends` and `readAccountTrades`, joins
their ledger rows under one id counter, and returns
`{ trades, cashFlows, dividends, cashBalances, coverage, period, problems }`.
`parseBrokerFile` maps the `account` profile to it, and
`createDeGiroFileImport` stamps `entity` and `broker` and returns a full
`BrokerResult`: the statement alone is enough for a DeGiro user.

- **Trade rows are ledger rows.** `cashHistory.tradeCash = "cash-flows"`, so a
  trade's cash is the statement row, never a `Trade.settlement`. Every
  trade-bucket row becomes one `CashFlow`: the execution row (kind `other`), its
  commission row (kind `fee`) and the AutoFX legs (kind `other`).
  `brokerFlowId` carries the Order Id on the two AutoFX legs only: core's cash
  walk dedupes flows by `(entity, broker, currency, brokerFlowId ?? id)`, so
  stamping the shared Order Id on an execution and its fee would collapse two
  same-currency events into one and under-count the cash.
- **Trades.** `Koop|Verkoop|Buy|Sell <qty> @ <price> <ccy>` parses from
  `Omschrijving`. Numbers in that free-text column are locale-free: the last
  separator that appears is the decimal one, so `19,648` and `1.234,56` both
  parse. `side` comes from the verb, never from the sign; `amount` is the signed
  `Mutatie`; `brokerTradeId` is the Order Id; `symbol` is the ISIN (per #322),
  with the product name only as a no-ISIN fallback plus a problem.
  `executionAt` carries `Datum`+`Tijd`.
- **Commission groups by Order Id + `Datum` + `Tijd`.** A trade, its fee and its
  AutoFX legs share all three; partial fills share the Order Id but each has its
  own time and its own fee row. Summing a whole Order Id would bill every fill
  for every fee (the fixture's two fills would each report 1.42 instead of
  0.71). An execution with no fee row in its group reports 0; a fee row with no
  execution stays a cash flow and adds a problem.
- **Cash balances** are the statement's own anchors: the latest `Saldo` per
  currency, `asOf` = that row's `Datum`. Only rows that take part in the Saldo
  walk can anchor (the sweep row's `Saldo` is the flatex-bank leg).
- **Coverage** is `{ tradeCash: "cash-flows", status: "complete", from, to }`
  when the Saldo walk holds for every row and the file has a period; otherwise
  `unknown` with `reason` = the first walk problem, which names the row. Rows
  are still returned: a broken walk withholds the claim, not the data.
  `period` is min/max `Datum`, set only when a date parsed.
- **Adapter statuses.** A section the file read is `complete` when the parse had
  no problem, else `partial`; a section the file does not read (positions for
  the account statement, every section of the still-unmapped transactions and
  portfolio profiles) is `unavailable`. Reporting an empty section as `complete`
  would tell the snapshot the broker reported nothing and wipe stored rows.
- **Snapshot trade identity.** `brokerSnapshot` re-ids trades as
  `<broker>:<brokerTradeId>`. A broker trade id names the order, not the
  execution, so repeated ids (the partial fills of one Order Id) get an
  occurrence suffix on the second and later rows: 4 rows, 4 ids, and the first
  fill keeps the bare id. Same file re-imports do not renumber; an appended
  older window adds rows after the ones already seen.

Fixture result: 4 trades (a sell, a USD buy with AutoFX and fee, and two fills
of one Order Id), 21 cash flows (11 statement rows + 10 trade rows), 2
dividends, balances EUR 1467.64 @ 2026-03-06 and USD 0.00 @ 2026-01-16, coverage
complete 2026-01-05..2026-03-06. `accountProfile.test.ts` drives core's own
`computePortfolioValueSeries` per currency and matches the fixture `Saldo` at
every date. Both the dividend booking date and the sweep skip are load-bearing
for that test: reverting either makes it fail.

| Profile        | DeGiro export               | Produces                                                    | Status                         |
| -------------- | --------------------------- | ----------------------------------------------------------- | ------------------------------ |
| `account`      | Rekeningoverzicht / Account | cash flows, dividends, cash balances, trades, cash coverage | mapped (D3–D5); transport #323 |
| `transactions` | Transacties / Transactions  | trades (venue, local value, FX rate, commission)            | mapped (D6); transport #323    |
| `portfolio`    | Portefeuille / Portfolio    | positions (ISIN key), cash balance                          | mapped (D7); transport #323    |

The account statement is the **primary** import. It alone proves cash history.
Transactions and Portfolio enrich it; neither is required.

Detection is by exact header signature per profile and language (NL, EN). The
filename is never trusted. An unknown header returns a problem naming the
header, never a guess.

### Transactions export → trades (D6, #318)

`packages/core/src/parsers/degiro/transactions.ts` and `merge.ts`.

`readDeGiroTransactions(text)` reads the 17-column export into trades and never
throws. The verified NL and EN headers have identical column order, so one fixed
table serves both: date 0, time 1, product 2, ISIN 3, reference exchange 4, venue
5, quantity 6, price 7, local value 9, EUR value 11, FX rate 12, AutoFX fee 13,
transaction fee 14, total EUR 15, Order Id 16. Two money fields are a label plus
its blank neighbour: `Koers`/`Price` holds the amount and the blank column holds
its currency; `Lokale waarde`/`Local value` is the same pair.

- **Side from the cash sign.** The export has no verb. A negative local value is
  a buy and a positive one a sell; zero is not a trade. The verified sample holds
  buys only, so a real sell row is still unverified.
- **Amount and currency** are the signed local value and its own currency, never
  the EUR value. `price` is the magnitude of `Koers`.
- **Venue and FX rate** are provenance only: `venue` is `Uitvoeringsplaats` when
  non-empty, `fxRate` is `Wisselkoers` when it parses. Neither changes a
  valuation.
- **Commission** is the absolute transaction fee only. `AutoFX Kosten` is a
  currency conversion the account statement books as its own ledger legs; folding
  it in would make `commission` mean two things for one trade.
- **Zero-price guard.** A row with a quantity but no price (or price 0) is a
  corporate action or a share transfer, not a trade. It is skipped with a problem
  and belongs to #326.
- **No settlement.** A transaction trade carries no `settlement`; trade cash is
  always the account ledger row.
- **Coverage stays unknown.** A trade list proves no cash history: `cashHistory`
  is `unknown` with a reason that names the missing account statement. Only the
  account statement can claim a window.

`parseBrokerFiles(files)` is the multi-file seam the upload route (#323) calls.
It parses every file
with `parseBrokerFile` and, when an import holds more than one, hands them to
`mergeDeGiroFiles`. The first account statement and the first transaction export
are the import; extra files, unknown headers and portfolio exports contribute
their problems only, and with more than one file every problem is prefixed with
its filename.

Dedupe is by execution, not by Order Id alone: `(Order Id, Datum, Tijd)`, the
same key the account reader groups a trade, its commission and its AutoFX rows
under. One transaction row consumes one account row, and only when `side` and
`quantity` agree.

| Field after a match                                                                          | Source                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| date, executionAt, amount, currency, commission, quantity, side, brokerTradeId, symbol, isin | account statement                                                         |
| price                                                                                        | transactions export                                                       |
| venue, fxRate                                                                                | transactions export                                                       |
| description                                                                                  | account statement; transactions export only when the account row has none |

A side or quantity disagreement keeps both rows and reports one problem naming
the Order Id and both quantities. A transactions Order Id seen in the account
under another execution is appended with a problem. A trade without an Order Id
never merges and is appended silently. Cash flows and dividends come from the
account statement only; positions come from the portfolio export (D7).

### Portfolio export → positions and cash balance (D7, #319)

`packages/core/src/parsers/degiro/portfolio.ts`.

`readDeGiroPortfolio(text, asOf)` reads the 7-column export into positions and
balances and never throws. The verified NL and EN headers have the same column
order: product 0, ISIN 1, quantity 2, closing 3, local value 4 and its unnamed
neighbour 5, EUR value 6. `Lokale waarde` labels the currency and the blank
neighbour holds the amount, the opposite pairing from the transaction export, so
`currencyAmountAt` finds the pair by the blank header.

- **`asOf` is an input, never a guess.** The export has no date column, so the
  reader takes the export date as a required argument and validates it as an ISO
  `YYYY-MM-DD` calendar date. Missing or malformed input yields zero rows and one
  problem; no row is ever written with an invented date.
- **Identity.** `symbol` and `isin` are the ISIN and `description` is the product
  name, so a product rename cannot split one holding into two. A position without
  an ISIN is skipped with a row-numbered problem; no symbol is invented.
- **Cost stays unknown.** The export carries a closing price, not a cost basis.
  `averagePrice` is `null` and `brokerCost` is `unknown`/`not-reported`. Nothing
  is derived from quantity × price.
- **Values from the export.** `quantity` is `Aantal`/`Amount`, `marketPrice` is
  `Slotkoers`/`Closing`, `marketValue` is the local value, and `currency` is the
  local currency. The EUR value column is not used: the position keeps the
  currency it was quoted in.
- **The cash row is a balance.** A product name that starts with
  `CASH & CASH FUND` becomes a `CashBalance` dated with `asOf`. It is never a
  position: it carries no ISIN or quantity, and booking it as one would invent an
  identity-less holding.
- **Empty positions are a real answer.** With a valid date, a portfolio whose
  holdings are all sold reads as zero positions and is complete. A header-only
  file is not an import and reports `geen posities` instead of an empty result.
- **Sections.** A dated portfolio read owns `positions` and, when the cash row
  was read, `cashBalances`. An undated or header-only file owns neither: an empty
  complete section would tell the snapshot the broker reported nothing and wipe
  stored rows. The export proves no cash history, so coverage is `unknown`.

Fixture result: 12 positions keyed by ISIN (USD and EUR) and one EUR 201.76 cash
balance, all dated 2026-11-12. `portfolio.test.ts` pins three positions exactly,
the ISIN identity and the cash row.

Multi-file precedence (`mergeDeGiroFiles`): the first portfolio export supplies
the positions, and the account statement's `Saldo` anchors win the cash balances
when it read them; the portfolio cash row stands in otherwise. The account
statement stays the cash truth, the transaction export only enriches executions,
and the portfolio export supplies holdings. A merged source reads
`DeGiro account + transactions + portfolio`.

The parser owns which sections it read: account = `trades`, `dividends`,
`cashFlows`, `cashBalances`; transactions = `trades`; portfolio = `positions` and
`cashBalances` when the export date was supplied and the file was read. The
adapter reports a listed section `complete`, or `partial` when the parse had a
problem, and an unlisted section `unavailable` with no rows. An empty `complete`
section would tell the snapshot the broker reported nothing and wipe stored rows.

### Mapping rules

- **Trade cash stream.** `cashHistory.tradeCash = "cash-flows"`. Trade cash is
  the execution ledger row, emitted as a `CashFlow`; trades carry no second
  settlement. Same rule as IBKR.
- **Trades from the account statement.** Quantity and price come from
  `Koop|Verkoop|Buy|Sell <qty> @ <price> <ccy>` in `Omschrijving`; `amount` is
  the row's `Mutatie`; `side` from the verb, never the sign; `commission` is the
  sum of the fee rows in the same `Order Id`+`Datum`+`Tijd` group;
  `brokerTradeId` is the Order Id. Every trade-bucket row is also a `CashFlow`
  (execution `other`, commission `fee`, AutoFX `other` with `brokerFlowId` = the
  Order Id). Partial fills share an Order Id and stay distinct trades.
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

- **Cash flow kinds.** External money only is `deposit`/`withdrawal`. FX legs
  and flatex transfer lines are `other` with the description. The cash sweep is
  not emitted at all (its `Saldo` is the flatex-bank leg). Information lines
  with an empty `Mutatie` emit nothing.
- **Dedupe across files.** One transaction row consumes one account row only
  when `(Order Id, Datum, Tijd)` matches and `side` and `quantity` agree.
  Transactions supplies venue and FX rate; the account row stays the cash stream.
- **Instrument identity.** DeGiro has a product name and an ISIN, no ticker.
  `Position.symbol` and `Trade.symbol` = ISIN; product name goes in a display
  field. A product rename then cannot break joins. Prices resolve through the
  OpenFIGI ISIN path that Trading 212 already uses, and the returned
  `PriceBar.symbol` stays the ISIN (D10, #322).
- **Listing hint.** The execution venue from the transactions export
  (`Uitvoeringsplaats`, a MIC such as `XLON`) travels with the price target as
  `venue` and chooses among OpenFIGI's listings for one ISIN. A holding with no
  ticker and several listings but no venue hint still resolves to the first
  listing and reports which one it used. An unresolved lookup (rate limit,
  outage) is never written as a delisting: the next price run asks again.
- **Portfolio cash row.** A `CASH & CASH FUND …` row is a `CashBalance`, not a
  position (D7).
- **Position `asOf`.** The portfolio export carries no date (confirmed 2026-11-12).
  `readDeGiroPortfolio` requires the export date as an argument and the upload
  form asks for it (#323), default today. Never invent one silently.

### Re-import

Users export overlapping windows (the sample machine already has three
overlapping account files). A re-import must not append duplicates.

- DeGiro window replace (D9, #321). A complete account or transactions import
  carries a period (the span of its dated rows), so the snapshot replaces only
  the stored trades, cash flows and dividends dated inside that window; rows
  outside it stay. An overlapping re-import drops what its window no longer
  reports and keeps the rest.
- Backfill. An import whose window ends before the stored latest date (from
  positions, cash balances or coverage) adds history only: it never overwrites
  the stored cash balances. Coverage is one union while windows touch or
  overlap; across a gap the stored span cannot vouch for the days between, so a
  forward import replaces it.
- Portfolio `asOf` rule. A portfolio import replaces positions and its cash row
  only when its `asOf` is not older than the stored positions' latest `asOf`.
  An older portfolio is a holdings backfill: positions, cash row and stored
  coverage all stay. The comparison uses the stored positions' own date, not
  the cross-source latest date.
- All files of one import must arrive in one request: `parseBrokerFiles` merges
  them.
- Importing the same file twice leaves the snapshot byte-identical.

### Server and web

- Broker ids come from one list with capabilities (`BROKERS` in
  `packages/core/src/investing/brokers.ts`): `credentials`, `scheduled`,
  `fileImport`. `SCHEDULED_BROKERS`, `CredentialBroker`, `BrokerDataSnapshot`
  keys, readability maps and labels derive from it, so `degiro` is absent from
  the scheduled-sync set and the credential APIs by construction (#320).
- Upload route (D11, #323): `POST /api/investing/brokers/degiro/import`.
  Tenant bound: the signed-in user reaches the vault, the snapshot write and the
  cache invalidation, and the mounted app never falls back to `local`. Multipart,
  field `files` repeated 1–3 times, optional field `asOf` (`YYYY-MM-DD`), total
  at most 4 MB; a larger body answers 413. `?mode=preview` (default) parses only
  and returns per file
  `{ filename, sha256, profile, period, rows: { trades, cashFlows, dividends, positions, cashBalances }, problems }`
  with the parsed rows, without touching the vault or the lease. `?mode=commit` merges the parsed
  result into the encrypted `degiro` snapshot under the broker sync lease, then
  releases the lease, invalidates the dashboard cache and refreshes the
  in-process cache. A portfolio export requires `asOf`; an older overlapping
  import replaces only its window (#321). A commit whose files are all unknown
  headers answers 200 with `committed: false` and writes nothing. Errors are
  tagged: 400 invalid request, 413 too large, 409 lease busy or vault locked,
  500 failed. The raw file is never stored; only parsed rows and a SHA-256 per
  file.
- Import metadata. The encrypted snapshot carries
  `lastImport: { importedAt, files: [{ filename, sha256 }] }`, which D13 (#325)
  reads for the import age. A file-import broker's vault row holds a snapshot and
  no credentials (`credentials_blob IS NULL`); `broker_vaults_material_not_empty`
  still requires credentials or a snapshot, never neither.
- Web: a DeGiro tab in broker settings with export steps, multi-file drop,
  preview, confirm. Status reads "Last imported <date>, covers <from>–<to>",
  not fresh/stale/never. The holdings table shows the product name; an ISIN
  symbol is not repeated as the holding's identity line (D10, #322).

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
header-signature detection), D3 (#315, account statement to cash flows plus the
Saldo walk invariant), D4 (#316, dividends with withholding tax), D5 (#317,
account statement to trades, cash balances, coverage and period; the account
profile now returns a full `BrokerResult` alone), D6 (#318, transaction export
to trades merged by execution, and the multi-file seam `parseBrokerFiles`), D7
(#319, portfolio export to positions keyed by ISIN and its cash balance, with the
export date as a required input), D10 (#322, ISIN-only identity priced through
OpenFIGI with the execution venue as a listing hint, unresolved lookups retried
rather than frozen, product name in the holdings table), D9 (#321, DeGiro
account and transactions imports replace only their own window, an older import
is a backfill, and a portfolio export older than the stored holdings leaves
positions and cash alone), D11 (#323, the tenant-bound upload route with a
preview that writes nothing and a commit that merges under the broker lease and
records `lastImport` inside the encrypted snapshot).
