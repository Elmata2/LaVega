import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { buildSite } from "./build";

const NL = "Dit is informatie, geen advies.";
const EN = "This is information, not advice.";

const md = (o: { id: string; status: string; body?: string; locale?: "nl" | "en" }) =>
  [
    "---",
    `id: ${o.id}`,
    "title: Wat kost een rekening",
    "description: Een uitleg over wat een betaalrekening kost en waar die kosten uit bestaan.",
    `status: ${o.status}`,
    "author: alexander",
    "updated: 2026-10-27",
    "sources:",
    '  - { title: "Bron", url: "https://example.com", accessed: 2026-10-26 }',
    "faq:",
    '  - { q: "Vraag?", a: "Antwoord." }',
    "---",
    "",
    o.body ?? `Tekst over kosten.\n\n${o.locale === "en" ? EN : NL}\n`,
  ].join("\n");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function setup(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "site-build-"));
  dirs.push(root);
  const contentDir = join(root, "content");
  for (const [rel, text] of Object.entries(files)) {
    const p = join(contentDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return { contentDir, outDir: join(root, "out") };
}
const origin = "https://www.lavega.dev";
const build = (dirsIn: { contentDir: string; outDir: string }, drafts: boolean) =>
  Effect.runPromise(buildSite({ ...dirsIn, drafts, origin, clean: false }));

describe("buildSite", () => {
  const files = {
    "nl/vragen/a.md": md({ id: "a", status: "published" }),
    "nl/vragen/b.md": md({ id: "b", status: "draft" }),
    "en/vragen/a-en.md": md({ id: "a", status: "published", locale: "en" }),
  };

  it("writes html for published pages only", async () => {
    const d = setup(files);
    await build(d, false);
    expect(existsSync(join(d.outDir, "vragen/a.html"))).toBe(true);
    expect(existsSync(join(d.outDir, "en/questions/a-en.html"))).toBe(true);
    expect(existsSync(join(d.outDir, "vragen/b.html"))).toBe(false);
    expect(existsSync(join(d.outDir, "vragen.html"))).toBe(true);
    expect(existsSync(join(d.outDir, "gids.html"))).toBe(false);
    for (const f of [
      "robots.txt",
      "sitemap.xml",
      "llms.txt",
      "site.css",
      "brand/wordmark.png",
      "og/og-nl.png",
    ])
      expect(existsSync(join(d.outDir, f)), f).toBe(true);
    expect(existsSync(join(d.outDir, "scripts"))).toBe(false);
    expect(readFileSync(join(d.outDir, "sitemap.xml"), "utf8")).not.toContain("/vragen/b");
    expect(readFileSync(join(d.outDir, "llms.txt"), "utf8")).not.toContain("/vragen/b");
  });

  it("overrides map clean paths", async () => {
    const d = setup(files);
    const { overrides } = await build(d, false);
    expect(overrides["vragen/a.html"]).toEqual({
      path: "vragen/a",
      contentType: "text/html; charset=utf-8",
    });
    expect(overrides["vragen.html"]?.path).toBe("vragen");
    expect(overrides["en/questions.html"]?.path).toBe("en/questions");
    expect(overrides["en/questions/a-en.html"]?.path).toBe("en/questions/a-en");
    expect(overrides["vragen/b.html"]).toBeUndefined();
  });

  it("fails on published advice finding", async () => {
    const d = setup({
      "nl/vragen/a.md": md({
        id: "a",
        status: "published",
        body: `Dit is de beste keuze.\n\n${NL}\n`,
      }),
    });
    const e = await Effect.runPromise(
      Effect.flip(buildSite({ ...d, drafts: false, origin, clean: false })),
    );
    expect(e._tag).toBe("PublishedFindingsError");
    expect(e.message).toContain("[advice]");
    expect(existsSync(d.outDir)).toBe(false);
  });

  it("does not fail on a draft finding", async () => {
    const d = setup({
      "nl/vragen/a.md": md({ id: "a", status: "draft", body: `Dit is de beste keuze.\n\n${NL}\n` }),
    });
    await expect(build(d, true)).resolves.toBeDefined();
  });

  it("drafts flag renders drafts with banner", async () => {
    const d = setup(files);
    await build(d, true);
    const html = readFileSync(join(d.outDir, "vragen/b.html"), "utf8");
    expect(html).toContain("DRAFT");
    expect(html).toContain('content="noindex"');
  });

  it("reports a malformed file as a tagged error naming it", async () => {
    const d = setup({ "nl/vragen/a.md": "# no front matter" });
    const e = await Effect.runPromise(
      Effect.flip(buildSite({ ...d, drafts: false, origin, clean: false })),
    );
    expect(e._tag).toBe("ContentParseError");
    expect(e.message).toContain("a.md");
  });

  it("clean removes a page that went from published to draft", async () => {
    const d = setup(files);
    const run = () => Effect.runPromise(buildSite({ ...d, drafts: false, origin, clean: true }));
    await run();
    expect(existsSync(join(d.outDir, "vragen/a.html"))).toBe(true);
    writeFileSync(join(d.contentDir, "nl/vragen/a.md"), md({ id: "a", status: "draft" }));
    await run();
    expect(existsSync(join(d.outDir, "vragen/a.html"))).toBe(false);
    expect(existsSync(join(d.outDir, "en/questions/a-en.html"))).toBe(true);
  });

  it("without clean, other files in outDir survive", async () => {
    const d = setup(files);
    mkdirSync(d.outDir, { recursive: true });
    writeFileSync(join(d.outDir, "app.js"), "x");
    await build(d, false);
    expect(existsSync(join(d.outDir, "app.js"))).toBe(true);
  });

  it("clean refuses the content dir, its ancestors and the cwd", async () => {
    const d = setup(files);
    const refuse = async (outDir: string) => {
      const e = await Effect.runPromise(
        Effect.flip(
          buildSite({ contentDir: d.contentDir, outDir, drafts: false, origin, clean: true }),
        ),
      );
      expect(e._tag).toBe("UnsafeCleanError");
    };
    await refuse(d.contentDir);
    await refuse(dirname(d.contentDir));
    await refuse(process.cwd());
    expect(existsSync(join(d.contentDir, "nl/vragen/a.md"))).toBe(true);
  });

  it("a missing content dir fails with a tagged error naming the path", async () => {
    const d = setup(files);
    const missing = join(dirname(d.contentDir), "nope");
    const e = await Effect.runPromise(
      Effect.flip(
        buildSite({ contentDir: missing, outDir: d.outDir, drafts: false, origin, clean: false }),
      ),
    );
    expect(e._tag).toBe("ContentReadError");
    expect(e.message).toContain(missing);
    expect(e.message).toContain("content directory not found");
  });

  it("fails when a published page links to a draft page", async () => {
    const d = setup({
      "nl/vragen/a.md": md({
        id: "a",
        status: "published",
        body: `Zie [b](/vragen/b).\n\n${NL}\n`,
      }),
      "nl/vragen/b.md": md({ id: "b", status: "draft" }),
    });
    const e = await Effect.runPromise(
      Effect.flip(buildSite({ ...d, drafts: false, origin, clean: false })),
    );
    expect(e._tag).toBe("PublishedFindingsError");
    expect(e.message).toContain("[link]");
  });

  it("a partial publish leaves no dead internal link in the output", async () => {
    const d = setup(files);
    await build(d, false);
    const exists = (href: string) => {
      const path = href.split(/[?#]/)[0] ?? "";
      return (
        path === "/" ||
        path === "/en" ||
        existsSync(join(d.outDir, `${path}.html`)) ||
        existsSync(join(d.outDir, path))
      );
    };
    const dead: string[] = [];
    for (const f of [
      "vragen/a.html",
      "vragen.html",
      "en/questions/a-en.html",
      "en/questions.html",
    ]) {
      const html = readFileSync(join(d.outDir, f), "utf8");
      for (const m of html.matchAll(/<a [^>]*href="(\/[^"]*)"/g))
        if (!exists(m[1] ?? "")) dead.push(`${f} -> ${m[1]}`);
    }
    expect(dead).toEqual([]);
  });
});
