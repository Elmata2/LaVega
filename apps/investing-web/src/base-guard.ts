/* Does the built index.html actually point at the base path it was built for?
 *
 * This check exists because of an outage that every other signal called
 * healthy. The all-in-one image serves this app under `/investing/`, and Vite
 * writes that prefix into the <script> and <link> URLs it emits. The prefix got
 * lost during the build (turbo's strict env mode dropped the base variable —
 * see the comment in vite.config.ts), so the shipped HTML asked for
 * `/assets/index-*.js`. That path misses the `/investing/*` mount in
 * apps/server, falls through to the personal SPA's static catch-all, and comes
 * back as index.html with `200 text/html`. The browser was handed markup where
 * it had asked for a module: the module never ran, the page rendered blank, and
 * nothing anywhere reported an error. `/health` was 200, `/investing/health`
 * was 200 with the right service name, `/investing/` was 200 with the right
 * title — and the one broken request was 200 too.
 *
 * The property is fully decidable from the emitted HTML, so that is where it is
 * checked: every asset URL Vite wrote must start with the base the deploy
 * intends to serve the app under. The build calls `assertHtmlMatchesBase` (see
 * the root Dockerfile, which passes the expected base explicitly rather than
 * re-reading the variable that went missing), and base-guard.test.ts pins the
 * behaviour against the exact HTML that shipped broken. */

/** An `src=`/`href=` URL from the emitted HTML that the base applies to. */
export type AssetRef = { attribute: string; url: string };

const REF_PATTERN = /\b(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** URLs a base prefix does not apply to and must not be judged against: fully
 *  qualified (`https://…`), protocol-relative (`//cdn…`), inline (`data:`),
 *  non-http schemes (`mailto:`), and in-document anchors (`#main`). */
function isBaseIndependent(url: string): boolean {
  return url === "" || url.startsWith("#") || url.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/** Vite always resolves a base to a trailing slash, so compare that way — a
 *  base of `/investing` must not accept `/investinganders/assets/app.js`. */
export function normalizeBase(base: string): string {
  const trimmed = base.trim() || "/";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/** Every asset URL in `html` that the base applies to, in document order. */
export function collectAssetRefs(html: string): AssetRef[] {
  const refs: AssetRef[] = [];
  for (const match of html.matchAll(REF_PATTERN)) {
    const url = match[2] ?? match[3] ?? "";
    if (isBaseIndependent(url)) continue;
    refs.push({ attribute: match[1].toLowerCase(), url });
  }
  return refs;
}

/** The asset URLs that disagree with `base` — empty means the HTML is servable
 *  under that base. */
export function findBaseViolations(html: string, base: string): AssetRef[] {
  const prefix = normalizeBase(base);
  return collectAssetRefs(html).filter((ref) => !ref.url.startsWith(prefix));
}

/** Throw unless every asset URL in `html` sits under `base`.
 *
 *  Also throws when there is nothing to check at all: an HTML file with no
 *  asset URLs would satisfy any base, and a guard that passes on anything is
 *  worse than no guard, because it reads as a green check. */
export function assertHtmlMatchesBase(html: string, base: string, source = "index.html"): void {
  const prefix = normalizeBase(base);
  const refs = collectAssetRefs(html);
  if (refs.length === 0) {
    throw new Error(
      `${source}: found no asset URLs to check, so the base "${prefix}" cannot be verified — ` +
        `any base would pass. Did the build emit an empty shell?`,
    );
  }
  const violations = refs.filter((ref) => !ref.url.startsWith(prefix));
  if (violations.length === 0) return;
  const listed = violations.map((ref) => `  ${ref.attribute}="${ref.url}"`).join("\n");
  throw new Error(
    `${source}: ${violations.length} of ${refs.length} asset URLs do not start with the base "${prefix}":\n${listed}\n` +
      `Served under "${prefix}" these resolve outside the mount, where the SPA fallback answers them ` +
      `with index.html (200 text/html) instead of 404 — the browser gets HTML where it asked for a ` +
      `module and the page renders blank. Check that VITE_INVESTING_BASE reached the Vite build.`,
  );
}
