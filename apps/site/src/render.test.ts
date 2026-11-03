import { describe, expect, it } from "vitest";
import type { Page } from "./content.js";
import { jsonLdForPage, safeJsonLd } from "./jsonld.js";
import { renderHub, renderPage, safeUrl } from "./render.js";

const origin = "https://www.lavega.dev";
const mk = (o: Partial<Page> = {}): Page => ({
  file: "content/nl/vragen/x.md",
  locale: "nl",
  family: "vragen",
  slug: "x",
  id: "x",
  title: "Wat is een café? €5 “test”",
  description: "d",
  status: "published",
  author: "alexander",
  updated: "2026-10-27",
  sources: [{ title: "Bron", url: "https://example.com/a?b=1&c=2", accessed: "2026-10-27" }],
  faq: [],
  bodyMarkdown: "# Kop\n\nTekst met [link](/vragen/y).\n\n## Sub\n",
  ...o,
});
const en = (o: Partial<Page> = {}) =>
  mk({ locale: "en", slug: "x-en", file: "content/en/vragen/x-en.md", title: "What is X", ...o });
const authorNl = () => mk({ family: "over", slug: "alexander-steunenberg", id: "me", sources: [] });
const authorEn = () =>
  mk({ locale: "en", family: "over", slug: "alexander-steunenberg", id: "me", sources: [] });
const draft = { origin, draft: true };
const prod = { origin, draft: false };

describe("renderPage", () => {
  it("renders exactly one h1", () => {
    const html = renderPage(mk(), [mk()], prod);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it("canonical and hreflang pair", () => {
    const nl = mk();
    const e = en();
    const html = renderPage(nl, [nl, e], prod);
    expect(html).toContain(`<link rel="canonical" href="${origin}/vragen/x">`);
    expect(html).toContain(`hreflang="nl" href="${origin}/vragen/x"`);
    expect(html).toContain(`hreflang="en" href="${origin}/en/questions/x-en"`);
    expect(html).toContain(`hreflang="x-default" href="${origin}/vragen/x"`);
    const htmlEn = renderPage(e, [nl, e], prod);
    expect(htmlEn).toContain(`hreflang="x-default" href="${origin}/vragen/x"`);
    expect(htmlEn).toContain('<html lang="en">');
  });

  it("omits hreflang when counterpart unpublished", () => {
    const nl = mk();
    const e = en({ status: "draft" });
    const html = renderPage(nl, [nl, e], prod);
    expect(html).not.toContain("hreflang");
    expect(html).not.toContain("/en/questions/x-en");
    const withDraft = renderPage(nl, [nl, e], draft);
    expect(withDraft).toContain('hreflang="en"');
  });

  it("related pages ignore drafts in production", () => {
    const a = mk();
    const b = mk({ slug: "b", id: "b", title: "Published B" });
    const c = mk({ slug: "c", id: "c", title: "Draft C", status: "draft" });
    const html = renderPage(a, [a, b, c], prod);
    expect(html).toContain("Published B");
    expect(html).not.toContain("Draft C");
    expect(renderPage(a, [a, b, c], draft)).toContain("Draft C");
  });

  it("json-ld parses and has Article author", () => {
    const html = renderPage(mk({ faq: [{ q: "Q?", a: "A." }] }), [mk(), authorNl()], prod);
    const blocks = [
      ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    ].map(
      (m) => JSON.parse(m[1] ?? "") as { "@type": string; author?: { name: string; url: string } },
    );
    const article = blocks.find((b) => b["@type"] === "Article");
    expect(article?.author?.name).toBe("Alexander Steunenberg");
    expect(article?.author?.url).toBe(`${origin}/over/alexander-steunenberg`);
    expect(blocks.map((b) => b["@type"])).toEqual(["Article", "BreadcrumbList", "FAQPage"]);
    expect(html).toContain("€5");
  });

  it("uses ProfilePage for the over family", () => {
    const ld = jsonLdForPage(authorNl(), origin, [authorNl()]);
    expect((ld[0] as { "@type": string })["@type"]).toBe("ProfilePage");
  });

  it("escapes script terminators in json-ld", () => {
    const p = mk({ title: "a </script><script>alert(1)</script>" });
    const html = renderPage(p, [p], prod);
    expect(html).not.toContain("</script><script>");
    expect(safeJsonLd({ t: "</script>" })).not.toContain("<");
    expect(JSON.parse(safeJsonLd({ t: "</script>" }))).toEqual({ t: "</script>" });
  });

  it("does not pass raw html through", () => {
    const p = mk({
      bodyMarkdown:
        "Hi <img src=x onerror=x>\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))",
    });
    const html = renderPage(p, [p], prod);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=x&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("javascript:");
  });

  it("blocks tab-obfuscated javascript: links and images, keeps safe ones", () => {
    const p = mk({
      bodyMarkdown:
        "[x](<jav\tascript:alert(1)>) ![i](<jav\tascript:alert(2)>) ![j](data:image/png;base64,AA) [ok](/a) [h](https://e.com) [m](mailto:a@b.nl) [f](ftp://x)",
    });
    const html = renderPage(p, [p], prod);
    expect(html).not.toMatch(/href="[^"]*script/i);
    expect(html).not.toMatch(/src="[^"]*(script|data:)/i);
    expect(html).toContain('href="/a"');
    expect(html).toContain('href="https://e.com"');
    expect(html).toContain('href="mailto:a@b.nl"');
    expect(html).not.toContain("ftp:");
  });

  it("does not render a javascript: source url as a link", () => {
    const p = mk({
      sources: [{ title: "Bad", url: "javascript:alert(1)", accessed: "2026-10-27" }],
    });
    const html = renderPage(p, [p], prod);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("Bad");
  });

  it("escapes quotes in title and description attributes", () => {
    const p = mk({ title: 'a" onmouseover="x', description: 'b" autofocus="y' });
    const html = renderPage(p, [p], prod);
    expect(html).not.toContain('" onmouseover="');
    expect(html).not.toContain('" autofocus="');
    expect(html).toContain("a&quot; onmouseover=&quot;x");
  });

  it("draft has noindex and banner", () => {
    const p = mk({ status: "draft" });
    const d = renderPage(p, [p], draft);
    expect(d).toContain('<meta name="robots" content="noindex">');
    expect(d).toContain("DRAFT");
    const prodHtml = renderPage(mk(), [mk()], prod);
    expect(prodHtml).not.toContain("noindex");
    expect(prodHtml).not.toContain("DRAFT");
  });

  it("no executable script tags", () => {
    const html = renderPage(mk(), [mk()], prod);
    const tags = html.match(/<script[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const t of tags) expect(t).toBe('<script type="application/ld+json">');
  });

  it("has disclaimer, author link, updated line, assets", () => {
    const html = renderPage(mk(), [mk(), authorNl()], prod);
    expect(html).toContain("Dit is informatie, geen advies.");
    expect(html).toContain('href="/over/alexander-steunenberg"');
    expect(html).toContain("Laatst bijgewerkt");
    expect(html).toContain('src="/brand/wordmark.png" alt="LaVega"');
    expect(html).toContain(`content="${origin}/og/og-nl.png"`);
    expect(html).toContain('href="/site.css"');
    const e = en();
    const htmlEn = renderPage(e, [e, authorEn()], prod);
    expect(htmlEn).toContain("This is information, not advice.");
    expect(htmlEn).toContain('href="/en/about/alexander-steunenberg"');
    expect(htmlEn).toContain('<a href="/en">');
  });
});

describe("links only to pages that exist", () => {
  const links = (html: string) => [...html.matchAll(/<a href="(\/[^"]*)"/g)].map((m) => m[1]);
  const orgOf = (html: string) => html.match(/"@type":"Organization"[^}]*/)?.[0] ?? "";

  it("footer lists only built hubs", () => {
    const html = renderPage(mk(), [mk()], prod);
    expect(html).toContain('<footer class="site-footer"><p><a href="/vragen">Vragen</a></p>');
    for (const dead of ["/gids", "/vs", "/seizoen"]) expect(links(html)).not.toContain(dead);
    const g = mk({ family: "gids", slug: "g", id: "g" });
    const both = renderPage(mk(), [mk(), g], prod);
    expect(links(both)).toContain("/gids");
  });

  it("footer has no nav row when no hub is a footer family", () => {
    const o = mk({ family: "over", slug: "alexander-steunenberg", id: "me", sources: [] });
    const html = renderPage(o, [o], prod);
    expect(html).toContain('<footer class="site-footer"><p>LaVega');
  });

  it("byline and Person.url link the author page only when it is in the pool", () => {
    const solo = renderPage(mk(), [mk()], prod);
    expect(solo).not.toContain("/over/alexander-steunenberg");
    expect(solo).toContain("Alexander Steunenberg");
    const person = JSON.stringify(jsonLdForPage(mk(), origin, [mk()]));
    expect(person).not.toContain("alexander-steunenberg");
    const withAuthor = renderPage(mk(), [mk(), authorNl()], prod);
    expect(withAuthor).toContain('href="/over/alexander-steunenberg" rel="author"');
    const draftAuthor = { ...authorNl(), status: "draft" as const };
    expect(renderPage(mk(), [mk(), draftAuthor], prod)).not.toContain(
      "/over/alexander-steunenberg",
    );
  });

  it("breadcrumb hub crumb is plain text and left out of json-ld when the hub is not built", () => {
    const p = mk();
    const html = renderPage(p, [], prod);
    expect(html).toContain("<li>Vragen</li>");
    expect(links(html)).not.toContain("/vragen");
    const crumbs = jsonLdForPage(p, origin, []).find(
      (b) => (b as { "@type": string })["@type"] === "BreadcrumbList",
    ) as {
      itemListElement: { position: number; name: string }[];
    };
    expect(crumbs.itemListElement.map((c) => [c.position, c.name])).toEqual([
      [1, "LaVega"],
      [2, p.title],
    ]);
    expect(renderPage(p, [p], prod)).toContain('<li><a href="/vragen">Vragen</a></li>');
  });

  it("shares one Organization @id and url", () => {
    const html = renderPage(mk(), [mk()], prod);
    expect(orgOf(html)).toContain(`"@id":"${origin}/#organization"`);
    expect(orgOf(html)).toContain(`"url":"${origin}/"`);
  });

  it("content pages carry og image size and alt", () => {
    const html = renderPage(mk(), [mk()], prod);
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
    expect(html).toContain('<meta property="og:image:alt" content="LaVega">');
  });
});

describe("renderHub", () => {
  it("carries the same hreflang pairs as the sitemap when both locales have the hub", () => {
    const html = renderHub("nl", "vragen", [mk(), en()], { origin });
    expect(html).toContain(`hreflang="nl" href="${origin}/vragen"`);
    expect(html).toContain(`hreflang="en" href="${origin}/en/questions"`);
    expect(html).toContain(`hreflang="x-default" href="${origin}/vragen"`);
    expect(renderHub("nl", "vragen", [mk()], { origin })).not.toContain("hreflang");
  });

  it("lists given pages for the locale", () => {
    const html = renderHub("nl", "vragen", [mk(), en()], { origin });
    expect(html).toContain('href="/vragen/x"');
    expect(html).not.toContain("/en/questions/x-en");
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });
});

describe("safeUrl", () => {
  const links = ["http", "https", "mailto"];
  it("allows relative URLs and listed schemes", () => {
    expect(safeUrl("/vragen/box-3", links)).toBe(true);
    expect(safeUrl("https://www.lavega.dev", links)).toBe(true);
    expect(safeUrl("mailto:hi@lavega.dev", links)).toBe(true);
  });
  it("rejects a scheme hidden behind whitespace or control characters", () => {
    for (const href of [
      "javascript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:x",
      "\u0000javascript:x",
      "JAVASCRIPT:x",
    ]) {
      expect(safeUrl(href, links)).toBe(false);
    }
  });
});
