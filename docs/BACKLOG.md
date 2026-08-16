# LaVega — improvement backlog

Captured 2026-08-13 from Alexander. Working agreement: **one item at a time** —
questions first (confirm the intent), then build, then he tests, then next.

Status legend: `todo` · `questions-open` · `building` · `in-test` · `done`

---

## 1. Cross-agent money optimisation ("where do I put / convert / spend it")  — `in-test`

> **Built and on master** (2026-08-13 → 08-15, `04e8da0` … `134f111`) as the **travel money
> agent**. Spec: `docs/superpowers/specs/2026-08-13-travel-money-agent-design.md`.
> Shipped: `planTravel()` in `packages/core/src/travel.ts` (deterministic store / convert /
> spend ranking, local — the model never sees balances), `POST /api/agent/travel-facts`,
> the `TravelBlock` on Overzicht, server-side card-terms cache, and the n8n ingest that
> fetches each product's own tariff page instead of searching for it.
> **Open:** the n8n workflow is imported but does not complete yet — set
> `LAVEGA_INGEST_TOKEN` in the n8n environment (see `docs/n8n/README.md`). The Railway
> side (`CARD_TERMS_INGEST_TOKEN` on `@lavega/web`) is set and verified 2026-08-16.
> The cache is in server memory, so it is empty after every deploy until a run lands.

One combined answer built from three agents that today don't talk to each other:

- **a) Where to STORE money** — highest yield across what he already has vs. what's
  available (existing ING vs. BigBank top rate). *Interest agent.*
- **b) Where to CONVERT for foreign payments** — e.g. ING → Revolut free via iDEAL,
  then pay in USD from Revolut at a lower fee than the source bank's. *Conversion agent.*
- **c) Which CARD to pay with in the destination country** — best combination of
  cashback, points, and conversion cost (e.g. Trading 212: no conversion cost + cashback).
  *Points/cashback agent.*

Key requirement: **the three agents must combine into one recommendation**, not three
separate tabs the user has to reconcile himself.

Trigger idea: the user tells LaVega "I'm travelling to the US" and the answer appears
**on the homepage**. Home country (NL) should be known from signup, so only the
destination is new information.

Open questions: trigger/placement, source of fee+cashback+rate facts (live web search
vs. curated table), whether a "my cards and their terms" registry is needed.

## 2. Agent architecture: skills / workflows that actually learn  — `building` (first slice done)

> **Landed with item 1:** `LearnedFact` in the vault (`VaultData.facts?`, additive, no
> migration) with the learning contract **`source: "user"` always wins and an agent run
> never overwrites it**; and the first instruction-file agent —
> `apps/server/src/agent/prompts/travel.md` defines the travel agent like a skill.
> The n8n card-terms workflow is the first "workflow instead of one-shot prompt".
> **Still open:** move chat / categorize / invoice / tax onto the same instruction-file +
> LearnedFact pattern, and decide how facts feed back into those agents.

From an Instagram reel on Claude Skills (not viewable here — going on Alexander's summary).
Wants the agents rebuilt as **proper agents with instructions** — Skill-style, or even
n8n workflows — instead of one-shot prompts.

**Most important part: they must consistently LEARN from the user**, so the product
becomes tailored and sticky over time.

Accepts that this may require **changing the privacy model** — but explicitly: see how far
we can get while still running **locally / on the user's own company infrastructure**.

Note: this underpins items 1, 3 and 5. Sequencing decision needed.

## 3. Invoice agent → inbox integration  — `todo`

Automatically scan Gmail (or another integration the user explicitly connects) and add
invoice numbers to the business overview — **income, expense, and tax**.

Relates to the long-deferred "Phase 2b email connectors" (Gmail `gmail.readonly` /
MS-Graph `Mail.Read`, read-only OAuth relay + a "Koppelingen" consent view).

## 4. Classify accounts personal vs. business  — `todo`

Every account gets a personal/business classification, **defaulting to personal**, with
renaming to an entity (BV1, …) allowed — which is roughly what the `entity` field already
does. Needs a decision on whether this is a new axis or a reframing of `entity`.

## 5. Tax agent → connect the user's spreadsheets  — `todo`

Let the tax agent read spreadsheets the user already keeps.

## 6. UI overhaul  — `todo` (blocked: screenshots not received)

- Graphs in the style of the **Hercules** app's weight-trend charts: clean, sleek,
  readable at a glance.
- Show **changes in major categories** — side-by-side bar charts or change/trend graphs.
- **Desktop:** move to the inspiration layout, **keep the current colours**, change the layout.
- **Mobile:** separate inspiration screenshot.
- **Modular blocks** are essential — that is the basis for the fully customised CFO AI agents.

Blocked on: the three referenced screenshots (desktop inspo, mobile inspo, general inspo)
were mentioned but not attached.

## 7. Getting data we can't get from Enable Banking (points, card data)  — `todo`

Two tiers, by how much the user trusts AI:

- **High trust:** give the AI read-only access to download the CSV itself, or reach
  balances like Amex points — possibly by logging into the site on the user's behalf.
- **Low trust:** the user gets a **notification**, then adds the number manually — and
  that must be as easy as replying to a WhatsApp/iMessage ("just the number").

Explicitly aimed at the point balances Enable Banking cannot deliver.

## 8. Tax rules per country, automatically  — `todo`

Tax should follow the **user's country** automatically and pull in that country's relevant
rules — not NL-only.

Evidence from a customer interview (a German friend), which is really a *pain* statement,
not just a feature request:

> Knows a lot of freelancers (zzp'ers) — more liability, but don't have to charge certain
> taxes. Judged their income from what friends said, and **thought they made more money
> than they actually did**.
>
> → Pissed off a few friends. In Germany, once you start making income you have to
> **prepay corporate income tax**: 1M profit → 250k due at the beginning of next year.

The insight to design for: **the surprise prepayment**. People spend money that was never
theirs. This is a forecast/reservation problem as much as a tax-rules problem — and LaVega
already has the set-aside machinery (VAT set-aside + scheduled flows) to build on.
