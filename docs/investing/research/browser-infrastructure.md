# Research: browser infrastructure for API-less brokers

_Resolves [#19](https://github.com/Elmata2/LaVega/issues/19). Read `docs/investing/CONNECTORS.md` and `docs/CONTEXT.md` first — this file evaluates alternatives to the DeGiro plan already committed there._

## The plan being evaluated

`CONNECTORS.md`'s DeGiro adapter is a clean-room TypeScript port that drives DeGiro's **reverse-engineered internal web-app endpoints**: username + password + TOTP, a `session_id` passed as a query param on every call, no OAuth/refresh token, a ~30-minute session timeout, and a documented account-lockout risk on frequent re-login (tracked in [#7](https://github.com/Elmata2/LaVega/issues/7)). It's flagged there as "the highest-risk connector in v1" — it breaks the moment DeGiro ships a frontend change, because the client is coupled to endpoint shapes, not to a contract DeGiro maintains.

That plan is **hand-rolled HTTP**, the first option below. This doc asks whether anything more robust exists, and what it costs in infrastructure and credential custody.

## Options table

| Option | What it is | Credential custody | Session persistence | Approx. pricing | IP origin | Data-handling terms |
|---|---|---|---|---|---|---|
| **Hand-rolled HTTP** (current plan) | Reverse-engineered DeGiro endpoints, plain `fetch` | Never leaves user's device; LaVega never stores DeGiro creds | None held by LaVega — `session_id` only, ~30 min | $0 | User's own IP | N/A, no third party involved |
| **Local Playwright/Puppeteer** | Drives DeGiro's real rendered web app in a Chromium instance on the user's machine | Never leaves user's device | Local persistent browser profile / `storageState`, survives across syncs until DeGiro's own cookie expires ([Playwright storageState docs](https://playwright.dev/docs/auth)) | $0 infra; ~150–300 MB Chromium download | User's own IP | N/A |
| **Browser extension** | Content script / `chrome.cookies` reads the session cookie from a tab where the user is already logged into DeGiro | No password handled — but the extracted session cookie is bearer-equivalent; `chrome.cookies` can read `HttpOnly` cookies inaccessible to page JS ([Chromium cookies API design doc](https://www.chromium.org/developers/design-documents/extensions/proposed-changes/apis-under-development/proposal-chrome-extensions-cookies-api/)) | No independent LaVega-held session — piggybacks on the user's own already-open, already-authenticated tab | $0 infra + store distribution/maintenance overhead | User's own IP | N/A |
| **Cloudflare Browser Rendering** (Chromium) | Managed remote Chromium via Workers | Would transit Cloudflare's infra if used for login | Sessions closeable via Durable Objects/reconnect, but default idle timeout is 60s (configurable up to 10 min) — [not designed for long-lived auth sessions](https://developers.cloudflare.com/browser-rendering/workers-bindings/reuse-sessions/) | $0.09/browser-hr after 10 free hrs/mo (Workers Paid); +$2/extra concurrent browser ([pricing](https://developers.cloudflare.com/browser-run/pricing/)) | Cloudflare datacenter | Content discarded post-response by default; opt-in session recording retained 30 days |
| **Cloudflare Kitesurf** | New (Aug 6, 2026) stateless browser built on V8 isolates, *not* Chromium — see below | N/A | **None by design** — Cloudflare's own docs say it cannot "start a long-running, authenticated session that requires persistent state" and to use the Chromium product instead ([Kitesurf docs](https://developers.cloudflare.com/browser-run/kitesurf/)) | Free, beta | Cloudflare datacenter | — |
| **Browserbase** | Managed remote Chromium, "Contexts" for persistence | Would transit Browserbase's infra | Yes — Contexts persist cookies/auth across sessions | Free (1 hr); Developer $20/mo (100 hrs, +$0.12/hr); Startup $99/mo (500 hrs, +$0.10/hr); proxies $10–12/GB ([pricing](https://www.browserbase.com/pricing)) | Datacenter default; residential proxy add-on | SOC 2 Type II + HIPAA, configurable region, zero-data-retention option ([enterprise security docs](https://docs.browserbase.com/account/enterprise/security)) |
| **Steel.dev** | Open-source browser API, managed cloud **or self-hosted** (Docker, Apache-2.0) | Managed: transits Steel's infra. Self-hosted: stays on infra you run | Yes — Profiles API persists cookies/auth/localStorage; Credentials API can inject secrets without exposing them to the agent/operator | Launch $0+usage ($30 one-time credit); Scale $250/mo+usage ([pricing](https://steel.dev/#pricing)); self-host is free | Datacenter (managed) or wherever you self-host | No public SOC 2 found; open-source core is independently auditable ([steel-browser repo](https://github.com/steel-dev/steel-browser)) |
| **Browserless.io** | Managed remote Chromium (BaaS) | Would transit Browserless infra | Persisted sessions/replays, 1–90 days by plan | Free (1k units); Prototyping $25/mo (20k units); residential proxy 6 units/MB, datacenter 2 units/MB ([pricing](https://www.browserless.io/pricing)) | Datacenter default; residential proxy add-on | — |
| **Hyperbrowser** | Managed remote browser | Would transit Hyperbrowser infra | Session persistence (cookies/localStorage/auth) | 100 credits ($0.10)/browser-hr; proxy $10/GB; Startup $30/mo+usage ([pricing](https://www.hyperbrowser.ai/docs/pricing)) | Datacenter default; proxy add-on | — |
| **Anchor Browser** | Managed remote browser, enterprise-oriented | Would transit Anchor's infra | Persistent sessions, marketed for long-running/"infinite" duration | $0.01/browser create + $0.05/browser-hr; proxy $8/GB; $5/mo free credit ([pricing](https://docs.anchorbrowser.io/pricing)) | Datacenter default; proxy add-on | Enterprise SSO/VPN integration mentioned; no public SOC 2 found |
| **Airtop** | Managed remote browser, agent-focused | Would transit Airtop's infra | Persistent sessions; sticky IP 10–30 min | Free (1k credits); Starter $26/mo; Professional $170/mo (custom proxy); Enterprise $502/mo (SOC 2 Type II) ([pricing](https://www.airtop.ai/pricing)) | US default, country-configurable, sticky proxy | SOC 2 Type II at Enterprise tier |

## "Kitesurf" — identified, not guessed

The ticket flagged a name ("kitesurf") the charting agent couldn't identify. It's real: **Cloudflare Kitesurf**, announced August 6, 2026 — a new, non-Chromium headless browser written in Rust/WebAssembly that runs entirely inside Cloudflare Workers' V8 isolates, aimed at cheap, high-concurrency, one-shot agent tasks (screenshots, HTML/PDF extraction). It uses 3–7× less CPU/memory than Chromium but is explicitly **not** built for logins: Cloudflare's own docs state it can't "start a long-running, authenticated session that requires persistent state" or "negotiate a bot-challenge handshake with real TLS fingerprints," and direct users needing that to Browser Run's Chromium product instead. ([Cloudflare Kitesurf docs](https://developers.cloudflare.com/browser-run/kitesurf/), [changelog](https://developers.cloudflare.com/changelog/post/2026-08-06-kitesurf/)) It is ruled out for the DeGiro use case by Cloudflare's own documentation, not by assumption — and it wasn't a candidate under any other name either; nothing else in this space uses that name.

## The constraint that decides this: credential custody

`docs/CONTEXT.md`'s hard constraint #2 is "**Secrets ... NEVER in the repo**" and "nothing routes through LaVega-run infrastructure" by default; `CONNECTORS.md` operationalizes this for DeGiro specifically as "never persisted, re-entered every sync." That posture implicitly assumes the credential only ever touches two places: the user's own device and DeGiro's own servers.

Every managed/remote browser service in the table above breaks that assumption the moment it's used for the DeGiro login step, **regardless of vendor security posture**. It isn't a matter of picking the vendor with the best SOC 2 report — the moment DeGiro's login form is rendered inside Browserbase's/Steel's/Browserless's/Hyperbrowser's/Anchor's/Airtop's/Cloudflare's browser process, that vendor's infrastructure sees the plaintext username, password, and TOTP code, even if LaVega's own server never stores them and even with a zero-data-retention setting. That is a new third party in the credential path that doesn't exist in the current plan, and it's not something a config flag fixes.

This is true independent of the vendor's own compliance claims: Browserbase's SOC 2 Type II / HIPAA compliance and Airtop's Enterprise-tier SOC 2 attest to *their* control environment, not to whether routing a broker password through anyone's infrastructure is compatible with a promise that credentials never leave the user's device.

**Local execution (Playwright on the user's machine, or the browser-extension approach) doesn't have this problem** — the credential only ever touches the user's own device and DeGiro's servers, exactly as today.

## Datacenter IPs and bot detection

Every managed service defaults to **datacenter egress IPs**, and every vendor sells a residential-proxy add-on as a paid feature specifically because raw datacenter IPs get flagged by the bot-detection systems (Cloudflare/Akamai/DataDome-class) that front most brokers' login pages — this is visible directly in the vendors' own marketing and pricing pages, not an inference: Anchor Browser markets "humanized, undetectable browser behavior" and "anti-bot detection bypass" as a paid differentiator, Browserbase gates "Advanced" stealth mode behind its Scale/Enterprise plan, and Browserless prices residential proxy traffic at 3× its datacenter-proxy rate. Paying for a residential proxy doesn't remove the problem, it moves it: broker login traffic now also passes through a fourth party (the residential-proxy pool, sourced from a network LaVega can't audit the provenance of), and stealth features are marketed as best-effort, not a guarantee, since TLS/JA3 fingerprinting and behavioral heuristics remain in play.

Local execution avoids this category of risk entirely: traffic to DeGiro originates from the same residential/office IP and the same browser fingerprint the user already uses to log in manually — there is no network-level signal that distinguishes the automation from the human.

Separately, `CONNECTORS.md` already establishes (via [#7](https://github.com/Elmata2/LaVega/issues/7)) that DeGiro's own helpdesk treats third-party scripts/API wrappers as a terms violation regardless of transport — so a managed remote browser is **doubly** non-compliant for DeGiro: it's still automated third-party access (already prohibited), and it is *more* likely than local execution to get flagged by bot detection, which raises — not lowers — the account-lockout risk the current plan already flags as its biggest open risk.

## Recommendation, split by tier

**Self-hosted tier (default, local-first) — recommended path:**
- Keep hand-rolled HTTP as the default DeGiro path (cheapest, matches the committed plan), but stop treating it as the resilience story — it has none.
- Add **local Playwright** as the resilience layer specifically for DeGiro: drive the real rendered DeGiro web app in a Chromium instance on the user's own machine, using the UI instead of reverse-engineered endpoint shapes, so a DOM/frontend change is far less likely to silently break the sync than a change to internal API contracts is. Persist the login via Playwright's `storageState`/profile, stored locally exactly the way the ephemeral `session_id` is handled today. Because sync is already "manual/user-triggered only, never scheduled" for DeGiro, a locally-launched browser at sync time (headed or headless) is acceptable UX — the user is already re-entering TOTP each time.
- Contain the "heavy dependency" concern by installing Playwright's Chromium into the local Node server (`apps/server`/`apps/investing-server`, which already run locally per `docs/CONTEXT.md`), not into the `investing-web` browser bundle — it never ships to the browser tab.
- Don't adopt the **browser-extension** approach for v1: it solves a problem the current plan doesn't have (LaVega already accepts re-entering credentials each sync), and it opens a second, harder-to-maintain distribution surface (store review, host permissions) whose "no credentials" pitch is weaker on inspection than it looks — `chrome.cookies` can read the DeGiro session cookie directly, the same technique used by real credential-stealing malware targeting bank customers ([Zscaler writeup](https://www.zscaler.com/blogs/security-research/malicious-chrome-extension-steals-cookies-and-credentials-bank-customers)). Worth revisiting only if DeGiro someday blocks local automation specifically (proof-of-humanity tied to the exact browser the user manually logs in with) and not before.

**Hosted tier (future, explicitly opt-in) — do not route DeGiro's login through any managed browser vendor:**
- None of Cloudflare Browser Rendering/Kitesurf, Browserbase, Steel (managed), Browserless, Hyperbrowser, Anchor Browser, or Airtop should ever hold DeGiro's username/password/TOTP, at any tier — the credential-custody conflict above doesn't go away with a hosted tier, and datacenter-origin traffic actively increases lockout risk versus local execution. This should stand regardless of which vendor looks cheapest or best-certified at the time.
- If a hosted tier eventually needs LaVega to run DeGiro sync on LaVega-controlled servers rather than the user's device, the only local-first-compatible shape is LaVega running its **own** Playwright worker on **LaVega's own** infrastructure, carrying forward "never persist DeGiro credentials, re-enter every sync." That still doesn't route the credential through a third-party browser vendor — it only moves what "local" means, and it's a materially bigger decision (LaVega now handles the credential prompt server-side, even without storing it) than anything decided here. That needs its own ticket/ADR per `docs/CONTEXT.md`'s "don't drop local-first without a deliberate, recorded decision," not a default flowing from a pricing comparison.
- Managed browser infra remains a legitimate tool for problems *other* than this one — e.g. one-shot market-data lookups with no persistent authenticated session, which is a plausible fit for something like Kitesurf or Cloudflare Browser Rendering. That's out of scope here; see the market-data research track ([#18](https://github.com/Elmata2/LaVega/issues/18)).

Interactive Brokers and Trading 212 are unaffected — both already have official APIs per `CONNECTORS.md`, so this entire browser-infrastructure question is specific to DeGiro.

## Sources

- [Cloudflare Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/)
- [Cloudflare Browser Rendering — reuse sessions](https://developers.cloudflare.com/browser-rendering/workers-bindings/reuse-sessions/)
- [Cloudflare Kitesurf docs](https://developers.cloudflare.com/browser-run/kitesurf/)
- [Cloudflare Kitesurf changelog (2026-08-06)](https://developers.cloudflare.com/changelog/post/2026-08-06-kitesurf/)
- [Browserbase pricing](https://www.browserbase.com/pricing)
- [Browserbase enterprise security docs](https://docs.browserbase.com/account/enterprise/security)
- [Steel.dev pricing](https://steel.dev/#pricing)
- [Steel-browser open-source repo](https://github.com/steel-dev/steel-browser)
- [Browserless.io pricing](https://www.browserless.io/pricing)
- [Hyperbrowser pricing](https://www.hyperbrowser.ai/docs/pricing)
- [Anchor Browser pricing](https://docs.anchorbrowser.io/pricing)
- [Airtop pricing](https://www.airtop.ai/pricing)
- [Playwright — authentication / storageState](https://playwright.dev/docs/auth)
- [Chromium cookies API design doc](https://www.chromium.org/developers/design-documents/extensions/proposed-changes/apis-under-development/proposal-chrome-extensions-cookies-api/)
- [Zscaler — malicious Chrome extension stealing bank session cookies](https://www.zscaler.com/blogs/security-research/malicious-chrome-extension-steals-cookies-and-credentials-bank-customers)
- `docs/investing/CONNECTORS.md` (DeGiro adapter plan, [#7](https://github.com/Elmata2/LaVega/issues/7))
- `docs/CONTEXT.md` (local-first / no-secrets hard constraints)
