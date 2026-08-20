# Tax optimisation — a proposal to react to (review-2 item 15)

**His words:** *"taxes — yeah, I'm thinking I do something here with tax optimization. Get back to me
with this."* That is an open brief, so this is a proposal and not a build. Nothing in it is
implemented; no production file was touched.

**Read the recommendation first, then the boundary section.** The boundary is not boilerplate — it is
the part that decides whether this feature is buildable at all, because three of the four obvious
"tax optimisation" features are an accountant's signature in disguise.

---

## 1. What is already on his screen — measured, not assumed

| Already built | Where | State |
|---|---|---|
| Country rule packs (NL/DE), data-only, dated | `packages/core/src/taxpacks/` | working, `rulesAsOf 2026-08-04` |
| BTW set-aside as a `ScheduledFlow`, netted out of the available balance and visible in the forecast | `tax.ts` `computeVatSetAside` | working |
| Deadline arithmetic per country (NL: last day of the month after the period) | `tax.ts` `nextVatPeriod` | working |
| DE profit-tax prepayments + Nachzahlung | `tax.ts` `computeProfitTaxPrepayments` | working, NL has none by design |
| One module per tax, per entity, with rate/frequency/manual/mixed | `apps/web/src/views/Belasting.tsx` | working |
| "Wat LaVega hier niet berekent" (the caveats list) | `Belasting.tsx` + `pack.caveats` | working — and the mechanism the whole boundary section builds on |
| Privé/zakelijk classification per **entity**, inherited by accounts, default personal | `entities.ts` | working |
| Invoices with `direction` + `vatAmount`, auto-reconciled to transactions | `invoices.ts`, `Facturen.tsx` | working |
| Import of his own bookkeeping sheet → real turnover/cost/BTW figures | `taxSheet.ts` | **built, tested, wired to nothing** |

Three things are worth stating up front, because they change what each direction below costs.

**(a) The best BTW basis LaVega has never reaches the screen.** `taxSheet.ts` is complete and tested,
and nothing in `apps/web` imports it (`grep -rn "taxSheet\|sumTaxFigures" apps/web/src` → no hits).
`Belasting.tsx` calls `computeTaxReservations({ txs, settings, asOf })` without `figures`. So the
number he sees is always either his own manual figure or the bank-movement margin proxy — never his
bookkeeping, even though the code to use it exists. That is a wiring job in `apps/web`, owned by
another lane; recorded here because every direction below is cheaper once it is done.

**(b) `Invoice.vatAmount` is stored and used by nothing.** `Facturen.tsx` says so in a comment:
*"the Invoice keeps vatAmount for the (later) tax agent."* Also worth knowing: the manual invoice form
has no BTW field, so `vatAmount` arrives only via CSV, UBL and the AI read. Any invoice-based BTW
figure therefore starts with partial coverage and has to say so.

**(c) Mid-quarter, the BTW figure claims more than it knows.** On 20 August, `nextVatPeriod` returns
the **in-progress** Q3 (deadline 31 October) and the proxy sums transactions over 1 Jul – 30 Sep —
i.e. a quarter that is two-thirds done. The resulting flow is emitted as `status: "confirmed"`. This
is pinned by their own test (`tax.test.ts:47`, `asOf: "2026-06-20"`, mid-Q2, `status: "confirmed"`).
The amount is a fair "stand van nu"; the label is a claim the data cannot carry, and the figure
systematically understates until the quarter closes. Nothing on screen says which of the two it is.
And in the very next test (`tax.test.ts:51`) a quarter where he paid more BTW than he charged returns
`null` — a refund rendered as an absence, which is the cousin of the rule this project already paid
for twice.

---

## 2. The figures this feature may quote, and where each comes from

None of these belong in an engine or a view as a literal. They belong in `taxpacks/nl.ts` as pack
data with `rulesAsOf` — the mechanism that already exists — with one addition: a `source` URL per
field, because *"regels per 2026-08-04"* is a date without a document.

| Figure (2026) | Value | Source, and the date the source itself states |
|---|---|---|
| BTW-tarieven | 21 / 9 / 0 % | `taxpacks/nl.ts`, `rulesAsOf` 2026-08-04 |
| BTW-aangifte **en** betaling, per kwartaal | uiterlijk de laatste dag van de maand ná het kwartaal | belastingdienst.nl, *Btw-aangifte doen en betalen* (read 2026-08-20) |
| Welk stelsel geldt | factuurstelsel bij levering aan ondernemers/rechtspersonen; kasstelsel bij levering aan consumenten | belastingdienst.nl, *Factuurstelsel* / *Voor wie geldt het kasstelsel?* (read 2026-08-20) |
| Vennootschapsbelasting | 19,0 % t/m € 200.000 · 25,8 % daarboven | belastingdienst.nl, *Tarieven voor de vennootschapsbelasting* (read 2026-08-20) |
| Box 2 (aanmerkelijk belang) | 24,5 % tot € 68.843 · 31 % vanaf € 68.843 (2025: € 67.804) | belastingdienst.nl, *Box 2: uitleg en tarieven* (read 2026-08-20) |
| Box 1, jonger dan AOW-leeftijd | 35,75 % t/m € 38.883 · 37,56 % t/m € 78.426 · 49,50 % daarboven | belastingdienst.nl, *Box 1: uitleg en tarieven* (read 2026-08-20) |
| Minimumbedrag gebruikelijk loon | € 58.000 | Belastingdienst, *Tarieven, bedragen en percentages loonheffingen vanaf 1 januari 2026* (bijlage bij de Nieuwsbrief Loonheffingen 2026, **16 december 2025**), regel "Minimumbedrag gebruikelijk loon voor aandeelhouders met aanmerkelijk belang € 58.000,00" |
| Belastingrente vanaf 1-1-2026 | 5 % — voor de vennootschapsbelasting **en** voor de overige middelen | belastingdienst.nl, *Overzicht percentages belastingrente* (read 2026-08-20) |

Everything else a DGA's tax position depends on — his box-1 income elsewhere, his partner's box-2
room, the DGA-pension, the aanmerkelijk-belang verkrijgingsprijs, whether there is a loan from the BV
— is **not in the vault and cannot be derived from it.** That single sentence is what rules out three
quarters of what "tax optimisation" usually means.

---

## 3. Direction A — de BTW-positie vooruit in plaats van achteraf

**What it is.** One BTW figure per entity that is honest about *which* period it describes, *what it
was built from*, and *which way the money goes* — plus the running position of the quarter he is
inside right now, so "de BTW van dit kwartaal is al uitgegeven" can fire in week 4 instead of on
31 October.

**Shape** (all in `packages/core`, pure, `asOf` passed in, integer cents):

```ts
type VatPosition = {
  period: TaxPeriod;                       // from nextVatPeriod, unchanged
  stage: "loopt" | "afgesloten";           // is the window over? decides the label AND the status
  basis: "manual" | "sheet" | "invoices" | "proxy";
  chargedCents: number | null;             // null = this basis does not know, never 0
  paidCents: number | null;
  netCents: number | null;
  direction: "betalen" | "terugvragen" | "onbekend";
  coverage: { withVat: number; total: number };   // invoices in the window carrying a BTW amount
};
```

The basis ladder **extends** the one already in `computeVatSetAside` — manual > sheet > **invoices** >
proxy — and the bases are never blended. That is not fussiness: a reconciled invoice *is* a bank
movement, so adding invoice VAT to proxy VAT double-counts the same euros. `computeVatSetAside`
becomes a thin wrapper over `vatPosition` so the forecast, the netting and the DE path keep working
unchanged.

**What it delivers**
- The mid-quarter figure gets labelled as what it is (`stage: "loopt"` → `status: "expected"`) and a
  second line: "dit kwartaal loopt nog — dit is de stand tot vandaag, niet de aangifte."
- A refund quarter stops being invisible: the Belasting screen shows "terug te vragen € X". It does
  **not** become a `ScheduledFlow`, because LaVega does not know when the Belastingdienst pays, and an
  inflow with an invented date is worse than no inflow.
- The invoice basis is a real upgrade over the proxy on exactly his case: under the factuurstelsel the
  BTW on an outgoing invoice is due in the period of the **invoice**, so an unpaid invoice already
  creates a debt. The proxy, which reads bank movements, cannot see that at all. This is the classic
  cash trap for a BV and LaVega has the data for it sitting unused.
- One alert, with the real cause named: when the buffer minus reservations drops below the running
  BTW position. Uses the existing alert centre.

**Build cost.** ~180 lines of core + ~15 tests; a rewrite of the BTW module in `Belasting.tsx`; one
BTW field on the manual invoice form (that is why coverage is 0 for manual rows today); one alert
rule. Medium, and the smallest of the three.

**Where it goes wrong**
- **Stelsel unknown.** The invoice basis is simply wrong for a kasstelsel entity. Fix: one field on
  `TaxSettings` (`vatBasis`), asked once, stored `source: "user"`. Until answered, the invoice basis
  is not used at all — falls back to the proxy rather than guessing.
- **A legitimate zero.** Btw-verlegd, ICP and 0 %-export invoices carry `vatAmount` 0 *correctly*.
  That is today's lesson in a new place: an explicit zero is a known zero and must be recorded as
  one, or the coverage meter will call a complete quarter incomplete.
- **What LaVega will never see in a BTW return**: privégebruik-correcties, the auto-correctie in Q4,
  KOR, margeregeling. So the Q4 figure is structurally too low. That belongs in `pack.caveats`, on
  screen, not in a comment.
- **The double-count someone will add later.** The one-basis rule needs a test that fails if the
  bases are summed, not a comment asking nicely.

---

## 4. Direction B — de grens tussen privé en zakelijk, en de twee DGA-signalen die daaruit volgen

**What it is.** Today a transfer from BV1 to Privé is categorised `Eigen overboeking` and disappears —
which is right for cash and wrong for tax. Both legs are in the vault, so the crossing is
**measurable exactly**, not estimated. But that same rule is why his top-expenditure list "doesn't add
much" (review 2, item 6): the largest movements in a DGA's year are the ones being swallowed.

A crossing from a business entity to a personal one is one of three things — salary, dividend, or a
current-account movement — and each has a different consequence. LaVega can measure the euro and the
date. It cannot know which of the three it is. So the output is a **question list, not a verdict.**

**Shape**

```ts
crossScopeTransfers({ accounts, txs, profiles, asOf })
  → { fromEntity, toEntity, date, amountCents,
      kind: "salaris" | "dividend" | "onbekend",   // from a per-stream LearnedFact (source:"user")
      matched: boolean }[]                          // false = only one leg imported
```

Matching pairs the outflow and the inflow (same magnitude, dates within a few days, one leg business
and one personal) so the same euro is counted once. An unmatched leg is reported as unmatched — an
Amex has no counter-leg in the vault and must not silently double or halve the total. Each recurring
stream is asked about **once**; the answer is a fact, and a fact from him outranks every later guess.

**Signal 1 — de gebruikelijkloonmeter.** Crossings he marked "salaris", summed for the calendar year
and annualised, next to the statutory minimum (€ 58.000 for 2026, from the pack). The whole output is
a measurement, a published figure and a caveat:

> Als salaris gemarkeerd in 2026: € 34.000 (gemeten in je transacties, geannualiseerd).
> Het minimumbedrag gebruikelijk loon voor 2026 is € 58.000 (Belastingdienst, cijferbijlage
> 16 december 2025). LaVega ziet niet wat er in je loonaangifte staat.

That last sentence is what keeps it a measurement instead of a warning.

**Signal 2 — de box-2-kalender.** Dividend is a *dated* event and the bracket resets on 1 January, so
a date is a fact LaVega may state: 24,5 % tot € 68.843 per persoon per kalenderjaar, 31 % daarboven,
plus how much dividend LaVega has actually **seen** this year. It must say in the same breath that it
cannot see his partner, his other box-2 income, or his verkrijgingsprijs. This signal is the closest
thing to advice in the entire proposal, and it is the reason section 6 exists.

**Byproduct, and possibly the most useful thing here:** the mirror direction — business costs paid
from a private account. That is a measurement (a counterparty appearing on both sides of the
boundary), not a deductibility rule, and it is the thing that actually costs a DGA money.

**Build cost.** ~200 lines of core + tests, one module, one review flow (the categorize-review pattern
already exists), one new fact key. Medium-to-large.

**Where it goes wrong**
- **An unclassified vault yields nothing.** `entities.ts` defaults every entity to personal, so with no
  profiles set there are no crossings. The module must say "je hebt nog geen entiteit als zakelijk
  gemarkeerd" — not € 0. This is exactly the "je saldi staan al op de beste plek" mistake in a new
  place.
- **One-legged crossings**: a BV paying a private credit card directly is a crossing with no transfer
  pair at all.
- **The word "rekening-courant" must not appear on screen.** It is a bookkeeping conclusion about a
  legal relationship. What may appear is what was measured: "€ 12.400 ging in 2026 van BV1 naar Privé
  en LaVega weet van € 8.100 daarvan niet wat het was."
- **Out of scope, into caveats**: the excessief-lenen rule, the DGA-pensioen, terbeschikkingstelling.
- Depends on the own-name rule from review-2 item 6, which another lane is doing.

---

## 5. Direction C — aftrekposten uit zijn eigen transacties (the one I would not build now)

**Why it is tempting.** It would produce the biggest headline number of the three.

**Why not yet.** Two reasons, and the second is fatal on today's data.

1. It needs a deductibility rule table per category — representatiekosten only partly, auto with
   bijtelling, gemengde kosten, drempels — which is tax law that must be sourced and dated per year.
   That is a second catalogue with none of the catalogue's verification machinery, and the catalogue
   took weeks to make trustworthy for 122 products.
2. **Voorbelasting requires an invoice.** Without one there is nothing to reclaim, so "je laat € X
   liggen" is a conclusion an absence cannot carry. That is the precise rule this project has already
   paid for twice.

**When it becomes cheap — and it does.** Once the invoice-forwarding pipeline (his own item 16) covers
a measured share of his cost rows, the question stops being "is this bank row deductible" and becomes
"this invoice carries BTW and it is not in any aangifte". That is Direction A's coverage meter run
backwards, and it needs **no new tax rules at all.** So C is not rejected; it is sequenced behind A
and behind item 16. The honest slice of C available today is the privé-paid-business-cost flag, which
falls out of B for free.

---

## 6. Recommendation

**Build A now. Then B. Leave C behind item 16.**

Five reasons, in order of weight:

1. **A fixes something already on his screen that is wrong-ish**, and it is wrong in the exact way
   this review is about: the data is there and it is not reaching the screen correctly. A mid-quarter
   accrual labelled `confirmed` is the same species of defect as "je saldi staan al op de beste plek".
2. **A needs no new tax rules.** The deadline arithmetic already exists; the invoice VAT already
   exists; the sheet basis already exists. B needs one statutory figure plus one fact key. C needs a
   whole rule table.
3. **A pays off inside modules he already looks at** — the forecast and the available balance — so
   there is nothing new to learn to get the benefit.
4. **B is the one that produces a number an accountant would ask for**, and it is what would make the
   top-expenditure list mean something (his own item 6).
5. **C's number would be the most impressive and the least defensible.** That combination is how a
   trustworthy app stops being trustworthy.

A and B do not collide — different core files, different modules — but A goes first because it changes
`computeVatSetAside`'s shape and B does not touch it.

---

## 7. The line LaVega does not cross, and how the text on screen makes that true

**In one line: LaVega may say what happened, when the next date is, and what a published rule says. It
may not say what he should do about it.** A measurement plus a statutory figure plus a date is
arithmetic. The same three plus a verb is advice.

Three tests every sentence has to pass before it goes on the screen.

1. **Herkomst.** Every figure names the document it came from and the date *that document* states —
   never the day we looked. Same rule as the catalogue, applied to tax rules.
2. **Meten of zwijgen.** The sentence describes something that moved, or a date that exists. No
   conditional euros. *"Je zou € X besparen als je…"* is the sentence an adviser is paid to sign for,
   and it is banned even when the arithmetic is right — because the arithmetic depends on facts that
   are not in the vault.
3. **Wie beslist.** Every signal ends in a question, a date, or a handover — never in an instruction.
   *"€ 8.100 van BV1 naar Privé, en LaVega weet niet wat het was — wat was dit?"* is allowed.
   *"Keer dit als dividend uit"* is not.

**Vocabulary.** Allowed: *gemeten*, *volgens*, *uiterlijk*, *stand tot vandaag*, *LaVega ziet niet…*.
Not allowed anywhere in this feature: *advies*, *wij raden aan*, *je moet*, *optimaal*, *bespaar*,
*fiscaal voordeel*. (Note the contrast with Optimalisatie, where a comparison of two rates he actually
holds *is* a measurement — that is a different claim about different data.)

**Four things that make this structural instead of a promise:**

- **Provenance in the type.** `basis`, `coverage` and `rulesAsOf` are non-optional fields on every
  figure this feature emits, and the UI renders them. A number with no source cannot be displayed
  because the type cannot express one. Exactly the catalogue's value+source+date+conditions rule.
- **Statutory figures only in `taxpacks/*.ts`**, never in an engine or a view, and each gets a `source`
  URL beside `rulesAsOf`.
- **A copy test in `apps/web`** over the Belasting view's strings that fails on the forbidden-word
  list. Cheap, and it is what stops the next agent from writing an adviser six months from now. Good
  intentions in a comment have a shelf life; a red test does not.
- **The handover is a feature, not a disclaimer.** Where a signal reaches a point where the answer is
  a choice with tax consequences, the module's terminal action is "neem dit mee naar je boekhouder"
  plus an export of exactly the measured figures — the crossings, the BTW positions, the periods.
  LaVega hands over facts; the adviser signs. Note the privacy decision this forces: that file leaves
  the vault **unencrypted**, and today the only download in the app is the encrypted back-up. So it has
  to be an explicit act showing exactly what is in the file before it is written.

---

## 8. What I need from him before any of this is built

1. **Factuurstelsel or kasstelsel, per entity?** Direction A cannot use the invoice basis without it,
   and will keep using the weaker proxy until it is answered.
2. **Does the salary run through a payroll provider — is there a loonheffing payment in the BV's
   transactions?** That decides whether B can pre-fill "salaris" or has to ask every time.
3. **Do you want the accountant export?** And is an unencrypted file leaving the vault acceptable for
   it, given that everything else is encrypted?
4. **A or B first?** Is the BTW figure being a mid-quarter estimate a bigger irritation than the
   privé/zakelijk boundary being invisible?
5. **One existing expectation to flip.** `tax.test.ts:47` deliberately asserts `status: "confirmed"`
   for a mid-quarter estimate. My reading is that this is wrong and should become `expected` — it
   changes no arithmetic and no netting, only the honesty of the label. But someone wrote it on
   purpose, so it is his call, not a silent edit.

**One finding for another lane, not mine to fix:** `taxSheet.ts` is complete, tested and imported by
nothing in `apps/web`, and `Belasting.tsx` calls `computeTaxReservations` without `figures`. His own
bookkeeping cannot currently reach the BTW figure, whatever we build on top.
