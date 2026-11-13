# Instrument identifiers: OpenFIGI resolution and candidate selection

An investing holding must resolve to a symbol a price provider recognises before
it can be priced. Identifiers resolve through OpenFIGI (unauthenticated, paced to
25 requests/min with a 2.5 s floor, successful resolutions cached). This page
describes the resolution ladder added in
[#136](https://github.com/Elmata2/LaVega/issues/136) (Jev-03).

## Resolution ladder

Most trusted first. The tier is stored with the resolution, together with the
selector's confidence and the provider's full candidate set.

| Tier             | Decided by                                               | Model call   |
| ---------------- | -------------------------------------------------------- | ------------ |
| `owner-override` | The owner's own symbol choice for that ISIN              | no           |
| `provider`       | One candidate, or an ambiguous set when selection is off | no           |
| `model`          | Jev picked one of the provider's candidates              | one `Choice` |
| `unresolved`     | No candidate, or the selector refused / failed           | maybe        |

- **One candidate is taken as-is** with zero model calls.
- **A broker venue chooses among listings.** A request may carry
  `instrument.venue`, the execution venue a broker printed as a MIC (DeGiro's
  `Uitvoeringsplaats`, e.g. `XAMS`). The provider maps it to OpenFIGI's exchange
  code (`identifier/exchanges.ts`) and, when two or more candidates include
  exactly one listing on that exchange, takes that candidate with no model call.
  An unknown MIC or no matching candidate falls through to the ladder below. The
  hint adds no OpenFIGI request; it only picks from an answer already in hand.
- **Zero candidates** keeps the existing unresolved outcome and problem string.
- **Two or more candidates** go to Jev only when selection is allowed (below).
  Jev receives the provider's candidate set plus the broker's instrument identity
  (name, description, currency, ISIN) and either picks one option or answers the
  explicit **none of these candidates** option.
- **The chosen candidate's fields are copied verbatim.** The provider refuses an
  answer that names a ticker outside the candidate set, and nothing is
  reconstructed. A refusal leaves the identifier unresolved, exactly as before.
- **A low-confidence pick still resolves**, marked with its confidence, so the
  owner can see that the identity was decided rather than reported. The
  placeholder threshold is `IDENTIFIER_SELECTION_CONFIDENCE_THRESHOLD` (0.6),
  set to be measured on the owner's real data.
- **Caching:** a selected resolution is cached with its tier/confidence/candidate
  set. A refusal, a selector failure and a provider failure are **not** cached:
  the next run asks again. Selection adds no OpenFIGI requests.
- **Owner override** is checked before the cache, so changing or removing it
  takes effect immediately and outranks a stored model selection. It is stored
  per tenant as `{isin: {ticker, exchange?}}`.

## Consent and enablement

Selection is off by default and needs both:

1. **Market-data consent** for the account (the same Yahoo Finance consent the
   price sync needs), and
2. **the owner's identifier-selection switch**, per tenant, default off —
   `GET/PUT /api/investing/identifier-selection`. A configured
   `TYPESAFE_API_KEY` alone never turns it on: selection sends an instrument's
   identity to an external model, so the account decides.

Without both, the provider behaves exactly as before #136: an ambiguous set
takes the first candidate (recorded with its full candidate set for audit), no
model is called, and nothing new is sent anywhere.

`GET/PUT /api/investing/identifier-overrides` reads and writes the owner's own
symbol choice per ISIN. Input is normalized (ISIN and ticker upper-cased,
unknown rows dropped, at most 500 entries).

## Jev call and spend

The selector is one `Choice` question over the provider's options, with the
explicit none option. It runs through the shared System One client
(`apps/investing-server/src/systemOne.ts`), so:

- the AI usage ledger gets a row on route `identifier-selection`, including
  failed calls at the ceiling;
- the shared budget gate applies, with this route's own worst-case ceiling
  (`IDENTIFIER_SELECTION_WORST_CASE_CENTS`, 2 euro cents);
- rate limiting, pacing and retry are unchanged — the model call happens after
  OpenFIGI answered, and adds no OpenFIGI request.

## What is not durable

The resolution record (tier, confidence, candidate set) lives in the provider's
in-process cache. It is returned to callers and used for the owner-facing audit,
but it is not yet a durable table: a restart forgets it and the next sync
re-resolves. A durable resolution audit is the follow-up; the price-store
contract was deliberately not extended here.

## Tests

- `packages/adapters/src/market-data/identifier/openFigiProvider.test.ts`:
  one candidate → zero selector calls; zero candidates → existing problem; a
  selected ticker must be a member of the candidate set; no-match → unresolved
  with the existing shape; a selection is cached and a refusal is not; an owner
  override outranks a stored model selection; existing retry/rate-limit tests
  pass unchanged.
- `apps/investing-server/src/identifierSelector.test.ts`: option set is the
  provider's candidates plus none; verbatim selection; none → no-match; an answer
  outside the option set → failure; invalid confidence refused; state carries
  identity only.
- `apps/investing-server/src/app.test.ts`: the gate is consent AND the switch;
  the override is passed to the seam; both routes persist and validate.
- `apps/investing-server/src/identifierSelectionStore.test.ts`: override
  normalization, cap and tenant isolation.
- `packages/database/src/migrations.test.ts`: the two preference columns.
