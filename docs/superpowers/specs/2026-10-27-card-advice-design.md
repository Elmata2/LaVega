# Card balances, points and card recommendations - design (27 Oct 2026)

Owner words: "aan de hand van de kaarten vraag je de saldi op en maak je een aanbeveling welke kaarten
goedkoper of beter zijn qua rente etc, je vraagt de punten op". Owner decision 27 Oct: LaVega may now
recommend ("wel aanraden"), if every number is traceable ("Zo is het berekend") and nothing is invented.
Investing products stay out of scope.

## Intent

Today the intake asks which credit and debit cards the user holds (`statedCards`, `statedDebitCards`,
catalogue ids) and "Kaarten en punten" lists them with sourced catalogue facts. It asks nothing further and
recommends nothing. This work adds (1) the questions that make a recommendation possible, (2) the
recommendations, (3) the places to edit the answers later.

## Goals

1. Wizard screen `card-balances` right after the credit-card picker: one compact row per picked credit card:
   outstanding balance (EUR), "paid in full every month?" (yes/no), credit interest rate (only when not paid
   in full, optional), points balance (only for cards whose catalogue `pointsPerEuro` is covered and > 0).
   Skippable per card (empty balance = card skipped) and as a whole.
2. Same form is editable later in "Kaarten en punten" (group "Jouw cijfers").
3. Recommendations in "Kaarten en punten":
   - net yearly value per catalogue credit card on the user's own card-payable spending, ranked, versus the
     user's current cards, with the euro difference;
   - per revolving card: yearly interest cost and a concrete recommendation with the calculation;
   - points balance: indicative value and expiry where known.
4. Every recommendation has "Zo is het berekend" and the source/date of every catalogue fact it used.
   Unknown catalogue values are never guessed: such cards go to "niet te vergelijken" with the reason.

## Non-goals

- No bank/credit eligibility check (acceptance, income, needing a bank account of the issuer). Said on screen.
- No debit-card ranking, no investing, no loan-product ranking (no sourced loan rates exist).
- No change to the held-card table, the old per-held-card net lines, or the `debts` section (a revolving
  card balance is not added to debts: the debts section needs a monthly payment, which a card balance lacks).
- No AI. Pure engine.

## Decisions

D1 Storage. Balances/revolving/rate: new optional profile field `cardBalances` (Field of array
`{cardId, balanceCents, paysInFull, ratePct?}`), additive, an old vault decodes unchanged. Points: the
existing manual rewards balances (`RewardsBalance`, the Punten tab store, `makeRewardsBalance`/`upsertBalance`),
not a second store. A card maps to a programme by catalogue id (`programForCard`): consumer American Express
-> "American Express Membership Rewards", Flying Blue Amex -> "Flying Blue (KLM/Air France)"; others none.

D2 Spend base. The cards section's own number only counts spend on held card accounts, which is nothing for a
user who only stated a card. Advice therefore uses all personal accounts' outgoing spend that a card can pay
(`spendHistory` over every personal account, same `notCardable` filter). Annualised as window x 12 / months,
only with at least 3 full months (`MIN_MONTHS`); below that advice says "te weinig historie" and shows nothing
numeric. Foreign-currency spend (converted by the existing FX mode) is totalled separately so FX surcharges
can be computed; in "separate" mode it is excluded and counted, as elsewhere.

D3 Net yearly value of a catalogue card = points value + cashback - yearly fee - FX cost.
 - fee: `readAccountFee` per year (known or card is not comparable);
 - FX cost: foreign annual spend x `fxFeePct` (needed only when the user has foreign spend);
 - points: annual spend in euro x `pointsPerEuro` (must be covered, 0 counts as known) x value per point. The
   value per point is the user's own redemption examples (median; low/high shown), else the one sourced
   reference rate we have (Membership Rewards 1.000 punten = EUR 3, Amex NL, read 21 Aug 2026, "Betalen met
   Punten" only), else unknown: then points are NOT valued, the card stays comparable and is flagged
   "puntenwaarde niet meegeteld" on every row that earns points;
 - cashback: only when the catalogue has a covered `cashbackPct`; absence is "niet meegerekend", never 0 shown
   as a fact.
 Business/corporate cards are not in the universe (a consumer is not offered one); stated in the calculation.

D4 Recommendation rule. Baseline = best comparable net among the user's current credit cards (stated + cards in
bank data with a catalogue match); no cards at all = 0 (not paying for a card). A better card is recommended when
gain >= max(EUR 20, 10% of |baseline|) (the 10% is `PLAN_THRESHOLDS.cards.betterCardMargin`). If nothing beats
the baseline the section says so ("jouw kaart is bij jouw uitgaven al de beste volgens de catalogus"). If the
user holds cards but none is comparable, the top options are shown with absolute nets and the reason.

D5 Interest. Revolving = balance > 0 and not paid in full. Yearly interest = balance x rate (flat balance, no
compounding, said so). No rate = unknown, never guessed; the screen shows "elk procent kost EUR X per jaar" and
asks for the rate. Recommendation ladder: (a) surplus = liquid savings - fixed costs x buffer target (buffer
section figures); if surplus > 0, pay off min(balance, surplus) from savings; interest saved vs the best sourced
free-withdrawal savings rate forgone (from `rates`, bestRate/keptRate), shown net; (b) remaining balance or no
surplus: move to cheaper credit - the break-even is any credit below the card rate; no product is named since
no sourced credit rates exist; (c) rate unknown: ask for the rate.

D6 Points. Value = balance x value per point (D3 order); expiry = the user's own date in
`preferences.pointsExpiry` (the catalogue holds no expiry); else "niet bekend". Stale balance flagged.

D7 Copy lives in `apps/web/src/copy/cardAdvice.ts`, outside `copy/plan`, because the plan copy suite
deliberately asserts "no advice language" over everything in `copy/plan`. The static footer line "geen
financieel advies ... kiest geen producten" is the owner's to reword; left untouched (open question).

## What the user sees

Wizard: after "Welke creditcards?", "Wat staat er nu op je creditcard?": a row per card with Saldo, a
Ja/Nee "Betaal je elke maand alles?", rente (%) when Nee, punten when the card earns them, "Overslaan".
Plan, "Kaarten en punten": a block "Aanbeveling" (ranked top options with euro differences vs current), a block
"Rente op je creditcard" (per revolving card), a block "Punten" (value, expiry), a list "Niet te vergelijken"
with reasons, each recommendation with a "Zo is het berekend" details (inputs, formula, sources with dates).
