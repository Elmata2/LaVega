# Intake wizard: cards follow the banks answer; last step connects the bank

Date: 14 Nov 2026. Branch: `feat/wizard-banks-personal-reset`.
Status: owner request of 14 Nov 2026, reading confirmed by the owner ("yes that's right").

## 1. Intent

The owner ran the wizard. The banks question ("Bij welke banken zit je?") is followed by the debit
card and the credit card question, and both show every bank again. That is double work. The last
step offers a file upload; it must offer the bank connection.

## 2. Design

### 2.1 Card questions show only the banks the user chose

- Screens `debit-cards` and `cards` read `statedBanks`. The brand tiles in the card picker are
  limited to the brands in `statedBanks` (same ids: `bankBrandIds()` in `cardOptions.ts`).
- A brand with no card of that kind is not shown (for example American Express on debit cards).
- The tile "Een andere pas" / "Een andere kaart" stays, always.
- If the user chose "Overige" (`other`) at banks, the group for cards without a known brand
  (`other-brand`) is shown too.
- If `statedBanks` is missing, empty, or holds only `other`, there is no filter (full list as
  today). That covers old profiles and the Wijzig path.
- A card that is already selected always stays visible and selected, also when its brand is not
  in the filter. Changing the banks answer later never deletes a stored card.
- Search follows the same filter.
- One quiet link under the tiles, "Toon alle banken" / "Show all banks", lifts the filter for this
  screen visit. It prevents a dead end (a card at a bank the user forgot to tick). When the filter
  is lifted the link reads "Toon alleen mijn banken" / "Show only my banks".
- On `cards` the choice "Ik heb er geen" stays.
- No change to the stored data model, to step order or to the step count.

### 2.2 Last step: connect your bank

- The last screen (id stays `upload`) gets the title "Koppel je bank" / "Connect your bank" and
  one line of body copy saying the link is read-only and that a file works too.
- Primary action: the existing bank-link component (`components/BankLink.tsx`, the same flow as in
  Rekeningen and Importeren). Before the browser leaves for the bank, the wizard marks the screen
  done and saves (the component has an `onBeforeRedirect` prop for this), so the return trip
  (`?eb=…`, handled in `App.tsx`) lands in the finished app, not back in the wizard.
- Secondary action: the existing file upload ("Bankafschrift uploaden"), unchanged in behaviour.
- "Later" stays and finishes the wizard as today.
- When bank linking is not available (server reports no Enable Banking configuration, or the user
  has no account session), the screen shows the upload as the primary action, as today, with the
  new title replaced by the old one. No dead button.
- The summary row and the "About you" rows that name this screen keep working.

## 3. Approaches considered

- **A. Filter the picker by `statedBanks`, with an escape link (chosen).** Small, no data change.
- **B. Merge banks + cards into one screen.** Fewer steps, but a larger rebuild and new copy.
- **C. Drop the banks question and derive banks from cards.** Loses banks without a card product.

## 4. Non-goals

- No change to the card catalogue, to card advice, or to the connect pop-up on Home.
- Copy never calls LaVega an adviser. nl and en both.

## 5. Verification

- typecheck, lint, web tests, build: exit 0.
- Tests: banks = ING + Revolut + American Express + Overige → debit screen shows ING, Revolut and
  the other group, not ABN; credit screen shows ING and American Express; a stored card of another
  brand stays selected; "Toon alle banken" restores the full list; no banks answer → full list.
  Last screen: link available → bank link primary and wizard saved before redirect; link not
  available → upload primary.
- Browser: both screens with that banks answer at 1440 and 390, both themes; last screen.
