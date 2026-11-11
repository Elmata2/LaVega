import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPages } from "./check";
import type { Page } from "./content";

const NL = "Dit is informatie, geen advies.";
const EN = "This is information, not advice.";

const page = (o: Partial<Page> = {}): Page => ({
  file: "content/nl/vragen/x.md",
  locale: "nl",
  family: "vragen",
  slug: "x",
  id: "x",
  title: "Wat kost een rekening",
  description: "Een uitleg over wat een betaalrekening kost en waar die kosten uit bestaan.",
  status: "published",
  author: "alexander",
  updated: "2026-10-27",
  sources: [{ title: "Bron", url: "https://example.com", accessed: "2026-10-26" }],
  faq: [{ q: "Vraag?", a: "Antwoord." }],
  bodyMarkdown: `Tekst over kosten.\n\n## Kopje\n\n${NL}\n`,
  ...o,
});

const rules = (ps: Page[]) => checkPages(ps).map((f) => f.rule);

describe("checkPages link rule", () => {
  const withLink = (target: string, o: Partial<Page> = {}) =>
    page({ bodyMarkdown: `Zie [dit](${target}).\n\n${NL}\n`, ...o });
  const linkFindings = (ps: Page[]) => checkPages(ps).filter((f) => f.rule === "link");
  const target = page({ slug: "y", id: "y", file: "content/nl/vragen/y.md" });

  it("passes links to a published page, a built hub, / and /en", () => {
    for (const t of ["/vragen/y", "/vragen", "/", "/en", "/vragen/y/", "/vragen/y?a=1#top"])
      expect(linkFindings([withLink(t), target]), t).toEqual([]);
  });

  it("flags a link to a draft page, a missing page and an unbuilt hub", () => {
    const draftTarget = { ...target, status: "draft" as const };
    expect(linkFindings([withLink("/vragen/y"), draftTarget])).toHaveLength(1);
    expect(linkFindings([withLink("/vragen/nope"), target])[0]?.detail).toContain("/vragen/nope");
    expect(linkFindings([withLink("/gids"), target])).toHaveLength(1);
  });

  it("ignores external, mailto, fragment and protocol-relative links", () => {
    for (const t of ["https://example.com/x", "mailto:a@b.nl", "#kop", "//cdn.example.com/x"])
      expect(linkFindings([withLink(t), target]), t).toEqual([]);
  });

  it("does not check draft pages", () => {
    expect(linkFindings([withLink("/vragen/nope", { status: "draft" }), target])).toEqual([]);
  });
});

describe("checkPages", () => {
  it("passes a clean page", () => {
    expect(checkPages([page()])).toEqual([]);
  });

  it("advice: flags title, description, body and faq, naming the field", () => {
    const bad = "Dit is de beste keuze.";
    const f = (o: Partial<Page>) => checkPages([page(o)]).filter((x) => x.rule === "advice");
    expect(f({ title: bad })[0]?.detail).toMatch(/best.* in title/);
    expect(
      f({ description: `${bad} Een uitleg over wat een betaalrekening kost en meer.` })[0]?.detail,
    ).toMatch(/in description/);
    expect(f({ bodyMarkdown: `${bad}\n\n${NL}` })[0]?.detail).toMatch(/in body/);
    expect(f({ faq: [{ q: "Ok?", a: bad }] })[0]?.detail).toMatch(/in faq\[0\]\.a/);
    expect(f({ faq: [{ q: bad, a: "Ok." }] })[0]?.detail).toMatch(/in faq\[0\]\.q/);
  });

  it("geen advies disclaimer itself is not a hit", () => {
    expect(rules([page()])).not.toContain("advice");
    const en = page({ locale: "en", bodyMarkdown: `Text.\n\n${EN}\n` });
    expect(rules([en])).not.toContain("advice");
  });

  it("ignores words inside link urls", () => {
    const p = page({
      bodyMarkdown: `Zie [de tarieven](https://example.com/beste-advies) en https://example.com/best.\n\n${NL}\n`,
    });
    expect(rules([p])).not.toContain("advice");
    const visible = page({
      bodyMarkdown: `Zie [het beste advies](https://example.com/x).\n\n${NL}\n`,
    });
    expect(rules([visible])).toContain("advice");
  });

  it("description-length", () => {
    expect(rules([page({ description: "Te kort." })])).toContain("description-length");
    expect(rules([page({ description: "x".repeat(161) })])).toContain("description-length");
    expect(rules([page({ description: "x".repeat(50) })])).not.toContain("description-length");
    expect(rules([page({ description: "x".repeat(160) })])).not.toContain("description-length");
  });

  it("sources", () => {
    expect(rules([page({ sources: [] })])).toContain("sources");
    expect(rules([page({ sources: [], family: "over" })])).not.toContain("sources");
    expect(rules([page()])).not.toContain("sources");
  });

  it("no-h1", () => {
    expect(rules([page({ bodyMarkdown: `# Titel\n\n${NL}` })])).toContain("no-h1");
    expect(rules([page({ bodyMarkdown: `<h1 class="a">T</h1>\n\n${NL}` })])).toContain("no-h1");
    expect(rules([page({ bodyMarkdown: `## Kop\n\n${NL}` })])).not.toContain("no-h1");
  });

  it("todo", () => {
    expect(rules([page({ bodyMarkdown: `[[TODO bron]]\n\n${NL}` })])).toContain("todo");
    expect(rules([page()])).not.toContain("todo");
  });

  it("counterpart", () => {
    const nl = page();
    const enSame = page({
      file: "content/en/vragen/x.md",
      locale: "en",
      bodyMarkdown: `Text.\n\n${EN}\n`,
    });
    expect(rules([nl, enSame])).not.toContain("counterpart");
    const enOther = { ...enSame, family: "gids" as const };
    expect(rules([nl, enOther])).toContain("counterpart");
    expect(rules([nl])).not.toContain("counterpart");
  });
});

describe("cli", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  const md = (status: string, body: string) =>
    [
      "---",
      "id: x",
      "title: Wat kost een rekening",
      "description: Een uitleg over wat een betaalrekening kost en waar die kosten uit bestaan.",
      `status: ${status}`,
      "author: alexander",
      "updated: 2026-10-27",
      "sources:",
      '  - { title: "Bron", url: "https://example.com", accessed: 2026-10-26 }',
      "---",
      "",
      body,
      "",
    ].join("\n");
  function run(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "site-check-"));
    dirs.push(dir);
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    return spawnSync("pnpm", ["exec", "tsx", "src/cli-check.ts", dir], {
      cwd: join(__dirname, ".."),
      encoding: "utf8",
    });
  }
  const bad = `Dit is de beste keuze.\n\n${NL}`;

  it("advice hit on published page fails cli", () => {
    const r = run({ "nl/vragen/x.md": md("published", bad) });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("ERROR");
    expect(r.stdout).toContain("[advice]");
  });

  it("advice hit on draft is a warning", () => {
    const r = run({ "nl/vragen/x.md": md("draft", bad) });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("warn");
    expect(r.stdout).toContain("[advice]");
  });

  it("a file that fails to parse exits 1", () => {
    const r = run({ "nl/vragen/x.md": "no front matter" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("front matter");
  });
});
