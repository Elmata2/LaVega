# LaVega — Plan 3: Enable Banking live sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Pull real bank data via Enable Banking (AIS, read-only) behind the existing `BankAccessAdapter` seam — list banks → connect (SCA) → sync accounts+transactions → same `ingest`→`consolidate`→overview pipeline as file import. Keep FileImport as a permanent parallel path.

**Architecture:** A local **Hono** server (`apps/server`) holds the Enable Banking credential (private key stays server-side — never the browser) and exposes `/aspsps`, `/auth`, `/callback`, `/sync`, `/forget`. A new `EnableBankingAdapter` (in `@lavega/adapters`, implementing the existing `BankAccessAdapter`) calls the local server and returns `{accounts, txs, source, problems}` — identical shape to FileImport, so `ingest`/`consolidate`/storage/UI are reused unchanged. Port the flow from the clean-room reference `server.mjs` (Enable Banking section) into typed TS.

**Tech stack:** Hono (Node), `node:crypto` (RS256 JWT — no crypto deps), TypeScript, Vitest.

## Global Constraints
- **Secrets NEVER in the repo.** `config.json` (applicationId), `state.json` (sessions/tokens), `*.pem` (private key) are already in `.gitignore` (Plan 1) — verify before any commit. Credential lives server-side only; the browser never sees the key.
- **Read-only (AIS) — no payment initiation.** Do not add PIS endpoints.
- **Keep FileImport.** This is an additional adapter, not a replacement (CSV covers uncovered banks — Amex, Trading 212 — and consent-expiry gaps).
- **Adapter parity.** `EnableBankingAdapter.load()` returns the exact `BankResult` shape FileImport does; `packages/core` stays I/O-free (the server + adapter do the I/O).
- Reuse from the reference `server.mjs`: `ebJWT` (RS256, `kid`=applicationId), `eb(method,path,body)`, `ebMapTx` (amount `transaction_amount.amount`, sign from `credit_debit_indicator` DBIT→negative, `remittance_information`→description), `ebAccountKey`, `ebFetchAll` (`continuation_key` pagination), CLBD-preferred balance (DBIT→negative).

## Gates (before the credential-dependent tasks can run/test end-to-end)
- **G1 — Enable Banking app credentials:** Alexander creates a **production** app via Enable Banking "Get Started" (own-use/non-commercial is allowed pre-contract by linking own accounts) → `applicationId` + downloaded `.pem` private key, a **public HTTPS** redirect URL whitelisted — via a tunnel (see next bullet); ⚠️ EB rejects `http://`, `localhost`, and `127.0.0.1`, so the redirect is the tunnel URL (`https://<tunnel-host>/api/eb/callback`), not localhost. Needed to RUN Tasks 3/5/6 against real banks. **User action.**
- **Public HTTPS via a TUNNEL (confirmed: EB production rejects `http://`, `localhost`, AND `127.0.0.1`).** The server stays plain **HTTP on localhost:8787** — a tunnel (cloudflared quick tunnel `cloudflared tunnel --url http://localhost:8787`, or an ngrok free **static** domain for a stable URL) provides the public HTTPS URL. Set `config.json` `redirectUrl` = `https://<tunnel-host>/api/eb/callback` and register that exact URL in the EB Control Panel. **No mkcert / HTTPS-on-localhost** — the tunnel terminates TLS (the Task-1 http scaffold is correct as-is). The redirect only needs to be live at connect/consent time (infrequent; consent lasts 90–180 days), so a changing quick-tunnel URL is just a re-register; a static/named tunnel avoids it. `redirectUrl` must match byte-for-byte between config and the Control Panel.
- **G2 — Real JSON sample (Tilisy `FREEEXPORT`):** validates the mapping against his actual banks' edge cases. Nice-to-have; `ebMapTx` already encodes the shape. **User action.**

Tasks 1, 2, 4 are **not gated** (buildable/testable now).

---

### Task 1: `apps/server` Hono scaffold + config loading  *(not gated)*
- Create `apps/server` (package.json with `hono`, `@hono/node-server`; tsconfig). Root `dev`/`build` wiring.
- Config loader: read `applicationId` + `privateKeyFile` + `redirectUrl` + `psuType` from `config.json` (git-ignored); on missing/`VUL-IN` placeholder, expose a `configured:false` status (don't crash). Port `readJSON` + the config shape from `server.mjs`.
- `/health` + a `/api/eb/status` route returning `{configured, applicationId: masked}`.
- Test: status route returns `configured:false` with no config present. Commit.

### Task 2: EB JWT + API client  *(not gated — test with a generated test key)*
- Port `ebJWT()` (RS256 via `node:crypto`, header `{typ:'JWT',alg:'RS256',kid:applicationId}`, `iss:enablebanking.com`, `aud:api.enablebanking.com`, exp +3600) and `eb(method, urlPath, body)`.
- Test: generate a throwaway RSA key (`crypto.generateKeyPairSync`), build a token, verify header/claims/signature with the public key (mirror Plan-1-era JWT test approach). Commit.

### Task 3: EB routes — aspsps / auth / callback / sync / forget  *(gated on G1 to run live; structure buildable now)*
- Port the five routes from `server.mjs`: `/api/eb/aspsps?country=` (list banks), `/api/eb/auth` (POST → `redirect_url` for SCA), `/api/eb/callback` (exchange → session), `/api/eb/sync` (POST → accounts + CLBD balance [DBIT→negative] + `ebFetchAll` transactions), `/api/eb/forget`.
- `/sync` returns `{accounts, txs, source, problems}` — per-account errors go in `problems` (one broken link doesn't block the rest).
- Sessions/tokens persist to `state.json` (git-ignored). Test the request/response shaping against a mocked Enable Banking API on a local port (mirror the reference's API-flow test approach); live verification deferred to G1.

### Task 4: Pure mapping `mapEbTransaction` / `mapEbAccount`  *(not gated — fully testable now)*
- Port `ebMapTx` and `ebAccountKey` into a pure, I/O-free module (in `@lavega/adapters` or `@lavega/core`): EB transaction JSON → `Omit<Tx,"id">` (amount `Math.abs(transaction_amount.amount)` × sign(DBIT→−1), currency, counterparty, `remittance_information`→description sliced, ISO date), and account JSON → `Account` (key via `ebAccountKey`, balance from CLBD/closingBooked, DBIT→negative, else null).
- **Unit-test against synthetic EB JSON** covering: DBIT vs CRDT sign, missing remittance (fallback to `bank_transaction_code.description`), CLBD-vs-first balance pick, multi-currency. Validate against the real Tilisy JSON (G2) when available and add fixtures. Commit.

### Task 5: `EnableBankingAdapter` (BankAccessAdapter impl)  *(gated on G1 to run; wiring testable now)*
- `createEnableBanking(serverBase)` implementing `BankAccessAdapter`: calls the local server's `/sync`, maps via Task 4's functions, returns the `BankResult`. Same interface FileImport satisfies → `ingest`/`consolidate`/storage unchanged.
- Test the adapter against a mocked server `/sync` response. Commit.

### Task 6: Web UI — "Live bankkoppeling"  *(gated on G1 for real SCA; UI + wiring buildable now)*
- Add a "Live bankkoppeling" section to `apps/web`: pick country → list banks (`/aspsps`) → **Verbind** (SCA redirect) → on return, **Synchroniseren** → adapter → `ingest` (dedups against existing incl. prior CSV imports via the same `tx.id`) → persist → overview. Reuse the existing single `ingest` path.
- Headless test of the sync→ingest→consolidate wiring (mock adapter). Commit.

## Self-Review checklist
- Secrets gitignored + never committed (config/state/pem). Read-only only. FileImport untouched. Adapter returns the exact `BankResult` shape. `tx.id` dedup coherent across CSV + API imports (same hash → re-syncs dedupe against prior CSV rows). `core` stays I/O-free.

## Notes
- Consent expires (PSD2 90–180 days) → re-`/auth` periodically; surface expiry in the UI.
- Coverage: Amex/Trading 212 likely uncovered → remain CSV-only (confirm via Tilisy). finAPI = a later second live adapter (reference `fa*` functions in `server.mjs`).
