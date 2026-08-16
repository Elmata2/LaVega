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
>
> **Handoff — two follow-ups, both specified, neither built:**
> 1. *Price the conversion leg.* `store` and `spend` answer in numbers; `convert` picks a
>    route but never costs it, so a via-route always looks free. Design:
>    `docs/superpowers/specs/2026-08-16-travel-conversion-pricing-design.md`.
> 2. *One comparison source instead of thirty bank pages.* Verified 2026-08-16:
>    `bank.nl/kennisbank/betalen-in-buitenland/` returns 200, 96 kB, with real koersopslag
>    figures in the raw HTML for ten Dutch banks — including ING and Rabobank, which block
>    us directly. Same shape as the geld.nl savings scraper. Needs a row parser, a
>    bank→product name mapping, and a precedence rule (a provider's own page beats the
>    table). Not in it: Revolut, Wise, N26 — those stay with the agent. See
>    `docs/n8n/README.md`.

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

---

# UI review — dictated by Alexander, 2026-08-16

Walkthrough of the rebuilt app. Captured verbatim in intent; the wording is mine.
Status legend as above. Items marked **[later]** are his own "put it in the backlog".

## A. The shell — a Profile owns everything that is not a workspace

**The top nav is right, but overcrowded.** The fix is not to shorten names, it is to stop
showing tabs nobody uses.

- **Profile, top right.** It holds the module picker and everything that is a setting
  rather than a place you work.
- **Module picker.** Every module is listed with a **short preview** — what it looks like
  and what it does — and a toggle. Toggled on, it appears in the horizontal top nav.
  Toggled off, it disappears. This is the point of the modular grid: the nav becomes
  the user's own selection instead of the full catalogue.
- **Move into the profile:** Regels, Koppelingen, Backup ("set name for backup"),
  Import (which accounts to import), Vergrendel/uitloggen, notifications, and the
  country/region that drives the tax rules.
- **Stays in the nav:** Overzicht, Forecast, and whatever the user switches on.
- **Remove** the "lokaal & privé" badge. At launch that has to be evident from the
  product, not asserted in the chrome.
- **Remove** the floating chat widget for now. **[later]** decide what it becomes.
- **Add widget** control, like the desktop reference.
- **Header style:** take the reference's treatment — a title with a black rule under it,
  rather than today's round-edged tiles. Cleaner.
- **[later]** Colours and font sizing. He is not sure yet, and it is a cheap change once
  the content is settled. Do not touch until the content work is done.

## B. Overzicht

- **Entity switcher → `Persoonlijk | Zakelijk`**, split by a vertical rule. Per-company
  splitting only if users turn out to need it. **Not a priority.**
- **New block: the cards you hold.** Purely presentational — card art plus the holder's
  name, as in `Modules for homescreen 5/7.png`. It does little functionally and is worth
  a lot: it shows at a glance which cards are connected.
- **Totaalpositie** is the most important number on the page. Keep the click-through to
  Rekeningen. **Add a graph under it:** the total position, against last week and last
  month.
- **Statistics is where the value is.** Make it live and make it the major block. Take
  both references: grouped bars per category per month (`homescreen 5`), and the **trend
  line across days of the week** (`homescreen 7`). The insight is "which day costs me
  money" — Friday nights are expensive, and that is something to be warned about before
  it happens, not after. Possibly merged with "verandering per categorie", which is the
  same question asked twice.
- **Positie over je bedrijven**: interesting, but far too large. Shrink it.
- **Cashflow + buffer**: good as is. **[later]** the forecast itself needs work.
- **Top-uitgaven shows "onbekend"**, which wastes the block. The **pre-made rules should
  already be applying** — check what was built earlier. On top of that, an **AI pass that
  categorises what is still uncategorised**, from a prompt, live, and probably month by
  month.
- **Recente transacties**: optional module. From `desktop homeview inspo.png`: merchant
  logo, time, and our category per row, plus a search and a "bekijk alles" that lands in
  Transacties.
- **Betaalagenda**: same reference. Once recurring bills are detected, show them here for
  users who want it.
- **[later]** The travel block needs work. Note: the "Ververs voorwaarden" button DOES
  exist (TravelBlock.tsx:185) — he could not find it, which is a discoverability defect,
  not a missing feature.

## C. Rekeningen

Works: bank, rename, type, entity, transactions, delete, filter per company.

- **Idea to test:** group by bank, with the bank's logo, and the cards at that bank as
  sub-rows behind a click. Not certain it is better — try it.

## D. The other tabs

- **Regels** → move into the profile. It is a setting, not a workspace.
- **Forecast** → stays in the nav. **[later]** needs work.
- **Optimalisatie**: the reasoning must be explicit and end in a number — "you hold X at
  ABN at 1.4%, bank Y pays 3.01%, so moving it earns you €Z". **Rebalance the layout:**
  savings-rate optimisation smaller, **subscriptions much larger** and roughly equal in
  weight. Seed a few test subscriptions so it can be judged full.
- **Valuta**: rebuild around the reference's *Transfer money* block
  (`Modules for homescreen example.png`) — from card, to card, amount, currency, and what
  actually arrives. Add an **info button** beside the "..." menu: "this is the best
  conversion your own cards allow", and "switching to Wise would beat it".
- **Punten**: **[later]** the real question is whether an AI can fetch the balances with
  the owner's approval. UI could be nicer.
- **Belasting**: drop the grey instruction sentence under the title. Add a module per tax
  that is actually relevant, driven by the country in the profile (NL income tax, etc.).
- **Facturen**: the UI is bad. Reduce it to exactly three ways in — the automatic n8n
  feed, manual entry, and **drag and drop an invoice file**. Nothing else.
