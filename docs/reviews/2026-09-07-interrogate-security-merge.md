# Interrogate: the security merge (cd111b0, `security/api-session-guard`)

Date: 2026-09-07. Method: pstack `interrogate` — three independent reviewers (Opus 5, Fable 5.1,
Sonnet 5) got the same diff, intent, rubric and code-quality lens; the lead (this session)
then verified every critical claim against the code and against production before
categorising. Nothing below has been applied yet.

## Intent

> Close every `/api/*` route behind a better-auth session guard (C1/H1/H2/H3/M3/M8), add
> security headers, close sign-up, enforce a vault password rule, validate the EB OAuth
> state and move EB flow state from module Maps to Neon, add a GDPR erase endpoint, refuse
> spoofed senders in the email worker, add a client-side encrypted vault backup, make the
> privacy policy true again. Dev opens the guard explicitly with
> `LAVEGA_ALLOW_UNAUTHENTICATED=1`.

## Reviewers

- Reviewer A: Opus 5, 10 findings (5 critical, 4 warning, 1 nit-bundle)
- Reviewer B: Fable 5.1, 7 findings (3 critical, 2 warning, 2 nit)
- Reviewer C: Sonnet 5, 5 findings (1 critical, 3 warning, 1 nit)

## Act on

1. **The guard kills the nightly investing cron and the pre-login health line.** (A, B, C —
   all three.) `apiGuard` runs before `app.get("/api/cron/investing-sync")` and
   `/api/investing/health`; neither is on `PUBLIC_API_PATHS`. **Verified live:**
   `curl -H 'Authorization: Bearer x' https://www.lavega.dev/api/cron/investing-sync` answers
   `{"error":"unauthorized"}` (the guard's body, not the cron handler's
   `{"problems":["Unauthorized cron request"]}`), and `/api/investing/health` answers the
   same 401. The 04:00 broker + price sync has therefore not run since the merge. The two
   tests named for this behaviour pass because `investing-guard.test.ts`'s `beforeEach`
   mocks a signed-in session for the whole file. Fix: add both paths to the public list
   (cron keeps its own bearer check), and set `verifiedSessionMock.mockResolvedValue(null)`
   in those two tests.

2. **`eraseUserData` wipes every user's pending bank authorisations.** (A, B.) It runs
   `DELETE FROM personal.eb_pending_auth` with no WHERE, and that table deliberately has no
   RLS (`0003_eb_flow.sql`). Verified in `packages/database/src/index.ts:569-613`. Fix:
   qualify that delete with `WHERE user_id = current_setting('app.user_id')`, or carry the
   scoping predicate in the table list so a new entry must state it.

3. **Migration 0003 grants nothing to `lavega_runtime`, and `eb_sessions` lacks
   `FORCE ROW LEVEL SECURITY`.** (A, B.) Verified: zero `GRANT` in the file; 0001 and 0002
   grant per table; no default privileges anywhere. On a deploy that follows DEPLOY.md
   (runtime role, not owner) every EB statement and the erase endpoint fail with
   `permission denied`. Production impact today is nil only because EB is unconfigured and
   erase has no caller (see Consider 2). Fix: the same conditional GRANT block 0002 uses,
   plus `FORCE ROW LEVEL SECURITY`, plus one `ALTER DEFAULT PRIVILEGES` so the next migration
   cannot repeat this.

4. **The M6 spoof gate is alignment-blind.** (A, B.) `senderHardFail` returns null on any
   `dkim=pass` before looking at DMARC, and `parseAuthResults` drops `header.d`. An attacker
   signing with their own domain and `From: facturen@ing.nl` gets `dkim=pass dmarc=fail`
   and passes. The test `softfail + dkim pass + dmarc fail → null` enshrines it. Reviewer A
   adds that the header itself is sender-writable and `resultFor` takes the first match.
   Fix: reject on `dmarc=fail` regardless of DKIM (the forwarded-invoice fixture is
   `dmarc=pass` and still passes), and read only the segment whose authserv-id is
   Cloudflare's.

5. **The new CSP blocks Google Fonts on the investing dashboard.** (C.) **Verified live:**
   prod's `content-security-policy` has `style-src 'self' 'unsafe-inline'; font-src 'self'
   data:`, and the built investing CSS starts with `@import
   url("https://fonts.googleapis.com/…")`. The dashboard is rendering in system fonts. Fix:
   add `https://fonts.googleapis.com` to `styleSrc` and `https://fonts.gstatic.com` to
   `fontSrc`, or self-host the two families. The personal app is unaffected (no remote
   fonts).

## Consider

1. **The personal app has no sign-in, so the routes the guard closed are unreachable from
   it.** (A.) Verified: no `/api/auth` caller anywhere in `apps/web/src`; the only sign-in
   form lives in `apps/investing-web`. `Inloggen` on the landing opens the vault gate, not a
   session. Vault backup, EB connect and the agents answer 401 to a personal-app user unless
   they first sign in at `/investing` (same origin, shared cookie). Acceptable while the app
   is waitlist-only and you test via `/investing`; not acceptable for a first real user.
   Cheapest fix: surface the existing `AuthForm` in `apps/web` behind the vault gate, or make
   `vaultSync`'s `signed-out` state link to `/investing`.

2. **The GDPR erase endpoint has no caller, while the policy promises the action.** (A.)
   Verified: `account/data` appears only in the route and its test; `legal.ts:105` promises
   "het verwijderen van je gegevens op de server" as a distinct action. Either add the button
   (Back-up view) or reword to the "stuur een bericht" form used one sentence later.

3. **Identity is resolved twice per request from two sources.** (A, B.) `apiGuard` calls
   `verifiedSession` and stores the id; every route then calls `investingTenantId`, which
   calls `verifiedSession` again (no cookie cache configured) and has a permissive local
   fallback the guard does not. Two Neon round-trips per call, and two answers to "who is
   this". Fix when you next touch the routes: one `requestTenantId(c)` reading the context.

4. **Rate limiter is per-instance on Vercel and never evicts keys.** (A, C.) The same
   module-scope-Map problem this merge fixed for EB, applied to the Anthropic spend cap:
   effective limit is 20/min × instances. Prune empty keys now (one line); decide whether the
   cap matters enough to move to Neon once the key is set on Vercel.

5. **Abandoned `eb_sessions` rows are never swept.** (A.) Verified: only `sweepAuth` exists;
   the old `sweep(sessions, …)` call was removed and `deleteSession` runs only on the happy
   path. Add `sweepSessions(ttl)` next to `sweepAuth`.

## Noted

- `getAuth()` caches `disableSignUp` for the process lifetime; "redeploy" in DEPLOY.md is
  the right instruction on Vercel, a self-host needs "restart". (C)
- `eraseUserData` leaves the Better Auth identity rows; disclosed in the policy, but the
  route's doc-comment overstates it. (C)
- Two migrations share the `0003_` prefix; with no runner, ordering is manual. (B)
- Casts where a typed `Hono<{ Variables }>` would do; duplicated comment block in
  `eb-routes.ts`; stale "210k iterations" in `vaultPassword.ts` (it is 600k); the migrate
  screen's password rule is untested; `apiGuard.test.ts` hits the live FX API. (A, B)
- The `OPTIONS` bypass in `apiGuard` is unreachable in production (same origin) and
  loopback preflights are already answered upstream; harmless, deletable. (A)

## Dismissed

- Nothing outright wrong was filed. The closest is Reviewer C's sign-up-singleton point,
  which is a documentation gap for self-hosters rather than a defect on Vercel.

## Agreement map

All three models converged on the cron/health regression, which is also the only one with a
live production symptom you can see today. Opus and Fable, working independently, matched
each other on the unscoped erase, the missing grants and the DMARC blind spot; Sonnet did not
reach those but was the only one to test the CSP against real assets and the only one to
question the rate limiter's serverless semantics. Opus alone found the biggest product gap
(no sign-in in the personal app). Pattern: the two larger models went deeper into the
database and mail paths, the smaller one stayed closer to the runtime surface. Both views
were needed.

## Evidence

- Guard posture: `/tmp/lavega-verify/evidence/guard-prod.json`, `guard-local.json`
  (via `.claude/skills/verify-lavega/control-lavega.mjs guard`)
- Cron body and CSP header: `curl` against `https://www.lavega.dev`, 2026-09-07 13:20 CEST

## Applied (2026-09-07, later the same day)

All five Act-on items are in the working tree, uncommitted, awaiting review:

1. Cron + health on `PUBLIC_API_PATHS`; the two investing-guard tests now run logged-out and a
   request-level test in `apiGuard.test.ts` fails without the entries. Proven on a closed-guard
   local server (`/tmp/lavega-verify/evidence/cron-guard-local.json`): the cron path answers the
   cron handler's own 401 on a wrong bearer and 200 on the right one, health answers 200, and
   the vault route still answers the guard's 401.
2. `eraseUserData` deletes `WHERE user_id = $1` on all eight tables; test targets `eb_pending_auth`.
3. New `db/migrations/0004_eb_grants.sql` (grants, `FORCE ROW LEVEL SECURITY`, default privileges
   bound to each schema owner via `FOR ROLE`). Not executed: no Postgres on this machine.
   Apply by hand as the owner, like 0003.
4. `senderHardFail` rejects on `dmarc=fail` before the DKIM waiver. Authserv-id filtering still
   deferred (Cloudflare's real header unobserved). Consequence: an auto-forwarded invoice whose
   original DKIM broke in transit now bounces with the reason instead of being accepted.
5. Investing app self-hosts EB Garamond + Inter via `@fontsource`; CSP unchanged; built CSS has
   zero Google references.

Second interrogate on the fix diff (Sonnet 5 + Haiku 4.5): one real finding, the default
privilege being bound to the executing role rather than the schema owner (fixed, item 3);
one doc drift in DEPLOY.md (fixed); the guard unit test made request-level (both reviewers).
Haiku's claim that `ALTER DEFAULT PRIVILEGES` can name a role that does not exist yet is
wrong in Postgres and was dismissed.
