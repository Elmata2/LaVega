import { describe, expect, it } from "vitest";
import { landingCopy } from "./landingCopy.js";
import { landingHead } from "./seoHead.js";

const O = "https://www.lavega.dev";
const ld = (html: string): Array<Record<string, unknown>> =>
  [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) =>
    JSON.parse(m[1]!),
  );

describe("landingHead", () => {
  it("nl head has dutch title and canonical /", () => {
    const h = landingHead("nl", O);
    expect(h).toContain(`<title>${landingCopy("nl").meta.title.replace(/&/g, "&amp;")}</title>`);
    expect(h).toContain(`<link rel="canonical" href="${O}/" />`);
    expect(h).toContain(`${O}/og/og-nl.png`);
  });
  it("en head canonical is /en", () => {
    const h = landingHead("en", O);
    expect(h).toContain(`<link rel="canonical" href="${O}/en" />`);
    expect(h).toContain(`${O}/og/og-en.png`);
  });
  it("hreflang links carry data-lavega-hreflang", () => {
    const links = landingHead("nl", O).match(/<link rel="alternate"[^>]*>/g) ?? [];
    expect(links).toHaveLength(3);
    for (const l of links) expect(l).toContain("data-lavega-hreflang");
  });
  it("faq json-ld has every faq question", () => {
    for (const locale of ["nl", "en"] as const) {
      const faq = ld(landingHead(locale, O)).find((g) => g["@type"] === "FAQPage") as {
        mainEntity: Array<{ name: string }>;
      };
      expect(faq.mainEntity.map((q) => q.name)).toEqual(
        landingCopy(locale).faq.items.map((i) => i.q),
      );
    }
  });
  it("title, description, og and json-ld all come from the landing copy", () => {
    for (const locale of ["nl", "en"] as const) {
      const { title, description } = landingCopy(locale).meta;
      const h = landingHead(locale, O);
      expect(h).toContain(`<meta name="description" content="${description}" />`);
      expect(h).toContain(`<meta property="og:title" content="${title}" />`);
      expect(h).toContain(`<meta property="og:description" content="${description}" />`);
      const app = ld(h).find((g) => g["@type"] === "SoftwareApplication");
      expect(app?.description).toBe(description);
    }
  });
  it("no offers and no aggregateRating", () => {
    const h = landingHead("nl", O);
    expect(h).not.toContain("offers");
    expect(h).not.toContain("aggregateRating");
    expect(ld(h).map((g) => g["@type"])).toEqual([
      "Organization",
      "WebSite",
      "SoftwareApplication",
      "FAQPage",
    ]);
  });
  it("Organization carries the shared @id and root url", () => {
    const org = ld(landingHead("nl", O)).find((g) => g["@type"] === "Organization") as {
      "@id": string;
      url: string;
    };
    expect(org["@id"]).toBe(`${O}/#organization`);
    expect(org.url).toBe(`${O}/`);
  });
  it("escapes script terminators in json-ld", () => {
    const h = landingHead("nl", O);
    for (const m of h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs))
      expect(m[1]).not.toContain("<");
  });
});
