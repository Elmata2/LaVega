# Yahoo Finance as the default local/self-hosted price source, despite its Terms of Service

Every market-data provider researched ([#18](https://github.com/Elmata2/LaVega/issues/18)) either failed on price, on European coverage, or on licence terms — Yahoo Finance's unofficial API was the one exception researched *out* of the default position, since its Terms of Service prohibit automated access and prohibit using its content to build a database or data feed. The obvious path was therefore to make it opt-in, gated behind a consent screen the user has to click through before the app works at all.

We reversed the provider decision ([#34](https://github.com/Elmata2/LaVega/issues/34)): Yahoo is the **default** local/self-hosted price source. A self-hoster querying Yahoo from their own machine, on their own IP, for their own portfolio still carries the ToS exposure. Yahoo also happens to cover what LaVega needs for free and without a key: Euronext Amsterdam, XETRA, Paris, and London are all reachable by ticker suffix, along with indices and FX pairs.

## Considered options

- **Direct local API access** — chosen for the local/self-hosted tier because owner controls deployment and requested no consent popup or browser gate.
- **Default off, EODHD as the out-of-the-box source** — rejected; EODHD costs ~€19.99/mo and needs a bring-your-own key, which fails the "usable on a free key" bar the local tier holds itself to. EODHD remains available as an optional paid alternative ([#37](https://github.com/Elmata2/LaVega/issues/37)).

## Consequences

- This applies to the **local/self-hosted tier only**. The hosted paid tier must never use Yahoo — serving Yahoo-derived prices to paying customers is redistribution, which the ToS prohibits outright, and a single server IP serving many customers is exactly the traffic shape Yahoo blocks in practice. The hosted tier uses marketstack instead ([#35](https://github.com/Elmata2/LaVega/issues/35)).
- Yahoo's endpoints are undocumented and reverse-engineered — access requires scraping a session cookie/crumb token from `query2.finance.yahoo.com/v1/test/getcrumb` — and can break or get rate-limited/IP-blocked without notice. Browser access is not consent-gated; hosted deployments must use another provider.
