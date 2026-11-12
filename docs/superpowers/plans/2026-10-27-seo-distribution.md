# Search and AI visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** lavega.dev serves crawler-readable landing HTML, generated robots/sitemap/llms files, and a Markdown-driven content site in nl + en, with advice language blocked at build time.

**Architecture:** A new workspace package `apps/site` turns `content/<locale>/<family>/<slug>.md` into static HTML plus robots.txt, sitemap.xml and llms.txt. `apps/web` gains an SSR entry that pre-renders `<Landing>` for nl and en into the Vite-built `index.html`. `scripts/vercel-build.mjs` runs both and maps clean URLs with Build Output API `overrides`.

**Tech Stack:** TypeScript, Node 22+, tsx, vitest, React 18 `react-dom/server`, Vite SSR build, one Markdown library and one YAML library (root `package.json`), headless Chrome for OG images.

**Spec:** `docs/superpowers/specs/2026-10-27-seo-distribution-design.md`

## Global Constraints

- NEVER commit or push. The "Stage" step is `git add <exact paths>`; the owner commits. Never `git add .audit` or `content/` drafts not written by your task.
- Do not modify `apps/web/src/landingCopy.ts`, `apps/web/src/views/Landing.tsx`, `apps/web/src/styles/landing.css` (staged by another session on `feat/landing-drop-how`).
- One advice list: import `findAdviceLanguage` from `packages/core/src/advice/language.ts`. No second banned-word list anywhere.
- Production output contains only `status: published` pages. Drafts never appear in sitemap.xml or llms.txt.
- Disclaimer line, exact: nl `Dit is informatie, geen advies.` / en `This is information, not advice.`
- Origin constant: `https://www.lavega.dev`.
- No inline executable `<script>`; JSON-LD `<script type="application/ld+json">` only. CSP is `script-src 'self'`.
- New dependencies must pass `pnpm install --frozen-lockfile` with the repo's minimum-release-age policy; record the chosen versions in the task report.
- URL scheme, nl / en: vragen `/vragen/<slug>` / `/en/questions/<slug>`; gids `/gids/<slug>` / `/en/guides/<slug>`; vs `/vs/<slug>` / `/en/vs/<slug>`; seizoen `/seizoen/<slug>` / `/en/seasonal/<slug>`; over `/over/<slug>` / `/en/about/<slug>`; onderzoek `/onderzoek/<slug>` / `/en/research/<slug>`. Hubs: the family path without slug.
- Content source folders use the Dutch family id for both locales: `content/en/vragen/x.md` → `/en/questions/x`.

## Review Focus

1. A page whose counterpart is still a draft: no hreflang to the draft, and the published page still builds (Task 3 test `omits hreflang when counterpart unpublished`).
2. Non-ASCII text (é, ë, €, quotes) in titles and JSON-LD: valid UTF-8 HTML and `JSON.parse`-able JSON-LD, with `</script>` impossible inside it (Task 3 test `escapes script terminators in json-ld`).
3. Two files claiming the same `(locale, family, slug)` or the same `(locale, id)`: build fails naming both files (Task 1 test `rejects duplicate urls and ids`).
4. A Markdown body containing raw HTML: rendered escaped, never injected (Task 3 test `does not pass raw html through`).
5. An English-device crawler hitting `/` is 302'd to `/en` by the locale redirect; `/en` must then serve English pre-rendered HTML (Task 6 output check `en index is english`).

---

### Task 1: Content model and loader

**Files:**
- Create: `apps/site/package.json` (`@lavega/site`, `type: module`, scripts `test: vitest run`, `typecheck: tsc --noEmit`, `check`, `build`, `preview` added in later tasks), `apps/site/tsconfig.json` (extends `../../tsconfig.base.json`)
- Create: `apps/site/src/content.ts`, `apps/site/src/content.test.ts`
- Modify: root `package.json` (add the Markdown and YAML libraries as devDependencies), `pnpm-lock.yaml`

**Interfaces:**
- Produces:
  - `type Locale = "nl" | "en"`, `type Family = "vragen" | "gids" | "vs" | "seizoen" | "over" | "onderzoek"`
  - `type Source = { title: string; url: string; accessed: string }`
  - `type Page = { file: string; locale: Locale; family: Family; slug: string; id: string; title: string; description: string; status: "draft" | "published"; author: string; updated: string; sources: Source[]; faq: { q: string; a: string }[]; bodyMarkdown: string }`
  - `parsePage(file: string, raw: string): Page` (locale/family/slug from the path; throws with the file name on missing or invalid front matter)
  - `urlFor(p: Pick<Page, "locale" | "family" | "slug">): string` and `hubUrl(locale: Locale, family: Family): string`
  - `loadPages(contentDir: string, opts: { drafts: boolean }): Page[]` (sorted by url; drafts filtered unless `opts.drafts`)
  - `counterpart(p: Page, all: Page[]): Page | undefined`

- [ ] **Step 1: Write failing tests** in `content.test.ts`: `parses front matter and path` (file `content/en/vragen/what-is-a-personal-cfo.md` → `locale "en"`, `family "vragen"`, `urlFor` = `/en/questions/what-is-a-personal-cfo`); `maps every family url in both locales` (table of the 12 Global Constraints URL forms); `rejects missing title` (throws, message contains the file path); `filters drafts unless requested`; `rejects duplicate urls and ids` (message names both files); `finds counterpart by id`.
- [ ] **Step 2: Run** `pnpm --filter @lavega/site test` → FAIL (module missing).
- [ ] **Step 3: Implement** `content.ts`. Front matter split on the leading `---` block; YAML via the chosen library; `updated` must match `YYYY-MM-DD`.
- [ ] **Step 4: Run** `pnpm --filter @lavega/site test` and `pnpm --filter @lavega/site typecheck` → PASS.
- [ ] **Step 5: Stage** `git add apps/site package.json pnpm-lock.yaml`.

### Task 2: Content check

**Files:**
- Create: `apps/site/src/check.ts`, `apps/site/src/check.test.ts`, `apps/site/src/cli-check.ts`
- Modify: `apps/site/package.json` (`"check": "tsx src/cli-check.ts ../../content"`)

**Interfaces:**
- Consumes: `Page`, `loadPages`, `counterpart` (Task 1); `findAdviceLanguage(text, locale): string[]`.
- Produces: `type Finding = { file: string; rule: string; detail: string }`; `checkPages(pages: Page[]): Finding[]`; CLI exits 1 if any finding is on a `published` page, prints draft findings as warnings, exits 0 otherwise.

Rules, one `rule` id each: `advice` (findAdviceLanguage on title, description, body, every faq q and a), `description-length` (50-160 chars), `disclaimer` (exact Global Constraints line in body), `sources` (≥1, except family `over`), `no-h1` (no `^# ` line and no `<h1`), `todo` (no `[[TODO`), `counterpart` (if a counterpart exists it has the other locale and same family).

- [ ] **Step 1: Write failing tests**: one test per rule with a minimal failing page and a passing page; `advice hit on published page fails cli`; `advice hit on draft is a warning`; `geen advies disclaimer itself is not a hit`.
- [ ] **Step 2: Run** tests → FAIL.
- [ ] **Step 3: Implement** `checkPages` and the CLI.
- [ ] **Step 4: Run** tests → PASS; run `pnpm --filter @lavega/site check` against the real `content/` and paste its output in the task report (draft warnings expected, exit 0).
- [ ] **Step 5: Stage** `git add apps/site`.

### Task 3: Page renderer

**Files:**
- Create: `apps/site/src/render.ts`, `apps/site/src/jsonld.ts`, `apps/site/src/render.test.ts`, `apps/site/src/site.css`
- Copy design tokens from `apps/web/src/styles/tokens.css` into `site.css` (read only, do not import across packages).

**Interfaces:**
- Consumes: Task 1 types and helpers.
- Produces:
  - `renderPage(p: Page, all: Page[], opts: { origin: string; draft: boolean }): string` (full HTML document)
  - `renderHub(locale: Locale, family: Family, pages: Page[], opts: { origin: string }): string`
  - `jsonLdForPage(p: Page, origin: string): object[]` (Article + Person author + BreadcrumbList, FAQPage when faq, ProfilePage + Person for family `over`)
  - `safeJsonLd(obj: object): string` (JSON with `<` escaped as `<`)

Template per spec §2: `<html lang>`, title, meta description, canonical (`origin + urlFor`), hreflang nl/en/x-default only when counterpart is published (x-default = nl url), OG + Twitter tags (`og:image` = `/og/og-<locale>.png` from Task 7), `<link rel="stylesheet" href="/site.css">`, header wordmark `<img src="/brand/wordmark.png" alt="LaVega">` linking to `/` or `/en`, breadcrumbs, exactly one `<h1>`, body HTML, updated date line (`Laatst bijgewerkt` / `Last updated`), author link to the `over` page of the same locale, sources list, related pages (same family, same locale, up to 5), footer. Draft mode adds `<meta name="robots" content="noindex">` and a visible `DRAFT` banner. No `<script>` except JSON-LD.

- [ ] **Step 1: Write failing tests**: `renders exactly one h1`; `canonical and hreflang pair`; `omits hreflang when counterpart unpublished`; `json-ld parses and has Article author`; `escapes script terminators in json-ld` (title containing `</script>`); `does not pass raw html through` (body `<img onerror=x>` appears escaped); `draft has noindex and banner`; `no executable script tags` (every `<script` has `type="application/ld+json"`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Configure the Markdown library with raw HTML disabled.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Stage** `git add apps/site`.

### Task 4: robots.txt, sitemap.xml, llms.txt

**Files:**
- Create: `apps/site/src/seoFiles.ts`, `apps/site/src/seoFiles.test.ts`, `apps/site/src/facts.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `robotsTxt(origin: string): string`; `sitemapXml(pages: Page[], origin: string): string` (includes `/`, `/en`, every hub with ≥1 page, every page; `lastmod` = `updated`; `xhtml:link` alternates when counterpart published); `llmsTxt(pages: Page[], facts: SiteFacts, origin: string): string`; `type SiteFacts` and `SITE_FACTS` in `facts.ts` (name, one-paragraph summary nl+en, does / does-not lists, "information, not advice", read-only bank data, local-first encryption, languages, `notToBeConfusedWith: string[]`, `price: string | null` = null, `sameAs: string[]` = []).

robots.txt exact groups: `User-agent: *` then named groups GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended, CCBot, Meta-ExternalAgent, each `Allow: /`, `Disallow: /api/`, `Disallow: /app`, `Disallow: /investing`; final `Sitemap: https://www.lavega.dev/sitemap.xml`.

- [ ] **Step 1: Write failing tests**: `robots disallows app api investing for every group`; `sitemap lists landing pages and published pages only`; `sitemap xml is well formed` (parse with jsdom's DOMParser); `llms lists every published page with description`; `llms omits price when null`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Stage** `git add apps/site`.

### Task 5: Site build and local preview

**Files:**
- Create: `apps/site/src/build.ts`, `apps/site/src/cli-build.ts`, `apps/site/src/build.test.ts`
- Modify: `apps/site/package.json` (`"build": "tsx src/cli-build.ts --out dist"`, `"preview": "tsx src/cli-build.ts --out dist-preview --drafts --serve"`), `.gitignore` (`apps/site/dist`, `apps/site/dist-preview`)

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: `buildSite(opts: { contentDir: string; outDir: string; drafts: boolean; origin: string }): Promise<{ overrides: Record<string, { path: string; contentType: string }> }>`. Writes `<url>.html` files (e.g. `vragen/x.html`, `en/questions/x.html`, hub `vragen.html`), `site.css`, `robots.txt`, `sitemap.xml`, `llms.txt`, and copies `apps/site/assets/**` (Task 7) to the out dir. `overrides` maps `"vragen/x.html"` → `{ path: "vragen/x", contentType: "text/html; charset=utf-8" }`. Runs `checkPages` first and throws on a published finding. `--serve` starts a `node:http` static server on port 4321 resolving `/x` → `x.html`.

- [ ] **Step 1: Write failing tests** (temp dirs): `writes html for published pages only`; `overrides map clean paths`; `throws on published advice finding`; `drafts flag renders drafts with banner`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, then `pnpm --filter @lavega/site preview` and `curl -s localhost:4321/vragen/wat-is-een-persoonlijke-cfo | grep -c '<h1'` → `1`; stop the server.
- [ ] **Step 5: Stage** `git add apps/site .gitignore`.

### Task 6: Landing pre-render

**Files:**
- Create: `apps/web/src/prerender.tsx` (SSR entry), `apps/web/src/seoHead.ts`, `apps/web/src/seoHead.test.ts`, `apps/web/scripts/prerender-landing.mjs`
- Modify: `apps/web/package.json` (script `"prerender": "vite build --ssr src/prerender.tsx --outDir dist-ssr && node scripts/prerender-landing.mjs"`), `.gitignore` (`apps/web/dist-ssr`)

**Interfaces:**
- Consumes: `landingCopy` (`apps/web/src/landingCopy.ts`), `hreflangLinks(origin)` (`apps/web/src/locale.ts:74`), `Landing` default export.
- Produces: `renderLanding(locale: Locale): string` (markup via `renderToString`), `landingHead(locale: Locale, origin: string): string` (title, description, canonical, hreflang links each with `data-lavega-hreflang`, OG/Twitter, JSON-LD Organization + WebSite + SoftwareApplication without offers/rating + FAQPage from `landingCopy[locale].faq.items`, all through a `safeJsonLd` equal to Task 3's). `prerender-landing.mjs` loads `dist-ssr/prerender.js` inside a jsdom window whose URL is the locale's path, reads `dist/index.html`, replaces `<title>LaVega</title>` with `landingHead`, fills `<div id="root">` with the markup, writes `dist/index.html` (nl) and `dist/en/index.html` (en, `<html lang="en">`).

- [ ] **Step 1: Write failing tests** in `seoHead.test.ts`: `nl head has dutch title and canonical /`; `en head canonical is /en`; `hreflang links carry data-lavega-hreflang`; `faq json-ld has every faq question`; `no offers and no aggregateRating`.
- [ ] **Step 2: Run** `pnpm --filter @lavega/web test -- seoHead` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Verify output**: `pnpm --filter @lavega/web build && pnpm --filter @lavega/web prerender`; then assert `grep -c "<h1" apps/web/dist/index.html` ≥ 1, the nl hero `titleTop` string is in `dist/index.html`, the en hero `titleTop` string is in `dist/en/index.html` (`en index is english`), every faq question appears, and the CSP meta from `cspMetaPlugin` is still present. Run the full `pnpm --filter @lavega/web test` → PASS.
- [ ] **Step 6: Stage** `git add apps/web/src/prerender.tsx apps/web/src/seoHead.ts apps/web/src/seoHead.test.ts apps/web/scripts/prerender-landing.mjs apps/web/package.json .gitignore`.

### Task 7: Brand assets and OG cards

**Files:**
- Create: `apps/site/scripts/make-images.mjs`, `apps/site/scripts/og-card.html`, outputs `apps/site/assets/brand/wordmark.png` (white wordmark on the landing dark colour, ~600px wide), `apps/site/assets/og/og-nl.png`, `apps/site/assets/og/og-en.png` (1200×630)

**Interfaces:**
- Consumes: `LaVega_wordmark_hires_white.png` (repo root), landing design tokens.
- Produces: the three PNG paths above, referenced by Tasks 3 and 6 as `/brand/wordmark.png` and `/og/og-<locale>.png`.

`make-images.mjs` renders `og-card.html?locale=nl|en` (wordmark + the locale's landing `meta.title` text) with `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot=<out> --window-size=1200,630`, and the wordmark the same way at 600×175.

- [ ] **Step 1: Run** `node apps/site/scripts/make-images.mjs`; check with `file` that both OG PNGs are 1200 x 630 and the wordmark exists; view one with the Read tool.
- [ ] **Step 2: Stage** `git add apps/site/scripts apps/site/assets`.

### Task 8: Vercel build integration and output check

**Files:**
- Modify: `scripts/vercel-build.mjs` (add `@lavega/site` to `TYPECHECKED`; after the web build run `pnpm --filter @lavega/web prerender`; run `buildSite` with `outDir = ${staticDir}`, `drafts: false`; write returned `overrides` into `config.json`; change `/en` and `/en/` routes at lines 336-337 to `dest: "/en/index.html"`; add `X-Robots-Tag: noindex` header routes with `continue: true` for `/app(.*)` and `/investing(.*)`)
- Create: `scripts/verify-seo-output.mjs`

**Interfaces:**
- Consumes: Tasks 5 and 6.
- Produces: `node scripts/verify-seo-output.mjs <outputDir>` exits 0 only when: `static/index.html` has a Dutch title ≠ `LaVega` and the nl hero text; `static/en/index.html` has the en hero text; `robots.txt`, `sitemap.xml`, `llms.txt` exist; every override target exists; every generated html file has exactly one `<h1>`, a canonical and parseable JSON-LD; no html file in output contains `DRAFT`; `config.json` routes for `/en` point at `/en/index.html`.

Building into `.vercel/output` locally needs no Vercel login: run the build script with `DATABASE_URL` unset (it skips the migration check).

- [ ] **Step 1:** Write `verify-seo-output.mjs`; run it against an empty dir → FAIL listing missing files.
- [ ] **Step 2:** Modify `vercel-build.mjs`; keep `packages/core/src/localeRedirect.vercelParity.test.ts` and `apps/server/src/appGateCookie.vercelParity.test.ts` green.
- [ ] **Step 3: Run** `env -u DATABASE_URL node scripts/vercel-build.mjs && node scripts/verify-seo-output.mjs .vercel/output` → PASS. Because all content is draft today, temporarily build with one page copied to a temp content dir as published to prove the published path, then remove it. Paste the verifier output in the report.
- [ ] **Step 4: Run** `pnpm test` (all packages) → PASS, or list pre-existing failures with proof they fail on `origin/master` too.
- [ ] **Step 5: Stage** `git add scripts/vercel-build.mjs scripts/verify-seo-output.mjs`.
