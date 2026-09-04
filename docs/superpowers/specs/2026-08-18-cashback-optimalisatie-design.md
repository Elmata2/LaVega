# Cashback and optimisation — design

**His example, which is the whole brief:** Trading 212 pays 1,5% cashback and 3,5% on the balance;
ING pays 0% and 1,5%. "Dat is bijna 4%." He wants that difference surfaced, and later folded into
the travel agent.

## The reframing that unblocks it

I first read this as a market comparison and went looking for a Dutch cashback source. There isn't
one — see "The spike" below. But **he holds both of those accounts already.** The travel agent only
ever asks about products derived from his own accounts, which is why `Trading 212 betaalpas` appears
in its provider list at all.

So the feature he is describing needs **no comparison source at all**. It is hold-only, and
hold-only is the cheap half. Two different questions had been collapsed into one:

| Question                                 | Data                                 | Verdict           |
| ---------------------------------------- | ------------------------------------ | ----------------- |
| What do my OWN accounts earn and return? | already in the vault and the facts   | **build this**    |
| What would a card I don't own return?    | only affiliate sites quoting "up to" | parked, see below |

## One precision the number needs

3,5% and 1,5% apply to **different bases**. Savings earns on the balance sitting there; cashback
returns on what is spent. They are both real and they do not add on the same euros. So the output is
two actions, not one blended rate:

```
€20.000 idle:   3,5% vs 1,5%  →  €400/jaar   move the money
€30.000 spend:  1,5% vs 0%    →  €450/jaar   route the spending
                                 ────────
                                 €850/jaar
```

That is a larger and more defensible figure than "bijna 4%", and it survives him checking it against
a statement — which is the standard every number in this app is now held to.

## Core — `accountReturns()`

Pure, in `packages/core`, tested, no I/O and no clock.

```ts
type AccountReturn = {
  account: Account;
  /** What the balance earns. Reuses resolveAccountRate: manual > detected > benchmark > unknown. */
  savingsPct: number | null;
  savingsSource: RateSource;
  /** What spending returns. The cashbackPct LearnedFact that already exists, keyed by productOf(). */
  cashbackPct: number | null;
  balanceCents: number;
  /** Card spending through this account over the measured window, annualised.
   *  See "What counts as spending" — this is the number cashback multiplies,
   *  and getting it wrong inflates the answer. */
  spendPerYearCents: number | null;
};
```

Rules carried over unchanged, because they are why the rest of the app can be trusted:

- **Unknown is never zero.** A card with no cashback fact is `null`, not 0%, and cannot win or lose
  a comparison. `resolveAccountRate` already distinguishes `manual / detected / benchmark / assumed /
unknown` and that distinction survives into the output.
- **A user correction always wins.** Both inputs are LearnedFacts or user-set values.
- **Integer cents, no `Date.now()`**, `asOf` passed in.
- **Coverage honesty.** `spendPerYearCents` is annualised from an observed window; when the window is
  too short to annualise, it is `null` and the action says so rather than projecting from three
  weeks. Same rule the forecast and the month comparison now live by.

## What counts as spending — the one ambiguity worth settling now

Cashback pays on **card purchases**. It does not pay on a transfer to your own savings, on rent
leaving by direct debit, or on an iDEAL payment. Counting every outflow as "spend" would inflate the
cashback figure by whatever share of the account is rent, tax and transfers — which for a business
account is most of it.

So:

- **Own transfers are excluded**, using the same `Eigen overboeking` rule the forecast now uses.
- **On a credit card, every outflow is card spend** by definition. That figure is exact.
- **On a payment account, LaVega cannot reliably tell a card payment from a direct debit** — the
  bank export does not always say. So the figure there is an **upper bound**, and it must be
  labelled as one rather than presented as measured.

The consequence is worth stating plainly rather than hiding: on a payment account the cashback
action says "tot €X per jaar", not "€X per jaar". A number that might be double the truth, printed
without that word, is exactly the failure this app has spent three days removing.

If bank exports turn out to carry a reliable card/direct-debit marker for his banks, this becomes
exact and the hedge is dropped. Worth checking against real MT940 and CAMT data before assuming
either way.

## The two actions

`optimiseReturns(accounts, txs, facts, rates, asOf)` returns a ranked list, each carrying its own
arithmetic so the UI never has to invent any:

1. **Waar staat je geld** — idle cash in an account you own that yields less than another you own.
   Amount = balance × (best − current). Reuses `analyzeInterest`; this is the existing Rente module's
   logic, now expressed as an action.
2. **Waarmee betaal je** — spending flowing through a card that returns less than another you hold.
   Amount = annualised spend × (best − current).

Both name the two accounts, both rates, and the euro figure. An action whose either side is unknown
is not produced — it is reported as a gap to fill instead, with the provider named.

## Web — a third module, not a rewrite

Alexander's call: Optimalisatie keeps its separate modules rather than becoming one ranked list.
So: **Abonnementen · Rente · Cashback**, the new one built from `optimiseReturns`'s spending action,
using the existing `Module`/`ModuleGrid` primitives and tokens.

Recorded consequence, decided with eyes open: three parallel answers means nothing on the screen says
which to do first, and the later merge with the travel agent costs more than it would have from one
ranked list.

## Later — folding into travel

`rankJourneys` already prices `fxFeePct − cashbackPct` per product. Adding the balance side makes
"where should the money sit before I travel" part of the same answer rather than a separate screen.
Nothing in this design blocks that: the same facts, the same products, the same `productOf()` key.

Note this changes travel's current rule. Alexander chose "hold and switch ranked together" as the
app-wide remit, while travel today deliberately proposes nothing he does not own. That reversal is
his decision and is recorded here so the collision is deliberate when it happens.

## The spike, so nobody repeats it

Asked to find a Dutch cashback comparison source before building the switch half. Measured 2026-08-18:

| Source                               | Result                                                    |
| ------------------------------------ | --------------------------------------------------------- |
| ICS — issuer of most NL credit cards | 200, **zero** cashback percentages on its own card pages  |
| geld.nl creditcards, Independer      | 404                                                       |
| Consumentenbond                      | 200, 1 MB, **zero** cashback figures in the HTML          |
| creditcard-vergelijk.nl              | 200, ten brands, zero percentages — prose only            |
| smartcreditcard.eu                   | 200, 37 hits — affiliate, phrased "Cashback **up to** 2%" |
| creditcardnetherlands.nl             | 200, 12 hits — affiliate                                  |

**No neutral source exists.** The only pages carrying numbers are affiliate sites that earn on
signups, quoting "up to" rather than a rate — the wrong input for an app whose selling point is not
overstating what it knows.

The market explains it: ordinary NL cards pay 0–0,5%, and everything above that is a crypto card
requiring token staking or a paid tier. At 0,5% on €30.000 of card spend a perfect switch earns
€150/jaar, against several hundred on the savings side where geld.nl is real, live and neutral.
Scraping affiliate sites to chase the smaller number would look like a feature and behave like a
liability.

If a neutral source appears, the switch half slots in behind the same `AccountReturn` shape.

## Testing

- `accountReturns`: unknown stays unknown; a user-set rate beats a detected one; a card with no
  cashback fact yields `null` and never 0.
- `spendPerYearCents` is `null` on a window too short to annualise, and the action is suppressed
  rather than projected.
- `optimiseReturns`: his own case — T212 3,5%/1,5% against ING 1,5%/0% — produces **two** actions
  with the two bases kept apart, not one blended rate.
- An action is not produced when either side is unknown, and the gap is reported with the provider
  named.
- Spending excludes own transfers; a credit-card account yields an exact figure while a payment
  account yields one labelled as an upper bound.
- Web: the Cashback module renders from props and states its own coverage.
