# LaVega — improvement backlog

Captured 2026-08-13 from Alexander. Working agreement: **one item at a time** —
questions first (confirm the intent), then build, then he tests, then next.

Status legend: `todo` · `questions-open` · `building` · `in-test` · `done`

---

# WHAT IS STILL OPEN — 2026-08-17

**This section is the single source of truth.** Everything below it is the historical record of
how each item was captured; read that for intent, read this for state.

Closed since 2026-08-16, in 22 commits (`16f107e` … `44b6d6c`): original items 1–8 all shipped or
substantially shipped, both UI review rounds built, 870 tests passing.

## Live defects

| # | What | Notes |
|---|---|---|
| **L1** | **The travel agent returns zero card terms.** Clicking a destination gives "nog geen route met bekende voorwaarden". He re-ran the ingest and got nothing. | He asked to DISCUSS before it is fixed. Second symptom pointing at the same area as the invoice PDF bug. |
| ~~**L2**~~ | ~~The invoice flow is untested end to end.~~ **DONE 2026-08-17** — a live run returned `{addedInvoices: 1, inQueue: 1, remembered: 1}`. Three stacked faults closed: `downloadAttachments` in the wrong place, the body starving on HTML-only mail, and a storage reference shipped as base64. | Remaining: pull the queue into LaVega (Koppelingen URL + token → *Ophalen uit n8n* in Facturen) and confirm the row. |

## Buildable now

| # | What |
|---|---|
| **B1** | **Aandacht/priority block** — his "still needs work" from round 1, never revisited. |
| **B2** | **The forecast itself** — the cashflow block is liked; the forecast behind it is not finished. |
| **B3** | **Travel block discoverability** — "Ververs voorwaarden" exists (`TravelBlock.tsx:185`) but he could not find it. |
| **B4** | **Rekeningen grouped by bank**, with the bank's logo and its cards behind a click. His own words: "maybe just test this out, I'm not sure yet." |
| **B5** | **Punten UI** nicer. |
| **B6** | **Trend lines on statistics**, but only if they genuinely add something. |
| **B7** | **Three cleanups from the adversarial pass**: retire the dead `category-trend.ts` (+ its 7 misleadingly-green tests), remove the unreachable `rules`/`koppelingen`/`backup` view branches, and give `saveScheduledFlows` a merge-based save so Belasting can finally take a scoped flow list. |

## Blocked on a decision or a constraint

| # | What | The obstacle |
|---|---|---|
| **D1** | **Real card art** (his Amex Gold request) | Trademarked artwork, so bundling is a licensing question; fetching at runtime tells that server which cards he holds. Possible instead: product-specific generated art from our own tokens. |
| **D2** | **Points derived from transactions** once he grants access once (Amex, ING) | His framing: ask once, then compute. Needs the access model decided. |
| **D3** | **Enable Banking multi-account** | His instruction: after the MVP, not before. |
| **D4** | **Colours and font sizing** | His instruction: after the content is settled. Cheap then, wasteful now. |
| **D5** | **Notifications in the profile** | There is no notification mechanism in the app yet, so there is nothing to configure. Needs the feature first. |
| **D6** | **What the chat widget becomes** | Removed from the chrome; his `[later]`. |
| **D7** | **Disclaimers and terms** | At launch, not in the working screen. |
| **D8** | **Never pushed.** Nothing in this session is on lavega.dev. | Awaiting his go-ahead. |

## Decided 2026-08-17 — invoices arrive by forwarding address, OAuth is v2

**The MVP: each user gets `<slug>-<random>@invoices.lavega.dev`** and forwards invoices to it (or
sets one Gmail filter). Cloudflare Email Routing plus an Email Worker receives the mail and POSTs it
to the n8n webhook, so everything downstream is the pipeline already built and debugged. Design:
`docs/superpowers/specs/2026-08-17-invoice-forwarding-address-design.md`.

Why not the obvious "Connect Gmail" button first: `gmail.readonly` is a Google **restricted** scope,
so a public app needs OAuth verification **plus a CASA Tier 2 assessment, renewed every 12 months**,
from about $3,000 upward — a bill before the first customer, in exchange for access to the user's
whole mailbox. `lavega.dev` is already on Cloudflare with no MX records, so the forwarding route
costs nothing to host. Dext, Hubdoc and Xero all solve it this way.

> **BLOCKED 2026-08-17 — Cloudflare access sits with the cofounder, not Alexander.** Everything up
> to the DNS is built and testable; switching on Email Routing and deploying the Worker needs whoever
> holds that account. Two steps for them: enable Email Routing on `lavega.dev` (it adds MX + TXT
> automatically; there are no MX records today, so nothing is displaced and it is reversible), then
> deploy the Worker and point a **catch-all** at it. Nothing else in LaVega waits on this.

### Two things this route defers, recorded 2026-08-17

**1. The address IS a credential.** For a single operator the pull works because his browser knows
his own webhook URL and token. Ship this to strangers and that URL and token are the same for
everyone — the app carries them — and one user's queue is separated from another's only by the
random part of the address. So anyone who learns your full address can pull your queue.

That is acceptable for an MVP and it is how several "forward your receipts here" products actually
work, but it must be **stated plainly in the UI rather than discovered**. The replacement, when
there are real users: bind the queue to the vault instead of to the address, so possession of the
address is not possession of the invoices.

**2. Operator and user are different people, and the UI must not mix them.** The n8n base URL and
API key are for the OPERATOR, once. A user must never see them, never know n8n exists, and never
hold a key for infrastructure they do not run. A user sees exactly one thing: their forwarding
address.

The auto-provisioning is therefore a **maintenance convenience, not a product feature**: it buys
nothing for first-time setup (that is already done by hand) and everything for pushing a changed
workflow — which happened five times in one day. If CORS makes it painful on his n8n, drop it and
no user loses anything.

**OAuth "Connect Gmail" — v2, with these limitations recorded so they are not rediscovered:**
1. Restricted scope: verification + CASA Tier 2, **annual**, ~$3,000+.
2. Background sync needs a **server-held refresh token** with standing whole-mailbox access, because
   the browser is closed when the job runs. That ends local-first for this feature and needs a
   deliberate decision against `CONTEXT.md` constraint 2.
3. Encrypting extracted invoices to the user's public key reduces exposure **at rest only** —
   plaintext still exists in server memory during extraction, and the token stays a live key.
4. n8n becomes one workflow over many users: an HTTP Request node per user token, since the Gmail
   node binds to a single credential.
5. **Outlook may be the cheaper first OAuth** (publisher verification, no paid annual assessment as
   far as we know — verify before planning around it).

Nothing built for the forwarding route is wasted: extraction, queue, confirm-first review and dedup
all sit downstream of how the mail arrived.

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

---

# UI review round 2 — dictated 2026-08-16

His verdict on round 1: "major, major improvement". What follows is the de-duplicated signal.

## Correctness first — two numbers and one behaviour that may be lying

- **"Uitgaven t.o.v. vorige maand" showed a ~€24.000 rise he does not believe.** He guessed it
  compares by UPLOAD date. Checked: `categoryComparison` (packages/core/src/views.ts:176) buckets on
  `t.date`, so that guess is wrong — but he is right that the number is not trustworthy, for a
  reason he could not have seen. There is **no per-account coverage guard**: every transaction is
  bucketed by month regardless of which account it came from. Import ABN for Jan–Aug and Amex for
  Aug only, and August carries a whole extra card that July never had — a large, entirely fictional
  "increase". Compounding it, the "current" month is simply the latest date present, which may be a
  half-imported month. **Fix: compare like for like** — restrict both months to accounts that have
  data in both, and say so plainly when coverage differs, rather than printing a percentage that
  cannot mean what it appears to mean.
- **Persoonlijk ⇄ Zakelijk does not restore.** Switching to Zakelijk shows only the accounts;
  switching back to Persoonlijk does not bring back what was there before. Investigate.
- **The 3% figure beside Totaalpositie is unclear.** Say what it is measured against.

## Overzicht

- **Statistics — the time filter.** Wants `1 week · 1 maand · 3 maanden · 6 maanden · 12 maanden`,
  or `1w · 1m · 3m · aangepast` where *aangepast* lets him pick any range.
- **Remove the small note line under the statistics block** — it earns nothing.
- **"6 kleinere categorieën niet getoond" — make the cut-off per TIMEFRAME, not global.** Small
  amounts that add up meaningfully within a month are invisible against a year. The threshold must
  be relative to the window being shown.
- Trend lines, if they are genuinely useful. Only then.
- **Recente transacties** — remove the note line underneath. On logos: if real logos are not
  possible, drop the two-letter monogram circle and just show the name. He asked which is better.
- **Payment schedule**: empty so far, but he likes it.
- **Cashflow projection**: good.
- **Cards** — he wants the REAL card art (his example: the Amex Gold card). Confirm the obstacles
  and record them rather than quietly not doing it. Also remove the note under this block.
- **Travel agent**: clicking a destination gives "nog geen route met bekende voorwaarden — ververs
  eerst". He re-ran the ingest and got zero. Still broken; he wants to discuss before it is fixed.

## Profiel

- Likes it. Widgets and Persoonlijk/Zakelijk are right.
- **Country/region: every country, not a short list.** And regions matter — tax in Texas is not tax
  in New York — so a region level is needed under the country. Always entered by hand: privacy-first
  means never inferring location.
- **Import: default the entity to Persoonlijk.**
- **Enable Banking — after the MVP**, then connecting several accounts. Not before we are happy.
- **Koppelingen: simplify.** Explanations belong behind a small info (eye) icon, not as rows of
  visible text. Click to learn, otherwise stay out of the way.
- **Back-up** works well.
- **Profile at the very top with first and last name**, so the screen feels like the user's own.

## Optimalisatie

- **His Simeo subscription is missing.** He suspects the detection window is one month. It must be
  **at least 3 months, better 6** — quarterly subscriptions exist and a one-month window can never
  see them.
- Rent/savings framing: he likes it, but **he should not have to type the rent by hand — read it
  from the data.**
- Layout is good.

## Punten

- The real prize: **once the user grants access once, derive the points from the transactions**
  (Amex, ING). Ask once, then compute. Backlog.

## Elsewhere

- **Remove the disclaimer block on the right.** Disclaimers and terms belong at launch, not in the
  working screen.
- **Invoices**: he is testing first; other work continues meanwhile.

## Carried over from round 2's adversarial pass — 2026-08-17

- **`Belasting` receives the UNSCOPED scheduled-flow list, on purpose.** It saves them back
  through `onSaveScheduledFlows`, which persists replace-all, so handing it a scoped list would
  delete every flow outside the current half. Scoping it needs a merge-based save first. Recorded
  because it looks like a leak and someone will otherwise "fix" it into data loss.
- **`apps/web/src/category-trend.ts` is dead code** — no non-test callers, and it carries the same
  uncovered-account defect that `categoryComparison` was just fixed for. Its seven green tests make
  it look maintained. Retire both deliberately.
- **Unreachable view branches** for `rules`, `koppelingen` and `backup` in App.tsx: nothing calls
  `setView` with those any more since Profiel renders the components inline. Not lost tabs — dead
  branches. Remove them, or wire a deep link if a direct route is wanted.
- **Real card art** (his Amex Gold request): blocked twice over. Card faces are trademarked artwork,
  so bundling them is a licensing question, and fetching one at runtime tells that server which
  cards he holds. What is possible is product-specific generated art from our own tokens.
- **Points from transactions** once the owner grants access once (Amex, ING) — his own framing:
  ask once, then compute.
- **Enable Banking multi-account** after the MVP, not before.
- Disclaimers and terms belong at launch, not in the working screen.

## Decided 2026-08-17 — LaVega configures n8n itself

His choice: paste the n8n base URL and an n8n API key once, and let LaVega do the rest. What that
removes: exporting and importing the JSON, generating a token, creating the Header Auth credential,
copying the webhook URL into Koppelingen, and pressing "Ophalen".

**What can never be automated, in any option:** attaching the Gmail credential. Google's consent is
interactive by design, and n8n's public API deliberately does not expose a way to LIST credentials,
so LaVega cannot discover the one he already made and bind it. That stays a single manual step,
done once, and the UI must say so plainly rather than appearing to fail.

**The prerequisite he must set, and the reason this might not work at all:** n8n's REST API sends no
CORS headers by default, so a browser cannot call it cross-origin. On his own instance that is two
variables:

    N8N_DEFAULT_CORS=true
    N8N_CORS_ALLOW_ORIGIN=https://lavega.dev,http://localhost:5174

Keeping the call in the BROWSER is what preserves the posture: the n8n API key never touches the
LaVega server. Proxying it server-side would work around CORS but would park a key that can create
and modify workflows on a shared host — a worse trade than the manual paste it replaces.

So: build it browser-direct, and when CORS blocks it, **name those two variables in the error**
rather than reporting a generic failure. The manual paste stays as the fallback and must keep
working — it is the path that needs nothing from his n8n at all.

Shape: find-or-create the workflow by name → create the Header Auth credential with a generated
token → activate → read the production webhook URL back → store URL and token locally → pull the
queue on open and on a timer. The workflow JSON ships inside the web bundle, so the repo stays the
source of truth for what gets pushed.
