import { landingCopy } from "./landingCopy.js";
import { EN_BASE, hreflangLinks, type Locale } from "./locale.js";

/** JSON for a <script type="application/ld+json"> body: `<` and line separators escaped so it cannot close the tag. */
export function safeJsonLd(obj: object): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Everything the landing page needs in <head>, as an HTML string that replaces index.html's bare <title>. */
export function landingHead(locale: Locale, origin: string): string {
  const copy = landingCopy(locale);
  const canonical = locale === "en" ? `${origin}${EN_BASE}` : `${origin}/`;
  const image = `${origin}/og/og-${locale}.png`;
  const ogLocale = locale === "en" ? "en_GB" : "nl_NL";
  const { title, description } = copy.meta;

  const graph = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${origin}/#organization`,
      name: "LaVega",
      url: `${origin}/`,
      logo: `${origin}/brand/wordmark.png`,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "LaVega",
      url: `${origin}/`,
      inLanguage: locale,
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "LaVega",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      url: canonical,
      description,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: copy.faq.items.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];

  const lines = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${canonical}" />`,
    ...hreflangLinks(origin).map(
      (l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${l.href}" data-lavega-hreflang />`,
    ),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="LaVega" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:locale" content="${ogLocale}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    ...graph.map((g) => `<script type="application/ld+json">${safeJsonLd(g)}</script>`),
  ];
  return lines.join("\n    ");
}
