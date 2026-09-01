# Account and session

Sign-in gate in front of every investing route. Backed by better-auth in
`apps/server/src/auth.ts`, mounted at `/api/auth/*`.

## Sub-features

- sign-in: email and password form (`AuthForm`), route `/sign-in`.
- sign-up: same form, account creation path.
- require-auth: `RequireAuth` redirects any other route to `/sign-in` without a session.
- unconfigured mode: with no `DATABASE_URL`/`BETTER_AUTH_SECRET`, `get-session` answers 503
  and the gate opens — that is local and self-hosted dev, not production.

## How to get to it (user POV)

Open `https://www.lavega.dev/investing`. Without a session the app lands on `/sign-in`.
Sign in, and the overview loads.

## Driving it with control-investing

The user writes their credentials once, in their own terminal, to a file outside the repo:

```bash
umask 077 && printf '{"email":"%s","password":"%s"}' "<email>" "<password>" \
  > /tmp/lavega-verify-investing/auth.json
```

Then:

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C login --target prod          # reads the file
node $C whoami --target prod
node $C logout
```

`LAVEGA_VERIFY_EMAIL` / `LAVEGA_VERIFY_PASSWORD` work too, and `--email`/`--password` still
exist for a throwaway account. Prefer the file: a password passed as an argument ends up in
shell history and in any transcript of the run.

The cookie jar is `/tmp/lavega-verify-investing/run/cookies.txt`; `cleanup` removes it, and
`auth.json` sits above it so teardown leaves it alone. Credentials belong to the user — ask,
do not invent an account.

## Gotchas

- The SPA shell is public, its data is not. A blank-looking dashboard with `401` on every
  `/api/*` is a missing session, not a backend failure.
- The mount refuses to fall back to the local tenant when it cannot name a user. That 401 is
  deliberate: the fallback would serve one user another user's portfolio.
- The standalone server has no auth routes at all, so `whoami` reports `unconfigured` there.
  Auth bugs cannot be reproduced locally on `--target local`.
