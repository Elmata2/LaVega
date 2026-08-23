# LaVega

LaVega — local-first personal finance agent. See `docs/CONTEXT.md`.

Production deployment and the `lavega.dev` Cloudflare connection are documented
in [DEPLOY.md](DEPLOY.md).

Self-hosted investing Docker deployment is documented in
[docs/investing/DOCKER.md](docs/investing/DOCKER.md).

## Getting started

```bash
pnpm install
pnpm test
pnpm dev
```

## Credits

LaVega's Interactive Brokers Flex Web Service client is adapted from
[gloomberb](https://github.com/gloom-sh/gloomberb) (MIT). See
[NOTICE](NOTICE) for the full list of vendored third-party code.
