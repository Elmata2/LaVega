// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Page } from "./content.js";
import { SITE_FACTS } from "./facts.js";
import { llmsTxt, robotsTxt, sitemapXml } from "./seoFiles.js";

const O = "https://www.lavega.dev";
const page = (o: Partial<Page> = {}): Page => ({
  file: "content/nl/vragen/a.md",
  locale: "nl",
  family: "vragen",
  slug: "a",
  id: "a",
  title: "Één titel – €5 & “quotes”",
  description: "Beschrijving van de pagina.",
  status: "published",
  author: "alexander",
  updated: "2026-10-27",
  sources: [],
  faq: [],
  bodyMarkdown: "",
  ...o,
});
const draft = page({ slug: "d", id: "d", title: "Concept", status: "draft", family: "gids" });
const nl = page();
const en = page({ locale: "en", slug: "a-en", file: "content/en/vragen/a-en.md" });

describe("robots", () => {
  it("disallows app api investing for every group", () => {
    const groups = robotsTxt(O).split("\n\n").filter((g) => g.startsWith("User-agent"));
    expect(groups).toHaveLength(12);
    for (const g of groups) {
      expect(g).toContain("Allow: /\n");
      for (const d of ["/api/", "/app", "/investing"]) expect(g).toContain(`Disallow: ${d}`);
    }
    expect(robotsTxt(O)).toMatch(/Sitemap: https:\/\/www\.lavega\.dev\/sitemap\.xml\n$/);
  });
});

describe("sitemap", () => {
  const xml = sitemapXml([nl, en, draft], O);
  it("lists landing pages and published pages only", () => {
    expect(xml).toContain(`<loc>${O}/</loc>`);
    expect(xml).toContain(`<loc>${O}/en</loc>`);
    expect(xml).toContain(`<loc>${O}/vragen/a</loc>`);
    expect(xml).toContain(`<loc>${O}/en/questions/a-en</loc>`);
    expect(xml).toContain(`<loc>${O}/vragen</loc>`);
    expect(xml).not.toContain("/gids");
    expect(xml).not.toContain("Concept");
    expect(xml).toContain("<lastmod>2026-10-27</lastmod>");
  });
  it("adds hreflang only when the counterpart is published", () => {
    expect(xml).toContain(`hreflang="en" href="${O}/en/questions/a-en"`);
    const solo = sitemapXml([nl, page({ id: "z", slug: "z", locale: "en", file: "content/en/vragen/z.md" })], O);
    expect(solo).not.toContain("xhtml:link rel=\"alternate\" hreflang=\"en\" href=\"" + O + "/en/questions/a-en");
    expect(solo).toContain(`<loc>${O}/vragen/a</loc>\n    <lastmod>2026-10-27</lastmod>\n  </url>`);
  });
  it("adds x-default (nl) to landing, page and hub alternates, matching the html", () => {
    expect(xml).toContain(`hreflang="x-default" href="${O}/"`);
    expect(xml).toContain(`hreflang="x-default" href="${O}/vragen/a"`);
    expect(xml).toContain(`hreflang="x-default" href="${O}/vragen"`);
    expect(xml).toContain(`hreflang="en" href="${O}/en/questions"`);
  });
  it("omits hreflang to a draft counterpart", () => {
    const enDraft = page({ locale: "en", slug: "a-en", status: "draft", file: "content/en/vragen/a-en.md" });
    const out = sitemapXml([nl, enDraft], O);
    expect(out).toContain(`<loc>${O}/vragen/a</loc>`);
    expect(out).not.toContain("a-en");
    expect(out.slice(out.indexOf("/vragen/a"))).not.toContain("hreflang");
    expect(out).toContain(`<loc>${O}/vragen/a</loc>\n    <lastmod>2026-10-27</lastmod>\n  </url>`);
  });
  it("xml is well formed", () => {
    const tricky = page({ slug: "t", id: "t" });
    const out = sitemapXml([nl, en, tricky], "https://x.test/?a=1&b=2");
    for (const s of [xml, out]) {
      const doc = new DOMParser().parseFromString(s, "application/xml");
      expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
      expect(doc.getElementsByTagName("url").length).toBeGreaterThan(2);
    }
  });
});

describe("llms", () => {
  const txt = llmsTxt([nl, en, draft], SITE_FACTS, O);
  it("lists every published page with description", () => {
    expect(txt.startsWith("# LaVega\n\n> ")).toBe(true);
    expect(txt).toContain(`- [${nl.title}](${O}/vragen/a): ${nl.description}`);
    expect(txt).toContain(`- [${en.title}](${O}/en/questions/a-en): ${en.description}`);
    expect(txt).not.toContain("Concept");
    expect(txt).toContain(`(${O}/en)`);
  });
  it("quotes the landing copy per locale", () => {
    for (const locale of ["nl", "en"] as const) {
      const f = SITE_FACTS[locale];
      expect(txt).toContain(`## Privacy (${locale})\n${f.privacy.q} ${f.privacy.a}`);
      expect(txt).toContain(`## Price (${locale})\n${f.price.q} ${f.price.a}`);
      expect(txt).toContain(f.summary);
      for (const line of f.does) expect(txt).toContain(`- ${line}`);
    }
  });
  it("lists no draft page and no content the landing copy lacks", () => {
    expect(txt).not.toContain("gids");
    expect(txt).not.toContain("AFM");
  });
  it("makes page groups h2 and sanitizes link text", () => {
    expect(txt).toContain("\n## Vragen (nl)\n");
    expect(txt).not.toContain("### ");
    const odd = page({ title: "A [b]\nc", description: "line1\n  line2" });
    const t = llmsTxt([odd], SITE_FACTS, O);
    expect(t).toContain(`- [A \\[b\\] c](${O}/vragen/a): line1 line2`);
  });
});
