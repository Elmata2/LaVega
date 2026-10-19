# Security stress test — 2026-10-17

Method: six parallel adversarial agents, one per attack surface, each scoped to
**local/dev only** and **read-only** on source. The lead then re-verified every
HIGH and MEDIUM claim against the code and against the local migrations; those
re-checks are marked **(lead-verified)**.

- Commit: `433f7a05f` (branch `master`), clean tree.
- Domains: A1 auth/session/tenant/CSRF/GDPR · A2 injection/SSRF · A3 crypto/secrets ·
  A4 web + extension · A5 email worker + OAuth · A6 runtime/supply chain.
- Result: **0 critical, 3 high, 14 medium, ~20 low.**
- Deploy note: production is Vercel (`DEPLOY.md`). Findings that depend on the
  long-lived Docker/Railway `pnpm start` path are flagged; on Vercel the static
  rewrite `/investing/(.*) → /investing/index.html` neutralizes the H1 alias.

---

## High

### H1. Unauthenticated investing API via the `/investing/api/*` alias
- File: `apps/server/src/index.ts:317,334`; `apps/investing-mount.ts:198-201`
- Evidence: `app.all("/investing/*", toInvestingStatic)` where
  `toInvestingStatic = (c) => forwardInvesting(c.req.raw)` and
  `forwardInvesting(request, tenantId = LOCAL_TENANT_ID)`. `apiGuard` is mounted on
  `"/api/*"` only (`index.ts:177`). `rewriteInvestingRequest` strips `/investing`
  (`investing-mount.ts:191-196`), so `/investing/api/<ns>/…` is served by the
  investing app under tenant `local` with **no session**.
- Impact: the documented invariant "every `/api/*` route behind a session"
  (`DEPLOY.md:109-119`) is false for this alias. Unauthenticated reads
  (summary, config/broker status) and writes (purge price cache, market-data
  consent, create broker vault, trigger sync) land on tenant `local`. Real-user
  rows are keyed by `session.user.id`, so on a hosted deploy `local` holds no
  other user's data; a self-host where `local` holds the real data is fully
  exposed.
- Verified: lead read the mount + rewrite path; A1 additionally ran the real app
  locally (`/api/investing/summary` → 401, `/investing/api/investing/summary` → 200)
  and confirmed `INVESTING_MOUNT=1` in `vercel.json:8` and `Dockerfile:46`.
- Fix: register the guard on both prefixes
  (`app.use(["/api/*","/investing/api/*"], apiGuard())`), or split the mount so
  `toInvestingStatic` serves only non-`api` SPA paths, or remove the
  `= LOCAL_TENANT_ID` default from `forwardInvesting`.

### H2. Spoof gate bypassable — sender-injected `Authentication-Results`, first match wins
- File: `apps/email-worker/src/authResults.ts:54-73`; `apps/email-worker/src/handler.ts:247`
- Evidence: `resultFor` matches the **first** `spf=|dkim=|dmarc=` anywhere in the
  **whole** header value; the sender's own `Authentication-Results` header is
  joined by `Headers.get()` ahead of the real one. The prior review
  (`docs/reviews/2026-09-07-interrogate-security-merge.md`, item 4) added the
  `dmarc=fail` reject but explicitly deferred authserv-id filtering — that
  deferred half is this finding.
- Impact: a mail with `From: facturen@ing.nl` and a forged
  `Authentication-Results: … dmarc=pass` is accepted when Cloudflare does not
  emit its own header, or emits it after the forged one. Defeats the M6 gate;
  queues fake invoices and spends the owner's Claude extraction budget.
- Verified: lead read the parse + join behavior; A5 proved with a local node run
  that `Headers.get` joins duplicates with `", "` and the module regex returns
  the attacker's first segment.
- Fix: parse only the segment whose `authserv-id` is the trusted MTA
  (`mx.cloudflare.net`); fail closed when no trusted segment is found; treat
  `dkim=`/`dmarc=` whose `header.d=`/`header.from=` does not align with `From:`
  as a mismatch.

### H3. Rate limiter — unbounded key growth + per-key bypass (unauth DoS)
- File: `apps/server/src/agent/rateLimit.ts:19-34`; `apps/server/src/index.ts:181-189`
- Evidence: `hits` is a process-lifetime `Map`; `guard` scans **every** entry on
  **every** call (`for (const [k, arr] of hits) … hits.delete(k)`, line 24) → O(n)
  per request. The public `POST /api/auth/sign-up/email` keys on
  `rateLimitKey("sign-up", undefined, x-forwarded-for)`, which takes the
  **rightmost** XFF entry and trusts it (`rateLimit.ts:52-63`). A caller rotating
  `X-Forwarded-For` mints a fresh bucket per request: the 5/10-min signup limit
  never fires, and `hits` grows without bound.
- Impact: signup/verification-email abuse plus CPU + memory exhaustion of the
  public API instance from an unauthenticated caller.
- Verified: lead read `rateLimit.ts`; A6 read the call site + grep.
- Fix: bound `hits` (max keys / LRU), derive the IP from a trusted-proxy header
  only, and/or move counters to a shared store; add a global body/connection cap.

---

## Medium

### M1. No request-body size limit on any route (DoS)
- `apps/server/src/agent-routes.ts:221` and other JSON handlers;
  `apps/server/src/index.ts` registers no `bodyLimit`. Public handlers parse
  bodies (`/api/auth/*`, `/api/eb/callback`, `/api/card-terms/ingest`).
  A large POST to a public JSON endpoint is buffered whole → memory exhaustion.
- Fix: Hono `bodyLimit` middleware (e.g. 1 MB) on `/api/*` before routes.
  (Found independently by A2 and A6.)

### M2. GDPR erasure misses `personal.ai_usage` **(lead-verified)**
- `packages/database/src/index.ts:1242-1265` — `USER_DATA_TABLES` has 20 entries
  and no `personal.ai_usage`. That table gained `user_id` in
  `db/migrations/0013_ai_usage_user_id.sql:24`, so it is per-user data now, but
  `0005_ai_usage.sql:20-26` still has no RLS and the migration test asserts the
  stale "aggregate, not per-user" rationale (`migrations.test.ts:103`).
- Impact: incomplete art. 17 erasure while the route reports success.
- Fix: add `"personal.ai_usage"` to `USER_DATA_TABLES` (or NULL the `user_id`),
  add RLS, and update the migration test's rationale.

### M3. "Erase my data" does not erase the account **(lead-verified)**
- `apps/server/src/account-routes.ts:29-45`; note at
  `packages/database/src/index.ts:1289-1292`. The route deletes application rows
  only; the Better Auth `user`/`session`/`account` rows survive, the password
  still authenticates, and a fresh sign-in recreates a vault. UI copy claims full
  erasure.
- Fix: revoke sessions and delete the Better Auth user, or return a distinct
  "deletion pending" state.

### M4. Destructive GET reachable cross-site — `GET /api/n8n/queue` **(lead-verified)**
- `apps/server/src/n8n-routes.ts:48,92` — the route's own comment calls it "the
  only outbound call whose upstream deletes what it returns"; the cookie is
  `sameSite:"lax"` (`auth.ts:67`) and Lax still sends it on a top-level GET.
- Impact: an attacker link drains the victim's invoice queue; the invoices are
  consumed and lost.
- Fix: make the drain a POST and add a same-origin `Origin`/`Sec-Fetch-Site`
  check on state-changing requests.

### M5. `personal.ai_usage` has no RLS; `reconcile`/`release` match by `id` alone **(lead-verified)**
- `packages/database/src/index.ts:1590-1593`, `1618-1621` — `UPDATE … WHERE id = $1`
  and `DELETE … WHERE id = $1`, no `user_id` predicate, no RLS backstop.
  `id` is server-side today (from `reserve()`), so this is **latent**, not
  reachable.
- Fix: add `AND user_id = $2` (or enable+force RLS with a `user_id` policy).

### M6. `LAVEGA_ENCRYPTION_KEY` is one non-rotatable, dual-purpose root key
- `packages/database/src/index.ts:104-151`; `apps/investing-server/src/stockResearch.ts:211`.
  One secret encrypts every tenant's broker credentials, snapshots, agent memory
  and per-user vault keys, **and** is reused (raw form) as the HMAC signing key
  for stock-research tokens. The envelope has a version byte but decryption does
  not use it for key selection → no rotation; replacing the key makes every blob
  unreadable.
- Fix: derive per-purpose keys via HKDF with a purpose label, put a key-id in the
  envelope, add old-read/new-write rotation; at minimum stop cross-protocol reuse.

### M7. PostHog web exception capture bypasses the Sentry redaction allowlist
- `apps/web/src/posthog.ts:19-31` sets `capture_exceptions` with no `before_send`
  sanitizer, no `disable_session_recording`, no text masking, and `Root.tsx:37`
  sends the account email. The repo's scrubber (`packages/core/src/sentryScrub.ts`)
  is wired only into `Sentry.init`. Financial strings (amounts, IBANs,
  counterparties, parse-error bodies) leave for PostHog unredacted.
- Fix: add a `before_send` running `scrubText`, disable session recording and mask
  text, and reconsider sending `email` in `identify`.

### M8. Rate-limit state is per-process → ineffective on serverless
- `apps/server/src/agent-routes.ts:46` (`createRateLimiter(20, 60_000)` at module
  scope) on the Vercel serverless build: effective ceiling = 20/min × instance
  count, and cold starts reset it. Bursts can overspend the Mistral key.
- Fix: shared store, or document the single-user acceptance.

### M9. Runtime dependency `undici@7.29.0` below its security fixes
- `pnpm-lock.yaml:3203` via `@ai-sdk/provider-utils` (runtime AI SDK path).
  `pnpm audit` lists TLS-certificate-validation-bypass `>=7.24.1 <7.29.1` and DoS
  `>=7.0.0 <7.29.1`. The lock resolves `7.29.0`.
- Fix: pnpm `overrides` forcing `undici >=7.29.1` (and `>=8.10.2` for the v8 line).

### M10. Containers run as root and ship the dev dependency tree
- `Dockerfile:6,25-34`, `Dockerfile.investing:19` — no `USER`; `COPY . .` +
  full `pnpm install` puts dev/test advisories (3 critical: vitest, tinypool×2)
  into the image.
- Fix: `USER node`; `pnpm install --prod` / `pnpm prune --prod` in the runtime
  stage.

### M11. Reply MIME header injection — a bare CR in `Message-ID`
- `apps/email-worker/src/replyMime.ts:66-74` (`To`/`In-Reply-To`/`References` are
  not sanitized) and `apps/email-worker/src/parseMail.ts:185-187` (a lone `\r` is
  not a line separator). A `Message-ID` containing a bare CR injects a header into
  a message sent from `invoices.lavega.dev` (e.g. `Bcc:`).
- Fix: run every header through the existing `encodeHeaderValue`, and reject any
  CR/LF in `Message-ID`/`From`.

### M12. Unbounded multipart recursion → Worker CPU/memory exhaustion
- `apps/email-worker/src/parseMail.ts:241-253` — `parsePart` recurses on every
  `multipart/*` with no depth/part cap; each level re-splits its whole body. A
  ≤17 MB message nests thousands of levels. Realistic outcome: a silent drop of
  the invoice, the one invariant the worker promises to keep.
- Fix: cap depth (~10) and total parts (~50).

### M13. Auto-reply to the untrusted envelope sender, no loop guard
- `apps/email-worker/src/handler.ts:356-375,407-416` — replies go to
  `message.from` with no `Auto-Submitted: auto-replied` / `Precedence: bulk` and
  no self-domain check. Unauthenticated mail reflector from LaVega's domain; a
  self-addressed MAIL FROM can loop and burn n8n + Claude budget.
- Fix: add the auto-submitted/precedence headers; refuse the reply path when the
  sender is under `invoices.lavega.dev` or looks auto-generated.

### M14. Extension "Kassa overal" reads arbitrary https page text under `<all_urls>`
- `apps/extension/src/background.ts:320` (also `:311,:340`);
  `apps/extension/public/manifest.json:38-44`. With the toggle on and
  `<all_urls>` granted, any https tab that messages the worker is scraped
  (prices, product names, host) with no site allowlist (the list was removed,
  comment `:264-271`).
- Fix: restrict to a declared origin list or request per-origin permission at
  first use.

---

## Low (hardening; full detail in the agent reports)

- A1 — idle lock is client-only; server session lives 30 days. `LAVEGA_ALLOW_UNAUTHENTICATED=1`
  disables **both** guards with no `NODE_ENV` guard. `OPTIONS` bypass in `apiGuard`
  is inert but latent. Open sign-up allows account enumeration + verification
  bombing. `/app` edge gate checks cookie **presence** only; the audited
  `appGateCookie.ts` **does not exist** (only `appGateCookie.vercelParity.test.ts`) —
  `(lead-verified)`.
- A2 — `eraseUserData` interpolates a hardcoded table name (safe today, fragile
  shape). `personal.eb_pending_auth` has no RLS by design (key is the credential).
  No `child_process`/`exec` anywhere (negative). No user-controlled fetch URL →
  no SSRF (negative). No request-derived file paths → no traversal (negative).
- A3 — non-constant-time shared-secret compares (`agent-routes.ts:474-476`,
  `investing-mount.ts:114-117`). `console.error(error)` unredacted before Sentry
  (`observability.ts:21-32`). `/api/vault/backup` lacks `Cache-Control` (the
  sibling `/api/vault/key` has it). `.env.example` omits `POSTHOG_*`,
  `MARKET_DATA_API_KEY`, `LAVEGA_ALLOW_UNAUTHENTICATED`.
- A4 — scraped offers/points stored unencrypted in `chrome.storage.local`.
  Bank redirect uses `data.url` with no scheme allowlist (`BankLink.tsx:89`). Web
  CSP is server-middleware only, no `<meta>` fallback. `<all_urls>` declared as an
  optional host permission.
- A5 — Enable Banking error paths leak the private-key filesystem path
  (`eb-routes.ts:197,260`). Attachment `fileName` is attacker-controlled and
  echoed into the bounce reason + n8n payload. Queue `from` keeps the spoofable
  display name.
- A6 — no `Permissions-Policy` header. HSTS emitted unconditionally (also on
  plaintext) with `includeSubDomains`.

---

## Verified clean — do not re-open

- **Auth**: cookie flags pinned (`httpOnly`, `secure`, `sameSite:"lax"`,
  `__Secure-` prefix, host-only, no `Domain`). Better Auth owns reset/verify
  tokens with sane expiry. All 20 erasure DELETEs are user-scoped. `/api/eb/callback`
  is state-gated (single-use, TTL, user-bound). Machine endpoints fail closed.
- **Crypto**: AES-256-GCM, fresh 12-byte IV per call, auth tag checked before any
  plaintext, no fallback key, PBKDF2-SHA256 210k with per-vault salt and a floor,
  non-extractable WebCrypto keys, `FORCE ROW LEVEL SECURITY` on every vault table,
  HMAC verify via `crypto.subtle.verify` with domain separation + tenant binding.
  **No secret was ever committed to git history** (`git log --all -G` for
  `sk-…`, `sk-ant-…`, `AKIA…`, `ghp_…`, JWTs, PEM blocks, `postgres://user:pass@`)
  — hits were docs prose, regex false positives, and PEM test stubs; no `.env`
  was ever tracked.
- **Injection/SSRF**: no SQL built from request data; no dynamic table/column from
  input; no user-controlled fetch host (all constants/env; currency/date are
  validated); no `child_process`; no request-derived file paths.
- **Web/extension**: no `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`javascript:`
  sinks in shipping code; extension uses `textContent`, `ISOLATED` world, no
  `externally_connectable`, validates `sender.url`/`origin`/`tab` and re-checks
  permissions before scraping; no vault bytes in `localStorage`.
- **Runtime**: `secureHeaders` applies to all responses incl. errors and the
  investing mount; error handler does not leak stack/env; CORS has no
  wildcard+credentials; workflows are SHA-pinned with least-privilege
  `permissions`, no `pull_request_target`; `.dockerignore` excludes secret material.
- **Email/OAuth**: OAuth `state` is `randomUUID`, single-use, TTL-bounded, consumed
  before the code exchange; `redirect_uri` is server config; no open redirect. No
  cross-tenant write (tenant comes from `RCPT TO`, not `From`). No stored XSS via
  forwarded HTML.

## Evidence

Agent reports (raw, per-domain):
`/private/var/folders/qb/6rh4l5gd2_n041b_fgb0kpc40000gn/T/opencode/lavega-sec-stress/A{1..6}-*.md`.
Local probes and `pnpm audit` output are in the same directory.
