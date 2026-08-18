# gloomberb

Vendored from [gloom-sh/gloomberb](https://github.com/gloom-sh/gloomberb),
commit [`0dafb31`](https://github.com/gloom-sh/gloomberb/commit/0dafb31), MIT licensed.

Source: `src/plugins/ibkr/flex/statement-client.ts` and `src/utils/http-transport.ts`.

Only IBKR's Flex Web Service request/poll client — the `SendRequest` →
`GetStatement` cycle, backoff, and IBKR's error envelope. `flex/index.ts`
(XML parsing into Gloomberb's own `BrokerPosition`/`BrokerAccount` types) was
**not** vendored: it's bound to Gloomberb's own multi-broker type graph and
doesn't parse the Trades section LaVega needs, so it's out of scope for
verbatim vendoring per [#36](https://github.com/Elmata2/LaVega/issues/36).
LaVega's own Flex XML parsing (positions + trades, mapped to
`BrokerAccessAdapter`'s `Position`/`Trade`) lives in
`src/brokers/ibkr/flexParser.ts`; the adapter is in `flexAdapter.ts`.

## What changed

`statement-client.ts`'s original `../config` import pulled in
`FlexQueryConfig` alongside IBKR Gateway/TWS API config types LaVega has no
use for (v1 is Flex-only, see `CONNECTORS.md`). That import was replaced with
an inline `FlexQueryConfig` interface and `IBKR_STATEMENT_URL` constant,
copied verbatim from `gloomberb`'s `src/plugins/ibkr/config.ts`. LaVega also
removed the module-level statement promise cache and added optional poll timing
overrides so callers and tests own request lifetime and timing.

`http-transport.ts` is unchanged.

## Why this ports cleanly

No Bun coupling — `httpFetch` falls back to `globalThis.fetch`. Runs on Hono
or Cloudflare Workers unchanged.
