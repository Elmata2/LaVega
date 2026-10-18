/* The Content-Security-Policy that the static deploy sets as a HEADER
 * (`scripts/vercel-build.mjs` → `config.json`, applied to every response). This
 * is the same policy mirrored as a `<meta>` fallback in the built shell, so a
 * host that serves `apps/web/dist` without that config — a preview, a mirror, a
 * self-host that only copied the files — still gets a policy instead of none.
 *
 * Kept DELIBERATELY identical to the header. Two policies that drift are worse
 * than one, because the browser enforces both and whichever directive is
 * narrower decides; a "helpful" extra directive here would silently break a
 * connection the header allows.
 *
 * `frame-ancestors` is the one directive that is NOT repeated: a `<meta>` CSP
 * cannot enforce it (the browser ignores it and logs a warning). Clickjacking
 * stays covered by the header, which the vercel config and the server's
 * `secureHeaders()` both set.
 *
 * Injected at BUILD time only (see vite.config.ts): Vite's dev server injects an
 * inline React Refresh preamble, which `script-src 'self'` would block, so the
 * meta must not apply to `vite dev`.
 *
 * `connect-src 'self' https:` is what lets PostHog and Sentry reach their
 * ingest hosts; `script-src 'self' https://*.posthog.com` allows PostHog's
 * optional remote script while every bundle of ours is `'self'`. */
export const CSP_FALLBACK_META = [
  "default-src 'self'",
  "script-src 'self' https://*.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
