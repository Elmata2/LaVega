# Jouw plan uses the intake answers

Date: 2026-10-27 · Branch `feat/plan-from-intake` from master 1759d21a · Owner request: "nu moet het resultaat uit het plan komen, werk daaraan zodat ik het morgen kan reviewen". The owner was away while this was designed, so every call below is the designer's and is listed for review.

## Why

A full walk of the live wizard plus a synthetic ING statement (household "Samen", one child, loondienst + freelance, spend band €3.500–€5.000, ING + Revolut debit cards, Amex Gold, a goal, DUO) showed that Jouw plan uses almost none of the new answers:

- Work type, debit cards and stated credit cards have no effect on the plan. The cards section only says "Te weinig gegevens".
- The stated income and spending are never set against what the bank data shows, so the user does not see what their answers produced.
- The subscriptions section counts fixed costs as subscriptions: health insurance, energy, water, childcare and home insurance were listed as "abonnementen" (€1.231 per month, nine items) with Houden / Bekijken / Opzeggen buttons. That is wrong output.

## Goal

After the wizard, Jouw plan visibly reflects the answers: a short "what you told us vs what your accounts show" block, the cards you said you hold with their sourced facts, a note where your work type changes how a figure should be read, and subscriptions that are really subscriptions.

## Non-goals

- No new plan sections in core's section list, no change to the change log, snapshots or the existing section figures beyond the subscriptions fix.
- No advice: no "choose this card", no tax amounts, no "you should". Information with sources only (the AFM line from the pivot).
- No AI layer (that is a separate plan).
- Debts: the missing DUO rate stays a user input (no public-rate lookup in this round).

## Anti-goals

- A figure that changes meaning silently (e.g. subscriptions totals shrinking without the excluded items being visible anywhere).
- A catalogue fact shown without its "gecontroleerd op" date or source.

## The four parts

### 1. "Uit je antwoorden" block at the top of Jouw plan (web only)

A compact block under the plan header, above "Wat LaVega weet":

- One line about the household: Alleen / Samen (household figures), number of children with birth years, work kinds as chips.
- **Opgegeven tegenover gemeten**, one row each for income and spending:
  - stated: the exact amount, or the band ("€3.500 – €5.000");
  - measured: the middle month from bank data (the same figure "Je maand" already uses: income, and income minus "what was left" as spending), with the month it comes from;
  - no verdict words. When the measured value falls outside the stated band, one neutral sentence: "Je rekeningen laten een ander bedrag zien dan je schatting." When there is no bank data: "Nog geen rekeningen gekoppeld of geïmporteerd" and a link to the import in Profiel.
- Each row links to where it can be changed (About you).

### 2. Cards: stated credit and debit cards with catalogue facts

In the existing Kaarten en punten section (web side; core cards section unchanged):

- List every stated credit card and debit card by name, grouped "Creditcards" / "Betaalpassen".
- Per card, from `docs/catalog/catalog.json`: yearly fee (`accountFee`), foreign-currency surcharge (`fxFeePct`), points per euro (`pointsPerEuro`), each with its `checkedAt` date ("gecontroleerd op 4 jul 2024") and the `sourceUrl` as a link. A missing field shows "niet bekend", never a guess. "Een andere kaart/pas" shows only its name.
- One total line: yearly fees of all stated cards together.
- The section's status chip and existing figures stay as they are; the block sits above the existing "Er is geen kaart ingevuld" note, which is hidden when stated cards exist (the round-2 rule).

### 3. Work type notes

Two information notes, each shown only when the condition holds:

- In **Je maand**, when work includes `freelance` or `business`: "Je gaf aan dat je (ook) als zzp'er of ondernemer werkt. Inkomstenbelasting en btw die je zelf afdraagt, zitten niet apart in deze cijfers."
- In **Buffer**, when work includes `freelance`, `business` or `jobseeking`: "Je gaf aan dat een deel van je inkomen kan wisselen. Je buffer is hier gemeten in maanden vaste lasten."
- Student / retired / employed / other: no note this round.

### 4. Subscriptions are subscriptions

Recurring payments whose category is a fixed cost are not subscriptions:

- Excluded from the subscriptions section: payments categorised as housing and energy/water ("Wonen & energie" and the housing categories), insurance (health insurance included), childcare, debt repayments and taxes. The builder takes the exact category names from `packages/core/src/categories.ts` and lists them in one exported constant with a test.
- Telecom, streaming, software, sport and memberships stay subscriptions (Ziggo, Simyo, Netflix, Spotify, Basic-Fit).
- The excluded items are not lost: the section's explanation says how many recurring fixed costs were left out and that they count under vaste lasten.
- Existing subscription tests that relied on a fixed cost being a subscription are updated, each named in the report.

## Constraints

- NL + EN copy for every string, typed-complete, `findAdviceLanguage` clean.
- Money in cents, whole-euro display as elsewhere in the plan.
- No commit or push by workers; the work stays staged for the owner's review.

## Left to the builder

- Exact layout of the "Uit je antwoorden" block within the plan's existing visual language (plan pages are the light app style, not the wizard style).
- Whether catalogue facts are read through an existing catalogue helper (`catalogue-rates.ts`) or a new small module.

## Settled after the builder check (designer's calls)

1. **Where the subscriptions filter lives:** in core's subscriptions section (`packages/core/src/plan/subs.ts`), so the section's figures, snapshot and change log all agree; a first plan after this change may log the drop as a change, which is correct. A recurring series is a fixed cost, not a subscription, when its category (from `categorize` with the user's own rules, the same call the spending section uses) is "Wonen & energie", "Verzekeringen" or "Belastingen & overheid", or when its counterparty is a health insurer or a childcare provider. Childcare and health insurers are recognised by a small merchant list local to the subscriptions code (no app-wide category change). The section lists the excluded names under one line: "N vaste lasten zijn hier niet meegeteld: …". Acceptance with the synthetic statement: Zilveren Kruis, Vattenfall, Vitens, Kinderopvang Het Zonnetje and Centraal Beheer are excluded; Netflix, Spotify, Basic-Fit, Ziggo and Simyo stay.
2. **Opgegeven tegenover gemeten:** stated income is net per month (that is the question asked); stated spend is total monthly spending (exact or band). Measured = the middle month of "Je maand": income, and spending excluding transfers between own accounts. Because the stated figure may cover the household while the imported accounts may be one person's, the block only shows both values side by side with explicit labels ("opgegeven, voor jullie samen" / "gemeten op je gekoppelde rekeningen") and draws no comparison sentence at all.
3. **Catalogue facts:** a field that the existing coverage check (`isCovered`) rejects shows "niet bekend". A known field shows its value, its `conditions` text when present (small print), its `checkedAt` date and a link to `sourceUrl`. The yearly-fee total counts only cards with a known fee and says how many cards were left out. Debit cards show no points row when the field is absent; credit cards show "niet bekend".
4. **Card identity:** stated cards are stored as catalogue ids (or "other"); facts are looked up by id. When a card account from bank data already maps to the same catalogue entry (the existing `entryFor` matcher in `heldCards.ts`), the card is shown once, in the existing held-card list, not again under the stated cards.
