# Account and session

Sign-in gate in front of every investing route. Backed by better-auth in
`apps/server/src/auth.ts`, mounted at `/api/auth/*`. There is no `/me` route. The session
read is `GET /api/auth/get-session`, which `whoami` calls.

## Reach

Mounted origin `https://www.lavega.dev`. Investing shell is `/investing/`. Without a session
the app lands on `/investing/sign-in`.

| Route | Heading an agent can read |
| --- | --- |
| `/sign-in` | `Sign in`. Fields `Email address` and `Password`. Link `Forgot password?`. |
| `/sign-up` | `Create your account`. Success navigates to `/check-email`. |
| `/check-email` | `Check your email`. Button `Resend confirmation email`. |
| `/email-confirmed` | With `?error=`, heading `Confirmation link did not work` and link `Request another link`. Without an error, a session goes to `/` and no session goes to `/sign-in?verified=1`. |
| `/forgot-password` | `Reset your password`. Button `Send reset link` (`Sending…` while pending). |
| `/reset-password` | With a token: `Choose a new password`, then `Password changed`. Without a valid token: `Request another link`. |

`RequireAuth` sends every other route to `/sign-in` when there is no session.
Local standalone has no auth routes. `whoami` there is `state: "unconfigured"`. That is not
a logged-in marker.

## Drive

Credential order on preview: a readable `auth.preview.json` only when this process can open
it, then `LAVEGA_VERIFY_EMAIL` and `LAVEGA_VERIFY_PASSWORD` in the process, then
`vercel env pull --environment preview` (those names are in the Vercel project Config), then
`--email` and `--password`. Do not write `auth.preview.json` under `/tmp`. The next agent
cannot read that file. Do not invent an account. Do not put the password on the command line
when the pull or the env pair works.

`login`, `doctor`, and `preview` print `page`. That is the URL the user opens
(`https://<deploy>/investing/`). Put it in the reply.

```bash
C=".claude/skills/verify-investing/control-investing.mjs"
E="/tmp/lavega-verify-investing/evidence"
node $C doctor --target preview --out "$E/auth-doctor.json"
node $C login --target preview --out "$E/auth-login.json"
node $C whoami --target preview --out "$E/auth-whoami.json"
node $C dashboard --target preview --out "$E/auth-dashboard.json"
```

Prod uses `--target prod` and `auth.json`. Logout: `node $C logout --target preview`.

Recovery routes, public, no session required. Drive each with `browser goto` on the mounted
origin and assert the heading in the table above. Example:
`node $C browser goto /investing/forgot-password --target preview`.

## Observable success

Login is success only when all of these hold. Password text must not appear in stdout or in
the evidence JSON.

- `login` exit 0.
- `auth-login.json` `signedIn` is `true` and `user` is an object.
- `credentialsFrom` is `vercel-env` when `vercel env pull` supplied the password,
  `environment` when `LAVEGA_VERIFY_EMAIL` and `LAVEGA_VERIFY_PASSWORD` were already in the
  process, or a path ending in `auth.preview.json` or `auth.json` when a readable file
  supplied it.
- `page` is the preview URL (`https://<deploy>/investing/`). Report that URL.
- `whoami` exit 0, `state` is `authenticated`, `status` is 200, `user` is an object.
- `dashboard` status is not 401.
- The cookie jar path in `cookieJar` exists and is non-empty. `cleanup` deletes that jar
  with `run/`. The credentials file stays.

Each recovery route succeeds on its own heading from the Reach table, read from
`browser snapshot` or `browser text`. A 200 shell that is still `/sign-in` after `login` is
not success.

Local `whoami` `state: "unconfigured"` is success only for the claim "this server has no
auth". It does not satisfy the logged-in marker.

## Verified-unreachable

- `vercel env pull` fails, the process has no `LAVEGA_VERIFY_EMAIL` +
  `LAVEGA_VERIFY_PASSWORD`, and no readable credentials file: `doctor --target preview`
  fails `credentialsFile`. Stop. Logged-in success is verified-unreachable. Prerequisite:
  `vercel` logged in against the LaVega project (`vercel link`), or those two env vars in
  the process. Do not write `auth.preview.json`. Do not invent an account and do not ask
  for a personal password. Prod is a readable `auth.json`, then the same env pair.
- `/sign-in`, `/sign-up`, `/check-email`, `/email-confirmed`, `/forgot-password`, and
  `/reset-password` are mounted routes. They are verified-unreachable on `--target local`.
  Prerequisite: `--target preview` or `--target prod`.
- A missing `vercel` CLI blocks preview URL discovery. Pass `--base` or `LAVEGA_PREVIEW_URL`
  when the deploy URL is already known. That does not replace the credentials prerequisite.

## Gotchas

- The SPA shell is public, its data is not. A blank-looking dashboard with `401` on every
  `/api/*` is a missing session, not a backend failure.
- The mount refuses to fall back to the local tenant when it cannot name a user. That 401 is
  deliberate: the fallback would serve one user another user's portfolio.
- The standalone server has no auth routes at all, so `whoami` reports `unconfigured` there.
  Auth bugs cannot be reproduced locally on `--target local`.
