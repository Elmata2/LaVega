# Self-host investing side with Docker

Build and start investing dashboard and API as one container:

```bash
docker build -f Dockerfile.investing -t lavega-investing .
docker run --rm -p 8788:8788 lavega-investing
```

Open `http://localhost:8788`. Container has no LaVega account, hosted LaVega service, or project-owned API key. Missing optional keys degrade to a clear status response. Yahoo Finance and Frankfurter work without a key; market-data consent is requested in dashboard before Yahoo requests.

Set configuration with environment variables when needed:

```bash
docker run --rm -p 8788:8788 \
  -e PORT=8788 \
  -e SENTRY_DSN=https://example@o0.ingest.sentry.io/0 \
  -e ANTHROPIC_API_KEY=... \
  -e MARKET_DATA_API_KEY=... \
  lavega-investing
```

`PORT` changes listening port. `SENTRY_DSN`, `ANTHROPIC_API_KEY`, and `MARKET_DATA_API_KEY` are optional. Broker credentials use the existing local credential seam; provide broker-specific configuration through its environment variables when an adapter is enabled. Do not put secrets in image layers or source control.

The image uses in-memory server stores in this first local slice. Treat container replacement as data loss until a persistent storage backend is configured. No Workers deployment is included here.
