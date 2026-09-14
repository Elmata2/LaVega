# Cash-flow forecast

`Prognose` projects the next 13 weeks from imported transactions, open invoices and rules, flags a shortfall against the buffer, and shows the drivers per week.

## Sub-features

- `forecast-empty` with no data the view renders without a crash and says there is nothing to forecast.
- `forecast-13w` with transactions the `13-weeks cashflow-forecast` card shows one point per week.
- `forecast-shortfall` when the projected balance dips under the buffer, the `Tekort-signalering` banner changes state.
- `forecast-drivers` `Drivers · per week (gem.)` lists the recurring in/out drivers.

## How to get to it (user POV)

- Nav rail `Weergaven` → Prognose, or URL `/app/forecast`.

## Driving it with control-lavega + browser

Preconditions:

- Vault unlocked; for the non-empty cases, at least one import done (see import-bank-file.md).

- **Empty.** `navigate` to `/app/forecast` on a fresh vault. Page renders; no console error (`read_console_messages`). Screenshot `forecast-00-empty.png`.
- **Populated.** After an import, `navigate` to `/app/forecast`. `find` section `aria-label="13-weeks cashflow-forecast"`; it contains a chart and 13 week labels. Screenshot `forecast-01-13w.png`.
- **Shortfall.** Set the buffer in Profiel higher than the projected minimum, return to Prognose; the `Tekort-signalering` section carries the warning state and text. Screenshot `forecast-02-shortfall.png`.
- **Drivers.** Section `aria-label="Drivers per week"` lists at least one driver with an amount.
- **Proof.** Screenshots and `get_page_text` of the forecast view in each state.

## Gotchas

- The forecast reads the current position from the same vault as Overzicht; a filter on Rekeningen does not narrow it.
- The buffer lives in `localStorage` (`settings.ts`), not in the vault, so it survives a vault delete but not a new origin.
