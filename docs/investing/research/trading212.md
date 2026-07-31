# Trading 212 — Integration Feasibility Research

Research for GitHub issue #9 ("Research: Trading 212 integration feasibility"), child of the
investing-connector-strategy wayfinder issue #1.

**Sourcing note:** All factual claims below are sourced from Trading 212's own official public
API documentation site, `https://docs.trading212.com/api` (a Redocly/Gatsby single-page app).
The rendered HTML of that URL is a JS app shell with no content in the initial payload; the
actual documentation markdown is served by Gatsby's page-data mechanism at
`https://docs.trading212.com/page-data/api/page-data.json`, which was fetched directly and is
the primary source quoted throughout this document. Every claim is labeled **[Verified]** (found
verbatim or near-verbatim in that primary source), **[Inferred]** (a reasonable conclusion drawn
from the primary source but not stated outright), or **[Unverified/Not found]** (could not be
confirmed from the primary source reviewed; flagged rather than guessed at). The older/legacy
`https://t212public-api-docs.redoc.ly/` URL was also fetched but is not used as a citation source
here — it is a legacy Redoc-hosted spec page, not confirmed to be current, and the live
`docs.trading212.com` site is treated as canonical.

---

## 1. Is there an official public API? What state is it in (beta / GA / waitlist)?

**[Verified]** Yes. Trading 212 publishes an official public API with documentation at
`https://docs.trading212.com/api`, titled "Trading 212 Public API". The docs' own metadata marks
its status as **`"Beta"`**, and the overview page states explicitly:

> "This API is currently in **beta** and is under active development. We're continuously adding
> new features and improvements, and we welcome your feedback."

There is no waitlist or access-request gate described anywhere in the docs — access is via
self-service API key generation from within the Trading 212 app (see §3). This contradicts the
premise in `docs/CONTEXT.md` that Trading 212 support is necessarily file-import-only; an
official, self-service, beta-status API does exist.

**[Verified]** Scope restriction: "The API described here is enabled and usable only for
**Invest and Stocks ISA** account types." Other Trading 212 account types (e.g. CFD) are not
mentioned as supported.

**[Verified]** Two environments are provided:
- Paper Trading (Demo): `https://demo.trading212.com/api/v0`
- Live Trading (Real Money): `https://live.trading212.com/api/v0`

**[Verified]** Known limitations stated in the docs:
- Orders can be executed only in the **primary account currency**.
- **Multi-currency accounts are not currently supported** through the API — account, position,
  and result values in responses are all in the primary account currency.
- Sell orders require a **negative** `quantity` value (e.g. `-10.5`) — a core API convention.

## 2. Does the API expose actual positions (holdings, quantities, avg price) and trade/order
history — not just cash movements?

**[Verified]** Yes for trade/order history. The docs explicitly document a paginated orders
history endpoint:

```
GET /api/v0/equity/history/orders
```

used in the docs' own pagination walkthrough, with example item shape:

```json
{ "id": 987654321, "ticker": "AAPL_US_EQ", ... }
```

(The `...` is in the source docs itself — the full field list for an order item was not shown in
the overview page and would require the per-endpoint reference page, which was not independently
retrieved in this pass — see "Open questions" below.)

**[Verified]** The docs also state, in the same breath as orders, that "historical orders,
dividends, and transactions" are all list endpoints using the same cursor-based pagination
mechanism — implying (but not explicitly naming/URLing in the overview text) dedicated
dividends-history and transactions-history endpoints in addition to orders-history.
**[Inferred]** their paths likely follow the same `/api/v0/equity/history/...` naming pattern as
orders, but the exact paths were not confirmed in the primary source reviewed.

**[Verified]** An account summary endpoint exists and is demonstrated end-to-end in the
Quickstart section:

```
GET /api/v0/equity/account/summary
```

This is the only endpoint whose full request is shown as a worked example (`curl` with Basic
Auth). Its response schema/fields were not shown in the overview text, so whether "summary"
includes current open positions (quantities, average price) or is limited to cash/portfolio
totals is **[Unverified/Not found]** in the source reviewed — plausible given the name and the
product's own account-summary screen, but not directly confirmed.

**[Unverified/Not found]** A dedicated, separately-named positions/portfolio-holdings endpoint
(e.g. something like `/equity/portfolio` or `/equity/positions` returning per-ticker open
quantity and average price) was not explicitly named anywhere in the overview page content
captured. Given the product clearly has this data (it's core to the app itself) and the docs
mention "position ... values in the responses" in the multi-currency limitation note — implying
at least one response payload includes position-level fields — it is **[Inferred]** highly likely
such an endpoint exists, but its exact name/path/fields could not be confirmed from the source
reviewed in this pass. This should be verified against the full OpenAPI reference/endpoint list
before implementation (the reference pages are linked from the docs site's sidebar but were not
independently fetched here).

**Conclusion vs. `docs/CONTEXT.md`:** The existing claim that "Trading 212 = cashflows only
(deposits/withdrawals/dividends), not securities trades" is accurate **for the CSV file-export**
Trading 212 offers (which is what that line in CONTEXT.md is about), but is **not** true of the
official API — the API does expose order/trade history via `/api/v0/equity/history/orders`. This
is an important distinction: file-import and API access are two different capability surfaces for
the same broker, and CONTEXT.md's claim should be scoped explicitly to "file import" if API
integration is pursued later.

## 3. What is the auth model? How is a key obtained/scoped, and is read-only available?

**[Verified]** Authentication is **HTTP Basic Auth** over an API key pair, not OAuth:

> "You must provide your **API Key** as the username and your **API Secret** as the password,
> formatted as an HTTP Basic Authentication header."

The header value is `Basic <base64(API_KEY:API_SECRET)>`. The docs give worked bash and Python
examples for constructing it.

**[Verified]** Keys are self-service, generated from within the Trading 212 mobile/web app itself
(not requested from Trading 212 support or via a developer portal). The docs link out to a Help
Centre article for instructions: "How to get your Trading 212 API key"
(`https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key`). This
Help Centre article's exact content (e.g. whether scoping/permission checkboxes exist in the UI
when generating a key) was not independently fetched/verified in this pass —
**[Unverified/Not found]** for the specific granular-permission options available at key-creation
time.

**[Verified]** IP restriction is available as an optional security feature: "you can optionally
restrict your API keys to a specific set of IP addresses from within your Trading 212 account
settings."

**[Unverified/Not found]** Whether a strictly **read-only** key mode/scope exists (i.e. a key that
cannot place orders even if the underlying account supports trading) was not stated anywhere in
the overview content captured. This is an open question that matters for LaVega given the
project's hard constraint of read-only bank/broker access — it needs explicit verification against
the Help Centre article and/or the key-generation UI in the Trading 212 app before any
integration work begins, since the general-purpose key documented here appears able to place
orders (the docs discuss order placement and the "negative quantity for sell" convention as a
core capability, not as a separate scope).

## 4. What are the documented rate limits per endpoint?

**[Verified]** Rate limiting exists, is applied **per account** — not per API key or per IP:

> "All rate limits are applied on a per-account basis, regardless of which API key is used or
> which IP address the request originates from."

**[Verified]** Every response carries standard rate-limit headers:
- `x-ratelimit-limit` — total requests allowed in the current period
- `x-ratelimit-period` — duration of that period, in seconds
- `x-ratelimit-remaining` — requests left in the current period
- `x-ratelimit-reset` — Unix timestamp when the limit fully resets
- `x-ratelimit-used` — requests already made in the current period

**[Verified]** Bursting within a period is explicitly allowed — a "50 requests per 1 minute"
limit does not mean one call every 1.2s; you can burst all 50 in the first few seconds and then
must wait for reset, or pace evenly.

**[Verified]** One concrete function-specific (non-HTTP-rate) limit is named: a maximum of **50
pending orders per ticker, per account**.

**[Unverified/Not found]** The overview page states plainly that "Specific rate limits are
detailed in the reference for each endpoint" — i.e. the actual numeric limit/period per endpoint
(e.g. what the limit is for `/equity/account/summary` vs. `/equity/history/orders`) lives on
per-endpoint reference pages that are part of the same docs site but were **not** independently
retrieved in this research pass (this was time-boxed; an attempt to pull the underlying OpenAPI
spec JSON via the site's shared-data mechanism did not succeed — see "Method notes" below). This
must be treated as an open item, not guessed at, before any polling-interval commitment is made
in an implementation.

## 5. What's a realistic sync model — polling interval, or any webhook/push option?

**[Inferred]** Polling only, based on the totality of what the docs describe: rate-limit headers
designed for pacing "one call every N seconds," cursor-based pagination for list endpoints
(orders/dividends/transactions) intended to be paged through, and no mention anywhere in the
captured docs content of webhooks, callbacks, push notifications, or streaming/subscription
endpoints. This should be read as **"not found in the source reviewed"** rather than a definitive
"Trading 212 does not offer push/webhooks" — the reference/endpoint pages beyond the overview were
not fully enumerated, and it's possible a webhook feature exists but wasn't mentioned in the
overview/quickstart/auth/rate-limit/pagination sections that were captured.

**[Verified]** Pagination mechanics (relevant to sync design): cursor-based, `limit` param default
20 / max 50, `cursor` param, and a `nextPagePath` field in each list response — either `null`
(no more pages) or a ready-to-use next-request path string that already embeds `limit` and
`cursor`. This is straightforward to implement as an incremental sync: page through
`/equity/history/orders` (and, once confirmed, dividends/transactions) since the last-seen cursor
or order id, similar in shape to the existing Enable Banking `continuation_key` pagination
pattern already used elsewhere in this codebase.

**[Inferred]** Realistic sync model for LaVega, pending the open rate-limit-numbers question in
§4: a periodic poll (e.g. on-demand refresh triggered by the user, or a background poll on the
order of minutes-to-hourly) against `/equity/history/orders` (+ dividends/transactions once
confirmed) using the cursor/`nextPagePath` mechanism to fetch only new items since last sync, plus
occasional calls to an account-summary/positions endpoint for current holdings snapshot. Exact
safe polling frequency cannot be stated with confidence until the per-endpoint numeric rate limits
are pulled from the reference pages.

## Auth/key summary relevant to LaVega's read-only constraint

LaVega's hard constraint #3 requires read-only access with no payment/order initiation. Trading
212's documented API is explicitly a **trading** API (it documents placing orders, including the
sell-quantity convention) authenticated via a single Basic-Auth key pair, and the docs found in
this pass did not surface a distinct "read-only" key scope. **[Unverified/Not found]** — this is
the single most important open question to resolve before pursuing a Trading 212 API integration,
since if no read-only scope exists, the API key would have to be treated as an object holding
write/trading capability even if LaVega itself never calls the order-placement endpoints, which
is a materially different risk profile than the read-only bank aggregation LaVega otherwise does.
This should be confirmed via the Help Centre "API key" article and/or by generating a key in the
app and inspecting the permission options offered before implementation.

## Method notes (for future researchers continuing this work)

- The canonical docs page `https://docs.trading212.com/api` is a client-rendered Gatsby SPA; the
  initial HTML has no content. The actual page markdown is served from Gatsby's page-data
  endpoint at `https://docs.trading212.com/page-data/api/page-data.json`, under
  `props.metadata.description`. That JSON blob is the primary source this document is built on.
- The docs reference an underlying OpenAPI spec (`sharedDataIds.openAPIDocsStore: "oas-api.json"`)
  which would contain the full, exhaustive per-endpoint schema (all paths, request/response
  fields, and per-endpoint rate limits). Multiple guesses at its fetch URL (e.g.
  `/_shared-data/oas-api.json`, `/shared-data/oas-api.json`, `/api/oas-api.json`, etc.) all
  returned the generic SPA shell or 404, and a scan of the site's downloaded JS bundle for the
  shared-data fetch mechanism did not turn up the answer either. **Recommended next step** if this
  research is picked back up: use a real headless browser (e.g. via the `/browse` skill) to load
  `https://docs.trading212.com/api`, let the Gatsby app hydrate, and either read the rendered
  sidebar's per-endpoint pages directly, or inspect the network tab for the actual shared-data
  fetch URL/mechanism, to pull the full OpenAPI spec and resolve the two flagged open questions
  (exact positions-endpoint name/fields, per-endpoint numeric rate limits, and — most importantly
  for LaVega — whether a read-only key scope exists).
- Legacy URL `https://t212public-api-docs.redoc.ly/` was fetched (~17KB HTML) but not relied on
  as a citation source in this document, since it's unclear whether it reflects the current beta
  API or an older version.

## Sources

- `https://docs.trading212.com/api` (canonical URL; content actually retrieved via
  `https://docs.trading212.com/page-data/api/page-data.json`) — General Information, Quickstart,
  Authentication, Rate Limiting, Pagination, Useful Links sections.
- `https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key` —
  linked from the docs as the key-generation guide; not independently fetched/verified in this
  pass, flagged above where relevant.
- `https://www.trading212.com/legal-documentation/API-Terms_EN.pdf` — linked from the docs'
  "Useful Links" section; not fetched/reviewed in this pass.
- `https://community.trading212.com/` — linked from the docs' "Useful Links" section as a support
  forum; not used as a factual source here.
