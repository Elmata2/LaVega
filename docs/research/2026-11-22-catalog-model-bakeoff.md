# Catalogue sweep: Mistral model test

Date: 2026-11-22. Part of issue #371, slice 2. Scope:
`docs/catalog/watchlist.md`.

## Question

Which Mistral-hosted model can do the sweep's reading job (one figure per
product from a provider page or PDF), and at what cost? Owner decision,
2026-11-22: Mistral only, no Anthropic for the sweep.

## Method

- Answer key: the 114 covered `fxFeePct` and `interestPct` figures in
  `docs/catalog/catalog.json` with an http(s) source, from 86 documents.
- Documents fetched once on 2026-11-22 with the sweep's own readers. 9 of 86
  could not be fetched (5 HTTP 403, 2 HTTP 404, 2 network), so 98 figures were
  testable.
- Each model got the sweep's real prompt, tool schema and slicing, and its reply
  went through the sweep's real acceptance rules (`parseExtractReply`,
  `parseInterestReply`). Temperature 0, one pass per figure.
- The script is throwaway and not in the repo (`.superpowers/bakeoff/` in the
  worktree `catalog-bakeoff`).
- No Claude baseline: the Anthropic key in `apps/server/.env` is rejected, and
  the owner does not want Anthropic used here. The key figures themselves were
  Claude reads from June to August 2026.

## Result

|                                          | mistral-large-latest | mistral-medium-latest | magistral-medium-latest | mistral-small-latest |
| ---------------------------------------- | -------------------- | --------------------- | ----------------------- | -------------------- |
| FX fee (72): match                       | 33                   | 36                    | 35                      | 17                   |
| FX fee: accepted a different number      | 0                    | 0                     | 0                       | 1                    |
| Interest (26): match                     | 11                   | 7                     | 8                       | 5                    |
| Interest: accepted a different number    | 5                    | 6                     | 6                       | 2                    |
| of those, real model errors (see below)  | 0                    | 1                     | 1                       | 0                    |
| Right number, conditions not established | 12                   | 16                    | 17                      | 8                    |
| Declined ("not stated on this page")     | 34                   | 31                    | 31                      | 61                   |
| Cost for the whole set                   | $1.13                | $0.99                 | $0.99 (price assumed)   | $0.09                |
| Median time per figure                   | 29.5 s               | 2.1 s                 | 1.3 s                   | 2.5 s                |

`zai-glm-5-3` (open-weight, hosted by Mistral) was stopped at 27 of 98: slow
(25 s median), the most expensive per figure ($0.037), and it declined 18 of 27.

Prices: `docs.mistral.ai/inference/pricing`, read 2026-11-22 (Large 4 $0.7 /
$2.1, Small 4 $0.15 / $0.6 per million tokens in / out). Medium from
`apps/server/src/agent/pricing.ts` ($1.5 / $7.5); no public price found for
Magistral, assumed equal to Medium.

## The "different number" cases are mostly the catalogue being out of date

Every accepted answer carries a quote that the parser verified against the
fetched page. Read against today's pages:

| Product                              | Catalogue                         | Page today                     | Verdict                                                                      |
| ------------------------------------ | --------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| Klarna Flex rekening                 | 1,95% (2026-08-19)                | "Krijg 2,20% rente"            | catalogue stale                                                              |
| Nationale-Nederlanden Internetsparen | 1,30% (2026-08-19)                | "€ 0 t/m € 10.000 1,70%"       | catalogue stale, tiers changed too                                           |
| Santander spaarrekening              | 2,10% (2026-08-19)                | "basisrente, momenteel 2,20 %" | catalogue stale                                                              |
| Triodos Internet Sparen              | 1,15% (2026-08-19)                | "1,25% … sinds 01-11-2026"     | catalogue stale                                                              |
| Scalable Overnight                   | 2,50% (2026-08-19)                | "2,60% rente p.j."             | catalogue stale (large only read it)                                         |
| Centraal Beheer RentePlus            | 1,50% (2025-07-10)                | "€ 0 t/m € 25.000 1,80%"       | catalogue stale                                                              |
| NIBC Kwartaalspaarrekening           | 1,60% (1,20 base + 0,40 bonus)    | same                           | medium and magistral reported 1,20 (base only): model error, on the low side |
| ING Platinumcard FX fee              | 0% up to € 1.000 a month, then 2% | same                           | small reported 2%: model error                                               |

So six savings rates in the live catalogue are out of date today, and the
models read the current ones correctly. `mistral-large-latest` made no real
error; `mistral-medium-latest` made one.

## What the test does not show

- How Claude would score on today's pages. About a third of the figures were
  declined by every model; for 15 figures the key number is not in today's
  fetched text at all (page changed, or needs JavaScript). Part of the decline
  rate is the documents, not the models.
- Run-to-run stability. One pass per figure.
- Fee, points and cashback (slice 3 fields).

## Recommendation

`mistral-large-latest` for the weekly sweep. Same cost as medium (about $1 a
full run, about $5 a month), best on savings rates, no accepted wrong figure.
It is slower (30 s a figure), which a weekly offline job with a 45-minute limit
can absorb at concurrency 3 to 4. `mistral-medium-latest` is the alternative if
run time becomes a problem. `mistral-small-latest` is too weak for this job.

## What changed after the test

- The reader (`r.jina.ai`) recovers blocked pages and JavaScript pages that plain fetch could not read.
- A truncated model reply (the 8192-token limit) was counted as "declined" in this test. The decline counts in the
  table above are therefore partly truncation, not refusal.
- American Express is read from its agreement PDF once the document of record is tried first.
