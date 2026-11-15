# Realised gains and income report

What a user can do: open **Reports** and see what the portfolio actually realised,
what is still unrealised, and what it earned in dividends and interest. The
report groups every figure by the account's tax treatment. The account type is a
label the user sets; it changes the grouping and nothing else.

## Route and API

- SPA: `/reports` (always on, like Profile; not a layout-toggleable module).
- API: `GET /api/investing/reports/realized` returns the report section the
  dashboard payload already carries.
- API: `GET`/`PUT /api/investing/account-wrappers` reads and writes the
  `(broker, account) -> wrapper` map. `PUT` body: `{"entries":[{"broker":"trading212","account":"ISA","wrapper":"isa"}]}`.
  An unknown wrapper label is dropped.

## What the report shows

- **Summary**: realised gain, unrealised gain, income, each with an unknown
  count when a figure could not be computed.
- **By tax treatment**: taxable, tax deferred, tax exempt, tax advantaged and
  unknown treatment, each with realised, unrealised, income, disposals and
  holdings.
- **Accounts**: every account with its wrapper control, treatment and figures.
- **Disposals**: date, symbol, quantity, gross proceeds, fee, net proceeds, cost
  basis, realised gain and a broker-cash check (`Reconciled`, `Does not
  reconcile`, `No broker cash reported`, `FX missing`, `Proceeds unknown`).
- **Income**: dividend and interest rows grouped by kind, symbol and calendar
  month, plus the tie-out line.
- **Holdings**: value, cost basis, unrealised gain and treatment per holding.

Unknown is always shown with a reason (`FX rate missing`, `No trade history`,
`Units arrived by transfer`, `History does not match the holding`). A missing FX
rate never becomes a 1:1 figure. The report never makes a tax-filing claim; it
carries the fixed notice "LaVega does not file taxes and this is not tax advice."

## Drive it from the CLI

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C up
node $C api GET /api/investing/reports/realized
node $C api PUT /api/investing/account-wrappers --body '{"entries":[{"broker":"trading212","account":"ISA","wrapper":"isa"}]}'
node $C browser open
node $C browser click <Reports tab>
node $C browser screenshot --png /tmp/lavega-verify-investing/evidence/realised-report.png
node $C cleanup
```

With `INVESTING_DEV_FIXTURE=1` the fixture carries one reconciled disposal
(AAPL), one disposal with no FX rate (NESN, CHF), dividends and a transfer-in
position, so the report renders both a reconciled row and an unknown-FX row.

## What proves success

- The report JSON has `disposals`, `holdings`, `byTreatment`, `accounts`,
  `income` and `notice`; the notice names no tax filing.
- A disposal the broker settled shows `reconciliation.status: "reconciled"` and
  its `netProceedsCents` equals broker cash minus fees.
- A disposal in a currency with no rate has `netProceedsCents: null`,
  `reason: "missing-fx"` and `reconciliation.status: "missing-fx"`.
- The income `tieOut.status` is `tied` when every row converted, `missing-fx`
  when one did not.
- A wrapper PUT changes the `byTreatment` grouping on the next dashboard read.

## Verified-unreachable

No broker snapshot means an empty report (`income.tieOut.status: "no-income"`),
not an error. The report needs a completed broker sync with at least one trade.
