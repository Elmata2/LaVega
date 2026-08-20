# EUR benchmark fallback list (research, ticket #69)

Curated list of benchmark indices and UCITS ETFs to ship as a static fallback if the
free Yahoo Finance search endpoint proves too fragile for instrument search. All
values are converted to and presented in EUR by the dashboard (no currency toggle),
so the "Native currency" column below reflects each instrument's *quote* currency on
Yahoo Finance, not the presentation currency.

Yahoo Finance tickers were verified via web search against live Yahoo Finance quote
pages (`finance.yahoo.com/quote/<TICKER>`) on 2026-08-20. Where an instrument lists on
multiple European exchanges, the Amsterdam (`.AS`) listing is preferred for a Dutch
retail audience; the next-most-liquid EUR listing (Xetra `.DE`, Milan `.MI`, Frankfurt
`.F`) is used as a fallback where no Amsterdam listing exists.

| Display name | Yahoo ticker | Category | Native currency |
|---|---|---|---|
| MSCI World (index) | N/A — tracked via ETF below | Broad global equity (index) | USD |
| iShares Core MSCI World UCITS ETF USD (Acc) | `IWDA.AS` | Broad global equity (ETF) | USD |
| iShares MSCI World EUR Hedged UCITS ETF (Acc) | `IWDE.MI` | Broad global equity, EUR-hedged (ETF) | EUR |
| Vanguard FTSE All-World UCITS ETF (Dist) | `VWRL.AS` | Broad global equity (ETF) | USD |
| Vanguard FTSE All-World UCITS ETF USD (Acc) | `VWCE.DE` | Broad global equity (ETF) | EUR |
| iShares MSCI ACWI UCITS ETF USD (Acc) | `SSAC.AS` | Broad global equity incl. EM (ETF) | USD |
| S&P 500 (index) | `^GSPC` | US equity (index) | USD |
| Vanguard S&P 500 UCITS ETF | `VUSA.AS` | US equity (ETF) | USD |
| Nasdaq-100 (index) | `^NDX` | US tech equity (index) | USD |
| Invesco EQQQ NASDAQ-100 UCITS ETF | `EQQQ.DE` | US tech equity (ETF) | EUR |
| EURO STOXX 50 (index) | `^STOXX50E` | Eurozone blue-chip equity (index) | EUR |
| iShares STOXX Europe 600 UCITS ETF (DE) EUR (Dist) | `EXSA.DE` | Broad European equity (ETF) | EUR |
| Vanguard FTSE Developed Europe UCITS ETF | `VEUR.AS` | Broad European equity (ETF) | EUR |
| AEX-Index | `^AEX` | Dutch equity (index) | EUR |
| iShares Core MSCI EM IMI UCITS ETF USD (Acc) | `EMIM.AS` | Emerging markets equity (ETF) | USD |
| iShares Core Global Aggregate Bond UCITS ETF EUR Hedged (Acc) | `AGGH.AS` | Global bonds, EUR-hedged (ETF) | EUR |
| iShares Core € Govt Bond UCITS ETF EUR (Dist) | `IEGA.AS` | Eurozone government bonds (ETF) | EUR |
| Xtrackers Physical Gold EUR Hedged ETC | `XAD1.MI` | Commodities — gold, EUR-hedged | EUR |
| Xtrackers Physical Gold ETC (EUR) | `XAD5.DE` | Commodities — gold, unhedged | EUR |
| iShares MSCI World Small Cap UCITS ETF USD (Acc) | `WSML.L` | Global equity — small cap (ETF) | USD |

## Notes

- **No standalone Yahoo index ticker exists for MSCI World** — it is only trackable
  via an ETF (`IWDA.AS` is the standard reference; MSCI itself does not license a
  free public index quote on Yahoo Finance). Listed first for completeness since the
  ticket explicitly calls out "MSCI World / FTSE All-World" as the world-equity
  benchmark; `VWCE.DE` (FTSE All-World) is the closer fit for a literal index proxy.
- **Amsterdam-listed tickers** (`IWDA.AS`, `VWRL.AS`, `VUSA.AS`, `VEUR.AS`, `EMIM.AS`,
  `AGGH.AS`, `IEGA.AS`, `SSAC.AS`) were prioritized because the existing codebase's
  users are Dutch retail investors (Dutch commit history and language cues found
  throughout the repo, e.g. `apps/investing-web` and related packages) who
  realistically hold these exact Euronext Amsterdam-listed UCITS funds via Dutch
  brokers (DEGIRO, Trading 212 NL, etc.).
- **EQQQ (Nasdaq-100 UCITS)** and **EXSA (STOXX Europe 600 UCITS)** have no Amsterdam
  listing on Yahoo Finance; `EQQQ.DE` (Xetra) and `EXSA.DE` (Xetra) are used as the
  next most liquid EUR-quoted alternatives.
- **"Native currency" is the exchange quote currency**, not the fund's base/reporting
  currency — e.g. `IWDA.AS` and `VWRL.AS` are USD-denominated funds that happen to
  trade in USD-quoted units on Euronext Amsterdam even though the exchange itself is
  in the Netherlands; `EUR`-hedged share classes (`IWDE.MI`, `AGGH.AS`, `XAD1.MI`) are
  explicitly currency-hedged back to EUR by the fund itself. Since the dashboard has
  no currency toggle and always presents EUR, all of these get converted to EUR at
  render time regardless of native currency — this list exists purely to identify a
  correct, resolvable Yahoo ticker per instrument, not to pre-filter by currency.
- Gold (`XAD1.MI` / `XAD5.DE`) is included as the "commodities" category entry since
  it's the most common commodity exposure a European retail benchmark portfolio
  would reference; broader commodity-basket ETFs (e.g. energy/agriculture) were
  intentionally left out to keep the list to the ~20-instrument scope requested.
- Small cap (`WSML.L`) was added as a rounding-out entry alongside the required
  categories (world/US/Nasdaq/Europe/AEX/EM/global bonds/EUR UCITS) to reach the
  requested list size while staying within "instruments a EUR-based investor would
  realistically want to benchmark against."

## Scope note

This document covers only the curated EUR benchmark fallback list, per the split of
ticket #69. The Yahoo Finance instrument *search endpoint* itself (reliability,
rate limits, fallback triggering logic) is covered by a separate research effort and
is out of scope here.
