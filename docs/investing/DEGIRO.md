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
- The checked-in fixtures use invented headers (`Date;Time;…;Currency;Order ID`,
  semicolon). No real DeGiro export has that shape.
- Run against a real NL account statement (`Rekeningoverzicht`, the file DeGiro
  calls `Account.csv`), the parser returns
  `onbekend of leeg bestand — geen transacties of posities herkend`.
- `Transactions.csv` and `Portfolio.csv` shapes are **unverified**. Headers
  reconstructed from memory also fail (one misreads a USD trade as a EUR
  position). Treat both shapes as unknown until D1 checks in real exports.

## Verified: the account statement (`Account.csv`)

Observed in two real NL exports (110 and 10 rows). Headers and description
vocabulary only; no amounts are recorded here.

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

## Design

### One file set, three profiles

| Profile        | DeGiro export               | Produces                                                    | Status     |
| -------------- | --------------------------- | ----------------------------------------------------------- | ---------- |
| `account`      | Rekeningoverzicht / Account | cash flows, dividends, cash balances, trades, cash coverage | verified   |
| `transactions` | Transacties / Transactions  | trades (venue, local value, FX rate, commission)            | unverified |
| `portfolio`    | Portefeuille / Portfolio    | positions, cash balance                                     | unverified |

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
- **Saldo walk invariant.** Sorted oldest first, per currency:
  `Saldo[n] = Saldo[n-1] + Mutatie[n]`. This test proves no row was dropped or
  double-counted. It decides the iDEAL reservation question with evidence.
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
- **Position `asOf`.** The portfolio export carries no date (to confirm in D1).
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

- Broker ids come from one list with capabilities
  (`credentials`, `scheduled`, `fileImport`). `SCHEDULED_BROKERS` and
  `CredentialBroker` stay without `degiro`. Today `"ibkr" | "trading212"` is
  hand-written in `app.ts` (~129, 173–180, 893, 1320), `portfolioRead.ts`
  (~340), `BrokerSettings.tsx`, `historyGate.ts`, `brokerSnapshot.ts`.
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
