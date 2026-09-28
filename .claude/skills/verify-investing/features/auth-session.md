# Account and session

Sign-in gate in front of every investing route except the public auth pages. Backed by
better-auth in `apps/server/src/auth.ts`, mounted at `/api/auth/*`. The standalone server
answers the same paths with `503` and `{ message: "Authentication is not configured" }`
(`apps/investing-server/src/app.ts`) so the gate opens instead of treating a missing auth
backend as a signed-out user.

## Sub-features

- sign-in: email and password form, title `Sign in`, route `/sign-in`. Links to
  `Forgot password?` and `Create an account`. A successful confirmation lands on
  `/sign-in?verified=1`, which adds `Email confirmed. Sign in to continue.`
- sign-up: title `Create your account`, route `/sign-up`. Password needs at least 8
  characters. A new address goes to `/check-email` (`Check your email`,
  `Resend confirmation email`).
- email confirmation: `/email-confirmed` shows `Confirming your email…`, then sends an
  authenticated session to `/` and anyone else to `/sign-in?verified=1`.
  `/email-confirmed?error=…` stays put and shows `Confirmation link did not work`.
- password reset: `/forgot-password` (`Reset your password`, `Send reset link`) and
  `/reset-password?token=…` (`Choose a new password`, then `Password changed`). With no
  token the page shows `Reset link is invalid or expired.`
- require-auth: `RequireAuth` redirects any other route to `/sign-in` when the session is
  `anonymous`.
- unconfigured mode: `get-session` answers `503` and the gate opens. That is local and
  self-hosted dev, not production. `whoami` reports `state: "unconfigured"`.
- sign-out: `Sign out` in the shell footer. It posts the auth sign-out and returns to
  `/sign-in`. On the standalone server that post cannot clear a session, because there
  is none.

## How to get to it (user POV)

Open `https://www.lavega.dev/investing`. Without a session the app lands on `/sign-in`.
Sign in, and the overview loads. The shell then shows `Overview`, `Positions`,
`Connect broker`, `Personal` (when `VITE_PERSONAL_URL` or the production `/app` fallback
is set) and `Sign out`.

## Driving it with control-investing

The user writes their credentials once, in their own terminal, to a file outside the repo:

```bash
umask 077 && printf '{"email":"%s","password":"%s"}' "<email>" "<password>" \
  > /tmp/lavega-verify-investing/auth.json
```

Preview uses `/tmp/lavega-verify-investing/auth.preview.json` instead. Then:

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
node $C login --target prod          # reads the file
node $C whoami --target prod
node $C logout
```

On `--target local`, `whoami` is the check. It must report `status: 503` and
`state: "unconfigured"`. `login` cannot succeed there.

`LAVEGA_VERIFY_EMAIL` / `LAVEGA_VERIFY_PASSWORD` work too, and `--email`/`--password` still
exist for a throwaway account. Prefer the file: a password passed as an argument ends up in
shell history and in any transcript of the run.

The cookie jar is one file per host under `/tmp/lavega-verify-investing/run/`, named
`cookies-<host>.txt` (the host's colon becomes `_`, so local is
`cookies-127.0.0.1_8799.txt`). `cleanup` removes the run directory, including the jar.
`auth.json` sits above that directory, so teardown leaves it alone. Credentials belong to
the user — ask, do not invent an account.

## Gotchas

- The SPA shell is public, its data is not. A blank-looking dashboard with `401` on every
  `/api/*` is a missing session, not a backend failure.
- The mount refuses to fall back to the local tenant when it cannot name a user. That 401 is
  deliberate: the fallback would serve one user another user's portfolio.
- A signed-in session cannot be reproduced on `--target local`. The public forms still
  render there (`/sign-in`, `/sign-up`, `/check-email`, `/forgot-password`,
  `/reset-password`). Submitting them does not create a session.
- No `auth.json` and no `auth.preview.json` means a configured sign-in is
  `verified-unreachable`. Do not invent an account. The local `503` gate is the check that
  remains.
