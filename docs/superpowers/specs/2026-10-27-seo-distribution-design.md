# Search and AI visibility for lavega.dev — design

Date: 2026-10-27 · Owner: Alexander · Status: written for an unattended run the
owner approved in chat on 2026-10-26; he reviews the result the next morning.
Evidence: the Slay teardown (slaycamera.com, public pages only, 26 Oct 2026)
and a probe of www.lavega.dev the same day.

## Intent

A stranger searching "personal CFO", "AI CFO", "persoonlijke financiën" or "AI
financieel assistent" cannot find LaVega today. The production homepage is a
710-byte shell (`<title>LaVega</title>`, `<div id="root"></div>`), and
`/robots.txt`, `/sitemap.xml` and `/llms.txt` all return 404. Search engines and
AI crawlers that do not run JavaScript see no text at all.

Slay (an iPhone camera app) shows what works: real HTML, about 110 pages built
from a few templates, named AI crawlers allowed in robots.txt, an `llms.txt`
product sheet, and structured data per page type. This design brings the same
mechanics to LaVega, inside the AFM line: LaVega informs, it never recommends a
product, an amount or an allocation.

## Decided by the owner

- Target searches: "personal finances", "personal CFO", "AI finances", "AI CFO"
  and their Dutch equivalents.
- Dutch site first, with an English version.
- The builder writes the first batch of content as drafts; the owner reviews
  every page before it goes live.
- Work is staged on a branch, uncommitted, and pushed by the owner.

## Goals

1. `curl https://www.lavega.dev/` and `/en` return readable landing text with a
   real title, description, canonical, hreflang pair, Open Graph tags and
   structured data, without running JavaScript.
2. `robots.txt`, `sitemap.xml` and `llms.txt` exist, are generated from one
   source, and stay correct as pages are added.
3. A content system: Markdown files in, plain static HTML out, five page
   families in two languages, each page linked to its counterpart.
4. Ten draft pages per language, ready for review.
5. Advice language cannot ship: a published page that trips the banned-language
   list fails the build.

## Non-goals

- The research family (`/onderzoek`). It needs real aggregated data; v1 ships
  only the template and an outline.
- A Search Console or Bing account. They need the owner's login; the runbook
  lists the steps.
- Rewriting landing copy. Another session has staged landing edits on
  `feat/landing-drop-how` (`apps/web/src/landingCopy.ts`, `Landing.tsx`,
  `landing.css`); this work does not touch those three files. Suggested title
  and description wording goes in the morning report instead.
- Linking the content hubs from the landing page. Same reason; it is the first
  follow-up once that branch merges.
- A blog for the social agent (`feat/social-agent` lists it as phase 2). This
  content system is what that phase would publish into.

## Anti-goals

- A page that recommends a product, fund, provider, amount or percentage split.
  One such page is worse than having no pages.
- Drafts reachable in production before the owner has read them.
- Review stars or ratings that are not real.
- Facts about competitors or tax rules without a source and a date.
- Indexing the vault app (`/app`), the investing dashboard (`/investing`) or the
  API.

## Constraints

- The advice list is ONE list: `findAdviceLanguage(text, locale)` in
  `packages/core/src/advice/language.ts:167`. The content check imports it and
  adds no second list. Note it treats "advies" as banned unless negated ("geen
  advies"); the social agent design allows "adviseur/advies" as brand words.
  This system follows the stricter list.
- The web app is a Vite SPA (`apps/web/index.html`, `createRoot` in
  `apps/web/src/main.tsx:29`). Deploys go through `scripts/vercel-build.mjs`,
  which writes Vercel's Build Output API by hand, including routes, security
  headers and the locale redirect on `/` (`scripts/vercel-build.mjs:264-278`,
  kept in parity with `packages/core/src/localeRedirect.ts`).
- The CSP is `script-src 'self'`. JSON-LD blocks are data, not executed, so they
  are allowed; no inline executable script may be added.
- New dependencies must pass the repo's pnpm supply-chain policy (minimum
  release age). Prefer none.

## Design

### 1. Landing pre-render

A build step renders the existing `<Landing>` for `nl` and `en` to HTML with
`react-dom/server` and writes it into `apps/web/dist/index.html` and
`apps/web/dist/en/index.html`. It runs inside a jsdom window (jsdom is already a
dev dependency) so the component's `window` and `document` reads do not need
changes to `Landing.tsx`. The browser bundle stays unchanged: `createRoot`
replaces the pre-rendered markup on load. Writer's call: no hydration, because
hydration mismatches are a new failure mode and crawlers only need the HTML.

Each pre-rendered head gets:

- `<title>` and meta description from `landingCopy[locale].meta`, the same
  source `Landing.tsx` applies at runtime, so the two cannot drift.
- `<link rel="canonical">`, `hreflang` nl / en / x-default (x-default → `/`).
- Open Graph and Twitter tags, `og:locale` nl_NL / en_GB.
- JSON-LD: `Organization`, `WebSite`, `SoftwareApplication` (no `offers` until
  the owner states a price, no `aggregateRating`), and `FAQPage` built from
  `landingCopy[locale].faq.items`.

The text must be visible in the HTML: the check in §6 asserts the hero title and
every FAQ question appear in the served file.

### 2. Content system

Source: `content/<locale>/<family>/<slug>.md`, Markdown with YAML front matter:

```yaml
id: personal-cfo          # shared by the nl and en versions of one page
family: vragen            # vragen | gids | vs | seizoen | over | onderzoek
title: Wat is een persoonlijke CFO?
description: 50-160 characters
status: draft             # draft | published
author: alexander
updated: 2026-10-27
sources:
  - { title: "...", url: "https://...", accessed: 2026-10-27 }
faq:                      # optional, becomes FAQPage JSON-LD
  - { q: "...", a: "..." }
```

URL scheme, Dutch slugs for Dutch pages and English slugs for English pages:

| Family | nl | en |
| --- | --- | --- |
| Questions | `/vragen/<slug>` | `/en/questions/<slug>` |
| Guides | `/gids/<slug>` | `/en/guides/<slug>` |
| Comparisons | `/vs/<slug>` | `/en/vs/<slug>` |
| Seasonal | `/seizoen/<slug>` | `/en/seasonal/<slug>` |
| Author | `/over/<slug>` | `/en/about/<slug>` |

Each family gets a hub page (`/vragen`, `/en/questions`, …) listing its
published pages.

A generator script renders every page to static HTML with one shared template:
header with the LaVega wordmark and a link to `/` (or `/en`), breadcrumbs, one
H1 (the title), the body, a "laatst bijgewerkt" / "last updated" date, the
author line linking to the author page, a sources list, the line "Dit is
informatie, geen advies." / "This is information, not advice." inside the page
body, related pages from the same family, and a footer. The pages load no
JavaScript and one small stylesheet using the landing page's design tokens.

Head per page: title, description, canonical, hreflang pair (only when the
counterpart exists and is published), Open Graph, and JSON-LD `Article` with
`author` → `Person`, `BreadcrumbList`, and `FAQPage` when `faq` is present. The
author page uses `ProfilePage` + `Person`.

Draft handling: production builds emit only `status: published`. A local flag
(`--drafts`) renders drafts with a visible DRAFT banner and
`<meta name="robots" content="noindex">` for review. Drafts are never in the
sitemap or `llms.txt`.

Serving: the generated files go into `.vercel/output/static`, with an
`overrides` entry per file in `config.json` so `/vragen/x` serves
`vragen/x.html` as `text/html`. Overrides are the Build Output API's clean-URL
mechanism; no new route regex.

Writer's call: a small script and one Markdown library instead of Astro. Five
page families and one template do not need a framework, and the owner edits
Markdown either way. If the supply-chain policy blocks the library, the builder
picks the oldest acceptable version and records it.

### 3. robots.txt, sitemap.xml, llms.txt

Generated by the same script, so a new page updates all three.

- `robots.txt`: allow all; named groups for GPTBot, OAI-SearchBot,
  ChatGPT-User, ClaudeBot, Claude-User, PerplexityBot, Perplexity-User,
  Google-Extended, Applebot-Extended, CCBot, Meta-ExternalAgent; disallow
  `/api/`, `/app`, `/investing`; `Sitemap:` line.
- `sitemap.xml`: `/`, `/en`, hubs and published pages, `lastmod` from
  `updated`, with `xhtml:link` hreflang alternates.
- `llms.txt`: what LaVega is, who it is for, what it does and does not do
  (information, not advice; read-only bank data; local-first encryption),
  languages, links to every published page with its description, and a
  "not to be confused with" line for other products named LaVega/La Vega.
  Static facts live in one typed file the owner edits.

Plus `X-Robots-Tag: noindex` on `/app` and `/investing` responses, added to the
existing routes in `scripts/vercel-build.mjs`.

### 4. Redirects

`http://lavega.dev` → `https://lavega.dev` → `https://www.lavega.dev` is two
hops. The first hop is Vercel's automatic HTTPS upgrade on the same host and
cannot be removed from config; Slay has the identical chain. No change. The
morning report says so.

### 5. Advice check

`content:check` runs before the generator and in the Vercel build:

- `findAdviceLanguage` on title, description, body and FAQ text, per locale.
- Each published page has: `author`, `updated`, at least one source (except the
  author page and hubs), a description of 50-160 characters, the disclaimer line,
  and a counterpart id that exists.
- No `<h1>` inside the Markdown body (the template owns the one H1).
- No `[[TODO: …]]` placeholder left in a published page (drafts use them for
  facts only the owner can supply, such as a photo or LinkedIn URL).
- Published page with a hit → build fails. Draft with a hit → listed in the
  report, build continues.

The list cannot judge every advice sentence. A human still reads each page
before switching it to `published`; the check is the floor.

### 6. Verification

- Unit tests for front-matter parsing, slug/URL mapping, draft exclusion,
  sitemap/robots/llms generation and the check rules.
- A local build of the real output, then `curl`/file assertions: landing HTML
  contains the hero title and FAQ text for both locales, every generated page has
  exactly one H1, a canonical and valid JSON-LD (`JSON.parse`), robots/sitemap/
  llms exist, drafts are absent from production output.
- The existing test suites for `@lavega/web` and `@lavega/core` stay green, and
  `scripts/vercel-build.mjs` still passes its typecheck step.

### 7. First content batch (drafts, both languages)

| id | Family | nl | en |
| --- | --- | --- | --- |
| personal-cfo | vragen | Wat is een persoonlijke CFO? | What is a personal CFO? |
| ai-finance-assistant | vragen | Wat doet een AI financieel assistent? | What does an AI personal finance assistant do? |
| emergency-buffer | vragen | Hoeveel spaargeld is normaal als buffer? | How big should an emergency buffer be in the Netherlands? |
| box-3 | vragen | Hoe werkt box 3? | How does box 3 work? |
| saving-for-a-child | vragen | Sparen voor je kind: welke mogelijkheden zijn er? | Saving for your child in the Netherlands: the options |
| subscriptions | gids | Abonnementen opschonen in vier stappen | How to clean up your subscriptions |
| tax-return | seizoen | Checklist belastingaangifte 2026 | Dutch tax return checklist for 2026 |
| vs-excel | vs | LaVega vs Excel | LaVega vs a spreadsheet |
| vs-budget-apps | vs | LaVega vs budget-apps | LaVega vs budgeting apps |
| alexander | over | Over Alexander Steunenberg | About Alexander Steunenberg |

Rules for the writer: Dutch is written for Dutch readers, English for expats
in the Netherlands (not a translation); every tax figure and every competitor
fact has a source URL and access date, or is left out; no product, provider,
amount or allocation is named as right for the reader; comparison pages describe
features and costs as published by the competitor, with a date.

## Calls made by the writer

1. Static script + Markdown instead of Astro (smaller, no framework).
2. Pre-render without hydration.
3. English targets expats in the Netherlands.
4. No price and no rating in `SoftwareApplication` until the owner states them.
5. No change to the two-hop redirect (not fixable in config).
6. Landing copy and landing links untouched because of the staged
   `feat/landing-drop-how` work.
7. The stricter advice list wins over the social agent's "advies" allowance.

## Builder check resolutions (writer's calls unless noted)

1. Images: `LaVega_wordmark_hires_white.png` (2400×700, repo root) is the only
   brand asset. The builder copies a resized version into the static output as
   `Organization.logo` and the page-template wordmark, and generates one
   1200×630 Open Graph card per locale by screenshotting a static HTML card with
   headless Chrome (`/Applications/Google Chrome.app`). The PNGs are committed;
   the generator script is committed so they can be redrawn.
2. Author page: only facts already known (founder of LaVega; CEMS / RSM MSc,
   thesis on investors' non-financial support and startup growth), plus
   `[[TODO: …]]` placeholders for photo, LinkedIn URL and a personal line.
   `Person` gets `name`, `jobTitle: "Founder, LaVega"` and `url`; `sameAs` only
   once the owner fills in the LinkedIn URL.
3. Pre-render loads `Landing.tsx` through a second Vite build in SSR mode
   (`vite build --ssr` on a small entry that exports `renderLanding(locale)`), so
   `import.meta.env`, `__LAVEGA_BUILD__` and CSS imports resolve exactly as in
   the browser build. The markup is injected into the `index.html` Vite already
   emitted, keeping its hashed assets and CSP meta.
4. Without JavaScript the pre-rendered page is crawler-readable, not visually
   complete: `.lp-reveal` starts at `opacity: 0` (`landing.css:328`) and only an
   effect lifts it. Text extraction does not depend on opacity, and Google
   renders JavaScript. `landing.css` stays untouched (staged elsewhere).
5. Pre-rendered hreflang links carry `data-lavega-hreflang`, generated from
   `hreflangLinks()` (`apps/web/src/locale.ts:74`), so `applyHreflang` replaces
   them instead of duplicating them. No edit to `locale.ts`.
6. `/en` and `/en/` currently route to `/index.html`
   (`scripts/vercel-build.mjs:336-337`). They change to `/en/index.html`.
7. New libraries (Markdown, YAML front matter) go in the root `package.json`
   beside `tsx` and `jsdom`; scripts import `packages/core` through `tsx`.
8. `apps/web/src/locale.ts:4-9` says English exists for people arriving by link,
   not search, so it must not compete with the Dutch cluster. The owner decided on
   26 Oct to target English search too. Dutch stays canonical and `x-default`;
   English pages target different (English) queries, so they do not compete.
   The comment is left for the owner to update.

## Open questions for the owner

1. Price: is LaVega free, and if not, what does it cost? (`llms.txt`,
   `SoftwareApplication.offers`.)
2. Which social accounts exist for `Organization.sameAs`?
3. Should the cofounder have an author page and bylines?
4. New landing title and description aimed at "persoonlijke CFO" /
   "personal CFO" (wording proposed in the morning report)?

## Runbook after merge

1. Switch reviewed pages to `status: published`.
2. Verify the domain in Google Search Console and Bing Webmaster Tools (DNS
   record), submit `https://www.lavega.dev/sitemap.xml`.
3. Optional: IndexNow key file and a ping on deploy.
4. Link the hubs from the landing footer once `feat/landing-drop-how` merges.
