# Travel money agent + learned facts — design

**Backlog item 1** (with a first slice of item 2). One answer to "I'm going to the US":
where to **keep** money, where to **convert** it, which card to **spend** with — combining
the interest, conversion and points agents that today don't talk to each other.

Decisions taken with Alexander (2026-08-13): built as the first _real_ agent (so item 2's
architecture starts here); **hybrid** facts (deterministic math on own data + agent web
search for product terms, cached); card terms **auto-derived and correctable**; triggered
by a **travel field on the homepage**.

## The privacy consequence that shapes everything

Because the ranking math is deterministic and local, **the model never needs to see his
money**. It answers _product_ questions only ("what does a Trading 212 card charge on a
USD transaction?"). LaVega combines that with balances locally.

That makes this the tightest redaction boundary in the app so far — tighter than chat:

| Sent to Claude                                       | Never sent                             |
| ---------------------------------------------------- | -------------------------------------- |
| home country, destination, target currency           | balances, amounts, account keys, IBANs |
| provider names he banks with (`["ING","Revolut",…]`) | transactions, dates, entity names      |
| facts already known (so it can't contradict them)    | anything identifying                   |

## Item 2 slice: `LearnedFact` — the thing that makes it sticky

```ts
type LearnedFact = {
  id: string; // hash(agent|subject|key) — stable, so a re-run upserts
  agent: string; // "travel"
  subject: string; // "Trading 212"
  key: string; // "fxFeePct" | "cashbackPct" | "pointsPerEuro"
  value: string;
  source: "agent" | "user";
  updatedAt: string;
  note?: string;
};
```

**The learning contract: `source: "user"` always wins and is never overwritten by an agent
run.** Correct a wrong fee once and it stays corrected forever, across trips and re-runs.
That is the whole "learns from the user, becomes tailored" mechanic in one rule — small
enough to test, real enough to build on for the other agents.

Stored in the vault as an additive `VaultData.facts?` (same pattern as invoices/rewards —
no migration, legacy vaults decrypt fine). Local, encrypted, user-inspectable.

## Deterministic core — `packages/core/src/travel.ts`

`planTravel({ accounts, txs, rates, facts, destination, asOf })` → `TravelPlan`:

- **store** — reuses `analyzeInterest`: best yield across what he has vs. the benchmark.
- **convert** — picks a source account and a low/no-cost conversion provider he already
  has; illustrates with the live ECB `crossRate`.
- **spend** — ranks his own cards by `netCostPct = fxFeePct − cashbackPct`, using the
  learned facts. Unknown terms rank last and say so, never silently assumed 0.

Pure, no `Date.now`, integer cents — same house rules as the rest of core.
`countryCurrency(code)` maps destination → currency (US→USD, GB→GBP, CH→CHF, …).

## Server — `POST /api/agent/travel-facts`

Mirrors the categorize agent exactly: `sanitizeTravelInput` (allowlist, caps) → Sonnet 5
with `web_search` (fees change; the chat agent already uses this pair) → forced tool
`report_provider_terms` → `{provider, fxFeePct, cashbackPct, pointsPerEuro, note}[]`.
Guard ladder 503 → 429 → 400 → 502. Instructions live in
`apps/server/src/agent/prompts/travel.md`, so the agent is defined by an instruction file
like a skill — the pattern the other agents move to next.

Results are stored as facts with `source: "agent"`, so the block is instant and offline on
every later render until he presses "ververs".

## Web — a modular block on Overzicht

`components/TravelBlock.tsx`: "Ik reis naar [land] van [datum] tot [datum]" → three
sections (**Bewaren / Wisselen / Betalen**), each a one-line recommendation plus a _waarom_.
Every used fact is correctable inline (writes `source: "user"`).

Built as a **self-contained block** taking only props — the first modular block, which is
what backlog item 6 needs as its foundation.

Home country is a local preference (`settings.ts`, like `bufferCents`), default `NL`,
since there is no signup in a local-first app.

## Testing

Core: fact upsert (user beats agent, agent never clobbers user), `planTravel` ranking
(cheapest net wins, unknown terms rank last), `countryCurrency`. Adapters: facts round-trip

- parity. Server: sanitize rejects balances/keys/oversize; agent output filtered.
  Web: block renders each section from a plan; correction writes a user fact.
