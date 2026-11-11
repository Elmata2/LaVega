import { Marked, type Tokens } from "marked";
import {
  builtHubs,
  counterpart,
  hubAlternates,
  hubUrl,
  urlFor,
  type Family,
  type Locale,
  type Page,
} from "./content.js";
import { FAMILY_LABEL, authorOf, jsonLdForPage, safeJsonLd, visibleAuthorPath } from "./jsonld.js";

export type RenderOpts = { origin: string; draft: boolean };

const WORDMARK = "/brand/wordmark.png";
const STYLESHEET = "/site.css";
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const OG_ALT = "LaVega";
const ogImage = (l: Locale) => `/og/og-${l}.png`;

const T = {
  nl: {
    updated: "Laatst bijgewerkt",
    by: "Door",
    sources: "Bronnen",
    accessed: "geraadpleegd",
    related: "Meer in deze categorie",
    toc: "Op deze pagina",
    tableHint: "Veeg horizontaal om alle kolommen te zien.",
    tableRegion: "Tabel, horizontaal scrollbaar",
    disclaimer: "Dit is informatie, geen advies.",
    breadcrumb: "Kruimelpad",
    draft: "DRAFT: niet gepubliceerd",
    locale: "nl_NL",
    dateLocale: "nl-NL",
  },
  en: {
    updated: "Last updated",
    by: "By",
    sources: "Sources",
    accessed: "accessed",
    related: "More in this section",
    toc: "On this page",
    tableHint: "Scroll horizontally to see all columns.",
    tableRegion: "Table, scrollable horizontally",
    disclaimer: "This is information, not advice.",
    breadcrumb: "Breadcrumb",
    draft: "DRAFT: not published",
    locale: "en_GB",
    dateLocale: "en-GB",
  },
} as const;

/** About hub copy. Factual, one column, no new visual motif. */
const ABOUT_COPY: Record<Locale, string> = {
  nl: "LaVega is een lokale, privacy-eerst financiële agent. Je gegevens blijven op je eigen machine of in een versleutelde kluis; koppelingen met banken en brokers zijn alleen-lezen. Geen betalingen, geen cloud-verplichting, zelf te hosten onder AGPL-3.0. Agenten geven getypeerde oordelen die terug te voeren zijn op je eigen thesis, geen vrij advies.",
  en: "LaVega is a local-first, privacy-first finance agent. Your data stays on your machine or in an encrypted vault; bank and broker connections are read-only. No payments, no cloud requirement, self-hostable under AGPL-3.0. Agents return typed judgments traceable to your own thesis, not free-form advice.",
};

const slug = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LINK_SCHEMES = ["http", "https", "mailto"];
const IMAGE_SCHEMES = ["http", "https"];

/** Allowlist: relative URLs, or an absolute URL whose scheme is listed. Browsers drop tab/CR/LF/NUL and leading spaces inside a scheme, so strip them before looking. */
export function safeUrl(href: string, schemes: readonly string[]): boolean {
  const u = [...href].filter((c) => c.charCodeAt(0) > 0x20).join("");
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(u);
  if (!m) return true;
  return schemes.includes((m[1] ?? "").toLowerCase());
}

const md = new Marked({ gfm: true });
md.use({
  renderer: {
    // Raw HTML (block and inline) is shown as text, never injected.
    html(token: Tokens.HTML | Tokens.Tag) {
      return esc(token.text);
    },
    // The page title is the only h1. Section headings get ids for the ToC.
    heading(token: Tokens.Heading) {
      const depth = Math.min(6, Math.max(2, token.depth));
      return `<h${depth} id="${esc(slug(token.text))}">${this.parser.parseInline(token.tokens)}</h${depth}>\n`;
    },
    link(token: Tokens.Link) {
      const inner = this.parser.parseInline(token.tokens);
      if (!safeUrl(token.href, LINK_SCHEMES)) return inner;
      const title = token.title ? ` title="${esc(token.title)}"` : "";
      return `<a href="${esc(token.href)}"${title}>${inner}</a>`;
    },
    image(token: Tokens.Image) {
      if (!safeUrl(token.href, IMAGE_SCHEMES)) return esc(token.text);
      return `<img src="${esc(token.href)}" alt="${esc(token.text)}" loading="lazy">`;
    },
  },
});

function renderMarkdown(src: string, l: Locale): string {
  const html = md.parse(src, { async: false });
  // Keep table semantics: the scroll wrapper owns overflow, not the table.
  return html
    .replace(
      /<table>/g,
      `<p class="table-hint">${esc(T[l].tableHint)}</p><div class="table-scroll" tabindex="0" role="region" aria-label="${esc(T[l].tableRegion)}"><table>`,
    )
    .replace(/<\/table>/g, "</table></div>");
}

/** Text-only orientation for long articles. No progress bar, no new motif. */
function toc(src: string, l: Locale): string {
  const heads = md
    .lexer(src)
    .filter((t): t is Tokens.Heading => t.type === "heading" && t.depth >= 2);
  if (heads.length < 3) return "";
  const items = heads
    .map((h) => `<li><a href="#${esc(slug(h.text))}">${esc(h.text)}</a></li>`)
    .join("");
  return `<nav class="toc" aria-label="${esc(T[l].toc)}"><p class="toc-label">${esc(T[l].toc)}</p><ol>${items}</ol></nav>`;
}

function fmtDate(iso: string, l: Locale): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat(T[l].dateLocale, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(d);
}

function homePath(l: Locale): string {
  return l === "en" ? "/en" : "/";
}

function visible(all: Page[], draft: boolean): Page[] {
  return draft ? all : all.filter((x) => x.status === "published");
}

function head(o: {
  locale: Locale;
  title: string;
  description: string;
  canonical: string;
  origin: string;
  draft: boolean;
  alternates: { hreflang: string; href: string }[];
  jsonLd: object[];
  ogType: string;
}): string {
  const img = o.origin + ogImage(o.locale);
  const lines = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(o.title)}</title>`,
    `<meta name="description" content="${esc(o.description)}">`,
    `<link rel="canonical" href="${esc(o.canonical)}">`,
    ...(o.draft ? [`<meta name="robots" content="noindex">`] : []),
    ...o.alternates.map(
      (a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${esc(a.href)}">`,
    ),
    `<meta property="og:type" content="${o.ogType}">`,
    `<meta property="og:site_name" content="LaVega">`,
    `<meta property="og:title" content="${esc(o.title)}">`,
    `<meta property="og:description" content="${esc(o.description)}">`,
    `<meta property="og:url" content="${esc(o.canonical)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:image:width" content="${OG_WIDTH}">`,
    `<meta property="og:image:height" content="${OG_HEIGHT}">`,
    `<meta property="og:image:alt" content="${OG_ALT}">`,
    `<meta property="og:locale" content="${T[o.locale].locale}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(o.title)}">`,
    `<meta name="twitter:description" content="${esc(o.description)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
    `<link rel="stylesheet" href="${STYLESHEET}">`,
    `<link rel="icon" href="${WORDMARK}" type="image/png">`,
    ...o.jsonLd.map((j) => `<script type="application/ld+json">${safeJsonLd(j)}</script>`),
  ];
  return lines.join("\n");
}

function header(l: Locale): string {
  const other = l === "nl" ? { href: "/en", label: "EN" } : { href: "/", label: "NL" };
  return `<header class="site-header"><a href="${homePath(l)}"><img src="${WORDMARK}" alt="LaVega" height="28"></a><nav class="locale-switch" aria-label="Taal / Language"><a href="${other.href}">${other.label}</a></nav></header>`;
}

function footer(l: Locale, hubs: Set<string>): string {
  const links = (["vragen", "gids", "vs", "seizoen"] as Family[])
    .filter((f) => hubs.has(hubUrl(l, f)))
    .map((f) => `<a href="${hubUrl(l, f)}">${esc(FAMILY_LABEL[l][f])}</a>`)
    .join(" · ");
  const nav = links ? `<p>${links}</p>` : "";
  return `<footer class="site-footer">${nav}<p>LaVega · <a href="${homePath(l)}">lavega.dev</a></p></footer>`;
}

function document(
  l: Locale,
  headHtml: string,
  bodyHtml: string,
  draft: boolean,
  hubs: Set<string>,
): string {
  const banner = draft ? `<div class="draft-banner">${esc(T[l].draft)}</div>\n` : "";
  return `<!doctype html>
<html lang="${l}">
<head>
${headHtml}
</head>
<body>
${banner}${header(l)}
${bodyHtml}
${footer(l, hubs)}
</body>
</html>
`;
}

function crumbs(l: Locale, crumbList: { name: string; href?: string }[]): string {
  const items = crumbList
    .map((c) =>
      c.href ? `<li><a href="${esc(c.href)}">${esc(c.name)}</a></li>` : `<li>${esc(c.name)}</li>`,
    )
    .join("");
  return `<nav class="breadcrumbs" aria-label="${T[l].breadcrumb}"><ol>${items}</ol></nav>`;
}

export function renderPage(p: Page, all: Page[], opts: RenderOpts): string {
  const l = p.locale;
  const t = T[l];
  const isDraft = p.status === "draft";
  const pool = visible(all, opts.draft);
  const canonical = opts.origin + urlFor(p);
  const hubs = builtHubs(pool);

  const other = counterpart(p, pool);
  const alternates: { hreflang: string; href: string }[] = [];
  if (other) {
    const nl = l === "nl" ? p : other;
    const en = l === "en" ? p : other;
    alternates.push(
      { hreflang: "nl", href: opts.origin + urlFor(nl) },
      { hreflang: "en", href: opts.origin + urlFor(en) },
      { hreflang: "x-default", href: opts.origin + urlFor(nl) },
    );
  }

  const related = pool
    .filter((o) => o.family === p.family && o.locale === l && o !== p)
    .slice(0, 5);

  const author = authorOf(p.author);
  const aPath = visibleAuthorPath(p.author, l, pool);
  const authorHtml = aPath
    ? `<a href="${aPath}" rel="author">${esc(author.name)}</a>`
    : esc(author.name);

  const sources = p.sources.length
    ? `<section class="sources"><h2>${t.sources}</h2><ul>${p.sources
        .map(
          (s) =>
            `<li>${safeUrl(s.url, IMAGE_SCHEMES) ? `<a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>` : esc(s.title)} (${t.accessed} <time datetime="${s.accessed}">${esc(fmtDate(s.accessed, l))}</time>)</li>`,
        )
        .join("")}</ul></section>`
    : "";

  const relatedHtml = related.length
    ? `<aside class="related"><h2>${t.related}</h2><ul>${related
        .map((r) => `<li><a href="${urlFor(r)}">${esc(r.title)}</a></li>`)
        .join("")}</ul></aside>`
    : "";

  const body = `<main>
<article>
${crumbs(l, [
  { name: "LaVega", href: homePath(l) },
  {
    name: FAMILY_LABEL[l][p.family],
    href: hubs.has(hubUrl(l, p.family)) ? hubUrl(l, p.family) : undefined,
  },
  { name: p.title },
])}
<h1>${esc(p.title)}</h1>
<p class="meta"><span>${t.by} ${authorHtml}</span><span aria-hidden="true">·</span><span class="meta-date">${t.updated}: <time datetime="${p.updated}">${esc(fmtDate(p.updated, l))}</time></span></p>
${toc(p.bodyMarkdown, l)}
<div class="body">
${renderMarkdown(p.bodyMarkdown, l)}</div>
<p class="disclaimer">${t.disclaimer}</p>
${sources}
</article>
${relatedHtml}
</main>`;

  return document(
    l,
    head({
      locale: l,
      title: `${p.title} | LaVega`,
      description: p.description,
      canonical,
      origin: opts.origin,
      draft: isDraft,
      alternates,
      jsonLd: jsonLdForPage(p, opts.origin, pool),
      ogType: "article",
    }),
    body,
    isDraft,
    hubs,
  );
}

const HUB_INTRO: Record<Locale, Record<Family, string>> = {
  nl: {
    vragen: "Korte, bronvermelde antwoorden op veelgestelde vragen over geld.",
    gids: "Stap-voor-stap uitleg.",
    vs: "Eerlijke vergelijkingen.",
    seizoen: "Wat er dit seizoen speelt.",
    over: "Wie er achter LaVega zit.",
    onderzoek: "Onderzoek en cijfers.",
  },
  en: {
    vragen: "Short, sourced answers to common money questions.",
    gids: "Step-by-step explanations.",
    vs: "Honest comparisons.",
    seizoen: "What matters this season.",
    over: "Who is behind LaVega.",
    onderzoek: "Research and numbers.",
  },
};

/** Hub page for one family. Callers pass only the pages that should be listed (published in production). */
export function renderHub(
  locale: Locale,
  family: Family,
  pages: Page[],
  opts: { origin: string },
): string {
  const t = T[locale];
  const title = FAMILY_LABEL[locale][family];
  const list = pages.filter((x) => x.locale === locale && x.family === family);
  const canonical = opts.origin + hubUrl(locale, family);
  const description = HUB_INTRO[locale][family];
  const items = list
    .map((x) => `<li><a href="${urlFor(x)}">${esc(x.title)}</a><p>${esc(x.description)}</p></li>`)
    .join("\n");
  const about = family === "over" ? `<p>${esc(ABOUT_COPY[locale])}</p>` : "";
  const body = `<main>
${crumbs(locale, [{ name: "LaVega", href: homePath(locale) }, { name: title }])}
<h1>${esc(title)}</h1>
<p>${esc(description)}</p>
${about}
<ul class="hub-list">
${items}
</ul>
<p class="disclaimer">${t.disclaimer}</p>
</main>`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      url: canonical,
      inLanguage: locale,
    },
  ];
  return document(
    locale,
    head({
      locale,
      title: `${title} | LaVega`,
      description,
      canonical,
      origin: opts.origin,
      draft: false,
      alternates: hubAlternates(pages, family).map((a) => ({
        hreflang: a.hreflang,
        href: opts.origin + a.path,
      })),
      jsonLd,
      ogType: "website",
    }),
    body,
    false,
    builtHubs(pages),
  );
}
