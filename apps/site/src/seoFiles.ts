import {
  counterpart,
  hubAlternates,
  hubUrl,
  urlFor,
  type Family,
  type Locale,
  type Page,
} from "./content.js";
import type { Faq, LocaleFacts, SiteFacts } from "./facts.js";
import { FAMILY_LABEL } from "./jsonld.js";

const FAMILIES: readonly Family[] = ["vragen", "gids", "vs", "seizoen", "over", "onderzoek"];
const LOCALES: readonly Locale[] = ["nl", "en"];
const BOTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Meta-ExternalAgent",
];

const published = (pages: Page[]) => pages.filter((p) => p.status === "published");

export function robotsTxt(origin: string): string {
  const rules = ["Allow: /", "Disallow: /api/", "Disallow: /app", "Disallow: /investing"];
  const groups = ["*", ...BOTS].map((ua) => [`User-agent: ${ua}`, ...rules].join("\n"));
  return `${groups.join("\n\n")}\n\nSitemap: ${origin}/sitemap.xml\n`;
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const LANDING_ALTS: Alt[] = [
  { hreflang: "nl", path: "/" },
  { hreflang: "en", path: "/en" },
  { hreflang: "x-default", path: "/" },
];

type Alt = { hreflang: string; path: string };
type Entry = { path: string; lastmod?: string; alts: Alt[] };

export function sitemapXml(allPages: Page[], origin: string): string {
  const pages = published(allPages);
  const entries: Entry[] = [
    {
      path: "/",
      alts: LANDING_ALTS,
    },
    {
      path: "/en",
      alts: LANDING_ALTS,
    },
  ];

  for (const family of FAMILIES) {
    const hubs = LOCALES.map((locale) => ({
      locale,
      members: pages.filter((p) => p.locale === locale && p.family === family),
    })).filter((h) => h.members.length > 0);
    const alts = hubAlternates(pages, family);
    for (const h of hubs) {
      const lastmod = h.members
        .map((p) => p.updated)
        .sort()
        .at(-1);
      entries.push({ path: hubUrl(h.locale, family), lastmod, alts });
    }
  }

  for (const p of pages) {
    const other = counterpart(p, pages);
    const alts: Alt[] = other
      ? [
          ...[p, other].map((x) => ({ hreflang: x.locale, path: urlFor(x) })),
          { hreflang: "x-default", path: urlFor(p.locale === "nl" ? p : other) },
        ]
      : [];
    entries.push({ path: urlFor(p), lastmod: p.updated, alts });
  }

  const body = entries
    .map((e) => {
      const lines = [`    <loc>${xmlEscape(origin + e.path)}</loc>`];
      if (e.lastmod) lines.push(`    <lastmod>${xmlEscape(e.lastmod)}</lastmod>`);
      for (const a of e.alts)
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${xmlEscape(a.hreflang)}" href="${xmlEscape(origin + a.path)}"/>`,
        );
      return `  <url>\n${lines.join("\n")}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const linkText = (s: string) => oneLine(s).replace(/[\\[\]]/g, "\\$&");

export function llmsTxt(allPages: Page[], facts: SiteFacts, origin: string): string {
  const pages = published(allPages);
  const out: string[] = [`# ${facts.name}`, "", `> ${facts.en.summary}`, "", facts.nl.summary, ""];
  const section = (title: string, body: (f: LocaleFacts) => string[]) => {
    for (const locale of LOCALES) out.push(`## ${title} (${locale})`, ...body(facts[locale]), "");
  };
  const answer = (faq: Faq) => [`${faq.q} ${faq.a}`];

  section("What LaVega does", (f) => f.does.map((i) => `- ${i}`));
  section("Moving money", (f) => answer(f.movingMoney));
  section("Investment advice", (f) => answer(f.investmentAdvice));
  section("Privacy", (f) => answer(f.privacy));
  section("Price", (f) => answer(f.price));

  for (const locale of LOCALES) {
    for (const family of FAMILIES) {
      const members = pages.filter((p) => p.locale === locale && p.family === family);
      if (!members.length) continue;
      out.push(
        `## ${FAMILY_LABEL[locale][family]} (${locale})`,
        ...members.map(
          (p) => `- [${linkText(p.title)}](${origin}${urlFor(p)}): ${oneLine(p.description)}`,
        ),
        "",
      );
    }
  }

  out.push(
    "## Landing pages",
    `- [LaVega (nl)](${origin}/): ${facts.nl.summary}`,
    `- [LaVega (en)](${origin}/en): ${facts.en.summary}`,
    "",
  );
  return out.join("\n");
}
