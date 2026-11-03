import { builtHubs, hubUrl, urlFor, type Family, type Locale, type Page } from "./content.js";

type Author = { name: string; jobTitle: string };

// One table: front-matter `author` key -> the person it names.
export const AUTHORS: Record<string, Author> = {
  alexander: { name: "Alexander Steunenberg", jobTitle: "Founder, LaVega" },
};
const AUTHOR_PAGE_ID = "alexander";

export const FAMILY_LABEL: Record<Locale, Record<Family, string>> = {
  nl: {
    vragen: "Vragen",
    gids: "Gidsen",
    vs: "Vergelijkingen",
    seizoen: "Seizoen",
    over: "Over",
    onderzoek: "Onderzoek",
  },
  en: {
    vragen: "Questions",
    gids: "Guides",
    vs: "Comparisons",
    seizoen: "Seasonal",
    over: "About",
    onderzoek: "Research",
  },
};

export function authorOf(key: string): Author {
  return AUTHORS[key] ?? { name: key, jobTitle: "" };
}

/** Path of the author's `over` page in the given locale, if the author has one. */
export function authorPath(key: string, locale: Locale): string | undefined {
  if (key !== AUTHOR_PAGE_ID) return undefined;
  return urlFor({ locale, family: "over", slug: "alexander-steunenberg" });
}

/** The shared Organization identity; the landing page (apps/web seoHead) declares the same @id. */
export const organizationRef = (origin: string) => ({
  "@type": "Organization",
  "@id": `${origin}/#organization`,
  name: "LaVega",
  url: `${origin}/`,
  logo: `${origin}/brand/wordmark.png`,
});

/** The author's page path when that page is in `pool`, else undefined (no dead links). */
export function visibleAuthorPath(key: string, locale: Locale, pool: Page[]): string | undefined {
  const path = authorPath(key, locale);
  return path !== undefined && pool.some((x) => urlFor(x) === path) ? path : undefined;
}

function person(key: string, locale: Locale, origin: string, pool: Page[]): object {
  const a = authorOf(key);
  const path = visibleAuthorPath(key, locale, pool);
  return {
    "@type": "Person",
    name: a.name,
    ...(a.jobTitle ? { jobTitle: a.jobTitle } : {}),
    ...(path ? { url: origin + path } : {}),
  };
}

/** `pool` is the pages that will exist on the site; links to anything outside it are left out. */
export function jsonLdForPage(p: Page, origin: string, pool: Page[]): object[] {
  const url = origin + urlFor(p);
  const home = origin + (p.locale === "en" ? "/en" : "/");
  const hub = builtHubs(pool).has(hubUrl(p.locale, p.family))
    ? [{ name: FAMILY_LABEL[p.locale][p.family], item: origin + hubUrl(p.locale, p.family) }]
    : [];
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: "LaVega", item: home }, ...hub, { name: p.title, item: url }].map(
      (c, i) => ({ "@type": "ListItem", position: i + 1, ...c }),
    ),
  };
  const out: object[] = [];
  if (p.family === "over") {
    out.push({
      "@context": "https://schema.org",
      "@type": "ProfilePage",
      name: p.title,
      description: p.description,
      url,
      inLanguage: p.locale,
      dateModified: p.updated,
      mainEntity: person(p.author, p.locale, origin, pool),
    });
  } else {
    out.push({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: p.title,
      description: p.description,
      url,
      mainEntityOfPage: url,
      inLanguage: p.locale,
      dateModified: p.updated,
      author: person(p.author, p.locale, origin, pool),
      publisher: organizationRef(origin),
    });
  }
  out.push(crumbs);
  if (p.faq.length > 0) {
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: p.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }
  return out;
}

/** JSON for a <script type="application/ld+json"> body: `<` (and line separators) escaped so it cannot close the tag. */
export function safeJsonLd(obj: object): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
