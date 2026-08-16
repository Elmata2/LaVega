# Travel agent: price the conversion, rank the whole journey — design

**Backlog item 1, the missing third.** `store` and `spend` already answer with numbers.
`convert` does not: `planConversion()` picks a route ("move it from ING to Revolut via
iDEAL") but never says what that route costs, and `Valuta.tsx:95` sends the same question
to the chat assistant. So the app still asks the owner to reconcile two answers himself —
exactly what the backlog said must not happen.

Decision taken with Alexander (2026-08-16): build it, reusing the machinery that already
works for `spend`.

## The idea in one line

Stop ranking **cards** and start ranking **journeys**: the euro cost of getting €1.000
from where the money sits now to a payment in the destination currency.

## The two journeys

For a trip to the US, with euros at ING and a card at Revolut:

| | Route | Cost on €1.000 |
|---|---|---|
| A — pay direct | ING betaalpas charges its own FX surcharge | `fxFeePct − cashbackPct` |
| B — move first | ING → Revolut (transfer) → convert → pay | `transferCost + convertFeePct + fxFeePct − cashbackPct` |

Today LaVega prices only the last term of B and none of the first two, so B always *looks*
free and A always looks expensive. That is the defect: the comparison is not like for like.

## New learned fact: `convertFeePct`

One new key in the travel agent's namespace (`agentFacts.ts`), the same shape and the same
contract as `fxFeePct`:

```ts
convertFeePct   // cost in % of converting EUR into the destination currency AT this provider
```

`transferFreeViaIdeal` already exists and covers the transfer leg for the free case. A
provider that charges for the transfer needs no new key yet — none of the providers in
scope does, and CONTEXT.md forbids building for cases that cannot happen. Add
`transferCostPct` only when a real provider charges one.

The learning contract is unchanged and is the whole point: `source: "user"` wins forever.
Correct Revolut's weekend surcharge once and it stays corrected.

## Core — `packages/core/src/travel.ts`

```ts
export type Journey = {
  spend: SpendOption;              // the card at the end of the route
  via: string | null;              // provider converted at, null = pay direct
  fundedFrom: string | null;       // which account the money leaves
  method: string | null;           // "iDEAL" when free
  transferPct: number | null;
  convertPct: number | null;
  totalCostPct: number | null;     // null when ANY leg is unknown
  costOnReference: number | null;  // euros on TRAVEL_REFERENCE_SPEND
  why: string;
};
```

`rankJourneys(accounts, facts, currency)` builds one direct journey per spendable card plus
one via-journey per conversion provider the owner already has, and sorts by
`totalCostPct`. Rules carried over from `rankSpendOptions`, because they are the reason it
is trustworthy:

- **An unknown leg makes the whole journey unknown**, and unknown ranks last. Never assume
  a missing fee is zero — that is how you send someone abroad with the wrong card.
- **Hard cash only.** Points stay out of the total for the reason already documented: a
  Membership Rewards point is worth 0.5–2 cent depending on redemption, and inventing a
  value would be the fake precision the "indicatief" tables were removed for. `spendNote`
  keeps stating the trade-off as a choice.
- **Only providers he already has.** LaVega proposes no account he does not hold, and
  never moves money itself (no PIS). A "worth switching to" suggestion is a separate
  benchmark, like the savings benchmark in `store` — out of scope here.
- Pure, integer cents, no `Date.now`.

`planTravel()` gains `journeys: Journey[]` and `convert` is derived from the winner, so the
three sections finally state one consistent answer instead of three independent ones.

## Server

`apps/server/src/agent/prompts/travel.md` gains `convertFeePct` in the reported fields, and
`report_provider_terms` gains the matching property. No change to the redaction boundary:
the model still sees only country, currency, provider names and known facts. The euro math
stays local, which is what keeps this the tightest boundary in the app.

## Web

The travel block leads with the journey, not the card:

> **Zet €1.000 van ING naar Revolut via iDEAL (gratis) en betaal daar — €14 goedkoper dan
> direct met je ING-pas.**

with the legs and their sources behind the existing *waarom* disclosure, each correctable
inline as today.

## Testing

- A journey with one unknown leg ranks last and reports `totalCostPct: null`.
- Direct beats via when the transfer is not free and the card fee is equal.
- Via beats direct on the measured real numbers (ING 1.4% vs Revolut 0% + free iDEAL).
- A `source: "user"` correction of `convertFeePct` survives an agent refresh.
- `costOnReference` is exact in integer cents.
