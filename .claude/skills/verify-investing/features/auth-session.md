# Account and session

Sign-in gate in front of every investing route. Backed by better-auth in
`apps/server/src/auth.ts`, mounted at `/api/auth/*`.

## Sub-features

- sign-in: email and password form (`AuthForm` with `LoginForm`), route `/sign-in`. Fields
  `Email address` and `Password`, plus a `Forgot password?` link.
- sign-up: `AuthForm` in sign-up mode, route `/sign-up`. On success it goes to
  `/check-email`.
- check-email: `/check-email` shows `Check your email` and `Resend confirmation email`.
- email-confirmed: `/email-confirmed` is where the confirmation link lands. It sends a
  confirmed user on to `/sign-in?verified=1` (or `/` with a session). With `?error=` it shows
  `Confirmation link did not work`.
- forgot-password: `/forgot-password` shows `Reset your password` and `Send reset link`.
- reset-password: `/reset-password?token=…` sets a new password through
  `/api/auth/reset-password`. Without a valid token it offers `Request another link`.
- require-auth: `RequireAuth` redirects every other route to `/sign-in` without a session.
- unconfigured mode: with no `DATABASE_URL`/`BETTER_AUTH_SECRET`, `get-session` answers 503
  and the gate opens — that is local and self-hosted dev, not production.

## How to get to it (user POV)

Open `https://www.lavega.dev/investing`. Without a session the app lands on `/sign-in`.
Sign in, and the overview loads. A new user signs up at `/sign-up`, then follows the link in
the confirmation mail. A user who forgot the password uses `Forgot password?` on the sign-in
form and follows the link in the reset mail.

## Driving it with control-investing

Credential resolution, in this order:

1. **File.** `/tmp/lavega-verify-investing/auth.preview.json` on `--target preview`.
   `/tmp/lavega-verify-investing/auth.json` on `--target prod`. `--credentials-file`
   replaces that path. Prod file, written outside the repo:

```bash
umask 077 && printf '{"email":"%s","password":"%s"}' "<email>" "<password>" \
  > /tmp/lavega-verify-investing/auth.json
```

2. **Environment.** `LAVEGA_VERIFY_EMAIL` and `LAVEGA_VERIFY_PASSWORD`, both set. Those two
   names exist in the Vercel project Config for Dev, Preview, and Prod.
3. **CLI flags.** `--email` and `--password`, both set. A password on the command line lands
   in shell history and in the transcript.

For preview, use the existing `auth.preview.json` or pull those env vars. Do not ask for a
personal password. Do not invent or sign up an account. For prod, do not invent an account
either.

`doctor --target preview` fails `credentialsFile` when `auth.preview.json` is missing, those
env vars are unset, and there is no session. The same check on prod uses `auth.json`. The
`fix` names the preview file path and `LAVEGA_VERIFY_EMAIL` / `LAVEGA_VERIFY_PASSWORD`. A
local `doctor` pass does not satisfy this check.
`pnpm run test:verify-investing:live` skips until `auth.preview.json` exists.

Then:

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C login --target preview      # file, else env, else flags
node $C whoami --target preview
node $C logout
```

The cookie jar is per host under `/tmp/lavega-verify-investing/run/`; `cleanup` removes the
run directory, and the credential files sit above it so teardown leaves them alone.

## Gotchas

- The SPA shell is public, its data is not. A blank-looking dashboard with `401` on every
  `/api/*` is a missing session, not a backend failure.
- The mount refuses to fall back to the local tenant when it cannot name a user. That 401 is
  deliberate: the fallback would serve one user another user's portfolio.
- The standalone server has no auth routes at all, so `whoami` reports `unconfigured` there.
  Auth bugs cannot be reproduced locally on `--target local`.
