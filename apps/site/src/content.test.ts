import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  counterpart,
  hubUrl,
  loadPages,
  parsePage,
  urlFor,
  type Family,
  type Locale,
} from "./content";

const fm = (o: { id?: string; title?: string | null; status?: string } = {}) =>
  [
    "---",
    `id: ${o.id ?? "x"}`,
    ...(o.title === null ? [] : [`title: ${o.title ?? "Één titel – €5 “quotes”"}`]),
    "description: Beschrijving.",
    `status: ${o.status ?? "published"}`,
    "author: alexander",
    "updated: 2026-10-27",
    "sources:",
    '  - { title: "Bron", url: "https://example.com", accessed: 2026-10-26 }',
    "faq:",
    '  - { q: "Vraag?", a: "Antwoord." }',
    "---",
    "",
    "# Body",
    "",
  ].join("\n");

const parse = (file: string, raw: string) => Effect.runPromise(parsePage(file, raw));
const load = (dir: string, opts: { drafts: boolean }) => Effect.runPromise(loadPages(dir, opts));
/** Run an Effect that must fail and return its error. */
const failure = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(eff));

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "site-content-"));
  dirs.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return dir;
}

describe("content", () => {
  it("parses front matter and path", async () => {
    const p = await parse("content/en/vragen/what-is-a-personal-cfo.md", fm({ id: "personal-cfo" }));
    expect(p).toMatchObject({
      locale: "en",
      family: "vragen",
      slug: "what-is-a-personal-cfo",
      id: "personal-cfo",
      title: "Één titel – €5 “quotes”",
      status: "published",
      updated: "2026-10-27",
      sources: [{ title: "Bron", url: "https://example.com", accessed: "2026-10-26" }],
      faq: [{ q: "Vraag?", a: "Antwoord." }],
    });
    expect(p.bodyMarkdown).toBe("# Body\n");
    expect(urlFor(p)).toBe("/en/questions/what-is-a-personal-cfo");
  });

  it("maps every family url in both locales", () => {
    const table: [Locale, Family, string][] = [
      ["nl", "vragen", "/vragen"],
      ["en", "vragen", "/en/questions"],
      ["nl", "gids", "/gids"],
      ["en", "gids", "/en/guides"],
      ["nl", "vs", "/vs"],
      ["en", "vs", "/en/vs"],
      ["nl", "seizoen", "/seizoen"],
      ["en", "seizoen", "/en/seasonal"],
      ["nl", "over", "/over"],
      ["en", "over", "/en/about"],
      ["nl", "onderzoek", "/onderzoek"],
      ["en", "onderzoek", "/en/research"],
    ];
    expect(table).toHaveLength(12);
    for (const [locale, family, hub] of table) {
      expect(hubUrl(locale, family)).toBe(hub);
      expect(urlFor({ locale, family, slug: "s" })).toBe(`${hub}/s`);
    }
  });

  it("rejects non-http(s) source urls", async () => {
    const bad = fm().replace("https://example.com", "javascript:alert(1)");
    const e = await failure(parsePage("content/nl/gids/a.md", bad));
    expect(e).toMatchObject({ _tag: "ContentParseError", file: "content/nl/gids/a.md" });
    expect(e.reason).toMatch(/sources.*0.*url/s);
  });

  it("rejects missing title", async () => {
    const e = await failure(parsePage("content/nl/gids/a.md", fm({ title: null })));
    expect(e).toMatchObject({ _tag: "ContentParseError", file: "content/nl/gids/a.md" });
    expect(e.reason).toMatch(/title/);
  });

  it("rejects missing front matter and bad dates", async () => {
    const none = await failure(parsePage("content/nl/gids/a.md", "# hi"));
    expect(none).toMatchObject({ _tag: "ContentParseError", file: "content/nl/gids/a.md" });
    const date = await failure(
      parsePage("content/nl/gids/b.md", fm().replace("updated: 2026-10-27", "updated: 27-10-2026")),
    );
    expect(date).toMatchObject({ _tag: "ContentParseError", file: "content/nl/gids/b.md" });
    expect(date.reason).toMatch(/updated/);
  });

  it("filters drafts unless requested", async () => {
    const dir = tree({
      "nl/gids/a.md": fm({ id: "a" }),
      "nl/gids/b.md": fm({ id: "b", status: "draft" }),
    });
    expect((await load(dir, { drafts: false })).map((p) => p.slug)).toEqual(["a"]);
    expect((await load(dir, { drafts: true })).map((p) => p.slug)).toEqual(["a", "b"]);
  });

  it("rejects duplicate urls and ids", async () => {
    const sameId = tree({
      "nl/gids/a.md": fm({ id: "same" }),
      "nl/vragen/b.md": fm({ id: "same" }),
    });
    const e = await failure(loadPages(sameId, { drafts: true }));
    expect(e._tag).toBe("DuplicateContentError");
    if (e._tag !== "DuplicateContentError") throw e;
    expect(e.files.join(" ")).toMatch(/a\.md.*b\.md/);
    expect(e.message).toMatch(/duplicate id/);
  });

  it("finds counterpart by id", async () => {
    const dir = tree({
      "nl/vragen/wat.md": fm({ id: "cfo" }),
      "en/vragen/what.md": fm({ id: "cfo" }),
      "en/gids/other.md": fm({ id: "other" }),
    });
    const all = await load(dir, { drafts: true });
    const nl = all.find((p) => p.slug === "wat")!;
    expect(counterpart(nl, all)?.slug).toBe("what");
    expect(
      counterpart(
        all.find((p) => p.slug === "other")!,
        all,
      ),
    ).toBeUndefined();
  });
});
