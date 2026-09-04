# Self-host investing side with Docker

Build and start investing dashboard and API as one container:

```bash
docker build -f Dockerfile.investing -t lavega-investing .
docker run --rm -p 8788:8788 lavega-investing
```

Open `http://localhost:8788`. Container has no LaVega account, hosted LaVega service, or project-owned API key. Missing optional keys degrade to a clear status response. Yahoo Finance and Frankfurter work without a key; market-data consent is requested in dashboard before Yahoo requests.

Mount `/data` to keep cached prices and encrypted broker credentials across container replacement. Default files are `/data/prices.json` and `/data/credentials.json`; override them with `INVESTING_PRICE_STORE_FILE` and `LAVEGA_VAULT_FILE` when needed:

```bash
docker run --rm -p 8788:8788 -v lavega-investing-data:/data lavega-investing
```

Set configuration with environment variables when needed:

```bash
docker run --rm -p 8788:8788 \
  -e PORT=8788 \
  -e LAVEGA_VAULT_PASSPHRASE=... \
  -e SENTRY_DSN=https://example@o0.ingest.sentry.io/0 \
  -e LAVEGA_AGENT_API_KEY=... \
  -e LAVEGA_AGENT_MODEL=openai/gpt-5-mini \
  -e LAVEGA_AGENT_BASE_URL=https://openrouter.ai/api/v1 \
  lavega-investing
```

`PORT` changes listening port. `SENTRY_DSN` and `LAVEGA_AGENT_*` are optional. Broker credentials stay encrypted in credential vault.

After process restart, encrypted vault is locked. Open **Broker koppelen** and enter only vault passphrase to unlock it. Broker API keys do not need re-entry. Last successful positions, trades, and dividends stay inside same AES-GCM vault and restore after unlock; cached sync cannot erase them. For unattended sync, set `LAVEGA_VAULT_PASSPHRASE`; runtime unlocks vault and restores broker data during startup. Environment value is plaintext secret outside encrypted vault, so use container/Railway secret storage. Never put it in image layer or source control.

The Docker runtime stores price bars in local JSON and broker credentials/data in encrypted vault JSON. No Workers deployment is included here.
